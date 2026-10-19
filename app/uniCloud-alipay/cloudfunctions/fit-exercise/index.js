'use strict'
/**
 * fit-exercise · 动作库查询
 *
 * action = 'list'   { muscle?, equipment?, keyword?, page?, page_size? }
 *           → { code:0, data:{ list:[...], total_returned, page, page_size, has_more } }
 * action = 'detail' { exercise_id }
 *           → { code:0, data:{ exercise } }
 * action = 'groups' {}  → 肌群 / 器械分组的数量统计（前端左栏角标用）
 *           → { code:0, data:{ muscles:[{key,count}], equipments:[{key,count}] } }
 *
 * 设计说明：
 *   动作库是公共数据，**不需要登录**也能看（token 可选）。
 *   这和搭子大厅的逻辑一致：先让人看到内容，注册后再参与。
 *
 * 为什么 list 和 detail 放一个函数：
 *   都是只读查询、都不需要写权限校验，拆开只多一次部署成本。
 *   （写操作在 fit-session，那才需要严格的身份校验。）
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_EX = 'fit_exercises'

const DEFAULT_LIMIT = 40
const MAX_LIMIT = 100

// 与 docs/09-fitness-study.md §2.6 保持一致，顺序即列表展示顺序
const MUSCLES = ['chest', 'back', 'shoulder', 'biceps', 'triceps', 'legs', 'glutes', 'core', 'forearm', 'calf', 'cardio', 'stretch']
const EQUIPMENTS = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'other']

// 外发字段白名单：owner_id / is_custom 这类内部字段不发
const FIELDS = {
  _id: true,
  name: true,
  alias: true,
  muscle: true,
  muscle_sub: true,
  equipment: true,
  mechanics: true,
  force: true,
  level: true,
  default_sets: true,
  default_reps: true,
  default_rest: true,
  secondary: true,
  tip: true,
  sort: true
}

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
  return { code: code || 400, msg: msg }
}

/** 正则转义：关键词里可能有 ( ) . * 等，直接拼进正则会报错 */
function escReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
function doList(event) {
  const page = Math.max(1, int(event.page, 1))
  const pageSize = Math.min(MAX_LIMIT, Math.max(1, int(event.page_size, DEFAULT_LIMIT)))
  const muscle = str(event.muscle)
  const equipment = str(event.equipment)
  const keyword = str(event.keyword).trim()

  const where = { active: true }
  if (muscle && MUSCLES.indexOf(muscle) >= 0) where.muscle = muscle
  if (equipment && EQUIPMENTS.indexOf(equipment) >= 0) where.equipment = equipment

  let query
  if (keyword) {
    // 名称 / 别名 两个字段模糊匹配
    const reg = new RegExp(escReg(keyword), 'i')
    const kwCond = dbCmd.or([{ name: reg }, { alias: reg }])
    query = db.collection(DB_EX).where(dbCmd.and([where, kwCond]))
  } else {
    query = db.collection(DB_EX).where(where)
  }

  return query
    .field(FIELDS)
    .orderBy('muscle', 'asc')
    .orderBy('sort', 'asc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()
    .then(function (res) {
      const list = res.data || []
      return ok({
        list: list,
        total_returned: list.length,
        page: page,
        page_size: pageSize,
        // 没有 count 查询，用「满页」判断是否还有更多——省一次全表 count
        has_more: list.length === pageSize
      })
    })
}

// ---------------------------------------------------------------------------
async function doDetail(event) {
  const id = str(event.exercise_id)
  if (!id) return fail('缺少 exercise_id')

  const r = await db.collection(DB_EX).where({ _id: id }).field(FIELDS).limit(1).get()
  const list = r.data || []
  if (!list.length) return fail('这个动作不存在或已下架', 404)

  return ok({ exercise: list[0] })
}

// ---------------------------------------------------------------------------
/**
 * 分组计数：每个肌群有多少个动作、每个器械有多少个动作。
 * 前端左栏和顶部器械栏的数字角标用。
 *
 * 为什么用 count 而不是拉全表：
 *   动作库以后扩到几百个时，拉全表会慢；count 走索引很快。
 *   12 + 8 = 20 次 count，对免费版额度来说一天也就几百次，可接受。
 *   如果以后调用量上去了，这里应该改成一次聚合（uniCloud 支付宝云支持 aggregate）。
 */
async function doGroups() {
  const muscles = []
  const equipments = []

  for (const m of MUSCLES) {
    let c = 0
    try {
      const r = await db.collection(DB_EX).where({ active: true, muscle: m }).count()
      c = r.total || 0
    } catch (e) {
      c = 0
    }
    muscles.push({ key: m, count: c })
  }

  for (const e of EQUIPMENTS) {
    let c = 0
    try {
      const r = await db.collection(DB_EX).where({ active: true, equipment: e }).count()
      c = r.total || 0
    } catch (e2) {
      c = 0
    }
    equipments.push({ key: e, count: c })
  }

  return ok({ muscles: muscles, equipments: equipments })
}

// ---------------------------------------------------------------------------
exports.main = async (event, context) => {
  let ev = event || {}
  // 兼容 URL 化调用（event 被包成 {queryStringParameters, body, ...}）
  if (ev.queryStringParameters && typeof ev.queryStringParameters === 'object') {
    ev = Object.assign({}, ev.queryStringParameters, ev)
  }

  const action = str(ev.action) || 'list'

  try {
    if (action === 'list') return await doList(ev)
    if (action === 'detail') return await doDetail(ev)
    if (action === 'groups') return await doGroups()
    return fail('不认识的动作：' + action)
  } catch (e) {
    console.error('[fit-exercise] 失败', action, e)
    return fail('查询失败：' + (e.message || '未知错误'), 500)
  }
}
