'use strict'

/**
 * 定向邀请 —— 丙方案的核心
 *
 * 解决的问题：一对人只能有一个搭子。想再建一段关系时，
 * 不能走"发卡片→对方申请→同意"那条路（那条路有唯一性约束），
 * 而是由一方**直接点名邀请**另一方，并指定期望的搭子标签。
 *
 * 入参：
 *   action = 'invite'  { token, to_user_id, label, color, message? }
 *   action = 'accept'  { token, invite_id, label?, color? }
 *        label/color 是**接受方自己给对方起的标签**（可省略）。
 *        省略时对方那侧保持原样，不会清掉已有的名字。
 *   action = 'reject'  { token, invite_id }
 *   action = 'cancel'  { token, invite_id }
 *   action = 'list'    { token, box: 'in' | 'out' }
 *
 * 出参：{ code, msg, data }
 *
 * ★ 「搭子」两个字是固定后缀，由前端拼。这里存和返回的都是**前缀**。
 * ★ 搭子标签是**私有备注**（用户明确要求）：
 *     我起的名字只有我能看见，对方起的名字只有对方能看见，两边互不可见 ——
 *     类似微信备注，但语义上是"我把这个搭子当成什么"，不是通讯录备注。
 *   落到数据上：label_a 只属于 user_a，label_b 只属于 user_b，各自只写自己那一侧。
 *   落到接口上：任何云函数都不许把对方那一侧的 label 下发给当前用户。
 * ★ 一对人只对应一个会话（conversations 按 user_pair_key 唯一），
 *   但可以有多条 buddy_relations（按 (user_a_id, user_b_id, category) 区分）。
 *   会话是"两个人之间的聊天室"，关系是"我们因为什么成了搭子"。
 */

const crypto = require('crypto')

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_INVITES = 'buddy_invites'
const DB_RELATIONS = 'buddy_relations'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_NOTIFICATIONS = 'notifications'

const COLORS = [
  'shine-yellow', 'shine-orange', 'shine-rose', 'shine-violet',
  'shine-cyan', 'shine-mint', 'shine-blue', 'shine-gold'
]
const MAX_LABEL_LEN = 6
const MAX_MESSAGE = 100
const SUFFIX = '搭子'

// 同一对人在 24 小时内最多发 3 次邀请，防骚扰
const DAILY_INVITE_LIMIT = 3
const DAY_MS = 24 * 3600 * 1000

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function pickInt(v, dft) {
  return typeof v === 'number' ? v : dft
}

/** 两个人的固定键：排序后拼接。用它保证"一对人一个会话" */
function pairKey(a, b) {
  return a < b ? a + '|' + b : b + '|' + a
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

/** 读用户信誉分，兼容两套字段名 */
function readCredit(u) {
  return pickInt(u.credit_score, pickInt(u.credit, 80))
}

/**
 * 剥掉用户可能自己带的"搭子"后缀。
 * 用户在弹层里输入框后面已经固定显示"搭子"两个字，
 * 但万一他手打进去了，不能存成"考研搭子搭子"。
 */
function cleanLabel(raw) {
  let s = str(raw)
  if (!s) return ''
  if (s.length > MAX_LABEL_LEN && s.slice(-2) === SUFFIX) {
    s = s.slice(0, -2).trim()
  }
  if (s.length > MAX_LABEL_LEN) {
    fail('标签最多 ' + MAX_LABEL_LEN + ' 个字（加上「搭子」共 8 字）', 400)
  }
  if (s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
    fail('标签不能包含换行', 400)
  }
  return s
}

/**
 * 确保两个人之间有一个会话。
 * ★ 按 user_pair_key 查，不是按 buddy_relation_id —— 一对人只有一个聊天室，
 *   多条搭子关系共用它。这是"合成一张卡"的关键。
 */
async function ensureConversation(userA, userB, now) {
  const key = pairKey(userA, userB)
  const ua = userA < userB ? userA : userB
  const ub = userA < userB ? userB : userA

  // (1) 先按 user_pair_key 查（新会话都有这个字段）
  const exist = await db
    .collection(DB_CONVERSATIONS)
    .where({ user_pair_key: key, type: 'direct' })
    .limit(1)
    .get()

  if (exist.data.length) {
    return exist.data[0]._id
  }

  // (2) 兼容没有 user_pair_key 的老会话。
  //     老会话是 card-apply 在引入 pair key 之前建的，字段为空；
  //     只按 key 查会查不到，于是又建一条 —— 消息列表就出现两条一模一样的会话。
  //     这里按「两个人 + direct」再找一次，找到就复用，并顺手把 key 补上。
  const legacy = await db
    .collection(DB_CONVERSATIONS)
    .where({ user_a_id: ua, user_b_id: ub, type: 'direct' })
    .limit(1)
    .get()

  if (legacy.data.length) {
    const oldConv = legacy.data[0]
    try {
      await db.collection(DB_CONVERSATIONS).doc(oldConv._id).update({
        user_pair_key: key,
        user_a_id: ua,
        user_b_id: ub,
        updated_at: now
      })
    } catch (e) {
      /* 补字段失败不影响复用 */
    }
    return oldConv._id
  }

  const convRes = await db.collection(DB_CONVERSATIONS).add({
    type: 'direct',
    user_pair_key: key,
    user_a_id: userA < userB ? userA : userB,
    user_b_id: userA < userB ? userB : userA,
    // 兼容老字段：留空即可，新逻辑不依赖它
    buddy_relation_id: '',
    last_message_id: '',
    last_message_at: now,
    created_at: now,
    updated_at: now
  })
  const convId = convRes.id

  for (const uid of [userA, userB]) {
    await db.collection(DB_MEMBERS).add({
      conversation_id: convId,
      user_id: uid,
      unread_count: 0,
      last_read_message_id: ''
    })
  }

  return convId
}

/**
 * 建立一条搭子关系。
 * ★ 按 (user_a_id, user_b_id, category) 判重 —— 同一对人在**同一类型**下只能有一条，
 *   但不同类型可以有多条。这就是允许多搭子的地方。
 */
async function ensureRelation(userA, userB, category, sourceId, now) {
  const ua = userA < userB ? userA : userB
  const ub = userA < userB ? userB : userA

  const exist = await db
    .collection(DB_RELATIONS)
    .where({ user_a_id: ua, user_b_id: ub, category: category, status: 'active' })
    .limit(1)
    .get()

  if (exist.data.length) {
    return { relationId: exist.data[0]._id, created: false }
  }

  const relRes = await db.collection(DB_RELATIONS).add({
    user_a_id: ua,
    user_b_id: ub,
    category: category,
    source_type: 'invite',
    source_card_id: '',
    source_invite_id: sourceId,
    label_a: '',
    label_b: '',
    label_a_color: '',
    label_b_color: '',
    status: 'active',
    ended_by: '',
    ended_at: 0,
    created_at: now
  })

  return { relationId: relRes.id, created: true }
}

function normalizeCategory(raw) {
  const s = str(raw)
  return s || 'other'
}

exports.main = async (event) => {
  try {
    const action = str(event.action) || 'invite'
    const me = await getUserByToken(str(event.token))
    const now = Date.now()

    // ============ 发邀请 ============
    if (action === 'invite') {
      const toUserId = str(event.to_user_id)
      if (!toUserId) fail('请选择要邀请的人', 400)
      if (toUserId === me._id) fail('不能邀请自己', 400)

      const toRes = await db.collection(DB_USERS).doc(toUserId).get()
      if (!toRes.data || !toRes.data.length) {
        fail('这个人不存在或已注销', 404)
      }
      const to = toRes.data[0]

      // 信誉门槛：两条都要过
      const myCredit = readCredit(me)
      const hisCredit = readCredit(to)
      if (myCredit < 60) fail('你的信誉分低于 60，暂时不能邀请搭子', 403)
      if (hisCredit < 60) fail('对方信誉分过低，暂不支持邀请', 403)

      const label = cleanLabel(event.label)
      if (!label) fail('请给对方起一个搭子标签', 400)

      const color = str(event.color)
      if (COLORS.indexOf(color) < 0) fail('颜色不在可选范围内', 400)

      const category = normalizeCategory(event.category)
      const message = str(event.message).slice(0, MAX_MESSAGE)

      // 防骚扰：24 小时内同一对人不超 3 次
      const recent = await db
        .collection(DB_INVITES)
        .where({
          from_user_id: me._id,
          to_user_id: toUserId,
          created_at: dbCmd.gt(now - DAY_MS)
        })
        .count()
      if (recent.total >= DAILY_INVITE_LIMIT) {
        fail('你今天已经给他发过 ' + DAILY_INVITE_LIMIT + ' 次邀请了，明天再来吧', 429)
      }

      // 已经等着回应的不重复发
      const pending = await db
        .collection(DB_INVITES)
        .where({
          from_user_id: me._id,
          to_user_id: toUserId,
          status: 'pending'
        })
        .count()
      if (pending.total > 0) {
        fail('你已经发过邀请，等他回应吧', 409)
      }

      const invRes = await db.collection(DB_INVITES).add({
        from_user_id: me._id,
        from_name: str(me.nickname),
        from_avatar: str(me.avatar_url) || str(me.avatar),
        to_user_id: toUserId,
        label: label,
        color: color,
        category: category,
        message: message,
        status: 'pending',
        relation_id: '',
        conversation_id: '',
        created_at: now,
        decided_at: 0
      })

      // ★ 发起方自己的标签必须当场落进关系里（Q1=1：只写自己那一侧）。
      //   原来这里什么都没做 —— 邀请只建了 buddy_invites 记录，
      //   起的名字只躺在 invites.label 里，accept 时 ensureRelation 新建的关系
      //   两侧标签全空，于是「B 起的名」凭空消失：B 自己那一侧也看不到，
      //   A 更看不到（A 侧本来就该等 A 自己起名）。
      //   结果就是用户描述的「B 进 A 主页只有类别名、A 进 B 主页什么都没有」。
      //   现在提前把关系建出来，并把 label 写进**我的**那一侧；A 那一侧留空。
      //   幂等：同一 (ua,ub,category) 已存在时 ensureRelation 直接复用，不会重复建。
      try {
        const pre = await ensureRelation(me._id, toUserId, category, invRes.id, now)
        const preDoc = (await db.collection(DB_RELATIONS).doc(pre.relationId).get()).data[0]
        if (preDoc && preDoc.status === 'active') {
          const iAmA = preDoc.user_a_id === me._id
          const myPatch = {}
          if (iAmA) {
            myPatch.label_a = label
            myPatch.label_a_color = color
          } else {
            myPatch.label_b = label
            myPatch.label_b_color = color
          }
          await db.collection(DB_RELATIONS).doc(pre.relationId).update(myPatch)
        }
      } catch (e) {
        /* 预建关系失败不影响邀请本身；accept 时 ensureRelation 会兜底重建 */
      }

      // 通知。失败不影响邀请本身
      try {
        await db.collection(DB_NOTIFICATIONS).add({
          user_id: toUserId,
          type: 'invite',
          title: '有人邀请你做搭子',
          content: (str(me.nickname) || '有人') + ' 想和你做「' + label + SUFFIX + '」',
          ref_id: invRes.id,
          is_read: false,
          created_at: now
        })
      } catch (e) {
        /* 忽略 */
      }

      return {
        code: 0,
        msg: 'ok',
        data: { invite_id: invRes.id, status: 'pending' }
      }
    }

    // ============ 同意邀请 ============
    if (action === 'accept') {
      const inviteId = str(event.invite_id)
      if (!inviteId) fail('缺少邀请 id', 400)

      const invRes = await db.collection(DB_INVITES).doc(inviteId).get()
      if (!invRes.data || !invRes.data.length) fail('这条邀请不存在', 404)
      const inv = invRes.data[0]

      if (inv.to_user_id !== me._id) fail('这条邀请不是发给你的', 403)
      if (inv.status !== 'pending') fail('这条邀请已经处理过了', 409)

      const convId = await ensureConversation(inv.from_user_id, inv.to_user_id, now)

      const rel = await ensureRelation(
        inv.from_user_id,
        inv.to_user_id,
        inv.category || 'other',
        inviteId,
        now
      )

      // ★ 只写我自己那一侧。对方那一侧属于对方的私有备注，我没有权力替它写。
      //   原来这里会把发起方在邀请里填的名字直接落到接受方自己这一侧
      //   （patch.label_b = inv.label），等于替别人改了备注 —— 与
      //   「标签只给自己看、各写各的」这条规则冲突，已删除。
      //   发起方那一侧的标签在 action='invite' 时就已随邀请一起建立（见下方 ensureRelation 之后），
      //   由发起方本人在「我的搭子」页维护。
      const relDoc = (await db.collection(DB_RELATIONS).doc(rel.relationId).get()).data[0] || {}
      const iAmA = relDoc.user_a_id === me._id

      const patch = {}

      // 接受方自己给对方起的标签（可选）。
      // 之前只有发起方有权起名，接受方那一侧永远是空的 —— 用户反馈"接受方不能自选标签"。
      // 现在接受时可以带 label / color，写到「我给对方起的」那侧：
      //   我是 a  → 我起的名写 label_a
      //   我是 b  → 我起的名写 label_b
      // 不传或传空串就保持原样（不清掉已有的名字）。
      const myRawLabel = str(event.label)
      const myRawColor = str(event.color)
      if (myRawLabel) {
        const myLabel = cleanLabel(myRawLabel)
        const myColor = COLORS.indexOf(myRawColor) >= 0 ? myRawColor : 'shine-yellow'
        if (iAmA) {
          patch.label_a = myLabel
          patch.label_a_color = myColor
        } else {
          patch.label_b = myLabel
          patch.label_b_color = myColor
        }
      }

      patch.conversation_id = convId
      await db.collection(DB_RELATIONS).doc(rel.relationId).update(patch)

      await db.collection(DB_INVITES).doc(inviteId).update({
        status: 'accepted',
        relation_id: rel.relationId,
        conversation_id: convId,
        decided_at: now
      })

      try {
        await db.collection(DB_NOTIFICATIONS).add({
          user_id: inv.from_user_id,
          type: 'invite_accepted',
          title: '邀请被接受了',
          // 通知里不写具体标签名：那是发起方的私有备注，而且接受方可能压根没接受这个名字。
          content: (str(me.nickname) || '对方') + ' 接受了你的搭子邀请，去消息里聊聊吧',
          ref_id: convId,
          is_read: false,
          created_at: now
        })
      } catch (e) {
        /* 忽略 */
      }

      return {
        code: 0,
        msg: 'ok',
        data: {
          relation_id: rel.relationId,
          conversation_id: convId,
          // ★ 不再返回发起方的标签（label / label_color）——
          //   那是对方给我起的私有备注，我无权查看。
          // 我自己给对方起的（可选，没填就是空串）
          my_label: str(event.label) ? cleanLabel(str(event.label)) : '',
          my_label_color: str(event.color) || ''
        }
      }
    }

    // ============ 拒绝邀请 ============
    if (action === 'reject') {
      const inviteId = str(event.invite_id)
      if (!inviteId) fail('缺少邀请 id', 400)

      const invRes = await db.collection(DB_INVITES).doc(inviteId).get()
      if (!invRes.data || !invRes.data.length) fail('这条邀请不存在', 404)
      const inv = invRes.data[0]

      if (inv.to_user_id !== me._id) fail('这条邀请不是发给你的', 403)
      if (inv.status !== 'pending') fail('这条邀请已经处理过了', 409)

      await db.collection(DB_INVITES).doc(inviteId).update({
        status: 'rejected',
        decided_at: now
      })

      return { code: 0, msg: 'ok', data: { status: 'rejected' } }
    }

    // ============ 撤回邀请 ============
    if (action === 'cancel') {
      const inviteId = str(event.invite_id)
      if (!inviteId) fail('缺少邀请 id', 400)

      const invRes = await db.collection(DB_INVITES).doc(inviteId).get()
      if (!invRes.data || !invRes.data.length) fail('这条邀请不存在', 404)
      const inv = invRes.data[0]

      if (inv.from_user_id !== me._id) fail('只有发起人能撤回', 403)
      if (inv.status !== 'pending') fail('这条邀请已经处理过了', 409)

      await db.collection(DB_INVITES).doc(inviteId).update({
        status: 'cancelled',
        decided_at: now
      })

      return { code: 0, msg: 'ok', data: { status: 'cancelled' } }
    }

    // ============ 邀请列表 ============
    if (action === 'list') {
      const box = str(event.box) || 'in'

      // ★ 不能用 { [field]: me._id } 动态键 —— 支付宝云的查询序列化对计算属性
      //   不可靠，分支写死更安全，而且只有两个分支。
      const cond =
        box === 'out'
          ? { from_user_id: me._id, status: 'pending' }
          : { to_user_id: me._id, status: 'pending' }

      const r = await db
        .collection(DB_INVITES)
        .where(cond)
        .orderBy('created_at', 'desc')
        .limit(50)
        .get()

      // ★ invites 表里的 label 是**发起方**填的名字，属于发起方的私有备注。
      //   只有 box='out'（我发出去的邀请）时，那才是"我自己写的"，
      //   可以回显给我看；box='in'（别人邀请我）绝不能把对方写的名字发给我 ——
      //   那等于让我看见了别人的备注。
      const isOut = box === 'out'
      const list = r.data.map((x) => ({
        invite_id: x._id,
        from_user_id: x.from_user_id,
        from_name: x.from_name,
        from_avatar: x.from_avatar,
        to_user_id: x.to_user_id,
        // 我发出去的：回显我自己起的名字；别人发来的：不出标签
        label: isOut ? x.label : '',
        label_color: isOut ? x.color : '',
        category: x.category,
        message: x.message,
        status: x.status,
        created_at: x.created_at
      }))

      return { code: 0, msg: 'ok', data: { list: list, box: box } }
    }

    fail('不支持的 action：' + action, 400)
  } catch (e) {
    return {
      code: e.bizCode || 500,
      msg: e.message || '服务异常'
    }
  }
}
