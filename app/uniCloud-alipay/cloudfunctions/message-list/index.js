'use strict'

/**
 * 拉消息 —— 聊天记录 + 断线补拉（transport.js 里 fetchSince 调的就是它）
 *
 * 入参：{ token, conversationId, lastMessageId?, limit? }
 *   lastMessageId 为空 → 首次加载，取最近 N 条（倒序查再反转成升序）
 *   lastMessageId 有值 → 增量：只取比它新的，用于轮询 / 断线重连补拉
 * 出参：{ code, msg, data: [消息…] }（一律按 created_at 升序）
 *
 * ★ 为什么不能写成 `_id > lastMessageId`
 *   云数据库的 _id 是随机字符串，**不保证严格递增**（06 文档 §3.6 专门写了）。
 *   所以正确做法是：先用 lastMessageId 查出那条的 created_at，再按
 *   created_at 过滤。_id 只用来在结果里排除"起点那条自己"。
 *
 * ★ 权限：messages 集合的 client 权限全 false，只能通过云函数读。
 *   所以这里必须校验"我是这个会话的成员"，否则谁都能看别人聊天。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

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

/** 与会话里其他成员的昵称头像（聊天页顶栏要显示对方名字） */
async function fillSenders(list, meId) {
  const ids = []
  for (const m of list) {
    if (m.sender_id && ids.indexOf(m.sender_id) < 0) ids.push(m.sender_id)
  }
  if (!ids.length) return {}

  const res = await db
    .collection(DB_USERS)
    .where({ _id: dbCmd.in(ids) })
    .field({ _id: true, nickname: true, avatar: true })
    .get()

  const map = {}
  for (const u of res.data) map[u._id] = u
  return map
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))

    const conversationId = str(event.conversationId)
    if (!conversationId) fail('缺少 conversationId')

    let limit = parseInt(event.limit, 10)
    if (!limit || limit <= 0) limit = DEFAULT_LIMIT
    if (limit > MAX_LIMIT) limit = MAX_LIMIT

    // —— 必须是成员 ——
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId, user_id: me._id })
      .limit(1)
      .get()
    if (!memberRes.data.length) fail('你不在这个会话里', 403)
    const myMember = memberRes.data[0]

    const lastMessageId = str(event.lastMessageId)

    // —— 确定"从哪一刻开始取" ——
    let sinceTime = 0
    if (lastMessageId) {
      const anchor = await db.collection(DB_MESSAGES).doc(lastMessageId).get()
      if (anchor.data && anchor.data.length) {
        sinceTime = anchor.data[0].created_at || 0
      }
      // 起点查不到（被删了/传错）：退化成首次加载，取最近 limit 条，
      // 总比返回空列表让用户以为聊天记录没了强
    }

    let list = []

    if (sinceTime > 0) {
      // 增量：比起点新（含同一毫秒的）
      const res = await db
        .collection(DB_MESSAGES)
        .where({
          conversation_id: conversationId,
          created_at: dbCmd.gte(sinceTime)
        })
        .orderBy('created_at', 'asc')
        .limit(limit)
        .get()
      // ★ 不要把起点那条自己排除掉。
      //   客户端存的起点是"上次看到的最后一条"，如果这里把它过滤掉，
      //   而它又恰好是最后一条，第二次进聊天页就会拿到空数组 →
      //   页面显示「还没有消息」，但列表页还能看到最新消息（那边走别的查询）。
      //   重复的那条由页面按 _id / client_msg_id 去重，不会变成两条气泡。
      list = res.data
    } else {
      // 首次：倒序取最近 limit 条，再反转成升序给页面渲染
      const res = await db
        .collection(DB_MESSAGES)
        .where({ conversation_id: conversationId })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .get()
      list = res.data.reverse()
    }

    // —— 补发送者信息（一次批量查，不做 N+1）——
    const senderMap = await fillSenders(list, me._id)
    const out = list.map(function (m) {
      const u = senderMap[m.sender_id] || {}
      return {
        _id: m._id,
        conversation_id: m.conversation_id,
        sender_id: m.sender_id,
        sender_name: u.nickname || '同学',
        sender_avatar: u.avatar || '',
        type: m.type || 'text',
        content: m.content,
        client_msg_id: m.client_msg_id || '',
        created_at: m.created_at,
        is_me: m.sender_id === me._id
      }
    })

    // —— 顺手把"我"的未读清掉（进了聊天页就已经在看了）——
    // 放在这里而不是单独一个云函数：进页面必然先拉消息，一次请求搞定。
    if (myMember.unread_count) {
      await db.collection(DB_MEMBERS).doc(myMember._id).update({
        unread_count: 0,
        last_read_message_id: out.length ? out[out.length - 1]._id : myMember.last_read_message_id
      })
    } else if (out.length) {
      await db.collection(DB_MEMBERS).doc(myMember._id).update({
        last_read_message_id: out[out.length - 1]._id
      })
    }

    return { code: 0, msg: 'ok', data: out }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '加载失败' }
  }
}
