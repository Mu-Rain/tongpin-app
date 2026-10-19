'use strict'
/**
 * fit-session · 训练会话（健身板块的核心）
 *
 * action = 'start'   { token, plan_id?, day_index?, log_date? }
 *   → 开始一次训练。已经有一次未结束的会话时：
 *       计划 / 训练日一致 → 原样返回那一条（resumed: true）
 *       对不上            → 返回 { code: 409, data: { ongoing } }，
 *                           由页面问用户「继续上次」还是「结束旧的再开这次的」
 *
 * action = 'setDay'  { token, session_id, day_index }
 *   → 换训练日并落库（plan_day_index），重进页面能恢复到最新的那一天。
 *
 * action = 'planProgress' { token, plan_id }
 *   → 这套计划上次练到第几天，给「今天练什么」推算下一个训练日用。
 *
 * action = 'addSet'  { token, session_id, exercise_id, weight, reps, rest_sec?, is_warmup? }
 *   → 记一组。返回 { set, is_pr, est_1rm, best_before }
 *
 * action = 'delSet'  { token, session_id, set_id }
 *   → 删掉记错的一组。
 *
 * action = 'finish'  { token, session_id, note? }
 *   → 结束训练，汇总 total_sets / total_volume / muscles / duration_sec 写回会话。
 *     一组都没记时写 status:'abandoned'（docs/09-fitness-study.md 里定义过这个状态），
 *     统计和训练记录列表都只认 status:'done'，所以放弃的会话不会算进打卡。
 *
 * action = 'list'    { token, page?, page_size?, limit? }
 *   → 训练历史（按 started_at 倒序）。page / page_size 是分页口径，
 *     limit 保留给老调用（等价 page_size），返回里给 has_more。
 *
 * action = 'detail'  { token, session_id }
 *   → 一次训练的明细：会话 + 按动作分组的组记录。
 *
 * action = 'stats'   { token }
 *   → 健身首页要的数字：本周次数 / 连续天数 / 本月打卡日 / 总容量。
 *
 * ---------------------------------------------------------------------------
 * 为什么这 7 个 action 挤在一个云函数里
 *   它们共享同一套「这个人是不是这次训练的主人」的校验。
 *   拆成 7 个函数就要把 getSession + 权限判断复制 7 遍——
 *   项目里 card-apply 已经吃过这个亏（见那边的注释），改一处忘一处。
 *
 * 关键设计（见 docs/09-fitness-study.md）：
 *   1) 打卡日 log_date 用 'YYYY-MM-DD' 字符串，不用时间戳——
 *      只有字符串才能保证「同一天」可比较、可做唯一约束（沿用 03 文档约定）。
 *   2) 组记录 fit_sets 里冗余 exercise_name / muscle / user_id / est_1rm，
 *      让「容量统计、PR 曲线、部位占比」以后能一次查出来，不用 join。
 *   3) is_pr 在写入时判定并落库——以后要改判定规则，老数据不会跟着变，这是刻意的。
 */

const crypto = require('crypto')
const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_EX = 'fit_exercises'
const DB_SESSIONS = 'fit_sessions'
const DB_SETS = 'fit_sets'

const MAX_WEIGHT = 500        // kg，防止手滑输入 9999
const MAX_REPS = 200
const MAX_REST = 1800         // 秒
const MAX_NOTE = 200
const MAX_SETS_PER_EXERCISE = 20
// 一次训练最多记多少组。finish / detail 都用 .limit(MAX_SETS_PER_SESSION) 一次捞全，
// 语义依赖 doAddSet 里的守护：超过这个数就记不进去了，所以汇总不会静默偏小。
const MAX_SETS_PER_SESSION = 500
const MAX_DAY_INDEX = 31     // 训练日 index 上限，防止 URL 传进来的值越界落库

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

/** 'YYYY-MM-DD'（用云函数所在时区，支付宝云是 UTC+8） */
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

/**
 * 估算 1RM（Epley 公式）
 *   weight × (1 + reps / 30)
 * 对 reps ≤ 12 足够准；自重动作（weight=0）返回 0。
 * 现在就存下来，以后 PR 曲线 / RM 计算器直接用。
 */
function estimate1RM(weight, reps) {
  if (!weight || weight <= 0) return 0
  return Math.round(weight * (1 + reps / 30) * 10) / 10
}

// ---------------------------------------------------------------------------
// 身份
// ---------------------------------------------------------------------------
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

/** 取会话并校验归属 —— 所有写操作都先过这一关 */
async function getMySession(sessionId, me) {
  const id = str(sessionId)
  if (!id) fail('缺少 session_id')
  const r = await db.collection(DB_SESSIONS).where({ _id: id }).limit(1).get()
  const list = r.data || []
  if (!list.length) fail('这次训练不存在或已被删除', 404)
  const s = list[0]
  if (s.user_id !== me._id) fail('你只能操作自己的训练记录', 403)
  return s
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------
async function doStart(event, me) {
  const now = Date.now()
  const today = dayKey(now)
  const planId = str(event.plan_id)
  // 0 = 调用方没指定训练日（例如从「继续上次训练」进来），此时不校验训练日
  const dayIndex = int(event.day_index, 0)
  if (dayIndex < 0 || dayIndex > MAX_DAY_INDEX) fail('训练日参数不对（1 - ' + MAX_DAY_INDEX + '）')

  // 已经有一次没结束的训练 → 计划/训练日一致才继续它。
  // 理由：用户中途退出 App 再进来，应该继续那次训练，而不是凭空多一条。
  // 但不一致时不能静默复用：会话数据属于计划 A，页面标题和动作列表却按 URL 里的计划 B 显示。
  const ongoing = await db.collection(DB_SESSIONS)
    .where({ user_id: me._id, status: 'ongoing' })
    .orderBy('started_at', 'desc')
    .limit(1)
    .get()

  const ongoingList = ongoing.data || []
  if (ongoingList.length) {
    const o = ongoingList[0]
    const samePlan = str(o.plan_id) === planId
    const sameDay = dayIndex <= 0 || int(o.plan_day_index, 1) === dayIndex
    if (!samePlan || !sameDay) {
      // 409 而不是 fail()：要把 ongoing 的摘要一起带给页面，fail 只带 msg
      return {
        code: 409,
        msg: '你有一次未结束的训练（' + (o.plan_name || '自由训练') + '），先决定是继续它还是结束它',
        data: {
          ongoing: {
            _id: o._id,
            plan_id: o.plan_id || '',
            plan_name: o.plan_name || '',
            plan_day_index: int(o.plan_day_index, 1),
            started_at: num(o.started_at, 0),
            log_date: o.log_date || ''
          }
        }
      }
    }
    return ok({
      session: o,
      resumed: true,
      msg: '你已经有一次没结束的训练，继续它'
    })
  }

  // 补计划名，冗余进会话（计划以后改名，历史记录不变）
  let planName = ''
  if (planId) {
    try {
      const pr = await db.collection('fit_plans').where({ _id: planId }).field({ name: true }).limit(1).get()
      const pl = pr.data || []
      if (pl.length) planName = pl[0].name || ''
    } catch (e) {
      console.warn('[fit-session] 取计划名失败', e.message)
    }
  }

  const doc = {
    _id: newId(),
    user_id: me._id,
    plan_id: planId,
    plan_name: planName,
    plan_day_index: dayIndex > 0 ? dayIndex : 1,
    log_date: today,
    started_at: now,
    finished_at: 0,
    duration_sec: 0,
    total_sets: 0,
    total_volume: 0,
    muscles: [],
    note: '',
    status: 'ongoing',
    created_at: now,
    updated_at: now
  }

  await db.collection(DB_SESSIONS).add(doc)

  return ok({ session: doc, resumed: false })
}

// ---------------------------------------------------------------------------
// setDay —— 换训练日并落库
// ---------------------------------------------------------------------------
async function doSetDay(event, me) {
  const session = await getMySession(event.session_id, me)
  if (session.status !== 'ongoing') fail('这次训练已经结束了，不能再换训练日')

  const dayIndex = int(event.day_index, 0)
  if (dayIndex < 1 || dayIndex > MAX_DAY_INDEX) {
    fail('训练日参数不对（1 - ' + MAX_DAY_INDEX + '）')
  }

  await db.collection(DB_SESSIONS).doc(session._id).update({
    plan_day_index: dayIndex,
    updated_at: Date.now()
  })

  return ok({ session_id: session._id, plan_day_index: dayIndex })
}

// ---------------------------------------------------------------------------
// planProgress —— 这套计划上次练到第几天
// ---------------------------------------------------------------------------
async function doPlanProgress(event, me) {
  const planId = str(event.plan_id)
  if (!planId) fail('缺少 plan_id')

  const r = await db.collection(DB_SESSIONS)
    .where({ user_id: me._id, plan_id: planId, status: 'done' })
    .orderBy('started_at', 'desc')
    .field({ plan_day_index: true, log_date: true, started_at: true })
    .limit(1)
    .get()
  const list = r.data || []
  const last = list.length ? list[0] : null

  return ok({
    plan_id: planId,
    last_day_index: last ? int(last.plan_day_index, 0) : 0,
    last_log_date: last ? str(last.log_date) : '',
    last_started_at: last ? num(last.started_at, 0) : 0
  })
}

// ---------------------------------------------------------------------------
// addSet
// ---------------------------------------------------------------------------
async function doAddSet(event, me) {
  const session = await getMySession(event.session_id, me)
  if (session.status !== 'ongoing') fail('这次训练已经结束了，不能再加组')

  const exerciseId = str(event.exercise_id)
  if (!exerciseId) fail('缺少 exercise_id')

  const weight = num(event.weight, 0)
  const reps = int(event.reps, 0)
  const restSec = int(event.rest_sec, 0)
  const isWarmup = event.is_warmup === true || event.is_warmup === 1 || event.is_warmup === '1'

  if (weight < 0 || weight > MAX_WEIGHT) fail('重量要在 0 - ' + MAX_WEIGHT + ' 公斤之间')
  if (reps <= 0 || reps > MAX_REPS) fail('次数要在 1 - ' + MAX_REPS + ' 之间')
  if (restSec < 0 || restSec > MAX_REST) fail('休息时间要在 0 - ' + MAX_REST + ' 秒之间')

  // 取动作资料（名字、肌群都要冗余进 set）
  const er = await db.collection(DB_EX).where({ _id: exerciseId }).field({ name: true, muscle: true, active: true }).limit(1).get()
  const exList = er.data || []
  if (!exList.length) fail('这个动作不存在', 404)
  const ex = exList[0]

  // 这个动作在这次训练里已经记了几组，顺带把现有组的 set_index 一起拿回来。
  // 为什么要顺带：set_index 用「已有最大值 + 1」而不是「组数 + 1」——
  // 删掉中间某一组之后组数会变少，用组数+1 会跟还留着的那组撞号。
  const existR = await db.collection(DB_SETS)
    .where({ session_id: session._id, exercise_id: exerciseId })
    .field({ set_index: true })
    .limit(MAX_SETS_PER_EXERCISE)
    .get()
  const existSets = existR.data || []
  const existing = existSets.length
  if (existing >= MAX_SETS_PER_EXERCISE) {
    fail('同一个动作一次训练最多记 ' + MAX_SETS_PER_EXERCISE + ' 组')
  }
  let maxSetIndex = 0
  for (const s of existSets) {
    const v = int(s.set_index, 0)
    if (v > maxSetIndex) maxSetIndex = v
  }

  // 一次训练的总组数上限。finish / detail 都靠 .limit(MAX_SETS_PER_SESSION) 一次捞全，
  // 不在这里拦住的话，超出的组会让 total_sets / total_volume / 明细静默偏小。
  const sessCntR = await db.collection(DB_SETS)
    .where({ session_id: session._id })
    .count()
  const sessionSets = sessCntR.total || 0
  if (sessionSets >= MAX_SETS_PER_SESSION) {
    fail('一次训练最多记 ' + MAX_SETS_PER_SESSION + ' 组，先结束这次再开新的', 429)
  }

  // ---- PR 判定：只跟**这次训练之前**的历史最大重量比（热身组不参与） ----
  // 查询里排除本次会话，所以基准是「进这次训练之前的水平」。
  // 这意味着同一次训练里 20kg → 25kg 会连弹两次新纪录 —— 这是有意的：
  // 每一组只要超过历史水平都算突破。若哪天要改成「一次训练最多弹一次」，
  // 应该让基准同时取「历史最大」和「本次已记最大」的较大值，而不是改动这里的过滤。
  const est1rm = estimate1RM(weight, reps)
  let isPr = false
  let bestBefore = 0
  if (!isWarmup && weight > 0) {
    try {
      const br = await db.collection(DB_SETS)
        .where({
          user_id: me._id,
          exercise_id: exerciseId,
          session_id: dbCmd.neq(session._id),
          is_warmup: dbCmd.neq(true),
          weight: dbCmd.gt(0)
        })
        .orderBy('weight', 'desc')
        .field({ weight: true })
        .limit(1)
        .get()
      const bl = br.data || []
      if (bl.length) bestBefore = num(bl[0].weight, 0)
      isPr = weight > bestBefore
    } catch (e) {
      // 查不到历史（第一次练这个动作）不算错，当作没有记录
      console.warn('[fit-session] PR 查询失败，按无记录处理', e.message)
      bestBefore = 0
      isPr = true
    }
  }

  const now = Date.now()
  const setDoc = {
    _id: newId(),
    session_id: session._id,
    user_id: me._id,
    exercise_id: exerciseId,
    exercise_name: ex.name || '',
    muscle: ex.muscle || '',
    set_index: maxSetIndex + 1,
    weight: weight,
    reps: reps,
    rest_sec: restSec,
    is_warmup: isWarmup,
    is_pr: isPr,
    est_1rm: est1rm,
    done_at: now,
    created_at: now
  }
  await db.collection(DB_SETS).add(setDoc)

  // 会话上同步维护一个 muscles 去重列表（部位概览要用）
  const muscles = (session.muscles || []).slice()
  if (ex.muscle && muscles.indexOf(ex.muscle) < 0) muscles.push(ex.muscle)
  await db.collection(DB_SESSIONS).doc(session._id).update({
    muscles: muscles,
    updated_at: now
  })

  return ok({
    set: setDoc,
    is_pr: isPr,
    est_1rm: est1rm,
    best_before: bestBefore,
    set_count: existing + 1
  })
}

// ---------------------------------------------------------------------------
// delSet
// ---------------------------------------------------------------------------
async function doDelSet(event, me) {
  const session = await getMySession(event.session_id, me)
  if (session.status !== 'ongoing') fail('这次训练已经结束了，不能删组')

  const setId = str(event.set_id)
  if (!setId) fail('缺少 set_id')

  const r = await db.collection(DB_SETS).where({ _id: setId }).limit(1).get()
  const list = r.data || []
  if (!list.length) fail('这一组不存在', 404)
  if (list[0].session_id !== session._id || list[0].user_id !== me._id) {
    fail('你只能删自己的记录', 403)
  }

  await db.collection(DB_SETS).doc(setId).remove()

  return ok({ deleted: setId })
}

// ---------------------------------------------------------------------------
// finish
// ---------------------------------------------------------------------------
async function doFinish(event, me) {
  const session = await getMySession(event.session_id, me)
  if (session.status !== 'ongoing') {
    return ok({ session: session, already: true, msg: '这次训练已经结束过了' })
  }

  const note = str(event.note).slice(0, MAX_NOTE)

  // 把这个会话的所有组捞出来做汇总。
  // limit(MAX_SETS_PER_SESSION) 的语义依赖 doAddSet 的会话级守护：
  // 单次会话最多 500 组，所以这里一次就能捞全，不会被静默截断。
  const sr = await db.collection(DB_SETS)
    .where({ session_id: session._id })
    .field({ weight: true, reps: true, is_warmup: true, muscle: true })
    .limit(MAX_SETS_PER_SESSION)
    .get()
  const sets = sr.data || []

  let totalSets = 0
  let totalVolume = 0
  const muscles = {}
  for (const s of sets) {
    if (s.is_warmup) continue
    totalSets++
    totalVolume += num(s.weight, 0) * int(s.reps, 0)
    if (s.muscle) muscles[s.muscle] = true
  }

  const now = Date.now()
  const durationSec = Math.max(0, Math.round((now - num(session.started_at, now)) / 1000))

  // 一组都没记 → 'abandoned'（docs/09-fitness-study.md 定义过这个状态，之前代码里没用上）。
  // doStats 和 doList 都只认 status:'done'，所以放弃的会话不会算进打卡，也不会出现在训练记录页。
  // 这里用 sets.length 而不是 totalSets：只记了热身组也算真的动过，不该被丢掉。
  const abandoned = sets.length === 0

  const patch = {
    finished_at: now,
    duration_sec: durationSec,
    total_sets: totalSets,
    total_volume: Math.round(totalVolume * 10) / 10,
    muscles: Object.keys(muscles),
    note: note,
    status: abandoned ? 'abandoned' : 'done',
    updated_at: now
  }
  await db.collection(DB_SESSIONS).doc(session._id).update(patch)

  return ok({
    session: Object.assign({}, session, patch),
    abandoned: abandoned,
    summary: {
      total_sets: patch.total_sets,
      total_volume: patch.total_volume,
      duration_sec: patch.duration_sec,
      muscles: patch.muscles
    }
  })
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
async function doList(event, me) {
  // page / page_size 是分页口径；limit 保留给老调用（history 之前传 limit:30）
  const pageSize = Math.min(50, Math.max(1, int(event.page_size, int(event.limit, 20))))
  const page = Math.max(1, int(event.page, 1))

  const r = await db.collection(DB_SESSIONS)
    .where({ user_id: me._id, status: 'done' })
    .orderBy('started_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  const list = (r.data || []).map(function (s) {
    return {
      _id: s._id,
      plan_id: s.plan_id,
      plan_name: s.plan_name,
      log_date: s.log_date,
      started_at: s.started_at,
      duration_sec: s.duration_sec,
      total_sets: s.total_sets,
      total_volume: s.total_volume,
      muscles: s.muscles || [],
      note: s.note || ''
    }
  })

  return ok({
    list: list,
    page: page,
    page_size: pageSize,
    // 满页就假定还有下一页，省一次 count（和 fit-exercise 的 doList 同一套口径）
    has_more: list.length === pageSize
  })
}

// ---------------------------------------------------------------------------
// detail
// ---------------------------------------------------------------------------
async function doDetail(event, me) {
  const session = await getMySession(event.session_id, me)

  // limit(MAX_SETS_PER_SESSION) 的语义依赖 doAddSet 的会话级守护（单次会话最多 500 组），
  // 否则超过 500 组的会话明细会静默缺尾。
  const sr = await db.collection(DB_SETS)
    .where({ session_id: session._id })
    .orderBy('created_at', 'asc')
    .limit(MAX_SETS_PER_SESSION)
    .get()
  const sets = sr.data || []

  // 按动作分组，保持出现顺序
  const groupMap = {}
  const groupOrder = []
  for (const s of sets) {
    const key = s.exercise_id
    if (!groupMap[key]) {
      groupMap[key] = {
        exercise_id: key,
        exercise_name: s.exercise_name,
        muscle: s.muscle,
        sets: []
      }
      groupOrder.push(key)
    }
    groupMap[key].sets.push({
      _id: s._id,
      set_index: s.set_index,
      weight: s.weight,
      reps: s.reps,
      rest_sec: s.rest_sec,
      is_warmup: !!s.is_warmup,
      is_pr: !!s.is_pr,
      est_1rm: s.est_1rm
    })
  }

  return ok({
    session: session,
    groups: groupOrder.map(function (k) { return groupMap[k] }),
    total_sets: sets.length
  })
}

// ---------------------------------------------------------------------------
// stats —— 健身首页的数字
// ---------------------------------------------------------------------------
async function doStats(event, me) {
  const now = Date.now()
  const today = dayKey(now)

  // 连续天数 & 本月打卡日：拉最近 60 天已完成的会话（一天可能多条，按 log_date 去重）
  const since = now - 60 * 24 * 3600 * 1000
  const r = await db.collection(DB_SESSIONS)
    .where({ user_id: me._id, status: 'done', started_at: dbCmd.gte(since) })
    .field({ log_date: true, started_at: true, total_volume: true, total_sets: true })
    .orderBy('started_at', 'desc')
    .limit(200)
    .get()
  const sessions = r.data || []

  const daySet = {}
  for (const s of sessions) daySet[s.log_date] = true
  const dayList = Object.keys(daySet).sort()  // 升序

  // 本月打卡日
  const monthPrefix = today.slice(0, 7)
  const monthDays = dayList.filter(function (d) { return d.indexOf(monthPrefix) === 0 })

  // 本周（周一起算）次数
  const dow = new Date(now).getDay()             // 0=周日
  const offsetToMonday = (dow + 6) % 7           // 周一=0
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - offsetToMonday)
  const mondayKey = dayKey(monday.getTime())
  let weekCount = 0
  for (const s of sessions) {
    if (s.log_date >= mondayKey) weekCount++
  }

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

  // 总容量 & 总次数（最近 60 天）
  let volume = 0
  let sets = 0
  for (const s of sessions) {
    volume += num(s.total_volume, 0)
    sets += int(s.total_sets, 0)
  }

  // 有没有正在进行中的训练
  const onr = await db.collection(DB_SESSIONS)
    .where({ user_id: me._id, status: 'ongoing' })
    .orderBy('started_at', 'desc')
    .limit(1)
    .get()
  const onList = onr.data || []

  return ok({
    today: today,
    week_count: weekCount,
    streak: streak,
    month_days: monthDays,
    month_count: monthDays.length,
    total_volume: Math.round(volume * 10) / 10,
    total_sets: sets,
    active_session: onList.length ? onList[0] : null
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
    // stats / 未登录也要给数字（首页可能是游客在看）——但目前健身是登录后功能，统一要求登录
    const me = await getUserByToken(ev.token)

    if (action === 'start') return await doStart(ev, me)
    if (action === 'setDay') return await doSetDay(ev, me)
    if (action === 'planProgress') return await doPlanProgress(ev, me)
    if (action === 'addSet') return await doAddSet(ev, me)
    if (action === 'delSet') return await doDelSet(ev, me)
    if (action === 'finish') return await doFinish(ev, me)
    if (action === 'list') return await doList(ev, me)
    if (action === 'detail') return await doDetail(ev, me)
    if (action === 'stats') return await doStats(ev, me)
    return fail('不认识的动作：' + action)
  } catch (e) {
    if (e.bizCode) return { code: e.bizCode, msg: e.message }
    console.error('[fit-session] 失败', action, e)
    return { code: 500, msg: '操作失败：' + (e.message || '未知错误') }
  }
}
