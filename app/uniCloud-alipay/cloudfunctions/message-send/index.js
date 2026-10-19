'use strict'

/**
 * 发消息 —— 落库 + 按 clientMsgId 去重 + 更新未读数 + 推进会话摘要
 *
 * 入参：{ token, conversationId, type: 'text'|'image', content, clientMsgId }
 *   type=text  → content 是文字（1~500 字）
 *   type=image → content 是云存储 fileID（上传在客户端做，见 05 文档）
 * 出参：{ code, msg, data: 消息对象 }
 *
 * 设计要点（对应 dazi-app/docs/06-chat-transport.md §3.5 / §3.8）：
 *   1. clientMsgId 判重：同一个 id 已存在就直接返回老那条，不重复写入。
 *      → 这样"发送失败可以放心重发"，服务端不会存两条。
 *   2. 未读数放在 conversation_members 上自增，不去 count messages
 *      （几十个会话每次都遍历消息表会卡）。
 *   3. 超过 30 天没说话就自动关会话 —— MVP 不做，这里只加注释。
 *   4. uni-push 离线推送见 §3.7，M3 再接；现在只写站内通知表。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'
const DB_NOTIFICATIONS = 'notifications'

const MAX_TEXT = 500
const TYPE_ENUM = ['text', 'image']

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

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))

    const conversationId = str(event.conversationId)
    if (!conversationId) fail('缺少 conversationId')

    const type = str(event.type) || 'text'
    if (TYPE_ENUM.indexOf(type) < 0) fail('不支持的消息类型：' + type)

    const content = str(event.content)
    if (!content) fail(type === 'image' ? '图片没传上来' : '消息不能为空')
    if (type === 'text' && content.length > MAX_TEXT) {
      fail('消息最多 ' + MAX_TEXT + ' 字')
    }

    const clientMsgId = str(event.clientMsgId)

    // —— 必须是会话成员才能发 ——
    // 注意：members 里找 "我" 这一行，找不到就说明不是成员
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId, user_id: me._id })
      .limit(1)
      .get()
    if (!memberRes.data.length) fail('你不在这个会话里', 403)
    const myMember = memberRes.data[0]

    // —— clientMsgId 判重：已存在就返回老那条（重发不产生两条）——
    if (clientMsgId) {
      const dup = await db
        .collection(DB_MESSAGES)
        .where({ conversation_id: conversationId, client_msg_id: clientMsgId })
        .limit(1)
        .get()
      if (dup.data.length) {
        return { code: 0, msg: 'ok（已存在，未重复写入）', data: dup.data[0] }
      }
    }

    const now = Date.now()

    // —— 1) 写入消息 ——
    // created_at 用服务端时间，绝不用客户端时间（用户手机时间可能不准）
    const addRes = await db.collection(DB_MESSAGES).add({
      conversation_id: conversationId,
      sender_id: me._id,
      type,
      content,
      client_msg_id: clientMsgId,
      created_at: now
    })
    const messageId = addRes.id

    // —— 2) 给"对方"的所有成员未读 +1 ——
    // 自己那一行不 +1（自己在看），并且顺手把 last_read 推到这条，
    // 免得到时候自己给自己冒红点。
    const allMembers = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId })
      .get()

    for (const m of allMembers.data) {
      if (m.user_id === me._id) {
        await db.collection(DB_MEMBERS).doc(m._id).update({
          unread_count: 0,
          last_read_message_id: messageId
        })
      } else {
        const cur = typeof m.unread_count === 'number' ? m.unread_count : 0
        await db.collection(DB_MEMBERS).doc(m._id).update({
          unread_count: cur + 1
        })
        // 站内通知（uni-push 离线推送 M3 再接，见 06 文档 §3.7）
        // 通知只做提醒，不带聊天内容（隐私）
        try {
          await db.collection(DB_NOTIFICATIONS).add({
            user_id: m.user_id,
            type: 'message',
            title: '你有一条新消息',
            content: '',
            ref_id: conversationId,
            is_read: false,
            created_at: now
          })
        } catch (e) {
          /* 通知失败不该让消息发送失败 */
        }
      }
    }

    // —— 3) 推进会话摘要（消息页列表要显示"最后一条说了啥"）——
    // 存摘要而不是每次去 messages 查最后一条：列表页几十个会话，
    // 每个都查一次 messages 就是 N+1。
    const preview = type === 'image' ? '[图片]' : content.slice(0, 60)
    await db.collection(DB_CONVERSATIONS).doc(conversationId).update({
      last_message_id: messageId,
      last_message_text: preview,
      last_message_sender_id: me._id,
      last_message_at: now,
      updated_at: now
    })

    return {
      code: 0,
      msg: 'ok',
      data: {
        _id: messageId,
        conversation_id: conversationId,
        sender_id: me._id,
        type,
        content,
        client_msg_id: clientMsgId,
        created_at: now
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '发送失败' }
  }
}
