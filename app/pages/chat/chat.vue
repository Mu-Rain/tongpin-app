<template>
  <view class="chat-wrap">
    <!-- 状态栏占位 —— 自定义导航栏后必须自己留出这一块，
         否则顶部内容会被状态栏（时间、电量）压住 -->
    <view class="status-bar" :style="{ height: statusBarHeight + 'px' }" />

    <!-- ===== 顶部会话条（对齐原型 #chatBar） ===== -->
    <view class="chat-bar">
      <!-- ← 返回键：自定义导航栏后没有系统返回箭头了，要自己给一个 -->
      <text class="bar-back" @tap="goBack">‹</text>
      <!-- ★ 点头像/名字进对方主页（仿微信、QQ）。
           为什么要有这个入口：一对人现在可以有多条搭子关系（考研搭子 + 夜跑搭子），
           但只有一个聊天室，消息列表里也只占一行 —— 那些"别的搭子关系"
           在列表里看不见，只能从对方主页里找。 -->
      <view class="bar-left" @tap="goPeer">
        <view class="avatar" :class="{ 'avatar--orange': isAi }">{{
          isAi ? 'AI' : (name || '同').slice(0, 1)
        }}</view>
        <view class="bar-main">
          <text class="convo-name">{{ isAi ? '情绪引导机器人' : name || '搭子' }}</text>
          <text class="bar-sub">{{
            isAi ? '非医疗建议 · 紧急情况请联系校心理中心' : school || '同频搭子'
          }}</text>
        </view>
      </view>
      <!-- 多搭子：全部标签并排显示。v-for 与 v-if 不能写在同一个元素上 -->
      <template v-if="!isAi && tags.length">
        <text
          v-for="(t, ti) in tags"
          :key="ti"
          class="chat-buddy-tag"
          :style="{ backgroundColor: colorHex(t.color) }"
          >{{ tagText(t.label) }}</text
        >
      </template>
      <text
        v-else-if="!isAi && tag"
        class="chat-buddy-tag"
        :style="{ backgroundColor: colorHex(tagColor) }"
        >{{ tagText(tag) }}</text
      >
      <!-- 连接状态
           ★ 只在**出问题**时才显示。
             之前这里常驻一个绿色的「已连接」——那是给开发者看的调试信息，
             用户看到只会问"这是什么、为什么会有"。正常的网络状态不需要占位，
             坏了才需要提醒。所以：online 什么都不显示，只有 connecting/offline
             才冒出来。判断逻辑在 statusText 计算属性里。 -->
      <text v-if="statusText" class="conn" :class="'conn--' + status">{{ statusText }}</text>
    </view>

    <!-- ===== 消息区 ===== -->
    <scroll-view
      class="chat-scroll"
      scroll-y
      :scroll-into-view="scrollInto"
      :scroll-with-animation="scrollAnimated"
      @scroll="onScroll"
    >
      <view v-if="loading" class="chat-hint">正在加载聊天记录…</view>

      <view v-else-if="!messages.length" class="chat-hint">
        {{ isAi ? '随便说点什么，我在这儿听着。' : '还没有消息，打个招呼吧。' }}
      </view>

      <view v-for="m in messages" :key="m.key" :id="'msg-' + m.key" class="bubble-row" :class="{ 'is-me': m.is_me }">
        <!-- ===== 头像：仿 QQ / 抖音，每条消息旁边一个 =====
             自己发的在右边、对方在左边，靠 .is-me 的 flex-direction 反转。 -->
        <view class="msg-avatar" :class="{ 'msg-avatar--me': m.is_me }">
          <image
            v-if="m.sender_avatar"
            class="msg-avatar-img"
            :src="m.sender_avatar"
            mode="aspectFill"
          />
          <text v-else class="msg-avatar-text">{{
            (m.is_me ? (m.sender_name || '我') : (m.sender_name || name || '同')).slice(0, 1)
          }}</text>
        </view>

        <view class="bubble-col">
          <image
            v-if="m.type === 'image' && m.displayUrl"
            class="bubble-img"
            :src="m.displayUrl"
            mode="widthFix"
            @tap="previewImage(m.displayUrl)"
            @error="onImgError(m)"
          />
          <view v-else-if="m.type === 'image'" class="bubble-img-ph">
            <text class="bubble-img-ph-text">{{ m.imgFailed ? '图片加载失败' : '图片加载中…' }}</text>
          </view>
          <view v-else class="bubble">
            <text class="bubble-text">{{ m.content }}</text>
          </view>
          <text class="bubble-time">{{ m.timeText }}</text>
          <!-- 发送失败：给一个明确的重试入口，不要只弹一下 toast -->
          <text v-if="m.failed" class="bubble-retry" @tap="retry(m)">发送失败，点此重试</text>
        </view>
      </view>

      <!-- ★ 底部锚点：进入页面时把 scroll-into-view 直接设成它，
           页面首帧就渲染在底部，而不是先渲染在顶部再滚过去。 -->
      <view v-if="messages.length" id="msg-end" class="chat-end-pad" />
    </scroll-view>

    <!-- ===== 输入区 ===== -->
    <view class="chat-input">
      <text class="pic-btn" @tap="pickImage">🖼</text>
      <input
        class="input input--flat"
        v-model="draft"
        placeholder="说点什么…"
        confirm-type="send"
        @confirm="sendText"
        @input="onTyping"
      />
      <button class="btn btn--orange btn--sm" :disabled="sending" @tap="sendText">发送</button>
    </view>

    <!-- 情绪机器人：只做情绪引导，不做诊断，这句话必须一直在 -->
    <view v-if="isAi" class="ai-note">
      <text class="ai-note-text">AI 不是心理咨询师，也不能替代专业帮助。如有紧急情况请立刻联系校心理中心或拨打当地急救电话。</text>
    </view>
  </view>
</template>

<script>
import { createChatTransport } from '@/common/chat/transport.js'
import { getImageUrl, putImageUrls, invalidateImageUrl } from '@/common/chat/imageCache.js'
import { getLocalImage, ensureLocalImage, forgetLocalImage } from '@/common/chat/imageFile.js'

const TAG_COLORS = {
  'shine-yellow': '#ffde00',
  'shine-orange': '#ff4d00',
  'shine-rose': '#ff5fa2',
  'shine-violet': '#a855f7',
  'shine-cyan': '#22d3ee',
  'shine-mint': '#34d399',
  'shine-blue': '#3b82f6',
  'shine-gold': '#e9c46a'
}

const STATUS_TEXT = {
  connecting: '连接中',
  online: '已连接',
  offline: '重连中'
}

/**
 * 把各端上传回来的 fileID 统一成 cloud:// 形式。
 * 阿里云 uploadFile 返回的是 https://xxx 直链，支付宝云/腾讯云返回的本来就是 cloud://。
 * 统一成 cloud:// 之后，渲染层只需要判断一次"是不是 cloud 协议"，
 * 不用到处区分平台（这些函数将来抽到 common/ 里给同频圈、头像复用）。
 */
function toCloudFileID(fileID) {
  if (!fileID) return ''
  return String(fileID)
}

/** 判断这个地址是不是需要换成临时 URL 的 cloud:// fileID */
function isCloudFileID(val) {
  return typeof val === 'string' && val.indexOf('cloud://') === 0
}

export default {
  data() {
    return {
      conversationId: '',
      // 对方 user id，用来点头像进主页
      peerId: '',
      name: '',
      school: '',
      tag: '',
      tagColor: '',
      // 多搭子：这一对人之间的全部标签（合成一行显示）
      tags: [],

      messages: [],
      draft: '',
      loading: true,
      sending: false,
      status: 'connecting',
      scrollInto: '',
      // ★ 进入页面首次定位不开动画：设一次锚点直接落到底部，
      //   用户看到的第一帧就在最下面，不会出现从顶部滚下来的过程。
      //   之后的新消息跟随仍然带动画。
      scrollAnimated: false,
      // 首次定位是否已做过（只在第一次拉到消息时做一次）
      firstAnchorDone: false,
      // 见 scrollToEnd：滚完之后要把 scroll-into-view 复位，否则布局一变就再滚一次
      scrollResetTimer: null,
      // 本次 mergeMessages 是否真的新增了消息。
      // 轮询每 3 秒回调一次，但绝大多数轮次没有新消息；
      // 只有真的来了新消息才值得自动滚到底，否则图片回填、高度微调都会把用户拽下去。
      mergedNewCount: 0,
      // 用户当前是否"贴着底部"。轮询每 3 秒回来一次，如果无条件滚到底，
      // 用户正在上翻历史会被硬拽回去。只在本来就在底部时才自动跟随。
      atBottom: true,
      // fileID → 临时 URL 的缓存（一轮会话内的内存加速层）。
      //   持久的那一份在 common/chat/imageCache.js（落本地存储），
      //   切页面 / 杀 App 重进都能直接命中，不必重新换链接。
      //   轮询每 3 秒回来一次，没有内存层会反复请求。
      urlCache: {},
      // 自定义导航栏：状态栏高度（px），把 content 顶到安全区下面
      statusBarHeight: 0
    }
  },

  computed: {
    isAi() {
      return this.conversationId === 'ai'
    },
    statusText() {
      // ★ 只有异常状态才返回文字，正常在线返回空串（模板 v-if 会把它藏起来）。
      //   一个常驻的"已连接"对用户没有信息量，反而像报错。
      const s = this.status
      if (s === 'online') return ''
      return STATUS_TEXT[s] || ''
    }
  },

  onLoad(options) {
    this.conversationId = (options && options.conversation_id) || ''
    // 对方 user id：用来进对方主页。老入口没传就留空，点头像时再兜
    this.peerId = (options && options.peer_id) || ''
    this.name = decodeURIComponent((options && options.name) || '')
    this.school = decodeURIComponent((options && options.school) || '')
    this.tag = decodeURIComponent((options && options.tag) || '')
    this.tagColor = decodeURIComponent((options && options.color) || '')
    // ★ 多搭子：同一对人可能有多段关系（自习搭子 + 夜跑搭子），
    //   入口页可以把全部标签用逗号拼起来传进来，这里拆成数组全显示。
    //   老入口只传 tag/color 一个，就自动降级成单标签。
    const tagsRaw = decodeURIComponent((options && options.tags) || '')

    // ★ 自定义导航栏：拿到状态栏高度，把顶部内容顶到安全区下面。
    //   为什么不用系统导航栏：系统栏会占掉一整行，只能写一个静态标题（比如"聊天"），
    //   而这一行对我们完全没用（对方名字、标签已经在下面显示），还白白把内容往下推。
    try {
      const sys = uni.getSystemInfoSync()
      this.statusBarHeight = sys.statusBarHeight || 0
    } catch (e) {
      this.statusBarHeight = 0
    }
    if (tagsRaw) {
      this.tags = tagsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const parts = pair.split('|')
          return { label: parts[0] || '', color: parts[1] || '' }
        })
        .filter((t) => t.label)
    } else if (this.tag) {
      this.tags = [{ label: this.tag, color: this.tagColor }]
    }

    if (this.isAi) {
      // 情绪机器人还没接（第 6 天之后），先把话说清楚，别让用户以为坏了
      this.loading = false
      this.messages = [
        {
          key: 'ai-0',
          is_me: false,
          type: 'text',
          content: '情绪引导机器人还没接入（排在聊天之后）。这里将来是一个简单的情绪引导对话，不做诊断、不做量表。',
          timeText: '',
          failed: false
        }
      ]
      return
    }

    if (!this.conversationId) {
      uni.showToast({ title: '会话参数缺失', icon: 'none' })
      this.loading = false
      return
    }

    this.autoSaveDraft()
  },

  onShow() {
    // onLoad 只跑一次，从系统通知栏点进来时 onShow 会再次触发，这里补一次 start
    if (this.isAi || !this.conversationId) return
    if (this.chat) this.chat.start()
    // ★ 回到页面立刻按缓存补一次图片链接。
    //   命中的是本地存储里的缓存，不发请求，所以切回来时图片是秒出的；
    //   只有真的没缓存过的那几张才会去换链接。
    this.resolveFileURLs()
  },

  onHide() {
    // 退到后台就停止轮询：省电、省免费额度
    if (this.chat) this.chat.stop()
  },

  onUnload() {
    // 必须停：否则定时器会一直跑，页面已经没了还在请求
    if (this.chat) this.chat.stop()
    this.chat = null
    if (this.scrollResetTimer) {
      clearTimeout(this.scrollResetTimer)
      this.scrollResetTimer = null
    }
  },

  methods: {
    /**
     * 当前登录用户的 id。
     * 登录/注册/自动登录存的是 userInfo = 云函数返回的 user 对象，
     * 里面带 _id —— 用它来区分本地缓存归属，避免同一台手机切账号时串号。
     */
    myUid() {
      const u = uni.getStorageSync('userInfo') || {}
      return u._id || u.id || 'anon'
    },

    /** 返回上一页。自定义导航栏后没有系统返回箭头，必须自己实现。
     *  从通知栏/分享直接进来时页面栈只有一层，退不回去就 reLaunch 到首页，
     *  否则点了没反应，用户会以为卡死。 */
    goBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) {
        uni.navigateBack()
      } else {
        uni.reLaunch({ url: '/pages/index/index' })
      }
    },

    initChat() {
      const self = this

      // ★ 进页面永远从空起点开始，即"全量拉最近 N 条"。
      //   曾经用本地缓存 chat_last_<用户>_<会话> 做起点，想让重进时只补新的，
      //   但那个起点会随着每次收到消息一直往前跳；一旦跳到最新一条，
      //   服务端就没有"比它更新"的消息了 → 返回空数组 → 页面空白。
      //   进页面要的是"最近 N 条完整历史"，轮询要的是"比上次新的"，
      //   两者要求相反，不能共用同一个起点。
      //   增量起点只活在 transport 的内存里，页面关闭即失效。
      this.chat = createChatTransport({
        conversationId: this.conversationId,
        lastMessageId: '',

        onMessages(list) {
          self.mergeMessages(list)
        },
        // ★ 首轮就算一条消息都没有也要放开 loading。
        // transport 只在 list.length > 0 时才回调 onMessages，
        // 空会话 / 缓存起点太新时回调永远不来，页面就卡在「正在加载聊天记录」。
        onLoaded() {
          self.loading = false
        },
        onStatus(s) {
          self.status = s
        },
        onError() {
          // 不弹 toast：轮询失败会反复触发，弹窗会烦死人。
          // 顶部「重连中」已经说明了状态，用户发消息时会再看到具体错误。
        }
      })

      this.chat.start()
    },

    /**
     * 合并服务端消息。
     * 去重靠 clientMsgId：本地乐观插入的气泡和服务端回来的同一条消息
     * 用同一个 clientMsgId，所以能对上，不会出现"发一次变两条"。
     */
    mergeMessages(list) {
      const self = this
      // 统计本轮真正新增（或从失败态恢复）的条数，决定要不要自动滚到底
      let newCount = 0
      list.forEach(function (s) {
        const mid = s._id
        // ★ 云函数返回的是 client_msg_id（snake_case），本地气泡用的是 clientMsgId
        const srvClientId = s.client_msg_id || s.clientMsgId || ''

        // 先看是不是自己刚发的那条（乐观气泡）
        const localIdx = self.messages.findIndex(function (m) {
          return m.clientMsgId && srvClientId && m.clientMsgId === srvClientId
        })

        if (localIdx > -1) {
          // 用服务端时间覆盖本地时间，并清掉"发送中"
          const local = self.messages[localIdx]
          const merged = Object.assign({}, local, {
            key: mid || local.key,
            _id: mid,
            created_at: s.created_at,
            timeText: self.fmtBubbleTime(s.created_at),
            failed: false
          })
          self.$set(self.messages, localIdx, merged)
          // 自己发的那条首次从服务端确认回来，也算「有新东西」，值得跟随
          newCount++
          return
        }

        // 完全重复（同一条消息被拉两次）直接跳过
        const dup = self.messages.some(function (m) {
          return m._id === mid
        })
        if (dup) return
        // 走到这里说明是一条真正的新消息
        newCount++

        self.messages.push({
          key: mid || 'srv-' + Math.random().toString(36).slice(2, 8),
          _id: mid,
          clientMsgId: srvClientId,
          is_me: !!s.is_me,
          type: s.type || 'text',
          content: s.content || '',
          // 图片的 content 是 cloud:// fileID，不能直接当 src；
          // displayUrl 由 resolveFileURLs 批量换算后填入。
          // resolved=true 表示 displayUrl 已经是可直接用的链接，不用再换。
          displayUrl: (s.type === 'image' && !isCloudFileID(s.content)) ? s.content : '',
          resolved: !!(s.type === 'image' && s.content && !isCloudFileID(s.content)),
          // ★ 每条消息都带发送者信息，用来在气泡旁边画头像（仿 QQ / 抖音）。
          //   sender_avatar 由 message-list 云函数已经返回，这里只是接住它。
          sender_name: s.sender_name || '同学',
          sender_avatar: s.sender_avatar || '',
          created_at: s.created_at,
          timeText: self.fmtBubbleTime(s.created_at),
          failed: false
        })
      })

      self.sortMessages()
      // ★ 不再写 chat_last_ 缓存。
      //   这个缓存曾用于"下次进页面从上次位置续拉"，但起点会随每条新消息
      //   一路往前跳，跳到最新一条后服务端就没有"比它更新"的消息 → 空列表。
      //   进页面现在一律全量拉最近 30 条，增量起点只活在 transport 内存里。
      self.loading = false

      // 图片消息存的是 cloud:// fileID，必须换成临时 URL 才能显示
      self.resolveFileURLs()

      // ★ 自动滚到底需要同时满足两个条件：
      //   ① 用户本来就在底部（atBottom）—— 在往上翻历史时不能打断他；
      //   ② 这一轮**确实有新消息**（newCount > 0）。
      //   第 ② 个条件是关键：轮询每 3 秒回调一次，但多数轮次没有新消息；
      //   若只要贴底就滚，那么图片本地化回填、气泡高度微调这类**布局变化**
      //   也会被当成"该滚了"，于是出现「图片一张张加载、页面跟着一路往下滚」。
      self.mergedNewCount = newCount

      // ★ 首次拉到消息：直接停在底部，不做滚动动作。
      //   scroll-into-view 首次设成底部锚点时页面还没渲染完，
      //   设下去就处在最底部，用户看到的第一帧就在最下面，
      //   不存在每次进来都快速滚一遍的过程。
      if (!self.firstAnchorDone && self.messages.length) {
        self.firstAnchorDone = true
        self.anchorBottomNoAnimation()
        return
      }

      if (self.atBottom && newCount > 0) self.scrollToEnd()
    },

    sortMessages() {
      this.messages.sort(function (a, b) {
        const ta = a.created_at || Number.MAX_SAFE_INTEGER
        const tb = b.created_at || Number.MAX_SAFE_INTEGER
        return ta - tb
      })
    },

    fmtBubbleTime(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      return (
        String(d.getHours()).padStart(2, '0') +
        ':' +
        String(d.getMinutes()).padStart(2, '0')
      )
    },

    /** 输入时告诉 transport "还在动"，避免敲字期间降到 10 秒一轮 */
    onTyping() {
      if (this.chat) this.chat.touch()
    },

    async sendText() {
      const text = (this.draft || '').trim()
      if (!text || this.sending) return
      await this.doSend({ type: 'text', content: text })
      this.draft = ''
    },

    /** 选图上传，再把图片地址当一条消息发出去 */
    pickImage() {
      const self = this
      uni.chooseImage({
        count: 1,
        // 手机原图一张 2-4 MB，直传云存储会同时吃掉 CDN 流量和存储。
        // compressed 让系统先压一道，聊天看图不需要原图。
        sizeType: ['compressed'],
        success(res) {
          const path = res.tempFilePaths[0]
          if (path) self.prepareImage(path)
        }
      })
    },

    /**
     * 上传前把长边压到 1280、质量 60。
     * 3 MB 的原图大约落到 150 KB，同一份 CDN 流量能多发二三十倍。
     * compressImage 在个别端没有/失败时直接发原图，不阻断聊天。
     */
    prepareImage(filePath) {
      const self = this
      const send = function (p) {
        self.uploadAndSend(p || filePath)
      }
      if (typeof uni.compressImage !== 'function') return send(filePath)
      uni.compressImage({
        src: filePath,
        quality: 60,
        compressedWidth: 1280,
        success(res) {
          send(res.tempFilePath)
        },
        fail(e) {
          console.warn('[chat] 图片二次压缩失败，发原图', e && e.errMsg)
          send(filePath)
        }
      })
    },

    async uploadAndSend(filePath) {
      if (this.sending) return
      this.sending = true
      uni.showLoading({ title: '上传中…' })
      try {
        // 图片直传云存储，不走云函数（云函数中转会把图片塞进请求体，容易超限）
        // ★ cloudPath 必须带随机串：支付宝云/腾讯云的 cloudPath 是"文件的绝对路径"，
        //   同路径会直接覆盖。只用毫秒时间戳，连点两下同一毫秒就会互覆盖。
        const rand = Math.random().toString(36).slice(2, 10)
        const up = await uniCloud.uploadFile({
          filePath: filePath,
          cloudPath: 'chat/' + this.conversationId + '/' + Date.now() + '-' + rand + '.jpg',
          fileType: 'image'
        })
        uni.hideLoading()
        if (!up || !up.fileID) {
          uni.showToast({ title: '上传失败', icon: 'none' })
          return
        }
        // ★ 统一把 fileID 存成 cloud:// 形式，渲染时再换临时 URL。
        //   阿里云返回的是 https 链接可以直接用，支付宝云返回 cloud:// 必须转换；
        //   这里统一成 cloud://，渲染层就不用到处判断平台。
        const fileID = toCloudFileID(up.fileID)
        const localUrl = filePath
        await this.doSend({ type: 'image', content: fileID }, localUrl)
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: '图片上传失败', icon: 'none' })
      } finally {
        this.sending = false
      }
    },

    /**
     * 乐观发送：先插本地气泡（发送中），再调 transport。
     * 失败时不清空气泡，而是标记 failed，让用户能重试 —— 
     * 直接删掉用户刚打的字是最让人恼火的交互。
     */
    async doSend(payload, localUrl) {
      const clientMsgId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      // 自己发的气泡也要有头像 —— 从本地缓存的登录信息里取，
      // 不然等服务端回包才出图，气泡会先空着再突然长出来一个头像。
      const me = uni.getStorageSync('userInfo') || {}
      const local = {
        key: clientMsgId,
        _id: '',
        clientMsgId: clientMsgId,
        is_me: true,
        type: payload.type,
        content: payload.content,
        sender_name: me.nickname || '我',
        sender_avatar: me.avatar_url || me.avatar || '',
        created_at: Date.now(),
        timeText: this.fmtBubbleTime(Date.now()),
        failed: false
      }
      // ★ 图片刚发出去时 content 是 cloud:// 的 fileID，还不能直接当 src 用，
      //   所以先用本地临时路径顶上（localUrl），等 resolveFileURLs 换成临时 URL 后再覆盖。
      //   resolved 必须为 false：本地临时路径重启后会被系统清掉，
      //   只有换成云链接之后这张图才是稳定可用的。
      local.resolved = false
      if (payload.type === 'image') local.displayUrl = localUrl || ''
      this.messages.push(local)
      this.sortMessages()
      this.scrollToEnd()
      if (this.chat) this.chat.touch()

      this.sending = true
      try {
        const msg = await this.chat.send({
          type: payload.type,
          content: payload.content,
          clientMsgId: clientMsgId
        })
        // ★ 这里不写 chat_last_ 缓存。
        //   缓存是"下次进页面从这个 _id 往后拉"的起点。如果发完消息就把它
        //   写成自己刚发的那条，下次进页面只会拿到这一条 —— 之前的历史全部丢失
        //   （录屏实测：发 147 之后重进，只剩 147）。
        //   起点统一由 mergeMessages 在收到服务端消息后推进。
        if (msg && msg._id) {
          // 只把本地气泡补上服务端 _id，让它在后续去重里能对上
          const i = this.messages.findIndex(function (m) {
            return m.clientMsgId === clientMsgId
          })
          if (i > -1 && !this.messages[i]._id) {
            this.$set(
              this.messages,
              i,
              Object.assign({}, this.messages[i], {
                _id: msg._id,
                created_at: msg.created_at || this.messages[i].created_at,
                timeText: this.fmtBubbleTime(msg.created_at || this.messages[i].created_at)
              })
            )
          }
        }
      } catch (e) {
        const idx = this.messages.findIndex(function (m) {
          return m.clientMsgId === clientMsgId
        })
        if (idx > -1) {
          this.$set(this.messages, idx, Object.assign({}, this.messages[idx], { failed: true }))
        }
      } finally {
        this.sending = false
      }
    },

    retry(m) {
      const idx = this.messages.findIndex(function (x) {
        return x.key === m.key
      })
      if (idx > -1) this.messages.splice(idx, 1)
      this.doSend({ type: m.type, content: m.content })
    },

    /**
     * 滚动监听：判断用户是不是"贴着底部"。
     *
     * 为什么要它：轮询每 3 秒拉一次消息，每次 mergeMessages 都会让列表变化。
     * 如果无条件滚到底，用户正在往上翻历史时会被一路拽回来。
     * 这里记下用户的位置，只有他本来就在底部（新消息本来就该出现在视野里）
     * 才自动跟随；一旦他往上翻了，新消息只静静插入，不打断阅读。
     *
     * 阈值 40px：留一点余量，因为图片加载、气泡高度微调都会让 scrollTop 差几个像素，
     * 用严格相等会导致"明明在底部却不跟随"。
     */
    onScroll(e) {
      const d = e.detail || {}
      const st = d.scrollTop || 0
      const sh = d.scrollHeight || 0
      const ch = d.clientHeight || 0
      // scrollHeight 拿不到时（部分平台不返回），保守认为在底部，保持原有跟随行为
      if (sh <= 0) {
        this.atBottom = true
        return
      }
      this.atBottom = sh - st - ch <= 40
    },

    /**
     * ★ 首次进入：把消息区**直接**定位到底部，不做滚动动画。
     *
     * 为什么不复用 scrollToEnd：那个方法是「先清空锚点、下一帧再设锚点」，
     * 配合 scroll-with-animation 会走一段可见的滚动过程。用户要的是
     * 点进会话就在底部，而不是每次进来都快速滚一遍。
     *
     * 这里只做两件事：确认锚点已生效、把复位计时挂上。
     * 不设 atBottom —— 那是 onScroll 的职责，这里设了会在用户
     * 往后翻历史之前就假定他在底部。
     */
    anchorBottomNoAnimation() {
      const self = this
      if (this.scrollResetTimer) clearTimeout(this.scrollResetTimer)
      this.$nextTick(function () {
        // 锚点没生效时补设一次（首帧渲染前设的值可能被吞掉）
        if (self.scrollInto !== 'msg-end') self.scrollInto = 'msg-end'
        // 与 scrollToEnd 同样要复位：锚点留着会让任何布局变化再次触发滚动
        self.scrollResetTimer = setTimeout(function () {
          self.scrollInto = ''
          self.scrollResetTimer = null
          // 首次定位完成后才允许后续跟随带动画
          self.scrollAnimated = true
        }, 320)
      })
    },

    scrollToEnd() {
      const self = this
      if (this.scrollResetTimer) clearTimeout(this.scrollResetTimer)
      this.$nextTick(function () {
        self.scrollInto = ''
        self.$nextTick(function () {
          self.scrollInto = 'msg-end'
          // scrollIntoView 触发后用户自然回到末尾
          self.atBottom = true
          // ★ 关键：滚到底之后必须把 scrollInto 复位。
          //   scroll-into-view 只要还留着值，任何布局变化都会**再次**触发滚动 ——
          //   图片一张张加载完、气泡高度随之变化，就会把用户一路拽到末尾。
          //   这正是「图片从旧到新加载时页面跟着滚」的原因。
          //   复位成空串后，布局变化不再触发滚动；后续要滚由 mergeMessages /
          //   doSend 在需要时重新调用本方法。
          self.scrollResetTimer = setTimeout(function () {
            self.scrollInto = ''
            self.scrollResetTimer = null
          }, 320)
        })
      })
    },

    previewImage(url) {
      if (!url) return
      uni.previewImage({ urls: [url], current: url })
    },

    /** 图片加载失败：标记一下，模板里换成"图片加载失败"占位，不要一直白框 */
    onImgError(m) {
      const idx = this.messages.findIndex(function (x) {
        return x.key === m.key
      })
      if (idx > -1) {
        m.imgFailed = true
      }
      // ★ 这条链接已不可用（多半是临时链接过期）。
      //   删掉持久缓存里那条、并清掉气泡上的 displayUrl，
      //   下一次 resolveFileURLs 会重新换一条新链接，而不是一直白框。
      if (m.type === 'image' && isCloudFileID(m.content) && m.content) {
        // ★ 三处记录都要作废，少一处都会导致同一个坏路径被反复取用、一直白框：
        //   ① 链接缓存  ② 本地文件记录  ③ 气泡上的 displayUrl 与 resolved 标记
        invalidateImageUrl(m.content)
        forgetLocalImage(m.content)
        delete this.urlCache[m.content]
        m.displayUrl = ''
        m.resolved = false // 下次 resolveFileURLs 会重新换一条链接
        // 下一次会重新走「换链接 → 存本地」的完整流程
      }
    },

    /**
     * 把消息里 cloud:// 的 fileID 批量换成临时 URL。
     *
     * 为什么必须做：支付宝云 uploadFile 返回的 fileID 是 cloud:// 形式，
     * 不是可以直接访问的链接（官方文档：阿里云返回链接形式可直接用，
     * 支付宝云与腾讯云需调用 getTempFileURL 换链接）。直接塞给 <image> 就是白框。
     *
     * 为什么批量：一屏 30 条消息里可能有 10 张图，逐张调用要发 10 次请求，
     * 免费版 1.5 万次/月的额度撑不住。这里一次请求全换。
     *
     * 为什么要有缓存：轮询每 3 秒回来一次，如果每次都重新换一遍，
     * 额度和流量都会爆。tempFileURL 有效期内（默认约 2 小时）直接复用。
     */
    async resolveFileURLs() {
      const self = this
      // 收集需要换链接的图片消息。
      // ★ 判据是显式的 resolved 标记，不是「displayUrl 是否为空」：
      //   自己刚发的图，乐观气泡里 displayUrl 是本地临时路径（filePath），
      //   非空但并不是云链接，重启后会被系统清掉。
      //   按「非空就跳过」会让这张图永远换不成云链接，重启后要白一下才显示。
      const pending = self.messages.filter(function (m) {
        return m.type === 'image' && isCloudFileID(m.content) && !m.resolved
      })
      if (!pending.length) return

      // 查询顺序：手机上已存的文件 → 内存链接 → 本地存储链接 → 才发请求
      // 最理想的是命中已存文件：直接用 file:// 本地路径渲染，图片一个字节都不下载。
      const needFetch = []
      pending.forEach(function (m) {
        const local = getLocalImage(m.content)
        if (local) {
          m.displayUrl = local
          m.resolved = true
          return
        }
        const hit = self.urlCache[m.content] || getImageUrl(m.content)
        if (hit) {
          m.displayUrl = hit // 直接改对象属性，Vue2 对已存在属性是响应式的
          m.resolved = true
          self.urlCache[m.content] = hit
          // 已经拿到云链接了，顺手把它存成本地文件，下次就不用下载了
          self.saveToLocal(m.content, hit)
        } else {
          needFetch.push(m.content)
        }
      })
      if (!needFetch.length) return

      // 去重后一次请求
      const uniq = needFetch.filter(function (v, i, arr) {
        return arr.indexOf(v) === i
      })

      // 换到的链接先攒起来，一次写进本地存储（避免每张图各写一遍）
      const saved = {}
      // ★ 分批请求。一次把几十个 fileID 丢过去，只要其中一个 fileID 已失效
      //   （图片被删、fileID 拼错），整批都可能失败 → 这一屏的图全部白屏。
      //   分小批 + 批间互不影响，坏的那张只影响它自己。
      const BATCH = 20
      for (let b = 0; b < uniq.length; b += BATCH) {
        const batch = uniq.slice(b, b + BATCH)
        try {
          const res = await uniCloud.getTempFileURL({ fileList: batch })
          const list = (res && res.fileList) || []
          list.forEach(function (item) {
            const id = item.fileID
            const url = item.tempFileURL
            // fileID 无效时 SDK 会把 tempFileURL 填成原 fileID，这种要丢掉
            if (id && url && url !== id) {
              self.urlCache[id] = url
              self.$set(self.urlCache, id, url)
              // ★ 落本地存储：下次进页面不再为这些图发请求
              saved[id] = url
            }
          })
        } catch (e) {
          // 单批失败不影响其它批：换链接失败不该让整个聊天页崩掉
          console.warn('[chat] getTempFileURL 单批失败', e)
        }
      }
      if (Object.keys(saved).length) putImageUrls(saved)
      // 回填到消息上（含本地路径那批：现在被换成云链接了）
      self.messages.forEach(function (m) {
        if (m.type === 'image' && isCloudFileID(m.content) && !m.resolved) {
          const url = self.urlCache[m.content]
          if (url) {
            m.displayUrl = url
            m.resolved = true
            m.imgFailed = false // 拿到可用链接了，把失败标记清掉
          }
        }
      })
      // ★ 再把这一批云链接的图存到手机本地。
      //   存好之后 displayUrl 会被换成 file:// 本地路径，
      //   以后再进这个会话，这几张图直接读本地文件，完全不联网。
      //   下载是后台排队做的（最多 3 张并发），不阻塞本次渲染。
      Object.keys(saved).forEach(function (id) {
        self.saveToLocal(id, saved[id])
      })
    },

    /**
     * 把一张图下载并存到手机本地，存好后把气泡的 displayUrl 换成本地路径。
     * 失败无副作用：图片继续用云链接显示，只是下次还得再下一次。
     */
    saveToLocal(fileID, url) {
      const self = this
      ensureLocalImage(fileID, url, function (id, localPath) {
        self.messages.forEach(function (m) {
          if (m.type === 'image' && m.content === id) {
            m.displayUrl = localPath
            m.resolved = true
          }
        })
      })
    },

    colorHex(name) {
      return TAG_COLORS[name] || '#ffde00'
    },

    // 搭子标签固定形状是「前缀 + 搭子」，库里只存前缀，显示时补后缀。
    // 已带后缀的防重复，避免「啊哈哈搭子搭子」。
    tagText(raw) {
      const s = String(raw || '').trim()
      if (!s) return ''
      return s.slice(-2) === '搭子' ? s : s + '搭子'
    },

    /** 草稿本地保存：切出去接个电话回来，打了一半的字还在 */
    /** 点顶部头像 / 名字 → 对方主页 */
  goPeer() {
    if (this.isAi) return
    if (!this.peerId) {
      uni.showToast({ title: '资料加载中，稍后再试', icon: 'none' })
      return
    }
    uni.navigateTo({
      url: '/pages/user/user?id=' + encodeURIComponent(this.peerId)
    })
  },

    autoSaveDraft() {
      const key = 'chat_draft_' + this.conversationId
      this.draft = uni.getStorageSync(key) || ''
      this.$watch('draft', (v) => {
        uni.setStorageSync(key, v || '')
      })
    },
  },

  /**
   * 页面渲染完成再起轮询（不用 onLoad：onLoad 时页面还没挂载，
   * 首次 setData 可能被吞掉，气泡会闪一下才出现）。
   * initChat 内部有 running 判断，重复调是安全的。
   */
  onReady() {
    if (!this.isAi && this.conversationId && !this.chat) {
      this.initChat()
    }
  }
}
</script>

<style scoped>
/* 头像 + 名字一起点，热区大一点好点中 */
.bar-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.chat-wrap {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--tf-bg);
}

/* 自定义导航栏后的状态栏占位：高度由 JS 按机型注入，这里只保证不被压缩 */
.status-bar {
  flex: none;
  background: var(--tf-card);
}

/* —— 顶部条 —— */
.chat-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  background: var(--tf-card);
  border-bottom: 3rpx solid var(--tf-text);
  flex: none;
  /* 标签多的时候允许换行，不要把名字挤没 */
  flex-wrap: wrap;
}
/* 返回键：自定义导航栏后系统箭头没了，自己给一个 */
.bar-back {
  flex: none;
  font-size: 52rpx;
  line-height: 1;
  font-weight: 700;
  padding: 0 8rpx 4rpx 0;
}
.avatar {
  width: 76rpx;
  height: 76rpx;
  border: 3rpx solid var(--tf-text);
  background: var(--tf-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 30rpx;
  flex: none;
}
.avatar--orange {
  background: var(--tf-primary);
  color: #fff;
  font-size: 22rpx;
}
.bar-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.convo-name {
  font-weight: 800;
  font-size: 30rpx;
}
.bar-sub {
  font-size: 20rpx;
  color: var(--tf-text-3);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.chat-buddy-tag {
  border: 3rpx solid var(--tf-text);
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  font-weight: 700;
  flex: none;
}
.conn {
  font-size: 18rpx;
  border: 2rpx solid var(--tf-text);
  padding: 2rpx 8rpx;
  flex: none;
  color: var(--tf-text-3);
}
.conn--online {
  color: var(--tf-success);
  border-color: var(--tf-success);
}
.conn--offline {
  color: var(--tf-danger);
  border-color: var(--tf-danger);
}

/* —— 消息区 —— */
.chat-scroll {
  flex: 1;
  padding: 24rpx;
  box-sizing: border-box;
  overflow: hidden;
}
.chat-hint {
  text-align: center;
  color: var(--tf-text-3);
  font-size: 24rpx;
  padding: 60rpx 0;
}
.chat-end-pad {
  height: 20rpx;
}

/* 一条消息 = 头像 + 气泡，横向排列（仿 QQ / 抖音）。
   对方的头像在左、自己的在右，靠 .is-me 把 flex-direction 反过来，
   这样模板里永远是"先头像后气泡"，不用写两套结构。 */
.bubble-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 14rpx;
  margin-bottom: 24rpx;
}
.bubble-row.is-me {
  flex-direction: row-reverse;
}

/* —— 消息头像 —— */
.msg-avatar {
  width: 72rpx;
  height: 72rpx;
  flex: none;
  border: 3rpx solid var(--tf-text);
  background: var(--tf-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* 头像永远对齐气泡顶部，不随气泡高度居中 —— 长消息居中会显得很怪 */
  margin-top: 4rpx;
}
.msg-avatar--me {
  background: var(--tf-primary);
}
.msg-avatar-img {
  width: 100%;
  height: 100%;
}
.msg-avatar-text {
  font-size: 28rpx;
  font-weight: 800;
}
.msg-avatar--me .msg-avatar-text {
  color: #fff;
}

.bubble-col {
  max-width: 76%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.bubble-row.is-me .bubble-col {
  align-items: flex-end;
}
.bubble {
  border: 3rpx solid var(--tf-text);
  background: var(--tf-card);
  box-shadow: 4rpx 4rpx 0 var(--tf-text);
  padding: 18rpx 22rpx;
}
.bubble-row.is-me .bubble {
  background: var(--tf-primary);
}
.bubble-text {
  font-size: 28rpx;
  line-height: 1.5;
  word-break: break-all;
}
.bubble-row.is-me .bubble-text {
  color: #fff;
}
.bubble-img {
  width: 380rpx;
  border: 3rpx solid var(--tf-text);
  box-shadow: 4rpx 4rpx 0 var(--tf-text);
  background: var(--tf-card);
  /* 加载过程中先占住一个方形位置，减少图片撑开时的高度跳变 */
  min-height: 380rpx;
}
/* 图片还没换到临时 URL（或换链接失败）时的占位，不能留一个纯白框 */
.bubble-img-ph {
  width: 380rpx;
  height: 260rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3rpx solid var(--tf-text);
  box-shadow: 4rpx 4rpx 0 var(--tf-text);
  background: var(--tf-line);
}
.bubble-img-ph-text {
  font-size: 24rpx;
  color: var(--tf-text-3);
}
.bubble-time {
  font-size: 18rpx;
  color: var(--tf-text-3);
  padding-top: 6rpx;
}
.bubble-retry {
  font-size: 20rpx;
  color: var(--tf-danger);
  padding-top: 6rpx;
  text-decoration: underline;
}

/* —— 输入区 —— */
.chat-input {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 18rpx 24rpx;
  background: var(--tf-card);
  border-top: 3rpx solid var(--tf-text);
  flex: none;
}
.pic-btn {
  font-size: 40rpx;
  flex: none;
  padding: 0 6rpx;
}
.input {
  flex: 1;
  height: 72rpx;
  border: 3rpx solid var(--tf-text);
  background: var(--tf-bg);
  padding: 0 18rpx;
  font-size: 28rpx;
}
.btn {
  border: 3rpx solid var(--tf-text);
  background: var(--tf-card);
  box-shadow: 3rpx 3rpx 0 var(--tf-text);
  font-weight: 700;
  flex: none;
}
.btn--orange {
  background: var(--tf-primary);
  color: #fff;
}
.btn--sm {
  height: 72rpx;
  line-height: 66rpx;
  font-size: 28rpx;
  padding: 0 26rpx;
}

/* —— AI 免责声明：一直显示，不折叠 —— */
.ai-note {
  padding: 16rpx 24rpx 24rpx;
  background: var(--tf-card);
  flex: none;
}
.ai-note-text {
  font-size: 20rpx;
  color: var(--tf-text-3);
  line-height: 1.5;
}
</style>
