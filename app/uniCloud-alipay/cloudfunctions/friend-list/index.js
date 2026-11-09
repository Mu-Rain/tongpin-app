'use strict'

/**
 * 好友列表 —— 好友页（US-27）
 *
 * 入参：{ token, action: 'list' }
 * 出参：{ code, msg, data: { list: [...], total, pending_count } }
 *
 * list 每项：{ user_id, name, avatar, school, user_no, verified, credit, conversation_id, since }
 *   since          = friendships.created_at（什么时候成为好友的）
 *   conversation_id= 按 user_pair_key 查到的 direct 会话；查不到给空串，
 *                    前端据此显示「还没有聊过」而不是崩掉
 * pending_count    = 有多少条 pending 申请是发给我的，好友页的「待处理 N」角标
 *
 * ★ friendships 约定 user_a_id < user_b_id，所以「我是 a 还是 b」必须逐条判断，
 *   不能假设自己是 a。
 * ★ 查我参与的关系分两次（a 侧、b 侧）而不是 or：
 *   or 的字段一旦写反，查出来的是不相干的关系，好友列表会混进陌生人。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_FRIENDS = 'friendships'
const DB_REQUESTS = 'friend_requests'
const DB_CONVERSATIONS = 'conversations'
const DB_REMARKS = 'user_remarks'

// 好友数量很小，一次取完
const LIST_LIMIT = 100

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

/** 字符串小的在前 —— friendships 表约定 user_a_id < user_b_id，否则同一对会存出两条镜像 */
function orderPair(x, y) {
  return x < y ? [x, y] : [y, x]
}

function pairKey(x, y) {
  return x < y ? x + '|' + y : y + '|' + x
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

/**
 * 用户字段白名单。绝不整条 user 下发 —— 表里有 token / mobile / password。
 * 每个字段都做兜底，因为老数据两套命名并存（school/school_name/school_id、avatar/avatar_url）。
 */
function publicUser(u) {
  const d = u || {}
  return {
    user_id: d._id,
    name: str(d.nickname) || '同学',
    avatar: str(d.avatar) || str(d.avatar_url),
    school: str(d.school) || str(d.school_name) || str(d.school_id),
    user_no: str(d.user_no),
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
    console.warn('[friend-list] getTempFileURL 失败，头像按原值返回', e && e.message)
  }
}


exports.main = async (event) => {
  event = event || {}
  try {
    const action = str(event.action) || 'list'
    const me = await getUserByToken(str(event.token))

    if (action !== 'list') fail('不认识的动作：' + action)

    // 1) 我参与的好友关系：分两次查，a 侧 + b 侧
    const asA = await db
      .collection(DB_FRIENDS)
      .where({ user_a_id: me._id })
      .limit(LIST_LIMIT)
      .get()
    const asB = await db
      .collection(DB_FRIENDS)
      .where({ user_b_id: me._id })
      .limit(LIST_LIMIT)
      .get()

    const rows = (asA.data || []).concat(asB.data || [])

    // 2) 对方 id 去重（理论上不会重复，去重是因为建表时没有联合唯一索引兜底）
    const otherIds = []
    rows.forEach(function (r) {
      const oid = r.user_a_id === me._id ? r.user_b_id : r.user_a_id
      if (oid && otherIds.indexOf(oid) < 0) otherIds.push(oid)
    })

    // 3) 批量取用户 + 批量取会话，都不在 for 循环里逐个查库
    const userMap = {}
    if (otherIds.length) {
      const uRes = await db
        .collection(DB_USERS)
        .where({ _id: dbCmd.in(otherIds) })
        .field(USER_FIELDS)
        .get()
      for (const u of uRes.data) userMap[u._id] = u
    }

    // 3.5) 用户备注：我给这些好友各起过什么名字
    // ★ 整段 try/catch：user_remarks 是新集合，可能还没建（第一次写入才自动创建）。
    //   查询失败降级成"全部没有备注"，好友列表照常显示。
    const remarkMap = {}
    try {
      if (otherIds.length) {
        const rRes = await db
          .collection(DB_REMARKS)
          .where({ owner_id: me._id, target_user_id: dbCmd.in(otherIds) })
          .limit(LIST_LIMIT)
          .get()
        for (const row of rRes.data) {
          const t = str(row.target_user_id)
          const text = str(row.remark)
          if (t && text) remarkMap[t] = text
        }
      }
    } catch (e) {
      /* 表不存在 / 查询报错：静默降级，一行都不影响 */
    }

    const keys = otherIds.map(function (oid) {
      return pairKey(me._id, oid)
    })
    const convByKey = {}
    if (keys.length) {
      const cRes = await db
        .collection(DB_CONVERSATIONS)
        .where({ user_pair_key: dbCmd.in(keys), type: 'direct' })
        .limit(LIST_LIMIT)
        .get()
      for (const c of cRes.data) {
        if (c.user_pair_key && !convByKey[c.user_pair_key]) {
          convByKey[c.user_pair_key] = c._id
        }
      }
    }

    // 4) 组装 + 按 since 倒序（最近加的好友排最前）
    const list = rows.map(function (r) {
      const oid = r.user_a_id === me._id ? r.user_b_id : r.user_a_id
      const p = publicUser(userMap[oid])
      return {
        user_id: oid,
        name: p.name,
        // 我给这个人起的备注（没有就是空串）
        remark: remarkMap[oid] || '',
        avatar: p.avatar,
        avatar_url: p.avatar,
        school: p.school,
        user_no: p.user_no,
        verified: p.verified,
        credit: p.credit,
        conversation_id: convByKey[pairKey(me._id, oid)] || '',
        since: typeof r.created_at === 'number' ? r.created_at : 0
      }
    })
    list.sort(function (a, b) {
      return b.since - a.since
    })
    await resolveAvatarUrls(list)

    // 5) 待处理角标：只数「发给我的」pending，我发出去的不算（那是别人的待办）
    const pend = await db
      .collection(DB_REQUESTS)
      .where({ to_user_id: me._id, status: 'pending' })
      .count()

    return {
      code: 0,
      msg: 'ok',
      data: { list, total: list.length, pending_count: pend.total || 0 }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '操作失败' }
  }
}
