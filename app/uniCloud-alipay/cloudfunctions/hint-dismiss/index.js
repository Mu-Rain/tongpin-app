'use strict'

/**
 * 关闭一条 AI 情绪提示 —— 落库，之后 message-list 不再返回它
 *
 * 入参：{ token, message_id }
 * 出参：{ code, msg, data: { dismissed: true } }
 *
 * 为什么必须落库（30 文档 §P0-4）：
 *   只在前端移除，用户下次进来同一条提示又冒出来，会觉得「这个 App 在反复试探我」——
 *   情绪陪伴类产品最忌讳这个。
 *
 * 关闭是打在消息自己身上的标记（dismissed + dismissed_at/by），不删文档：
 *   删了就没法排查「到底推过没有」，而且消息表是聊天记录，物理删除是另一种错。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'

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
  const me = r.data[0]
  if (me.status === 'banned') fail('账号已被封禁', 403)
  return me
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))

    const messageId = str(event.message_id) || str(event.messageId)
    if (!messageId) fail('缺少消息 id')

    const msgRes = await db.collection(DB_MESSAGES).doc(messageId).get()
    const msg = (msgRes.data && msgRes.data[0]) || null
    if (!msg) fail('这条提示找不到了')
    if (str(msg.type) !== 'ai-hint') fail('这条消息不是 AI 提示')

    // —— 只能关自己会话里的提示 ——
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: str(msg.conversation_id), user_id: me._id })
      .limit(1)
      .get()
    if (!memberRes.data.length) fail('你不在这个会话里', 403)

    // 已经关过就直接成功（客户端重复点/重发都不该报错）
    if (msg.dismissed === true) {
      return { code: 0, msg: 'ok（已经关过了）', data: { dismissed: true } }
    }

    await db.collection(DB_MESSAGES).doc(messageId).update({
      dismissed: true,
      dismissed_at: Date.now(),
      dismissed_by: me._id
    })

    return { code: 0, msg: 'ok', data: { dismissed: true } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '关闭失败' }
  }
}
