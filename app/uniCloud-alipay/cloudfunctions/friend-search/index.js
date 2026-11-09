'use strict'

/**
 * 搜人 —— 加好友页的搜索框（US-26）
 *
 * 入参：{ token, keyword }
 * 出参：{ code, msg, data: { list, total, need_uid?, self? } }
 *
 * list 每项：{ user_id, uid, name, avatar, school, verified, credit, is_friend, request_state }
 *   is_friend     = 已经在 friendships 里
 *   request_state = 'friend'    已是好友
 *                 | 'out_pending' 我发过申请，没处理
 *                 | 'in_pending'  对方发过申请，没处理
 *                 | 'none'        没有关系
 *   前端靠 request_state 决定按钮是「加好友 / 已申请 / 去同意 / 直接聊」，
 *   状态判断放服务端，免得每个页面各写一遍还写不一致。
 *
 * ★ 只按 UID 精确搜（2026-10 二次改版）：
 *   ① 昵称不做唯一约束，重名是常态，按昵称搜只会搜出一屏同名的人；
 *   ② user_no 在真实注册链路里从来没有生成过（只有 demo-seed 写过）；
 *   ③ 手机号是隐私数据，做成搜索键等于「知道号码就能确认对方是否注册」，
 *      还会把号码暴露给任何一个搜到的人。
 *   所以对外只认 uid：8 位纯数字、唯一索引、注册时生成、永不变更。
 *   keyword 必须是完整 8 位，等值命中，最多 1 条结果。
 *
 * ★ keyword 为空 / 不满 8 位都不报错：前端边输边调，报错会弹一堆红 toast。
 *   空 → 空列表；不满 8 位 → 空列表 + need_uid:true，由前端提示「输完才会搜」。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_FRIENDS = 'friendships'
const DB_REQUESTS = 'friend_requests'

const SEARCH_LIMIT = 20

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// 只投影白名单字段：少传 token / mobile / password 一次，就少一次泄露的机会。
// 与 buddy-list 的 .field() 保持一致，proj 里的字段名旧新两套都留着。
const USER_FIELDS = {
  _id: true,
  nickname: true,
  avatar: true,
  avatar_url: true,
  school: true,
  school_name: true,
  school_id: true,
  user_no: true,
  // 对外唯一身份号，也是唯一的搜索键
  uid: true,
  is_verified: true,
  schoolVerified: true,
  credit: true,
  credit_score: true
}

function pickNum(a, b) {
  if (typeof a === 'number') return a
  if (typeof b === 'number') return b
  return 80
}

function pickBool(a, b) {
  if (typeof a === 'boolean') return a
  if (typeof b === 'boolean') return b
  return false
}

function pairKey(x, y) {
  return x < y ? x + '|' + y : y + '|' + x
}

/**
 * UID：8 位纯数字，首位非 0。和 user-register 的生成规则是同一套口径。
 * 只做格式校验，不做「补零」「模糊匹配」——
 * 少一位就搜不到，比"输 7 位搜出一堆人"更符合预期。
 */
function isUid(v) {
  return /^[1-9]\d{7}$/.test(str(v))
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

/** 用户字段白名单。绝不整条 user 下发 —— 表里有 token / mobile / password */
function publicUser(u) {
  const d = u || {}
  return {
    user_id: d._id,
    name: str(d.nickname) || '同学',
    avatar: str(d.avatar) || str(d.avatar_url),
    school: str(d.school) || str(d.school_name) || str(d.school_id),
    user_no: str(d.user_no),
    // 对外唯一身份号：搜索结果里唯一的「身份确认信息」
    uid: str(d.uid),
    verified: pickBool(d.is_verified, d.schoolVerified),
    credit: pickNum(d.credit_score, d.credit)
  }
}

/**
 * 头像 cloud:// fileID 换成可直接渲染的临时链接（口径同 post-list 的 resolveImageUrls）。
 * 换失败保留原值：头像白框不影响列表其余内容，抛出去会让整页 500。
 */
async function resolveAvatarUrls(list) {
  const ids = []
  const push = (u) => {
    if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
  }
  for (let i = 0; i < list.length; i++) {
    if (list[i]) push(list[i].avatar_url)
  }
  if (!ids.length) return
  try {
    const res = await uniCloud.getTempFileURL({ fileList: ids })
    const fl = (res && res.fileList) || []
    const map = {}
    for (let i = 0; i < fl.length; i++) {
      if (fl[i] && fl[i].tempFileURL) map[fl[i].fileID] = fl[i].tempFileURL
    }
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      if (it && map[it.avatar_url]) it.avatar_url = map[it.avatar_url]
    }
  } catch (e) {
    console.warn('[friend-search] getTempFileURL 失败，头像按原值返回', e && e.message)
  }
}


exports.main = async (event) => {
  event = event || {}
  try {
    const me = await getUserByToken(str(event.token))
    const kw = str(event.keyword)

    // 空关键字是合法调用（前端清空输入框），返回空结果而不是报错
    if (!kw) return { code: 0, msg: 'ok', data: { list: [], total: 0 } }

    // UID 没输满 8 位：不查库，让前端提示「输完才会搜」。
    // ★ 这里返回 need_uid 而不是报错，前端边输边调不会一路弹 toast。
    if (!isUid(kw)) {
      return { code: 0, msg: 'ok', data: { list: [], total: 0, need_uid: true } }
    }

    // uid 是对外的唯一索引（uni-id-users.idx_uid），等值命中，最多 1 条
    const res = await db
      .collection(DB_USERS)
      .where({ uid: kw })
      .field(USER_FIELDS)
      .limit(1)
      .get()

    const hit = (res.data || [])[0] || null

    // 搜到自己：返回 self 标记，前端提示「这是你自己的 UID」。
    // 不能只返回空列表 —— 那样页面会显示「没找到这个人」，等于告诉用户自己不存在。
    if (hit && hit._id === me._id) {
      return { code: 0, msg: 'ok', data: { list: [], total: 0, self: true } }
    }

    const hits = hit ? [hit] : []

    const ids = hits.map(function (u) {
      return u._id
    })

    // 好友关系分两次批量查（我作为 a / 我作为 b），不用 or：
    // or 里字段写反就会把陌生人当好友，界面直接给出错误的操作按钮
    const friendSet = {}
    if (ids.length) {
      const fa = await db
        .collection(DB_FRIENDS)
        .where({ user_a_id: me._id, user_b_id: dbCmd.in(ids) })
        .limit(SEARCH_LIMIT)
        .get()
      const fb = await db
        .collection(DB_FRIENDS)
        .where({ user_b_id: me._id, user_a_id: dbCmd.in(ids) })
        .limit(SEARCH_LIMIT)
        .get()
      ;(fa.data || []).concat(fb.data || []).forEach(function (r) {
        friendSet[r.user_a_id === me._id ? r.user_b_id : r.user_a_id] = true
      })
    }

    // 待处理申请也批量查：我发出去的、发给我的各一次
    const outSet = {}
    const inSet = {}
    if (ids.length) {
      const ro = await db
        .collection(DB_REQUESTS)
        .where({ from_user_id: me._id, to_user_id: dbCmd.in(ids), status: 'pending' })
        .limit(SEARCH_LIMIT)
        .get()
      ;(ro.data || []).forEach(function (r) {
        outSet[r.to_user_id] = true
      })
      const ri = await db
        .collection(DB_REQUESTS)
        .where({ to_user_id: me._id, from_user_id: dbCmd.in(ids), status: 'pending' })
        .limit(SEARCH_LIMIT)
        .get()
      ;(ri.data || []).forEach(function (r) {
        inSet[r.from_user_id] = true
      })
    }

    const list = hits.map(function (u) {
      const p = publicUser(u)
      let state = 'none'
      if (friendSet[u._id]) state = 'friend'
      else if (outSet[u._id]) state = 'out_pending'
      else if (inSet[u._id]) state = 'in_pending'
      return {
        user_id: p.user_id,
        // UID 是搜索键，结果里必须回显：用户靠它确认「搜到的就是这个人」
        uid: p.uid,
        name: p.name,
        avatar: p.avatar,
        avatar_url: p.avatar,
        school: p.school,
        user_no: p.user_no,
        verified: p.verified,
        credit: p.credit,
        is_friend: !!friendSet[u._id],
        request_state: state
      }
    })

    await resolveAvatarUrls(list)

    return { code: 0, msg: 'ok', data: { list, total: list.length } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '操作失败' }
  }
}
