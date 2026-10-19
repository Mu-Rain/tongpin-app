'use strict'

// 临时诊断函数：把 URL 化调用实际收到的 event 原样打印出来。
// 用途：确认支付宝云 URL 化时 query / body 被塞进了 event 的哪个字段。
// 排查完可删除。

exports.main = async (event, context) => {
  const out = {
    typeofEvent: typeof event,
    eventKeys: event && typeof event === 'object' ? Object.keys(event) : [],
    eventPreview: null,
    contextKeys: context && typeof context === 'object' ? Object.keys(context) : []
  }

  // 把 event 里可能出现的字符串值都截断打印
  try {
    const safe = {}
    if (event && typeof event === 'object') {
      for (const k of Object.keys(event)) {
        const v = event[k]
        if (typeof v === 'string') {
          safe[k] = v.length > 300 ? v.slice(0, 300) + '…(len ' + v.length + ')' : v
        } else if (v === null || typeof v !== 'object') {
          safe[k] = v
        } else if (Array.isArray(v)) {
          safe[k] = '[Array len ' + v.length + '] ' + JSON.stringify(v).slice(0, 200)
        } else {
          safe[k] = '[Object] ' + JSON.stringify(v).slice(0, 300)
        }
      }
    }
    out.eventPreview = safe
  } catch (e) {
    out.eventPreview = 'stringify failed: ' + e.message
  }

  // 如果 context 里有 HTTP 相关字段，也打印出来
  try {
    if (context) {
      out.contextPreview = {}
      for (const k of Object.keys(context)) {
        const v = context[k]
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          out.contextPreview[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v
        }
      }
    }
  } catch (e) {}

  return { code: 0, msg: 'ok', data: out }
}
