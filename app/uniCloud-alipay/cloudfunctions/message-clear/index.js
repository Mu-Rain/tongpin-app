'use strict'

/**
 * 清空聊天记录（只清我这一侧）—— 消息页长按会话 →「清空聊天记录」
 *
 * 入参：{ token, conversation_id }
 * 出参：{ code, msg, data: { conversation_id, cleared_at } }
 * 错误码：403「你不在这个会话里」
 *
 * ★ 为什么不是「删消息」而是「记一个时间点」：
 *   产品决定 D5 —— 清空只清我这一侧，不影响对方。
 *   消息是一对人共享的一行文档，物理删了对方也就没了；
 *   复制一份「我的消息」又是另一套数据要同步。
 *   所以正确做法是在 conversation_members（每人一行）上记 cleared_at，
 *   所有读取路径带 created_at > cleared_at 过滤（契约 4.2 / 3.6）。
 *   message-list / message-search 都已经按这个规则过滤。
 *
 * ★ 为什么顺手把 unread_count 置 0：
 *   清空之后我这一侧一条历史消息都不该再出现，未读角标却还挂着数字，
 *   用户会点进来看不到任何新消息 —— 角标成了删不掉的红点。
 *   这和「已读」是两件事：已读推的是 last_read_message_id 游标，
 *   清空推的是 cleared_at 时间点，两个字段各管一段，别合并。
 *
 * ★ 为什么不删 conversations 行、不删 conversation_members 行：
 *   会话是两个人的，我「清空聊天记录」后对方还要能继续发消息；
 *   我这一行删了，message-send 找不到我的成员行就加不了未读数，
 *   而且再发消息时还要重建，逻辑分支多一倍。留行 + cleared_at 最省事。
 */

const db = uniCloud.database()

const DB_MEMBERS = 'conversation_members'

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
  const r = await db.collection('uni-id-users').where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

exports.main = async (event) => {
  try {
    event = event || {}
    const me = await getUserByToken(str(event.token))

    const conversationId = str(event.conversation_id)
    if (!conversationId) fail('缺少 conversation_id', 400)

    // —— 1) 必须是我自己的成员行 ——
    // 条件里同时带 user_id: me._id：只按 conversation_id 查会拿到
    // 对方那一行，把 cleared_at 写到别人头上 —— 那就成了「我删了对方的记录」，
    // 直接违反 D5。
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId, user_id: me._id })
      .limit(1)
      .get()
    if (!memberRes.data.length) fail('你不在这个会话里', 403)

    // —— 2) 记时间点 + 清未读 ——
    const now = Date.now()
    await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId, user_id: me._id })
      .update({ cleared_at: now, unread_count: 0, updated_at: now })

    return { code: 0, msg: 'ok', data: { conversation_id: conversationId, cleared_at: now } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '清空失败' }
  }
}
