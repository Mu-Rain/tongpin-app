'use strict'
/**
 * fit-reminder —— 训练提醒（契约 §2.2，本轮降级成 App 内提示条）
 *
 * 入参：{ token, action: 'get' | 'set', enabled?, hour?, minute? }
 * 出参（get / set 同一形状）：
 *   { code: 0, data: { enabled, hour, minute, should_nudge, nudge_text } }
 *
 * 为什么不发系统级推送（见契约 §2.3）：
 *   plus.push 要条件编译 + 安卓通知权限 + 后台唤醒，每一项都可能变成「装到别人手机上
 *   不弹」，而 11/14 是功能冻结线。改成「打开 App 时判断该不该提醒」，逻辑（时间、
 *   今天没练、隔天重置）全是真的且在服务端，以后接本地通知只是加一层外壳。
 *
 * 设置存在 uni-id-users 上的三个字段（schemaless，不需要 DDL）：
 *   fit_remind_enabled / fit_remind_hour / fit_remind_minute
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_SESSIONS = 'fit_sessions'

// 服务器跑 UTC：北京时间 0:00-8:00 直接取 UTC 会算成昨天、差 8 小时；
// 先加 8 小时再取，和 encyclopedia-daily 的 bjToday 同一套思路。
const BJ_OFFSET_MS = 8 * 60 * 60 * 1000

const DEFAULT_HOUR = 20
const DEFAULT_MINUTE = 0
const NUDGE_TEXT = '今天还没练，要不要来一组？'

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
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

/** 北京时间的今天 + 当前时分 */
function bjNow() {
  const d = new Date(Date.now() + BJ_OFFSET_MS)
  return {
    date: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes()
  }
}

function clamp(v, lo, hi) {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

// ---------------------------------------------------------------------------
// 身份
// ---------------------------------------------------------------------------
async function getUserByToken(token) {
  const t = str(token)
  // 契约 §3 铁律 2：拿不到当前用户返 500
  if (!t) fail('未登录，请先登录', 500)
  const r = await db.collection(DB_USERS).where({ token: t }).limit(1).get()
  const list = r.data || []
  if (!list.length) fail('登录已过期，请重新登录', 500)
  const u = list[0]
  if (u.tokenExpire && u.tokenExpire < Date.now()) fail('登录已过期，请重新登录', 500)
  return u
}

// ---------------------------------------------------------------------------
// 读设置
// ---------------------------------------------------------------------------
/**
 * 字段缺失按「没开提醒」处理，不报错：
 * 老用户的行里根本没有这三个字段，报错会让首页顶部直接变红。
 */
function readSetting(me) {
  const enabled = me.fit_remind_enabled === true || me.fit_remind_enabled === 1 ||
    me.fit_remind_enabled === 'true' || me.fit_remind_enabled === '1'
  // 读到的值越界（手改过库 / 旧版本写坏）就收敛到合法区间：
  // 一次读取出错不该让提醒永远弹不出来，写入口仍然严格 400
  const hour = clamp(int(me.fit_remind_hour, DEFAULT_HOUR), 0, 23)
  const minute = clamp(int(me.fit_remind_minute, DEFAULT_MINUTE), 0, 59)
  return { enabled: enabled, hour: hour, minute: minute }
}

/** 今天有没有练完一次 —— 只认 status:'done'，和 fit-session 的 stats 同口径 */
async function hasTrainedToday(userId, today) {
  try {
    const r = await db.collection(DB_SESSIONS)
      .where({ user_id: userId, status: 'done', log_date: today })
      .limit(1)
      .get()
    return !!(r.data && r.data.length)
  } catch (e) {
    // fit_sessions 还没建（没人练过）与「今天没练」对提醒是同一件事，
    // 抛上去会把首页提示条拖成错误态
    console.warn('[fit-reminder] 查今日训练失败，按没练处理', e && e.message)
    return false
  }
}

/**
 * 三个条件全在服务端算，前端只负责显示：
 *   开了提醒 && 北京时间已过设定时刻 && 今天还没练
 */
async function buildReply(meId, setting) {
  const n = bjNow()
  const nowMin = n.hour * 60 + n.minute
  const setMin = setting.hour * 60 + setting.minute
  let should = false
  if (setting.enabled && nowMin >= setMin) {
    should = !(await hasTrainedToday(meId, n.date))
  }
  return ok({
    enabled: setting.enabled,
    hour: setting.hour,
    minute: setting.minute,
    should_nudge: should,
    // 不弹的时候给空串：前端拿 should_nudge 判显示，文案只在真弹时才需要
    nudge_text: should ? NUDGE_TEXT : ''
  })
}

// ---------------------------------------------------------------------------
// action = 'get'
// ---------------------------------------------------------------------------
async function doGet(event, me) {
  return buildReply(me._id, readSetting(me))
}

// ---------------------------------------------------------------------------
// action = 'set'
// ---------------------------------------------------------------------------
async function doSet(event, me) {
  const cur = readSetting(me)
  const patch = {}

  if (event.enabled !== undefined && event.enabled !== null && str(event.enabled) !== '') {
    patch.fit_remind_enabled = event.enabled === true || event.enabled === 1 ||
      event.enabled === 'true' || event.enabled === '1'
  }

  // 只改传进来的字段：设置页里开关和时间是两次动作，缺省的那次不能把另一项清掉
  if (event.hour !== undefined && event.hour !== null && str(event.hour) !== '') {
    const h = int(event.hour, -1)
    if (h < 0 || h > 23) fail('小时必须在 0 - 23 之间')
    patch.fit_remind_hour = h
  }
  if (event.minute !== undefined && event.minute !== null && str(event.minute) !== '') {
    const m = int(event.minute, -1)
    if (m < 0 || m > 59) fail('分钟必须在 0 - 59 之间')
    patch.fit_remind_minute = m
  }

  if (Object.keys(patch).length) {
    try {
      await db.collection(DB_USERS).doc(me._id).update(patch)
    } catch (e) {
      console.error('[fit-reminder] 写提醒设置失败', e)
      fail('保存提醒设置失败，请稍后重试', 500)
    }
  }

  // 把补丁叠在当前值上回给前端：设置页保存后要立刻按新时间渲染，不用再发一次 get
  const merged = {
    enabled: patch.fit_remind_enabled === undefined ? cur.enabled : patch.fit_remind_enabled,
    hour: patch.fit_remind_hour === undefined ? cur.hour : patch.fit_remind_hour,
    minute: patch.fit_remind_minute === undefined ? cur.minute : patch.fit_remind_minute
  }
  return buildReply(me._id, merged)
}

// ---------------------------------------------------------------------------
exports.main = async (event, context) => {
  let ev = event || {}
  // 支付宝云走 HTTP 触发时参数在 queryStringParameters 里，合并一次省得页面两套传法
  if (ev.queryStringParameters && typeof ev.queryStringParameters === 'object') {
    ev = Object.assign({}, ev.queryStringParameters, ev)
  }

  const action = str(ev.action) || 'get'

  try {
    const me = await getUserByToken(ev.token)

    if (action === 'get') return await doGet(ev, me)
    if (action === 'set') return await doSet(ev, me)
    fail('不认识的动作：' + action)
  } catch (e) {
    if (e.bizCode) return { code: e.bizCode, msg: e.message }
    console.error('[fit-reminder] 失败', action, e)
    return { code: 500, msg: '操作失败：' + (e.message || '未知错误') }
  }
}
