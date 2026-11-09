'use strict'

/**
 * 发离线推送 —— 内部函数，只给别的云函数调（客户端不该直接调）
 *
 * 入参：{ token, to_user_id, title, content, payload? }
 * 出参：{ code, msg, data: { sent, failed } }
 *
 * 为什么内部函数也要鉴权 + 校验成员关系：
 *   它按 to_user_id 给任意人推，谁都能调的话就是一个"任意骚扰通道"。
 *   所以只允许给"和我同处一个会话"的人推 —— 和 message-send 的成员校验同一个口径。
 *
 * 推送走 uni-push 2.0 服务端 SDK：uniCloud.getPushManager({ appId }).sendMessage(...)。
 * appId 写死 __UNI__20CB151（manifest.json 里的 appid），不接受入参 —— 免得被当成通用推送网关。
 * ★ uni-cloud-push 是扩展库，必须在本目录 package.json 的 extensions 里声明，
 *   否则 getPushManager 直接是 undefined；依赖写法见本目录 package.json（按官方文档原文）。
 * ★ 推送是锦上添花：读表、SDK 缺失、单台失败，全部只 console.warn，返回值仍是 code:0。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_MEMBERS = 'conversation_members'
const DB_PUSH_TOKENS = 'push_tokens'

const PUSH_APP_ID = '__UNI__20CB151'

// 通知栏一行放不下更多，且超长会被 uni-push 服务端拒；调用方传什么都先截断兜底
const MAX_TITLE = 60
const MAX_CONTENT = 200
// 单个用户的会话数 / 设备数上限：uniCloud 云函数单次查询默认就是 100 行，显式写出来免得读者猜
const MAX_ROWS = 100

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

/**
 * 取 to_user_id 名下所有 cid，逐个推。
 * 单台设备失败只 console.warn，不影响其它设备 —— 用户换机后老 cid 会一直失败到下次 bind 覆盖。
 */
async function pushToUser(toUserId, title, content, payload) {
  const cids = []
  try {
    const res = await db
      .collection(DB_PUSH_TOKENS)
      .where({ user_id: toUserId })
      .limit(MAX_ROWS)
      .get()
    for (const row of res.data) {
      const cid = str(row.cid)
      if (cid) cids.push(cid)
    }
  } catch (e) {
    // 表不存在 / 查询失败：对方压根没绑过推送，当作没设备可推
    console.warn('[push-send] 读 push_tokens 失败，本次不推', e && e.message)
    return { sent: 0, failed: 0 }
  }
  if (!cids.length) return { sent: 0, failed: 0 }

  let sent = 0
  let failed = 0
  for (const cid of cids) {
    try {
      const manager = uniCloud.getPushManager({ appId: PUSH_APP_ID })
      await manager.sendMessage({
        push_clientid: cid,
        title,
        content,
        payload,
        force_notification: true
      })
      sent++
    } catch (e) {
      failed++
      console.warn('[push-send] 推送失败', cid, e && e.message)
    }
  }
  return { sent, failed }
}

exports.main = async (event) => {
  const ev = event || {}
  try {
    const me = await getUserByToken(str(ev.token))

    const toUserId = str(ev.to_user_id)
    if (!toUserId) fail('缺少 to_user_id')

    // —— 只能是"和我同处一个会话"的人 ——
    // 先取对方的会话列表，再用 in 反查我在其中哪些里；两条查询，不做 N+1 也不做全表扫。
    const hisRes = await db
      .collection(DB_MEMBERS)
      .where({ user_id: toUserId })
      .limit(MAX_ROWS)
      .get()
    const hisConvIds = []
    for (const m of hisRes.data) {
      const cid = str(m.conversation_id)
      if (cid) hisConvIds.push(cid)
    }
    if (!hisConvIds.length) fail('你和对方不在同一个会话里', 403)

    const sharedRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: dbCmd.in(hisConvIds), user_id: me._id })
      .limit(1)
      .get()
    if (!sharedRes.data.length) fail('你和对方不在同一个会话里', 403)

    const title = str(ev.title).slice(0, MAX_TITLE) || '同频'
    const content = str(ev.content).slice(0, MAX_CONTENT) || '你有一条新消息'
    let payload = ev.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {}

    const out = await pushToUser(toUserId, title, content, payload)
    return { code: 0, msg: 'ok', data: out }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '推送失败' }
  }
}
