'use strict'
/**
 * fit-calendar —— 打卡月历（契约 §1.1）
 *
 * 入参：{ token, month }   month 形如 '2026-10'，不传默认当月
 * 出参：{ code: 0, data: { month, today, days: [...], streak, month_count, prev_has, next_has } }
 *
 * 为什么不塞进 fit-session 的 stats：
 *   stats 给的是本月打卡日这种一维列表，日历要的是跨月翻页 + 每天的次数/容量/组数；
 *   更要紧的是 stats 的连续天数算法已被 docs/09 验收过，往里加分支等于把验收过的部分
 *   重新拖回风险里。契约 §3 铁律 6 也写明：复用就复制那段逻辑，不要做共享函数。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_SESSIONS = 'fit_sessions'

// 一个月的会话上限。calender 只用来画格子，超过这个数的月份属于异常使用，
// 与其分页翻到底，不如截断并把条数留在 days 里（前端不可能一天练 500 次）。
const MAX_MONTH_SESSIONS = 500
// 连续天数的窗口，必须和 fit-session:587 的 60 天一致，否则两处算出的 streak 会不一样
const STREAK_DAYS = 60
// 按月查会话时向两侧多捞两天：会话的 log_date 取自 started_at，
// 跨零点结束的那次训练在边界上会落进邻月，留出余量再用 log_date 精确筛
const PAD_MS = 2 * 24 * 3600 * 1000

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function str(v) {
  return v === undefined || v === null ? '' : String(v)
}

function num(v, dft) {
  const n = Number(v)
  return isNaN(n) || n === null ? dft : n
}

function int(v, dft) {
  const n = parseInt(v, 10)
  return isNaN(n) ? dft : n
}

function ok(data, msg) {
  return { code: 0, msg: msg || 'ok', data: data }
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

/** 'YYYY-MM-DD'，实现与 fit-session:98-105 逐字一致 */
function dayKey(ts) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = ('0' + (d.getMonth() + 1)).slice(-2)
  const dd = ('0' + d.getDate()).slice(-2)
  return y + '-' + m + '-' + dd
}

/**
 * 查询失败一律收敛成默认值：fit_sessions 在没人练过之前根本不存在，
 * 一次查询抛错把整张日历拖成错误态，用户看到的是「坏了」而不是「还没练」。
 */
async function safeList(run, dft) {
  try {
    return await run()
  } catch (e) {
    console.warn('[fit-calendar] 查询失败，按空处理', e && e.message)
    return dft
  }
}

// ---------------------------------------------------------------------------
// 月份
// ---------------------------------------------------------------------------
function monthOf(year, mon) {
  return year + '-' + ('0' + mon).slice(-2)
}

/** 某个月的 [起, 止) 毫秒边界（本地时区，与 dayKey 同一口径） */
function monthRange(month) {
  const y = int(month.slice(0, 4), 1970)
  const m = int(month.slice(5, 7), 1)
  return {
    start: new Date(y, m - 1, 1, 0, 0, 0, 0).getTime(),
    end: new Date(y, m, 1, 0, 0, 0, 0).getTime()
  }
}

/** 前后翻月：日历左右箭头要跨年，所以按月份序号算，不要直接减字符串 */
function monthShift(month, delta) {
  const y = int(month.slice(0, 4), 1970)
  const m = int(month.slice(5, 7), 1)
  const idx = y * 12 + (m - 1) + delta
  return monthOf(Math.floor(idx / 12), (idx % 12) + 1)
}

// ---------------------------------------------------------------------------
// 身份
// ---------------------------------------------------------------------------
async function getUserByToken(token) {
  const t = str(token)
  // 契约 §3 铁律 2：拿不到当前用户返 500，日历是登录后功能，游客没有打卡可言
  if (!t) fail('未登录，请先登录', 500)
  const r = await db.collection(DB_USERS).where({ token: t }).limit(1).get()
  const list = r.data || []
  if (!list.length) fail('登录已过期，请重新登录', 500)
  const u = list[0]
  if (u.tokenExpire && u.tokenExpire < Date.now()) fail('登录已过期，请重新登录', 500)
  return u
}

// ---------------------------------------------------------------------------
// 这个月有没有记录（只用来决定箭头灰不灰）
// ---------------------------------------------------------------------------
async function hasInMonth(userId, month) {
  const r = monthRange(month)
  const list = await safeList(function () {
    return db.collection(DB_SESSIONS)
      .where({
        user_id: userId,
        status: 'done',
        started_at: dbCmd.and([dbCmd.gte(r.start - PAD_MS), dbCmd.lt(r.end + PAD_MS)])
      })
      .field({ log_date: true })
      .orderBy('started_at', 'desc')
      .limit(20)
      .get()
      .then(function (x) { return x.data || [] })
  }, [])
  // 不取 limit(1)：边界上捞到的可能是邻月的会话，要多看几条才能确认真有本月的
  for (const s of list) {
    if (str(s.log_date).indexOf(month) === 0) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function doCalendar(event, me) {
  const now = Date.now()
  const today = dayKey(now)

  const raw = str(event.month)
  const month = raw || today.slice(0, 7)
  // URL / picker 传进来的东西不可信，格式不对明确报 400，不要替调用方猜
  if (!MONTH_RE.test(month)) fail('month 格式不对，应为 2026-10 这样的年月')

  const cur = monthRange(month)

  // 本月会话：只认 status:'done'，与 fit-session 的 stats 口径一致（放弃的会话不算打卡）
  const sessions = await safeList(function () {
    return db.collection(DB_SESSIONS)
      .where({
        user_id: me._id,
        status: 'done',
        started_at: dbCmd.and([dbCmd.gte(cur.start - PAD_MS), dbCmd.lt(cur.end + PAD_MS)])
      })
      .field({ log_date: true, started_at: true, total_volume: true, total_sets: true })
      .orderBy('started_at', 'desc')
      .limit(MAX_MONTH_SESSIONS)
      .get()
      .then(function (x) { return x.data || [] })
  }, [])

  // 按天聚合：一天可能练两次，所以 count 是条数，volume / sets 是当天合计
  const dayMap = {}
  for (const s of sessions) {
    const d = str(s.log_date)
    // 补齐窗口会捞到邻月会话，这里按 log_date 精确筛回本月
    if (d.indexOf(month) !== 0) continue
    if (!dayMap[d]) dayMap[d] = { date: d, count: 0, volume: 0, sets: 0, done: true }
    const bucket = dayMap[d]
    bucket.count++
    bucket.volume += num(s.total_volume, 0)
    bucket.sets += int(s.total_sets, 0)
  }
  // 只返回有训练的日子，前端按日期 map 到格子，不需要 30 个空对象
  const days = Object.keys(dayMap).sort().map(function (k) {
    const b = dayMap[k]
    b.volume = Math.round(b.volume * 10) / 10
    return b
  })

  // 连续天数用最近 60 天的 daySet，窗口与 fit-session:587 一致
  const since = now - STREAK_DAYS * 24 * 3600 * 1000
  const recent = await safeList(function () {
    return db.collection(DB_SESSIONS)
      .where({ user_id: me._id, status: 'done', started_at: dbCmd.gte(since) })
      .field({ log_date: true })
      .orderBy('started_at', 'desc')
      .limit(200)
      .get()
      .then(function (x) { return x.data || [] })
  }, [])

  const daySet = {}
  for (const s of recent) daySet[str(s.log_date)] = true

  // 连续天数：从今天往前数，中间断一天就停
  // 注意「今天还没练」不算断——昨天练了连续天数照样算，否则每天早上打开都是 0
  let streak = 0
  const cursor = new Date(now)
  cursor.setHours(12, 0, 0, 0)
  if (!daySet[dayKey(cursor.getTime())]) {
    cursor.setDate(cursor.getDate() - 1)
  }
  for (let i = 0; i < 60; i++) {
    const k = dayKey(cursor.getTime())
    if (daySet[k]) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }

  // 前后月有没有记录 → 前端决定左右箭头灰不灰。两条查询互不依赖，并发跑
  const around = await Promise.all([
    hasInMonth(me._id, monthShift(month, -1)),
    hasInMonth(me._id, monthShift(month, 1))
  ])

  return ok({
    month: month,
    today: today,
    days: days,
    streak: streak,
    month_count: days.length,
    prev_has: around[0],
    next_has: around[1]
  })
}

// ---------------------------------------------------------------------------
exports.main = async (event, context) => {
  let ev = event || {}
  // 支付宝云走 HTTP 触发时参数在 queryStringParameters 里，合并一次省得页面两套传法
  if (ev.queryStringParameters && typeof ev.queryStringParameters === 'object') {
    ev = Object.assign({}, ev.queryStringParameters, ev)
  }

  try {
    const me = await getUserByToken(ev.token)
    return await doCalendar(ev, me)
  } catch (e) {
    // 业务错误已经带了 code；其余的真故障统一 500，不要把栈信息漏给调用方
    if (e.bizCode) return { code: e.bizCode, msg: e.message }
    console.error('[fit-calendar] 失败', e)
    return { code: 500, msg: '操作失败：' + (e.message || '未知错误') }
  }
}
