/**
 * 聊天图片临时链接缓存（fileID → tempFileURL）
 *
 * 为什么要落本地存储：
 *   cloud:// 的 fileID 不能直接当图片地址，要先调 uniCloud.getTempFileURL 换链接，
 *   这是一次网络往返（通常几百毫秒到 1 秒）。
 *   以前这份缓存只活在聊天页的 data 里（urlCache），页面一销毁就没了；
 *   切出去再进来 = 30 条消息里的图全部重新换链接 → 转圈、慢。
 *   现在写到本地存储，切页面、杀 App 重进都直接命中，图片立刻显示。
 *
 * 为什么要带过期时间：
 *   tempFileURL 会过期（支付宝云默认约 2 小时），过期后图片会加载失败。
 *   所以每条记一个 expireAt；过期的不再使用，图片加载失败时也会立刻删掉这条。
 */

const KEY = 'chat_img_url_cache'
// 取 100 分钟，比默认有效期（约 2 小时）留出安全余量
const TTL_MS = 100 * 60 * 1000
// 本地存储不是无限的，超量时按到期时间淘汰最旧的
const MAX_ENTRIES = 300

// 内存镜像：避免每次读都走一次存储同步读
let mem = null

function now() {
  return Date.now()
}

function load() {
  if (mem) return mem
  let raw = null
  try {
    raw = uni.getStorageSync(KEY)
  } catch (e) {
    raw = null
  }
  const out = {}
  let dropped = 0
  if (raw && typeof raw === 'object') {
    for (const id in raw) {
      const e = raw[id]
      // 顺手丢掉已经过期的，别让它们一直占位置
      if (e && e.url && e.expireAt > now()) out[id] = e
      else dropped++
    }
  }
  mem = out
  // 剔除了过期项就写回一次，别让它们一直留在本地存储里
  if (dropped) persist()
  return mem
}

function persist() {
  try {
    const ids = Object.keys(mem)
    if (ids.length > MAX_ENTRIES) {
      ids.sort(function (a, b) {
        return (mem[a].expireAt || 0) - (mem[b].expireAt || 0)
      })
      const drop = ids.length - MAX_ENTRIES
      for (let i = 0; i < drop; i++) delete mem[ids[i]]
    }
    uni.setStorageSync(KEY, mem)
  } catch (e) {
    // 存储写失败不该让聊天页崩掉：内存镜像仍然有效，只是重启后会丢
  }
}

/** 取一条可用的临时链接；没有或已过期返回空串 */
export function getImageUrl(fileID) {
  if (!fileID) return ''
  const c = load()
  const e = c[fileID]
  if (!e) return ''
  if (!e.expireAt || e.expireAt <= now()) {
    // 过期了就顺手从本地存储里删掉，否则陈旧链接会一条条堆积下去
    delete c[fileID]
    persist()
    return ''
  }
  return e.url || ''
}

/** 批量写入 { fileID: tempFileURL } */
export function putImageUrls(map) {
  if (!map) return
  const c = load()
  const exp = now() + TTL_MS
  let changed = false
  for (const id in map) {
    const url = map[id]
    if (!id || !url) continue
    c[id] = { url: url, expireAt: exp }
    changed = true
  }
  if (changed) persist()
}

/** 单条失效（图片加载失败时调用），下次换链接会重新拉 */
export function invalidateImageUrl(fileID) {
  if (!fileID) return
  const c = load()
  if (!c[fileID]) return
  delete c[fileID]
  persist()
}

export const IMAGE_CACHE_TTL_MS = TTL_MS

export default { getImageUrl, putImageUrls, invalidateImageUrl }
