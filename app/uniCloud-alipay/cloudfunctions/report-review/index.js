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
  // 旧加分项已停用（2026-11-14）：分数只从新规则来，旧机制整体下线。
  // 分数改成 0 而不是删掉这行 —— buddy-complete 还在按 code 调 applyCredit，
  // 删了会让那条链路直接抛错；0 分只是不加分，链路照常走完。
  { code: 'buddy_done', delta: 0, text: '完成一次搭子（已停用）' },
  { code: 'buddy_like', delta: 0.1, text: '搭子互赞' },
  { code: 'meetup_checkin', delta: 0.1, text: '搭子双方完成赴约' },
  { code: 'quiz_pass', delta: 1.5, text: '学完《文明搭档守则》' },
  { code: 'rule_first', delta: 5, text: '首次学习《文明搭档守则》' },
  { code: 'no_show', delta: -1, text: '爽约被核实' },
  { code: 'report_upheld', delta: -3, text: '被举报且核实' },
  { code: 'misconduct', delta: -12, text: '不当行为被核实' },
  { code: 'verify_pass', delta: 0, text: '通过学生认证（已停用）' },
  { code: 'admin_adjust', delta: 0, text: '管理员调整' }
]

const CREDIT_INIT = 90
const CREDIT_MAX = 100
const CREDIT_MIN = 0
// admin_adjust 不是用户可见事件（契约 §3.1），规则列表里剔掉
const RULE_HIDDEN = ['admin_adjust', 'buddy_done', 'verify_pass']
// 90 分是「正常使用」的下限：低于它不能发需求卡、不能申请搭子，
// 只能靠做《文明搭档守则》的题爬回来（见 docs/30 信誉系统一节）。
const CREDIT_PUBLISH_MIN = 90

function pickInt(v, dft) {
  return typeof v === 'number' ? v : dft
}

function clampScore(n) {
  // 0.1 分一档（搭子互赞 +0.1）：不按十分位收口的话，
  // 累加十次会得到 90.30000000000001 这种值，落到界面上就是脏数字。
  return Math.round(Math.max(CREDIT_MIN, Math.min(CREDIT_MAX, n)) * 10) / 10
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
async function applyCredit(userId, reasonCode, refId, deduct) {
  if (!userId) throw new Error('缺少 user_id')
  const rule = await resolveRule(reasonCode)
  // 举报扣分是浮动的（1~20 按情节），规则表里只留一个默认值。
  // 传了 deduct 就用它，符号统一取负；范围夹在 1~20，防止调用方传 999 把分扣穿。
  const fixed = typeof deduct === 'number' && !isNaN(deduct) ? Math.round(Math.abs(deduct)) : 0
  const delta = fixed > 0 ? -Math.max(1, Math.min(20, fixed)) : rule.delta
  const uRes = await db
    .collection(DB_USERS)
    .doc(userId)
    .field({ credit: true, credit_score: true })
    .get()
  const before = readScore((uRes.data && uRes.data[0]) || {})
  // 已停用的旧加分项 delta 为 0：不写 0 分流水（否则变动记录被一串「+0」刷屏），
  // 但要把当前分数原样返回 —— verify-review 会把 applied.score 写回认证单。
  if (!rule.delta) return { score: before, delta: 0 }
  const after = clampScore(before + delta)
  const now = Date.now()
  await db.collection(DB_CREDIT_EVENTS).add({
    user_id: userId,
    delta: delta,
    reason_code: rule.code,
    reason_text: fixed > 0 ? rule.text + '（' + Math.abs(delta) + ' 分）' : rule.text, // 文案快照：后台以后改文案不影响历史记录
    score_after: after,
    ref_id: refId || '',
    created_at: now
  })
  await db.collection(DB_USERS).doc(userId).update({
    credit_score: after,
    credit: after
  })
  return { score: after, delta: delta }
}
// ===================== credit 核心结束 =====================

/**
 * 这次扣多少分：管理员指定 > 筛查结论（severity 1~5）> 规则默认值。
 * 返回 0 表示没指定，交给 applyCredit 用规则里的默认扣分。
 */
/**
 * 举报原因决定扣分档：被鸽是 -1、不当行为是 -12（管理员可按情节改到 1~20），
 * 其余违规统一走 report_upheld。放鸽子和辱骂不是一个量级，不能共用一个默认值。
 */
function reasonCodeOf(report) {
  const r = str(report && report.reason)
  if (r === 'no_show') return 'no_show'
  if (r === 'misconduct') return 'misconduct'
  return 'report_upheld'
}

function deductOf(report, event) {
  const given = pickInt(event && event.deduct, 0)
  if (given > 0) return given
  const ai = report && report.ai
  const sev = pickInt(ai && ai.severity, 0)
  if (sev > 0) return sev
  return 0
}

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
    // 判责对象在提交举报时就记好了（offender_id）：消息/卡片被举报，扣的是发送者或卡片主人，
    // 老数据没有这个字段就按旧口径只扣 user 类举报。
    const offenderId = str(report.offender_id) || (str(report.target_type) === 'user' ? str(report.target_id) : '')
    if (action === 'upheld' && offenderId) {
      try {
        const applied = await applyCredit(offenderId, reasonCodeOf(report), reportId, deductOf(report, event))
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
