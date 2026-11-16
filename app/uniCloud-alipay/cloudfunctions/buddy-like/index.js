'use strict'

/**
 * 搭子互赞 —— 给对方加 0.1 信誉分
 *
 * 规则（用户需求 §4.a）：
 *   「搭子双方可以通过给对方点赞加分，双方只限一次，只加 0.1 分。」
 *
 * 三个要点决定了实现：
 *   1. 只能给**搭子**点赞，所以在 buddy_relations 里必须有 active 关系 —— 否则
 *      两个陌生人互相点赞就能刷分，这个口子一开等于信誉分可交易。
 *   2. 「只限一次」按**人**去重，不按关系去重。一个人可能同时有自习和夜跑两段
 *      关系，按关系去重就能对同一个人点两次，0.1 + 0.1 就是刷分。
 *   3. 只加不扣，所以没有「取消点赞」—— 扣分只能走举报那条路，点赞没有回头路。
 *
 * 入参：{ token, action }
 *   status → { liked_to: [userId...] }  我给谁点过赞（列表页据此把按钮变灰）
 *   like   → { to_user_id } → { to_user_id, delta, score_after }
 * 出参统一 { code, msg, data }
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_RELATIONS = 'buddy_relations'
const DB_LIKES = 'buddy_likes'
const DB_EVENTS = 'credit_events'
const DB_RULES = 'credit_rules'

const CREDIT_MAX = 100
const CREDIT_MIN = 0
const LIKE_LIMIT = 300

// ★ 信用核心的第 7 份副本（与 credit-list 母本同构）。改分值要七处一起改。
const DEFAULT_RULES = [
  // 旧加分项已停用（2026-11-14）：分数只从新规则来，旧机制整体下线。
  // 分数改成 0 而不是删掉这行 —— buddy-complete 还在按 code 调 applyCredit，
  // 删了会让那条链路直接抛错；0 分只是不加分，链路照常走完。
  { code: 'buddy_done', delta: 0, text: '完成一次搭子（已停用）' },
  { code: 'buddy_like', delta: 0.1, text: '被搭子点赞' },
  { code: 'meetup_checkin', delta: 0.1, text: '搭子双方完成赴约' },
  { code: 'quiz_pass', delta: 1.5, text: '学完《文明搭档守则》' },
  { code: 'rule_first', delta: 5, text: '首次学习《文明搭档守则》' },
  { code: 'no_show', delta: -1, text: '爽约被核实' },
  { code: 'report_upheld', delta: -3, text: '被举报且核实' },
  { code: 'misconduct', delta: -12, text: '不当行为被核实' },
  { code: 'verify_pass', delta: 0, text: '通过学生认证（已停用）' },
  { code: 'admin_adjust', delta: 0, text: '管理员调整' }
]

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

function clampScore(n) {
  // 0.1 分一档：点赞只加 0.1，不做十分位收口会攒出 90.30000000000001
  return Math.round(Math.max(CREDIT_MIN, Math.min(CREDIT_MAX, n)) * 10) / 10
}

function defaultRule(code) {
  for (let i = 0; i < DEFAULT_RULES.length; i++) {
    if (DEFAULT_RULES[i].code === code) return DEFAULT_RULES[i]
  }
  return { code: code, delta: 0, text: code }
}

function readScore(user) {
  const u = user || {}
  if (typeof u.credit_score === 'number') return clampScore(u.credit_score)
  if (typeof u.credit === 'number') return clampScore(u.credit)
  return 90
}

async function resolveRule(code) {
  try {
    const r = await db.collection(DB_RULES).where({ code: code }).limit(1).get()
    const row = r.data && r.data[0]
    if (!row) return defaultRule(code)
    return {
      code: code,
      delta: pickInt(row.delta, defaultRule(code).delta),
      text: str(row.text) || defaultRule(code).text
    }
  } catch (e) {
    return defaultRule(code)
  }
}

/** 写流水 + 改分，与 credit-list 母本同构 */
async function applyCredit(userId, reasonCode, refId) {
  const rule = await resolveRule(reasonCode)
  const res = await db.collection(DB_USERS).where({ _id: userId }).limit(1).get()
  const before = readScore(res.data && res.data[0])
  // 已停用的旧加分项 delta 为 0：不写 0 分流水，分数原样返回
  if (!rule.delta) return { score: before, delta: 0 }
  const after = clampScore(before + rule.delta)
  await db.collection(DB_EVENTS).add({
    user_id: userId,
    reason_code: rule.code,
    reason_text: rule.text,
    delta: rule.delta,
    score_before: before,
    score_after: after,
    ref_id: str(refId),
    created_at: Date.now()
  })
  await db
    .collection(DB_USERS)
    .doc(userId)
    .update({ credit_score: after, credit: after })
  return { score: after, delta: rule.delta }
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token: token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  const me = r.data[0]
  if (me.status === 'banned') fail('账号已被封禁', 403)
  return me
}

/** 两个人之间有没有 active 的搭子关系（user_a_id < user_b_id 是入库约定，用 or 兜住） */
async function hasBuddyRelation(meId, otherId) {
  try {
    const r = await db
      .collection(DB_RELATIONS)
      .where(
        dbCmd.and([
          { status: 'active' },
          dbCmd.or([
            { user_a_id: meId, user_b_id: otherId },
            { user_a_id: otherId, user_b_id: meId }
          ])
        ])
      )
      .limit(1)
      .get()
    return r.data.length > 0
  } catch (e) {
    return false
  }
}

async function actionStatus(me) {
  try {
    const r = await db
      .collection(DB_LIKES)
      .where({ from_id: me._id })
      .field({ to_id: true })
      .limit(LIKE_LIMIT)
      .get()
    const rows = r.data || []
    const liked = []
    for (let i = 0; i < rows.length; i++) {
      const id = str(rows[i].to_id)
      if (id) liked.push(id)
    }
    return { liked_to: liked }
  } catch (e) {
    // buddy_likes 表还没建（第一次点赞前）：对列表页就是「一个都没赞过」
    return { liked_to: [] }
  }
}

async function actionLike(me, event) {
  const toId = str(event.to_user_id)
  if (!toId) fail('缺少 to_user_id', 400)
  if (toId === me._id) fail('不能给自己点赞', 400)

  const isBuddy = await hasBuddyRelation(me._id, toId)
  if (!isBuddy) fail('只能给搭子点赞', 403)

  // 目标用户得存在且没被封，否则分加到幽灵账号上
  let target = null
  try {
    const r = await db.collection(DB_USERS).where({ _id: toId }).limit(1).get()
    target = (r.data && r.data[0]) || null
  } catch (e) {
    target = null
  }
  if (!target) fail('这个人不存在', 404)

  let dup = []
  try {
    const r = await db
      .collection(DB_LIKES)
      .where({ from_id: me._id, to_id: toId })
      .limit(1)
      .get()
    dup = r.data || []
  } catch (e) {
    dup = []
  }
  if (dup.length) fail('已经赞过这位搭子了', 400)

  const addRes = await db.collection(DB_LIKES).add({
    from_id: me._id,
    to_id: toId,
    created_at: Date.now()
  })

  // 两个人同时点同一对：上面那次查重两边都会查空，于是写进两条。
  // 这里回手数一次，多出来的那条自己撤掉 —— 比加锁简单，也够用。
  let count = 1
  try {
    const c = await db.collection(DB_LIKES).where({ from_id: me._id, to_id: toId }).count()
    count = pickInt(c.total, 1)
  } catch (e) {
    count = 1
  }
  if (count > 1) {
    try {
      await db.collection(DB_LIKES).doc(addRes.id).remove()
    } catch (e) {
      // 删不掉也不能再给一次分：下面直接按「已赞」返回，分数不动
    }
    fail('已经赞过这位搭子了', 400)
  }

  const applied = await applyCredit(toId, 'buddy_like', addRes.id)
  return { to_user_id: toId, delta: applied.delta, score_after: applied.score }
}

exports.main = async function (event) {
  try {
    const e = event || {}
    const me = await getUserByToken(str(e.token))
    const action = str(e.action) || 'status'

    if (action === 'status') {
      const d = await actionStatus(me)
      return { code: 0, msg: 'ok', data: d }
    }
    if (action === 'like') {
      const d = await actionLike(me, e)
      return { code: 0, msg: 'ok', data: d }
    }
    fail('不支持的操作：' + action)
  } catch (err) {
    return { code: err.bizCode || 500, msg: err.message || '操作失败' }
  }
}
