/**
 * 同频 · 聊天语音（录音 / 播放）
 * ===============================================================
 * 契约：dazi-app/docs/16-聊天增强契约.md §5.1（语音那一条）
 *
 * 为什么单独一个文件，而不是写进 chat.vue：
 *   uni.getRecorderManager() 与 uni.createInnerAudioContext() 拿到的都是
 *   **全局单例**。页面 onUnload 之后如果不显式销毁，下一次进聊天页再 create
 *   会拿到一个绑着旧回调的实例 —— 录完不触发 onStop，用户看到的就是
 *   「按住麦克风没反应」。把生命周期收在这一个文件里，页面只管调用：
 *
 *     import { startRecord, stopRecord, abortRecord, playVoice, stopVoice } from '@/common/chat/voice.js'
 *
 * 页面约定：
 *   startRecord({ onStop, onError })  开始录；返回 false 表示当前端不支持
 *   stopRecord()                      松手：停止录制，随后 onStop 回调
 *   abortRecord()                     取消：停止录制且**不**回调 onStop
 *   playVoice(url, { onEnded, onError })
 *   stopVoice()                       停止播放并复位
 */

/** 契约 D4 同级的时长口径：单条语音最长 60 秒（message-send 的 MAX_VOICE_SEC） */
export const MAX_VOICE_SEC = 60

/** 录音参数。16k / 单声道 / 48kbps：人声够清楚，一分钟约 360KB */
const RECORD_OPTIONS = {
  duration: MAX_VOICE_SEC * 1000,
  sampleRate: 16000,
  numberOfChannels: 1,
  encodeBitRate: 48000,
  format: 'mp3'
}

let recorder = null
let onStopCb = null
let onErrorCb = null
let audio = null

/** 当前端有没有录音能力（H5 一般没有） */
export function isRecordSupported() {
  return typeof uni !== 'undefined' && typeof uni.getRecorderManager === 'function'
}

/**
 * 懒创建录音管理器，并把回调**只注册一次**。
 * 每次 startRecord 都重新 onStop 会叠加回调，一次录音触发 N 次上传。
 */
function ensureRecorder() {
  if (recorder) return recorder
  recorder = uni.getRecorderManager()
  recorder.onStop(function (res) {
    const cb = onStopCb
    onStopCb = null
    onErrorCb = null
    if (cb) cb(res || {})
  })
  recorder.onError(function (err) {
    const cb = onErrorCb
    onStopCb = null
    onErrorCb = null
    if (cb) cb(err || {})
  })
  return recorder
}

/**
 * 开始录音。
 * @param {{ onStop?: Function, onError?: Function }} handlers
 * @returns {Boolean} false = 当前端不支持或启动失败，调用方据此提示用户
 */
export function startRecord(handlers) {
  if (!isRecordSupported()) return false
  const h = handlers || {}
  onStopCb = typeof h.onStop === 'function' ? h.onStop : null
  onErrorCb = typeof h.onError === 'function' ? h.onError : null
  try {
    ensureRecorder().start(RECORD_OPTIONS)
    return true
  } catch (e) {
    onStopCb = null
    onErrorCb = null
    return false
  }
}

/** 松手：停止录制，随后触发 onStop（上传由页面在回调里做） */
export function stopRecord() {
  if (!recorder) return
  try {
    recorder.stop()
  } catch (e) {
    /* 没在录时 stop 会抛，忽略即可 */
  }
}

/**
 * 取消（手指划开）：停止录制并且**不**回调 onStop。
 * 不这样做的话"取消"和"松手"走同一条路，用户划开手指反而把语音发出去了。
 */
export function abortRecord() {
  onStopCb = null
  onErrorCb = null
  stopRecord()
}

/**
 * 播放一条语音。同一个实例换 src 复用，避免每次点击都 create 一个新上下文
 * （InnerAudioContext 不 destroy 会一直占着音频焦点）。
 */
export function playVoice(url, handlers) {
  if (!url) return false
  const h = handlers || {}
  if (!audio) {
    if (typeof uni === 'undefined' || typeof uni.createInnerAudioContext !== 'function') return false
    audio = uni.createInnerAudioContext()
    audio.onEnded(function () {
      const cb = audio && audio.__onEnded
      if (cb) cb()
    })
    audio.onError(function (err) {
      const cb = audio && audio.__onError
      if (cb) cb(err || {})
    })
  }
  audio.__onEnded = typeof h.onEnded === 'function' ? h.onEnded : null
  audio.__onError = typeof h.onError === 'function' ? h.onError : null
  try {
    audio.stop()
    audio.src = url
    audio.play()
    return true
  } catch (e) {
    return false
  }
}

/** 停止播放并清掉回调（页面 onUnload / onHide 必须调，否则切页后还在响） */
export function stopVoice() {
  if (!audio) return
  audio.__onEnded = null
  audio.__onError = null
  try {
    audio.stop()
  } catch (e) {
    /* 没在播时 stop 会抛，忽略 */
  }
}

/** 彻底销毁（页面 onUnload 用） */
export function destroyVoice() {
  stopVoice()
  if (audio && typeof audio.destroy === 'function') {
    try {
      audio.destroy()
    } catch (e) {
      /* 已销毁 */
    }
  }
  audio = null
}

export default { MAX_VOICE_SEC, isRecordSupported, startRecord, stopRecord, abortRecord, playVoice, stopVoice, destroyVoice }
