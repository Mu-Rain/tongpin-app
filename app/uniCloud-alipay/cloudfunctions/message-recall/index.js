'use strict'

/**
 * 撤回消息 —— 聊天页长按气泡 →「撤回」
 *
 * 入参：{ token, message_id }
 * 出参：{ code, msg, data: { message_id, recalled: true, recalled_at } }
 *
 * 错误码：
 *   404 「消息不存在」        消息被物理删了 / id 传错
 *   403 「只能撤回自己的消息」 不是发送者
 *   403 「你不在这个会话里」   不是会话成员
 *   400 「超过 2 分钟，不能撤回了」
 *   已撤回再调 → code:0 幂等返回（不报错）
 *
 * ★ 撤回**不物理删除**，也不清空 content。
 *   留证据：举报 / 审核 / 纠纷的时候要能看到原文，
 *   只是 message-list 在下发时把 content 换成空串（契约 4.2）。
 *   所以这里只写三个标记字段，一条消息的原始字节一个都不动。
 *
 * ★ 为什么窗口判断放在「已撤回」之后：
 *   幂等优先。用户手抖点了两次，第二次已经过了 2 分钟，
 *   这时候回「超过 2 分钟」是错的 —— 他明明撤成功了。
 *
 * ★ 为什么还要同步 conversations.last_message_text：
 *   会话列表只读 conversations 上的预览文本（message-conversations 第 275 行），
 *   不回头查 messages。改了消息不回写，就会出现
 *   「消息区显示已撤回、消息页预览还是原文」这种自相矛盾的界面。
 *   只在这条正好是 last_message 时才改 —— 撤的是历史消息就什么都不用做。
 */

const db = uniCloud.database()

const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'

// 撤回窗口 2 分钟（产品决定 D4，与微信/QQ 同量级）
const RECALL_WINDOW_MS = 120000
// 撤回后会话列表的预览文本
const RECALLED_PREVIEW = '[消息已撤回]'

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

    const messageId = str(event.message_id)
    if (!messageId) fail('缺少 message_id', 400)

    // —— 1) 取消息 ——
    // doc() 查不到时不同版本返回 data:[] 或抛错，两种都当 404，不要漏。
    let msg = null
    try {
      const r = await db.collection(DB_MESSAGES).doc(messageId).get()
      if (r && r.data && r.data.length) msg = r.data[0]
    } catch (e) {
      msg = null
    }
    if (!msg) fail('消息不存在', 404)

    // —— 2) 只能撤回自己发的 ——
    if (str(msg.sender_id) !== me._id) fail('只能撤回自己的消息', 403)

    // —— 3) 必须是会话成员 ——
    // 消息的 sender 是自己就一定是成员吗？不一定：被移出群/会话后
    // 老消息还挂在库里。所以仍然显式校验一次。
    const conversationId = str(msg.conversation_id)
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId, user_id: me._id })
      .limit(1)
      .get()
    if (!memberRes.data.length) fail('你不在这个会话里', 403)

    // —— 4) 已撤回 → 幂等返回（放在窗口判断之前，见文件头注释）——
    if (msg.recalled === true) {
      return {
        code: 0,
        msg: 'ok',
        data: {
          message_id: messageId,
          recalled: true,
          recalled_at: typeof msg.recalled_at === 'number' ? msg.recalled_at : 0
        }
      }
    }

    // —— 5) 2 分钟窗口 ——
    // 用服务端时间戳比，不用客户端时间（手机时间可能不准）。
    // 没有 created_at 的脏数据：按「不能撤回」处理，宁可保守。
    const createdAt = typeof msg.created_at === 'number' ? msg.created_at : 0
    const now = Date.now()
    if (!createdAt || now - createdAt > RECALL_WINDOW_MS) {
      fail('超过 2 分钟，不能撤回了', 400)
    }

    // —— 6) 打标记（不删、不清 content）——
    await db.collection(DB_MESSAGES).doc(messageId).update({
      recalled: true,
      recalled_at: now,
      recalled_by: me._id
    })

    // —— 7) 会话列表预览同步 ——
    // ★ 整段 try/catch：撤回本身已经成功了，预览没同步上是小瑕疵
    //   （用户下次发消息就会盖掉），不能让接口回 500 让用户以为没撤成。
    try {
      if (conversationId) {
        const convRes = await db.collection(DB_CONVERSATIONS).doc(conversationId).get()
        const conv = convRes && convRes.data && convRes.data.length ? convRes.data[0] : null
        if (conv && str(conv.last_message_id) === messageId) {
          await db
            .collection(DB_CONVERSATIONS)
            .doc(conversationId)
            .update({ last_message_text: RECALLED_PREVIEW, updated_at: now })
        }
      }
    } catch (e) {
      /* 会话表查不到 / 写失败：消息已经撤回，忽略 */
    }

    return {
      code: 0,
      msg: 'ok',
      data: { message_id: messageId, recalled: true, recalled_at: now }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '撤回失败' }
  }
}
