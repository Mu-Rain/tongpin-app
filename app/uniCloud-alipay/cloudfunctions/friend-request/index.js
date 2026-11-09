'use strict'

/**
 * 好友申请 —— 发送 / 列表 / 同意 / 拒绝 / 取消（US-26）
 *
 * 入参：
 *   action = 'send'   { token, to_user_id, source: 'buddy' | 'search' }
 *   action = 'list'   { token, box: 'in' | 'out' }   box 默认 'in'
 *   action = 'accept' { token, request_id }
 *   action = 'reject' { token, request_id }
 *   action = 'cancel' { token, request_id }
 *   action = 'status' { token, request_ids: string[] }  // 最多 50 个
 * 出参统一 { code, msg, data }
 *
 * 为什么四个 action 挤一个函数：它们改的都是 friend_requests 这一张表，
 * 而且共享同一套「谁有权改这一行」的校验；拆成四个函数要把校验复制四遍，
 * 将来改一条规则就得改四处，必漏（card-apply 就是这么合在一起的）。
 *
 * ★ 好友关系与搭子关系是两套东西：
 *   friendships  = 加了好友（社交基础，一对一，全局唯一）
 *   buddy_relations = 因为什么成了搭子（可以有多个 category，可结束）
 *   所以「同意好友申请」的连锁动作里有一条：把两人之间还活着的搭子关系
 *   全部 ended_by='friend' 收掉 —— 已经是好友了，再挂一堆搭子关系
 *   只会在「我的搭子」页出现一堆死条目。
 *
 * ★ friendships 约定 user_a_id < user_b_id（字符串比较），
 *   否则同一对会存出两条镜像，好友列表就出现两个同一个人。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_FRIENDS = 'friendships'
const DB_REQUESTS = 'friend_requests'
const DB_RELATIONS = 'buddy_relations'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'

// 好友数量很小，一次取完；分页只会让「待处理角标」这种全量信息失真
const LIST_LIMIT = 100
// 聊天页一次最多问 50 条卡片的状态，超出部分下一轮轮询再问
const STATUS_LIMIT = 50

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
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

/** 两个人的固定键：字符串小的在前。两个人只对应一个会话，键就必须唯一 */
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
 * 用户字段白名单。
 * 只挑这几个字段下发，绝不整条 user 直接 return ——
 * 用户表里有 token / mobile / password，漏一个就是事故。
 * 每个字段都做兜底，因为老数据两套命名并存（profile 改版前是 school_name/avatar_url）。
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

/** 批量取用户，一次 in 查完，不在循环里逐个查库 */
async function usersByIds(ids) {
  const map = {}
  if (!ids.length) return map
  const r = await db
    .collection(DB_USERS)
    .where({ _id: dbCmd.in(ids) })
    .field(USER_FIELDS)
    .get()
  for (const u of r.data) map[u._id] = u
  return map
}

/**
 * 找或建两人之间的 direct 会话，并往里写一条好友申请卡片消息，返回会话 id。
 *
 * 范式照抄 card-apply：判重键是 user_pair_key ——
 * 会话是「两个人之间的聊天室」，不是「某一段关系的聊天室」，
 * 按关系判重会给同一对人建出好几个聊天室，消息列表出现重复条目。
 *
 * ★ 任何一步失败都直接抛出去，由调用方 try/catch 吞掉：
 *   申请行已经写成功了，丢一张卡片不能反过来把申请也判失败。
 */
async function ensureFriendRequestCard(meId, toId, requestId, now) {
  const pair = orderPair(meId, toId)
  const ua = pair[0]
  const ub = pair[1]
  const key = pairKey(meId, toId)

  const existConv = await db
    .collection(DB_CONVERSATIONS)
    .where({ user_pair_key: key, type: 'direct' })
    .limit(1)
    .get()

  let convId = ''
  if (existConv.data.length) {
    convId = existConv.data[0]._id
  } else {
    const convRes = await db.collection(DB_CONVERSATIONS).add({
      type: 'direct',
      user_pair_key: key,
      user_a_id: ua,
      user_b_id: ub,
      // 兼容老字段：新逻辑按 user_pair_key 找人，这两个字段留空
      buddy_relation_id: '',
      last_message_id: '',
      last_message_at: now,
      created_at: now,
      updated_at: now
    })
    convId = convRes.id
    for (const uid of [ua, ub]) {
      await db.collection(DB_MEMBERS).add({
        conversation_id: convId,
        user_id: uid,
        unread_count: 0,
        last_read_message_id: ''
      })
    }
  }

  // 卡片消息和普通消息一样参与排序/分页/轮询增量，所以新消息会把它冲走 —— 这正是要的
  const msgRes = await db.collection(DB_MESSAGES).add({
    conversation_id: convId,
    sender_id: meId,
    type: 'friend_request',
    content: JSON.stringify({ request_id: requestId }),
    client_msg_id: 'fr_' + requestId,
    created_at: now
  })

  // 摘要字段必须和 message-send 写齐（id / text / sender_id / at / updated_at）：
  // 会话列表只读 last_message_text，漏了就会出现「时间跳到最新、预览还是旧文字」。
  await db.collection(DB_CONVERSATIONS).doc(convId).update({
    last_message_id: msgRes.id,
    last_message_text: '[好友申请]',
    last_message_sender_id: meId,
    last_message_at: now,
    updated_at: now
  })

  return convId
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
    console.warn('[friend-request] getTempFileURL 失败，头像按原值返回', e && e.message)
  }
}


exports.main = async (event) => {
  event = event || {}
  try {
    const action = str(event.action) || 'send'
    const me = await getUserByToken(str(event.token))

    // ============================================================
    // 发送申请
    // ============================================================
    if (action === 'send') {
      const toId = str(event.to_user_id)
      if (!toId) fail('缺少 to_user_id')
      if (toId === me._id) fail('不能加自己为好友')

      // 对方必须真实存在，否则会写出一条永远没人处理的幽灵申请
      const toRes = await db.collection(DB_USERS).where({ _id: toId }).limit(1).get()
      if (!toRes.data.length) fail('找不到这个用户')

      // source 只是埋点用的来源标记，非法值按 search 记，不因此拒绝用户
      const rawSource = str(event.source)
      const source = rawSource === 'buddy' ? 'buddy' : 'search'

      const pair = orderPair(me._id, toId)
      const ua = pair[0]
      const ub = pair[1]

      const already = await db
        .collection(DB_FRIENDS)
        .where({ user_a_id: ua, user_b_id: ub })
        .limit(1)
        .get()
      if (already.data.length) fail('你们已经是好友了')

      const mine = await db
        .collection(DB_REQUESTS)
        .where({ from_user_id: me._id, to_user_id: toId, status: 'pending' })
        .count()
      if (mine.total > 0) fail('你已经发过申请了，等对方处理')

      // 对方先申请了，我就别再造一条反向申请 —— 否则两条 pending 互相同意时
      // 会各建一次 friendship，界面上出现两个入口
      const theirs = await db
        .collection(DB_REQUESTS)
        .where({ from_user_id: toId, to_user_id: me._id, status: 'pending' })
        .count()
      if (theirs.total > 0) fail('对方已经申请加你，去「待处理」里同意就行')

      const now = Date.now()
      const addRes = await db.collection(DB_REQUESTS).add({
        from_user_id: me._id,
        to_user_id: toId,
        source,
        status: 'pending',
        created_at: now,
        handled_at: 0
      })
      const requestId = addRes.id

      // 申请要在聊天里留下一条卡片消息（不是置顶系统通知：会被新消息冲走）。
      // ★ 这里失败不能让整个申请失败 —— 申请行已经落库，用户仍能从「待处理」处理。
      let conversationId = ''
      try {
        conversationId = await ensureFriendRequestCard(me._id, toId, requestId, now)
      } catch (e) {
        console.log('friend-request: 写申请卡片消息失败', e && e.message)
      }

      return { code: 0, msg: 'ok', data: { request_id: requestId, conversation_id: conversationId } }
    }

    // ============================================================
    // 待处理 / 已发出
    // ============================================================
    if (action === 'list') {
      const box = str(event.box) === 'out' ? 'out' : 'in'
      // 只列 pending：被拒/已取消的历史申请对用户没有价值，
      // 真正需要「谁加了我、我加了谁」的场景只有待处理这一屏
      const cond =
        box === 'in'
          ? { to_user_id: me._id, status: 'pending' }
          : { from_user_id: me._id, status: 'pending' }

      const res = await db
        .collection(DB_REQUESTS)
        .where(cond)
        .orderBy('created_at', 'desc')
        .limit(LIST_LIMIT)
        .get()

      const rows = res.data || []
      const otherIds = []
      rows.forEach(function (r) {
        const oid = box === 'in' ? r.from_user_id : r.to_user_id
        if (oid && otherIds.indexOf(oid) < 0) otherIds.push(oid)
      })
      const userMap = await usersByIds(otherIds)

      const list = rows.map(function (r) {
        const oid = box === 'in' ? r.from_user_id : r.to_user_id
        const p = publicUser(userMap[oid])
        return {
          request_id: r._id,
          user_id: p.user_id,
          name: p.name,
          avatar: p.avatar,
          avatar_url: p.avatar,
          school: p.school,
          user_no: p.user_no,
          verified: p.verified,
          credit: p.credit,
          source: str(r.source) || 'search',
          created_at: typeof r.created_at === 'number' ? r.created_at : 0
        }
      })

      await resolveAvatarUrls(list)

      return { code: 0, msg: 'ok', data: { list, total: list.length } }
    }

    // ============================================================
    // 同意
    // ============================================================
    if (action === 'accept') {
      const reqId = str(event.request_id)
      if (!reqId) fail('缺少 request_id')

      const reqRes = await db.collection(DB_REQUESTS).doc(reqId).get()
      if (!reqRes.data || !reqRes.data.length) fail('申请不存在', 404)
      const req = reqRes.data[0]

      // 先判权限再判状态：不是发给我的申请，我不该知道它处理没处理过
      if (req.to_user_id !== me._id) fail('这不是发给你的申请', 403)
      if (req.status !== 'pending') fail('这条申请已经处理过了')

      const otherId = req.from_user_id
      const pair = orderPair(me._id, otherId)
      const ua = pair[0]
      const ub = pair[1]
      const now = Date.now()

      // 1) 好友关系：已存在就复用，保证重复调用不会建出第二条
      const existFriend = await db
        .collection(DB_FRIENDS)
        .where({ user_a_id: ua, user_b_id: ub })
        .limit(1)
        .get()
      let friendshipId = ''
      if (existFriend.data.length) {
        friendshipId = existFriend.data[0]._id
      } else {
        const addFriend = await db.collection(DB_FRIENDS).add({
          user_a_id: ua,
          user_b_id: ub,
          created_at: now
        })
        friendshipId = addFriend.id
      }

      // 2) 收掉两人之间还活着的搭子关系。
      //    分两次查（我作为 a / 我作为 b），不用 or：
      //    or 里一旦把 a/b 写反，查出来的是别人之间的关系，会误伤无关关系。
      const relAsA = await db
        .collection(DB_RELATIONS)
        .where({ user_a_id: me._id, user_b_id: otherId, status: 'active' })
        .get()
      const relAsB = await db
        .collection(DB_RELATIONS)
        .where({ user_b_id: me._id, user_a_id: otherId, status: 'active' })
        .get()

      const relIds = []
      ;(relAsA.data || []).concat(relAsB.data || []).forEach(function (r) {
        if (relIds.indexOf(r._id) < 0) relIds.push(r._id)
      })
      for (const rid of relIds) {
        await db.collection(DB_RELATIONS).doc(rid).update({
          status: 'ended',
          ended_by: 'friend',
          ended_at: now,
          update_time: now
        })
      }

      // 3) 会话：按 user_pair_key 判重。会话认「两个人」，不认「某段关系」，
      //    所以已是好友时直接复用已有的聊天室，不会再冒出一个新的。
      const key = pairKey(me._id, otherId)
      const existConv = await db
        .collection(DB_CONVERSATIONS)
        .where({ user_pair_key: key, type: 'direct' })
        .limit(1)
        .get()

      let conversationId = ''
      if (existConv.data.length) {
        conversationId = existConv.data[0]._id
      } else {
        const convRes = await db.collection(DB_CONVERSATIONS).add({
          type: 'direct',
          user_pair_key: key,
          user_a_id: ua,
          user_b_id: ub,
          // 兼容老字段：新逻辑按 user_pair_key 找人，这两个字段留空
          buddy_relation_id: '',
          last_message_id: '',
          last_message_at: now,
          created_at: now,
          updated_at: now
        })
        conversationId = convRes.id
        for (const uid of [ua, ub]) {
          await db.collection(DB_MEMBERS).add({
            conversation_id: conversationId,
            user_id: uid,
            unread_count: 0,
            last_read_message_id: ''
          })
        }
      }

      // 4) 申请落状态。放最后：前面任何一步抛错，申请都还是 pending，用户能重试
      await db.collection(DB_REQUESTS).doc(reqId).update({
        status: 'accepted',
        handled_at: now
      })

      return {
        code: 0,
        msg: 'ok',
        data: { friendship_id: friendshipId, conversation_id: conversationId }
      }
    }

    // ============================================================
    // 拒绝 / 取消
    // ============================================================
    if (action === 'reject' || action === 'cancel') {
      const reqId = str(event.request_id)
      if (!reqId) fail('缺少 request_id')

      const reqRes = await db.collection(DB_REQUESTS).doc(reqId).get()
      if (!reqRes.data || !reqRes.data.length) fail('申请不存在', 404)
      const req = reqRes.data[0]

      if (action === 'reject' && req.to_user_id !== me._id) {
        fail('这不是发给你的申请', 403)
      }
      if (action === 'cancel' && req.from_user_id !== me._id) {
        fail('只能撤回自己的申请', 403)
      }
      if (req.status !== 'pending') fail('这条申请已经处理过了')

      await db.collection(DB_REQUESTS).doc(reqId).update({
        status: action === 'reject' ? 'rejected' : 'canceled',
        handled_at: Date.now()
      })

      return { code: 0, msg: 'ok', data: {} }
    }

    // ============================================================
    // 批量查状态（聊天页刷新好友申请卡片用）
    // ============================================================
    // 为什么需要它：卡片消息本身不会再变，transport 的增量轮询只拉
    // 「比 lastMessageId 更新的消息」，早就加载过的那条永远不会重新拉一次。
    // 所以「对方同意了」这件事只能靠这个接口主动问，否则发申请的人
    // 会永远停在「等待对方同意」，只能退出重进才看到。
    if (action === 'status') {
      const raw = event.request_ids
      if (!Array.isArray(raw) || !raw.length) fail('缺少 request_ids')

      // 去重 + 丢掉非字符串/空串 + 截断到 50：一次轮询最多问 50 个，
      // 不设上限的话一个攒了几百条卡片的会话能把请求撑爆
      const ids = []
      for (const v of raw) {
        const id = str(v)
        if (!id) continue
        if (ids.indexOf(id) > -1) continue
        ids.push(id)
        if (ids.length >= STATUS_LIMIT) break
      }
      if (!ids.length) fail('缺少 request_ids')

      const map = {}
      try {
        const res = await db
          .collection(DB_REQUESTS)
          .where({ _id: dbCmd.in(ids) })
          .limit(ids.length)
          .get()
        for (const r of res.data || []) {
          // 只返回我参与的申请：别人之间的申请状态不该被我看到
          if (r.from_user_id !== me._id && r.to_user_id !== me._id) continue
          map[r._id] = {
            status: str(r.status),
            from_user_id: str(r.from_user_id),
            to_user_id: str(r.to_user_id)
          }
        }
      } catch (e) {
        // 查失败按「查不到」处理：调用方会把卡片降级成 gone，
        // 而不是让整个聊天页因为一次状态刷新报错
        return { code: 0, msg: 'ok', data: { map: {} } }
      }

      return { code: 0, msg: 'ok', data: { map } }
    }

    fail('不认识的动作：' + action)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '操作失败' }
  }
}
