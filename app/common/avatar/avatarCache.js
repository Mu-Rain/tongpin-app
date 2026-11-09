/**
 * 头像：本地落盘缓存 + 解码完成后整体淡入
 *
 * 要解决的问题（用户原话）：
 *   「头像图片加载总是从上到下肉眼可见地加载出来」——
 *   <image> 拿到网络地址后是边下边画的，用户看到的就是一条一条刷出来的过程。
 *
 * 做法两件，缺一不可：
 *   1) 把头像文件本身存到手机上（downloadFile → saveFile），下次直接用本地路径渲染，
 *      一个字节都不用下，也就不存在「从上到下刷出来」这个过程；
 *   2) 没有本地文件时也先不画：<image> 全程 opacity: 0，等 @load（解码完成）
 *      再整块淡入 —— 用户看到的只有「空圆 → 完整头像」两个状态，没有中间态。
 *
 * 硬约束：拿不到图就留空圆占位，**绝不**回落到默认头像图 / 昵称首字（用户强调过多次）。
 *   所以本模块任何失败都只是「没有可用地址」，由调用方渲染空占位。
 *
 * 和 common/chat/imageFile.js 的区别：那份是聊天大图的（限并发、按 fileID 索引）。
 * 这份只管头像，多做两件聊天图不需要的事：
 *   - 键里剥掉签名参数：临时链接每次换一次签名，带 ? 的地址天天变，
 *     用完整 URL 当键等于永远不命中；剥掉 ? 之后「同一个文件」才是同一个键；
 *   - 命中后异步确认文件还在，不在就丢掉记录重新下（系统清理过一个文件，
 *     不该让这个头像永远白着）。
 *
 * 只碰头像，不做通用图片库。
 */

/* storage 键设计：一图一键 avatar_file_v1_<hash>，外加一个索引键
   avatar_file_v1_index（[{ key, at }]，上限 200 条，超出按 at 最旧淘汰）。 */
const PREFIX = 'avatar_file_v1_'
const INDEX_KEY = 'avatar_file_v1_index'
const MAX_ENTRIES = 200

/* 内存镜像：storage 是同步 API，但一次列表页要读十几条，留个镜像省掉重复解析 */
let memIndex = null
const memEntry = Object.create(null) // storageKey -> { id, path, at }
/* 并发去重：同一个 fileID 同时被多个组件请求时只下载一次。
   失败必须在 .then/.catch 里删掉这条，否则一次失败就永久卡住。 */
const inflight = Object.create(null) // storageKey -> Promise<string>
/* saveFile 失败（平台不支持 / 磁盘满）时，本次进程内先用临时文件顶上，不写 storage */
const sessionOnly = Object.create(null) // storageKey -> 临时文件路径

function now() {
  return Date.now()
}

/* 同一张图的稳定键。临时链接形如
     https://xxx.oss-cn-hangzhou.aliyuncs.com/avatar/a.png?Expires=...&Signature=...
   每次换链签名都不一样，所以键必须剥掉查询串；路径本身是稳定的。 */
function stableKey(input) {
  const s = String(input == null ? '' : input)
  if (!s) return ''
  if (s.indexOf('http') === 0) {
    const q = s.indexOf('?')
    return q > 0 ? s.slice(0, q) : s
  }
  return s
}

/* storage 键名不能直接用 URL（长度和字符都不保证友好），用短哈希。
   哈希是 32 位 + 长度后缀，理论上可能撞；撞了也只是「读回另一条的记录」，
   所以读取时会核对记录里的 id，不一致就当没命中。 */
function hashKey(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0
  return h.toString(36) + '_' + s.length.toString(36)
}

function storageKeyOf(input) {
  return PREFIX + hashKey(stableKey(input))
}

function readIndex() {
  if (memIndex) return memIndex
  let raw = null
  try {
    raw = uni.getStorageSync(INDEX_KEY)
  } catch (e) {
    raw = null
  }
  memIndex = Array.isArray(raw) ? raw.filter(function (e) { return e && e.key }) : []
  return memIndex
}

function writeIndex() {
  try {
    uni.setStorageSync(INDEX_KEY, memIndex || [])
  } catch (e) {
    /* 索引写不进去不影响已存的图能不能用，只是淘汰会失灵 */
  }
}

function readEntry(input) {
  const sk = storageKeyOf(input)
  const cached = memEntry[sk]
  if (cached) return cached
  let e = null
  try {
    e = uni.getStorageSync(sk)
  } catch (err) {
    e = null
  }
  if (e && typeof e === 'object' && e.path && e.id === stableKey(input)) {
    memEntry[sk] = e
    return e
  }
  return null
}

function dropFile(path) {
  if (!path) return
  try {
    uni.removeSavedFile({ filePath: path, fail: function () {} })
  } catch (e) {
    /* 文件本来就没了 / 平台不支持：都不该抛到调用方 */
  }
}

/* 超出上限：按 at 最旧淘汰，淘汰时同步删 storage 里的键，文件尽量删（删不掉不影响正确性） */
function trimIndex() {
  const idx = readIndex()
  if (idx.length <= MAX_ENTRIES) return
  idx.sort(function (a, b) { return (a.at || 0) - (b.at || 0) })
  const drop = idx.length - MAX_ENTRIES
  for (let i = 0; i < drop; i++) {
    const key = idx[i].key
    let v = memEntry[key]
    delete memEntry[key]
    if (!v) {
      try {
        v = uni.getStorageSync(key)
      } catch (err) {
        v = null
      }
    }
    dropFile(v && v.path)
    try {
      uni.removeStorageSync(key)
    } catch (err) {}
  }
  idx.splice(0, drop)
}

function writeEntry(input, path) {
  const sk = storageKeyOf(input)
  const e = { id: stableKey(input), path: path, at: now() }
  memEntry[sk] = e
  try {
    uni.setStorageSync(sk, e)
  } catch (err) {
    /* 存不下就只留内存镜像：本次进程内仍然命中，重启后重下 */
    return
  }
  const idx = readIndex()
  let hit = -1
  for (let i = 0; i < idx.length; i++) {
    if (idx[i].key === sk) { hit = i; break }
  }
  if (hit >= 0) idx[hit].at = e.at
  else idx.push({ key: sk, at: e.at })
  trimIndex()
  writeIndex()
}

function removeEntry(input) {
  const sk = storageKeyOf(input)
  let v = memEntry[sk]
  delete memEntry[sk]
  if (!v) {
    try {
      v = uni.getStorageSync(sk)
    } catch (err) {
      v = null
    }
  }
  dropFile(v && v.path)
  try {
    uni.removeStorageSync(sk)
  } catch (err) {}
  const idx = readIndex()
  for (let i = idx.length - 1; i >= 0; i--) {
    if (idx[i].key === sk) idx.splice(i, 1)
  }
  writeIndex()
}

/* 缓存的本地文件还在不在。端差异全部 try/catch 兜住：
   判不出来就当「还在」—— 宁可显示一张可能要重下的图，也不要在每个页面白一下。 */
function fileExists(path) {
  return new Promise(function (resolve) {
    if (!path) return resolve(false)
    let settled = false
    const done = function (v) {
      if (settled) return
      settled = true
      resolve(v)
    }
    const tryPlus = function () {
      try {
        if (typeof plus !== 'undefined' && plus.io && plus.io.resolveLocalFileSystemURL) {
          plus.io.resolveLocalFileSystemURL(path, function () { done(true) }, function () { done(false) })
          return
        }
      } catch (e) {}
      done(true)
    }
    try {
      if (typeof uni !== 'undefined' && typeof uni.getSavedFileInfo === 'function') {
        uni.getSavedFileInfo({
          filePath: path,
          success: function () { done(true) },
          /* 有的端 getSavedFileInfo 对 saveFile 存下来的路径一律 fail（文件其实在）。
             这时再问一次 plus.io 才准：直接判死会让缓存每轮都重下一遍，
             重下失败还会把本来能显示的图弄没。 */
          fail: function () { tryPlus() }
        })
        return
      }
    } catch (e) {}
    tryPlus()
  })
}

function getTempUrl(fileID) {
  /* 换链偶发失败（弱网 / 云厂商限流 / 切换账号后 SDK 还没就绪）时不要一次判死：
     一次失败会让这张头像这一屏永远空着，而下一屏又好了 —— 用户看到的就是
     「同一个号在 A 号登录能看见、切到 C 号看不见」。所以这里重试一次再放弃。 */
  const attempt = function (left) {
    return new Promise(function (resolve) {
      if (typeof uniCloud === 'undefined' || !uniCloud.getTempFileURL) return resolve('')
      const retry = function () {
        if (left <= 0) return resolve('')
        setTimeout(function () {
          attempt(left - 1).then(resolve)
        }, 250)
      }
      try {
        uniCloud.getTempFileURL({
          fileList: [fileID],
          success: function (res) {
            const item = ((res && res.fileList) || [])[0] || {}
            if (item.tempFileURL) return resolve(item.tempFileURL)
            retry()
          },
          fail: function () { retry() }
        })
      } catch (e) {
        retry()
      }
    })
  }
  return attempt(1)
}

/* 下载 → 转持久文件。返回 { path, saved }：
   saved=false 表示平台没存成持久文件（这次能用，重启后失效，所以不写 storage）。 */
function downloadToLocal(url) {
  return new Promise(function (resolve) {
    if (!url) return resolve(null)
    try {
      uni.downloadFile({
        url: url,
        success: function (res) {
          if (!res || res.statusCode !== 200 || !res.tempFilePath) return resolve(null)
          const temp = res.tempFilePath
          try {
            uni.saveFile({
              tempFilePath: temp,
              success: function (sv) {
                const p = sv && sv.savedFilePath
                resolve(p ? { path: p, saved: true } : { path: temp, saved: false })
              },
              fail: function () { resolve({ path: temp, saved: false }) }
            })
          } catch (e) {
            resolve({ path: temp, saved: false })
          }
        },
        fail: function () { resolve(null) }
      })
    } catch (e) {
      resolve(null)
    }
  })
}

function loadOnce(input, sk) {
  return new Promise(function (resolve) {
    const viaUrl = function (url) {
      downloadToLocal(url).then(
        function (r) {
          if (r && r.path && r.saved) {
            writeEntry(input, r.path)
            return resolve(r.path)
          }
          if (r && r.path) {
            sessionOnly[sk] = r.path
            return resolve(r.path)
          }
          /* 下载失败但手上有一个能直接渲染的地址：退回直链。
             最差也就是改造前的表现，不会比之前更糟；仍然失败由调用方显示空占位。 */
          resolve(url || '')
        },
        function () { resolve(url || '') }
      )
    }
    if (input.charAt(0) === '/') return resolve(input) // 包内静态资源，本来就是本地文件
    /* 设计给的静态头像可能写成 static/av/a1.png（没前导斜杠）：这是包内资源，直接给绝对路径 */
    if (/^(\.\/)?static\//.test(input)) return resolve('/' + input.replace(/^\.\//, ''))
    if (input.indexOf('http') === 0) return viaUrl(input)
    if (input.indexOf('cloud://') === 0) {
      getTempUrl(input).then(
        function (u) {
          if (!u) return resolve('')
          viaUrl(u)
        },
        function () { resolve('') }
      )
      return
    }
    resolve('')
  })
}

function startLoad(input, sk) {
  const running = inflight[sk]
  if (running) return running
  const p = loadOnce(input, sk).then(
    function (src) {
      delete inflight[sk]
      return src || ''
    },
    function () {
      delete inflight[sk]
      return ''
    }
  )
  inflight[sk] = p
  return p
}

/**
 * 同步取「已经存在本机」的头像路径；没有就返回空串。
 * 只读内存/storage，不发起任何网络请求 —— 专供页面第一帧用。
 * 注意：不校验文件是否还在（校验是异步的），要更准就用 resolveAvatar。
 */
export function getCachedLocal(input) {
  const id = String(input == null ? '' : input)
  if (!id) return ''
  if (id.charAt(0) === '/') return id
  const sk = storageKeyOf(id)
  if (sessionOnly[sk]) return sessionOnly[sk]
  const e = readEntry(id)
  return e && e.path ? e.path : ''
}

/**
 * 解析一个头像地址（cloud:// fileID 或 https 直链），给出可直接给 <image src> 用的路径。
 * 命中本地缓存立刻返回；否则下载 + 落盘。
 * 任何异常都 resolve('')，绝不 throw / 绝不 toast / 绝不 console.error。
 */
export function resolveAvatar(input) {
  const id = String(input == null ? '' : input)
  if (!id) return Promise.resolve('')
  const sk = storageKeyOf(id)
  if (sessionOnly[sk]) return Promise.resolve(sessionOnly[sk])
  const hit = readEntry(id)
  if (hit && hit.path) {
    return fileExists(hit.path).then(
      function (ok) {
        if (ok) return hit.path
        /* 失效自愈：系统把文件清掉了 → 丢掉这条记录，走一次重新下载 */
        removeEntry(id)
        return startLoad(id, sk)
      },
      function () { return hit.path }
    )
  }
  return startLoad(id, sk)
}

/** 单条失效（页面 @error 时调用）：下次 resolveAvatar 会重新下载 */
export function invalidateAvatar(input) {
  const id = String(input == null ? '' : input)
  if (!id) return
  const sk = storageKeyOf(id)
  delete sessionOnly[sk]
  removeEntry(id)
}

/* 全部头像键：索引 + 内存镜像 + storage 里实际存在的同前缀键。
   只信索引会漏 —— 索引写失败（storage 满）时图仍然存下了，清缓存就成了假清。 */
function allPrefixedKeys() {
  const out = []
  const seen = Object.create(null)
  const push = function (k) {
    if (!k || seen[k]) return
    seen[k] = true
    out.push(k)
  }
  const idx = readIndex()
  for (let i = 0; i < idx.length; i++) push(idx[i].key)
  for (const k in memEntry) push(k)
  try {
    const info = uni.getStorageInfoSync ? uni.getStorageInfoSync() : null
    const keys = (info && info.keys) || []
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i]).indexOf(PREFIX) === 0) push(keys[i])
    }
  } catch (e) {
    /* 拿不到键列表就只清索引里的那些 */
  }
  return out
}

/** 清空全部头像缓存（设置页 / 排障用） */
export function clearAvatarCache() {
  const keys = allPrefixedKeys()
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    let v = memEntry[key]
    delete memEntry[key]
    if (!v) {
      try {
        v = uni.getStorageSync(key)
      } catch (err) {
        v = null
      }
    }
    dropFile(v && v.path)
    try {
      uni.removeStorageSync(key)
    } catch (err) {}
  }
  memIndex = []
  writeIndex()
  for (const k in sessionOnly) delete sessionOnly[k]
  for (const k in inflight) delete inflight[k]
}

/** 本机缓存了多少张头像（排障用） */
export function avatarCacheCount() {
  return readIndex().length
}

/**
 * 页面侧适配：把「解析出来的路径」和「淡入时机」收在一处，5 个页面共用同一份时序，
 * 避免每个页面各写一套、时间常数和判定条件各飘一点。
 *
 * 页面用法：
 *   mixins: [avatarFadeMixin]
 *   this.avaSync(list, item => item._id, item => item.owner.avatar_url)   // 列表
 *   this.avaBind('me', url)                                               // 单张
 * 模板：
 *   <image v-if="avaSrcOf(k)" :class="{ 'x--in': avaReadyOf(k) }" :src="avaSrcOf(k)"
 *          @load="avaOnLoad(k)" @error="avaOnError(k, url)" />
 */
export const avatarFadeMixin = {
  data() {
    return {
      /* key（列表里是消息/会话/卡片的稳定 id，单张头像用固定名字）→ 本地路径 */
      avaSrc: {},
      /* 同一个 key：图片 @load 之后才置 true，模板用它切 opacity */
      avaReady: {}
    }
  },
  methods: {
    avaSrcOf(k) {
      return this.avaSrc[String(k)] || ''
    },
    avaReadyOf(k) {
      return this.avaReady[String(k)] === true
    },
    /* 挂一张头像。key 必须逐条唯一（不能用全局布尔），否则列表里一张加载完会让全部一起淡入 */
    avaBind(k, input) {
      const key = String(k == null ? '' : k)
      if (!key) return
      const id = String(input == null ? '' : input)
      if (!this._avaBound) this._avaBound = Object.create(null)
      // 同一条数据、同一个地址：已经挂过，不重复解析
      if (this._avaBound[key] === id) return
      this._avaBound[key] = id
      if (!id) {
        this.avaClear(key)
        return
      }
      // ① 已在本地：先挂上去，第一帧就有图（同步，不等 Promise）
      const hit = getCachedLocal(id)
      if (hit) this.avaSet(key, hit)
      // ② 3 秒还没拿到本地路径：先把原地址直接交给 <image>，绝不让人只看到空圆
      this.avaArmFallback(key, id)
      // ③ 再异步确认 / 下载；期间换了图就丢弃这次结果
      resolveAvatar(id).then(
        (src) => {
          if (this._avaBound[key] !== id) return
          if (!src) {
            /* 换链/下载失败时，只要能直接把原地址交给 <image> 就退回原地址渲染：
               最差等于改造前的表现，绝不因为「缓存模块失败」把本来能显示的图弄没。
               同时放开绑定，让下一轮同步还能再试一次。 */
            const raw = this.avaRawUrl(id)
            if (raw) this.avaSet(key, raw)
            else this.avaClear(key)
            this._avaBound[key] = null
            return
          }
          if (src !== this.avaSrcOf(key)) this.avaSet(key, src)
        },
        () => {}
      )
    },
    /* 批量挂：keyOf / idOf 从每条数据里取「稳定 id」和「头像地址」 */
    avaSync(list, keyOf, idOf) {
      if (!list || !list.length) return
      for (let i = 0; i < list.length; i++) {
        this.avaBind(keyOf(list[i], i), idOf(list[i], i))
      }
    },
    /* 能直接交给 <image src> 的来源：包内绝对路径 / http(s) / data: / blob:。
       别的（cloud:// 没换出链、空串）交给它会渲染失败，不如显示空圆。 */
    avaRawUrl(input) {
      const s = String(input == null ? '' : input)
      if (!s) return ''
      if (s.charAt(0) === '/') return s
      if (/^(https?:|data:|blob:)/.test(s)) return s
      return ''
    },
    /* 兜底：下载/换链慢到 3 秒还没结果时，把能直接渲染的原地址挂上去。
       代价是这张图可能又走网络、又看到一次逐行解码，但总比一直空着强。 */
    avaArmFallback(key, input) {
      if (!this._avaFallback) this._avaFallback = Object.create(null)
      this.avaClearFallback(key)
      const raw = this.avaRawUrl(input)
      if (!raw) return
      this._avaFallback[key] = setTimeout(() => {
        if (this._avaFallback) delete this._avaFallback[key]
        if (this.avaSrcOf(key)) return
        this.avaSet(key, raw)
      }, 3000)
    },
    avaClearFallback(key) {
      if (this._avaFallback && this._avaFallback[key]) {
        clearTimeout(this._avaFallback[key])
        delete this._avaFallback[key]
      }
    },
    avaSet(key, src) {
      /* ★★ 地址没变就什么都不做 —— 这是「头像刚进应用能看见、过一会儿全被空圆盖住」的根因：
         会话列表/消息列表/卡片列表每轮都会把 cloud:// 重新换成一条新签名链接，
         但本地缓存命中后 :src 算出来还是同一个本地路径。src 没变 → <image> 不重新解码、
         不会再派 @load；而这里一旦把 ready 打回 false，就再没有事件能把它放出来，
         节点永远 opacity: 0 —— 看起来就是「被空圆遮住了」。 */
      this.avaClearFallback(key)
      if ((this.avaSrc[key] || '') === src) return
      // 换图先退回 opacity 0，等新图 @load 再淡入，避免「旧图直接换成新图」的硬切
      this.$set(this.avaReady, key, false)
      this.$set(this.avaSrc, key, src)
      this.avaArmReveal(key)
    },
    /* 换了 src 正常一定会来 @load；万一某个端不派这个事件，
       1.5 秒后无条件放出：宁可少一次淡入，也不让头像永远看不见。 */
    avaArmReveal(key) {
      if (!this._avaTimers) this._avaTimers = Object.create(null)
      if (this._avaTimers[key]) clearTimeout(this._avaTimers[key])
      this._avaTimers[key] = setTimeout(() => {
        if (this._avaTimers) delete this._avaTimers[key]
        if (this.avaReady[key] !== true) this.$set(this.avaReady, key, true)
      }, 1500)
    },
    avaClear(key) {
      this.avaClearFallback(key)
      if (this._avaTimers && this._avaTimers[key]) {
        clearTimeout(this._avaTimers[key])
        delete this._avaTimers[key]
      }
      this.$set(this.avaReady, key, false)
      this.$delete(this.avaSrc, key)
    },
    /* 图片解码完成。至少让过一次 $nextTick 再置 ready：
       命中本地缓存时 @load 来得极快，同一帧里从「没有节点」直接到 opacity:1 会没有过渡。 */
    avaOnLoad(k) {
      const key = String(k)
      if (this._avaTimers && this._avaTimers[key]) {
        clearTimeout(this._avaTimers[key])
        delete this._avaTimers[key]
      }
      this.$nextTick(() => {
        this.$set(this.avaReady, key, true)
      })
    },
    /* 加载失败：保持空圆占位，不淡入任何兜底图；顺手让缓存这条失效，下次进页面重下一次 */
    avaOnError(k, input) {
      const key = String(k)
      this.avaClear(key)
      // 没绑过就建表：@error 可能先于任何 avaBind 到达（模板先挂空占位）
      if (!this._avaBound) this._avaBound = Object.create(null)
      this._avaBound[key] = null
      if (input) invalidateAvatar(input)
    }
  },
  beforeDestroy() {
    const t = this._avaTimers
    if (t) {
      for (const k in t) clearTimeout(t[k])
      this._avaTimers = null
    }
    const f = this._avaFallback
    if (f) {
      for (const k in f) clearTimeout(f[k])
      this._avaFallback = null
    }
  }
}

export default {
  getCachedLocal,
  resolveAvatar,
  invalidateAvatar,
  clearAvatarCache,
  avatarCacheCount,
  avatarFadeMixin
}
