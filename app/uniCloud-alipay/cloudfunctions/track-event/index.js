'use strict'

/**
 * 埋点上报 —— 前端把关键行为写进 track_events，后端做分析用
 *
 * 入参：{ token?, event, props? }
 * 出参：{ code, msg, data: { recorded: true } }
 *
 * 事件白名单写死在代码里（30 文档 §P2-1，共 9 个）：
 *   不在名单里一律 400 —— 埋点表最怕被当成万能日志写进一堆脏事件，
 *   后面按 event 聚合时全是噪音。
 *
 * ★ 未登录也允许上报：首启、落地页点击这些事件发生时就还没有 token，
 *   拒掉等于丢掉漏斗最前面那一段。token 无效同样降级成匿名（user_id=''），
 *   不报 401 —— 埋点失败不该在前端弹任何东西。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_TRACK = 'track_events'

// 顺序与 30 文档一致，方便对照
const EVENT_ENUM = [
  'feed_impression',
  'feed_click',
  'sync_click',
  'publish_start',
  'publish_success',
  'publish_to_first_response',
  'ai_entry_click',
  'ai_session_msg_count',
  'meetup_confirmed'
]

// props 上限：一个埋点正常不超过十几个字段，超过这个量的一定是前端把整个对象塞进来了
const MAX_PROPS_CHARS = 2000

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/** props 允许对象或 JSON 字符串；坏数据一律当空对象，不因为 props 形状让上报失败 */
function propsOf(raw) {
  let obj = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch (e) {
      return {}
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  try {
    if (JSON.stringify(obj).length > MAX_PROPS_CHARS) return {}
  } catch (e) {
    return {}
  }
  return obj
}

exports.main = async (event) => {
  try {
    const ev = str(event.event)
    if (!ev) fail('缺少事件名')
    if (EVENT_ENUM.indexOf(ev) < 0) fail('不认识的埋点事件：' + ev)

    // —— 有 token 就认人，没有/过期就匿名 ——
    let userId = ''
    const token = str(event.token)
    if (token) {
      try {
        const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
        if (r.data.length) userId = str(r.data[0]._id)
      } catch (e) {
        /* 查不到人按匿名处理 */
      }
    }

    await db.collection(DB_TRACK).add({
      event: ev,
      user_id: userId,
      props: propsOf(event.props),
      created_at: Date.now()
    })

    return { code: 0, msg: 'ok', data: { recorded: true } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '埋点上报失败' }
  }
}
