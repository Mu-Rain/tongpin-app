'use strict'

/**
 * 约局确认 / 婉拒 —— 推进 meetups 的状态机
 *
 * 入参：{ token, message_id, action: 'accept' | 'decline' }
 * 出参：{ code, msg, data: { status, both } }
 *   status ∈ pending | one_confirmed | both_confirmed | declined
 *   both = status === 'both_confirmed'（前端拿来弹一句「约成了」）
 *
 * 状态机（30 文档 §P0-3）：
 *   pending → one_confirmed → both_confirmed
 *            ↘ declined（任一方婉拒即终止）
 *
 * 三个容易踩的点：
 *   1. 幂等：同一个人重复点「确认」不报错、不重复推进 —— 客户端重试是常态。
 *   2. 兜底建记录：前端也可能直接 message-send 发一张 structured 卡片（P0-2 允许），
 *      那种情况下没有 meetups 行，这里按消息内容补建，否则卡片永远点不动。
 *   3. 第三方不许操作：只有 invitee/inviter 两个人才有确认权。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'
const DB_MEETUPS = 'meetups'

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

/** 从卡片消息里读 meta（库里存的是 JSON 字符串），坏数据一律当空对象 */
function metaOf(m) {
  try {
    const o = JSON.parse((m && m.meta) || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch (e) {
    return {}
  }
}

/** 按会话 + 消息找约局记录。集合可能还没建（首次使用时），报错当作没有。 */
async function findMeetup(conversationId, messageId) {
  try {
    const r = await db
      .collection(DB_MEETUPS)
      .where({ conversation_id: conversationId, message_id: messageId })
      .limit(1)
      .get()
    return r.data.length ? r.data[0] : null
  } catch (e) {
    return null
  }
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))

    const messageId = str(event.message_id) || str(event.messageId)
    if (!messageId) fail('缺少消息 id')

    const action = str(event.action)
    if (action !== 'accept' && action !== 'decline') fail('只能确认或婉拒')

    // —— 1) 定位卡片消息 ——
    const msgRes = await db.collection(DB_MESSAGES).doc(messageId).get()
    const msg = (msgRes.data && msgRes.data[0]) || null
    if (!msg) fail('这张约局卡片找不到了')
    if (str(msg.type) !== 'structured') fail('这条消息不是约局卡片')
    const conversationId = str(msg.conversation_id)

    // —— 2) 权限：必须是这个会话的成员 ——
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId })
      .limit(20)
      .get()
    const meMember = memberRes.data.filter(function (m) {
      return m.user_id === me._id
    })[0]
    if (!meMember) fail('你不在这个会话里', 403)
    const other = memberRes.data.filter(function (m) {
      return m.user_id !== me._id
    })[0]

    // —— 3) 找记录，没有就补建 ——
    let meetup = await findMeetup(conversationId, messageId)
    if (!meetup) {
      const meta = metaOf(msg)
      const inviterId = str(msg.sender_id)
      const inviteeId = other ? str(other.user_id) : ''
      if (!inviteeId) fail('这个会话里没有可以约的人')
      const now = Date.now()
      const addRes = await db.collection(DB_MEETUPS).add({
        conversation_id: conversationId,
        card_id: str(meta.card_id),
        message_id: messageId,
        inviter_id: inviterId,
        invitee_id: inviteeId,
        time: str(meta.time),
        place: str(meta.place),
        note: str(meta.note),
        status: 'pending',
        inviter_confirmed: false,
        invitee_confirmed: false,
        created_at: typeof msg.created_at === 'number' ? msg.created_at : now,
        updated_at: now
      })
      meetup = {
        _id: addRes.id,
        conversation_id: conversationId,
        inviter_id: inviterId,
        invitee_id: inviteeId,
        status: 'pending',
        inviter_confirmed: false,
        invitee_confirmed: false
      }
    }

    // —— 4) 我是这局的哪一方 ——
    const isInviter = str(meetup.inviter_id) === me._id
    const isInvitee = str(meetup.invitee_id) === me._id
    if (!isInviter && !isInvitee) fail('这一局不是你发起的', 403)

    const status = str(meetup.status) || 'pending'
    const now = Date.now()

    // —— 5) 幂等：同一个人重复操作直接回当前状态，不重复推进 ——
    if (action === 'accept' && (isInviter ? meetup.inviter_confirmed === true : meetup.invitee_confirmed === true)) {
      return {
        code: 0,
        msg: 'ok（你已经确认过了）',
        data: { status, both: status === 'both_confirmed' }
      }
    }
    if (action === 'decline' && status === 'declined') {
      return { code: 0, msg: 'ok（已经婉拒过了）', data: { status, both: false } }
    }

    // —— 6) 推进状态 ——
    let nextStatus = status
    const patch = { updated_at: now }

    if (action === 'decline') {
      // 双方都确认了再婉拒：语义上是「反悔」，这不是本接口能处理的（要不要退掉已定的场地？）
      if (status === 'both_confirmed') fail('双方都确认了，改主意得在聊天里说一声')
      nextStatus = 'declined'
      patch.status = nextStatus
      patch.declined_by = me._id
    } else {
      // 任一方一旦婉拒，这局就结束了，后面再点确认不复活
      if (status === 'declined') fail('这一局已经婉拒了')
      const inviterConfirmed = isInviter ? true : meetup.inviter_confirmed === true
      const inviteeConfirmed = isInvitee ? true : meetup.invitee_confirmed === true
      patch.inviter_confirmed = inviterConfirmed
      patch.invitee_confirmed = inviteeConfirmed
      nextStatus = inviterConfirmed && inviteeConfirmed ? 'both_confirmed' : 'one_confirmed'
      patch.status = nextStatus
      if (nextStatus === 'both_confirmed' && !meetup.both_confirmed_at) {
        patch.both_confirmed_at = now
      }
    }

    await db.collection(DB_MEETUPS).doc(meetup._id).update(patch)

    return { code: 0, msg: 'ok', data: { status: nextStatus, both: nextStatus === 'both_confirmed' } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '操作失败' }
  }
}
