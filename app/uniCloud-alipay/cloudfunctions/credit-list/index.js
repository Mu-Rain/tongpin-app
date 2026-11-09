'use strict'

/**
 * 信誉分与明细 —— pages/credit/credit 用（契约 §3.1）
 *
 * 入参：{ token, page?=1, page_size?=20 }   page_size 上限 50
 * 出参：{ code, msg, data: { score, level, level_text, can_publish,
 *                            rules[], list[], total, page, page_size } }
 *
 * ★ 分数只读不算：users.credit_score（缺失回落 credit，再缺失回落 80），
 *   与全项目 pickInt(u.credit_score, pickInt(u.credit, 80)) 口径一致。
 *   前端不自己算分、不自己定等级，等级文案只在服务端一处，改口径不用发版前端。
 *
 * ★ rules 是"当前生效规则"而不是内置默认表：credit_rules 有数据就用表里的，
 *   这样运营改分值/文案后前端「怎么算的」立刻跟着变（契约 §1 的可升级性）。
 *
 * ★ 本文件的 credit 核心段是母本，buddy-complete / report-review / verify-review
 *   里那三段是照抄的；要改核心逻辑先改这里，再同步三处。
 */

const db = uniCloud.database()

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

function levelOf(score) {
  if (score < CREDIT_PUBLISH_MIN) return { key: 'limited', text: '受限' }
  if (score < 80) return { key: 'normal', text: '正常' }
  if (score < 90) return { key: 'good', text: '良好' }
  return { key: 'excellent', text: '优秀' }
}

exports.main = async (event) => {
  try {
    event = event || {}
    const me = await getUserByToken(str(event.token))

    const page = Math.max(1, parseInt(event.page, 10) || 1)
    const pageSize = Math.min(50, Math.max(1, parseInt(event.page_size, 10) || 20))

    const score = readScore(me)
    const level = levelOf(score)
    const rules = await loadVisibleRules()

    // 明细：credit_events 还没建时查询会抛，静默降级成空列表 ——
    // 一条流水都没有的时候信誉页必须能打开（空态），不能整页报错。
    let list = []
    let total = 0
    try {
      const col = db.collection(DB_CREDIT_EVENTS)
      const where = { user_id: me._id }
      const countRes = await col.where(where).count()
      total = pickInt(countRes.total, 0)
      const listRes = await col
        .where(where)
        .field({
          delta: true,
          reason_code: true,
          reason_text: true,
          score_after: true,
          created_at: true
        })
        .orderBy('created_at', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
      list = (listRes.data || []).map(function (row) {
        return {
          _id: row._id,
          delta: pickInt(row.delta, 0),
          reason_code: str(row.reason_code),
          reason_text: str(row.reason_text),
          score_after: pickInt(row.score_after, 0),
          created_at: pickInt(row.created_at, 0)
        }
      })
    } catch (e) {
      list = []
      total = 0
    }

    return {
      code: 0,
      msg: 'ok',
      data: {
        score: score,
        level: level.key,
        level_text: level.text,
        can_publish: score >= CREDIT_PUBLISH_MIN,
        rules: rules,
        list: list,
        total: total,
        page: page,
        page_size: pageSize
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '加载失败' }
  }
}
