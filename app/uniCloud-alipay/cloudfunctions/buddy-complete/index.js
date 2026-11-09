'use strict'

/**
 * 双方确认「这次搭完了」—— pages/buddy/buddy.vue 的关系卡用
 *
 * 入参：{ token, relation_id }
 * 出参：{ code, msg, data: { relation_id, my_done, peer_done,
 *                            done_count, rewarded, credit: { score, delta } } }
 *
 * ★ 为什么不改 buddy_relations.status 加一个 'completed'（契约 §2.3）：
 *   buddy-list 默认只查 status==='active'，加 completed 会让搭完的关系从搭子页消失，
 *   而同学之间的搭子关系是长期的、同一段关系要能反复搭。
 *   所以"完成一次"用 done_count 计数表达，关系保持 active。
 *
 * ★ 为什么先落关系再给分：
 *   关系一落库，我这侧的 done_ 位就有了值，重复点击会在幂等判断处被挡住，
 *   不会重复加分。反过来先给分、再落关系，并发两次点击就是 4 分。
 *
 * ★ 为什么双方各 +2 是两次独立写 applyCredit：
 *   契约 §3.2 明确不追求跨用户事务 —— 给对方加分失败不该抹掉我自己已写的那条流水，
 *   所以两个 try/catch 各自兜住，失败只记日志。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_RELATIONS = 'buddy_relations'

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

    const relationId = str(event.relation_id)
    if (!relationId) fail('缺少 relation_id', 400)

    // 集合还没建 / id 格式不合法时 doc().get() 会抛，一律当作"这条关系不存在"
    let rel = null
    try {
      const res = await db.collection(DB_RELATIONS).doc(relationId).get()
      rel = (res.data && res.data[0]) || null
    } catch (e) {
      rel = null
    }
    if (!rel) fail('这段搭子关系不存在', 404)

    // 关系表约定 user_a_id < user_b_id（见 card-apply），所以"我是 a 还是 b"
    // 必须按 id 判断，不能假设我是 a。
    const iAmA = rel.user_a_id === me._id
    const amB = rel.user_b_id === me._id
    if (!iAmA && !amB) fail('只有这段关系的当事人才能确认', 403)
    if (str(rel.status) !== 'active') fail('这段搭子关系已结束', 409)

    const myKey = iAmA ? 'done_a' : 'done_b'
    const peerKey = iAmA ? 'done_b' : 'done_a'
    const peerId = iAmA ? str(rel.user_b_id) : str(rel.user_a_id)
    const doneCount = pickInt(rel.done_count, 0)

    // 自己已经点过：幂等返回当前状态，绝不再给分（前端重复点、弱网重发都会走到这里）
    if (rel[myKey] === true) {
      return {
        code: 0,
        msg: 'ok',
        data: {
          relation_id: relationId,
          my_done: true,
          peer_done: rel[peerKey] === true,
          done_count: doneCount,
          rewarded: false,
          credit: { score: readScore(me), delta: 0 }
        }
      }
    }

    const now = Date.now()

    // —— 只有我这一侧确认：只记我这一个位，分数不动 ——
    if (rel[peerKey] !== true) {
      const patch = {}
      patch[myKey] = true
      await db.collection(DB_RELATIONS).doc(relationId).update(patch)
      return {
        code: 0,
        msg: 'ok',
        data: {
          relation_id: relationId,
          my_done: true,
          peer_done: false,
          done_count: doneCount,
          rewarded: false,
          credit: { score: readScore(me), delta: 0 }
        }
      }
    }

    // —— 双方都确认：先抢占这次结算，抢到的那个请求才给分 ——
    // 不能「先读后无条件写」：两个人同时点、或同一个人弱网重发两次，都会读到
    // peer_done=true 且自己还没点，于是 done_count 被加两次、双方各被给两轮分。
    // 条件放进 update 的 where 由数据库保证原子，updated===0 就是「别人已经结算过」。
    const newCount = doneCount + 1
    const claimCond = { _id: relationId }
    claimCond[peerKey] = true
    claimCond[myKey] = dbCmd.neq(true)

    let claimed = 0
    try {
      const upRes = await db.collection(DB_RELATIONS).where(claimCond).update({
        done_a: false,
        done_b: false,
        done_count: newCount,
        last_done_at: now
      })
      claimed = pickInt(upRes.updated, pickInt(upRes.affectedDocs, 0))
    } catch (e) {
      console.warn('[buddy-complete] settle failed', relationId, e.message)
      claimed = 0
    }

    // 没抢到：别人已经结算过这一次，我这侧只回真实状态，绝不加分
    if (!claimed) {
      let fresh = rel
      try {
        const res2 = await db.collection(DB_RELATIONS).doc(relationId).get()
        if (res2.data && res2.data[0]) fresh = res2.data[0]
      } catch (e) {
        // 读不到就退回开头那份快照，至少不能把接口打挂
      }
      return {
        code: 0,
        msg: 'ok',
        data: {
          relation_id: relationId,
          // 回结算后的真实状态：结算把两个 done_ 位都清了，所以这里是 false
          my_done: fresh[myKey] === true,
          peer_done: fresh[peerKey] === true,
          done_count: pickInt(fresh.done_count, doneCount),
          rewarded: false,
          credit: { score: readScore(me), delta: 0 }
        }
      }
    }

    let mine = { score: readScore(me), delta: 0 }
    try {
      mine = await applyCredit(me._id, 'buddy_done', relationId)
    } catch (e) {
      console.warn('[buddy-complete] credit for me failed', relationId, e.message)
    }
    try {
      if (peerId) await applyCredit(peerId, 'buddy_done', relationId)
    } catch (e) {
      console.warn('[buddy-complete] credit for peer failed', relationId, e.message)
    }

    return {
      code: 0,
      msg: 'ok',
      data: {
        relation_id: relationId,
        // 结算完两个 done_ 位都清 false（契约 §2.3），所以下一次还能再搭一次
        my_done: false,
        peer_done: false,
        done_count: newCount,
        rewarded: true,
        credit: { score: mine.score, delta: mine.delta }
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '确认失败' }
  }
}
