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
 *   action = 'repair'  { token }   一次性清理「邀请没被接受却已 active」的历史脏关系
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
const DB_FRIENDS = 'friendships'
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
async function ensureRelation(userA, userB, category, sourceId, now, status) {
  const ua = userA < userB ? userA : userB
  const ub = userA < userB ? userB : userA
  // ★ 默认 active；发邀请时传 'pending' —— 关系只有在对方同意后才生效。
  const wantStatus = status === 'pending' ? 'pending' : 'active'

  // ★ 判重必须把 pending 一起看：
  //   发邀请时先建 pending，accept 时再拿同一个 (ua,ub,category) 找回来激活。
  //   如果这里只查 active，accept 会找不到那条 pending 而另建一条 active，
  //   于是同一个 category 下同时躺着 pending + active 两条，标签落在错的那条上。
  const exist = await db
    .collection(DB_RELATIONS)
    .where({
      user_a_id: ua,
      user_b_id: ub,
      category: category,
      status: dbCmd.in(['active', 'pending'])
    })
    .limit(1)
    .get()

  if (exist.data.length) {
    return { relationId: exist.data[0]._id, created: false, status: exist.data[0].status }
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
    status: wantStatus,
    ended_by: '',
    ended_at: 0,
    created_at: now
  })

  return { relationId: relRes.id, created: true, status: wantStatus }
}

/**
 * 把「发邀请时预建的 pending 关系」收掉。
 * ★ 只动 pending，绝不碰 active —— active 是已经成立的搭子关系，
 *   可能来自别的邀请或卡片申请，跟这条邀请无关。
 * ★ 用 source_invite_id 精确定位；老数据没有这个字段时退化成按
 *   (ua, ub, category) 找 pending，两个条件都限定 pending，误伤面很小。
 */
async function dropPendingRelation(inv, now, reason) {
  try {
    const ua = inv.from_user_id < inv.to_user_id ? inv.from_user_id : inv.to_user_id
    const ub = inv.from_user_id < inv.to_user_id ? inv.to_user_id : inv.from_user_id

    let rels = (
      await db
        .collection(DB_RELATIONS)
        .where({ source_invite_id: inv._id, status: 'pending' })
        .limit(10)
        .get()
    ).data

    if (!rels.length) {
      rels = (
        await db
          .collection(DB_RELATIONS)
          .where({
            user_a_id: ua,
            user_b_id: ub,
            category: inv.category || 'other',
            status: 'pending'
          })
          .limit(10)
          .get()
      ).data
    }

    for (let i = 0; i < rels.length; i++) {
      await db
        .collection(DB_RELATIONS)
        .doc(rels[i]._id)
        .update({ status: 'ended', ended_by: reason, ended_at: now })
    }
  } catch (e) {
    /* 关系收不掉不影响邀请状态本身，下次邀请会被 pending 判重挡住而已 */
  }
}

function normalizeCategory(raw) {
  const s = str(raw)
  return s || 'other'
}

exports.main = async (event) => {
  try {
    // ============ 修复历史脏数据 ============
    // ★ 老版本在「发邀请」时就建了 status:'active' 的关系，于是邀请还没被接受，
    //   对方主页就显示了「你们之间的搭子」。代码已改成先建 pending，
    //   但**已经写进库里的 active 脏关系不会自己消失**，需要跑一次这里。
    // 两条收掉规则（任一命中即收）：
    //   ① 两人已经是好友 —— 好友关系比搭子更强，不该再挂搭子（设计规则，见 03-database.md）
    //   ② 它指向的邀请不是 accepted —— 这段关系从来没被对方同意过，是预建的脏数据
    // ★ 这个分支必须在 getUserByToken 之前：运维修复时在 HBuilderX 里
    //   「上传并运行」默认不带 token，带 token 就进不来了。
    //   有 token 只修自己参与的，没 token 扫全表（一次性运维操作）。
    // ★ 也接受「完全不带参数」的调用：HBuilderX 里「上传并运行」默认不带参数，
    //   用户最容易做到的就是这个动作。无 action 无 token 的调用原本只会 401 失败，
    //   这里改成跑一次清理，幂等、安全。
    if (str(event.action) === 'repair' || (!str(event.action) && !str(event.token))) {
      const now0 = Date.now()
      const LIMIT = 200
      const meForRepair = str(event.token)
        ? (await db.collection(DB_USERS).where({ token: str(event.token) }).limit(1).get()).data[0]
        : null

      const baseWhere = { source_type: 'invite', status: 'active' }
      const conds = []
      if (meForRepair) {
        conds.push(Object.assign({ user_a_id: meForRepair._id }, baseWhere))
        conds.push(Object.assign({ user_b_id: meForRepair._id }, baseWhere))
      } else {
        conds.push(baseWhere)
      }

      const mine = []
      for (let c = 0; c < conds.length; c++) {
        const r = await db.collection(DB_RELATIONS).where(conds[c]).limit(LIMIT).get()
        ;(r.data || []).forEach(function (x) { mine.push(x) })
      }

      const fixed = []
      const skipped = []
      for (let i = 0; i < mine.length; i++) {
        const r = mine[i]

        // ★ 规则一（优先）：两人已经是好友 → 这段搭子必须收掉。
        //   这是 docs/03-database.md §2.3 早就定下的规则：「成为好友时把双方
        //   active 的搭子置 ended」。friend-request 的 accept 分支执行了它，
        //   但如果好友关系先建立、搭子是之后才冒出来的，就没人执行 ——
        //   老代码允许好友之间点邀请，正好制造出这种顺序。
        //   所以这里补一次：只要现在是好友，不管邀请状态如何，一律收掉。
        const ra = str(r.user_a_id)
        const rb = str(r.user_b_id)
        let areFriends = false
        if (ra && rb) {
          try {
            const fr = await db
              .collection(DB_FRIENDS)
              .where({ user_a_id: ra, user_b_id: rb })
              .limit(1)
              .get()
            areFriends = !!(fr.data && fr.data.length)
          } catch (e) {
            /* friendships 表还没建：当作不是好友，走下面的规则二 */
          }
        }
        if (areFriends) {
          await db.collection(DB_RELATIONS).doc(r._id).update({
            status: 'ended',
            ended_by: 'friend',
            ended_at: now0
          })
          fixed.push(r._id)
          continue
        }

        // ★ 规则二：邀请从来没被同意过 → 这条关系是预建的脏数据，收掉。
        const invId = str(r.source_invite_id)
        if (!invId) { skipped.push({ id: r._id, why: 'no_source_invite' }); continue }
        let st = ''
        try {
          const invRes = await db.collection(DB_INVITES).doc(invId).get()
          st = invRes.data && invRes.data.length ? str(invRes.data[0].status) : ''
        } catch (e) {
          skipped.push({ id: r._id, why: 'invite_missing' })
          continue
        }
        if (st === 'accepted') continue // 正常成立、两人也还不是好友的搭子，保留
        await db.collection(DB_RELATIONS).doc(r._id).update({
          status: 'ended',
          ended_by: 'repair',
          ended_at: now0
        })
        fixed.push(r._id)
      }

      return {
        code: 0,
        msg: 'ok',
        data: { scanned: mine.length, fixed: fixed.length, ids: fixed, skipped: skipped }
      }
    }

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

      // ★ 已经是好友就不再邀请搭子：好友关系比搭子更强，
      //   允许再挂一条搭子只会在两个页面上重复显示同一个人。
      const ua = me._id < toUserId ? me._id : toUserId
      const ub = me._id < toUserId ? toUserId : me._id
      try {
        const fRes = await db
          .collection(DB_FRIENDS)
          .where({ user_a_id: ua, user_b_id: ub })
          .limit(1)
          .get()
        if (fRes.data.length) fail('你们已经是好友了，不用再邀请搭子', 409)
      } catch (e) {
        // fail() 抛出的错误必须继续抛，不能被这里吞掉
        if (e && e.bizCode) throw e
        /* friendships 表还没建：当作不是好友 */
      }

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
      //
      // ★★ 但关系必须是 **pending**，不能是 active。
      //   原来这里建的是 active，于是「邀请刚发出」对方进我主页就看见
      //   「你们之间的搭子」+ 类别名，仿佛邀请已经被接受了 —— 用户反馈的
      //   「点邀请后对方直接出现搭子标签」就是这个。
      //   pending 关系只有本文件 accept 时才激活；user-profile / buddy-list /
      //   buddy-tag 全都只认 status:'active'，所以 pending 期间谁都看不见。
      try {
        const pre = await ensureRelation(me._id, toUserId, category, invRes.id, now, 'pending')
        const preDoc = (await db.collection(DB_RELATIONS).doc(pre.relationId).get()).data[0]
        if (preDoc && preDoc.status === 'pending') {
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
      // ★ 关系在这里才真正生效。invite 时建的是 pending（对方主页看不见），
      //   只有对方点了同意才切成 active。幂等：本来就是 active 的再写一次也无害。
      patch.status = 'active'
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

      // ★ 收掉发邀请时预建的 pending 关系。不收的话它会一直挂着，
      //   下次同 category 的邀请会复用这条脏关系（标签还是上次那个人起的）。
      await dropPendingRelation(inv, now, 'rejected')

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

      // ★ 同上：撤回邀请也要把预建的 pending 关系收掉
      await dropPendingRelation(inv, now, 'cancelled')

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
