'use strict'

/**
 * 约局邀请 —— 发一张约局卡片（type='structured'）并建一条约局状态机记录
 *
 * 入参：{ token, conversation_id, time, place, note?, card_id? }
 * 出参：{ code, msg, data: { message_id, meetup_id } }
 *
 * 为什么单独一个云函数而不是让前端直接 message-send：
 *   约局要的不只是一条消息，还要一张能被「确认/婉拒」推进状态的记录（meetups）。
 *   两个写入必须成对出现，否则会出现「有卡片点不动」或「有记录没卡片」。
 *
 * 为什么消息写入不直接 callFunction('message-send')：
 *   云函数互调会多一跳网络 + 一次冷启动风险，而这里的写入只有几十行。
 *   代价是与 message-send 的写库段落有重复 —— 公共模块要改每个函数目录的
 *   package.json，超出本次改动边界，先按显式重复处理。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'
const DB_NOTIFICATIONS = 'notifications'
const DB_BLOCKS = 'user_blocks'
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

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))

    // 契约字段是 conversation_id；顺手兼容 camelCase，前端两种写法都不会白跑一次
    const conversationId = str(event.conversation_id) || str(event.conversationId)
    if (!conversationId) fail('缺少会话 id')

    const time = str(event.time)
    const place = str(event.place)
    if (!time || !place) fail('约局卡片要有时间和地点')
    const note = str(event.note)
    const cardId = str(event.card_id) || str(event.cardId)

    // —— 必须是会话成员 ——
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId })
      .limit(20)
      .get()
    const meMember = memberRes.data.filter(function (m) {
      return m.user_id === me._id
    })[0]
    if (!meMember) fail('你不在这个会话里', 403)

    // —— 约的对象：会话里除我之外的那个人 ——
    // 约局是两人之间的事，群聊（多成员）里挑第一个非我成员，语义上仍然成立
    const other = memberRes.data.filter(function (m) {
      return m.user_id !== me._id
    })[0]
    if (!other) fail('这个会话里没有可以约的人')

    // —— 黑名单拦截：被拉黑就别发约局了（与 message-send 同口径）——
    // 整段 try/catch：user_blocks 表在第一次写入前可能不存在，查询报错时当作没拉黑
    try {
      const byHim = await db
        .collection(DB_BLOCKS)
        .where({ owner_id: other.user_id, target_id: me._id })
        .limit(1)
        .get()
      if (byHim.data.length) fail('对方已拒收你的消息', 403)
      const byMe = await db
        .collection(DB_BLOCKS)
        .where({ owner_id: me._id, target_id: other.user_id })
        .limit(1)
        .get()
      if (byMe.data.length) fail('你把对方加入了黑名单，无法发送', 403)
    } catch (e) {
      if (e && e.bizCode) throw e
    }

    const now = Date.now()

    // —— 1) 约局卡片消息 ——
    // 与 message-send 的 structured 分支同形态：content 空串，内容全在 meta（存 JSON 字符串）
    const meta = { time, place }
    if (note) meta.note = note
    if (cardId) meta.card_id = cardId
    const metaStr = JSON.stringify(meta)

    const addRes = await db.collection(DB_MESSAGES).add({
      conversation_id: conversationId,
      sender_id: me._id,
      type: 'structured',
      content: '',
      client_msg_id: '',
      meta: metaStr,
      created_at: now
    })
    const messageId = addRes.id

    // —— 2) 未读 + 站内通知（不给自己加）——
    for (const m of memberRes.data) {
      if (m.user_id === me._id) {
        await db.collection(DB_MEMBERS).doc(m._id).update({
          unread_count: 0,
          last_read_message_id: messageId
        })
        continue
      }
      const cur = typeof m.unread_count === 'number' ? m.unread_count : 0
      await db.collection(DB_MEMBERS).doc(m._id).update({ unread_count: cur + 1 })
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
        /* 通知失败不该让约局失败 */
      }
    }

    // —— 3) 会话预览 ——
    await db.collection(DB_CONVERSATIONS).doc(conversationId).update({
      last_message_id: messageId,
      last_message_text: '[约局]',
      last_message_sender_id: me._id,
      last_message_at: now,
      updated_at: now
    })

    // —— 4) 约局状态机记录 ——
    // 写失败不算整体失败：meetup-confirm 发现没有记录时会按消息内容自动补建，
    // 所以这里退化成 meetup_id='' 比让用户重发（可能产生两条卡片）更安全。
    let meetupId = ''
    try {
      const mRes = await db.collection(DB_MEETUPS).add({
        conversation_id: conversationId,
        card_id: cardId,
        message_id: messageId,
        inviter_id: me._id,
        invitee_id: other.user_id,
        time,
        place,
        note,
        status: 'pending',
        inviter_confirmed: false,
        invitee_confirmed: false,
        created_at: now,
        updated_at: now
      })
      meetupId = mRes.id
    } catch (e) {
      meetupId = ''
    }

    return { code: 0, msg: 'ok', data: { message_id: messageId, meetup_id: meetupId } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '约局卡片发不出去' }
  }
}
