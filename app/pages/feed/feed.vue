<template>
  <view class="page feed-page">
    <!-- 三栏切换（同校 / 地区 / 发现）：scope 直接映射 post-list 的三个筛选口径 -->
    <view class="seg">
      <view
        class="seg-item"
        :class="{ 'seg-item--on': tab === s.key }"
        v-for="s in SCOPES"
        :key="s.key"
        @tap="switchTab(s.key)"
      >
        <text class="seg-text">{{ s.label }}</text>
        <!-- 同校只对已认证用户开放：未认证时给个锁定提示，别让人以为点了没反应 -->
        <text class="seg-lock" v-if="s.key === 'school' && !verified">🔒</text>
      </view>
    </view>

    <!-- 筛选降级说明：只有真降级了才出现（比如没填城市） -->
    <view class="degrade" v-if="noticeText">
      <text class="degrade-text">{{ noticeText }}</text>
    </view>

    <!-- 同校频道锁屏态：未认证点「同校」、或云函数回 degraded === 'need_verify'，都走这一块 -->
    <view class="lock" v-if="lockSchool">
      <text class="lock-ico">🔒</text>
      <text class="lock-title">完成学生认证后才能进入同校频道</text>
      <view class="lock-btn" @tap="goVerify">
        <text class="lock-btn-text">去认证</text>
      </view>
    </view>

    <!-- 首屏加载 -->
    <view class="skeleton" v-if="loading && list.length === 0">
      <text class="skeleton-text">正在加载…</text>
    </view>

    <!-- ===== 卡片流（Instagram 式）=====
         ------------------------------------------------------------------
         竖向一条一条看；只有「多图」那条能在卡片内部横滑。
         两个方向的滑动互不干扰：横滑容器滑到边界不带动竖向滚动。
         数据里没图时用类型渐变 + 标题做封面，保证不会出现空白块。
         ================================================================== -->
    <view class="list">
      <view class="post" v-for="c in list" :key="c._id" @tap="openDetail(c)">

        <!-- 头：头像 + 昵称 + 学院时间 -->
        <view class="p-head">
          <!-- 作者头像：走 common/avatar/avatarCache.js，本地落盘 + 解码完成后整体淡入。
               淡入 key 用本条卡自己的 _id —— 同屏十几张，一张就绪不能带动全屏一起亮。
               没有可用链接就不挂 <image>，露出 .p-ava 自己的圆底 = 空圆占位；
               v-else 的空圆与图片同尺寸，空间不塌，昵称不会左移。 -->
          <image
            v-if="avaSrcOf(c._id)"
            class="p-ava p-ava-img ava-fade"
            :class="{ 'ava-fade--in': avaReadyOf(c._id) }"
            :src="avaSrcOf(c._id)"
            mode="aspectFill"
            lazy-load="true"
            @load="avaOnLoad(c._id)"
            @error="avaOnError(c._id, c.owner && c.owner.avatar_url)"
          />
          <view v-else class="p-ava" />
          <view class="p-who">
            <view class="p-name-row">
              <text class="p-name">{{ c.owner.nickname }}</text>
              <text class="p-verified" v-if="c.owner.is_verified">已认证</text>
              <text class="p-mine" v-if="c.is_mine">我发的</text>
            </view>
            <text class="p-meta">{{ c.owner.school || '同校' }} · {{ ago(c.created_at) }}</text>
          </view>
          <text class="p-type">{{ mediaLabel(c) }}</text>
        </view>

        <!-- 图片区：有图轮播 / 无图渐变封面 -->
        <view class="p-media" @tap.stop="previewPost(c)">
          <scroll-view
            v-if="imgsOf(c).length > 1"
            class="media-rail"
            scroll-x
            :show-scrollbar="false"
            @scroll="onMediaScroll($event, c)"
          >
            <image
              v-for="(img, ii) in imgsOf(c)"
              :key="ii"
              class="media-item"
              :src="img"
              mode="aspectFill" lazy-load="true"
            />
          </scroll-view>

          <image
            v-else-if="imgsOf(c).length === 1"
            class="media-item"
            :src="imgsOf(c)[0]"
            mode="aspectFill" lazy-load="true"
          />

          <view v-else class="media-ph ph--text">
            <text class="ph-title">{{ brief(c.content) }}</text>
          </view>

          <!-- 张数指示：只有多图才显示 -->
          <view class="media-count" v-if="imgsOf(c).length > 1">
            {{ (mediaIdx[c._id] || 0) + 1 }}/{{ imgsOf(c).length }}
          </view>
        </view>

        <!-- 操作栏：同频圈是发日常/动态的地方，不放「同频一下」——
             那是首页找搭子的动作，放这儿会让用户以为点一下就能约人。 -->
        <view class="p-actions">
          <view class="act" @tap.stop="onLike(c)">
            <view class="act-heart" :class="{ 'act-heart--on': c.liked }" />
            <text class="act-n">{{ c.like_count || 0 }}</text>
          </view>
          <view class="act" @tap.stop="openDetail(c)">
            <text class="act-ic">💬</text>
            <text class="act-n">{{ c.comment_count || 0 }}</text>
          </view>
          <view class="act act--save" @tap.stop="openShare(c)">
            <text class="act-ic">↗</text>
            <text class="act-n">分享</text>
          </view>
        </view>

        <!-- 文案 -->
        <view class="p-body">
          <text class="p-likes" v-if="c.like_count > 0">{{ c.like_count }} 人喜欢</text>
          <text class="p-desc">
            <text class="p-desc-name">{{ c.owner.nickname }}</text>{{ c.content }}
          </text>
        </view>

      </view>
    </view>

    <!-- 空态 -->
    <view class="empty" v-if="loaded && !loading && list.length === 0 && !lockSchool">
      <text class="empty-ico">📰</text>
      <text class="empty-title">{{ emptyTitle }}</text>
      <text class="empty-desc">{{ emptyDesc }}</text>
      <button class="empty-btn" v-if="reason === 'error'" @tap="refresh">重新加载</button>
      <button class="empty-btn" v-else @tap="goPublish">发一条试试</button>
    </view>

    <!-- 加载更多 -->
    <view class="more" v-if="list.length > 0">
      <text class="more-text" v-if="loading">加载中…</text>
      <text class="more-text" v-else-if="hasMore" @tap="loadMore">上拉或点这里加载更多</text>
      <text class="more-text more-text--end" v-else>— 到底了 —</text>
    </view>
  </view>

  <!-- 发布按钮：同频圈没有发布入口，压在自定义 tabBar 之上（z-index 低于 tabBar，不盖导航） -->
  <view class="fab" @tap="goPublish">
    <text class="fab-plus">+</text>
  </view>

  <!-- 自定义 tabBar（pages.json 已开 custom: true） -->
  <custom-tab-bar />

  <!-- ===== 分享面板（抖音式底部滑出）=====
       mask / sheet 跟 .fab 一样挂在页面级（不是 .page 里面），
       塞进 .page 会被它的 padding 和滚动容器裁掉。
       z-index 1000/1001 压过自定义 tabBar(999) 与 .fab(998)。
       on = 是否在 DOM 里；show = 滑入滑出。两者分两帧切才有过渡。 -->
  <view class="sh-mask" :class="{ 'sh-mask--in': share.show }" v-if="share.on" @tap="closeShare"></view>
  <view class="sh-sheet" :class="{ 'sh-sheet--in': share.show }" v-if="share.on">
    <view class="sh-head">
      <text class="sh-title">分享给</text>
      <text class="sh-close" @tap="closeShare">✕</text>
    </view>

    <!-- 好友横滑：没登录 / 没好友 / 没拉出来都给空态，下面四个圆圈照旧能用 -->
    <scroll-view class="sh-friends" scroll-x :show-scrollbar="false" v-if="share.people.length > 0">
      <view class="sh-friend" v-for="f in share.people" :key="f.user_id" @tap="shareTo(f)">
        <image v-if="avaSrcOf('f' + f.user_id)" class="sh-ava sh-ava-img ava-fade" :class="{ 'ava-fade--in': avaReadyOf('f' + f.user_id) }" :src="avaSrcOf('f' + f.user_id)" mode="aspectFill" @load="avaOnLoad('f' + f.user_id)" @error="avaOnError('f' + f.user_id, f.avatar_url)" />
        <view v-else class="sh-ava sh-ava-img" />
        <!-- 搭子才有的迷你角标：好友与搭子混在一排里，没有它分不清谁是谁 -->
        <text v-if="f.kind === 'buddy'" class="sh-badge">搭子</text>
        <text class="sh-fname">{{ friendName(f) }}</text>
      </view>
    </scroll-view>
    <view class="sh-fempty" v-else>
      <text class="sh-fempty-text">{{ shareFriendTip }}</text>
    </view>

    <view class="sh-line"></view>

    <!-- 一排圆圈：抖音那排是六个，我们只做真有能力的这四个 -->
    <view class="sh-acts">
      <view class="sh-act" @tap="shareCopy">
        <view class="sh-ico">📋</view>
        <text class="sh-act-n">复制文案</text>
      </view>
      <view class="sh-act" @tap="shareFav">
        <view class="sh-ico" :class="{ 'sh-ico--on': share.favOn }">⭐</view>
        <text class="sh-act-n">收藏</text>
      </view>
      <view class="sh-act" @tap="shareDM">
        <view class="sh-ico">✉️</view>
        <text class="sh-act-n">私信</text>
      </view>
      <view class="sh-act" @tap="shareLike">
        <view class="sh-ico" :class="{ 'sh-ico--on': shareLiked }">♥</view>
        <text class="sh-act-n">点赞</text>
      </view>
    </view>

    <view class="sh-cancel" @tap="closeShare">
      <text class="sh-cancel-text">取消</text>
    </view>
  </view>
</template>

<script>
import customTabBar from '@/custom-tab-bar/index.vue'
import track from '@/utils/track.js'
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

const SCOPES = [
  { key: 'school', label: '同校', scope: 'school' },
  { key: 'area', label: '地区', scope: 'city' },
  { key: 'all', label: '发现', scope: 'all' }
]
const PAGE_SIZE = 10
const VERIFY_PAGE = '/pages/verify/verify'

// 认证态口径与云函数一致：schoolVerified 或 is_verified，两者取或。
// 不用可选链 / 空值合并 —— 项目里有低版本端。
function readVerified() {
  const u = uni.getStorageSync('userInfo') || {}
  return u.schoolVerified === true || u.is_verified === true
}

// 认证态探针节流键：60s 内不重复打 user-me，避免每次 onShow 都发一次云函数
const VERIFY_PROBE_KEY = 'feed_verify_probe_v1'
const VERIFY_PROBE_TTL = 60 * 1000

function readProbeAt() {
  const n = Number(uni.getStorageSync(VERIFY_PROBE_KEY))
  return n > 0 ? n : 0
}

export default {
  components: { customTabBar },
  mixins: [avatarFadeMixin],
  data() {
    return {
      SCOPES,
      // 默认落在「发现」：demo/线上数据不一定和当前账号同校，
      // 一进来就有内容才不会被当成「坏了」；点「同校」才按学校筛
      tab: 'all',
      list: [],
      page: 1,
      hasMore: false,
      loading: false,
      loaded: false,
      reason: '',
      hint: '',
      degrade: '',
      // 学生认证态（storage userInfo 的 schoolVerified / is_verified，两者取或）。
      // 同校频道只对已认证开放：未认证不发请求，直接渲染锁屏态。
      verified: readVerified(),
      lockSchool: false,
      // ---- 切 tab 的调度状态（与 index/messages/mine 三页同一套写法）----
      // 原生 tabBar 只藏一次：hideTabBar 会让原生层重走一遍 tabBar 的布局与重绘，
      // 藏好之后再调对画面没有任何改变，纯粹是给切 tab 那一帧多压一次原生工作量。
      nativeTabHidden: false,
      // 切 tab 后的请求调度定时器（$nextTick + setTimeout，见 scheduleTabLoad）
      tabLoadTimer: null,
      // 真机验收计数：进过几次本页 / 被去重挡掉几次
      tabShowCount: 0,
      tabDedupCount: 0,
      // 脏标记：这一次请求还在飞（this.loading）时又被 onShow 催过，收尾补一发
      feedPending: false,
      // 请求序号：切 tab / refresh 会让在飞那次响应作废（旧频道的数据不能写进新频道）
      loadSeq: 0,
      // 切 tab / refresh 撞上在飞请求时记的这一笔：收尾后必须重放，否则就是永久转圈
      pendingLoad: false,
      // 多图横滑当前停在第几张，key 是动态 id
      mediaIdx: {},
      // 分享面板：on = 挂在 DOM 上，show = 已滑入（分两帧切才有过渡）
      // loaded = 本次会话已经拉过好友列表（懒加载缓存），别每次开面板都打一次云函数
      share: {
        on: false,
        show: false,
        card: null,
        // 好友 + 搭子合并成一列（搭子在前），每项带 kind: 'buddy' | 'friend'
        people: [],
        loaded: false,
        loading: false,
        needLogin: false,
        error: '',
        sending: false,
        favOn: false
      }
    }
  },
  onShow() {
    // 真机验收用：进过几次本页（配合 tabDedupCount 判断有没有重复发请求）
    this.tabShowCount++
    // 每次显示都重读认证态：先同步读 storage（首帧就要对，不能等网络），
    // 再异步跟 user-me 对一次 —— 认证通过后没有任何地方回写 storage userInfo，
    // 只读 storage 的话必须杀进程重登才解锁（见 refreshVerified）。
    this.verified = readVerified()
    // 探针绝不能把 onShow 拖下水：它一抛，下面的 scheduleTabLoad 就不跑了 → 整页空白
    try { this.refreshVerified() } catch (e) {}
    // ★ App 端 uni-app 不认 pages.json 的 tabBar.custom（那是微信小程序专属），
    //   原生 tabBar 照样渲染 → 会和自定义悬浮条叠成两条，所以每个 tab 页显示时要主动藏掉原生那条。
    //   但只藏一次：hideTabBar 会让原生层重新走一遍 tabBar 的布局与重绘，
    //   藏好之后再调对画面没有任何改变，纯粹是给切 tab 那一帧多压一次原生工作量。
    if (!this.nativeTabHidden) {
      try { uni.hideTabBar({ animation: false }) } catch (e) {}
      this.nativeTabHidden = true
    }
    // ★ 网络请求移出同步路径（判据见 scheduleTabLoad）。原来这里直接 refresh()/load()，
    //   云函数调用的初始化会和「页面首次渲染」挤在同一帧里 ——
    //   点 tab 时看到的那一下卡顿，就是这一帧被拉长的。
    //   首屏仍然由这里触发：本页没有 onLoad/mounted，onShow 是唯一可靠的入口。
    this.scheduleTabLoad()
    // ★ 通知自定义 tabBar 重读栈顶 route（switchTab 后 tab 页被缓存，组件不重新 mounted）。
    //   这条留在同步路径：它只是往已有组件派一个事件，跟网络无关，延后反而让滑块慢一拍。
    try { uni.$emit('tfTabShow') } catch (e) {}
  },
  onReachBottom() {
    this.loadMore()
  },
  computed: {

    // post-list 的降级口径：只有 degraded（'' 表示没降级）。
    // 动态不做「未认证就拦」，所以没有 card-list 那种 reason/hint 提前返回的分支。
    noticeText() {
      if (this.hint) return this.hint
      const m = {
        no_school: '还没填学校，这里显示的是全部动态',
        no_city: '还没填城市，这里显示的是全部内容',
        nearby_as_school: '没有城市信息，这里按同校近似',
        no_location: '学校、城市都没填，这里显示的是全部内容'
      }
      return m[this.degrade] || ''
    },
    emptyTitle() {
      if (this.reason === 'error') return '没能加载出来'
      if (this.reason === 'no_school') return '完成学生认证后就能看同校'
      const m = {
        school: '同校的同学还没发内容',
        area: '这个地区还没有内容',
        all: '还没有人发内容'
      }
      return m[this.tab] || '这里还是空的'
    },
    emptyDesc() {
      if (this.reason === 'error') return '看一眼网络，或者点下面重新加载'
      if (this.reason === 'no_school') return '同校频道按学校筛，认证通过后才会显示本校的内容'
      // 文档 §7 / §10.1：不把冷启动责任推给用户。
      // 原本文案是「等你的学校有人发第一条」——听起来像在怪用户不发。
      // 改成给出路：告诉他去哪儿能看到内容。
      const m = {
        school: '你的学校暂时还没有动态，先去「发现」看看别的学校',
        area: '你附近暂时还没有动态，换个范围看看',
        all: '还没有人发动态，发一条让全校看到你'
      }
      return m[this.tab] || ''
    },
    /* 好友行的空态文案：没登录 → 提示登录；拉过但是空的 → 提示加好友 */
    shareFriendTip() {
      const s = this.share
      if (s.needLogin) return '登录后才能分享给好友和搭子'
      if (s.loading) return '正在加载…'
      if (s.error) return s.error
      return '还没有好友或搭子，先去加几个'
    },
    /* 面板里的点赞圆点跟着卡片上的红心走，不再另存一份状态 */
    shareLiked() {
      const c = this.share.card
      return !!(c && c.liked)
    }
  },
  /* 头像绑定。deep 是必须的：list 会整批替换，owner.avatar_url 也可能后到；
     immediate 是为了首帧就挂上已经落盘的本地图（命中缓存时连网络都不用碰）。 */
  watch: {
    list: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (c) => c && c._id,
          (c) => c && c.owner && c.owner.avatar_url
        )
      }
    }
  },
  methods: {
    /* tab 显示后的请求调度：首帧与网络解耦（与 index/messages/mine 三页同一套写法）。
       ------------------------------------------------------------------
       为什么不在 onShow 里直接发：onShow 和「页面首次渲染」在同一个同步任务里，
       云函数调用的初始化（uniCloud 桥 + 请求对象 + storage 读）会挤进首帧那一帧，
       切 tab 时的那一下停顿就是这一帧被拉长的。
       默认做法：让出当前帧 —— $nextTick 保证首帧已提交，再 setTimeout(30) 给渲染
       管线留一帧余量，之后才发请求。
       例外（立刻发）：本地一条数据都没有时，延后只是让用户多看 30ms 的空白，收益是负的。
       本页判据：list 里已有卡 → 30ms；空列表（首次进入）→ 0ms。
       0ms 不等于「同步发」：它照样是一个宏任务，首帧会先提交 —— 这正是
       「首次进入应用后切 tab 卡」要解决的那一帧。
       去重不在这里做：load 自身的在飞标记 + feedPending 收尾补一次。 */
    scheduleTabLoad() {
      const run = () => {
        // 上一次请求还在飞：只记一笔 pending，不排第二批（见 replayLoad）
        if (this.loading) {
          this.feedPending = true
          this.tabDedupCount++
          return
        }
        if (this.loaded) this.refresh()
        else this.load()
      }
      const hasData = this.list && this.list.length > 0
      const delay = hasData ? 30 : 0
      // 连点 tab 会有多次调度：只保留最后一个，避免几批请求排队发出
      if (this.tabLoadTimer) clearTimeout(this.tabLoadTimer)
      this.$nextTick(() => {
        if (this.tabLoadTimer) clearTimeout(this.tabLoadTimer)
        this.tabLoadTimer = setTimeout(() => {
          this.tabLoadTimer = null
          run()
        }, delay)
      })
    },
    /* 认证态刷新：把 user-me 的认证结果写回 storage userInfo，并重设 this.verified。
       ------------------------------------------------------------------
       别处没有任何代码回写 storage 的 userInfo（认证页只改云端），所以只读 storage
       的话，认证通过后必须杀进程重登才会解锁「同校」—— 那就是这个 bug。
       60s 节流：onShow 每次切 tab 都会走一遍，不能每次都打一次云函数。 */
    refreshVerified() {
      const token = uni.getStorageSync('token') || ''
      if (!token) return Promise.resolve()
      const now = Date.now()
      if (now - readProbeAt() < VERIFY_PROBE_TTL) return Promise.resolve()
      // 先记时间戳再发：云函数偶发失败也按 60s 退避，不会因为 onShow 抖动打漫天请求
      try { uni.setStorageSync(VERIFY_PROBE_KEY, now) } catch (e) {}
      const wasVerified = this.verified
      return uniCloud
        .callFunction({ name: 'user-me', data: { token } })
        .then((res) => {
          const r = (res && res.result) || {}
          if (r.code !== 0) return
          const u = (r.data && r.data.user) || null
          if (!u) return
          let old = uni.getStorageSync('userInfo')
          if (typeof old === 'string') {
            try { old = JSON.parse(old) } catch (e) { old = null }
          }
          if (!old || typeof old !== 'object') old = {}
          // 合并而不是覆盖：userInfo 里还有登录态的其它字段
          old.schoolVerified = u.schoolVerified === true
          old.is_verified = u.is_verified === true
          old.school_id = u.school_id || ''
          // school 只在服务端真的有值时才写：user-me 的 school 直接取自记录，
          // 记录里没有这个键时 u.school 是 undefined，照抄会把用户原本的校名抹成空串。
          if (typeof u.school === 'string' && u.school) old.school = u.school
          try { uni.setStorageSync('userInfo', old) } catch (e) {}
          const v = old.schoolVerified || old.is_verified
          this.verified = v
          // 由「未认证」变「已认证」且正卡在锁屏态 → 解锁，并按当前频道重新拉一次
          if (v && !wasVerified && this.lockSchool) {
            this.lockSchool = false
            this.list = []
            this.page = 1
            this.hasMore = false
            this.loaded = false
            this.reason = ''
            this.hint = ''
            this.degrade = ''
            this.requestLoad()
          }
        })
        .catch((e) => {
          console.warn('[feed] user-me 刷新认证态失败', e && e.message)
        })
    },
    /* 发一次请求；撞上在飞请求时**不丢弃**，记一笔 pending 交给收尾重放。
       ------------------------------------------------------------------
       这里原来就是 load() 开头那句 `if (this.loading) return`。switchTab 已经把
       list 清空、loaded 置 false，这一枪被吞掉且无人重放 → 页面永远停在「加载中…」。
       顺带把序号 +1：在飞那次的响应属于上一个频道，回来不能再往新频道里写。 */
    requestLoad() {
      if (this.loading) {
        this.loadSeq++
        this.pendingLoad = true
        return
      }
      this.load()
    },
    /* 在飞那次收尾后补发一次：切 tab 的速度快过网络时，进来那次的请求不能被丢掉。
       只补一次（pending 是布尔量），不会滚成连续请求。 */
    replayLoad() {
      setTimeout(() => {
        if (this.loading) {
          this.pendingLoad = true
          return
        }
        if (this.loaded) this.refresh()
        else this.load()
      }, 0)
    },
    scopeOf(key) {
      const hit = SCOPES.filter(function (s) { return s.key === key })[0]
      return hit ? hit.scope : 'school'
    },
    switchTab(k) {
      // 同校频道门槛：未认证点了也不打接口，直接进锁屏态
      if (k === 'school' && !this.verified) {
        if (this.tab === 'school' && this.lockSchool) return
        this.tab = 'school'
        this.list = []
        this.page = 1
        this.hasMore = false
        this.loaded = false
        this.reason = ''
        this.hint = ''
        this.degrade = ''
        this.lockSchool = true
        // 锁屏态不需要在飞那次的响应，也不需要在收尾时重放
        this.loadSeq++
        this.pendingLoad = false
        this.feedPending = false
        return
      }
      if (this.tab === k && this.loaded) return
      this.tab = k
      this.list = []
      this.page = 1
      this.hasMore = false
      this.loaded = false
      this.reason = ''
      this.hint = ''
      this.degrade = ''
      // 不直接 load()：撞上在飞请求时 requestLoad 会记 pending 交给收尾重放
      this.requestLoad()
    },
    /* 锁屏态的「去认证」：认证页在 pages.json 里已注册 */
    goVerify() {
      // 从认证页回来一定会走 onShow；先把节流键清掉，
      // 保证那一次真的去问 user-me（否则 60s 内刚探过一次就又被跳过，还是锁着）
      try { uni.removeStorageSync(VERIFY_PROBE_KEY) } catch (e) {}
      uni.navigateTo({ url: VERIFY_PAGE })
    },
    refresh() {
      this.page = 1
      this.requestLoad()
    },
    loadMore() {
      if (this.loading || !this.hasMore) return
      this.page += 1
      this.load()
    },
    async load() {
      // 在飞时只记一笔 pending 就返回：调用方通常在 requestLoad 里已经记过，
      // 这里给直接调用方兜底 —— 无论如何都不能让请求被静默吞掉。
      if (this.loading) {
        this.pendingLoad = true
        return
      }
      // 同校频道门槛：未认证一条请求都不发（已认证走下面原逻辑，不动）
      if (this.tab === 'school' && !this.verified) {
        this.lockSchool = true
        this.list = []
        this.hasMore = false
        this.reason = ''
        this.hint = ''
        this.degrade = ''
        this.loaded = true
        this.pendingLoad = false
        return
      }
      this.lockSchool = false
      // 序号与页码在发车前定住：响应回来时 this.page / this.tab 可能已经被下一次
      // 点击改掉，按当时的值落地就会串页 / 串频道。
      const mySeq = ++this.loadSeq
      const reqPage = this.page
      this.loading = true
      try {
        const res = await uniCloud.callFunction({
          name: 'post-list',
          data: {
            token: uni.getStorageSync('token') || '',
            scope: this.scopeOf(this.tab),
            page: reqPage,
            page_size: PAGE_SIZE
          }
        })
        const r = res.result || {}
        // 过期响应：切过 tab 了，这是上一个频道的返回，直接丢弃（finally 照常收尾）
        if (mySeq !== this.loadSeq) return
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '加载失败', icon: 'none' })
          // 加载态必须收掉：原来这里直接 return，loaded 一直是 false → 永久转圈
          this.reason = 'error'
          this.loaded = true
          return
        }
        const d = r.data || {}
        // 双保险：云函数说未认证（degraded === 'need_verify'）也走同一块锁屏态
        if (d.degraded === 'need_verify') {
          this.lockSchool = true
          this.list = []
          this.hasMore = false
          this.reason = ''
          this.hint = ''
          this.degrade = ''
          this.loaded = true
          return
        }
        const arr = d.list || []
        this.list = reqPage === 1 ? arr : this.list.concat(arr)
        this.hasMore = !!d.has_more
        // post-list 不返回 reason/hint（动态不做「未认证就拦」），只有降级说明
        this.reason = ''
        this.hint = ''
        this.degrade = d.degraded || ''
        this.loaded = true

        // 埋点：本次真正渲染出来的每张卡各报一次曝光。
        // 取 arr（这一次请求拿到的）而不是 this.list：上拉加载时前者只是新增的那批，
        // 后者会把前面已经曝光过的卡再刷一遍。
        // 动态没有「同频数」（那是搭子需求的字段），sync_count 就不再上报。
        for (let i = 0; i < arr.length; i++) {
          track('feed_impression', { card_id: arr[i]._id })
        }

        // 同校频道空列表不自动跳走。默认 tab 已经是「发现」（见 data.tab），
        // 原来这里有个「首屏同校为空就切回发现」的老逻辑（默认 tab 还是 school 时代留下的），
        // 现在只会在用户第一次主动点「同校」时把他弹回发现 —— 空列表交给模板空态。
      } catch (e) {
        // 过期响应不该把新频道打成错误态
        if (mySeq === this.loadSeq) {
          this.reason = 'error'
          this.loaded = true
          uni.showToast({ title: '网络不好，稍后再试', icon: 'none' })
        }
      } finally {
        // ★ 这个 finally 是「永久转圈」的根：原代码只在上面置 loading = true，
        //   从头到尾没有一处把它放回 false —— 第一次请求之后所有 load() 都被开头的
        //   「if (this.loading) return」挡掉，切几次频道都只会转圈。
        this.loading = false
        // 在飞期间被催过（切 tab / refresh / onShow）→ 收尾补发一次，绝不静默丢弃
        const replay = this.pendingLoad || this.feedPending
        this.pendingLoad = false
        this.feedPending = false
        if (replay) this.replayLoad()
      }
    },
    /* 点赞：先本地切换（即时反馈），再用服务端返回的权威 like_count 覆盖。
       不用本地 +1 定终值 —— 连点、弱网重试下本地计数会飘，服务端重算的数字才对得上。
       任何失败都回滚成点击前的样子，不给用户留一个假的红心。 */
    onLike(c) {
      const was = !!c.liked
      const oldCount = c.like_count || 0
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '登录后才能点赞', icon: 'none' })
        return
      }
      c.liked = !was
      c.like_count = oldCount + (was ? -1 : 1)
      uniCloud
        .callFunction({ name: 'post-like', data: { token, card_id: c._id, like: c.liked } })
        .then((res) => {
          const d = (res && res.result && res.result.data) || null
          if (res && res.result && res.result.code === 0 && d && typeof d.like_count === 'number') {
            c.like_count = d.like_count
          } else {
            c.liked = was
            c.like_count = oldCount
          }
        })
        .catch(() => {
          c.liked = was
          c.like_count = oldCount
        })
    },

    /* 打开分享面板：先挂上 on，隔一帧再翻 show —— 同一次赋值里两个一起变，
       浏览器只会渲染最终态，过渡根本不会播。 */
    openShare(c) {
      if (!c) return
      const s = this.share
      s.card = c
      s.favOn = false
      s.sending = false
      this.loadSharePeople()
      // 已经开着（比如连点两张卡）就只换卡片，别再播一遍滑入
      if (s.on) return
      s.on = true
      s.show = false
      setTimeout(() => { s.show = true }, 30)
    },
    /* 关闭：先滑出，等动画走完（240ms > 220ms）再从 DOM 摘掉，否则会闪一下消失 */
    closeShare() {
      const s = this.share
      if (!s.on) return
      s.show = false
      setTimeout(() => { s.on = false }, 240)
    },

    /* 分享面板的联系人：好友 + 搭子合并成一列（懒加载 + 本次会话内缓存）。
       为什么要搭子：只能发给好友时，只有搭子没有好友的用户在面板里一片空白。
       两者不会重复 —— buddy-list 读侧已经剔掉「已经是好友的人」；这里仍按
       user_id 去重一次，接口将来若不再剔也不会出现两个同名头像。
       顺序：搭子在前。搭子本来就有会话上下文，是更常分享的对象；被 30 个
       截断时也能保证搭子在列表里。token 为空不算失败 —— 面板照开，四圆圈还能用。 */
    async loadSharePeople() {
      const s = this.share
      if (s.loading) return
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        s.needLogin = true
        s.people = []
        return
      }
      s.needLogin = false
      if (s.loaded) return
      s.loading = true
      s.error = ''
      /* 一个接口失败不该让整列空掉：各自兜住，能拿到几个就显示几个。
         两个都失败时留 loaded=false，下次开面板自动重试。 */
      const one = function (name, extra) {
        return uniCloud
          .callFunction({ name: name, data: Object.assign({ token: token }, extra) })
          .then(function (res) {
            const r = (res && res.result) || {}
            if (r.code !== 0) return { ok: false, list: [], msg: r.msg || '' }
            return { ok: true, list: ((r.data || {}).list) || [], msg: '' }
          })
          .catch(function () {
            return { ok: false, list: [], msg: '' }
          })
      }
      try {
        const both = await Promise.all([
          one('buddy-list', {}),
          one('friend-list', { action: 'list' })
        ])
        const buddies = both[0]
        const friends = both[1]
        const out = []
        const seen = {}
        const push = function (item) {
          const uid = item.user_id || ''
          if (!uid || seen[uid]) return
          seen[uid] = true
          out.push(item)
        }
        buddies.list.forEach(function (b) {
          push({
            kind: 'buddy',
            user_id: b.other_user_id || b.user_id || '',
            name: b.name || '',
            remark: '',
            // buddy-list 已把换好的临时链接写在 avatar 上；两个字段都认，谁有取谁
            avatar_url: b.avatar_url || b.avatar || '',
            conversation_id: b.conversation_id || ''
          })
        })
        friends.list.forEach(function (u) {
          push({
            kind: 'friend',
            user_id: u.user_id || '',
            name: u.name || '',
            remark: u.remark || '',
            avatar_url: u.avatar_url || u.avatar || '',
            conversation_id: u.conversation_id || ''
          })
        })
        // 面板就一屏横滑：几十个好友加几个搭子没必要全塞进 data
        s.people = out.slice(0, 30)
        this.avaSync(s.people, (f) => 'f' + f.user_id, (f) => f.avatar_url)
        if (buddies.ok && friends.ok) {
          s.loaded = true
        } else if (!s.people.length) {
          s.error = buddies.msg || friends.msg || '好友和搭子都没加载出来'
        }
      } finally {
        s.loading = false
      }
    },

    /* 名字口径：备注优先，没有备注用昵称（跟好友页一致）。搭子没有备注，只有 name */
    friendName(f) {
      if (!f) return ''
      return f.remark || f.name || '同学'
    },

    /* 复制的那句话：正文截 80 字；没正文就退化成图片张数 */
    shareText(c) {
      const name = (c.owner && c.owner.nickname) || '一位同学'
      const raw = (c.content || '').trim()
      let body = raw
      if (!body) {
        const n = this.imgsOf(c).length
        body = n > 0 ? '分享了 ' + n + ' 张图' : '分享了一条动态'
      } else if (body.length > 80) {
        body = body.slice(0, 80) + '…'
      }
      return '【同频·同频圈】' + name + '：' + body
    },
    shareCopy() {
      const c = this.share.card
      if (!c) return
      uni.setClipboardData({
        data: this.shareText(c),
        success: () => {
          uni.showToast({ title: '文案已复制', icon: 'none' })
        }
      })
    },

    /* 收藏：card-favorite 的 toggle。target_type 让同一条内容在
       「动态收藏」和「搭子卡收藏」两套口径里分开算（云函数按它分支）。 */
    async shareFav() {
      const c = this.share.card
      if (!c) return
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '登录后才能收藏', icon: 'none' })
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'card-favorite',
          data: { token: token, action: 'toggle', card_id: c._id, target_type: 'post' }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '收藏失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        // 云函数回的 favorited 就是操作后的真实状态；没有这个字段才本地翻转
        const on = typeof d.favorited === 'boolean' ? d.favorited : !this.share.favOn
        this.share.favOn = on
        uni.showToast({ title: on ? '已收藏' : '已取消收藏', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: '收藏失败，稍后再试', icon: 'none' })
      }
    },

    /* 私信：消息页在 pages.json 的 tabBar.list 里（pages/messages/messages），
       tab 页只能用 switchTab —— navigateTo 到 tab 页在 App / 小程序都会失败。 */
    shareDM() {
      this.closeShare()
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.navigateTo({ url: '/pages/login/login' })
        return
      }
      uni.switchTab({ url: '/pages/messages/messages' })
    },

    /* 点赞直接复用卡片上那个 onLike：它本身就是 toggle，也自带失败回滚 */
    shareLike() {
      const c = this.share.card
      if (!c) return
      this.onLike(c)
    },

    /* 点好友 = 发一条 type='share' 的私信。
       没有 conversation_id 就直说，不自己造会话 —— 会话归属由 message-send 的成员校验说了算。 */
    async shareTo(f) {
      const s = this.share
      const c = s.card
      if (!c || !f || s.sending) return
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '登录后才能分享给好友', icon: 'none' })
        return
      }
      if (!f.conversation_id) {
        uni.showToast({ title: '你们还没有会话，先去消息页聊一句', icon: 'none', duration: 2500 })
        return
      }
      // clientMsgId 格式照 chat.vue：c + 36 进制时间戳 + 6 位随机串，服务端按它判重
      const clientMsgId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      const imgs = this.imgsOf(c)
      const meta = {
        post_id: c._id,
        text: (c.content || '').slice(0, 120),
        // 优先用 cloud:// 原值：临时链接约 2 小时失效，存进消息里就是一张死图
        cover: (Array.isArray(c.image_ids) && c.image_ids[0]) ? c.image_ids[0] : (imgs.length > 0 ? imgs[0] : ''),
        owner_name: (c.owner && c.owner.nickname) || '',
        owner_id: (c.owner && c.owner._id) || ''
      }
      s.sending = true
      try {
        const res = await uniCloud.callFunction({
          name: 'message-send',
          data: {
            token: token,
            conversationId: f.conversation_id,
            type: 'share',
            content: c._id,
            clientMsgId: clientMsgId,
            meta: meta
          }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '分享失败', icon: 'none' })
          return
        }
        uni.showToast({ title: '已发送给 ' + this.friendName(f), icon: 'none' })
        this.closeShare()
      } catch (e) {
        uni.showToast({ title: '网络不太好，没发出去', icon: 'none' })
      } finally {
        s.sending = false
      }
    },

    /* 解析卡片图片。
       后端可能返回 images / media / image_urls 三种字段之一，
       也可能是 JSON 字符串（数据库存 String）—— 全兼容。
       没有图片时返回空数组，模板会走渐变封面分支。 */
    imgsOf(c) {
      const raw = c.images || c.media || c.image_urls || []
      if (Array.isArray(raw)) return raw.filter(Boolean)
      if (typeof raw === 'string') {
        try {
          const arr = JSON.parse(raw)
          return Array.isArray(arr) ? arr.filter(Boolean) : []
        } catch (e) {
          return []
        }
      }
      return []
    },

    /* 多图横滑：算出当前第几张，更新右上角指示。
       用 scrollLeft / 单图宽度 取整 —— 不需要 scroll-snap 也能准，
       因为每张图宽度严格等于容器宽。 */
    onMediaScroll(e, c) {
      const n = this.imgsOf(c).length
      if (n < 2) return
      const total = e.detail.scrollWidth || 1
      const itemW = total / n
      const idx = Math.round(e.detail.scrollLeft / itemW)
      const cur = this.mediaIdx[c._id] || 0
      if (idx === cur) return
      // 整体替换而不是 $set：Vue2 对新增 key 不响应
      this.mediaIdx = Object.assign({}, this.mediaIdx, { [c._id]: idx })
    },

    /* feed_click 只有一个出口：点卡片、点图片预览、点💬 三条路都走这里报一次，
       —— 埋点散在各处，将来加一个入口就会漏一个。position 用 list 下标（0 起）。 */
    trackClick(c) {
      track('feed_click', { card_id: c._id, position: this.list.indexOf(c) })
    },
    /* 点卡片空白处 → 动态详情：正文、图片、评论、删除都在那边 */
    openDetail(c) {
      this.trackClick(c)
      uni.navigateTo({ url: '/pages/post-detail/post-detail?id=' + c._id })
    },
    /* 点图片 → 原样全屏预览，不进详情页：只想看大图的人不该被多跳一层。
       无图时这块是渐变封面，等同于点卡片空白处 —— 否则点了什么都不发生，像坏了。 */
    previewPost(c) {
      const imgs = this.imgsOf(c)
      if (!imgs.length) {
        this.openDetail(c)
        return
      }
      this.trackClick(c)
      uni.previewImage({ urls: imgs, current: 0 })
    },
    goPublish() {
      uni.navigateTo({ url: '/pages/post/post' })
    },
    /* 类型标签 → 内容形态标签。动态没有「学习/健身」这种分类，
       区分的是「有没有图」，因为那决定了卡片长什么样。 */
    mediaLabel(c) {
      const n = this.imgsOf(c).length
      if (n > 1) return n + ' 图'
      if (n === 1) return '图文'
      return '文字'
    },
    /* 无图时用正文前几十字当封面标题；空正文给一句中性文案 */
    brief(s) {
      const tx = (s || '').trim()
      if (!tx) return '分享了一条动态'
      return tx.length > 42 ? tx.slice(0, 42) + '…' : tx
    },
    fmtTime(t) {
      if (!t) return ''
      const d = new Date(t)
      const mm = ('0' + (d.getMonth() + 1)).slice(-2)
      const dd = ('0' + d.getDate()).slice(-2)
      const hh = ('0' + d.getHours()).slice(-2)
      const mi = ('0' + d.getMinutes()).slice(-2)
      return mm + '-' + dd + ' ' + hh + ':' + mi
    },
    ago(t) {
      if (!t) return ''
      const diff = Date.now() - Number(t)
      if (!(diff > 0)) return ''
      const min = Math.floor(diff / 60000)
      if (min < 1) return '刚刚'
      if (min < 60) return min + ' 分钟前'
      const hr = Math.floor(min / 60)
      if (hr < 24) return hr + ' 小时前'
      const day = Math.floor(hr / 24)
      if (day < 30) return day + ' 天前'
      return this.fmtTime(t)
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  /* 自定义导航栏：顶部只让出状态栏高度（原生标题栏已去掉）；底部 tabBar 高度 + 安全区 */
  padding: calc(var(--status-bar-height) + 16rpx) 32rpx 200rpx;
  box-sizing: border-box;
  background-color: transparent;
}

/* ---- 三栏切换 ---- */
/* ==========================================================================
   同频圈主色：晴空蓝
   --------------------------------------------------------------------------
   只在本页覆盖 --tf-primary，首页仍然是暖黄。
   用独有类名 .feed-page 而不是 .page —— uni-app 的页面样式是全局的，
   直接改 .page 会串到首页。
   ========================================================================== */
.feed-page {
  --tf-primary:      #3B7ADB;
  --tf-primary-deep: #2A5A94;
  --tf-primary-soft: #D6E4FA;
}

.seg {
  position: relative;
  display: flex;
  flex-direction: row;
  /* 宽度缩到 40%（缩短 60%），靠右放 */
  width: 40%;
  margin-left: auto;
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  border-radius: 16rpx;
  padding: 4rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 4rpx 12rpx rgba(150, 110, 60, 0.10);
}

.seg-item {
  flex: 1;
  padding: 18rpx 0;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.seg-item--on {
  background-color: var(--tf-primary);
}

.seg-text {
  font-size: 28rpx;
  color: var(--tf-text-2);
}

.seg-item--on .seg-text {
  color: #ffffff;
  font-weight: 600;
}

/* ---- 同校频道锁屏态 ---- */
.lock {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 96rpx 40rpx 64rpx;
  gap: 16rpx;
}

.lock-ico {
  font-size: 88rpx;
  opacity: 0.45;
}

.lock-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
  text-align: center;
  line-height: 1.5;
}

.lock-btn {
  margin-top: 12rpx;
  padding: 0 56rpx;
  height: 84rpx;
  border-radius: 42rpx;
  background-color: var(--tf-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.lock-btn-text {
  font-size: 29rpx;
  font-weight: 600;
  color: #FFFFFF;
}

/* 同校 tab 上的小锁：只做提示，点了仍然进锁屏态 */
.seg-lock {
  font-size: 20rpx;
  margin-left: 4rpx;
  opacity: 0.7;
}

/* ---- 降级说明 ---- */
.degrade {
  padding: 18rpx 24rpx;
  margin-bottom: 24rpx;
  background-color: var(--tf-primary-soft);
  border-radius: 20rpx;
}

.degrade-text {
  font-size: 24rpx;
  color: var(--tf-primary);
  line-height: 1.5;
}

/* ---- 首屏加载 ---- */
.skeleton {
  padding: 80rpx 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.skeleton-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

/* ---- 卡片流 ---- */
.list {
  padding: 0 0 8rpx;
}

/* ==========================================================================
   Instagram 式卡片
   --------------------------------------------------------------------------
   头 → 1:1 图 → 操作栏 → 文案。
   两个方向的滑动分开：竖向是页面滚动，横向只有 .media-rail 内部滚。
   ========================================================================== */
.post {
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line);
  border-radius: 24rpx;
  margin-bottom: 24rpx;
  overflow: hidden;
}

/* ---- 头 ---- */
.p-head {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 24rpx 26rpx;
}
.p-ava {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(150deg, #ffc9a8, #f0a070);
}

/* 有头像时 .p-ava 只当尺寸盒用：去掉渐变底和文字，改成图片裁切。
   没有可用链接时连 <image> 都不挂，露出 .p-ava 自己的圆底当空占位（任务要求：绝不回落默认头像图） */
.p-ava-img {
  display: block;
  overflow: hidden;
  background: var(--tf-card-line);
}
.p-who { flex: 1; min-width: 0; }
.p-name-row { display: flex; align-items: center; gap: 10rpx; }
.p-name {
  font-size: 28rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.p-verified {
  height: 32rpx;
  padding: 0 10rpx;
  border-radius: 999rpx;
  background: var(--tf-tag-1, #d9f3ec);
  color: #1f6b5c;
  font-size: 20rpx;
  display: flex;
  align-items: center;
}
.p-mine {
  height: 32rpx;
  padding: 0 10rpx;
  border-radius: 999rpx;
  background: var(--tf-primary-soft);
  color: var(--tf-primary-deep);
  font-size: 20rpx;
  display: flex;
  align-items: center;
}
.p-meta {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--tf-text-3);
}
.p-type {
  flex: none;
  font-size: 22rpx;
  color: var(--tf-text-3);
}

/* ---- 图片区 ---- */
.p-media {
  position: relative;
  width: 100%;
  /* 1:1 画幅。
     不用 aspect-ratio —— 部分安卓 webview（Chrome < 88）不支持，会塌成一条线。
     用 padding-bottom:100% 这个老技巧：padding 的百分比按「宽度」算，
     所以 padding-bottom 100% 就等于高度 = 宽度，兼容性最好。 */
  height: 0;
  padding-bottom: 100%;
  overflow: hidden;
  background: #f2ede4;
}
/* 绝对定位铺满，抵消 padding 撑出的高度 */
.p-media > .media-rail,
.p-media > .media-item,
.p-media > .media-ph {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}

/* 横滑容器：white-space + inline-block 是最稳的写法，
   flex 在 scroll-view 里部分安卓机不生效 */
.media-rail {
  width: 100%;
  height: 100%;
  white-space: nowrap;
}
.media-item {
  width: 100%;
  height: 100%;
  display: inline-block;
  vertical-align: top;
}

/* 无图时的渐变封面：按类型分色 */
.media-ph {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 0 30rpx 36rpx;
  box-sizing: border-box;
}
.ph--text    { background: linear-gradient(165deg, #D8F2E5 0%, #63B896 46%, #2C7A60 100%); }

.ph-title {
  font-size: 38rpx;
  font-weight: 800;
  color: #fff;
  line-height: 1.32;
  letter-spacing: -0.01em;
  text-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.28);
  /* 最多两行，超出省略 —— 否则长标题会顶掉标签 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
}
.media-count {
  position: absolute;
  right: 20rpx;
  top: 20rpx;
  z-index: 2;
  height: 44rpx;
  padding: 0 18rpx;
  border-radius: 22rpx;
  background: rgba(20, 16, 12, 0.58);
  color: #fff;
  font-size: 22rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
}

/* ---- 操作栏 ---- */
.p-actions {
  display: flex;
  align-items: center;
  gap: 28rpx;
  padding: 20rpx 26rpx 0;
}
.act {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
/* 通用操作图标（评论 💬 / 分享 ↗） */
.act-ic {
  font-size: 30rpx;
  color: var(--tf-text-3);
  line-height: 1;
}

/* 点赞心：用 SVG 背景，不用字符 ♥
   —— 字符的粗细形状完全由系统字体决定，安卓上和设计稿差很远。
      SVG 背景在任何设备上都一样。 */
.act-heart {
  width: 34rpx;
  height: 34rpx;
  flex: none;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' fill='%239A9186'/%3E%3C/svg%3E") no-repeat center / contain;
  transition: transform 220ms cubic-bezier(0.34, 1.4, 0.5, 1);
}
/* 选中：固定红，不跟 --tf-primary（本页主色是晴空蓝） */
.act-heart--on {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' fill='%23F5455F'/%3E%3C/svg%3E");
  transform: scale(1.12);
}
/* 分享推到最右，和点赞/评论分开 */
.act--save { margin-left: auto; }

/* 同频按钮：描边，不跟主 CTA 抢 */
.p-join {
  margin-left: auto;
  flex: none;
  height: 56rpx;
  padding: 0 26rpx;
  border-radius: 28rpx;
  border: 3rpx solid var(--tf-primary);
  color: var(--tf-primary);
  font-size: 22rpx;
  font-weight: 800;
  display: flex;
  align-items: center;
}

/* ---- 文案 ---- */
.p-body {
  padding: 16rpx 26rpx 26rpx;
}
.p-likes {
  display: block;
  font-size: 22rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.p-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}
.p-desc-name {
  color: var(--tf-text);
  font-weight: 800;
  margin-right: 8rpx;
}

/* ---- 空态 ---- */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 72rpx 24rpx 56rpx;
  gap: 14rpx;
}

.empty-ico {
  font-size: 96rpx;
  opacity: 0.35;
}

.empty-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.empty-desc {
  font-size: 25rpx;
  color: var(--tf-text-2);
  text-align: center;
  line-height: 1.6;
}

.empty-btn {
  margin-top: 16rpx;
  padding: 0 40rpx;
  height: 76rpx;
  line-height: 76rpx;
  font-size: 27rpx;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 20rpx;
  border: none;
}

.empty-btn::after {
  border: none;
}

/* ---- 加载更多 ---- */
.more {
  padding: 36rpx 0 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.more-text {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

.more-text--end {
  opacity: 0.7;
}
/* ---- 发布按钮（右下角，压在 tabBar 之上）----
   z-index 998 < tabBar 的 999：位置在导航栏上方，但层级更低，
   这样两者万一重叠也不会盖住导航。 */
.fab {
  position: fixed;
  right: 32rpx;
  /* 老 iOS 只认 constant()，新的只认 env()：先写旧的，后写新的才会覆盖 */
  bottom: calc(190rpx + constant(safe-area-inset-bottom));
  bottom: calc(190rpx + env(safe-area-inset-bottom));
  width: 104rpx;
  height: 104rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tf-primary);
  box-shadow: 0 12rpx 28rpx rgba(232, 184, 32, 0.40);
  z-index: 998;
}
.fab-plus {
  font-size: 56rpx;
  line-height: 1;
  color: #ffffff;
}
/* ==========================================================================
   分享面板（抖音式底部滑出）
   --------------------------------------------------------------------------
   mask 与 sheet 都是页面级 fixed 节点（跟 .fab 一样），不参与 .page 的布局。
   z-index 1000 / 1001：压过自定义 tabBar(999) 和 .fab(998)。
   ========================================================================== */
.sh-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 220ms ease;
  z-index: 1000;
}
.sh-mask--in {
  opacity: 1;
}

.sh-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1001;
  background: #ffffff;
  border-radius: var(--tf-r-lg) var(--tf-r-lg) 0 0;
  padding: 8rpx 32rpx 0;
  /* 老 iOS 只认 constant()，新的只认 env()：先写旧的，后写新的才会覆盖 */
  padding-bottom: calc(24rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  box-shadow: var(--tf-glass-shadow);
  transform: translateY(100%);
  transition: transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.sh-sheet--in {
  transform: translateY(0);
}

/* ---- 标题行 ---- */
.sh-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 0 16rpx;
}
.sh-title {
  font-size: 30rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.sh-close {
  width: 60rpx;
  height: 60rpx;
  line-height: 60rpx;
  text-align: center;
  font-size: 30rpx;
  color: var(--tf-text-3);
}

/* ---- 好友横滑 ---- */
/* 横滑容器用 white-space + inline-block，和 .media-rail 同一套写法：
   flex 在 scroll-view 里部分安卓机不生效。高度写死，否则 scroll-x 会塌成 0 */
.sh-friends {
  width: 100%;
  /* 176rpx = 头像 92 + 搭子角标 6+26 + 名字 10+30，多留 12 余量防裁 */
  height: 176rpx;
  white-space: nowrap;
}
.sh-friend {
  display: inline-block;
  width: 108rpx;
  margin-right: 18rpx;
  vertical-align: top;
  text-align: center;
}
.sh-ava {
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  background: var(--tf-card-line);
}
/* 有链接 / 用默认图都走这条：块级 + 裁切，行内基线不会把名字顶歪 */
.sh-ava-img {
  display: block;
  overflow: hidden;
}
/* 搭子角标：横着放在头像底下、名字上面的一颗小药丸。
   父容器 text-align: center，inline-block 自然居中，不占名字的宽度 */
.sh-badge {
  display: inline-block;
  margin-top: 6rpx;
  padding: 0 10rpx;
  font-size: 18rpx;
  line-height: 26rpx;
  color: var(--tf-primary-deep);
  background: var(--tf-primary-soft);
  border-radius: 999rpx;
}
.sh-fname {
  display: block;
  margin-top: 10rpx;
  width: 108rpx;
  font-size: 22rpx;
  color: var(--tf-text-2);
  /* 单行截断：名字一长就会把下面那排挤歪 */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sh-fempty {
  height: 176rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sh-fempty-text {
  font-size: 24rpx;
  color: var(--tf-text-3);
}

/* ---- 分隔线 ---- */
.sh-line {
  height: 2rpx;
  background: var(--tf-line-soft);
  margin: 6rpx 0 0;
}

/* ---- 四个圆圈动作 ---- */
.sh-acts {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  padding: 26rpx 0 22rpx;
}
.sh-act {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}
.sh-ico {
  width: 92rpx;
  height: 92rpx;
  border-radius: 50%;
  background: var(--tf-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  line-height: 1;
  color: var(--tf-text-2);
}
.sh-ico--on {
  background: var(--tf-primary-soft);
  color: var(--tf-primary-deep);
}
.sh-act-n {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

/* ---- 取消 ---- */
.sh-cancel {
  height: 92rpx;
  border-radius: var(--tf-r-md);
  background: var(--tf-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sh-cancel-text {
  font-size: 28rpx;
  color: var(--tf-text-2);
}
/* 头像淡入：初始不可见，解码完成（@load）后整体亮起。
   用同一个节点切 class，不摘挂节点 —— 摘挂会让图片区域塌一下再回来。 */
.ava-fade {
  opacity: 0;
  transition: opacity 160ms ease-out;
}
.ava-fade--in {
  opacity: 1;
}

</style>
