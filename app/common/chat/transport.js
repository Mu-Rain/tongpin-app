/**
 * 同频 · 聊天传输层（MVP：消息表 + 3 秒轮询；接口留好，将来可换 WebSocket）
 * ===============================================================
 * 设计文档：dazi-app/docs/06-chat-transport.md
 *
 * 铁律（页面必须遵守）：
 *   页面只使用本文件返回的 7 个接口，**永远不要**自己在页面里写
 *   setInterval / setTimeout 轮询，也**不要**直接 uniCloud.callFunction 拉消息。
 *   否则将来换 WebSocket 时，页面要跟着改，就会引入回归 bug。
 *
 * 用法（聊天页里）：
 *   import { createChatTransport } from '@/common/chat/transport.js'
 *   const chat = createChatTransport({
 *     conversationId: '会话id',
 *     lastMessageId: '',                 // 首次为空；再次进入传本地缓存的最后一条 _id
 *     onMessages(list) { 合并进本地列表（按 clientMsgId / _id 去重） },
 *     onStatus(status) { connecting | online | offline },
 *     onError(err) { 提示"网络不太好" }
 *   })
 *   chat.start()                        // onLoad / 进入聊天页
 *   chat.send({ type: 'text', content: '你好' })   // 返回服务端消息对象
 *   chat.stop()                         // onUnload / 退到后台
 */

/** 活跃时每 3 秒问一次服务器 */
const DEFAULT_POLL_MS = 3000
/** 连续 3 分钟没动静，降到每 10 秒（省免费额度、省电） */
const DEFAULT_IDLE_POLL_MS = 10000
/** 多久算"静默" */
const IDLE_AFTER_MS = 3 * 60 * 1000
/** 出错后的退避：3s → 6s → 12s → 24s，最多 30s */
const BACKOFF_START_MS = 3000
const BACKOFF_MAX_MS = 30000

/**
 * 创建一个聊天通道（MVP 是轮询实现）。
 * @param {Object} options
 * @param {String} options.conversationId  必填：哪个会话
 * @param {String} [options.lastMessageId] 起点。首次留空；重连/重进传本地最后一条的 _id
 * @param {Number} [options.pollInterval]      活跃间隔，默认 3000
 * @param {Number} [options.idlePollInterval]  静默间隔，默认 10000
 * @param {Function} [options.onMessages] / [options.onStatus] / [options.onError]
 */
export function createChatTransport(options) {
  const opts = options || {}
  const conversationId = opts.conversationId
  /** 云函数全都要 token 才认人；没有它每个请求都会 401 */
  const token = opts.token || uni.getStorageSync('token') || ''

  if (!conversationId) {
    throw new Error('[chat] 创建聊天通道必须给 conversationId')
  }
  if (!token) {
    throw new Error('[chat] 没有登录态，聊天通道无法建立')
  }

  const pollMs = opts.pollInterval || DEFAULT_POLL_MS
  const idlePollMs = opts.idlePollInterval || DEFAULT_IDLE_POLL_MS

  let lastMessageId = opts.lastMessageId || ''
  let timer = null
  let running = false // 是否处于"正在接收"状态
  let isFetching = false // ★ 在途请求标志位：防止请求堆积（06 文档 3.4）
  let backoff = 0 // 当前退避毫秒数，0 = 正常
  let lastActiveAt = Date.now() // 最近一次收发消息的时间

  let messagesCb = opts.onMessages || null
  // onLoaded：首轮拉取「有结果」就回调一次，不管有没有消息。
  // 用来让页面解除 loading —— 空会话也必须放开，否则永远转圈。
  let loadedCb = opts.onLoaded || null
  let statusCb = opts.onStatus || null
  let errorCb = opts.onError || null

  /** 下一次该隔多久问一次 */
  function nextInterval() {
    if (backoff > 0) return backoff
    return Date.now() - lastActiveAt > IDLE_AFTER_MS ? idlePollMs : pollMs
  }

  function emitStatus(status) {
    if (statusCb) statusCb(status)
  }

  function emitError(err) {
    if (errorCb) errorCb(err)
  }

  /** 有收发就算"活跃"，立刻回到 3 秒 */
  function markActive() {
    lastActiveAt = Date.now()
    backoff = 0
  }

  /** 清掉定时器，并把在途请求标记作废 */
  function clearTimer() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  /**
   * 拉取比 lastMessageId 新的消息（升序返回）。
   * 断线重连补拉、首次加载都用它。页面也可以主动调它。
   * @param {String} [sinceId] 不传则用内部记录的 lastMessageId
   */
  async function fetchSince(sinceId) {
    const from = typeof sinceId === 'string' ? sinceId : lastMessageId
    const res = await uniCloud.callFunction({
      name: 'message-list',
      data: {
        token: token,
        conversationId: conversationId,
        // 注意：_id 不保证严格递增，所以云函数要"按 created_at 过滤 + 排序，用 _id 去重"
        lastMessageId: from || ''
      }
    })
    const r = (res && res.result) || {}
    if (r.code !== 0) throw new Error(r.msg || '拉取消息失败')
    const list = r.data || []
    if (list.length > 0) {
      const last = list[list.length - 1]
      lastMessageId = last._id || lastMessageId
      lastActiveAt = Date.now()
    }
    return list
  }

  /** 一轮：拉取 + 回调 + 状态维护。失败不抛出，走 onError + 退避。 */
  async function tick() {
    if (isFetching || !running) return
    isFetching = true
    try {
      const list = await fetchSince()
      if (!running) return // 拉取期间页面已退出，结果丢弃
      if (list.length > 0 && messagesCb) messagesCb(list)
      else if (loadedCb) loadedCb(list) // ★ 空列表也要通知：解除 loading
      markActive()
      emitStatus('online')
    } catch (err) {
      if (!running) return
      // 保留 lastMessageId 不推进，退避重试；恢复后一次补拉就能拿全
      backoff = backoff === 0 ? BACKOFF_START_MS : Math.min(backoff * 2, BACKOFF_MAX_MS)
      emitStatus('offline')
      emitError(err)
    } finally {
      isFetching = false
    }
  }

  /** 跑完一轮再定下一轮，这样间隔才能动态变化 */
  function schedule() {
    clearTimer()
    timer = setTimeout(async function () {
      await tick()
      if (running) schedule()
    }, nextInterval())
  }

  return {
    /** 开始接收消息：先立即拉一次，再启动定时器（06 文档 3.1） */
    start() {
      if (running) return
      running = true
      backoff = 0
      lastActiveAt = Date.now()
      emitStatus('connecting')
      tick().then(function () {
        // 首轮跑完（成功或失败）都必须放开 loading：
        // 失败时也放开，让页面显示"还没有消息"，比无限转圈强
        if (loadedCb) loadedCb([])
        if (running) schedule()
      })
    },

    /** 停止接收、清掉定时器。必须在页面 onUnload 里调（06 文档 3.3） */
    stop() {
      running = false
      clearTimer()
    },

    /**
     * 发一条消息。
     * 页面应先生成 clientMsgId 并在本地插一条"发送中"气泡，再用同一个
     * clientMsgId 调本方法；成功后把气泡状态改成"已送达"并补上服务端 _id。
     * @param {Object} payload { type: 'text'|'image', content, clientMsgId? }
     * @returns {Promise<Object>} 服务端消息对象（带 _id、created_at）
     */
    async send(payload) {
      const data = Object.assign({}, payload, {
        token: token,
        conversationId: conversationId,
        clientMsgId: (payload && payload.clientMsgId) || genClientMsgId()
      })
      const res = await uniCloud.callFunction({
        name: 'message-send',
        data: data
      })
      const r = (res && res.result) || {}
      // 云函数的业务错误走 code，不是 throw；不判断的话失败会被当成成功
      if (r.code !== 0) throw new Error(r.msg || '发送失败')
      const msg = r.data || null
      if (msg) {
        // ★ 不要在这里推进 lastMessageId。
        //   lastMessageId 的语义是"已经看到的最靠后一条"，用于向服务端增量补拉。
        //   发送成功后如果把它推到自己刚发的这条，下一轮轮询就只从这条往后拉，
        //   页面已有的历史不会被覆盖（有去重），但**重进页面时**缓存起点也变成了
        //   这条，于是只拿到自己发的那一条 —— 历史消息全部消失。
        //   正确的推进时机只有一处：fetchSince 拉到消息时。
        markActive()
      }
      return msg
    },

    fetchSince,

    /**
     * 告诉 transport "用户还在动"（敲键盘、滚动）。
     * 页面只调这一个方法，不碰定时器 —— 这样静默降频的逻辑全部留在本文件里，
     * 将来换 WebSocket 时连这个都不需要（长连接没有轮询间隔一说）。
     */
    touch() {
      markActive()
    },

    onMessages(fn) {
      messagesCb = fn
    },
    onStatus(fn) {
      statusCb = fn
    },
    onError(fn) {
      errorCb = fn
    }
  }
}

/** 本地生成的消息 id（去重用，不是数据库主键） */
function genClientMsgId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export default { createChatTransport }
