/**
 * 番茄钟会话状态（跨页面、跨 App 重启保留）
 *
 * 为什么单独一个文件：
 *   学习页要做到「离开页面还在计时」，靠的就是这里的状态。
 *   状态将来还要被首页角标、锁屏提醒复用，放在页面里就会复制三份。
 *
 * ★ 核心设计：只存「开始时刻 + 已累计时长」，剩余时间每次用当前时间算出来。
 *   绝不存「剩余秒数」——App 切到后台后 JS 定时器会被系统冻结，
 *   按秒自减会越走越慢；页面被销毁后更是直接归零，用户看到的就是「重新计时」。
 *
 * 状态对象字段：
 *   minutes       这次选的时长（分钟）
 *   totalSec      总秒数 = minutes * 60
 *   accumulatedMs 已经「跑过」的毫秒数（暂停期间不增长）
 *   resumedAt     最后一次继续的时刻；暂停时为 0
 *   paused        是否暂停中
 *   startedAt     第一次点开始的时刻（写库用）
 */

const KEY = 'pomodoro_session'

function now() {
  return Date.now()
}

export function readSession() {
  try {
    const s = uni.getStorageSync(KEY)
    if (!s || typeof s !== 'object' || !s.totalSec) return null
    // minutes 是「这一轮设定的分钟数」，缺了它 remainSec / clockText 会算出
    // NaN（圆环显示成 NaN:NaN），这种会话整体丢掉，比显示乱码强。
    const m = s.minutes
    const okMinutes = typeof m === 'number' && isFinite(m) && Math.floor(m) === m && m >= 1 && m <= 180
    if (!okMinutes) {
      clearSession()
      return null
    }
    return s
  } catch (e) {
    return null
  }
}

export function writeSession(s) {
  try {
    uni.setStorageSync(KEY, s)
  } catch (e) {
    // 存储写不进去不该让计时崩掉，下次进页面重新读即可
  }
}

export function clearSession() {
  try {
    uni.removeStorageSync(KEY)
  } catch (e) {}
}

export function newSession(minutes) {
  const t = now()
  return {
    minutes: minutes,
    totalSec: Math.round(minutes * 60),
    accumulatedMs: 0,
    resumedAt: t,
    paused: false,
    startedAt: t
  }
}

export function elapsedMsOf(s) {
  if (!s) return 0
  const extra = s.paused ? 0 : Math.max(0, now() - s.resumedAt)
  return s.accumulatedMs + extra
}

export function remainSecOf(s) {
  if (!s) return 0
  return Math.max(0, s.totalSec - Math.floor(elapsedMsOf(s) / 1000))
}

export function pauseSession(s) {
  if (!s || s.paused) return s
  s.accumulatedMs += Math.max(0, now() - s.resumedAt)
  s.resumedAt = 0
  s.paused = true
  return s
}

export function resumeSession(s) {
  if (!s || !s.paused) return s
  s.resumedAt = now()
  s.paused = false
  return s
}

/** 计时自然走完的那一刻。离开页面期间跑完也能补出正确的结束时间，不靠用户回来的时间。 */
export function finishAtOf(s) {
  if (!s) return now()
  return (s.resumedAt || s.startedAt) + (s.totalSec * 1000 - s.accumulatedMs)
}

/**
 * 到点就结算（D1）
 * ------------------------------------------------------------------
 * 为什么收在这里：番茄是「离开页面也在走」的，结算就不能只挂在学习页上。
 * 用户点开始后切到别的页面，计时照样跑到 0；只有 study.vue 的 onShow
 * 会结算的话，回页面前清缓存或换设备，这条记录就永久丢了。
 * 把「读回会话 + 判断是否已到点 + 给出结算要用的数据」收进本模块，
 * 学习页的 onShow 和 App.vue 的 onShow 才能共用同一套判断。
 *
 * 返回：该结算的会话数据；没会话 / 还没到点 / 暂停中 都返回 null。
 * 暂停中不算到点：暂停时 resumedAt 是 0，finishAtOf 会退化成 startedAt，
 * 写库就成了「开始时间 == 结束时间」。等用户点「继续」后由页面按正常路径结算。
 *
 * ★ 这里不清会话：写库成功之后才由调用方 clearSession（D3），
 *   弱网写失败时会话还在，下次进页面还能补记。
 */
export function settleIfDue() {
  const s = readSession()
  if (!s) return null
  if (s.paused) return null
  if (remainSecOf(s) > 0) return null
  return {
    session: s,
    minutes: s.minutes,
    startedAt: s.startedAt,
    finishedAt: finishAtOf(s)
  }
}
