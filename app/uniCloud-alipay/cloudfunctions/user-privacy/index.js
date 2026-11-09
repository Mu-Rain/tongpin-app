'use strict'

/**
 * 动态可见性（「同频圈」谁能看到我发的动态）
 *
 * 入参：{ token, action: 'get' | 'set', moments_visibility? }
 *   set 时 moments_visibility 必填，取值白名单 'all' | 'friends' | 'self'
 *
 * 出参：{ code: 0, msg: 'ok', data: { moments_visibility } }
 *   moments_visibility 一定是上面三个值之一：字段缺失 / 脏数据一律按 'all' 返回，
 *   前端拿到的永远是白名单内的值，不用再做一次兜底判断。
 *
 * 错误：token 无效 401；action 不认识 400；moments_visibility 不在白名单 400。
 *
 * ★ 为什么存在 uni-id-users 上、而不是单开一张 privacy 表：
 *   这条设置永远与"这个人"一对一，读它的人（post-list 的可见性过滤）手上
 *   恰好只有 owner_id。放用户表就能一次 in 查询批量拿到，不用再为列表
 *   多打一次隐私表的往返。多一张表 = 多一次 join 的模拟，文档型数据库里这很贵。
 *
 * ★ 缺省为什么是 'all' 而不是 'friends'：
 *   缺省值决定"老用户升级后行为变不变"。历史数据没有这个字段，
 *   若缺省成 friends，全部老用户在升级瞬间互相看不见 —— 只能选 'all'。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const VISIBILITY = ['all', 'friends', 'self']
const DEFAULT_VISIBILITY = 'all'

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

/** 白名单外的值（含 undefined / null / 脏数据）统一收敛到缺省值 */
function normalize(v) {
  const s = str(v)
  return VISIBILITY.indexOf(s) >= 0 ? s : DEFAULT_VISIBILITY
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  const u = r.data[0]
  if (u.tokenExpire && Date.now() > u.tokenExpire) fail('登录已过期，请重新登录', 401)
  if (u.status === 'banned' || u.status === 0) fail('账号已被封禁', 403)
  return u
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))
    const action = str(event.action) || 'get'

    if (action === 'get') {
      return {
        code: 0,
        msg: 'ok',
        data: { moments_visibility: normalize(me.moments_visibility) }
      }
    }

    if (action === 'set') {
      const raw = str(event.moments_visibility)
      // 白名单外的值必须报错，不能"收敛一下算了"：
      // 用户以为设成了「仅自己」，结果被静默改成「全部可见」，这是隐私事故。
      if (VISIBILITY.indexOf(raw) < 0) fail('moments_visibility 只能是 all / friends / self', 400)

      const now = Date.now()
      await db.collection(DB_USERS).doc(me._id).update({
        moments_visibility: raw,
        updated_at: now
      })

      return { code: 0, msg: 'ok', data: { moments_visibility: raw } }
    }

    fail('action 只能是 get 或 set', 400)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '服务端错误', data: null }
  }
}
