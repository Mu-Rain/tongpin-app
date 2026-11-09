'use strict'

/**
 * 推送标识绑定 —— 客户端拿到 uni-push 的 cid 后上来登记，退出登录时上来注销
 *
 * 入参：{ token, action: 'bind'|'unbind', cid, platform? }
 *   action=bind   → 要登录态；cid 必须是非空字符串且 ≤128 字符
 *   action=unbind → 未登录 / 没 cid 都返回 code:0 但不做事（退出登录不该报错）
 * 出参：{ code, msg, data? }
 *
 * 设计要点：
 *   1. 同一 user_id + cid 用"先查再决定 add/update"收敛，不依赖唯一索引 ——
 *      项目里索引只是性能项，用户可能还没在控制台建。
 *   2. push_tokens 是"谁能收到推送"的映射表，一台设备一行；
 *      同一用户多设备就是多行，push-send 会把它们全取出来逐个推。
 *   3. platform 只存 'android' / 'ios' / ''，传别的（h5、对象、null）一律收敛成空串，不报错。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_PUSH_TOKENS = 'push_tokens'

const MAX_CID = 128
const PLATFORM_ENUM = ['android', 'ios', '']

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

function normalizePlatform(v) {
  const p = str(v).toLowerCase()
  return PLATFORM_ENUM.indexOf(p) >= 0 ? p : ''
}

/**
 * cid 校验（bind 的硬门槛）：空 / 非字符串 / 超长都抛业务错。
 * 不校验字符集：cid 由 uni-push 下发，我们只做长度兜底，别自己发明规则把它挡在外面。
 */
function requireCid(v) {
  const cid = str(v)
  if (!cid) fail('缺少推送标识')
  if (cid.length > MAX_CID) fail('推送标识不合法')
  return cid
}

async function doBind(event) {
  const me = await getUserByToken(str(event.token))
  const cid = requireCid(event.cid)
  const platform = normalizePlatform(event.platform)
  const now = Date.now()

  const existRes = await db
    .collection(DB_PUSH_TOKENS)
    .where({ user_id: me._id, cid })
    .limit(1)
    .get()

  // 已经有这一行：只刷新 platform / updated_at，绝不 add 第二行
  if (existRes.data.length) {
    await db.collection(DB_PUSH_TOKENS).doc(existRes.data[0]._id).update({
      platform,
      updated_at: now
    })
    return { code: 0, msg: 'ok', data: { bound: true, created: false } }
  }

  await db.collection(DB_PUSH_TOKENS).add({
    user_id: me._id,
    cid,
    platform,
    created_at: now,
    updated_at: now
  })
  return { code: 0, msg: 'ok', data: { bound: true, created: true } }
}

/**
 * 注销：退出登录时调用，任何情况都不许报错。
 * 未登录（token 过期/没传）或没 cid → code:0 空跑，因为退出的客户端本来就可能已经没有有效 token。
 * 删行也套 try/catch：表还没建（从没 bind 过就退出）时 remove 会报错，同样当作"没删到"。
 */
async function doUnbind(event) {
  const cid = str(event.cid)
  if (!cid) return { code: 0, msg: 'ok', data: { removed: 0 } }

  let me = null
  try {
    me = await getUserByToken(str(event.token))
  } catch (e) {
    return { code: 0, msg: 'ok', data: { removed: 0 } }
  }

  let removed = 0
  try {
    const res = await db.collection(DB_PUSH_TOKENS).where({ user_id: me._id, cid }).remove()
    if (res && typeof res.deleted === 'number') removed = res.deleted
  } catch (e) {
    console.warn('[user-push] 删除推送标识失败，按 0 条返回', e && e.message)
  }
  return { code: 0, msg: 'ok', data: { removed } }
}

exports.main = async (event) => {
  const ev = event || {}
  try {
    const action = str(ev.action) || 'bind'
    if (action === 'bind') return await doBind(ev)
    if (action === 'unbind') return await doUnbind(ev)
    fail('不支持的 action：' + action)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '操作失败' }
  }
}
