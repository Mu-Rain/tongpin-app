'use strict'
/**
 * fit-plan · 训练计划
 *
 * action = 'list'   { goal?, source? }        → 计划列表（不带头部动作明细，只带摘要）
 * action = 'detail' { plan_id }               → 计划详情：{ plan, days:[{day_index, day_name, items:[...]}] }
 *
 * 为什么 list 和 detail 必须分开：
 *   计划列表页只显示卡片（名称 + 每周几练 + 一句话），一次 5 条；
 *   如果把 30 条动作明细一起塞进列表，大厅每翻一页都要多查 5 次子表。
 *   这和 card-list / card-detail 的拆分理由完全一样。
 *
 * 数据量说明：
 *   官方模板 5 套，每套 1-3 个训练日，每个训练日 4-6 个动作 → 明细分表约 60 条。
 *   详情一次查完不分页（limit 200 兜底）。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_PLAN = 'fit_plans'
const DB_ITEM = 'fit_plan_items'

const GOALS = ['muscle', 'fat_loss', 'shaping', 'stretch', 'strength']
const MAX_ITEMS = 200

const PLAN_FIELDS = {
  _id: true,
  name: true,
  goal: true,
  level: true,
  days_per_week: true,
  duration_weeks: true,
  source: true,
  desc: true,
  cover_color: true,
  tags: true,
  sort: true
}

const ITEM_FIELDS = {
  _id: true,
  plan_id: true,
  day_index: true,
  day_name: true,
  exercise_id: true,
  exercise_name: true,
  sets: true,
  reps: true,
  rest: true,
  sort: true
}

function str(v) {
  return v === undefined || v === null ? '' : String(v)
}

function ok(data, msg) {
  return { code: 0, msg: msg || 'ok', data: data }
}

function fail(msg, code) {
  return { code: code || 400, msg: msg }
}

// ---------------------------------------------------------------------------
async function doList(event) {
  const goal = str(event.goal)
  const source = str(event.source) || 'official'

  const where = { active: true, source: source }
  if (goal && GOALS.indexOf(goal) >= 0) where.goal = goal

  const r = await db.collection(DB_PLAN)
    .where(where)
    .field(PLAN_FIELDS)
    .orderBy('sort', 'asc')
    .limit(50)
    .get()

  const list = r.data || []

  // 给每套计划补一个「共几个训练日 / 共几个动作」，卡片上显示
  // 一次查全部明细再统计，比每套计划各查一次省 4 次调用
  let items = []
  try {
    const ir = await db.collection(DB_ITEM)
      .where({ plan_id: dbCmd.in(list.map(function (p) { return p._id })) })
      .field({ plan_id: true, day_index: true })
      .limit(MAX_ITEMS)
      .get()
    items = ir.data || []
  } catch (e) {
    console.warn('[fit-plan] 统计明细失败', e.message)
  }

  const daysByPlan = {}
  const itemsByPlan = {}
  for (const it of items) {
    itemsByPlan[it.plan_id] = (itemsByPlan[it.plan_id] || 0) + 1
    if (!daysByPlan[it.plan_id]) daysByPlan[it.plan_id] = {}
    daysByPlan[it.plan_id][it.day_index] = true
  }

  const out = list.map(function (p) {
    return Object.assign({}, p, {
      day_count: Object.keys(daysByPlan[p._id] || {}).length,
      item_count: itemsByPlan[p._id] || 0
    })
  })

  return ok({ list: out, goals: GOALS })
}

// ---------------------------------------------------------------------------
async function doDetail(event) {
  const planId = str(event.plan_id)
  if (!planId) return fail('缺少 plan_id')

  const pr = await db.collection(DB_PLAN).where({ _id: planId }).field(PLAN_FIELDS).limit(1).get()
  const plans = pr.data || []
  if (!plans.length) return fail('这套计划不存在或已下架', 404)
  const plan = plans[0]

  const ir = await db.collection(DB_ITEM)
    .where({ plan_id: planId })
    .field(ITEM_FIELDS)
    .orderBy('day_index', 'asc')
    .orderBy('sort', 'asc')
    .limit(MAX_ITEMS)
    .get()

  const items = ir.data || []

  // 按训练日分组，同时保持 day_index 升序
  const dayMap = {}
  const dayOrder = []
  for (const it of items) {
    const key = String(it.day_index)
    if (!dayMap[key]) {
      dayMap[key] = {
        day_index: it.day_index,
        day_name: it.day_name || ('第 ' + it.day_index + ' 天'),
        items: []
      }
      dayOrder.push(key)
    }
    dayMap[key].items.push({
      _id: it._id,
      exercise_id: it.exercise_id,
      exercise_name: it.exercise_name,
      sets: it.sets,
      reps: it.reps,
      rest: it.rest,
      sort: it.sort
    })
  }
  dayOrder.sort(function (a, b) { return Number(a) - Number(b) })

  return ok({
    plan: plan,
    days: dayOrder.map(function (k) { return dayMap[k] }),
    total_items: items.length
  })
}

// ---------------------------------------------------------------------------
exports.main = async (event, context) => {
  let ev = event || {}
  if (ev.queryStringParameters && typeof ev.queryStringParameters === 'object') {
    ev = Object.assign({}, ev.queryStringParameters, ev)
  }

  const action = str(ev.action) || 'list'

  try {
    if (action === 'list') return await doList(ev)
    if (action === 'detail') return await doDetail(ev)
    return fail('不认识的动作：' + action)
  } catch (e) {
    console.error('[fit-plan] 失败', action, e)
    return fail('查询失败：' + (e.message || '未知错误'), 500)
  }
}
