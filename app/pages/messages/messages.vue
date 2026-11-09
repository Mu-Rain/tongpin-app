<template>
  <view class="page">
    <!-- 原生导航已关，自绘大标题（tab 页，不需要返回键） -->
    <view class="msg-head">
      <text class="msg-title">消息</text>
    </view>

    <view class="screen-body">
      <!-- ===== AI 情绪引导入口：已临时收起（2026-11-01）=====
           AI 会话本身还是桩（chat.vue:494-507），入口放出去就是把人送到「还没接入」。
           恢复办法：把下面这段放回来，goAi() 和它的 ai_entry_click 埋点都还在，
           .ai-row / .ai-bar / .avatar--ai 三条样式也都没删。
      <view class="ai-row" @tap="goAi">
        <view class="ai-bar" />
        <view class="avatar avatar--ai">AI</view>
        <view class="convo-main">
          <view class="convo-top">
            <text class="convo-name">情绪引导机器人</text>
            <text class="mono muted">全天在线</text>
          </view>
          <text class="convo-last">想聊聊吗？随时都在</text>
        </view>
      </view> -->

      <!-- ===== 收到的搭子邀请 =====
           丙方案：一对人可以有多个搭子，但只占一条会话。
           所以别人邀请你做第 2、第 3 个搭子时，在会话列表里是"看不见"的 ——
           必须有这块独立的入口，否则邀请发出去对方永远不知道。 -->
      <view v-if="invites.length" class="invite-block">
        <view class="invite-head">
          <text class="invite-title">搭子邀请</text>
          <text class="invite-count">{{ invites.length }} 个待处理</text>
        </view>

        <view v-for="iv in invites" :key="iv.invite_id" class="invite-card">
          <view class="invite-top">
            <!-- 邀请数据里没有对方头像字段。按「不显示默认头像」的约束留空圆，
                 不塞任何默认头像图、不塞昵称首字。 -->
            <view class="avatar" />
            <view class="invite-main">
              <text class="invite-name">{{ iv.from_name || '有人' }}</text>
              <!-- ★ 这里不显示对方起的搭子标签。
                   搭子标签是私有备注：谁起的只有谁看得见，
                   别人发来的邀请里那个名字属于对方，我无权查看。
                   所以只按类型说「想和你做学习搭子」，不暴露对方备注。 -->
              <text class="invite-say">想和你做{{ categoryLabel(iv.category) }}</text>
            </view>
          </view>
          <text v-if="iv.message" class="invite-msg">「{{ iv.message }}」</text>
          <view class="invite-btns">
            <button class="btn btn--sm btn--plain" @tap="decideInvite(iv, 'reject')">婉拒</button>
            <button class="btn btn--sm" @tap="openAccept(iv)">接受</button>
          </view>
        </view>
      </view>

      <!-- ===== 会话列表 ===== -->
      <view v-if="loading" class="hint">正在加载…</view>

      <view v-else-if="!conversations.length" class="empty">
        <text class="empty-title">还没有聊过天</text>
        <text class="empty-desc">去搭子大厅找个人，申请通过后就能开聊</text>
        <button class="btn" @tap="goHall">去搭子大厅 →</button>
      </view>

      <!-- ★ 排序完全听服务端（message-conversations 已按
           pin_locked → pinned → last_at 排好），前端**不得再 sort**，
           再排一次会把搭子会话的强制置顶顶掉。 -->
      <view v-else>
        <view
          v-for="c in conversations"
          :key="c.conversation_id"
          class="convo"
          :class="{ 'convo--top': c.pin_locked || c.pinned }"
          @tap="openChat(c)"
          @longpress="openConvoMenu(c)"
        >
          <!-- 头像：走 common/avatar/avatarCache.js —— 本地落盘 + 解码完成后整体淡入。
               ★ 没有可用链接就留空圆（.avatar 自带圆底），绝不塞默认头像图、不塞昵称首字。
               逐条用自己的 conversation_id 当淡入 key：一张图加载完不会让整屏一起亮。 -->
          <image
            v-if="avaSrcOf(c.conversation_id)"
            class="avatar avatar--img ava-fade"
            :class="{ 'ava-fade--in': avaReadyOf(c.conversation_id) }"
            :src="avaSrcOf(c.conversation_id)"
            mode="aspectFill"
            lazy-load="true"
            @load="avaOnLoad(c.conversation_id)"
            @error="onConvoAvatarError(c)"
          />
          <!-- 没有可用链接 / 还没解析出本地文件：同一个 88rpx 的空圆占位。
               不用 v-if 把行内空间摘掉，否则名字会整列左移 88rpx。 -->
          <view v-else class="avatar" />
          <view class="convo-main">
            <view class="convo-top">
              <view class="convo-name-row">
                <!-- 这里曾经有一个「搭子」胶囊徽标，已按用户要求删除：
                     搭子关系由下面那排彩色搭子标签（shiny-tag）表达，再给一个徽标是重复信息；
                     橙色又会和「好友」的绿色徽标抢注意力，两种关系标识同时出现反而更乱。
                     会话被强制置顶这件事由左侧竖杠（.convo--top）表达，不需要文字解释。 -->
                <text class="convo-name">{{ displayName(c) }}</text>
                <!-- 免打扰：名字右侧一个 🔕，未读角标一并隐藏（免打扰不计角标） -->
                <text v-if="c.muted" class="mute-icon">🔕</text>
              </view>
              <text class="mono muted">{{ fmtTime(c.last_at) }}</text>
            </view>
            <text class="convo-last">{{ c.last_text }}</text>
            <view class="convo-meta">
              <!-- 多搭子：同一对人可能有多段关系，标签要全部显示（合成一张卡） -->
              <block v-if="c.buddy_tags && c.buddy_tags.length">
                <text
                  v-for="(t, ti) in c.buddy_tags"
                  :key="ti"
                  class="shiny-tag"
                  :style="{ backgroundColor: colorHex(t.color) }"
                  >{{ tagText(t.label) }}</text
                >
              </block>
              <text
                v-else-if="c.buddy_tag"
                class="shiny-tag"
                :style="{ backgroundColor: colorHex(c.buddy_tag_color) }"
                >{{ tagText(c.buddy_tag) }}</text
              >
              <!-- 好友标识。成为好友时上面那些搭子标签会被收掉（产品决策：
                   成为好友即收掉搭子），所以这一行要留一个「好友」小徽标，
                   否则用户会以为关系断了。用 v-if 独立判断、不跟标签互斥，
                   万一两个同时存在也只是多一个徽标，不会错位。 -->
              <text v-if="c.is_friend" class="friend-badge">好友</text>
              <text v-if="c.school" class="tag">{{ c.school }}</text>
            </view>
          </view>
          <!-- 免打扰的会话不显示角标（产品决定：免打扰 = 不打扰） -->
          <text v-if="c.unread > 0 && !c.muted" class="unread">{{ c.unread > 99 ? '99+' : c.unread }}</text>
        </view>
      </view>

      <!-- 「我的搭子与标签」已迁到「我的」页（文档 §4.3）——它不属于消息页 -->

      <!-- 空态接管（文档 §4.2）：真实会话不足时不留大片空白，
           直接接上 AI 入口，形成「没有人聊 → 但随时有人在」的叙事 -->
      <view v-if="!conversations.length && !invites.length" class="empty-chat">
        <view class="empty-ico">💬</view>
        <text class="empty-title">还没有更多对话</text>
        <text class="empty-sub">去找个搭子，一起自习、吃饭、运动</text>
        <view class="empty-actions">
          <view class="empty-btn empty-btn--main" @tap="goBuddy">去找搭子</view>
        </view>
      </view>
    </view>

    <!-- ===== 接受邀请：先给对方起个名（可跳过） =====
         搭子标签是私有备注（我起的只我能看见、对方起的只对方能看见），
         所以这里只让我起**我自己**给对方的名字；
         对方在邀请里写的那个名字不会展示给我，也不在下面回显。 -->
    <view v-if="accepting" class="mask" @tap="closeAccept">
      <view class="sheet" @tap.stop>
        <text class="sheet-title">接受邀请</text>
        <text class="sheet-sub"
          >{{ accepting.from_name || '对方' }} 想和你做{{ categoryLabel(accepting.category) }}</text
        >

        <text class="sheet-label">你打算叫 TA 什么？（可跳过）</text>
        <view class="input-row">
          <input
            class="input"
            v-model="acceptLabel"
            :maxlength="MAX_LABEL_LEN"
            placeholder="比如：自习、夜跑"
            @input="onAcceptLabelInput"
          />
          <text class="input-suffix">搭子</text>
        </view>
        <text class="sheet-hint">{{ acceptLabel.length }}/{{ MAX_LABEL_LEN }} 字，加上「搭子」共 8 字</text>

        <text class="sheet-label">给它一个颜色</text>
        <view class="swatches">
          <!--
            这里不能写 TAG_COLORS[k]：TAG_COLORS 是 script 顶层的 const，
            不在 data() 里，模板访问不到，会抛
            「Property "TAG_COLORS" was accessed during render but is not defined on instance」，
            整个渲染函数崩掉 → 页面白屏。
            必须走 methods 里的 colorHex()，它在实例上，模板能访问。
          -->
          <view
            v-for="k in COLOR_KEYS"
            :key="k"
            class="swatch"
            :class="{ 'swatch--on': acceptColor === k }"
            :style="{ backgroundColor: colorHex(k) }"
            @tap="acceptColor = k"
          />
        </view>

        <view class="sheet-btns">
          <button class="btn btn--plain" @tap="closeAccept">取消</button>
          <button class="btn" @tap="submitAccept(false)">接受，先不起名</button>
          <button class="btn btn--primary" @tap="submitAccept(true)">接受并存名</button>
        </view>
      </view>
    </view>
  </view>

  <!-- 自定义 tabBar（pages.json 已开 custom: true） -->
  <custom-tab-bar />
</template>

<script>
import customTabBar from '@/custom-tab-bar/index.vue'
import track from '@/utils/track.js'
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'
/** 闪亮预设色（与原型 TAG_COLORS 一致） */
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

/* ---------- 会话列表本地快照（首屏秒开） ----------
   进消息页先拿上次的快照渲染，不用再等 message-conversations 的一个 RTT。
   快照只服务首屏：请求回来后整表覆盖，服务端数据永远优先。
   http(s) 临时链接一律不落盘 —— 它们会过期，落盘后首屏就是一片裂图。 */
const SNAP_KEY_PREFIX = 'conv_snap_v1_'
const SNAP_MAX_COUNT = 40
const SNAP_MAX_BYTES = 60 * 1024
const SNAP_TEXT_MAX = 60
let snapTimer = null

function snapUid() {
  const info = uni.getStorageSync('userInfo')
  if (!info || !info._id) return ''
  return String(info._id)
}

function isTempLink(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v)
}

/* 递归剥掉临时链接：字段名以 displayUrl / localUrl 结尾的整键丢弃，
   任意层级上的 http(s) 字符串值丢弃。depth 封顶防止脏数据里的环。 */
function slimValue(v, depth) {
  if (typeof v === 'string') return isTempLink(v) ? undefined : v
  if (depth > 8 || !v || typeof v !== 'object') return v
  if (Array.isArray(v)) {
    const arr = []
    for (const item of v) {
      const slim = slimValue(item, depth + 1)
      if (slim !== undefined) arr.push(slim)
    }
    return arr
  }
  const out = {}
  for (const k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue
    if (/displayUrl$|localUrl$/.test(k)) continue
    const slim = slimValue(v[k], depth + 1)
    if (slim !== undefined) out[k] = slim
  }
  return out
}

function slimConvo(c) {
  const s = slimValue(c, 0)
  if (!s || typeof s !== 'object') return null
  if (typeof s.last_text === 'string' && s.last_text.length > SNAP_TEXT_MAX) {
    s.last_text = s.last_text.slice(0, SNAP_TEXT_MAX)
  }
  // 兜底：递归漏网（层级过深/自定义 getter）的条目整条不要，宁缺不脏
  if (/https?:\/\//i.test(JSON.stringify(s))) return null
  return s
}

/* 中文字符 UTF-8 占 3 字节，json.length 会低估体积，按字节重算一遍 */
function utf8Len(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    n += c > 2047 ? 3 : c > 127 ? 2 : 1
  }
  return n
}

function buildSnapshot(list) {
  const rows = []
  const arr = Array.isArray(list) ? list : []
  for (const c of arr) {
    if (rows.length >= SNAP_MAX_COUNT) break
    const s = slimConvo(c)
    if (s) rows.push(s)
  }
  // 体积兜底：超了就从尾部（更旧的）丢，头部（最新的）优先留
  let json = JSON.stringify({ at: Date.now(), list: rows })
  while (utf8Len(json) > SNAP_MAX_BYTES && rows.length > 0) {
    rows.pop()
    json = JSON.stringify({ at: Date.now(), list: rows })
  }
  return json
}

function readConvSnapshot(uid) {
  try {
    const raw = uni.getStorageSync(SNAP_KEY_PREFIX + uid)
    if (!raw) return []
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    return obj && Array.isArray(obj.list) ? obj.list : []
  } catch (e) {
    return []
  }
}

function writeConvSnapshot(list) {
  const uid = snapUid()
  if (!uid) return
  try {
    uni.setStorageSync(SNAP_KEY_PREFIX + uid, buildSnapshot(list))
  } catch (e) {
    /* 写不进去就算了，绝不影响列表本身 */
  }
}

export default {
  components: { customTabBar },
  // 头像淡入的公共时序（common/avatar/avatarCache.js），5 个页面共用同一份
  mixins: [avatarFadeMixin],
  data() {
    return {
      conversations: [],
      loading: true,
      // 收到的待处理邀请（丙方案：不会出现在会话列表里，所以单独拉）
      invites: [],

      // 接受邀请弹层
      accepting: null, // 正在处理的邀请对象
      acceptLabel: '', // 我给对方起的标签（前缀，不含"搭子"）
      acceptColor: 'shine-yellow',
      MAX_LABEL_LEN: 6,
      COLOR_KEYS: [
        'shine-yellow',
        'shine-orange',
        'shine-rose',
        'shine-violet',
        'shine-cyan',
        'shine-mint',
        'shine-blue',
        'shine-gold'
      ],

      /* —— tab 切换的调度与去重状态（见 onShow / scheduleTabLoad / loadList）——
         nativeTabHidden：原生 tabBar 藏过就不再藏，重复调是白跑一遍原生布局。
         tabLoadTimer：连点 tab 时后一次调度覆盖前一次，不让几批请求排队。
         listLoading / listPending：message-conversations 的在飞标记与「回来后再补一次」的脏标记。
         tabShowCount / tabDedupCount：只做计数，验收时用来证明「连点没有重复发请求」。 */
      nativeTabHidden: false,
      tabLoadTimer: null,
      listLoading: false,
      listPending: false,
      tabShowCount: 0,
      tabDedupCount: 0
    }
  },

  onShow() {
    this.tabShowCount++
    // ★ App 端 uni-app 不认 pages.json 的 tabBar.custom（那是微信小程序专属），
    //   原生 tabBar 照样渲染 → 会和自定义悬浮条叠成两条，所以每个 tab 页显示时要主动藏掉原生那条。
    //   但只藏一次：hideTabBar 会让原生层重新走一遍 tabBar 的布局与重绘，
    //   藏好之后再调对画面没有任何改变，纯粹是给切 tab 那一帧多压一次原生工作量。
    if (!this.nativeTabHidden) {
      try { uni.hideTabBar({ animation: false }) } catch (e) {}
      this.nativeTabHidden = true
    }
    // 通知自定义 tabBar 重读栈顶 route（switchTab 后 tab 页被缓存，组件不重新 mounted）。
    // 留在同步路径：只是派个事件，跟网络无关，延后反而让滑块慢一拍。
    try { uni.$emit('tfTabShow') } catch (e) {}
    // 每次进这个页面都要刷一次（从聊天页返回时未读数要立刻更新），
    // 但不再在同步路径上直接发：判据与延后策略见 scheduleTabLoad。
    this.scheduleTabLoad()
  },

  onPullDownRefresh() {
    this.loadList().then(() => uni.stopPullDownRefresh())
  },

  /* 会话列表头像绑定。deep 是必要的：头像可能比会话晚一拍到（refresh 里只补了头像字段），
     immediate 是为了「冷启动先拿本地快照画一帧」那条路 —— 快照里的链接可能已过期，
     但本地文件通常还在，同步挂上就不用等网络。 */
  watch: {
    conversations: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (c) => c && c.conversation_id,
          (c) => c && c.avatar
        )
      }
    }
  },
  methods: {
    /* tab 显示后的请求调度：首帧与网络解耦。
       ------------------------------------------------------------------
       loadList 里有 uniCloud 调用，也有 storage 读写（hydrateSnapshot 会读快照）。
       原来这些都在 onShow 的同步路径上，和「页面首次渲染」挤在同一帧里 ——
       切 tab 时那一顿就是这一帧被拉长的。
       判据（是否延后）：
         有会话快照 或 列表里已有数据 → 首帧有东西可画 → 延后（$nextTick + 30ms，让首帧先提交）。
         两者都没有（第一次进聊天页，也从没写过快照）→ 0ms（让出首帧，但不多等）。
       去重不在本函数做：loadList 自己有在飞标记。 */
    scheduleTabLoad() {
      const uid = snapUid()
      const hasCache = this.conversations.length > 0 || (uid ? readConvSnapshot(uid).length > 0 : false)
      // 有快照可画 → 30ms，给渲染管线留一帧余量；连快照都没有 → 0ms。
      // 0ms 不等于「同步发」：它照样是一个宏任务，首帧会先提交，用户几乎察觉不到，
      // 但 uniCloud 调用的初始化就不会再挤进首帧那一帧。
      const delay = hasCache ? 30 : 0
      // 连点 tab 会有多次调度：只保留最后一个，避免几批请求排队发出
      if (this.tabLoadTimer) clearTimeout(this.tabLoadTimer)
      this.$nextTick(() => {
        // 同一个 tick 里连点两次会注册两个 nextTick 回调：先清掉前一个定时器再设，
        // 保证最终只剩一个待执行的调度（否则两个定时器会几乎同时发出两批请求）
        if (this.tabLoadTimer) clearTimeout(this.tabLoadTimer)
        this.tabLoadTimer = setTimeout(() => {
          this.tabLoadTimer = null
          this.loadList()
        }, delay)
      })
    },

    async loadList() {
      const token = uni.getStorageSync('token')
      if (!token) {
        this.loading = false
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      // ★ 在飞去重：上一次 message-conversations 还没回来时又进了页面（快速连点 tab），
      //   不再发第二条 —— 只登记「回来后再补一次最新数据」，由 finally 里补发。
      if (this.listLoading) {
        this.listPending = true
        this.tabDedupCount++
        return
      }
      this.listLoading = true
      // 先把本地快照顶上去，首屏不再是骨架屏；请求回来会整表覆盖
      this.hydrateSnapshot()
      // 邀请与会话列表互不依赖（两个接口、两处状态）：先让邀请请求上路，
      // 再等会话列表，两个 RTT 压成一个。loadInvites 自己吞异常，
      // 失败只是少一块「搭子邀请」，不影响会话列表。
      this.loadInvites()
      try {
        const res = await uniCloud.callFunction({
          name: 'message-conversations',
          data: { token: token }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '加载失败', icon: 'none' })
          this.loading = false
          return
        }
        this.conversations = (r.data && r.data.list) || []
        // 服务端数据才写快照：快照永远是服务端的缓存，不是另一个真相源
        this.scheduleSnapshotSave()
        // ★ 把服务端的全局未读总数广播出去，让所有 tabBar 实例立刻更新红点。
        //   用服务端的 total_unread 而不是把上面 list 的 c.unread 加起来 ——
        //   免打扰会话在服务端已排除，客户端自己加会算多。
        if (r.data && typeof r.data.total_unread === 'number') {
          try { uni.$emit('tfUnread', { total: r.data.total_unread }) } catch (e) {}
        }
      } catch (e) {
        uni.showToast({ title: '网络不太好', icon: 'none' })
      } finally {
        this.loading = false
        this.listLoading = false
        if (this.listPending) {
          this.listPending = false
          // 在飞期间又进过页面：补一次最新数据（补发走的还是 loadList，不会自激）
          setTimeout(() => this.loadList(), 0)
        }
      }
    },

    /* 首屏快照：只在列表还空着（首次进页面）时用。
       已经有数据说明刚渲染过，再拿旧快照盖一次只会闪一下旧数据。 */
    hydrateSnapshot() {
      if (this.conversations.length) return
      const uid = snapUid()
      if (!uid) return
      const list = readConvSnapshot(uid)
      if (!list.length) return
      this.conversations = list
      this.loading = false
    },

    /* 落盘延迟 800ms 合并：列表写好之后才轮到缓存，缓存不该拖首屏 */
    scheduleSnapshotSave() {
      if (!snapUid()) return
      if (snapTimer) clearTimeout(snapTimer)
      snapTimer = setTimeout(() => {
        snapTimer = null
        writeConvSnapshot(this.conversations)
      }, 800)
    },

    async loadInvites() {
      const token = uni.getStorageSync('token')
      if (!token) return
      try {
        const res = await uniCloud.callFunction({
          name: 'buddy-invite',
          data: { token: token, action: 'list', box: 'in' }
        })
        const r = res.result || {}
        if (r.code === 0) {
          this.invites = (r.data && r.data.list) || []
        }
      } catch (e) {
        /* 静默失败 */
      }
    },

    async decideInvite(iv, action) {
      const token = uni.getStorageSync('token')
      if (!token) return
      try {
        const res = await uniCloud.callFunction({
          name: 'buddy-invite',
          data: { token: token, action: action, invite_id: iv.invite_id }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '操作失败', icon: 'none' })
          return
        }
        uni.showToast({
          title: action === 'accept' ? '已成为搭子' : '已婉拒',
          icon: 'none'
        })
        // 从本地列表摘掉，不必等整页刷新
        this.invites = this.invites.filter((x) => x.invite_id !== iv.invite_id)
        if (action === 'accept') this.loadList()
      } catch (e) {
        uni.showToast({ title: '网络不太好', icon: 'none' })
      }
    },

    // ---- 接受邀请：先让用户给对方起个名 ----
    openAccept(iv) {
      this.accepting = iv
      this.acceptLabel = ''
      this.acceptColor = 'shine-yellow'
    },

    closeAccept() {
      this.accepting = null
      this.acceptLabel = ''
    },

    // 用户可能把「搭子」两个字也打进去，实时剥掉，避免「自习搭子搭子」
    onAcceptLabelInput(e) {
      let v = (e.detail && e.detail.value) || ''
      v = v.replace(/\s/g, '')
      if (v.length > this.MAX_LABEL_LEN && v.slice(-2) === '搭子') {
        v = v.slice(0, -2)
      }
      this.acceptLabel = v.slice(0, this.MAX_LABEL_LEN)
    },

    async submitAccept(withLabel) {
      const iv = this.accepting
      if (!iv) return
      if (withLabel && !this.acceptLabel.trim()) {
        uni.showToast({ title: '先起个名，或者选「先不起名」', icon: 'none' })
        return
      }

      const token = uni.getStorageSync('token')
      if (!token) return

      const payload = {
        token: token,
        action: 'accept',
        invite_id: iv.invite_id
      }
      if (withLabel) {
        payload.label = this.acceptLabel.trim()
        payload.color = this.acceptColor
      }

      try {
        const res = await uniCloud.callFunction({ name: 'buddy-invite', data: payload })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '操作失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        this.closeAccept()
        this.invites = this.invites.filter((x) => x.invite_id !== iv.invite_id)
        uni.showToast({ title: '已成为搭子', icon: 'none' })
        this.loadList()

        // 建好后直接进聊天，省一次找会话
        if (d.conversation_id) {
          setTimeout(() => {
            uni.navigateTo({
              url:
                '/pages/chat/chat?conversation_id=' +
                encodeURIComponent(d.conversation_id) +
                '&name=' +
                encodeURIComponent(iv.from_name || '') +
                '&peer_id=' +
                encodeURIComponent(iv.from_user_id || '')
            })
          }, 400)
        }
      } catch (e) {
        uni.showToast({ title: '网络不太好', icon: 'none' })
      }
    },

    colorHex(name) {
      return TAG_COLORS[name] || '#ffde00'
    },

    /**
     * 会话名：我给这个人起过备注就显示备注，否则显示原会话名。
     * ★ message-conversations 正在被改造，老版本没有 c.remark 字段，
     *   所以三层兜底：remark → name → '同学'，任何一层都不能漏，
     *   漏了就会出现 "undefined" 或者一条空白标题。
     */
    displayName(c) {
      const remark = (c && c.remark) || ''
      const name = (c && c.name) || ''
      // 有备注就只显示备注，真实昵称交给下面那行灰色小字
      return remark || name || '同学'
    },

    // 搭子标签的固定形状是「前缀 + 搭子」，搭子两个字不能由用户填。
    // 数据库里只存前缀（buddy_relations.label_a / label_b），显示时统一补后缀。
    // 已经带了后缀的老数据要防重复，不然会出现「啊哈哈搭子搭子」。
    tagText(raw) {
      const s = String(raw || '').trim()
      if (!s) return ''
      return s.slice(-2) === '搭子' ? s : s + '搭子'
    },

    // 邀请里的「想和你做 ___ 搭子」，只能按**类型**说，不能说对方起的名字。
    // 搭子标签是私有备注：对方在邀请里填的那个名字属于对方，我无权查看。
    categoryLabel(cat) {
      const map = {
        study: '学习搭子',
        fitness: '健身搭子',
        photo: '拍照搭子',
        meal: '吃饭搭子',
        sport: '运动搭子',
        other: '搭子'
      }
      return map[String(cat || 'other')] || '搭子'
    },

    fmtTime(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      const now = new Date()
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      if (sameDay) {
        return (
          String(d.getHours()).padStart(2, '0') +
          ':' +
          String(d.getMinutes()).padStart(2, '0')
        )
      }
      const y = new Date(now.getTime() - 86400000)
      const isYesterday =
        d.getFullYear() === y.getFullYear() &&
        d.getMonth() === y.getMonth() &&
        d.getDate() === y.getDate()
      if (isYesterday) return '昨天'
      return d.getMonth() + 1 + '/' + d.getDate()
    },

    /**
     * 会话头像加载失败 → 清掉这一行的链接，并让头像缓存里这一条失效。
     *
     * 为什么要这一步：服务端给的是临时链接（约 2 小时过期）。
     * 消息页有本地快照，冷启动会先拿旧快照画一帧 —— 那时的链接可能已经过期。
     * 清掉之后模板留空圆（不回落默认头像图），下次刷新/进页面会重新解一次。
     */
    onConvoAvatarError(c) {
      this.avaOnError(c && c.conversation_id, c && c.avatar)
      if (c && c.avatar) c.avatar = ''
    },

    openChat(c) {
      // 多搭子：把全部标签用「前缀|颜色」拼成逗号串传给聊天页，
      // 让它顶部也能并排显示多个标签，而不是只有一个。
      const allTags = (c.buddy_tags && c.buddy_tags.length
        ? c.buddy_tags
        : c.buddy_tag
        ? [{ label: c.buddy_tag, color: c.buddy_tag_color }]
        : []
      )
        .map((t) => (t.label || '') + '|' + (t.color || ''))
        .join(',')

      const q =
        'conversation_id=' + encodeURIComponent(c.conversation_id) +
        // ★ 传显示名（备注优先），聊天页标题才是用户认得的称呼
        '&name=' + encodeURIComponent(this.displayName(c) || '') +
        '&avatar=' + encodeURIComponent(c.avatar || '') +
        '&school=' + encodeURIComponent(c.school || '') +
        '&tag=' + encodeURIComponent(c.buddy_tag || '') +
        '&color=' + encodeURIComponent(c.buddy_tag_color || '') +
        '&tags=' + encodeURIComponent(allTags) +
        // 聊天页要用它做"点头像进主页"
        '&peer_id=' + encodeURIComponent(c.other_user_id || '')
      uni.navigateTo({ url: '/pages/chat/chat?' + q })
    },

    /**
     * 长按会话 → ActionSheet。
     * ★ 菜单项顺序不固定（搭子会话没有「取消置顶」），所以不能用 tapIndex 直接
     *   对常量数组取项，必须现算一份 actions，再把 tapIndex 映射回它。
     * ★ 文案里用 c.muted / c.pin_locked 而不是本地猜测：这两个值由
     *   message-conversations 下发，服务端才是唯一真相。
     */
    openConvoMenu(c) {
      if (!c || !c.conversation_id) return
      const actions = []
      // 有搭子关系（pin_locked）的会话强制置顶，契约 5.2 要求不出现「取消置顶」
      if (c.pin_locked) {
        // 什么都不放：不能取消置顶
      } else if (c.pinned) {
        actions.push({ key: 'unpin', label: '取消置顶' })
      } else {
        actions.push({ key: 'pin', label: '置顶' })
      }
      actions.push(c.muted ? { key: 'unmute', label: '取消免打扰' } : { key: 'mute', label: '消息免打扰' })
      actions.push({ key: 'clear', label: '清空聊天记录' })

      uni.showActionSheet({
        itemList: actions.map((a) => a.label),
        success: (res) => {
          const a = actions[res.tapIndex]
          if (!a) return
          if (a.key === 'clear') {
            this.confirmClear(c)
            return
          }
          this.applyConvoSetting(c, a.key)
        }
      })
    },

    /** 置顶/免打扰：conversation-setting，四个 action 共用一条通路 */
    async applyConvoSetting(c, action) {
      const token = uni.getStorageSync('token')
      if (!token) return
      try {
        const res = await uniCloud.callFunction({
          name: 'conversation-setting',
          data: { token: token, conversation_id: c.conversation_id, action: action }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '操作失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        // 服务端说了算：unpin 遇到搭子关系时仍返回 pinned:true、pin_locked:true
        if (typeof d.pinned === 'boolean') c.pinned = d.pinned
        if (typeof d.muted === 'boolean') c.muted = d.muted
        if (typeof d.pin_locked === 'boolean') c.pin_locked = d.pin_locked
        // 置顶变了要重排 —— 但排序权在服务端，所以整页重拉，不在前端 sort
        await this.loadList()
        uni.showToast({ title: '已设置', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: '网络不太好', icon: 'none' })
      }
    },

    confirmClear(c) {
      uni.showModal({
        title: '清空聊天记录？',
        content: '只清掉你这一侧的聊天记录，对方还能看到。清空后这段会话会从消息页消失。',
        confirmText: '清空',
        confirmColor: '#F04438',
        cancelText: '再想想',
        success: (res) => {
          if (res.confirm) this.doClear(c)
        }
      })
    },

    /** 清空聊天记录 = message-clear（只清我这一侧的 cleared_at，不删任何消息） */
    async doClear(c) {
      const token = uni.getStorageSync('token')
      if (!token) return
      try {
        const res = await uniCloud.callFunction({
          name: 'message-clear',
          data: { token: token, conversation_id: c.conversation_id }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '删除失败', icon: 'none' })
          return
        }
        this.conversations = this.conversations.filter((x) => x.conversation_id !== c.conversation_id)
        uni.showToast({ title: '已删除', icon: 'none' })
        await this.loadList()
      } catch (e) {
        uni.showToast({ title: '网络不太好', icon: 'none' })
      }
    },

    goAi() {
      // 埋点：顶部 AI 入口行和空态「开始聊聊」都走这里，entry 固定 messages
      track('ai_entry_click', { entry: 'messages' })
      uni.navigateTo({ url: '/pages/chat/chat?conversation_id=ai' })
    },

    goHall() {
      uni.navigateTo({ url: '/pages/hall/hall' })
    },

    goBuddy() {
      uni.navigateTo({ url: '/pages/buddy/buddy' })
    }
  }
}
</script>

<style scoped>
/* ---------- 收到的搭子邀请 ---------- */
/* 邀请块：淡暖底 + 柔和描边（原来用主色做整圈边框，黄得刺眼） */
.invite-block {
  background: linear-gradient(135deg, #FFFCF2 0%, #FFF4E2 100%);
  border-radius: 28rpx;
  padding: 26rpx 24rpx 22rpx;
  margin-bottom: 22rpx;
  border: 2rpx solid rgba(249, 208, 56, 0.38);
}
.invite-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}
.invite-title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.invite-count {
  font-size: 22rpx;
  color: var(--tf-primary);
}
.invite-card {
  padding: 18rpx 0;
  border-top: 2rpx solid var(--tf-line-soft);
}
.invite-top {
  display: flex;
  align-items: center;
}
.invite-main {
  margin-left: 18rpx;
  flex: 1;
  min-width: 0;
}
.invite-name {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.invite-say {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-2);
  margin-top: 6rpx;
}
.invite-tag {
  font-size: 22rpx;
  font-weight: 700;
  color: var(--tf-text);
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}
.invite-msg {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-2);
  line-height: 1.5;
  margin-top: 12rpx;
}
.invite-btns {
  display: flex;
  justify-content: flex-end;
  margin-top: 16rpx;
}
.invite-btns .btn {
  margin-left: 16rpx;
  margin-bottom: 0;
  width: auto;
  padding: 0 36rpx;
}
/* 接受：绿→蓝渐变，和全站的实色按钮一致 */
.invite-btns .btn:not(.btn--plain) {
  border: none;
  background: linear-gradient(135deg, #8FB86A 0%, #3B7ADB 100%);
  color: #FFFFFF;
  box-shadow: 0 6rpx 16rpx rgba(59, 122, 219, 0.24);
}
.btn--plain {
  background-color: var(--tf-bg);
  color: var(--tf-text-2);
}

.page {
  min-height: 100vh;
  background: transparent;
}
/* 自绘头部：状态栏 + 大标题 */
.msg-head {
  padding: calc(var(--status-bar-height) + 20rpx) 32rpx 10rpx;
}
.msg-title {
  font-size: 52rpx;
  font-weight: 800;
  color: var(--tf-text);
  letter-spacing: -0.01em;
}
.screen-body {
  /* 顶部不再需要让状态栏，头部已经占了；底部给 tabBar 留白 */
  padding: 12rpx 24rpx 200rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.hint {
  text-align: center;
  color: var(--tf-text-2);
  font-size: 24rpx;
  padding: 60rpx 0;
}

/* —— AI 入口：黄底 + 硬阴影 —— */
/* 消息页空态（文档 §4.2 / §10.2）：
   没有人聊 → 但随时有人在。空态直接衔接 AI 入口，不留大片空白。 */
.empty-chat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 32rpx 32rpx;
}
.empty-ico {
  font-size: 64rpx;
  line-height: 1;
  opacity: 0.35;
}
.empty-title {
  margin-top: 24rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.empty-sub {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: var(--tf-text-3);
  text-align: center;
}
.empty-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 32rpx;
}
.empty-btn {
  height: 72rpx;
  padding: 0 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--tf-r-btn);
  font-size: 26rpx;
  font-weight: 700;
}
.empty-btn--ghost {
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line);
  color: var(--tf-text-2);
}
.empty-btn--main {
  background: var(--tf-primary);
  color: #fff;
}

/* ==========================================================================
   AI 情绪引导入口（文档 §4.2）
   --------------------------------------------------------------------------
   降级前是整张高饱和黄底大横幅，是页面视觉最响的元素，真人会话被压成灰小条。
   现在改成「一行会话」：
     · 高度 120rpx，与真人会话行一致
     · 底色 $c-ai-soft（#fff8d9）低饱和
     · 身份靠左侧 6rpx 的 $c-ai 色条 + AI 头像，不靠大面积黄
   ========================================================================== */
.ai-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20rpx;
  height: 120rpx;
  padding: 0 24rpx 0 30rpx;
  border: 2rpx solid var(--tf-line);
  border-radius: var(--tf-r-md);
  background: var(--tf-ai-soft);
  overflow: hidden;
}

/* 左侧 6rpx 色条：AI 身份标识，比整块黄底克制得多 */
.ai-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6rpx;
  background: var(--tf-ai);
}

/* —— 会话卡片 —— */
.convo {
  display: flex;
  align-items: center;
  gap: 20rpx;
  border: 2rpx solid var(--tf-card-line);
  border-radius: 28rpx;
  background: var(--tf-card);
  box-shadow: 0 8rpx 22rpx rgba(120, 90, 50, 0.08);
  padding: 24rpx 22rpx;
  margin-bottom: 16rpx;
}
.avatar {
  width: 88rpx;
  height: 88rpx;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 50%;
  background: var(--tf-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 32rpx;
  flex: none;
}
/* 有头像渲染图片（message-conversations 已把 cloud:// 换成临时 https）；没有可用链接就留空圆占位，不用默认头像图、不用昵称首字 */
.avatar--img {
  display: block;
  overflow: hidden;
  background: var(--tf-card-line);
  border-radius: 50%;
}
.avatar--ai {
  background: var(--tf-ai);
  color: #6b5200;
  font-size: 22rpx;
  font-weight: 800;
  flex: none;
}
.convo-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.convo-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12rpx;
}
/* 置顶/搭子会话：左侧一条竖杠，一眼看出它被钉在最上面 */
.convo--top {
  border-left-width: 10rpx;
  border-left-color: var(--tf-primary);
}
/* 名字行：搭子徽标 + 名字 + 免打扰图标，允许换行不撑破卡片 */
.convo-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8rpx;
  flex: 1;
  min-width: 0;
}
.convo-name {
  font-weight: 800;
  font-size: 30rpx;
}
.mute-icon {
  flex: none;
  font-size: 22rpx;
  line-height: 1;
}

.mono {
  font-size: 20rpx;
  color: var(--tf-text-2);
  flex: none;
}
.muted {
  color: var(--tf-text-2);
}
.convo-last {
  font-size: 24rpx;
  color: var(--tf-text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.convo-meta {
  display: flex;
  align-items: center;
  /* 允许换行：搭子标签 + 好友徽标 + 学校可能同时出现，
     一行放不下时往下排，绝不横向溢出把卡片撑破 */
  flex-wrap: wrap;
  gap: 10rpx;
  padding-top: 6rpx;
}
/* 搭子标签：纯色底（内联 backgroundColor）+ 白光渐变，和 buddy.vue 一致。
   注意用 background-color 而不是 background —— 后者是简写，会把 background-image 重置掉。 */
.shiny-tag {
  border: none;
  border-radius: 999rpx;
  background-color: var(--tf-card-strong);
  background-image: linear-gradient(
    120deg,
    rgba(255, 255, 255, 0.58) 0%,
    rgba(255, 255, 255, 0) 46%,
    rgba(255, 255, 255, 0.30) 100%
  );
  padding: 4rpx 14rpx;
  font-size: 20rpx;
  font-weight: 700;
}
/* 好友徽标：比搭子标签更安静——不描黑边、不抢眼，
   只用成功色描边做圆角胶囊，小字号，读起来是"状态"而不是"内容"。 */
.friend-badge {
  flex: none;
  border: 2rpx solid var(--tf-success);
  border-radius: 999rpx;
  background: var(--tf-card);
  color: var(--tf-success);
  padding: 1rpx 12rpx;
  font-size: 18rpx;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
}
.tag {
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
  background: var(--tf-card-strong);
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: var(--tf-text-2);
}

/* —— 未读红点 —— */
.unread {
  min-width: 40rpx;
  height: 40rpx;
  background: var(--tf-primary);
  color: #fff;
  border: 2rpx solid rgba(255, 255, 255, 0.35);
  border-radius: 999rpx;
  font-size: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  padding: 0 6rpx;
}

.badge {
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
  background: var(--tf-card-strong);
  padding: 2rpx 8rpx;
  font-size: 18rpx;
  flex: none;
}

/* —— 空状态 —— */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14rpx;
  padding: 60rpx 0;
}
.empty-title {
  font-weight: 800;
  font-size: 30rpx;
}
.empty-desc {
  font-size: 24rpx;
  color: var(--tf-text-2);
  text-align: center;
}

.btn {
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
  background: var(--tf-card-strong);
  box-shadow: var(--tf-lift-sm);
  padding: 0 24rpx;
  height: 68rpx;
  line-height: 62rpx;
  font-size: 26rpx;
  font-weight: 700;
}
.btn--block {
  width: 100%;
  margin-top: 10rpx;
}

/* ===== 接受邀请弹层 ===== */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 200;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  border-top: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-xl) var(--tf-r-xl) 0 0;
  padding: 32rpx 28rpx 44rpx;
  max-height: 86vh;
  overflow-y: auto;
}
.sheet-title {
  display: block;
  font-size: 34rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.sheet-sub {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  color: var(--tf-text-2);
  line-height: 1.5;
}
.sheet-label {
  display: block;
  margin-top: 26rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: var(--tf-text-2);
}
.sheet-hint {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--tf-text-2);
}
.input-row {
  display: flex;
  align-items: center;
  margin-top: 12rpx;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-sm);
  background: rgba(255, 255, 255, 0.96);
  padding: 0 20rpx;
  height: 84rpx;
}
.input {
  flex: 1;
  font-size: 28rpx;
  color: var(--tf-text);
}
.input-suffix {
  flex: none;
  font-size: 28rpx;
  font-weight: 800;
  color: var(--tf-primary);
  margin-left: 8rpx;
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 14rpx;
}
.swatch {
  width: 64rpx;
  height: 64rpx;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 32rpx;
  box-shadow: var(--tf-lift-sm);
}
.swatch--on {
  border-width: 5rpx;
  transform: scale(1.12);
}
.sheet-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 34rpx;
}
.btn--plain {
  background: var(--tf-bg);
  color: var(--tf-text-2);
  border-width: 2rpx;
}
.btn--primary {
  background: var(--tf-primary);
  border-color: rgba(255, 255, 255, 0.22);
  color: #fff;
}

/* ==========================================================================
   头像淡入
   --------------------------------------------------------------------------
   图片本身已经在本地（common/avatar/avatarCache.js），不存在边下边画的过程；
   这里只负责「空圆 → 完整头像」这 160ms 过渡。用 opacity 不用 v-if：
   节点一直存在，不会引起列表行高抖动。
   ========================================================================== */
.ava-fade {
  opacity: 0;
  transition: opacity 160ms ease-out;
}

.ava-fade--in {
  opacity: 1;
}
</style>