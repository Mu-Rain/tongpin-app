<template>
  <view class="page">

    <!-- ===== 页头 =====
         文档 §8：删掉「ME / 我的」双标题，只保留一个。
         导航栏已经写了「我的」，页面内不再重复大标题，直接进资料卡。 -->


    <!-- ===== 资料卡 ===== -->
    <view class="profile">
      <view class="profile-top">
        <!-- 头像：有图才画图，没有可用链接就留一个空圆占位。
             ★ 绝不回落 /static/avatar-default.png，也不用昵称首字 —— 用户要求过多次。
             图片走 common/avatar/avatarCache.js：本地落盘 + 解码完成后整体淡入，
             所以既看不到「从上到下刷出来」的过程，也看不到「默认图闪一下变真图」。
             点一下就能换，入口不做成独立按钮 —— 128rpx 的圆点上去就是「改这里」，比多一行「更换头像」更直觉 -->
      <view class="avatar-xl" :class="avaSrcOf('mine') ? 'avatar-xl--img' : ''" @tap="onAvatarTap">
        <image
          v-if="avaSrcOf('mine')"
          class="avatar-img ava-fade"
          :class="{ 'ava-fade--in': avaReadyOf('mine') }"
          :src="avaSrcOf('mine')"
          mode="aspectFill"
          @load="avaOnLoad('mine')"
          @error="avaOnError('mine', avatarInput)"
        />
        <view class="avatar-mask" v-if="uploading">
          <text class="avatar-mask-t">上传中</text>
        </view>
      </view>

        <view class="profile-main">
          <view class="profile-name-row">
            <text class="profile-name">{{ user.nickname || '未登录' }}</text>
            <!-- 只展示「已拥有」的状态。未认证不在这里说 ——
                 打开页面就告诉用户「你不完整」，是三连负面字段的根源。
                 负面信息只在点「学生认证」入口时提示。 -->
            <text class="verified" v-if="user.schoolVerified">已认证</text>
          </view>
          <!-- 学校 + UID 同一行：不新增行高，资料卡高度保持原样。
               整行可点，点一下复制 UID —— 加好友时要把它发给对方。
               老账号还没补号时 user.uid 是空串，只显示学校。 -->
          <view class="profile-meta" v-if="user.school || user.uid" @tap="copyUid">
            <text class="profile-school" v-if="user.school">{{ user.school }}</text>
            <text class="meta-sep" v-if="user.school && user.uid">·</text>
            <text class="profile-uid" v-if="user.uid">UID {{ user.uid }}</text>
          </view>

          <!-- 称号展示：唯一一个「我是谁」的标签入口（原来的标签计数胶囊已撤） -->
          <!-- 佩戴中的称号：走全局 .tt 皮肤，和称号墙里是同一套外观 -->
          <view
            class="tt tt--sm title-slot"
            :class="equippedCode ? skinOf(equippedCode).cls : 'tt--ghost'"
            @tap="goTitle"
          >
            <text class="tt-ico" v-if="equippedCode">{{ skinOf(equippedCode).icon }}</text>
            <text class="tt-name">{{ equippedTitle || '挑个称号' }}</text>
            <text class="tt-arrow">›</text>
          </view>
        </view>

      </view>

      <!-- 信誉分：液体进度条（参考视频里的横向 bar，绿→蓝渐变 + 流动边界） -->
      <view class="credit-bar" @tap="goCredit">
        <view class="cb-track">
          <view class="cb-fill" :style="{ width: creditPct + '%' }" />
        </view>
        <text class="cb-num">{{ creditText }}</text>
        <text class="cb-label">信誉分</text>
      </view>

      <!-- 三格统计：全部是页面上已有的真实数字，不编造 -->
      <view class="stats">
        <view class="stat" @tap="goBuddy">
          <text class="stat-num">{{ buddyCount === null ? '-' : buddyCount }}</text>
          <text class="stat-label">我的搭子</text>
        </view>
        <view class="stat" @tap="goFriend">
          <text class="stat-num">{{ friendCount }}</text>
          <text class="stat-label">我的好友</text>
        </view>
        <!-- 待处理申请：0 时整项隐藏（文档 §8「不汇报库存」） -->
        <view class="stat" v-if="friendPendingCount > 0" @tap="goFriend">
          <text class="stat-num">{{ friendPendingCount }}</text>
          <text class="stat-label">待处理申请</text>
        </view>
      </view>
    </view>

    <!-- 低于 60 分时先说清为什么发不了卡片，顺手给个看明细的入口 -->
    <view class="credit-tip" v-if="canPublish === false">
      <text class="credit-tip-text">信誉分低于 60，暂时不能发布卡片，完成搭子或通过认证可以加分</text>
      <text class="credit-tip-link" @tap="goCredit">看明细 ›</text>
    </view>

    <!-- ===== 模块入口 ===== -->
    <!-- ===== 三张便签纸：所有功能入口按主题分到三张纸上 ===== -->
    <!-- 三张便签：不放标题，直接从上到下列入口 -->
    <view class="notes">

      <view class="note note--1">
        <view class="note-item" @tap="goTags">
          <image class="note-ico" src="/static/icons/tags.png" mode="aspectFit" />
          <text class="note-label">我的标签</text>
          <text class="note-val">{{ myTagCount }}/10</text>
        </view>
        <view class="note-item" @tap="goFavorites">
          <image class="note-ico" src="/static/icons/star.png" mode="aspectFit" />
          <text class="note-label">我的收藏</text>
        </view>
        <view class="note-item" @tap="goTitle">
          <image class="note-ico" src="/static/icons/leaf.png" mode="aspectFit" />
          <text class="note-label">称号墙</text>
          <text class="note-val" v-if="equippedTitle">{{ equippedTitle }}</text>
        </view>
      </view>

      <view class="note note--2">
        <view class="note-item" @tap="goVerify">
          <image class="note-ico" src="/static/icons/cap.png" mode="aspectFit" />
          <text class="note-label">学生认证</text>
        </view>
        <view class="note-item" @tap="goLiked">
          <image class="note-ico" src="/static/icons/heart.png" mode="aspectFit" />
          <text class="note-label">喜欢</text>
        </view>
      </view>

      <view class="note note--3">
        <view class="note-item" @tap="goHistory">
          <image class="note-ico" src="/static/icons/book.png" mode="aspectFit" />
          <text class="note-label">观看历史</text>
        </view>
        <view class="note-item" @tap="goMoments">
          <image class="note-ico" src="/static/icons/user.png" mode="aspectFit" />
          <text class="note-label">我的动态</text>
        </view>
        <view class="note-item" @tap="goSettings">
          <image class="note-ico" src="/static/icons/home.png" mode="aspectFit" />
          <text class="note-label">设置</text>
        </view>
      </view>

    </view>

    <!-- 管理员专用：四个入口一列。普通用户看不到这一块。 -->
    <view class="admincard" v-if="isAdmin">
      <view class="admincard-head">
        <text class="admincard-title">🔧 管理员</text>
        <text class="admincard-count">{{ pendingCount }} 条待审</text>
      </view>
      <text class="admincard-sub">这里能看到别人上传的学生证照片，属于敏感数据，只有管理员可见。</text>
      <view class="admin-list">
        <view class="admin-item" @tap="goAdmin">
          <text class="admin-item-text">认证审核{{ pendingCount > 0 ? '（' + pendingCount + '）' : '' }}</text>
          <text class="mod-arrow">›</text>
        </view>
        <view class="admin-item" @tap="goReports">
          <text class="admin-item-text">举报处理{{ reportPendingCount > 0 ? '（' + reportPendingCount + '）' : '' }}</text>
          <text class="mod-arrow">›</text>
        </view>
        <view class="admin-item" @tap="goUsers">
          <text class="admin-item-text">用户列表</text>
          <text class="mod-arrow">›</text>
        </view>
        <!-- 百科与称号都是内容维护，条目很少，合并成一个入口进去再分 tab，否则这里要排 5 行 -->
        <view class="admin-item" @tap="goContent">
          <text class="admin-item-text">百科与称号</text>
          <text class="mod-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- 未登录时给个出口 -->
    <view class="guestcard" v-if="!isLoggedIn">
      <text class="guestcard-hint">你还没登录，标签存不了。</text>
      <button class="btn" @tap="goLogin">去登录</button>
    </view>

    <view class="footlinks">
      <text class="link" @tap="onSwitchAccount" v-if="isLoggedIn">切换账号</text>
      <text class="link-sep" v-if="isLoggedIn">|</text>
      <text class="link link--muted" @tap="onLogout" v-if="isLoggedIn">退出登录</text>
    </view>

    <!--
      权限自检。
      排查「管理员卡片不显示」时加的：把前端实际读到的角色原样打出来，
      否则只能在"到底是没权限、还是本地缓存旧、还是页面没跳"之间瞎猜。
      非管理员默认折叠，管理员自动展开。
    -->
    <view class="diag" v-if="devTools">
      <text class="diag-toggle" @tap="showDiag = !showDiag">
        {{ showDiag ? '▾' : '▸' }} 权限自检
      </text>
      <view class="diag-body" v-if="showDiag || isAdmin">
        <text class="diag-line">role = "{{ user.role || '(空)' }}"</text>
        <text class="diag-line">is_admin = {{ user.is_admin === true ? 'true' : 'false / 没这个字段' }}</text>
        <text class="diag-line">isAdmin 判定 = {{ isAdmin ? '通过 ✓' : '不通过 ✗' }}</text>
        <text class="diag-line">nickname = "{{ user.nickname || '(空)' }}"</text>
        <view class="diag-btn" @tap="refreshMe">重新从服务器拉一次我的资料</view>
        <text class="diag-hint" v-if="refreshMsg">{{ refreshMsg }}</text>
      </view>
    </view>
  </view>

  <!-- 自定义 tabBar（pages.json 已开 custom: true） -->
  <custom-tab-bar />
</template>

<script>
import customTabBar from '@/custom-tab-bar/index.vue'
import devToolsOn from '@/common/dev-tools.js'
import { unbindPush } from '@/common/push.js'
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'
// 本次会话内已经弹过的称号 code。title-list 每次进页面都可能回同一条 newly，
// 不在前端去重就会反复弹（契约 §3.1：重复进页面不重复弹）。
const SHOWN_TITLE_TOASTS = {}

/* 头像临时链接的本地缓存：{ file: 'cloud://...', url: 'https://...', at: 时间戳 }
   --------------------------------------------------------------------------
   库里存 fileID，<image> 只认 http，所以每次进页面都要换一次链 —— 换链是异步的。
   以前 avatarUrl 初值是空串，于是「切页 → 先画默认头像 → 链接回来才换成真图」，
   每次切页都闪一下。把上次换到的链接存下来，进页面就能同步先画真图。 */
const AVATAR_CACHE_KEY = 'avatarTempCache'

import { skinOf } from '@/common/title/skins.js'

export default {
  components: { customTabBar },
  // 头像淡入的公共时序（common/avatar/avatarCache.js），5 个页面共用同一份，不在各页各写一套
  mixins: [avatarFadeMixin],
  data() {
    return {
      user: {},
      // 头像：库里存的是 fileID（cloud:// 开头），<image> 不认，得先换成临时链接
      avatarUrl: '',
      // 当前 avatarUrl 属于哪个账号。tab 页实例会被缓存，切号后要靠它判断该不该清空
      avatarOwner: '',
      // 图裂兜底只给一次机会：服务端也换不出链时，不加这个标志会无限重试
      avatarRetried: false,
      uploading: false,
      // 认证状态摘要，给「学生认证」入口卡显示一句话用
      verifyStatus: 'none', // none / pending / approved / rejected
      // 标签数量摘要（只取数字，完整编辑器在 pages/tags）
      myTagCount: 0,
      // 管理员入口：只有 role === 'admin' 或 is_admin === true 才显示
      pendingCount: 0,
      // 举报待处理数。拉不到就保持 0，入口照样能点进去
      reportPendingCount: 0,
      // 好友摘要：好友数与待处理申请数（只取两个数字，完整页面在 pages/friend）
      friendCount: 0,
      /* 搭子数。null = 还没查出来或查不出来（页面显示 '-'）；0 才是真的一个都没有 */
      buddyCount: null,
      friendPendingCount: 0,
      // 调试工具（连通性自检 / 权限自检）只在开发环境出现。
      // 用 process.env.NODE_ENV 运行时判断：uni-app 的条件编译只认平台名（APP-PLUS/H5/…），
      // 没有 DEBUG 这个宏，写 #ifdef DEBUG 会被当成永假、连开发时也看不到。
      devTools: devToolsOn(),
      showDiag: false,
      refreshMsg: '',
      // 能不能发布卡片，只有 credit-list 说了算；默认 true 免得云函数没上线时把发布口封了
      canPublish: true,
      // 当前佩戴的称号名；空串 = 没佩戴（称号墙入口照样能点）
      equippedTitle: '',
      // 称号 code：决定用哪套皮肤（只存名字的话没法挑样式）
      equippedCode: '',

      /* —— tab 切换的调度与去重状态（见 onShow / scheduleTabLoad / refreshFromServer）——
         nativeTabHidden：原生 tabBar 藏过就不再藏，重复调是白跑一遍原生布局。
         tabLoadTimer：连点 tab 时后一次调度覆盖前一次，不让几批请求排队。
         refreshInflight / refreshPending：onShow 那一批请求的在飞标记与「回来后再补一次」的脏标记。
         pendingCropFile：裁剪页回传的文件路径（onShow 同步取出并从 storage 删掉，上传排到首帧之后）。
         tabShowCount / tabDedupCount / refreshRetryCount：只做计数，验收时证明「连点没有重复发请求」。 */
      nativeTabHidden: false,
      tabLoadTimer: null,
      refreshInflight: false,
      refreshPending: false,
      pendingCropFile: '',
      tabShowCount: 0,
      tabDedupCount: 0,
      refreshRetryCount: 0
    }
  },
  computed: {
    /* 头像的「稳定键」：优先 fileID。
       临时链接每次换一次签名（?Expires=...），拿它当缓存键等于永远不命中；
       fileID 和包内静态路径（/static/...）永远不变。 */
    avatarInput() {
      const u = this.user || {}
      const raw = String(u.avatar || '')
      if (raw) return raw
      return String(this.avatarUrl || '')
    },
    // 管理员的两种写法都认：role='admin'（set-admin 写的）/ is_admin=true（早期设计）
    isAdmin() {
      return this.user.role === 'admin' || this.user.is_admin === true
    },
    isLoggedIn() {
      return !!uni.getStorageSync('token')
    },
    // 好友入口卡的一句话状态：有待处理就先提醒处理
    friendDesc() {
      if (this.friendPendingCount > 0) return this.friendPendingCount + ' 条申请等你处理'
      return '已加 ' + this.friendCount + ' 位好友'
    },
    // 认证入口卡的一句话状态
    verifyDesc() {
      const map = {
        approved: '已认证 · 校园身份已解锁',
        pending: '审核中，1–2 个工作日出结果',
        rejected: '上次没通过，可以重新提交'
      }
      return map[this.verifyStatus] || '未认证 · 认证后才能进同校频道'
    },
    // 称号墙入口那一行：有佩戴就写称号名，没有就只写入口名（不显示空占位）
    titleEntryText() {
      return this.equippedTitle ? '称号 · ' + this.equippedTitle : '称号墙'
    },
    // 信誉分环：满分 100 对应 360°。
    // 设计稿里 96 分画到 345°，正是 96 × 3.6 —— 所以直接线性映射，不另设基准。
    creditDeg() {
      const c = Math.max(0, Math.min(100, Number(this.user.credit) || 0))
      return Math.round(c * 3.6)
    },
    // conic-gradient 只能靠内联样式驱动（角度是数据算出来的），
    // 所以整条 gradient 拼成字符串，不用 CSS 变量 —— 少一层兼容风险
    /* 信誉分数字：真的拿不到时显示 '-'，不要留空白 —— 空白看起来像"分数没了"（m02962） */
    creditText() {
      const c = Number(this.user && this.user.credit)
      return isNaN(c) ? '-' : String(c)
    },

    /* 信誉分百分比：直接当进度条宽度 */
    creditPct() {
      const v = Number(this.user && this.user.credit) || 0
      return Math.max(0, Math.min(100, v))
    },

    creditRingStyle() {
      const d = this.creditDeg
      const mid = Math.round(d * 0.61)
      return (
        'background: conic-gradient(from 0deg,' +
        ' #8FBF9D 0deg,' +
        ' #5D9770 ' + mid + 'deg,' +
        ' #3F7A58 ' + d + 'deg,' +
        ' rgba(127,166,140,0.20) ' + d + 'deg 360deg);'
      )
    },
    // 信誉等级文案。阈值与 user-profile 云函数的 creditBand() 保持一致，
    // 不另起一套 —— 同一个分数在两个页面不能叫两个名字
    creditLabel() {
      const c = Number(this.user.credit) || 0
      if (c >= 95) return '极好'
      if (c >= 85) return '很好'
      if (c >= 70) return '良好'
      if (c >= 60) return '一般'
      return '较低'
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

    /* 同步路径只留「不花钱、第一帧就要用」的活：
       1) 读本地 userInfo —— 纯 storage，模板第一帧的昵称/信誉分就靠它。
       2) seedAvatar —— 用上次换到的链接先把头像画出来，否则每次切页都先闪默认头像。
          顺序不能反：必须在 user 就位之后、网络换链之前（本轮不动头像相关函数）。
       3) 裁剪页回传「读一次就删」—— 必须在同步路径完成，否则连点两次 tab 会把同一张图传两遍；
          但真正的上传排到首帧之后（见 refreshFromServer 的 pendingCropFile）。 */
    const info = uni.getStorageSync('userInfo')
    this.user = info || {}
    this.seedAvatar()
    const cropResult = uni.getStorageSync('avatarCropResult') || ''
    if (cropResult) {
      uni.removeStorageSync('avatarCropResult')
      this.pendingCropFile = cropResult
    }
    // ★ 剩下全是网络请求（最多 10 条云函数），交给调度器排到首帧之后。
    //   原来这些全挤在 onShow 的同步路径里，和页面首次渲染撞在同一帧 —— 切 tab 卡的就是这一帧。
    this.scheduleTabLoad()
  },
  /* 头像绑定：avatarInput 一变就重新挂（换号、换图、服务端换了链接都会走到这儿）。
     immediate 是为了「进页面时 user 已经在 storage 里」的情况 —— 那种情况没有变动，
     只有 immediate 能在首帧之前把本地缓存挂上。 */
  watch: {
    avatarInput: {
      immediate: true,
      handler(v) {
        this.avaBind('mine', v)
      }
    }
  },
  methods: {
    /* 模板里按 code 取皮肤 */
    skinOf,
    /* tab 显示后的请求调度：首帧与网络解耦。
       ------------------------------------------------------------------
       判据（延后 / 立刻发）：
         本地已有「只有服务端才知道的字段」→ 首帧有东西可画 → 延后
         （userInfo.credit 是数字，说明上次 user-me 成功回来过；或 buddyCount !== null，
          说明上次搭子数拉过）。$nextTick 保证首帧已提交，setTimeout(30) 再留一帧余量。
         两者都不成立（新登录 / 刚切号 / 从没拉通过）→ 页面此刻是空的，
         延后只会让用户多看空白 → 0ms（让出首帧，但不多等）。
       去重不在这里做：refreshFromServer 带在飞标记。 */
    scheduleTabLoad() {
      const u = this.user || {}
      const hasData = typeof u.credit === 'number' || this.buddyCount !== null
      // 有本地数据可画 → 30ms，给渲染管线留一帧余量；什么都没有 → 0ms。
      // 0ms 不等于「同步发」：它照样是一个宏任务，首帧会先提交，用户几乎察觉不到，
      // 但这 10 条云函数调用的初始化就不会再挤进首帧那一帧。
      const delay = hasData ? 30 : 0
      // 连点 tab 会有多次调度：只保留最后一个，避免几批请求排队发出
      if (this.tabLoadTimer) clearTimeout(this.tabLoadTimer)
      this.$nextTick(() => {
        // 同一个 tick 里连点两次会注册两个 nextTick 回调：先清掉前一个定时器再设，
        // 保证最终只剩一个待执行的调度（否则两个定时器会几乎同时发出两批请求）
        if (this.tabLoadTimer) clearTimeout(this.tabLoadTimer)
        this.tabLoadTimer = setTimeout(() => {
          this.tabLoadTimer = null
          this.refreshFromServer()
        }, delay)
      })
    },

    /* onShow 需要的那一批服务端数据，一次排齐。
       ★ 在飞去重：这批（最多 10 条云函数）还没回来时又进了页面（快速连点 tab），
         就不再发第二批 —— 只打一个 pending 标记，回来之后补一次。
         补发走的还是本函数，所以补发期间再进页面只会再打一次标记，不会套娃。
       说明：本页的请求都是「一次进页面全刷一遍」的只读聚合，没有单独刷新某一条的入口，
       所以在飞标记按「整批」算就够；单条请求各自的失败仍然是静默的（各 loader 内部 try/catch）。 */
    refreshFromServer() {
      if (this.refreshInflight) {
        this.refreshPending = true
        this.tabDedupCount++
        return
      }
      this.refreshInflight = true
      const jobs = []
      // 切号后本地这份 userInfo 可能是账号簿拼出来的五字段版本（没有 credit / role /
      // school_id）。缺信誉分就静默问一次服务端补齐，否则信誉条空着、数字也不显示（m02962）。
      /* 资料卡要能自己纠偏：本地 userInfo 是登录那一刻的快照，之后后台改了学校（比如
         学生认证补/改学校、换校审核通过），不重新拉一次就永远显示旧学校。
         所以除了「缺信誉分」必刷，再加一条 5 分钟节流刷新 —— 既不每次进页面都打接口，
         也不会让资料卡长期停在旧值上。 */
      const PROFILE_TTL = 5 * 60 * 1000
      let syncedAt = 0
      try { syncedAt = Number(uni.getStorageSync('profile_synced_at_v1')) || 0 } catch (e) { syncedAt = 0 }
      const profileStale = !syncedAt || Date.now() - syncedAt > PROFILE_TTL
      if (this.isLoggedIn && (typeof this.user.credit !== 'number' || profileStale)) {
        jobs.push(this.syncProfile(true))
      }
      // storage 里存的是 fileID，每次进页面换一次临时链接，保证链接不过期
      jobs.push(this.loadAvatar())
      // 每次回到这页都刷新一下入口卡上的状态（刚从标签页/认证页回来时会变）
      jobs.push(this.loadVerifyStatus())
      jobs.push(this.loadTagCount())
      // 管理员：顺手拉一次待审数量，让入口上能看到数字
      if (this.isAdmin) {
        jobs.push(this.loadPendingCount())
        jobs.push(this.loadReportPendingCount())
      }
      // 好友入口卡上的两个数字。失败静默，不影响页面。
      jobs.push(this.loadFriendSummary())
      jobs.push(this.loadBuddySummary())
      // 低信誉提示要在进页面时就对，不能等用户去点明细才知道自己发不了卡片
      jobs.push(this.loadCredit())
      // 称号墙入口文案 + 这一次会话里的「新称号」提示。失败静默，不影响页面其它部分。
      jobs.push(this.loadTitle())
      // 裁剪页回传的图：onShow 只负责取出并删 storage，真正的上传排到这里（首帧之后）
      if (this.pendingCropFile) {
        const f = this.pendingCropFile
        this.pendingCropFile = ''
        jobs.push(this.doUploadAvatar(f))
      }
      // 不用 Promise.allSettled（低版本 webview 上不一定有）；这些 loader 内部都自己
      // try/catch 过，所以 all 不会因为单条失败而短路。两个分支都走同一个收尾，
      // 保证在飞标记在任何情况下都会复位 —— 它一卡死，本页数字就再也不会刷新。
      Promise.all(jobs).then(
        () => this.finishRefresh(),
        () => this.finishRefresh()
      )
    },

    finishRefresh() {
      this.refreshInflight = false
      if (this.refreshPending) {
        this.refreshPending = false
        this.refreshRetryCount++
        // 在飞期间又进过页面：补一次最新数据（补发同样先判在飞，不会自激）
        setTimeout(() => this.refreshFromServer(), 0)
      }
    },

    // 只取标签数量，用于入口卡的「已选 N / 10」。完整编辑在 pages/tags。
    // 轻量：不拉标签字典，只读我已选的那份。
    async loadTagCount() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.myTagCount = 0
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'user-tags',
          data: { action: 'get', token }
        })
        const r = res.result || {}
        if (r.code === 0) this.myTagCount = ((r.data && r.data.list) || []).length
      } catch (e) {
        // 静默：拉不到就保持原值，不影响页面
      }
    },

    // 管理员：待审数量
    async loadPendingCount() {
      try {
        const res = await uniCloud.callFunction({
          name: 'verify-review',
          data: { action: 'list', token: uni.getStorageSync('token') || '', status: 'pending' }
        })
        const r = res.result || {}
        if (r.code === 0) this.pendingCount = (r.data && r.data.total) || 0
      } catch (e) {
        // 静默：拉不到数字不影响进入审核页
      }
    },

    // 管理员：举报待处理数。只取 pending_count，列表交给举报页自己拉
    async loadReportPendingCount() {
      try {
        const res = await uniCloud.callFunction({
          name: 'admin-reports',
          data: {
            action: 'list',
            token: uni.getStorageSync('token') || '',
            status: 'pending',
            page: 1,
            page_size: 1
          }
        })
        const r = res.result || {}
        if (r.code === 0) this.reportPendingCount = (r.data && r.data.pending_count) || 0
      } catch (e) {
        // 静默：admin-reports 还没部署时这里会抛，不影响进入别的入口
      }
    },

    goCredit() {
      uni.navigateTo({ url: '/pages/credit/credit' })
    },

    goTitle() {
      uni.navigateTo({ url: '/pages/title/title' })
    },

    /**
     * 复制 UID。
     * UID 是 8 位数字，手抄容易错位，复制是最常用的分享方式
     * （微信里发出去、对方粘贴到加好友搜索框）。
     */
    copyUid() {
      const uid = String((this.user && this.user.uid) || '')
      if (!uid) return
      uni.setClipboardData({
        data: uid,
        success: () => {
          uni.showToast({ title: 'UID 已复制', icon: 'none', duration: 1200 })
        }
      })
    },

    // 只取 equipped 与 newly：列表数据留给称号墙自己拉，这里多拉一遍纯属浪费。
    // 失败全程静默 —— 云函数没上线也不该影响这页别的功能。
    async loadTitle() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.equippedTitle = ''
        this.equippedCode = ''
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'title-list',
          data: { token: token }
        })
        const r = res.result || {}
        if (r.code !== 0) return
        const d = r.data || {}
        this.equippedTitle = d.equipped ? (d.equipped.name || '') : ''
        this.equippedCode = d.equipped ? (d.equipped.code || '') : ''
        const fresh = (d.newly || []).filter((t) => t && t.code && !SHOWN_TITLE_TOASTS[t.code])
        if (fresh.length === 0) return
        fresh.forEach((t) => {
          SHOWN_TITLE_TOASTS[t.code] = true
        })
        const names = fresh.map((t) => t.name || t.code).join('、')
        uni.showToast({ title: '新称号：' + names, icon: 'none', duration: 2000 })
      } catch (e) {
        // 静默：title-list 还没部署时这里会抛（函数不存在），保持原值即可
      }
    },

    // 只为一个开关：can_publish。明细数据留给信誉分页自己拉，这里多拉一遍纯属浪费。
    async loadCredit() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.canPublish = true
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'credit-list',
          data: { token: token, page: 1, page_size: 1 }
        })
        const r = res.result || {}
        if (r.code === 0 && r.data) this.canPublish = r.data.can_publish !== false
      } catch (e) {
        // 静默：拉不到就保持上一次的值
      }
    },

    goAdmin() {
      uni.navigateTo({ url: '/pages/verify-admin/verify-admin' })
    },

    goReports() {
      uni.navigateTo({ url: '/pages/admin-reports/admin-reports' })
    },

    goUsers() {
      uni.navigateTo({ url: '/pages/admin-users/admin-users' })
    },

    // 百科与称号合并成一个入口，进页面后再分 tab
    goContent() {
      uni.navigateTo({ url: '/pages/admin-encyclopedia/admin-encyclopedia' })
    },

    goFriend() {
      uni.navigateTo({ url: '/pages/friend/friend' })
    },

    /**
     * 好友入口卡上的摘要：只取 total 与 pending_count。
     * ★ 不为此改 user-me 云函数 —— 这里多打一次 friend-list 更省事，
     *   而且失败只是两个数字不动，页面照常用。
     */
    async loadFriendSummary() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.friendCount = 0
        this.friendPendingCount = 0
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'friend-list',
          data: { token: token, action: 'list' }
        })
        const r = res.result || {}
        if (r.code === 0 && r.data) {
          this.friendCount = r.data.total || 0
          this.friendPendingCount = r.data.pending_count || 0
        }
      } catch (e) {
        // 静默：拉不到数字不影响页面
      }
    },

    /**
     * 搭子入口卡上的数字：只取 buddy-list 的 data.total。
     * ★ 不数 list 的行数 —— total 是后端按对方 id 合并后的人数，
     *   老数据里有重复关系行，数行数会把 1 个搭子显示成 6。
     *   查不出来就留 null（模板显示 '-'）：显示 0 会让人以为真的没搭子。
     */
    async loadBuddySummary() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.buddyCount = null
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'buddy-list',
          data: { token: token }
        })
        const r = res.result || {}
        if (r.code === 0 && r.data) {
          this.buddyCount = r.data.total || 0
        } else {
          this.buddyCount = null
        }
      } catch (e) {
        // 静默：查不出来就是「不知道」，不影响页面其它部分
        this.buddyCount = null
      }
    },

    /**
     * 重新从服务器拉一次「我的资料」，并覆盖本地缓存。
     *
     * 为什么需要它：userInfo 是登录那一刻写进本地存储的，之后再改数据库里的
     * role/is_admin，本地那份不会跟着变。以前只能靠「退出再登录」刷新，
     * 现在给一个按钮，省得反复登录。
     *
     * 走的是 user-me 云函数（读库里的最新记录），不重新走登录流程 ——
     * 登录要密码，这里不需要。
     */
    async refreshMe() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.refreshMsg = '没登录，先登录'
        return
      }
      this.refreshMsg = '拉取中…'
      await this.syncProfile(false)
    },

    /**
     * 静默版 refreshMe：进页面时发现本地资料不全（例如刚切过账号）就补一次。
     * silent = true 时不写 refreshMsg、失败不提示，页面照常显示。
     */
    async syncProfile(silent) {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        if (!silent) this.refreshMsg = '没登录，先登录'
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'user-me',
          data: { token }
        })
        const r = res.result || {}
        if (r.code === 0 && r.data && r.data.user) {
          // 用服务器返回的覆盖本地，合并而不是整体替换，避免丢掉本地独有字段
          const merged = Object.assign({}, this.user, r.data.user)
          uni.setStorageSync('userInfo', merged)
          // 记下这次刷新的时间：上面那条 5 分钟节流靠它，不然每次进页面都打一次 user-me
          try { uni.setStorageSync('profile_synced_at_v1', Date.now()) } catch (e) {}
          this.user = merged
          this.loadAvatar()
          if (!silent) this.refreshMsg = '✓ 已刷新：role=' + (merged.role || '(空)')
          if (this.isAdmin) {
            this.loadPendingCount()
            this.loadReportPendingCount()
          }
        } else if (!silent) {
          this.refreshMsg = '✗ ' + (r.msg || '拉取失败')
        }
      } catch (e) {
        if (!silent) this.refreshMsg = '✗ ' + (e.message || '调用失败') + '（user-me 部署了吗？）'
      }
    },

    /* 进页面先把头像「同步」画出来，不等网络。
       ------------------------------------------------------------------
       以前 avatarUrl 初值是空串，模板先画默认头像，等 getTempFileURL 回来才换成真图，
       于是每切一次页就闪一下。这里用「storage 里的临时链接 / 上次换到的缓存」
       先把图补上，网络请求只负责刷新，不再决定第一帧长什么样。 */
    seedAvatar() {
      const u = this.user || {}
      const uid = this.avatarUid()
      // 换了账号：先把上一个账号的图清掉，免得新账号的资料卡上顶着旧头像
      if (uid && this.avatarOwner && uid !== this.avatarOwner) this.avatarUrl = ''
      if (uid) this.avatarOwner = uid
      const cached = String(u.avatar_url || '')
      const raw = String(u.avatar || '')
      // ★ 内置头像（/static/avatars/...）是 storage 里唯一的确定值，必须越过下面那句早退：
      //   从「系统头像」页返回时 avatarUrl 还挂着上一张图，早退会把刚选的那张挡掉，
      //   要等 loadAvatar 那一轮网络请求回来才换 —— 用户看到的就是「选了没生效」。
      if (cached.indexOf('/') === 0 && cached !== this.avatarUrl) {
        this.avatarUrl = cached
        return
      }
      if (this.avatarUrl) return
      // ① storage 里已经是可直接用的链接（登录/刷新时服务端换好的）
      if (cached.indexOf('http') === 0) {
        this.avatarUrl = cached
        return
      }
      // ①.5 自带头像：注册时随机发的包内静态资源（/static/avatars/av-xxx.png）。
      //     它不是 fileID，不需要换链；不认这一条会一路落到「默认头像」。
      if (cached.indexOf('/') === 0) {
        this.avatarUrl = cached
        return
      }
      // ② 历史 https 直链
      if (raw.indexOf('http') === 0) {
        this.avatarUrl = raw
        return
      }
      // ③ fileID：用上次换到的临时链接顶上（约 2 小时有效，过期了由 onAvatarError 兜底）
      const c = uni.getStorageSync(AVATAR_CACHE_KEY) || null
      if (raw && c && c.file === raw && c.url) this.avatarUrl = c.url
    },

    /* 当前登录账号的 id。不同来源的字段名不一样（uni-id 用 _id），这里统一兜一遍 */
    avatarUid() {
      const u = this.user || {}
      return String(u._id || u.user_id || u.uid || '')
    },

    /* 记下 fileID → 临时链接，下次进页面直接用它画第一帧 */
    cacheAvatarUrl(file, url) {
      if (!file || !url || url.indexOf('http') !== 0) return
      try {
        uni.setStorageSync(AVATAR_CACHE_KEY, { file: file, url: url, at: Date.now() })
      } catch (e) {
        /* 写不进去就算了，顶多下次多闪一下 */
      }
    },

    /* 头像换链：库里存 fileID，<image> 只认 http，所以每次进页面换一次。
       失败不弹错 —— 少张图不该打断页面；拿不到链接时用统一的默认头像图。
       ★ 只在真的拿到新链接时才覆盖 avatarUrl：否则「有头像 → 闪成默认 → 又变回来」 */
    async loadAvatar() {
      const u = this.user || {}
      const raw = u.avatar || ''
      const cached = u.avatar_url || ''
      const uid = this.avatarUid()
      // tab 页实例会被缓存：**只在换号时**清空。
      // 同一账号刷新时保留旧图，否则每切一次页都要从默认头像重画一遍（用户看到的「闪一下」）。
      if (uid && this.avatarOwner && uid !== this.avatarOwner) this.avatarUrl = ''
      if (uid) this.avatarOwner = uid
      // 每次进页面重给一次兜底额度：切走再切回来，上一轮的失败该有机会重试
      this.avatarRetried = false

      // ① fileID：客户端换链最快；换不到再让服务端换（服务端一定拿得到云环境凭证）
      if (raw.indexOf('cloud://') === 0) {
        let url = ''
        try {
          const res = await uniCloud.getTempFileURL({ fileList: [raw] })
          const item = ((res && res.fileList) || [])[0] || {}
          url = item.tempFileURL || ''
        } catch (e) {
          url = ''
        }
        if (!url) url = await this.refreshAvatarFromServer()
        // 拿到才覆盖：这一轮换链失败时保留 seedAvatar 画出来的那张，
        // 否则会「有头像 → 闪成默认头像 → 又变回来」
        if (url) {
          this.avatarUrl = url
          this.cacheAvatarUrl(raw, url)
        }
        return
      }
      // ② 服务端换好的链接：比 storage 里那份历史直链新鲜，优先用
      if (cached.indexOf('http') === 0) {
        this.avatarUrl = cached
        return
      }
      // ②.5 自带头像：包内静态资源，本身就是可用地址，换链逻辑对它没意义
      if (cached.indexOf('/') === 0) {
        this.avatarUrl = cached
        return
      }
      // ③ 历史 https 直链：先用着，过期了由 onAvatarError 兜底
      if (raw.indexOf('http') === 0) {
        this.avatarUrl = raw
        return
      }
      // ④ storage 里的 user 是登录当时的旧投影，可能整份都没带 avatar / avatar_url。
      //    有 token 就回服务端问一次真值（① 已 return，故一次 loadAvatar 最多问这一次）
      const token = uni.getStorageSync('token') || ''
      if (token) {
        const fresh = await this.refreshAvatarFromServer()
        if (fresh) {
          this.avatarUrl = fresh
          return
        }
      }
      // ⑤ 问不到就保持现状（可能是 seedAvatar 画的那张）；真没有图就是空圆占位（不回落默认头像）
    },

    /* 兜底：本地换链失败就回服务端要一次真值（user-me 里已经换好链）。
       拿到就写回 storage —— 不写回的话下次进页面还拿着旧值重走一遍坏路径。
       合并而不是整体替换，且不让空值把有效的 avatar 覆盖掉。 */
    async refreshAvatarFromServer() {
      const token = uni.getStorageSync('token') || ''
      if (!token) return ''
      try {
        const res = await uniCloud.callFunction({
          name: 'user-me',
          data: { token: token }
        })
        const r = res.result || {}
        const serverUser = (r.code === 0 && r.data && r.data.user) || null
        if (!serverUser) return ''
        const url = serverUser.avatar_url || ''
        const merged = Object.assign({}, this.user, serverUser, {
          // avatar 是库里的原值：服务器回过空就留本地那份，别把有值的头像抹成空
          avatar: serverUser.avatar || (this.user && this.user.avatar) || '',
          // avatar_url 是派生值，只认服务器这次给的，不回退到旧链接
          avatar_url: url
        })
        uni.setStorageSync('userInfo', merged)
        this.user = merged
        if (url.indexOf('http') === 0) {
          this.cacheAvatarUrl(String(merged.avatar || ''), url)
          return url
        }
        return ''
      } catch (e) {
        return ''
      }
    },

    /* 图裂兜底：src 拿到了却取不回来，典型是 storage 里那条临时链接已经过期。
       同一页面生命周期只补一次，否则服务端也换不出链时会无限重试。 */
    async onAvatarError() {
      if (this.avatarRetried) return
      this.avatarRetried = true
      const url = await this.refreshAvatarFromServer()
      if (url && url !== this.avatarUrl) {
        this.avatarUrl = url
        return
      }
      // 服务端也换不出来 → 这张图真的没了。按「不显示默认头像」的约束留空圆占位，不塞默认图、不塞昵称首字
      this.avatarUrl = ''
    },

    /* 换头像的第一个岔路口：相册 / 拍照 / 内置头像。
       相册和拍照合成一项的话，想直接拍一张的人还得在系统面板里再点一次；
       而内置头像是包内资源，压根不需要经过系统相册。所以三项分开列。 */
    onAvatarTap() {
      if (!this.isLoggedIn) {
        uni.showToast({ title: '先登录', icon: 'none' })
        return
      }
      if (this.uploading) return
      const self = this
      uni.showActionSheet({
        itemList: ['从相册选择', '拍照', '系统头像'],
        success: (res) => {
          const i = Number((res && res.tapIndex) || 0)
          // 点「取消」时两端都走 fail，不进 success，所以这里不用再判一次
          if (i === 0) self.chooseAvatar('album')
          else if (i === 1) self.chooseAvatar('camera')
          else if (i === 2) self.gotoSystemAvatar()
        }
      })
    },

    /* 先压缩再进裁剪页：手机原图动辄几 MB，而头像最终只显示 128rpx，
       压不动就用原图，不阻断。
       source 由上一层 actionSheet 决定：一项只对应一个来源，不再 album+camera 混选。 */
    chooseAvatar(source) {
      const self = this
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: [source === 'camera' ? 'camera' : 'album'],
        success: (res) => {
          const p = (res.tempFilePaths || [])[0]
          if (!p) return
          if (typeof uni.compressImage !== 'function') {
            self.gotoAvatarCrop(p)
            return
          }
          uni.compressImage({
            src: p,
            quality: 70,
            compressedWidth: 512,
            success: (r) => self.gotoAvatarCrop(r.tempFilePath),
            fail: () => self.gotoAvatarCrop(p)
          })
        }
      })
    },

    /* 裁切页取源图只能走 storage：临时路径塞进 url query 会被编码截断。
       裁剪页要把整张图 drawImage 进画布，所以先压到 512，原图会明显卡。 */
    gotoAvatarCrop(src) {
      uni.setStorageSync('avatarCropSrc', src)
      uni.navigateTo({ url: '/pages/avatar-crop/avatar-crop' })
    },

    /* 内置头像页自己调云函数、自己写 storage、自己返回；这边不接回传 ——
       onShow 会重读 storage，avatar_url 已经是可直接渲染的包内路径。 */
    gotoSystemAvatar() {
      uni.navigateTo({ url: '/pages/avatar-system/avatar-system' })
    },

    async doUploadAvatar(filePath) {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '先登录', icon: 'none', duration: 1500 })
        return
      }
      this.uploading = true
      uni.showLoading({ title: '上传中', mask: true })
      let ok = false
      let failMsg = ''
      try {
        // cloudPath 必须带随机串：支付宝云的 cloudPath 就是文件绝对路径，同路径会直接覆盖
        const rand = Math.random().toString(36).slice(2, 10)
        const up = await uniCloud.uploadFile({
          filePath: filePath,
          cloudPath: 'avatar/' + Date.now() + '-' + rand + '.jpg',
          fileType: 'image'
        })
        if (!up || !up.fileID) throw new Error('上传失败')
        const r1 = await uniCloud.callFunction({
          name: 'user-avatar',
          data: { token: token, file_id: up.fileID }
        })
        const r = r1.result || {}
        if (r.code !== 0) throw new Error(r.msg || '设置失败')
        // 本地立刻换成新头像，不等下次进页面；storage 一起改，切页回来才不会是旧的
        // avatar_url 里还留着**旧**的临时链接，不清掉的话 seedAvatar 会先画旧头像
        this.user = Object.assign({}, this.user, { avatar: up.fileID, avatar_url: '' })
        this.avatarUrl = ''
        try { uni.removeStorageSync(AVATAR_CACHE_KEY) } catch (e) {}
        uni.setStorageSync('userInfo', this.user)
        await this.loadAvatar()
        ok = true
      } catch (e) {
        failMsg = e.message || '上传失败'
      } finally {
        this.uploading = false
        uni.hideLoading()
      }
      // 提示必须等 loading 关掉之后再弹：两者共用原生提示通道，
      // 先弹 toast 再 hideLoading，那个已经变成 toast 的提示就再也关不掉了
      if (ok) {
        uni.showToast({ title: '头像已更新', icon: 'success', duration: 1500 })
      } else {
        uni.showToast({ title: failMsg, icon: 'none', duration: 1500 })
      }
    },

    // 入口模块：我的标签 / 学生认证
    goTags() {
      uni.navigateTo({ url: '/pages/tags/tags' })
    },

    // 我的收藏：详情页收藏过的卡片列表
    /* 我的搭子与标签：从消息页迁入（文档 §4.3） */
    goBuddy() {
      uni.navigateTo({ url: '/pages/buddy/buddy' })
    },

    goLiked() {
      uni.navigateTo({ url: '/pages/liked/liked' })
    },
    goRecommend() {
      uni.navigateTo({ url: '/pages/recommend/recommend' })
    },
    goHistory() {
      uni.navigateTo({ url: '/pages/history/history' })
    },

    /* 我的动态：仿微信朋友圈的个人动态页 */
    goMoments() {
      uni.navigateTo({ url: '/pages/moments/moments' })
    },

    goSettings() {
      uni.navigateTo({ url: '/pages/settings/settings' })
    },

    goFavorites() {
      uni.navigateTo({ url: '/pages/favorites/favorites' })
    },

    goVerify() {
      uni.navigateTo({ url: '/pages/verify/verify' })
    },

    // 认证入口卡上的一句话状态。失败就保持 none，不让整页报错。
    async loadVerifyStatus() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.verifyStatus = 'none'
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'verify-submit',
          data: { token, action: 'status' }
        })
        const r = res.result || {}
        if (r.code === 0 && r.data) this.verifyStatus = r.data.status || 'none'
      } catch (e) {
        // 静默：拉不到就按未认证显示
      }
    },

    goLogin() {
      uni.reLaunch({ url: '/pages/login/login' })
    },

    onLogout() {
      uni.showModal({
        title: '退出登录',
        content: '确定要退出吗？',
        success: (r) => {
          if (!r.confirm) return
          // 解绑要读 token 与 cid，必须早于清 storage；unbindPush 同步读完才 await，所以不用等它
          unbindPush()
          uni.removeStorageSync('token')
          uni.removeStorageSync('userInfo')
          // ★ autoLogin 也要清。不清的话登录页读到的还是 state:'ok'，
          //   在新一轮自动登录逻辑下会立刻把人又弹回首页 —— 等于退不出去。
          uni.removeStorageSync('autoLogin')
          this.user = {}
          this.myTagCount = 0
          uni.reLaunch({ url: '/pages/login/login' })
        }
      })
    },

    /**
     * 切换账号。
     * 现在跳专门的「切换账号」页：那里列出这台设备登录过的所有号，
     * 点一下就切过去，不用再输一次手机号密码。
     * （以前是直接清 token 回登录页，用户得多打一遍密码，测试两个号时很烦。）
     */
    onSwitchAccount() {
      uni.navigateTo({ url: '/pages/account/account' })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  /* 自定义导航栏：顶部只让出状态栏高度；底部给原生 tabBar 留白 */
  padding: calc(var(--status-bar-height) + 16rpx) 32rpx 200rpx;
  box-sizing: border-box;
  background-color: transparent;
}

/* ==========================================================================
   页头
   ========================================================================== */



/* ==========================================================================
   资料卡
   ========================================================================== */
.profile {
  position: relative;
  overflow: hidden;
  padding: 33rpx 37rpx 27rpx;
  border-radius: var(--tf-r-xl);
  /* 浅蓝紫渐变：原来大面积 #593CC9 太冲，改成接近白的淡紫，
     紫色只作为「色调倾向」存在，不再是压人的色块。
     右上白光 + 左下腮红，让渐变有方向感。 */
  background:
    radial-gradient(110% 90% at 88% -12%, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0) 60%),
    radial-gradient(80% 70% at 6% 108%, rgba(242, 164, 121, 0.20) 0%, rgba(242, 164, 121, 0) 62%),
    /* 右下角一抹草绿，让冷紫不孤单 */
    radial-gradient(72% 62% at 94% 96%, rgba(196, 216, 136, 0.34) 0%, rgba(196, 216, 136, 0) 64%),
    linear-gradient(146deg, #F1F4FD 0%, #E4EAF9 52%, #D8E0F4 100%);
  border: 2rpx solid rgba(255, 255, 255, 0.90);
  box-shadow: 0 12rpx 32rpx rgba(120, 130, 180, 0.16);
}

/* 浅紫底上文字用深紫（白字在浅底上只有 1.5:1）。
   必须用 .profile 前缀 —— 直接写 .profile-name 会被样式表后面同名规则覆盖。 */
.profile .profile-name {
  color: #3B3A6B;
}
.profile .profile-school {
  color: #6B6A96;
}
/* 学校 + UID 同一行。
   align-self: flex-start 是必须的 —— .profile-main 是 flex-column，
   默认 stretch 会把这行拉成整行宽，点按热区跟着变成一条横贯的空白。
   行内 .profile-school 的 margin-top 归零，间距统一由这一行控制。 */
.profile-meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10rpx;
  align-self: flex-start;
  max-width: 100%;
  margin-top: 8rpx;
}
.profile-meta .profile-school {
  margin-top: 0;
}
.meta-sep {
  font-size: 22rpx;
  color: rgba(107, 106, 150, 0.45);
}
.profile-uid {
  flex: none;
  font-size: 21rpx;
  font-weight: 600;
  color: rgba(90, 58, 176, 0.78);
  letter-spacing: 0.04em;
}
.profile .credit-num {
  color: #fff;
}
.profile .credit-unit {
  color: rgba(255, 255, 255, 0.82);
}

/* 胶囊和信誉环也统一转白色系 —— 原来的「绿白渐变」在紫底上会打架 */
/* 称号展示：金色胶囊，资料卡上唯一的「我是谁」入口 */
/* 称号条：按内容宽度收缩，不铺满整行
   --------------------------------------------------------------------------
   .profile-main 是 flex-column，默认 align-items: stretch ——
   子元素会被横向拉满，于是这个胶囊变成一条横贯整行、右侧大段留空的黄条。
   加 align-self: flex-start 让它回到「文字多宽、胶囊多宽」。 */
.title-slot {
  margin-top: 12rpx;
}

.profile .titlechip {
  background: #FFFFFF;
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 4rpx 12rpx rgba(120, 130, 180, 0.18);
}
.profile .titlechip-star {
  color: #E8A800;
}
.profile .titlechip-text {
  color: #5A3AB0;
}
.profile .chip-plain {
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(120, 130, 180, 0.20);
}
.profile .chip-plain-text {
  color: #5A5A88;
}
/* ==========================================================================
   信誉分：液体进度条
   --------------------------------------------------------------------------
   参考视频：横向 bar，绿→蓝渐变填充，右边界是会呼吸的椭圆（像液体）。
   ========================================================================== */
.credit-bar {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  margin-top: 28rpx;
}
.cb-track {
  position: relative;
  flex: 1;
  height: 52rpx;
  border-radius: 26rpx;
  background: rgba(120, 130, 180, 0.16);
  overflow: hidden;
}
.cb-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 26rpx;
  background: linear-gradient(90deg, #C4D888 0%, #6BC5A8 46%, #3B7ADB 100%);
  transition: width 1400ms cubic-bezier(0.34, 1.05, 0.5, 1);
}
/* 液体边界：右端一个椭圆，缓慢呼吸 */
.cb-fill::after {
  content: '';
  position: absolute;
  right: -8rpx;
  top: 0;
  width: 22rpx;
  height: 100%;
  border-radius: 50%;
  background: #4E8ED8;
  animation: cb-wave 2600ms ease-in-out infinite;
}
@keyframes cb-wave {
  0%, 100% { transform: scaleX(1) scaleY(1); }
  50% { transform: scaleX(1.45) scaleY(1.08); }
}
.cb-num {
  flex: none;
  font-size: 42rpx;
  font-weight: 800;
  line-height: 1;
  color: #3B3A6B;
}
.cb-label {
  flex: none;
  font-size: 19rpx;
  color: #6B6A96;
}

.profile .credit {
  /* 白底徽章 + 深紫字 */
  background-color: #FFFFFF;
  box-shadow: 0 4rpx 14rpx rgba(120, 130, 180, 0.20);
}
.profile .credit-num,
.profile .credit-unit {
  color: #4A2FA8;
}
.profile .verified {
  background: rgba(255, 255, 255, 0.86);
  color: #4A4A8C;
  border-color: rgba(120, 130, 180, 0.22);
}

.profile-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20rpx;
}

.profile .avatar-xl {
  box-shadow: 0 0 0 4rpx rgba(255, 255, 255, 0.95), 0 6rpx 16rpx rgba(120, 130, 180, 0.24);
}
.avatar-xl {
  width: 128rpx;
  height: 128rpx;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 46rpx;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(140deg, var(--tf-primary), var(--tf-primary-deep));
  border: 2rpx solid var(--tf-line);
  box-shadow: 0 12rpx 29rpx rgba(31, 92, 172, 0.24);
  /* 图片和上传遮罩都要被裁成这个圆，所以这里既是定位容器也是裁剪容器 */
  position: relative;
  overflow: hidden;
}
.avatar-xl--img {
  /* 有图时底下那层不要再画东西：圆形容器漏出的渐变底、2rpx 描边和阴影，
     在图片圆形抗锯齿边缘看就是「上一个默认头像」的轮廓 */
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}
/* .profile .avatar-xl 的白色描边环是双类选择器，单类压不住，这里再压一次 */
.profile .avatar-xl--img {
  border-color: transparent;
  box-shadow: none;
}
.avatar-img {
  width: 100%;
  height: 100%;
  /* 父级 .avatar-xl 是圆角盒，图片自己不圆就会被切成方角露出四角 */
  border-radius: 50%;
  overflow: hidden;
}
.avatar-mask {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.avatar-mask-t {
  font-size: 22rpx;
  color: #fff;
}

.profile-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.profile-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 13rpx;
}

.profile-name {
  font-size: 38rpx;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--tf-text);
}

.verified {
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  font-weight: 600;
  color: var(--tf-mint);
  background: rgba(201, 221, 196, 0.46);
  border: 2rpx solid rgba(95, 130, 108, 0.24);
}

.verified--off {
  color: var(--tf-text-2);
  background: var(--tf-line-soft);
  border-color: transparent;
}

.profile-school {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--tf-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-tags {
  margin-top: 21rpx;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}

/* 称号 chip：金调，属于「荣誉」，不能和主色混用 */
.titlechip {
  height: 50rpx;
  padding: 0 19rpx 0 15rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10rpx;
  border-radius: 25rpx;
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.92) 0%, rgba(201, 221, 196, 0.58) 100%);
  border: 2rpx solid rgba(95, 130, 160, 0.24);
  box-shadow: inset 0 2rpx 0 rgba(255, 255, 255, 0.90);
}

.titlechip-star {
  font-size: 19rpx;
  color: #33556F;
}

.titlechip-text {
  font-size: 22rpx;
  font-weight: 600;
  color: #2F4F66;
}

.chip-plain {
  height: 50rpx;
  padding: 0 19rpx;
  display: flex;
  align-items: center;
  border-radius: 25rpx;
  background: rgba(255, 255, 255, 0.42);
  border: 2rpx solid var(--tf-line-soft);
}

.chip-plain-text {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

/* ==========================================================================
   信誉环
   环色用「雾绿 → 深雾绿」的渐变而不是单一墨绿：墨绿在这套冷色里太重，
   会显得像另一套色板；渐变让环自己带一点光，才跟玻璃对得上。
   角度由 creditRingStyle 内联注入；background-color 是 conic-gradient
   不被支持时的兜底（老安卓 WebView），那时会退化成一个淡绿圆环。
   ========================================================================== */
.credit {
  position: relative;
  flex: none;
  width: 124rpx;
  height: 124rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: rgba(127, 166, 140, 0.20);
}

.credit::before {
  content: "";
  position: absolute;
  top: 12rpx;
  right: 12rpx;
  bottom: 12rpx;
  left: 12rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: inset 0 8rpx 23rpx rgba(31, 92, 172, 0.10);
}

.credit-in {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.credit-num {
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: #1C3D2E;
}

.credit-unit {
  margin-top: 2rpx;
  font-size: 17rpx;
  font-weight: 600;
  color: #3F7A58;
}

/* ==========================================================================
   三格统计
   ========================================================================== */
.stats {
  margin-top: 23rpx;
  display: flex;
  flex-direction: row;
  padding: 23rpx 8rpx;
  border-radius: var(--tf-r-md);
  background: rgba(255, 255, 255, 0.42);
  border: 2rpx solid var(--tf-line-soft);
}

.stat {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat + .stat::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8rpx;
  bottom: 8rpx;
  width: 2rpx;
  background: var(--tf-line-soft);
}

.stat-num {
  font-size: 35rpx;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--tf-text);
}

.stat-unit {
  margin-left: 2rpx;
  font-size: 19rpx;
  font-weight: 500;
  color: var(--tf-text-3);
}

.stat-label {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--tf-text-2);
}

/* ==========================================================================
   低信誉提示
   ========================================================================== */
.credit-tip {
  margin-top: 23rpx;
  padding: 21rpx 25rpx;
  border-radius: var(--tf-r-sm);
  background: rgba(176, 74, 74, 0.10);
  border: 2rpx solid rgba(176, 74, 74, 0.22);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 15rpx;
}

.credit-tip-text {
  flex: 1;
  font-size: 22rpx;
  line-height: 1.55;
  color: var(--tf-danger);
}

.credit-tip-link {
  flex: none;
  font-size: 22rpx;
  font-weight: 600;
  color: var(--tf-danger);
}

/* ==========================================================================
   模块行：整块一张玻璃，行与行之间用发丝线分隔
   ========================================================================== */
/* ==========================================================================
   三张便签纸
   --------------------------------------------------------------------------
   参考图：三张米黄便签错开摆放，每张顶部钉一个圆点，标题下有手绘虚线。
   三张左右交替缩进 + 轻微旋转，形成「摊在桌上」的错落感。
   ========================================================================== */
.notes {
  position: relative;
  margin-top: 42rpx;
  padding: 0 8rpx;
}

.note {
  position: relative;
  background: linear-gradient(168deg, #FEFAF0 0%, #FCF5E4 100%);
  border: 2rpx solid #EADFC6;
  border-radius: 20rpx;
  padding: 26rpx 24rpx 14rpx;
  box-shadow: 0 8rpx 22rpx rgba(150, 120, 70, 0.14);
}

/* 三张错开：左右交替缩进 + 反向旋转 */
.note--1 {
  transform: rotate(-1.6deg);
  margin-right: 40rpx;
}
.note--2 {
  transform: rotate(1.4deg);
  margin-left: 40rpx;
  margin-top: 22rpx;
}
.note--3 {
  transform: rotate(-1deg);
  margin-right: 56rpx;
  margin-top: 22rpx;
}

/* 图钉 */
.note::before {
  content: '';
  position: absolute;
  top: -10rpx;
  left: 50%;
  margin-left: -10rpx;
  width: 20rpx;
  height: 20rpx;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #FFF7DF 0%, #E9D2A6 62%, #D8BE8C 100%);
  box-shadow: 0 2rpx 6rpx rgba(150, 120, 70, 0.30);
}
.note--1::before {
  background: radial-gradient(circle at 34% 30%, #EAF3D6 0%, #C4D888 62%, #A8BE68 100%);
}
.note--2::before {
  background: radial-gradient(circle at 34% 30%, #FFF2C8 0%, #F9D038 62%, #DFB520 100%);
}
.note--3::before {
  background: radial-gradient(circle at 34% 30%, #EFE8FC 0%, #C9B8F0 62%, #A992DE 100%);
}

/* 标题：手绘虚线分隔 */
.note-title {
  display: block;
  font-size: 26rpx;
  font-weight: 800;
  color: #8A6A3A;
  letter-spacing: 0.02em;
  padding-bottom: 12rpx;
  border-bottom: 2rpx dashed #E0D2B4;
}

/* 入口行 */
.note-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 14rpx;
  padding: 16rpx 2rpx;
}
.note-item + .note-item {
  border-top: 1rpx dashed rgba(224, 210, 180, 0.55);
}
.note-item:active {
  opacity: 0.6;
}
.note-ico {
  width: 40rpx;
  height: 40rpx;
  flex: none;
}
.note-label {
  flex: 1;
  min-width: 0;
  font-size: 25rpx;
  font-weight: 700;
  color: #4A3F2E;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note-val {
  flex: none;
  font-size: 21rpx;
  font-weight: 700;
  color: #9A8560;
}

/* ==========================================================================
   旧的手绘纸卡堆叠（已废弃，保留兼容）
   --------------------------------------------------------------------------
   参考图是一摞米黄纸片、每张轻微歪斜、顶上钉个小圆点。
   实现：容器去掉白卡外壳 → 每行自己变成一张纸卡，交替旋转 + 轻微重叠。
   overflow 必须 visible，否则旋转的角会被裁掉。
   ========================================================================== */
.modlist {
  margin-top: 36rpx;
  padding: 0 6rpx;
  background: transparent;
  border: none;
  box-shadow: none;
  overflow: visible;
}

.mod {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 22rpx;
  padding: 24rpx 26rpx;
  /* 米黄纸张 + 手绘描边 */
  background: linear-gradient(168deg, #FEFAF0 0%, #FCF5E4 100%);
  border: 2rpx solid #EADFC6;
  border-radius: 22rpx;
  box-shadow: 0 6rpx 18rpx rgba(150, 120, 70, 0.13);
  /* 交替歪斜，像随手摊在桌上 */
  transform: rotate(-1.6deg);
  transition: transform 220ms cubic-bezier(0.34, 1.25, 0.5, 1);
}
.mod + .mod {
  /* 不重叠：重叠会让下一张的图钉被上一张盖住，参考图里每张的钉子都露着 */
  margin-top: 14rpx;
}
.mod:nth-child(even) {
  transform: rotate(1.8deg);
}
.mod:active {
  transform: rotate(0deg) scale(0.985);
}

/* 图钉：钉在纸卡上沿中间 */
.mod::before {
  content: '';
  position: absolute;
  top: -9rpx;
  left: 50%;
  margin-left: -9rpx;
  width: 18rpx;
  height: 18rpx;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #FFF7DF 0%, #E9D2A6 62%, #D8BE8C 100%);
  box-shadow: 0 2rpx 6rpx rgba(150, 120, 70, 0.28);
  z-index: 2;
}
/* 每张的钉子颜色错开一点，更像手工钉的 */
.mod:nth-child(3n+1)::before {
  background: radial-gradient(circle at 34% 30%, #EAF3D6 0%, #C4D888 62%, #A8BE68 100%);
}
.mod:nth-child(3n+2)::before {
  background: radial-gradient(circle at 34% 30%, #FFF2C8 0%, #F9D038 62%, #DFB520 100%);
}

.mod + .mod::before {
  content: "";
  position: absolute;
  left: 31rpx;
  right: 31rpx;
  top: 0;
  height: 2rpx;
  background: var(--tf-line-soft);
}

/* 图标托底：实色浅雾蓝 + 白边。三种色相的底用来区分模块类别，
   但都压在同一明度带上，不会变成彩虹。 */
.mod-ico {
  width: 76rpx;
  height: 76rpx;
  flex: none;
  padding: 9rpx;
  box-sizing: border-box;
  border-radius: 21rpx;
  background: rgba(31, 92, 172, 0.10);
  border: 2rpx solid var(--tf-line);
}

.mod-ico--mint { background: rgba(47, 125, 99, 0.12); }
.mod-ico--gold { background: rgba(127, 156, 180, 0.18); }

.mod-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.mod-title {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.mod-desc {
  margin-top: 4rpx;
  font-size: 21rpx;
  line-height: 1.4;
  color: var(--tf-text-2);
}

.mod-val {
  flex: none;
  font-size: 22rpx;
  font-variant-numeric: tabular-nums;
  color: var(--tf-text-2);
}

.chip-count {
  flex: none;
  min-width: 34rpx;
  height: 34rpx;
  padding: 0 10rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  font-size: 19rpx;
  font-weight: 700;
  color: #fff;
  background: var(--tf-primary);
}

.mod-arrow {
  flex: none;
  font-size: 30rpx;
  line-height: 1;
  color: var(--tf-text-3);
}

/* ==========================================================================
   管理员卡：唯一有权用红调的地方
   ========================================================================== */
.admincard {
  margin-top: 23rpx;
  padding: 29rpx 31rpx 23rpx;
  border-radius: var(--tf-r-lg);
  background-color: rgba(255, 255, 255, 0.72);
  border: 2rpx solid rgba(176, 74, 74, 0.22);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.admincard-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.admincard-title {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.admincard-count {
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  font-weight: 600;
  color: var(--tf-danger);
  background: rgba(176, 74, 74, 0.12);
}

.admincard-sub {
  display: block;
  margin-top: 10rpx;
  font-size: 21rpx;
  line-height: 1.55;
  color: var(--tf-text-2);
}

.admin-list {
  margin-top: 19rpx;
  display: flex;
  flex-direction: column;
}

.admin-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 19rpx 0;
  border-top: 2rpx solid var(--tf-line-soft);
}

.admin-item-text {
  font-size: 25rpx;
  color: var(--tf-text);
}

/* ==========================================================================
   未登录卡
   ========================================================================== */
.guestcard {
  margin-top: 23rpx;
  padding: 29rpx 31rpx;
  border-radius: var(--tf-r-lg);
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  display: flex;
  flex-direction: column;
}

.guestcard-hint {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

.btn {
  margin-top: 21rpx;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: #fff;
  background-color: var(--tf-primary);
  border: 2rpx solid rgba(255, 255, 255, 0.22);
  box-shadow: var(--tf-lift-sm);
}

/* ==========================================================================
   页脚
   ========================================================================== */
.footlinks {
  margin-top: 34rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 19rpx;
}

.link {
  font-size: 23rpx;
  color: var(--tf-primary);
}

.link--muted {
  color: var(--tf-text-3);
}

.link-sep {
  font-size: 23rpx;
  color: var(--tf-text-3);
}

/* ==========================================================================
   权限自检（调试用，默认折叠）
   ========================================================================== */
.diag {
  margin-top: 34rpx;
  padding: 19rpx 25rpx;
  border-radius: var(--tf-r-sm);
  background: rgba(255, 255, 255, 0.42);
  border: 2rpx solid var(--tf-line-soft);
}

.diag-toggle {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.diag-body {
  margin-top: 15rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.diag-line {
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
  word-break: break-all;
}

.diag-btn {
  margin-top: 10rpx;
  padding: 17rpx 0;
  border-radius: 999rpx;
  text-align: center;
  font-size: 23rpx;
  font-weight: 600;
  color: var(--tf-primary);
  background: var(--tf-primary-soft);
}

.diag-hint {
  margin-top: 8rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* ==========================================================================
   头像淡入
   --------------------------------------------------------------------------
   图片本身已经落在本地（common/avatar/avatarCache.js），不存在边下边画的过程；
   这里只负责「空圆 → 完整头像」这一次过渡，让切换页面时眼睛不跳。
   opacity 而不是 v-if：同一个节点一直在，不会引起布局抖动。
   ========================================================================== */
.ava-fade {
  opacity: 0;
  transition: opacity 160ms ease-out;
}

.ava-fade--in {
  opacity: 1;
}
</style>