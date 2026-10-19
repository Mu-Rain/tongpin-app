'use strict'
/**
 * study-pomodoro · 番茄钟
 *
 * action = 'record' { token, minutes, completed, subject?, started_at?, finished_at? }
 *   → 写一条番茄记录。中途放弃也要写（completed=false），用于以后算完成率。
 *
 * action = 'stats'  { token }
 *   → { today:{count,minutes}, week:[7 个 {date,count,minutes}], total:{count,minutes}, completed_rate }
 *
 * 设计说明（见 docs/09-fitness-study.md §2.7）：
 *   - subject（学科）字段现在不填，但表里留着。以后做「这周数学学了几小时」不用改表。
 *   - completed=false 也存：以后做完成率、打卡连击都要靠它。只存成功的是最典型的
 *     「以后没法加功能」的写法。
 *   - 时间存 started_at / finished_at 两个毫秒时间戳 + log_date 字符串：
 *     前者算时长，后者按天聚合。两者都要，不能只留一个。
 */

const crypto = require('crypto')
const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_POMO = 'study_pomodoros'

const MIN_MINUTES = 1
const MAX_MINUTES = 180
const DEFAULT_MINUTES = 25
const MAX_SUBJECT = 20

function str(v) {
  return v === undefined || v === null ? '' : String(v)
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

function dayKey(ts) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = ('0' + (d.getMonth() + 1)).slice(-2)
  const dd = ('0' + d.getDate()).slice(-2)
  return y + '-' + m + '-' + dd
}

function newId() {
  return crypto.randomBytes(12).toString('hex')
}

async function getUserByToken(token) {
  const t = str(token)
  if (!t) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token: t }).limit(1).get()
  const list = r.data || []
  if (!list.length) fail('登录已过期，请重新登录', 401)
  const u = list[0]
  if (u.tokenExpire && u.tokenExpire < Date.now()) fail('登录已过期，请重新登录', 401)
  return u
}

// ---------------------------------------------------------------------------
async function doRecord(event, me) {
  const minutes = int(event.minutes, DEFAULT_MINUTES)
  if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    fail('番茄时长要在 ' + MIN_MINUTES + ' - ' + MAX_MINUTES + ' 分钟之间')
  }

  const completed = event.completed === true || event.completed === 1 || event.completed === '1'
  const now = Date.now()
  const startedAt = int(event.started_at, 0) || (now - minutes * 60 * 1000)
  const finishedAt = int(event.finished_at, 0) || now
  const subject = str(event.subject).slice(0, MAX_SUBJECT)

  // 防止明显错误的数据：开始时间晚于结束时间
  if (startedAt > finishedAt) fail('开始时间不能晚于结束时间')

  const doc = {
    _id: newId(),
    user_id: me._id,
    minutes: minutes,
    started_at: startedAt,
    finished_at: finishedAt,
    completed: completed,
    subject: subject,
    log_date: dayKey(finishedAt),
    created_at: now
  }
  await db.collection(DB_POMO).add(doc)

  return ok({ record: doc })
}

// ---------------------------------------------------------------------------
async function doStats(event, me) {
  const now = Date.now()
  const today = dayKey(now)

  // 本周（周一起）范围
  const dow = new Date(now).getDay()          // 0=周日
  const offsetToMonday = (dow + 6) % 7
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - offsetToMonday)
  const mondayTs = monday.getTime()

  // 拉最近 35 天（够算本周 + 展示）
  const since = now - 35 * 24 * 3600 * 1000
  const r = await db.collection(DB_POMO)
    .where({ user_id: me._id, started_at: dbCmd.gte(since) })
    .field({ minutes: true, completed: true, log_date: true, started_at: true })
    .orderBy('started_at', 'desc')
    .limit(500)
    .get()
  const list = r.data || []

  // 今日
  let todayCount = 0
  let todayMinutes = 0
  for (const p of list) {
    if (p.log_date === today) {
      // 分钟口径：只累加 completed 的记录（minutes = 这一轮设定的分钟数）。
      // 条数不分完成/未完成 —— 完成率的分母要包含放弃掉的那条。
      todayCount++
      if (p.completed) todayMinutes += int(p.minutes, 0)
    }
  }

  // 本周 7 天柱状（周一 → 周日）
  const week = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayTs)
    d.setDate(d.getDate() + i)
    const k = dayKey(d.getTime())
    let c = 0
    let m = 0
    for (const p of list) {
      if (p.log_date === k) {
        c++
        // 同今日口径：柱子高度只按 completed 的分钟数算
        if (p.completed) m += int(p.minutes, 0)
      }
    }
    week.push({
      date: k,
      label: ['一', '二', '三', '四', '五', '六', '日'][i],
      count: c,
      minutes: m,
      is_today: k === today
    })
  }

  // 累计（最近 35 天窗口内）
  let totalCount = 0
  let totalMinutes = 0
  let completedCount = 0
  for (const p of list) {
    // totalCount 保持「全部记录」口径（完成率的分母，不要改），
    // totalMinutes 只累加完成记录，与今日、本周柱保持一致。
    totalCount++
    if (p.completed) {
      totalMinutes += int(p.minutes, 0)
      completedCount++
    }
  }
  const rate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  // 连续专注天数（有完成记录的连续日期，算法同健身的 streak）
  const doneDays = {}
  for (const p of list) {
    if (p.completed) doneDays[p.log_date] = true
  }
  let streak = 0
  const cursor = new Date(now)
  cursor.setHours(12, 0, 0, 0)
  if (!doneDays[dayKey(cursor.getTime())]) cursor.setDate(cursor.getDate() - 1)
  for (let i = 0; i < 35; i++) {
    const k = dayKey(cursor.getTime())
    if (doneDays[k]) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    } else {
      break
    }
  }

  return ok({
    today: { count: todayCount, minutes: todayMinutes },
    week: week,
    total: { count: totalCount, minutes: totalMinutes, completed: completedCount },
    completed_rate: rate,
    streak: streak
  })
}

// ---------------------------------------------------------------------------
exports.main = async (event, context) => {
  let ev = event || {}
  if (ev.queryStringParameters && typeof ev.queryStringParameters === 'object') {
    ev = Object.assign({}, ev.queryStringParameters, ev)
  }

  const action = str(ev.action)

  try {
    const me = await getUserByToken(ev.token)
    if (action === 'record') return await doRecord(ev, me)
    if (action === 'stats') return await doStats(ev, me)
    return fail('不认识的动作：' + action)
  } catch (e) {
    if (e.bizCode) return { code: e.bizCode, msg: e.message }
    console.error('[study-pomodoro] 失败', action, e)
    return { code: 500, msg: '操作失败：' + (e.message || '未知错误') }
  }
}
