'use strict'

/**
 * admin-reports —— M4 举报处理（列表 + 处置，仅管理员可用，契约 §2.1）
 *
 * 入参：{ token, action: 'list' | 'decide', status?, page?, page_size?, report_id?, decision?, reason? }
 * 出参 list：  { code:0, data: { list: [...], total, pending_count } }
 * 出参 decide：{ code:0, data: { report_id, status, credit_delta } }
 *
 * ★ 为什么管理员判定必须在任何业务读取之前：
 *   契约 §1 定死「非管理员一律 403，且不能先查再判」。先读举报再判权限，
 *   越权探测就能从 total / pending_count 读出全表规模，等于 403 白设。
 *
 * ★ 为什么单独建 admin-reports 而不动 report-review：
 *   report-review 已验收，它只管「处置一条」，没有列表；而列表要 join 出举报人
 *   和被举报人昵称，join 必须走字段白名单（uni-id-users 里有 token / phone，
 *   整条下发就是一次信息泄露）。契约 §2.1 注：职责分开，report-review 保持不动。
 *
 * ★ 为什么处置段整段照抄 report-review：
 *   云函数目录自包含、不许跨目录 require（契约 §2 铁律 3），
 *   所以「带 status:'pending' 条件的原子 update + report_upheld 扣 10」只能内联一份。
 *   照抄是为了让两处口径一致 —— 改这里必须同步改 report-review，否则出现两套扣分规则。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_REPORTS = 'reports'

// 举报原因的中文文案：与 pages/report/report.vue:55-58 的 label 逐字一致。
// 为什么不信任前端传中文：reports 表里 reason 只存 key，后台必须能统一口径显示，
// 否则同一条举报在两端文案不同，运营对不上号。
const REASON_TEXT = {
  harassment: '骚扰谩骂',
  fake: '虚假信息',
  ad: '广告推销',
  other: '其他'
}

// 列表筛选白名单：'all' 是「不限」，其余三个是 reports 表真实存在的状态
const STATUS_FILTER = ['pending', 'upheld', 'dismissed', 'all']

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

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

// 契约 §2 铁律 4：拿不到当前用户必须 500，不能当成游客放过去 ——
// 放过去之后 isAdmin 判定跑在空对象上，会静默变成「无权限」，掩盖真实故障。
// 与 title-list/index.js:80-90 同一套写法。
async function getUserByToken(token) {
  if (!token) fail('未登录，请重新登录', 500)
  let r = null
  try {
    r = await db
      .collection(DB_USERS)
      .where({ token: token })
      .field({ _id: true, nickname: true, is_admin: true, role: true })
      .limit(1)
      .get()
  } catch (e) {
    fail('登录状态读取失败，请稍后重试', 500)
  }
  if (!r.data || !r.data.length) fail('登录已过期，请重新登录', 500)
  return r.data[0]
}

/**
 * 批量补昵称：一次 in 查完，不做 N+1。
 * 举报人和被举报人可能重合，所以先去重；字段只要 _id + nickname，
 * 绝不能整条下发（token / phone 就在同一张表里）。
 */
async function loadNickMap(ids) {
  const map = {}
  if (!ids.length) return map
  try {
    const res = await db
      .collection(DB_USERS)
      .where({ _id: dbCmd.in(ids) })
      .field({ _id: true, nickname: true })
      .get()
    for (const u of res.data || []) map[u._id] = str(u.nickname)
  } catch (e) {
    // 用户表读不到只降级昵称（前端显示「同学」），列表照常返回；
    // 为了一个昵称把整页打成错误态不值。
  }
  return map
}

exports.main = async (event) => {
  try {
    event = event || {}
    // ★ 顺序铁律：先认人、再判管理员、最后才碰业务表（契约 §1）
    const me = await getUserByToken(str(event.token))
    const isAdmin = me.is_admin === true || me.role === 'admin'
    if (!isAdmin) fail('没有权限：举报处理仅管理员可用', 403)

    const action = str(event.action) || 'list'

    // ============ 列表 ============
    if (action === 'list') {
      const status = str(event.status) || 'pending'
      if (STATUS_FILTER.indexOf(status) < 0) fail('不支持的筛选状态：' + status, 400)
      const page = Math.max(1, parseInt(event.page, 10) || 1)
      const pageSize = Math.min(MAX_LIMIT, Math.max(1, parseInt(event.page_size, 10) || DEFAULT_LIMIT))
      const where = status === 'all' ? {} : { status: status }

      let rows = []
      let total = 0
      let pendingCount = 0
      try {
        const col = db.collection(DB_REPORTS)
        const countRes = await col.where(where).count()
        total = countRes.total || 0
        const listRes = await col
          .where(where)
          .field({
            reporter_id: true,
            target_type: true,
            target_id: true,
            reason: true,
            detail: true,
            evidence: true,
            offender_id: true,
            meetup: true,
            ai: true,
            status: true,
            handled_reason: true,
            created_at: true
          })
          .orderBy('created_at', 'desc') // 新举报在前：晚到的更该先处理
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get()
        rows = listRes.data || []
        // pending_count 是「待处理总数」，与当前筛选无关；
        // 筛的就是 pending 时复用 total，省一次 count。
        if (status === 'pending') {
          pendingCount = total
        } else {
          const pRes = await col.where({ status: 'pending' }).count()
          pendingCount = pRes.total || 0
        }
      } catch (e) {
        // reports 表还没建（第一次举报前）时查询会抛：对后台就是「一条都没有」，
        // 抛出去会让整个页面变成错误态（契约 §2 铁律 4）。
        console.warn('[admin-reports] reports 查询失败，按空态返回：', e && e.message)
        rows = []
        total = 0
        pendingCount = 0
      }

      const nickIds = []
      for (const r of rows) {
        const reporterId = str(r.reporter_id)
        if (reporterId && nickIds.indexOf(reporterId) < 0) nickIds.push(reporterId)
        // 判责对象的昵称也要查：处置时管理员得知道分扣在谁头上
        const offenderId = str(r.offender_id)
        if (offenderId && nickIds.indexOf(offenderId) < 0) nickIds.push(offenderId)
        // 只有 target_type === 'user' 才有「被举报人昵称」这回事；
        // 卡片 / 消息的 target_id 是内容 id，不是人，去 join 只会撞到无关用户。
        if (str(r.target_type) === 'user') {
          const targetId = str(r.target_id)
          if (targetId && nickIds.indexOf(targetId) < 0) nickIds.push(targetId)
        }
      }
      const nickMap = await loadNickMap(nickIds)

      const list = rows.map(function (r) {
        const targetType = str(r.target_type)
        const reason = str(r.reason)
        return {
          _id: r._id,
          reporter_id: str(r.reporter_id),
          reporter_name: nickMap[str(r.reporter_id)] || '同学',
          target_type: targetType,
          target_id: str(r.target_id),
          // 非 user 目标没有昵称可 join，回空串，前端按 target_type 显示「卡片」「消息」（契约 §3.4）
          target_name: targetType === 'user' ? nickMap[str(r.target_id)] || '同学' : '',
          offender_id: str(r.offender_id),
          offender_name: nickMap[str(r.offender_id)] || '',
          reason: reason,
          reason_text: REASON_TEXT[reason] || reason,
          detail: str(r.detail),
          status: str(r.status) || 'pending',
          // 下面四个是处置依据，必须跟着列表一起出去：
          // 详情面板直接拿这一条渲染，没有第二个 detail 接口可查。
          evidence: Array.isArray(r.evidence) ? r.evidence : [],
          ai: r.ai && typeof r.ai === 'object' ? r.ai : null,
          meetup: r.meetup && typeof r.meetup === 'object' ? r.meetup : null,
          handled_reason: str(r.handled_reason),
          created_at: pickInt(r.created_at, 0)
        }
      })

      return {
        code: 0,
        msg: 'ok',
        data: { list: list, total: total, pending_count: pendingCount }
      }
    }

    // ============ 处置 ============
    if (action === 'decide') {
      const reportId = str(event.report_id)
      const decision = str(event.decision)
      if (!reportId) fail('缺少 report_id', 400)
      if (decision !== 'upheld' && decision !== 'dismissed') fail('不支持的处置结果：' + decision, 400)

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
        status: decision,
        handled_by: me._id,
        handled_at: now
      }
      const reason = str(event.reason)
      // 处置理由只记一笔，字段名与 reports 表其它处理态字段保持同一前缀
      if (reason) patch.handled_reason = reason

      // ★ 带 status:'pending' 条件的原子 update 就是「抢占」：
      //   两个管理员同时点，前面那次 get 都会说 pending，两边都扣分。
      //   条件 update 只让一个人拿到 updated=1，另一个 409 —— 重复扣分就是这么挡住的。
      const upd = await db.collection(DB_REPORTS).where({ _id: reportId, status: 'pending' }).update(patch)
      const changed = pickInt(upd && (upd.updated || upd.affectedDocs), 0)
      if (!changed) fail('这条举报已经处理过了，不能重复处置', 409)

      let creditDelta = 0
      // 判责对象在提交举报时就记好了（offender_id）。
      // 口径变更：聊天里被举报成立要扣**发送者**的分（用户规则 §3.a 1~5 分），
      // 卡片被举报成立扣卡片主人 —— 内容责任人就是账号责任人。
      // 老数据没有 offender_id，回落到旧口径（只扣 user 类举报）。
      const offenderId = str(report.offender_id) || (str(report.target_type) === 'user' ? str(report.target_id) : '')
      if (decision === 'upheld' && offenderId) {
        try {
          const applied = await applyCredit(offenderId, reasonCodeOf(report), reportId, deductOf(report, event))
          creditDelta = applied.delta
        } catch (e) {
          // 举报已经是 upheld 了，回滚会让 409 失效、还可能被重复扣分；
          // 假装扣成 0 更糟 —— 管理员会以为处理完了。所以如实报 500，让人去补扣。
          console.error('[admin-reports] deduct failed', reportId, e.message)
          fail('举报已受理，但扣分写入失败，请用 admin_adjust 手动补扣：' + e.message, 500)
        }
      }

      return {
        code: 0,
        msg: 'ok',
        data: {
          report_id: reportId,
          status: decision,
          credit_delta: creditDelta
        }
      }
    }

    fail('不支持的操作：' + action)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '处理失败' }
  }
}
