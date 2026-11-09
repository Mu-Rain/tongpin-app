/* uni-push 2.0 客户端封装：只做「拿 cid + 上报绑定/解绑」，不监听消息

   为什么要单独一层：
     1. 标准基座不带 uni-push 模块，uni.getPushClientId 可能不存在、也可能直接抛错。
        push 只是增强能力 —— 任何失败都必须静默，不能影响启动、登录和页面渲染。
     2. cid 一台设备一个、跨账号复用，所以缓存进 storage；
        退出登录只解绑、不删 cid（同一台设备下次登录还要用）。

   云函数契约（服务端由另一个任务写 user-push，这里只负责按契约调）：
     bind   { action: 'bind',   token, cid, platform }
     unbind { action: 'unbind', token, cid } */

const STORE_CID = 'pushCid'
const THROTTLE_MS = 60 * 1000

// 模块级状态：内存 cid、上次真正执行的时间、上次绑定成功的 token|cid
let currentCid = ''
let lastRunAt = 0
let boundKey = ''

function readToken() {
  try {
    return uni.getStorageSync('token') || ''
  } catch (e) {
    return ''
  }
}

function readPlatform() {
  try {
    const info = uni.getSystemInfoSync() || {}
    return info.platform ? String(info.platform) : ''
  } catch (e) {
    return ''
  }
}

/* 取 cid：API 不存在 / 抛错 / 回调失败 一律 resolve('')。
   不 reject、不弹窗、不打印 —— 调用方拿不到 cid 就当没这回事。 */
function fetchCid() {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => {
      if (settled) return
      settled = true
      resolve(v ? String(v) : '')
    }
    try {
      if (typeof uni === 'undefined' || typeof uni.getPushClientId !== 'function') {
        return done('')
      }
      uni.getPushClientId({
        success: (res) => done(res && res.cid ? res.cid : ''),
        fail: () => done('')
      })
    } catch (e) {
      done('')
    }
  })
}

/* 注册：拿 cid 并（已登录时）上报绑定。
   options.silent 是调用方的语义提示（登录/注册后静默补绑）；所有失败路径本来就没有提示，
   所以这里不额外分支。返回 true 表示这次真的走到云函数或缓存了 cid，false 表示跳过/失败。 */
export async function registerPush(options) {
  try {
    const token = readToken()

    // 60 秒节流：不重复取 cid（取 cid 是原生调用，一次就够）。
    // 例外：已登录、且当前 cid 还没绑过 —— 这一次要放行去补绑，
    // 否则「启动时先缓存 cid、紧接着用户登录」会被节流挡掉，这台设备就绑不上了。
    if (Date.now() - lastRunAt < THROTTLE_MS) {
      if (!token) return false
      if (boundKey === token + '|' + currentCid) return false
    } else {
      lastRunAt = Date.now()
    }

    const cid = await fetchCid()
    if (!cid) return false
    currentCid = cid
    try {
      uni.setStorageSync(STORE_CID, cid)
    } catch (e) {
      /* cid 存不进去不影响本次上报 */
    }

    if (!token) return true
    if (typeof uniCloud === 'undefined') return true

    const res = await uniCloud.callFunction({
      name: 'user-push',
      data: { action: 'bind', token: token, cid: cid, platform: readPlatform() }
    })
    const r = (res && res.result) || {}
    // 只有云函数明确回 code=0 才算绑上；否则下次调用还会再试
    if (r.code === 0) boundKey = token + '|' + cid
    return true
  } catch (e) {
    return false
  }
}

/* 解绑：退出登录前调用（它要读 token 与 cid，所以必须早于清 storage）。
   cid 留在 storage 里 —— 同一台设备下次登录还要用。 */
export async function unbindPush() {
  try {
    let cid = currentCid
    if (!cid) {
      cid = uni.getStorageSync(STORE_CID) || ''
      currentCid = cid
    }
    const token = readToken()
    if (!cid || !token) return false
    if (typeof uniCloud === 'undefined') return false

    await uniCloud.callFunction({
      name: 'user-push',
      data: { action: 'unbind', token: token, cid: cid }
    })
    boundKey = ''
    return true
  } catch (e) {
    return false
  }
}

/* ============ 点击通知 → 直接进那个会话 ============ */

/* uni-push 2.0 的回调分两种 type：
     receive —— 应用在前台收到消息（系统不弹通知栏）；
     click   —— 用户点了通知栏（应用被杀时点通知冷启动，也是 click，且会在 onLaunch 之后触发）。
   只在 click 时跳转：receive 也会触发，但那时用户就站在应用里，把人从当前页面拽走是打扰。 */
const NAV_GAP_MS = 800
let tapBound = false
let lastNavAt = 0

function topPage() {
  try {
    const pages = getCurrentPages() || []
    return pages.length ? pages[pages.length - 1] : null
  } catch (e) {
    return null
  }
}

/* 拿页面参数：Vue3 下是 page.$page.options，个别端是 page.options，两个都试 */
function pageOptions(page) {
  if (!page) return {}
  try {
    if (page.$page && page.$page.options) return page.$page.options
  } catch (e) {
    /* 继续试下一个 */
  }
  try {
    return page.options || {}
  } catch (e) {
    return {}
  }
}

/* payload 在回调里可能已经是对象，也可能是 JSON 字符串（不同版本/端不一致） */
function payloadOf(res) {
  const d = res && res.data
  if (!d) return {}
  if (typeof d === 'string') {
    try {
      return JSON.parse(d)
    } catch (e) {
      return {}
    }
  }
  if (typeof d === 'object') return d
  return {}
}

function openConversation(payload) {
  const convId = payload.conversation_id ? String(payload.conversation_id) : ''
  if (!convId) return false
  // 没登录进不去聊天页，点通知只会留在原地；这时不跳，避免跳到登录再被弹回来
  if (!readToken()) return false

  const now = Date.now()
  if (now - lastNavAt < NAV_GAP_MS) return false
  lastNavAt = now

  // 已经在这个会话里：什么都不做，否则会叠第二层相同的聊天页
  const top = topPage()
  if (top) {
    let route = ''
    try {
      route = (top.route || (top.$page && top.$page.route) || top.__route__ || '') + ''
    } catch (e) {
      route = ''
    }
    const opts = pageOptions(top)
    if (route.indexOf('pages/chat/chat') >= 0 && String(opts.conversation_id || '') === convId) return false
  }

  let url = '/pages/chat/chat?conversation_id=' + encodeURIComponent(convId)
  if (payload.from_user_id) url += '&peer_id=' + encodeURIComponent(String(payload.from_user_id))
  if (payload.from_name) url += '&name=' + encodeURIComponent(String(payload.from_name))

  // 冷启动那一刻页面栈可能还没就绪，navigateTo 会失败；失败就 reLaunch 直接落到聊天页
  try {
    uni.navigateTo({
      url: url,
      fail: () => {
        try {
          uni.reLaunch({ url: url })
        } catch (e) {
          /* 静默：push 跳转失败不能弹错 */
        }
      }
    })
  } catch (e) {
    return false
  }
  return true
}

/* 只绑定一次；标准基座没有 onPushMessage，绑定失败静默 */
export function bindPushTap() {
  if (tapBound) return true
  try {
    if (typeof uni === 'undefined' || typeof uni.onPushMessage !== 'function') return false
    uni.onPushMessage((res) => {
      try {
        if (!res || res.type !== 'click') return
        openConversation(payloadOf(res))
      } catch (e) {
        /* 静默：任何解析异常都不该冒到控制台之外 */
      }
    })
    tapBound = true
    return true
  } catch (e) {
    return false
  }
}

export default registerPush
