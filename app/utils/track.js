/**
 * 埋点上报（唯一入口）
 *
 * 契约：docs/30-后端交接.md §P2-1 + uniCloud-alipay/cloudfunctions/track-event/index.js
 *   入参 { token?, event, props? } → { code, msg, data: { recorded: true } }
 *   事件白名单写死在云函数里，前端这里不做校验（校验只保一份，避免两边漂移）
 *
 * ★ 铁律：埋点绝不影响主流程。
 *   不 await（调用方拿到的是同步返回，UI 不等网络）、失败不 toast、不 throw。
 *   所以外部调用一律直接 track(...)，失败静默 —— 云函数挂了也不该挡住发卡/进详情。
 */

// 同一 event + 同一 props 的 2 秒去重：feed_impression 在快速刷新/上拉时会成片触发，
// 同一张卡 2 秒内报两次没有信息增量，只会把 track_events 灌成噪音。
const DEDUPE_MS = 2000
// 去重表的键上限。埋点只是计数去重，不需要精确；超了就整表清空，不做 LRU（YAGNI）
const MAX_KEYS = 200

const recent = {}

function tokenOf() {
  try {
    return uni.getStorageSync('token') || ''
  } catch (e) {
    return ''
  }
}

function keyOf(event, props) {
  try {
    return event + '|' + JSON.stringify(props)
  } catch (e) {
    // props 里有循环引用之类的脏数据：退化成不按内容去重，仍然要上报
    return event + '|' + event.length + '|' + Date.now()
  }
}

/** true = 这条在 2 秒内已经报过，跳过 */
function isDuplicate(key) {
  const now = Date.now()
  const last = recent[key]
  if (last && now - last < DEDUPE_MS) return true
  if (!last && Object.keys(recent).length >= MAX_KEYS) {
    for (const k in recent) delete recent[k]
  }
  recent[key] = now
  return false
}

/**
 * @param {string} event 必须是云函数白名单里的 9 个之一
 * @param {object} [props] 字段契约见 docs/30-后端交接.md:171-181
 */
export default function track(event, props) {
  try {
    if (!event) return
    if (typeof uniCloud === 'undefined' || !uniCloud || typeof uniCloud.callFunction !== 'function') return
    const p = props && typeof props === 'object' ? props : {}
    if (isDuplicate(keyOf(event, p))) return
    uniCloud
      .callFunction({
        name: 'track-event',
        data: { token: tokenOf(), event: event, props: p }
      })
      .catch(function () {})
  } catch (e) {
    // 静默：埋点是旁路，坏在这里也不能让发布/进详情/发消息跟着坏
  }
}
