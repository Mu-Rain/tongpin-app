'use strict'

/**
 * 申请搭子 —— 申请 / 同意 / 拒绝 / 取消
 *
 * 一个函数四个 action，因为它们改的都是 applications 这张表、
 * 而且共享同一套「谁有权改这一行」的校验，拆开反而要复制四遍校验。
 *
 * 入参：
 *   action = 'apply'   { token, card_id, message ≤100 }
 *   action = 'accept'  { token, application_id, label?, color? }
 *     label/color：发布者同意时可以**给自己这一侧**起个搭子标签（私有备注，只有自己看得见）。
 *     不传就保持空 —— 之后可在「我的搭子」页补设。
 *   action = 'reject'  { token, application_id }
 *   action = 'cancel'  { token, application_id }    申请人自己撤回
 *
 * 出参统一 { code, msg, data }
 *
 * 状态机（03 文档 §4.2）：
 *   applications: pending → accepted | rejected | canceled
 *   cards:        open → matched（接受某人时）  → closed
 *   接受时的连锁动作（必须在一个事务里，否则会出现"关系建了但卡片还开着"）：
 *     1. applications.status = accepted
 *     2. cards.status = matched
 *     3. 建 buddy_relations 一条
 *     4. 建 conversations(type='direct') + 两个 member
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const MAX_MESSAGE = 100

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
    /** 8 个预设闪亮色 —— 必须与 buddy-tag 的 COLORS、chat.vue 的 TAG_COLORS 完全一致 */
const COLORS = [
  'shine-yellow',
  'shine-orange',
  'shine-rose',
  'shine-violet',
  'shine-cyan',
  'shine-mint',
  'shine-blue',
  'shine-gold'
]

// 标签最多 6 个字（加上固定后缀「搭子」共 8 字）
const MAX_LABEL_LEN = 6

/**
 * 清洗用户起的搭子标签前缀。
 * 两个动作：
 *   ① 去掉用户可能自己带上的「搭子」后缀 —— 库里只存前缀，显示时统一补后缀，
 *      否则会出现「啊哈哈搭子搭子」。
 *   ② 截断到 MAX_LABEL_LEN 个字。
 */
function cleanLabel(raw) {
  let s = str(raw)
  if (!s) return ''
  const SUFFIX = '搭子'
  if (s.length > SUFFIX.length && s.slice(-SUFFIX.length) === SUFFIX) {
    s = s.slice(0, -SUFFIX.length)
  }
  return s.slice(0, MAX_LABEL_LEN)
}

const action = str(event.action) || 'apply'
    const me = await getUserByToken(str(event.token))

    // ============================================================
    // 申请
    // ============================================================
    if (action === 'apply') {
      const cardId = str(event.card_id)
      const message = str(event.message)
      if (!cardId) fail('缺少 card_id')
      if (message.length > MAX_MESSAGE) fail('留言最多 ' + MAX_MESSAGE + ' 字')

      const cardRes = await db.collection('cards').doc(cardId).get()
      if (!cardRes.data || !cardRes.data.length) fail('这张卡片不存在', 404)
      const card = cardRes.data[0]

      // —— 硬性拦截（每条都对应 03 文档里的一条业务规则）——
      if (card.owner_id === me._id) fail('不能申请自己的卡片')
      if (card.status !== 'open') fail(card.status === 'matched' ? '这张卡片已经找到搭子了' : '这张卡片已关闭')

      // 发布者信誉分
      const ownerRes = await db.collection(DB_USERS).where({ _id: card.owner_id }).limit(1).get()
      const owner = ownerRes.data[0]
      if (!owner) fail('发布者不存在')
      const ownerCredit = typeof owner.credit_score === 'number' ? owner.credit_score : typeof owner.credit === 'number' ? owner.credit : 80
      if (ownerCredit < 60) fail('对方信誉分过低，暂不支持申请')

      // 我的信誉分（低信誉也不能乱申请）
      const myCredit = typeof me.credit_score === 'number' ? me.credit_score : typeof me.credit === 'number' ? me.credit : 80
      if (myCredit < 60) fail('你的信誉分低于 60，暂时不能申请搭子', 403)

      // 同一 (card, applicant) 只能有一条 pending —— 文档型没有联合唯一索引，只能这里查
      const dup = await db
        .collection('applications')
        .where({ card_id: cardId, applicant_id: me._id, status: 'pending' })
        .count()
      if (dup.total > 0) fail('你已经申请过了，等对方回应吧')

      const now = Date.now()
      const addRes = await db.collection('applications').add({
        card_id: cardId,
        applicant_id: me._id,
        owner_id: card.owner_id, // 冗余一份，发布者查"谁申请了我的卡"时不用回查 cards
        message,
        status: 'pending',
        decided_at: 0,
        created_at: now
      })

      // 通知发布者（站内通知，先只入库不推送）
      try {
        await db.collection('notifications').add({
          user_id: card.owner_id,
          type: 'application',
          title: '有人想搭你的伙',
          content: (me.nickname || '有人') + ' 申请了「' + card.title + '」',
          ref_id: cardId,
          is_read: false,
          created_at: now
        })
      } catch (e) {
        // 通知失败不该让申请本身失败
      }

      return { code: 0, msg: 'ok', data: { application_id: addRes.id } }
    }

    // ============================================================
    // 同意 —— 连锁动作最多的一步
    // ============================================================
    if (action === 'accept') {
      const appId = str(event.application_id)
      if (!appId) fail('缺少 application_id')

      const appRes = await db.collection('applications').doc(appId).get()
      if (!appRes.data || !appRes.data.length) fail('申请不存在', 404)
      const app = appRes.data[0]

      if (app.status !== 'pending') fail('这条申请已经处理过了')

      const cardRes = await db.collection('cards').doc(app.card_id).get()
      if (!cardRes.data || !cardRes.data.length) fail('卡片不存在', 404)
      const card = cardRes.data[0]

      // 只有发布者能同意
      if (card.owner_id !== me._id) fail('只有发布者能同意申请', 403)
      if (card.status !== 'open') fail('这张卡片已经不在招募中了')

      const now = Date.now()

      // 1) 申请 → accepted
      await db.collection('applications').doc(appId).update({
        status: 'accepted',
        decided_at: now
      })

      // 2) 卡片 → matched
      await db.collection('cards').doc(card._id).update({
        status: 'matched',
        updated_at: now
      })

      // 3) 其余 pending 申请自动 rejected（一个卡片只成一个搭子）
      const others = await db
        .collection('applications')
        .where({ card_id: card._id, status: 'pending' })
        .get()
      for (const o of others.data) {
        await db.collection('applications').doc(o._id).update({
          status: 'rejected',
          decided_at: now
        })
        try {
          await db.collection('notifications').add({
            user_id: o.applicant_id,
            type: 'application',
            title: '这次没配上',
            content: '「' + card.title + '」已经找到搭子了，再看看别的吧',
            ref_id: card._id,
            is_read: false,
            created_at: now
          })
        } catch (e) {
          /* 通知失败忽略 */
        }
      }

      // 4) 建搭子关系
      //    ★ 判重键从 (user_a_id, user_b_id, status) 改成 (user_a_id, user_b_id, category)。
      //      原来只要两人之间有一条 active 关系就复用，等于"一对人只能有一个搭子"。
      //      现在同一对人在**不同类型**下可以各有一条，比如既是"考研搭子"又是"夜跑搭子"。
      //      category 取自卡片类型，一张学习卡成的搭子就是 study 类。
      //    ★ 约定 user_a_id < user_b_id，避免同一对出现两条镜像。
      const a = card.owner_id
      const b = app.applicant_id
      const ua = a < b ? a : b
      const ub = a < b ? b : a
      const category = card.type || 'other'

      const existRel = await db
        .collection('buddy_relations')
        .where({ user_a_id: ua, user_b_id: ub, category: category, status: 'active' })
        .limit(1)
        .get()

      let relationId = ''
      let relationCreated = false
      if (existRel.data.length === 0) {
        const relRes = await db.collection('buddy_relations').add({
          user_a_id: ua,
          user_b_id: ub,
          category: category,
          source_type: 'card',
          source_card_id: card._id,
          source_invite_id: '',
          label_a: '',
          label_b: '',
          label_a_color: '',
          label_b_color: '',
          conversation_id: '',
          status: 'active',
          ended_by: '',
          ended_at: 0,
          created_at: now
        })
        relationId = relRes.id
        relationCreated = true
      } else {
        relationId = existRel.data[0]._id
      }

      // 5) 建会话 + 两个成员
      //    ★ 判重键从 buddy_relation_id 改成 user_pair_key ——
      //      会话是"两个人之间的聊天室"，不是"某一段关系的聊天室"。
      //      原来按关系判重，一旦允许多关系就会给同一对人建出好几个聊天室，
      //      消息列表里出现重复条目、未读数各算各的，用户会疯。
      //      user_pair_key = 两个 id 排序后拼接，天然唯一。
      const pairKey = ua + '|' + ub

      const existConv = await db
        .collection('conversations')
        .where({ user_pair_key: pairKey, type: 'direct' })
        .limit(1)
        .get()

      let convId = ''
      if (existConv.data.length === 0) {
        const convRes = await db.collection('conversations').add({
          type: 'direct',
          user_pair_key: pairKey,
          user_a_id: ua,
          user_b_id: ub,
          // 兼容老字段：新逻辑不依赖它，留空即可
          buddy_relation_id: '',
          last_message_id: '',
          last_message_at: now,
          created_at: now,
          updated_at: now
        })
        convId = convRes.id
        for (const uid of [ua, ub]) {
          await db.collection('conversation_members').add({
            conversation_id: convId,
            user_id: uid,
            unread_count: 0,
            last_read_message_id: ''
          })
        }
      } else {
        convId = existConv.data[0]._id
      }

      // 5.5) ★ 把会话 id 回写到申请行 —— 这是详情页「去聊聊」唯一的入口。
      // 不回写的话，accept 的返回值一关掉，会话 id 就永久丢了，
      // 两个人明明配上了却再也找不到聊天入口。
      await db.collection('applications').doc(appId).update({
        conversation_id: convId,
        relation_id: relationId
      })

      // 5.6) ★ 同时回写到关系表 —— 这是「我的搭子」页的入口。
      // 第 4 天这里漏了：只写了 applications，没写 buddy_relations，
      // 结果「我的搭子」页去关系表读 conversation_id 读到空，
      // 明明聊过天也提示「这个搭子还没有会话记录」。
      // 两张表都要写：详情页读 applications，我的搭子页读 buddy_relations。
      await db.collection('buddy_relations').doc(relationId).update({
        conversation_id: convId
      })

      // 5.7) ★ 发布者自己这一侧的搭子标签（可选）。
      //   ★ 只写我自己那一侧：标签是私有备注，我无权替对方起名。
      //   我是 a → 写 label_a；我是 b → 写 label_b（这里 a 就是发布者 card.owner_id，
      //   但为稳妥仍按实际字段判断，避免以后约定变化导致写错侧）。
      const myRawLabel = str(event.label)
      const myRawColor = str(event.color)
      if (myRawLabel) {
        const cleanMyLabel = cleanLabel(myRawLabel)
        const cleanMyColor = COLORS.indexOf(myRawColor) >= 0 ? myRawColor : 'shine-yellow'
        const iAmA = ua === a
        const patch = iAmA
          ? { label_a: cleanMyLabel, label_a_color: cleanMyColor }
          : { label_b: cleanMyLabel, label_b_color: cleanMyColor }
        await db.collection('buddy_relations').doc(relationId).update(patch)
      }

      // 6) 通知申请人
      try {
        await db.collection('notifications').add({
          user_id: app.applicant_id,
          type: 'application',
          title: '搭子配对成功',
          content: '「' + card.title + '」的发布者同意了你的申请',
          ref_id: card._id,
          is_read: false,
          created_at: now
        })
      } catch (e) {
        /* 忽略 */
      }

      return { code: 0, msg: 'ok', data: { relation_id: relationId, conversation_id: convId } }
    }

    // ============================================================
    // 拒绝 / 取消
    // ============================================================
    if (action === 'reject' || action === 'cancel') {
      const appId = str(event.application_id)
      if (!appId) fail('缺少 application_id')

      const appRes = await db.collection('applications').doc(appId).get()
      if (!appRes.data || !appRes.data.length) fail('申请不存在', 404)
      const app = appRes.data[0]
      if (app.status !== 'pending') fail('这条申请已经处理过了')

      const cardRes = await db.collection('cards').doc(app.card_id).get()
      const card = (cardRes.data && cardRes.data[0]) || {}

      if (action === 'reject' && card.owner_id !== me._id) {
        fail('只有发布者能拒绝申请', 403)
      }
      if (action === 'cancel' && app.applicant_id !== me._id) {
        fail('只能撤回自己的申请', 403)
      }

      await db.collection('applications').doc(appId).update({
        status: action === 'reject' ? 'rejected' : 'canceled',
        decided_at: Date.now()
      })

      return { code: 0, msg: 'ok', data: {} }
    }

    fail('未知的 action：' + action)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '操作失败' }
  }
}
