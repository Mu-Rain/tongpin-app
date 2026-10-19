'use strict'

/**
 * 会话列表 —— 消息页（pages/messages/messages.vue）用
 *
 * 入参：{ token }
 * 出参：{ code, msg, data: { list: [会话…], total_unread } }
 *
 * 每个会话项包含（对应原型 renderConvos 的字段）：
 *   conversation_id / name / avatar / last_text / last_at / unread
 *   / buddy_tag / buddy_tag_color / school
 *
 * ★ 为什么不直接读表：conversations 和 conversation_members 的 client
 *   权限都是 false（只有云函数能读），而且列表需要"对方是谁、搭子标签叫啥"
 *   这些跨表信息，客户端拼不出来。所以在一处批量拼好返回。
 *
 * ★ 为什么 unread 不从 messages 数：见 06 文档 §3.8 —— 几十个会话每个都
 *   count 一次消息表会卡。unread_count 是写消息时维护在 members 上的。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_RELATIONS = 'buddy_relations'

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

    // —— 1) 我参与的所有会话（按我这一行的更新时间倒序）——
    const myMembers = await db
      .collection(DB_MEMBERS)
      .where({ user_id: me._id })
      .limit(200)
      .get()

    if (!myMembers.data.length) {
      return { code: 0, msg: 'ok', data: { list: [], total_unread: 0 } }
    }

    const convIds = myMembers.data.map(function (m) {
      return m.conversation_id
    })

    // —— 2) 批量取会话本体（一次查，不做 N+1）——
    const convRes = await db
      .collection(DB_CONVERSATIONS)
      .where({ _id: dbCmd.in(convIds) })
      .get()
    const convMap = {}
    for (const c of convRes.data) convMap[c._id] = c

    // —— 3) 取每个会话的"其他成员"（direct 会话就一个人）——
    const allMembers = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: dbCmd.in(convIds) })
      .get()

    const othersByConv = {}
    for (const m of allMembers.data) {
      if (m.user_id === me._id) continue
      if (!othersByConv[m.conversation_id]) othersByConv[m.conversation_id] = []
      othersByConv[m.conversation_id].push(m.user_id)
    }

    // —— 4) 批量取对方用户信息 ——
    const otherIds = []
    for (const cid in othersByConv) {
      for (const uid of othersByConv[cid]) {
        if (otherIds.indexOf(uid) < 0) otherIds.push(uid)
      }
    }
    const userMap = {}
    if (otherIds.length) {
      const uRes = await db
        .collection(DB_USERS)
        .where({ _id: dbCmd.in(otherIds) })
        .field({ _id: true, nickname: true, avatar: true, school: true, school_name: true })
        .get()
      for (const u of uRes.data) userMap[u._id] = u
    }

    // —— 5) 批量取搭子关系（要显示"考研战友"这种自定义标签和颜色）——
    // ★ 改法：从"按会话的 buddy_relation_id"改成"按一对人"。
    //   一对人现在可以有多条 active 关系（考研搭子 + 夜跑搭子），
    //   但只有一个会话。会话是聊天室，关系是"我们因为什么成了搭子"。
    //   所以这里按 (user_a_id, user_b_id) 一次性把两个人的全部关系捞出来。
    //
    //   为什么要按人查而不是按会话查：老会话的 buddy_relation_id 有值，
    //   新会话（card-apply / buddy-invite 建的）该字段是空字符串，
    //   只按会话查会让新会话的标签全丢。
    const relMap = {}   // key = "aId|bId"，value = 关系数组
    const relIds = []
    for (const c of convRes.data) {
      let a = c.user_a_id || ''
      let b = c.user_b_id || ''
      // 极老的会话没有 user_a_id/user_b_id，退回用成员表反推
      if (!a || !b) {
        const others = othersByConv[c._id] || []
        const myId = me._id
        a = myId
        b = others[0] || ''
      }
      if (!a || !b) continue
      const key = a < b ? a + '|' + b : b + '|' + a
      if (relIds.indexOf(key) < 0) relIds.push(key)
    }

    if (relIds.length) {
      // 两批查：我是 a 的和我是 b 的。不用 or，避免条件写错
      const rAsA = await db
        .collection(DB_RELATIONS)
        .where({ user_a_id: me._id, status: 'active' })
        .limit(200)
        .get()
      const rAsB = await db
        .collection(DB_RELATIONS)
        .where({ user_b_id: me._id, status: 'active' })
        .limit(200)
        .get()

      const myRels = rAsA.data.concat(rAsB.data)
      for (const r of myRels) {
        const key = r.user_a_id + '|' + r.user_b_id
        if (!relMap[key]) relMap[key] = []
        // 同一关系可能两边都命中（自己跟自己？不可能，但防一下）
        if (relMap[key].indexOf(r) < 0) relMap[key].push(r)
      }
    }

    // —— 6) 拼装 ——
    let totalUnread = 0
    const list = myMembers.data.map(function (m) {
      const conv = convMap[m.conversation_id] || {}
      const otherId = (othersByConv[m.conversation_id] || [])[0] || ''
      const other = userMap[otherId] || {}

      // 搭子标签：关系表里 a/b 两侧各存一份，谁是 a 谁是 b 不一定。
      //
      // ★ "合成一张卡"：一对人可能有多条关系，但消息列表只显示一条会话。
      //   所以把多段关系的标签**合成一张卡**摆在会话行上：
      //     - tags[]     完整的标签数组，每个带自己的颜色，前端可以平铺展示
      //     - buddy_tag  取第一条有标签的，作为主标签（兼容老前端只读一个的地方）
      //   这样"考研搭子 + 夜跑搭子"两个标签都会出现在同一行，
      //   而不是像之前那样只显示一条、另一条凭空消失。
      const pairA = str(conv.user_a_id) || me._id
      const pairB = str(conv.user_b_id) || otherId
      const pairKeyStr = pairA < pairB ? pairA + '|' + pairB : pairB + '|' + pairA
      const myRels = relMap[pairKeyStr] || []

      const tags = []
      for (const rel of myRels) {
        let t = ''
        let c = ''
        if (rel.user_a_id === me._id) {
          t = str(rel.label_a)
          c = str(rel.label_a_color)
        } else if (rel.user_b_id === me._id) {
          t = str(rel.label_b)
          c = str(rel.label_b_color)
        }
        // 只收有标签的关系；用户还没起名的关系不占位置
        if (t) tags.push({ label: t, color: c, category: str(rel.category) || 'other' })
      }

      let tag = ''
      let tagColor = ''
      if (tags.length) {
        tag = tags[0].label
        tagColor = tags[0].color
      }

      const unread = typeof m.unread_count === 'number' ? m.unread_count : 0
      totalUnread += unread

      return {
        conversation_id: m.conversation_id,
        other_user_id: otherId,
        name: other.nickname || '同学',
        avatar: other.avatar || '',
        school: other.school_name || other.school || '',
        last_text: conv.last_message_text || '还没有聊过，打个招呼吧',
        last_at: conv.last_message_at || conv.created_at || 0,
        unread: unread,
        buddy_tag: tag,
        buddy_tag_color: tagColor,
        // 多搭子：这一对人在你这边显示的全部标签（合成一张卡）
        buddy_tags: tags,
        buddy_tag_count: tags.length
      }
    })

    // 按最后一条消息时间倒序（有没有都排一下，刚建的空会话排后面）
    list.sort(function (a, b) {
      return (b.last_at || 0) - (a.last_at || 0)
    })

    return { code: 0, msg: 'ok', data: { list: list, total_unread: totalUnread } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '加载失败' }
  }
}
