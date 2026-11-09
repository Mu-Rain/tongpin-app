'use strict'

/**
 * 举报处置 —— 仅管理员可调（契约 §3.3）。后台页面进 M4，本轮只做云函数。
 *
 * 入参：{ token, report_id, action: 'upheld' | 'dismissed', reason? }
 * 出参：{ code, msg, data: { report_id, status, credit_delta } }
 *
 * ★ 为什么管理员判断要同时认 is_admin 和 role：
 *   set-admin 写的是 role='admin'，早期数据是 is_admin=true，只认一个会让
 *   另一种写法的管理员静默失去权限（与 verify-review/index.js:93 同一套判断）。
 *
 * ★ 为什么只有 target_type==='user' 才扣分：
 *   卡片/消息/资料被举报成立，责任在内容不在账号；对账号扣分等于把内容问题
 *   算到人头上，用户会莫名其妙掉分。契约 §3.3 定死这一点。
 *
 * ★ 为什么用带 status 条件的 update 来"抢占"这条举报，而不是先 get 再 update：
 *   两个管理员同时点的时候，前面那次 get 都会说 pending，两边都扣分。
 *   条件 update 只让一个人拿到 updated=1，另一个 409 —— 重复扣分就是这么挡住的。
 */

const db = uniCloud.database()

const DB_REPORTS = 'reports'

// ===================== credit 核心（唯一副本，其余云函数照抄这一段） =====================
// 为什么不抽公共模块：本仓库每个云函数目录上传时只打包自己，require 目录外的东西必挂，
// 所以这段在每个用得上的云函数里各内联一份，改动时四处同步（credit-list 是母本）。

const DB_USERS = 'uni-id-users'
const DB_CREDIT_EVENTS = 'credit_events'
const DB_CREDIT_RULES = 'credit_rules'

// 契约 §1 的内置默认表：credit_rules 表不存在 / 查不到 / active=false 时用它。
// 逐字照抄契约 —— 改这里等于改契约，前端「怎么算的」直接展示这些文案。
const DEFAULT_RULES = [
  { code: 'buddy_done', delta: 2, text: '完成一次搭子' },
  { code: 'no_show', delta: -5, text: '放鸽子' },
  { code: 'report_upheld', delta: -10, text: '举报被核实' },
  { code: 'verify_pass', delta: 5, text: '通过学生认证' },
  { code: 'admin_adjust', delta: 0, text: '管理员调整' }
]

const CREDIT_INIT = 80
const CREDIT_MAX = 100
const CREDIT_MIN = 0
// admin_adjust 不是用户可见事件（契约 §3.1），规则列表里剔掉
const RULE_HIDDEN = ['admin_adjust']
// 契约 §4.4：低于 60 不能发卡片
const CREDIT_PUBLISH_MIN = 60

function pickInt(v, dft) {
  return typeof v === 'number' ? v : dft
}

function clampScore(n) {
  return Math.max(CREDIT_MIN, Math.min(CREDIT_MAX, n))
}

/** 双字段兼容：历史数据里 credit 和 credit_score 都有人写，读的时候两套都要认 */
function readScore(user) {
  const u = user || {}
  return pickInt(u.credit_score, pickInt(u.credit, CREDIT_INIT))
}

function defaultRule(code) {
  for (let i = 0; i < DEFAULT_RULES.length; i++) {
    const r = DEFAULT_RULES[i]
    if (r.code === code) return { code: r.code, delta: r.delta, text: r.text }
  }
  // 未知 code 也给完整结构，调用方不用到处判空（分值未知按 0 处理，绝不误加分）
  return { code: code, delta: 0, text: code }
}

/**
 * 取当前生效规则（含隐藏项）。
 * 规则与执行分离（契约 §1）：表里有这条就用表里的 delta/text；没有、active=false、
 * 或表根本不存在 → 用内置默认。表里新增的 code 也会被带出来，
 * 这样将来加事件类型只改数据不改代码。
 */
async function loadRuleMap() {
  const map = {}
  DEFAULT_RULES.forEach(function (r) {
    map[r.code] = { code: r.code, delta: r.delta, text: r.text }
  })
  let rows = []
  try {
    const res = await db.collection(DB_CREDIT_RULES).orderBy('created_at', 'asc').limit(200).get()
    rows = res.data || []
  } catch (e) {
    // credit_rules 第一次写入前集合不存在，查询会抛；规则表只是覆盖层，
    // 抛出去会让整个信誉页打不开，所以静默回落到内置表。
    rows = []
  }
  rows.forEach(function (row) {
    const code = str(row.code)
    if (!code) return
    if (row.active === false) {
      map[code] = defaultRule(code)
      return
    }
    const dft = defaultRule(code)
    map[code] = {
      code: code,
      delta: pickInt(row.delta, dft.delta),
      text: str(row.text) || dft.text
    }
  })
  return map
}

/** 用户可见规则列表：顺序与契约 §1 表一致，表里多出来的 code 排在后面 */
async function loadVisibleRules() {
  const map = await loadRuleMap()
  const codes = DEFAULT_RULES.map(function (r) {
    return r.code
  })
  Object.keys(map).forEach(function (c) {
    if (codes.indexOf(c) < 0) codes.push(c)
  })
  const list = []
  codes.forEach(function (c) {
    if (RULE_HIDDEN.indexOf(c) >= 0) return
    const r = map[c]
    list.push({ code: r.code, delta: r.delta, text: r.text })
  })
  return list
}

async function resolveRule(code) {
  const map = await loadRuleMap()
  return map[code] || defaultRule(code)
}

/**
 * 写一行流水再改分。
 * 顺序不能反：流水是分数的唯一真相（docs/03-database.md），先改分再写流水
 * 会出现"分变了但明细里没有这一条"，信誉页和真实分数就永久对不上。
 * 失败处理留给调用方 —— 给分失败不该把主业务（确认搭子 / 认证通过）一起回滚。
 */
async function applyCredit(userId, reasonCode, refId) {
  if (!userId) throw new Error('缺少 user_id')
  const rule = await resolveRule(reasonCode)
  const uRes = await db
    .collection(DB_USERS)
    .doc(userId)
    .field({ credit: true, credit_score: true })
    .get()
  const before = readScore((uRes.data && uRes.data[0]) || {})
  const after = clampScore(before + rule.delta)
  const now = Date.now()
  await db.collection(DB_CREDIT_EVENTS).add({
    user_id: userId,
    delta: rule.delta,
    reason_code: rule.code,
    reason_text: rule.text, // 文案快照：后台以后改文案不影响历史记录
    score_after: after,
    ref_id: refId || '',
    created_at: now
  })
  await db.collection(DB_USERS).doc(userId).update({
    credit_score: after,
    credit: after
  })
  return { score: after, delta: rule.delta }
}
// ===================== credit 核心结束 =====================

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token: token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

exports.main = async (event) => {
  try {
    event = event || {}
    const me = await getUserByToken(str(event.token))
    const isAdmin = me.is_admin === true || me.role === 'admin'
    if (!isAdmin) fail('没有权限：举报处置仅管理员可用', 403)

    const reportId = str(event.report_id)
    const action = str(event.action)
    if (!reportId) fail('缺少 report_id', 400)
    if (action !== 'upheld' && action !== 'dismissed') fail('不支持的处置结果：' + action, 400)

    let report = null
    try {
      const res = await db.collection(DB_REPORTS).doc(reportId).get()
      report = (res.data && res.data[0]) || null
    } catch (e) {
      report = null
    }
    if (!report) fail('这条举报不存在', 404)
    if (str(report.status) !== 'pending') fail('这条举报已经处理过了，不能重复处置', 409)

    const now = Date.now()
    const patch = {
      status: action,
      handled_by: me._id,
      handled_at: now
    }
    const reason = str(event.reason)
    // 处置理由只记一笔，字段名与 reports 表其它处理态字段保持同一前缀
    if (reason) patch.handled_reason = reason

    const upd = await db.collection(DB_REPORTS).where({ _id: reportId, status: 'pending' }).update(patch)
    const changed = pickInt(upd && (upd.updated || upd.affectedDocs), 0)
    if (!changed) fail('这条举报已经处理过了，不能重复处置', 409)

    let creditDelta = 0
    if (action === 'upheld' && str(report.target_type) === 'user' && str(report.target_id)) {
      try {
        const applied = await applyCredit(str(report.target_id), 'report_upheld', reportId)
        creditDelta = applied.delta
      } catch (e) {
        // 举报已经是 upheld 了，回滚会让 409 失效、还可能被重复扣分；
        // 假装扣成 0 更糟 —— 管理员会以为处理完了。所以如实报 500，让人去补扣。
        console.error('[report-review] deduct failed', reportId, e.message)
        fail('举报已受理，但扣分写入失败，请用 admin_adjust 手动补扣：' + e.message, 500)
      }
    }

    return {
      code: 0,
      msg: 'ok',
      data: {
        report_id: reportId,
        status: action,
        credit_delta: creditDelta
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '处理失败' }
  }
}
