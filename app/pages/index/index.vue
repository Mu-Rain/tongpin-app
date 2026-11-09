<template>
  <view class="page">
    <!-- ==================================================================
         首页 · 视觉块预算（文档 §3.1，共 7 块，超出必须删一个）
           1 身份行   2 活人信号   3 标题+同频胶囊   4 需求流
           5 分类贴纸  6 今日局提醒（条件出现）   7 主 CTA
         ------------------------------------------------------------------
         铁律（§1）：首页只有一个主角——搭子需求流（活人）。
         所以并列功能卡、今日同频大蓝卡、每日百科全部删除。
         ================================================================== -->

    <!-- [0] 头图：滚动时压缩到只剩标题（sticky）
         ------------------------------------------------------------------
         高度 300px → 64px，标题从 44px 居中缩到 19px 靠左，副标题淡出。
         数字卡用负 margin 压住它的下沿。
         ================================================================== -->
    <view class="hero">
      <!-- 云：两团柔白 -->
      <view class="cloud cl1" />
      <view class="cloud cl2" />

      <!-- 身份行 -->
      <view class="id-row hero-id">
        <!-- 头像：走 common/avatar/avatarCache.js，本地落盘 + 解码完成后整体淡入。
             没有可用链接就不挂 <image>，露出 .id-ava 自己的圆底 = 空圆占位；
             未登录仍然是「?」，那不是一个假头像。 -->
        <view class="id-ava">
          <image
            v-if="avaSrcOf('me')"
            class="id-ava-img ava-fade"
            :class="{ 'ava-fade--in': avaReadyOf('me') }"
            :src="avaSrcOf('me')"
            mode="aspectFill"
            @load="avaOnLoad('me')"
            @error="avaOnError('me', avatarInput)"
          />
          <text v-else-if="!userInfo" class="id-ava-tx">?</text>
        </view>
        <view class="id-badges" v-if="userInfo">
          <text class="id-badge" v-if="userInfo.schoolVerified">✓ 已认证</text>
          <text class="id-badge id-badge--credit">信誉 {{ userInfo.credit }}</text>
        </view>
      </view>

      <view class="hero-inner">
        <text class="hero-title">同频</text>
        <text class="hero-sub">找到同频搭子，把日常变有趣</text>
      </view>

      <!-- 云函数自检：缩成一个小圆，放在头图右上角（临时，后续删） -->
      <view class="selftest-dot" v-if="showSelfTest" @tap="runSelfTest">
        <text class="selftest-dot-tx">{{ testing ? '…' : '检' }}</text>
      </view>

      <!-- 标题行 + 发布入口（按钮移到标题下方，竖排） -->
      <view class="hero-sec">
        <view class="sec-cta" @tap="goPublish">
          <text class="sec-cta-plus">＋</text>
          <text class="sec-cta-tx">发布需求</text>
        </view>
        <view class="hero-sec-row">
          <text class="sec-title">正在找搭子</text>
          <text class="sync-pill" v-if="matchTotal > 0">{{ matchTotal }} 人和你同频</text>
        </view>
      </view>
    </view>

    <view class="stats" @tap="tapPaw">
      <view class="stat">
        <text class="stat-n">{{ matchTotal }}</text>
        <text class="stat-l">与我同频</text>
      </view>
      <!-- .stop 必须带：父容器 .stats 有 @tap="tapPaw"（摸猫动画），不挡会连带触发 -->
      <view class="stat stat--tap" hover-class="stat--hover" @tap.stop="goMyCards">
        <text class="stat-n">{{ myOpenCount }}</text>
        <text class="stat-l">我的需求</text>
      </view>
      <view class="stat" @tap.stop="goBuddies">
        <text class="stat-n">{{ myBuddyCount }}</text>
        <text class="stat-l">我的搭子</text>
      </view>
      <view class="stats-go" @tap.stop="goHall"><text class="stats-go-arw">→</text></view>
    </view>

    <!-- [5] 分类贴纸：横滑，只露 3.5 个 -->
    <scroll-view class="cats" scroll-x :show-scrollbar="false">
      <view class="cat-row">
        <view
          class="cat"
          v-for="cat in cats"
          :key="cat.key"
          :class="'cat--' + cat.key"
          @tap="goHall"
        >
          <text class="cat-name">{{ cat.name }}</text>
          <text class="cat-n" v-if="cat.n > 0">{{ cat.n }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- [2] 活人信号：一行灰字 + 呼吸绿点 -->
    <view class="live-row">
      <view class="live-dot" />
      <text class="live-text">{{ liveText }}</text>
    </view>

    <!-- [4] 需求流 · 收纳式
         ------------------------------------------------------------------
         初始：整摞贴在下方，每张只露上轮廓（像一叠卡）
         上滑：卡片依次「翻下去」，从露上边缘变成露下边缘，最后铺成正序列表
         实现：插值每张卡的绝对位置（stackTop → openTop），不是插值间距 ——
               间距插值改不了顺序，位置插值才能让第 1 张从底部滑到顶部。
         ================================================================== -->
    <view class="deck" :class="{ 'deck--scrolled': deckScrolled }" :style="deckVars">
      <view
        class="deal"
        v-for="(c, ci) in feed"
        :key="c._id"
        :style="cardStyles[ci]"
        @tap="openCard(c)"
      >
        <!-- 时间紧迫角标 -->
        <text class="urgent" v-if="urgentText(c)">{{ urgentText(c) }}</text>

        <view class="fc-head">
          <!-- 作者头像：逐卡用自己的 _id 当淡入 key（同屏十几张，一张就绪不能带动全屏）。
               v-else 是同样 72rpx 的空圆占位 —— 空间不能塌，否则名字会左移。 -->
          <image
            v-if="avaSrcOf(c._id)"
            class="fc-ava fc-ava-img ava-fade"
            :class="{ 'ava-fade--in': avaReadyOf(c._id) }"
            :src="avaSrcOf(c._id)"
            mode="aspectFill"
            lazy-load="true"
            @load="avaOnLoad(c._id)"
            @error="avaOnError(c._id, c.owner && c.owner.avatar_url)"
          />
          <view v-else class="fc-ava" />
          <view class="fc-who">
            <view class="fc-name-row">
              <text class="fc-name">{{ c.owner.nickname }}</text>
              <text class="fc-verified" v-if="c.owner.is_verified">已认证</text>
            </view>
            <text class="fc-meta">{{ c.owner.school || '同校' }} · 信誉 {{ c.owner.credit_score }}</text>
          </view>
          <!-- 同频度徽章：从「今日同频」大卡并到每张卡右上角（§3.2）。
               自己发的卡永远不显示：自己跟自己的标签必然重合，那个数字是噪声。
               云函数 card-list 已经把 is_mine 卡的 common_tag_count 置 0，
               这里再判一次是因为云函数要重新上传才生效，前端判了重编译就管用。 -->
          <view class="fc-sync" v-if="c.common_tag_count > 0 && !isMyCard(c)" @tap.stop="onSyncClick(c)">
            <text class="fc-sync-n">{{ c.common_tag_count }}</text>
            <text class="fc-sync-l">同频</text>
          </view>
        </view>

        <!-- 分档迷你标签（smart 档的 tier：同校 / 附近 / 城市 / 全站）：放在作者行下方、标题上方。
             右上角已经是「N 同频」徽章的地盘，压上去会互相抢；
             没有 tier 的卡片整行不渲染，卡片布局跟改动前完全一致。 -->
        <view class="fc-tier-row" v-if="c.tier_text">
          <text class="fc-tier" :class="'fc-tier--' + c.tier">{{ c.tier_text }}</text>
        </view>

        <text class="fc-title">{{ c.title }}</text>
        <text class="fc-desc" v-if="c.description">{{ c.description }}</text>

        <view class="fc-foot">
          <text class="fc-meta-item" v-if="c.location_name">{{ c.location_name }}</text>
          <text class="fc-dot" v-if="c.location_name && c.start_time">·</text>
          <text class="fc-meta-item" v-if="c.start_time">{{ fmtTime(c.start_time) }}</text>
        </view>
      </view>

    </view>

    <!-- 空态（§10.2）：一句邀请 + 一个动作，不甩锅用户 -->
    <view class="feed-empty" v-if="!feed.length && !feedLoading">
      <text class="fe-title">还没有人在找搭子</text>
      <text class="fe-sub">发一条试试，让全校看到你</text>
    </view>
    <view class="feed-loading" v-if="feedLoading && !feed.length">
      <text class="fl-text">正在看看谁在找搭子…</text>
    </view>

    <!-- [6] 我的今日局：有局才出现，无局时整块不存在 -->
    <view class="today-meet" v-if="todayMeet">
      <text class="tm-label">今天 19:30</text>
      <text class="tm-text">和小柚的{{ todayMeet.category_label || '自习' }}局</text>
      <text class="tm-go">›</text>
    </view>

    <!-- [7] 主 CTA：全屏唯一实色按钮 -->
    <!-- 连通性自检：只在开发环境渲染（打包发行版整段剔除） -->
    <view class="selftest" v-if="devTools">
      <text class="selftest-toggle" @tap="showSelfTest = !showSelfTest">
        {{ showSelfTest ? '▾' : '▸' }} 云函数连通性自检
      </text>

    </view>
  </view>

  <!-- 自定义 tabBar（pages.json 已开 custom: true） -->
  <custom-tab-bar />
</template>
<script>
import customTabBar from '@/custom-tab-bar/index.vue'
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

/* ==========================================================================
   需求流收纳式 · 几何常量（单位 rpx）
   --------------------------------------------------------------------------
   CARD_H     单卡高度
   STACK_GAP  堆叠时每张露出的高度。必须 < 卡片 padding-top，
              否则会露出下一张卡的内容（头像、标题），不是干净的「轮廓」
   OPEN_GAP   展开后的行距（必须 ≥ CARD_H，否则展开后还会重叠）
   ========================================================================== */

const CARD_H = 440
const STACK_GAP = 8
const DECK_GAP = 152
const OPEN_GAP = 456
import track from '@/utils/track.js'
// 「我的需求」上一次成功拿到的服务端数：home-summary 失败时的兜底（见 myOpenCount）
const OPEN_CARDS_KEY = 'home_open_cards_v1'
import devToolsOn from '@/common/dev-tools.js'
// 百科分类的库里存英文 key，展示要中文；新分类不写死会显示成空，所以留兜底
const ENC_CATEGORIES = {
  study: '学习',
  health: '健康',
  life: '生活',
  campus: '校园'
}

// 正文折叠阈值（字数）：三条 26rpx 正文在卡片宽度下大约一行 24 个字，
// 超过这个数才出现「展开」——没超还挂个「展开」等于点了一下没变化
const ENC_FOLD_LEN = 72

// 云函数没部署时 callFunction 会 reject，但网络卡住不会 reject：
// 加超时兜底，否则百科卡会永远停在「正在加载今日百科…」
const ENC_TIMEOUT_MS = 8000

// smart 分档的迷你标签文案。契约：tier = school / nearby / city / remote，
// distance_km 是公里数。
// remote = 服务端为了凑满一屏从全站补进来的卡，地理上不在我的同校 / 附近 / 城市，
// 所以老实标「全站」，不能标「城市」（标了用户去大厅「城市」档反而找不到它）。
// <1km 不显示「0.4km」——那个精度是假的，直接说「<1km」。
// 没有 tier（老接口 / 降级）返回空串，卡片上整行都不渲染，布局跟改动前一模一样。
function tierTextOf(tier, km) {
  if (tier === 'school') return '同校'
  if (tier === 'nearby') {
    const n = Number(km)
    if (!(n > 0)) return '附近'
    return '附近 · ' + (n < 1 ? '<1km' : n.toFixed(1) + 'km')
  }
  if (tier === 'city') return '城市'
  if (tier === 'remote') return '全站'
  return ''
}

export default {
  components: { customTabBar },
  // 头像淡入的公共时序（common/avatar/avatarCache.js），5 个页面共用同一份
  mixins: [avatarFadeMixin],
  data() {
    return {
      entries: [
        {
          key: 'buddy',
          icon: 'buddy',
          title: '搭子大厅',
          desc: '发布需求 · 找同频的人',
          day: '第 3 天'
        },
        {
          key: 'mybuddy',
          icon: 'tag',
          title: '我的搭子',
          desc: '给搭子起专属称呼',
          day: '第 6 天'
        }
      ],
      testing: false,
      // 调试工具（连通性自检 / 权限自检）只在开发环境出现。
      // 用 process.env.NODE_ENV 运行时判断：uni-app 的条件编译只认平台名（APP-PLUS/H5/…），
      // 没有 DEBUG 这个宏，写 #ifdef DEBUG 会被当成永假、连开发时也看不到。
      devTools: devToolsOn(),
      showSelfTest: false,
      testResult: '还没测过 —— 点上面的按钮，用来确认云函数能不能调通。',
      userInfo: null,
      // home-summary 现取的头像链接：老账号登录时本地 userInfo 里还没有 avatar_url 字段，
      // 只靠缓存的话要重新登录一次才显形，所以这里再兜一层。
      myAvatarUrl: '',

      // —— 需求流（文档 §3.1 第 4 块，首页唯一主角）——
      feed: [],
      feedLoading: false,
      // 这一屏没有任何同校档的卡片（同校没人 / 未认证）。只用来决定 liveText
      // 要不要说明原因，不是数据源（数据源永远是 this.feed）。
      feedFallback: false,
      /* 收纳式进度：0 = 整摞叠着（露上轮廓），1 = 完全铺开成列表。
         全页滚动里唯一逐帧变化的响应式值：它只落到 .deck 的一个 CSS 变量 --deck-p 上，
         卡片位移/缩放和容器高度都由 CSS 的 calc() 推导（见 style 的 .deck / .deal），
         JS 不再逐张改样式 —— 之前每帧要 diff 10 个内联 style 加 height/marginTop。 */
      deckP: 0,
      /* 上方留白是否收起：滚动超过 0.5px 变 true。
         留白不再逐像素算，只剩这一个布尔态；收起/恢复交给 CSS transition
         （见 style 的 .deck--scrolled），只在过阈值时写一次。 */
      deckScrolled: false,
      /* 静止时的留白高度（px，= DECK_GAP 152rpx），onLoad 里 rpx→px 换一次 */
      deckGapMax: 0,
      /* 点数字卡时，猫伸爪碰一下 */
      pawTapping: false,
      // 我的今日局：后端没有专门接口前保持 null，模板里 v-if 会自动整块消失，
      // 符合文档「无局时该区块完全不存在」的要求
      todayMeet: null,

      // 今天跟我同频的人数（card-list 返回的 matched_total，服务端已按全量候选算好）。
      // 唯一数据源：只有 fetchFeed 写它，别处不要再发请求覆盖（两处同时写谁后返回谁生效，是竞态）。
      // null = 还没拿到 / 拿不到（未登录、请求失败、或我还没选标签）；
      // 0 = 服务端确认真的没人，跟 null 语义不同，模板里分开处理。
      matchedTotal: null,

      // 当前筛选下的卡片总数（card-list 的 total）：活人信号的兜底数据源。
      // 跟 matchedTotal 是两件事——那个是「和我标签有重合的人数」，没选标签的账号拿到 null，
      // 拿它说人数会让那个号丢掉数字；total 任何登录账号都有值。
      // 但它数的是「条」不是「人」：同一个人发 3 条需求就是 3，说成「3 人」是错的，
      // 所以只在 peopleTotal 拿不到时才拿它兜底。
      feedTotal: null,

      // 候选人数（card-list 的 people_total，服务端按 owner_id 去过重）：活人信号优先用它。
      // 跟 feedTotal 只差一个字——条 vs 人：feedTotal 是卡片条数，这个才是真的「几个人在找」。
      // null = 算不出来（候选超过扫描上限 / 接口没给），此时退回 feedTotal，
      // 两个都没有才用泛化文案。null 不能当 0 用，那是两回事。
      peopleTotal: null,

      // 首页数字卡的「我的需求 / 我的搭子」，来自 home-summary 云函数。
      // null = 不知道（未登录 / 接口没部署 / 算不出来），模板按 null 隐藏该格；
      // 0 = 服务端确认真的是 0。两者语义不同，不能拿 0 凑数。
      myOpenCards: null,
      myBuddyRaw: null,

      /* —— tab 切换的调度与去重状态（见 onShow / scheduleTabLoad）——
         nativeTabHidden：原生 tabBar 藏过就不再藏 —— 藏一次画面就对，重复调是白跑原生布局。
         tabLoadTimer：连点 tab 时后一次调度覆盖前一次，不让几批请求排队。
         feedPending / summaryPending：「在飞期间又进过页面」的脏标记，回来后按需补一次。
         tabShowCount / tabDedupCount：只做计数，验收时用来证明「连点没有重复发请求」。 */
      nativeTabHidden: false,
      tabLoadTimer: null,
      feedPending: false,
      summaryLoading: false,
      summaryPending: false,
      tabShowCount: 0,
      tabDedupCount: 0,

      // 每日百科四态（契约 §5）：loading / data / empty / fallback。
      // 用单个状态机而不是几个布尔量，模板里只判一次，不会出现两态同时为真
      encState: 'loading',
      encTitle: '',
      encBody: '',
      encCategory: '',
      encDate: '',
      encExpanded: false,
      // src === 'latest'：内容是最近的往期，不是今天这条。
      // 标出来是为了不把旧内容冒充成今天的（§3.5）
      encIsPast: false
    }
  },
  computed: {
    greeting() {
      const h = new Date().getHours()
      if (h < 6) return '夜深了'
      if (h < 12) return '早上好'
      if (h < 18) return '下午好'
      return '晚上好'
    },
    /* 头像链接：本地缓存优先，没有再吃 home-summary 现取的那份。
       两者都是空串就不挂 avatar 图，露出 .id-ava 自己的圆底 = 空圆占位（不塞默认头像图、不塞昵称首字）
       —— 空串是「没有」，不是「坏的链接」。 */
    avatarUrl() {
      return (this.userInfo && this.userInfo.avatar_url) || this.myAvatarUrl || ''
    },

    /* 头像的「稳定键」：临时链接每次换一次签名，用它当缓存键等于永远不命中。
       有 fileID 就优先 fileID；自带头像（/static/avatars/...）本身就是路径。 */
    avatarInput() {
      const u = this.userInfo || {}
      const raw = String(u.avatar || '')
      if (raw) return raw
      return String(this.avatarUrl || '')
    },

    // 顶部问候语带上昵称；没登录就退回默认
    helloText() {
      if (this.userInfo && this.userInfo.nickname) {
        return this.greeting + '，' + this.userInfo.nickname
      }
      return this.greeting
    },

    // 深夜胶囊对应的 isLateNight 已随入口一起收起（2026-11-01）。恢复入口时把它加回来：
    // isLateNight() { const h = new Date().getHours(); return h >= 23 || h < 5 }

    // 活人信号文案：说「有多少人在找搭子」，不说「有 0 人」。
    // 优先 peopleTotal —— 服务端已按人去重，口径才对得上「人」这个字；
    // 它算不出来时退回 feedTotal（条数，数字会偏高，但比不给数字强）；
    // 两个都没有（未登录 / 接口没部署）才用泛化文案。
    // 不用 matchedTotal：它的语义是「和我标签有重合的人数」，没设标签就是 null。
    liveText() {
      // 这一屏没有同校档时先说清为什么：不然用户看到附近 / 城市的人，
      // 会以为自己学校填错了。口径跟着 smart 分档走 —— 候选池是
      // 同城 → 同校补 → 全站补位，所以这里要把「全站」也说上（补位卡现在标「全站」）。
      const head = this.feedFallback ? '同校还没有，先看附近、城市和全站 · ' : ''
      if (this.peopleTotal !== null && this.peopleTotal > 0) {
        return head + '此刻 ' + this.peopleTotal + ' 人正在找搭子'
      }
      if (this.feedTotal !== null && this.feedTotal > 0) {
        return head + '此刻 ' + this.feedTotal + ' 人正在找搭子'
      }
      return head + '此刻有人正在找搭子'
    },

    /* 每张卡的几何参数，只在 feed 变化时算一次 —— 滚动时完全不重算。
       以前这里吃 deckP：滚动每帧重算 10 个对象、模板逐张 diff transform，
       是卡顿的主要来源。
       现在只交给 CSS 三个静态变量，插值全在 CSS 里做（见 .deal 的 transform）：
         --st 堆叠时的位移 / --op 展开后的位移 / --sc 缩放斜率（i * 0.022）
       展开比例统一读容器上的 --deck-p，所以这三个值不随滚动变。 */
    cardStyles() {
      const n = this.feed.length
      if (!n) return []
      const out = []
      for (let i = 0; i < n; i++) {
        // 起点：底部锚定（第 0 张在最下）；终点：顶部排列（第 0 张在最上）
        const stackTop = uni.upx2px(STACK_GAP * (n - 1 - i))
        const openTop = uni.upx2px(OPEN_GAP * i)
        // 堆叠时后面的卡缩小更明显（0.012 → 0.022）—— 只靠阴影分不出层次
        out.push({
          '--st': stackTop.toFixed(1) + 'px',
          '--op': openTop.toFixed(1) + 'px',
          '--sc': (i * 0.022).toFixed(4),
          zIndex: n - i
        })
      }
      return out
    },



    /* 我发布的、还在进行中的需求数。
       优先用服务端的全量数（home-summary 的 my_open_cards）。
       接口没部署 / 失败时退回**上一次成功拿到的数**（写进 storage 的 home_open_cards_v1）——
       不能再退回「本地 feed 里数 is_mine」：card-list 从这一版起不下发自己的卡到首页，
       那个数会恒为 0，等于把这一格打成假的 0。 */
    myOpenCount() {
      if (typeof this.myOpenCards === 'number') return this.myOpenCards
      try {
        const cached = uni.getStorageSync(OPEN_CARDS_KEY)
        return typeof cached === 'number' ? cached : 0
      } catch (e) {
        return 0
      }
    },

    /* 我的搭子数（home-summary 的 my_buddy_count，active 状态的关系数）。
       拿不到时返回 0，模板判 >0 才显示，不会出现「0 个搭子」这种负面展示。 */
    myBuddyCount() {
      return typeof this.myBuddyRaw === 'number' ? this.myBuddyRaw : 0
    },

    /* 容器上的 CSS 变量集合（模板 :style="deckVars"）。
       --h0 堆叠高度 / --dh 展开增量 / --deck-gap 静止留白：只在 feed 变化、onLoad 后重算；
       --deck-p 是滚动里唯一逐帧变的那一个。
       高度必须跟着 p 变，否则展开后卡片会溢出容器、压到下面的分类贴纸；
       但「怎么变」不再由 JS 算，而是 CSS：calc(--h0 + --dh * --deck-p)。 */
    deckVars() {
      const n = this.feed.length
      const stackH = n ? uni.upx2px(STACK_GAP * (n - 1) + CARD_H) : 0
      const openH = n ? uni.upx2px(OPEN_GAP * (n - 1) + CARD_H) : 0
      return {
        '--h0': stackH.toFixed(1) + 'px',
        '--dh': (openH - stackH).toFixed(1) + 'px',
        '--deck-gap': this.deckGapMax.toFixed(1) + 'px',
        '--deck-p': this.deckP.toFixed(4)
      }
    },

    // 同频人数胶囊用（模板里判 >0 才显示，0 不裸展示）
    matchTotal() {
      return this.matchedTotal || 0
    },

    // 分类贴纸：四类，带实时人数角标（0 不显示）
    cats() {
      const c = {}
      this.feed.forEach(x => {
        const k = x.type || x.category || 'other'
        c[k] = (c[k] || 0) + 1
      })
      return [
        { key: 'study',  name: '自习', n: c.study || 0 },
        { key: 'sport',  name: '健身', n: c.sport || 0 },
        { key: 'meal',   name: '干饭', n: c.meal || 0 },
        { key: 'play',   name: '玩乐', n: c.play || 0 }
      ]
    },

    // 今日同频的主卡副文案：有真数字说真数字，没有就退回改动前的说法，绝不编。
    // 三种"没有数字"的处境分开处理：算不出来（null）→ 不声称今天没人；
    // 真的算完是 0 → 如实说没有人并给出路；拿到数 → 说人数。
    matchMetaText() {
      if (this.matchedTotal !== null && this.matchedTotal > 0) {
        return '今天有 ' + this.matchedTotal + ' 个人跟你同频'
      }
      if (this.matchedTotal === 0) return '今天还没有同频的人，发一条试试'
      if (this.userInfo && this.userInfo.school) return '都在' + this.userInfo.school
      return '登录后就能看到今天谁跟你同频'
    },

    // ---- 每日百科（以下四个都是从 encState + 三个原始字段推出来的展示值）----
    // 折叠后的正文；class 里再用 -webkit-line-clamp 截成 3 行
    encFolded() {
      return !this.encExpanded && this.encCanFold
    },
    // 只有真的超长才给「展开」：没超还挂一个，点了没变化，像坏了
    encCanFold() {
      return this.encBody.length > ENC_FOLD_LEN
    },
    encCategoryText() {
      const key = this.encCategory
      if (!key) return ''
      return ENC_CATEGORIES[key] || '百科'
    },
    // 日期只显示到月日：卡片上写全年年份对小屏是浪费，年份在标题语境里没信息
    encDateText() {
      const s = this.encDate
      if (!s) return ''
      return s.length >= 10 ? s.slice(5) : s
    }
  },
  onLoad() {
    // rpx→px 只在这里换一次：滚动里每帧都调 uni.upx2px 要过桥，没必要
    this.deckGapMax = uni.upx2px(DECK_GAP)
    // 需求流：每次进页面都刷新（活人信号要新）
    this.fetchFeed()
    // 百科保留调用（页面已不展示，但接口逻辑留着，方便以后放到别处）
    this.loadEnc()
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
    // 每次进页面都刷一次本地用户信息（登录/注册后会写这个 key）。
    // 这一句留在同步路径：纯 storage 读，模板第一帧的头像/昵称就要用它。
    const info = uni.getStorageSync('userInfo')
    this.userInfo = info || null
    // ★ 网络请求移出同步路径（判据见 scheduleTabLoad）。原来这里直接 fetchFeed() +
    //   loadHomeSummary()，两条云函数请求的初始化会和「页面首次渲染」挤在同一帧里 ——
    //   点 tab 时看到的那一下卡顿，就是这一帧被拉长的。
    this.scheduleTabLoad()
    // ★ 通知自定义 tabBar 重新读栈顶 route。
    // switchTab 后 tab 页会被缓存，组件不会重新 mounted，不广播的话滑块会停在别的 tab 上。
    // 这条留在同步路径：它只是往已有组件派一个事件，跟网络无关，延后反而让滑块慢一拍。
    try { uni.$emit('tfTabShow') } catch (e) {}
  },
  /* 页面滚动驱动收纳式展开。
     用 onPageScroll 而不是 scroll-view：首页是页面级滚动，
     套一层 scroll-view 反而要自己算高度、还要处理 tabBar 遮挡。
     改后每帧最多写一个响应式值：deckP → .deck 上的 CSS 变量 --deck-p。
     卡片位移/缩放、容器高度全部由 CSS 的 calc(var(--deck-p)) 推导，
     JS 不再遍历 feed，也不再写 height / marginTop。 */
  onPageScroll(e) {
    const y = e.scrollTop
    if (!this.feed.length) return

    /* 留白收起：滑出 1px 就切 class，逐像素的收放交给 CSS transition。
       这是本函数里唯一不跟帧走的写操作 —— 只在阈值穿过时写一次。 */
    const scrolled = y > 0.5
    if (scrolled !== this.deckScrolled) this.deckScrolled = scrolled

    /* 卡片堆：从 20px 开始展开，到 160px 铺满
       —— 头图固定 300px 后页面可滚距离只有 160 左右，区间必须压在这个范围内。
       0.0005 只是 scrollTop 抖动防抖，不是原来的 0.008 节流：
       每帧代价已经降到 1 个变量，没必要再用粗阈值换帧率。 */
    const p = Math.min(1, Math.max(0, (y - 20) / 140))
    if (Math.abs(p - this.deckP) < 0.0005) return
    this.deckP = p
  },

  /* 头像绑定。feed 用 deep：卡片是整批替换的，但 owner.avatar_url 可能后到（home-summary 补齐）；
     immediate 是为了首帧：userInfo / feed 往往在 data 初始化之前就从 storage 填好了。 */
  watch: {
    avatarInput: {
      immediate: true,
      handler(v) {
        this.avaBind('me', v)
      }
    },
    feed: {
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
  onReady() {
    // 首页已经画好，这时才关原生启动图：启动图 → 首页之间不会有一帧白屏
    // （manifest 里 splashscreen.autoclose 设成了 false）
    try {
      if (typeof plus !== 'undefined' && plus.navigator && plus.navigator.closeSplashscreen) {
        plus.navigator.closeSplashscreen()
      }
    } catch (e) {
      // 关不掉不影响业务，App.vue 里还有 4 秒兜底
    }
  },

  methods: {
    /* tab 显示后的请求调度：首帧与网络解耦。
       ------------------------------------------------------------------
       为什么不在 onShow 里直接发：onShow 和「页面首次渲染」在同一个同步任务里，
       云函数调用的初始化（uniCloud 桥 + 请求对象 + storage 读）会挤进首帧那一帧，
       切 tab 时的那一下停顿就是这一帧被拉长的。
       默认做法：让出当前帧 —— $nextTick 保证首帧已提交，再 setTimeout(30) 给渲染
       管线留一帧余量，之后才发请求。
       例外（立刻发）：页面还是空的、本地也没有任何可显示数据。这时延后只是让用户
       多看 30ms 的空白，收益是负的。本页判据：
         feed 有卡 或 home-summary 已经成功拉过一次（myOpenCards !== null）
         → 有东西可画 → 30ms；两者都不成立 → 首次进入的空页面 → 0ms（让出首帧，但不多等）。
       去重不在这里做：fetchFeed / loadHomeSummary 各自带在飞标记。 */
    scheduleTabLoad() {
      const run = () => {
        this.fetchFeed()
        this.loadHomeSummary()
      }
      const hasData = (this.feed && this.feed.length > 0) || this.myOpenCards !== null
      // 有东西可画 → 30ms，给渲染管线留一帧余量；完全是空页面 → 0ms。
      // 0ms 不等于「同步发」：它照样是一个宏任务，首帧会先提交，用户几乎察觉不到，
      // 但网络初始化就不会再挤进首帧那一帧 —— 这正是「首次进入应用后切 tab 卡」的场景。
      const delay = hasData ? 30 : 0
      // 连点 tab 会有多次调度：只保留最后一个，避免几批请求排队发出
      if (this.tabLoadTimer) clearTimeout(this.tabLoadTimer)
      this.$nextTick(() => {
        // 同一个 tick 里连点两次会注册两个 nextTick 回调：先清掉前一个定时器再设，
        // 保证最终只剩一个待执行的调度（否则两个定时器会几乎同时发出两批请求）
        if (this.tabLoadTimer) clearTimeout(this.tabLoadTimer)
        this.tabLoadTimer = setTimeout(() => {
          this.tabLoadTimer = null
          run()
        }, delay)
      })
    },

    /* ==================== 需求流（文档 §3.1 第 4 块）====================
       首页唯一主角。复用搭子大厅的 card-list 接口，取前 10 条；
       同校不够 10 条（或只有自己发的卡）时用全站补足，避免「发完需求首页只剩自己」。
       ================================================================= */
    /* 首页数字卡：我的需求 / 我的搭子。
       单独一个请求而不是塞进 fetchFeed —— 两者没有依赖关系，一个慢/挂不该拖另一个，
       而且这个接口只读聚合，很轻。失败就保持 null（那两格不显示），首页其他部分照常。 */
    async loadHomeSummary() {
      /* ★ 在飞去重：上一次 home-summary 还没回来时又进了页面（快速连点 tab），
         不再发第二条，只登记「回来后再补一次最新数据」。
         改成 async/try-finally 是为了让这条在飞标记在任何出口（含 code!==0 的提前
         return）都能被复位 —— 挂在 .then 链尾部复位，那条 return 会把它漏掉，
         标记一旦卡死，这一格数字就再也不会刷新了。 */
      if (this.summaryLoading) {
        this.summaryPending = true
        this.tabDedupCount++
        return
      }
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.myOpenCards = null
        this.myBuddyRaw = null
        this.myAvatarUrl = ''
        return
      }
      this.summaryLoading = true
      try {
        const res = await uniCloud.callFunction({ name: 'home-summary', data: { token } })
        const r = (res && res.result) || {}
        const d = r.data || {}
        if (r.code !== 0) return
        this.myOpenCards = typeof d.my_open_cards === 'number' ? d.my_open_cards : null
        // 落一份到本地：home-summary 挂了时数字卡还能显示上一次的数，不掉成 0
        if (typeof this.myOpenCards === 'number') {
          try { uni.setStorageSync(OPEN_CARDS_KEY, this.myOpenCards) } catch (e) { /* 存储满/被禁只影响兜底 */ }
        }
        this.myBuddyRaw = typeof d.my_buddy_count === 'number' ? d.my_buddy_count : null
        // 契约：换不出来是空串，空串就当没有
        this.myAvatarUrl = typeof d.my_avatar_url === 'string' ? d.my_avatar_url : ''
        // 顺手写回本地 userInfo：不然老账号要重新登录一次才看到头像
        if (this.myAvatarUrl) {
          try {
            const old = uni.getStorageSync('userInfo')
            if (old && typeof old === 'object') {
              const merged = Object.assign({}, old, { avatar_url: this.myAvatarUrl })
              uni.setStorageSync('userInfo', merged)
              this.userInfo = merged
            }
          } catch (e) {
            // 存储写失败不影响这次显示，下次进来重新取一遍就行
          }
        }
      } catch (e) {
        // 云函数没部署时静默：这两格保持隐藏，用户看到的只是「没有这两格」，
        // 不会看到假的 0
      } finally {
        this.summaryLoading = false
        if (this.summaryPending) {
          this.summaryPending = false
          // 补发一次最新数据：补发走的还是本函数，所以不会自激
          setTimeout(() => this.loadHomeSummary(), 0)
        }
      }
    },

    /* 需求流：一次请求就够。
       云函数 smart 档已经按「同校 → 附近 → 城市」分好档，每条带 tier 与 distance_km ——
       前端不再自己拼「先 school 再 all 合并去重」那套：那套要发两次请求、要在两个
       返回之间做合并，等待翻倍，还多出一段必出 bug 的逻辑。 */
    async fetchFeed() {
      // ★ 在飞去重：上一次 card-list 还在飞时又进页面了（快速连点 tab），
      //   不再发第二条 —— 只登记「回来后再补一次最新数据」。
      if (this.feedLoading) {
        this.feedPending = true
        this.tabDedupCount++
        return
      }
      this.feedLoading = true
      try {
        const PAGE = 10
        const res = await uniCloud.callFunction({
          name: 'card-list',
          data: {
            token: uni.getStorageSync('token') || '',
            type: 'all',
            scope: 'smart',
            page: 1,
            page_size: PAGE
          }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          // 只有接口真报错才清空列表：拿一次失败去盖掉上一屏还能看的数据，比空列表更糟
          this.feed = []
          this.feedFallback = false
          this.matchedTotal = null
          this.peopleTotal = null
          this.feedTotal = null
          uni.showToast({ title: r.msg || '加载失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        // 分档标签文案在这里一次算好，模板里不再每个卡片调一次方法（滚动时每帧都调）
        this.feed = (d.list || []).slice(0, PAGE).map((c) => {
          c.tier_text = tierTextOf(c.tier, c.distance_km)
          return c
        })
        // 同频人数只认这一处：是数字就用，null / 缺字段一律回落 null。
        // 这里必须显式赋值而不是"没有就跳过"——否则退出登录后还挂着上次的数字，
        // 旧数字比没数字更误导（模板判 >0 才显示）
        this.matchedTotal = typeof d.matched_total === 'number' ? d.matched_total : null
        // 活人信号首选去重后的人数；同样必须显式赋 null
        this.peopleTotal = typeof d.people_total === 'number' ? d.people_total : null
        // 兜底用 total：当前筛选下的卡片条数，跟标签无关，任何账号都是数字
        this.feedTotal = typeof d.total === 'number' ? d.total : null
        // 这一屏一条同校档都没有（同校没人 / 未认证）：活人信号要说清
        // 「你看到的是附近和城市」，不然用户以为自己学校填错了
        this.feedFallback = !this.feed.some((c) => c.tier === 'school')
        // 兜底：一屏都凑不满（同城 + 同校都没人发，校园冷启动）时补一次全站
        // （card-list scope='all'）。
        // 分档搬到云函数以后，这里只剩这条保险 —— 用户换到冷门学校/城市时
        // 首页不能只剩自己那一条。补进来的卡带真实 tier（同校 / 附近 / 城市 / 全站），
        // 标签行照常渲染，不再一律标成「城市」。
        if (this.feed.length < 5) {
          const res2 = await uniCloud.callFunction({
            name: 'card-list',
            data: {
              token: uni.getStorageSync('token') || '',
              type: 'all',
              scope: 'all',
              page: 1,
              page_size: PAGE
            }
          })
          const d2 = ((res2 && res2.result) || {})
          if (d2.code === 0 && d2.data) {
            const have = {}
            this.feed.forEach((c) => {
              have[c._id] = true
            })
            ;(d2.data.list || []).forEach((c) => {
              if (have[c._id]) return
              have[c._id] = true
              c.tier_text = tierTextOf(c.tier, c.distance_km)
              this.feed.push(c)
            })
            this.feed = this.feed.slice(0, PAGE)
            // 屏幕上已经是全站内容，活人信号也换成全站的，别让数字和列表互相打架
            if (typeof d2.data.people_total === 'number') this.peopleTotal = d2.data.people_total
            if (typeof d2.data.total === 'number') this.feedTotal = d2.data.total
          }
        }
      } catch (e) {
        // 云函数没部署 / 断网：保留上一屏，别把首页刷成空白（空态会接管首屏）
      } finally {
        this.feedLoading = false
        if (this.feedPending) {
          this.feedPending = false
          // 在飞期间又进过页面：补一次，保证刷到的是最新一屏（补发同样先判在飞）
          setTimeout(() => this.fetchFeed(), 0)
        }
      }
    },

    /* 时间格式化：今天/明天用相对说法，其余显示月日 */
    fmtTime(t) {
      if (!t) return ''
      const d = new Date(t)
      if (isNaN(d.getTime())) return ''
      const now = new Date()
      const sameDay = d.toDateString() === now.toDateString()
      const tm = new Date(now.getTime() + 86400000)
      const isTm = d.toDateString() === tm.toDateString()
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      if (sameDay) return '今天 ' + hh + ':' + mm
      if (isTm) return '明天 ' + hh + ':' + mm
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hh + ':' + mm
    },

    /* 时间紧迫角标（文档 §3.2 要求）：
       只在 3 小时内要开始时才显示，否则满屏都是角标就失去意义 */
    urgentText(c) {
      if (!c.start_time) return ''
      const d = new Date(c.start_time)
      if (isNaN(d.getTime())) return ''
      const diff = d.getTime() - Date.now()
      if (diff <= 0) return ''
      const h = diff / 3600000
      if (h <= 1) return Math.max(1, Math.round(diff / 60000)) + ' 分钟后发车'
      if (h <= 3) return Math.round(h) + ' 小时后发车'
      return ''
    },

    /* 这张卡是不是我自己发的：两个判据任一成立就算（云函数的 is_mine
       依赖 created_at，老数据可能缺；owner._id 跟本地登录用户比最直接） */
    isMyCard(c) {
      if (!c) return false
      if (c.is_mine) return true
      const me = this.userInfo
      return !!(me && me._id && c.owner && c.owner._id === me._id)
    },

    /* 埋点：同频度徽章独立成点击区（.stop 挡住外层 .feed-card 的 @tap），
       点它只记一次 sync_click，不再跳详情页。 */
    onSyncClick(c) {
      track('sync_click', { card_id: c._id })
    },
    /* 点数字卡 → 猫伸爪碰一下再收回。
       先置 false 再置 true，保证连点也能重新触发动画。 */
    tapPaw() {
      this.pawTapping = false
      this.$nextTick(() => {
        this.pawTapping = true
        clearTimeout(this._pawTimer)
        this._pawTimer = setTimeout(() => {
          this.pawTapping = false
        }, 700)
      })
    },

    openCard(c) {
      uni.navigateTo({ url: '/pages/detail/detail?id=' + c._id })
    },

    // hall 不在 pages.json 的 tabBar 里（只有 index / feed / messages / mine 四页），
    // switchTab 跳非 tab 页会直接失败且没有报错，数字卡那个箭头按钮因此点不动 ——
    // 必须用 navigateTo（本文件进 hall 的其它入口也是这么写的）
    goHall() {
      uni.navigateTo({ url: '/pages/hall/hall' })
    },

    // buddy 不在 tabBar 里，只能 navigateTo；父容器 .stats 有 @tap="tapPaw"（摸猫动画），所以必须 .stop
    goBuddies() {
      uni.navigateTo({ url: '/pages/buddy/buddy' })
    },

    /* 数字卡「我的需求」→ 我的需求页。
       自己的卡从这一版起不在首页显示了（card-list 排除掉了自己发的卡），
       统一收在这个页面里看，含已找到搭子 / 已关闭的。 */
    goMyCards() {
      uni.navigateTo({ url: '/pages/my-cards/my-cards' })
    },

    goPublish() {
      uni.navigateTo({ url: '/pages/publish/publish' })
    },

    /* 进 AI 情绪引导会话：深夜问候变体和消息页入口都走这里 */
    goAi() {
      // 埋点：首页只有深夜问候胶囊这一个 AI 入口，entry 固定 greeting
      track('ai_entry_click', { entry: 'greeting' })
      // 参数名必须和 chat.vue 对齐：它只认 options.conversation_id，isAi 判的是 conversationId === 'ai'
      // （messages.vue 也是这个写法）。原来这里传 ?ai=1，进去会因为 conversationId 为空而弹「会话参数缺失」。
      uni.navigateTo({ url: '/pages/chat/chat?conversation_id=ai' })
    },

    /**
     * 拉今日百科（契约 §2）：入参为空，**不传 token** —— 首页未登录也要能看。
     * 失败一律静默降级成改造前的静态占位：不弹红、不留 loading、不白屏。
     */
    async loadEnc() {
      this.encState = 'loading'
      this.encExpanded = false
      // 每次进来先复位：上一趟若是往期，这一趟拿到今天的内容不能还挂着「往期」
      this.encIsPast = false

      // H5 端 uniCloud 不存在，直接降级，免得在浏览器里看时报红
      if (typeof uniCloud === 'undefined') {
        this.encState = 'fallback'
        return
      }

      let timer = null
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), ENC_TIMEOUT_MS)
      })

      try {
        // 第二个参数把 reject 收成 null：超时先到之后请求才失败时，
        // 那个 rejection 没人接会变成 unhandledRejection，控制台上红一下
        const req = uniCloud.callFunction({ name: 'encyclopedia-daily', data: {} }).then(
          (r) => r,
          () => null
        )
        const res = await Promise.race([req, timeout])
        // 超时先到：内容没回来就等于没有，降级成静态占位
        if (!res) {
          this.encState = 'fallback'
          return
        }
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          this.encState = 'fallback'
          return
        }
        const d = r.data || {}
        const item = d.item || null
        // 只有一条都没有（src==='none'，云函数回 item:null）才算「今天没更新」。
        // src==='latest' 是「今天没有、但有条旧文」：照样显示，靠下面的 encIsPast
        // 挂「往期」标，把「这是旧文」说清楚，而不是藏起来（§3.5 覆盖原 §5 的那句）
        if (!item) {
          this.encState = 'empty'
          return
        }
        this.encTitle = item.title || ''
        this.encBody = item.content || ''
        this.encCategory = item.category || ''
        this.encDate = item.publish_date || ''
        // seed 灌的演示数据 publish_date 是空串，daily 按「最近一条」回落成 latest；
        // 不标往期就成了拿旧文冒充今天
        this.encIsPast = d.src === 'latest'
        this.encState = 'data'
      } catch (e) {
        // 函数没部署 / 网络不通：静默降级，绝不把错误抛到界面上
        this.encState = 'fallback'
      } finally {
        if (timer) clearTimeout(timer)
      }
    },

    toggleEnc() {
      this.encExpanded = !this.encExpanded
    },

    // 整卡可点进百科列表（docs/26 §2.5 方案 A）；「展开」用 .stop 拦住冒泡，
    // 否则点展开会顺带跳页，用户就看不成全文了
    goEncyclopedia() {
      uni.navigateTo({ url: '/pages/encyclopedia/encyclopedia' })
    },

    onEntry(item) {
      // 已经做好的模块直接跳，其余还没到日子，先弹提示。
      // 注意：「消息」和「我的」现在是底部 tabBar 的固定入口，
      // 这里不再重复放，所以也去掉了对应的分支。
      if (item.key === 'buddy') {
        uni.navigateTo({ url: '/pages/hall/hall' })
        return
      }
      if (item.key === 'mybuddy') {
        uni.navigateTo({ url: '/pages/buddy/buddy' })
        return
      }
      uni.showToast({
        title: item.title + '：' + item.day + '接入',
        icon: 'none'
      })
    },

    // 退出登录：清本地 token 回登录页
    onLogout() {
      uni.showModal({
        title: '退出登录',
        content: '确定要退出吗？',
        success: (r) => {
          if (!r.confirm) return
          uni.removeStorageSync('token')
          uni.removeStorageSync('userInfo')
          // 必须一起清掉 autoLogin，否则回到登录页时
          // 那个「检测到已登录」的快捷入口还会显示出来
          uni.removeStorageSync('autoLogin')
          this.userInfo = null
          uni.reLaunch({ url: '/pages/login/login' })
        }
      })
    },

    goLogin() {
      uni.reLaunch({ url: '/pages/login/login' })
    },

    /**
     * 连通性自检（M0 验收）
     * 调用云函数 hello，能拿到返回值 = 服务空间关联成功、云函数部署成功、App 能联网。
     * 失败会把原因写在按钮下面，方便直接截图排查。
     */
    async runSelfTest() {
      if (this.testing) return
      this.testing = true
      this.testResult = '正在调用云函数 hello…'

      // 先确认 uniCloud 在这个平台能不能用（H5 端默认用不了，要配代理）
      if (typeof uniCloud === 'undefined') {
        this.testing = false
        this.testResult = '✗ 当前平台用不了 uniCloud（如果你是在浏览器里看，请改用「运行到手机」）'
        return
      }

      try {
        const res = await uniCloud.callFunction({ name: 'hello' })
        const body = (res && res.result) || {}
        if (body.code === 0) {
          this.testResult =
            '✓ 连通成功：' + body.data.text + '｜服务空间 ' + (body.data.spaceId || '(未知)')
          uni.showToast({ title: '连通成功', icon: 'success' })
        } else {
          this.testResult = '✗ 云函数返回错误：' + (body.msg || '未知')
        }
      } catch (err) {
        // 常见原因见 05 文档：没关联服务空间 / 云函数没上传 / 网络不通
        this.testResult = '✗ 调用失败：' + (err && err.message ? err.message : String(err))
      } finally {
        this.testing = false
      }
    }
  }
}
</script>


<style>

/* ==========================================================================
   首页（文档 §3 · P0-B）
   --------------------------------------------------------------------------
   视觉块预算：7 个，超出必须删一个。
   字号只用 5 档：40/30/28/24/20rpx
   间距只用 5 档：8/16/24/32/48rpx
   圆角：卡片 24rpx、按钮 20rpx、胶囊 999rpx
   主色 #ff6b35 只出现在主 CTA
   ========================================================================== */

.page {
  min-height: 100vh;
  /* 头图要贴顶撑满，所以左右内边距交给各模块自己处理 */
  /* 自定义导航栏：顶部只让出状态栏高度（原生标题栏已去掉） */
  padding: calc(var(--status-bar-height) + 16rpx) 32rpx 200rpx;
  background: var(--tf-bg);
}

/* ==========================================================================
   [0] 头图
   --------------------------------------------------------------------------
   sticky 吸顶 + 高度随滚动压缩（300px → 64px）。
   负 margin 抵消 .page 的 padding，让头图贴顶、撑满屏宽。
   ========================================================================== */
.hero {
  position: sticky;
  top: 0;
  /* 必须高于卡片堆：卡片的 z-index 是 n - i（10 张时最大 10），
     写 5 的时候卡片会盖住头图，上滑看到的是卡片压着头图而不是从头图底下滑走 */
  z-index: 50;
  /* 固定 300px —— 之前误删了这行，头图直接塌成 0 高 */
  height: 300px;
  /* 撑满左右，但不吃掉 page 的 padding-top —— 顶部圆角才露得出来 */
  margin: 0 -32rpx;
  overflow: hidden;
  /* 四角圆角 */
  border-radius: 40rpx;
  /* 头图：用户提供的猫狗插画，直接铺满，不做任何加工 */
  background: url("/static/hero-catdog.jpg") center center / cover no-repeat;
}

/* 斜纹装饰，压缩时被裁掉 */
.hero::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    -32deg,
    rgba(255, 255, 255, 0.07) 0 2rpx,
    transparent 2rpx 28rpx
  );
}

/* 云：两团柔白 */
.cloud {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.cl1 {
  left: -60rpx;
  top: 68rpx;
  width: 340rpx;
  height: 132rpx;
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0) 76%);
}
.cl2 {
  left: 192rpx;
  top: 28rpx;
  width: 220rpx;
  height: 96rpx;
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.48), rgba(255, 255, 255, 0) 78%);
}

/* 云函数自检：一个小圆，放头图右上角（临时，后续删） */
.selftest-dot {
  position: absolute;
  right: 28rpx;
  top: 28rpx;
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 4rpx 14rpx rgba(40, 80, 140, 0.20);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 6;
}
.selftest-dot-tx {
  font-size: 22rpx;
  font-weight: 800;
  color: #2A5A94;
}

.hero-inner {
  position: absolute;
  left: 32rpx;
  /* 往下压：原来 132rpx 离数字卡太远，整体下移贴近它 */
  top: 180rpx;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.hero-title {
  font-size: 92rpx;
  font-weight: 800;
  color: #2C5FA8;
  letter-spacing: 0.06em;
  line-height: 0.96;
  /* 白色偏移描边，做手写贴纸的厚度 */
  text-shadow: 4rpx 6rpx 0 rgba(255, 255, 255, 0.85), 0 12rpx 36rpx rgba(40, 90, 150, 0.18);
  transform: rotate(-2.5deg);
  transform-origin: left center;
}

.hero-sub {
  margin-top: 30rpx;
  font-size: 25rpx;
  font-weight: 700;
  color: #8A6210;
  letter-spacing: 0.03em;
  transform: rotate(-2.5deg);
  transform-origin: left center;
}






/* ==========================================================================
   [0.5] 数字卡
   --------------------------------------------------------------------------
   白色胶囊 + 三格数字 + 右侧深色圆形箭头。
   压住头图下沿用 transform（sticky 元素上的负 margin 不产生位移）。
   ========================================================================== */
.stats {
  /* 自己 sticky。top 必须等于它的「正常流位置」（头图 300 - 负 margin 30 = 270），
     否则滚动时它会先从原位滑到吸附点，看起来像「有滑动区间」。 */
  position: sticky;
  top: 270px;
  /* 同样要高于卡片堆（见 .hero 的说明） */
  z-index: 60;
  /* 压住头图下沿半个卡高 + 靠左。宽度收到 58% —— 66.667% 时右端会压住猫爪 */
  margin: -58rpx 0 0 36rpx;
  width: 58%;
  height: 116rpx;
  display: flex;
  align-items: center;
  border-radius: 58rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line);
  box-shadow: 0 8rpx 24rpx rgba(120, 80, 50, 0.16);
  padding: 0 10rpx 0 6rpx;
}

.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}
/* 分隔线：只在格子之间，短而淡 */
.stat + .stat::before {
  content: '';
  position: absolute;
  left: 0;
  top: 32%;
  bottom: 32%;
  width: 2rpx;
  background: rgba(45, 42, 38, 0.10);
}

.stat-n {
  font-size: 38rpx;
  font-weight: 800;
  color: var(--tf-text);
  line-height: 1;
}
.stat:first-child .stat-n {
  color: var(--tf-primary);
}
.stat-l {
  font-size: 19rpx;
  color: var(--tf-text-3);
  line-height: 1;
  margin-top: 4rpx;
}

/* 「我的需求」可点了：按下去给一点反馈，否则用户不知道这一格能进 */
.stat--hover {
  opacity: 0.55;
}

/* 右侧深色圆形箭头：整张卡最醒目的一笔 */
.stats-go {
  flex: none;
  width: 92rpx;
  height: 92rpx;
  margin-left: 12rpx;
  border-radius: 50%;
  background: var(--tf-text);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(45, 42, 38, 0.26);
}
.stats-go-arw {
  color: #fff;
  font-size: 34rpx;
  line-height: 1;
}

/* ==========================================================================
   身份行 · 浮在头图左上角
   --------------------------------------------------------------------------
   绝对定位 + z-index 高于背景斜纹。
   文字用白色 —— 底下是橙色渐变，深色字读不出来。
   头图压缩到 64px 时，overflow:hidden 会把它裁掉，同时淡出更自然。
   ========================================================================== */
.hero-id {
  position: absolute;
  left: 32rpx;
  /* 右边收到 112rpx：右上角有自检圆点，不收会撞上 */
  right: 112rpx;
  /* 头图本身已经在 page 的 padding 下方了，这里再加状态栏高度会顶到很低。
     直接给 24rpx，贴着圆角内沿。 */
  top: 24rpx;
  z-index: 3;
  height: auto;
  padding: 0;
  transition: opacity 140ms linear;
}
.hero-id .id-ava {
  background: #FFFFFF;
  color: #2A5A94;
  box-shadow: 0 4rpx 12rpx rgba(40, 80, 140, 0.18);
}
/* 头图顶部是浅蓝天，白字对比度只有 2:1，必须用深蓝 */
.hero-id .id-greet {
  color: #1F3F66;
}
.hero-id .id-badge {
  background: rgba(255, 255, 255, 0.78);
  color: #2A5A94;
  border: 1rpx solid rgba(255, 255, 255, 0.90);
}
.hero-id .id-badge--credit {
  background: rgba(255, 255, 255, 0.78);
  color: #2A5A94;
}
/* 透明度由内联 style 按滚动进度给（idOpacity），
   这里只管压缩后不响应点击 */
.hero--min .hero-id {
  pointer-events: none;
}

/* [1] 身份行：总高 ≤ 80rpx */
.id-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  height: 80rpx;
}
.id-ava {
  width: 68rpx;
  height: 68rpx;
  flex: none;
  border-radius: 50%;
  background: var(--tf-primary-soft);
  color: var(--tf-primary-deep);
  font-size: 29rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 头像图：必须写在 .id-ava 之后。
   单类选择器同名属性由源码顺序决定谁生效，写在前面会被 .id-ava 的
   background（紫底盖住照片）和 display:flex 盖掉 —— 这个坑项目里踩过。 */
.id-ava-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  display: block;
  overflow: hidden;
  background: var(--tf-card-line);
}
/* 未登录占位「?」（仍然是一个文字节点，不是昵称首字）：字号和居中继承自 .id-ava，
   这里只收掉行高免得字偏下。昵称首字和默认头像图都取消：没有可用链接时是空圆
   占位，不是一张假头像。 */
.id-ava-tx {
  line-height: 1;
}
.id-greet {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.id-badges {
  display: flex;
  gap: 8rpx;
  flex: none;
}
.id-badge {
  height: 36rpx;
  padding: 0 16rpx;
  border-radius: 999rpx;
  background: var(--tf-tag-1);
  color: #1f6b5c;
  font-size: 20rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
}
.id-badge--credit {
  background: var(--tf-tag-4);
  color: #8a5a00;
}
/* 深夜变体：只换右侧胶囊内容，高度不变（§3.4） */
.id-chat {
  flex: none;
  height: 36rpx;
  padding: 0 16rpx;
  border-radius: 999rpx;
  background: var(--tf-ai-soft);
  color: #8a6a00;
  font-size: 20rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
}

/* [2] 活人信号 */
.live-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 8rpx;
}
.live-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #34c77b;
  animation: live-breathe 1.6s ease-in-out infinite;
}
@keyframes live-breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.35; transform: scale(0.82); }
}
.live-text {
  font-size: 24rpx;
  color: var(--tf-text-3);
}

/* ==========================================================================
   标题行 + 发布入口 —— 在头图内部
   --------------------------------------------------------------------------
   之前放在头图外面，滚动时会被吸顶的数字卡压住（z-index 抢不过，层级反复调）。
   移进头图后它跟着头图走，压缩时一起淡出，彻底没有层级冲突。

   配色要适配橙色背景：原来的深色字/橙底按钮在橙渐变上完全看不见。
   ========================================================================== */
.hero-sec {
  position: absolute;
  left: 32rpx;
  right: 32rpx;
  /* 数字卡压住头图下沿 58rpx（约 30px），底部要留够 96rpx 才不撞 */
  bottom: 96rpx;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16rpx;
}
.hero-sec-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.hero-sec .sec-title {
  /* 头图底部是暖黄，白字对比度只有 1.5:1 */
  color: #6B4A00;
  font-size: 32rpx;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.hero-sec .sync-pill {
  height: 40rpx;
  padding: 0 16rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.66);
  border: 1rpx solid rgba(255, 255, 255, 0.85);
  color: #8A5A00;
  font-size: 20rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
}
/* 发布按钮反过来：白底 + 主色字（橙底上的橙按钮看不清） */
.hero-sec .sec-cta {
  flex: none;
  align-self: flex-start;
  /* 通用 .sec-cta 带 margin-left:auto，这里必须覆盖掉，否则按钮会被推到右边压住猫 */
  margin-left: 0;
  height: 60rpx;
  padding: 0 22rpx;
  border-radius: 30rpx;
  background: #fff;
  display: flex;
  align-items: center;
  gap: 2rpx;
  box-shadow: 0 6rpx 16rpx rgba(180, 70, 20, 0.20);
}
.hero-sec .sec-cta-plus {
  color: var(--tf-primary-deep);
  font-size: 26rpx;
  font-weight: 800;
  line-height: 1;
}
.hero-sec .sec-cta-tx {
  color: var(--tf-primary-deep);
  font-size: 22rpx;
  font-weight: 800;
  letter-spacing: 0.02em;
}
/* 压缩态：整行不响应点击（opacity 已由内联 style 给） */
.hero--min .hero-sec {
  pointer-events: none;
}

/* 发布入口：主色胶囊，放标题行最右 */
.sec-cta {
  margin-left: auto;
  flex: none;
  height: 60rpx;
  padding: 0 22rpx;
  border-radius: 30rpx;
  background: var(--tf-primary);
  display: flex;
  align-items: center;
  gap: 2rpx;
  box-shadow: 0 6rpx 16rpx rgba(232, 184, 32, 0.28);
}
.sec-cta-plus {
  color: #fff;
  font-size: 26rpx;
  font-weight: 800;
  line-height: 1;
}
.sec-cta-tx {
  color: #fff;
  font-size: 22rpx;
  font-weight: 800;
  letter-spacing: 0.02em;
}
.sec-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.sync-pill {
  height: 36rpx;
  padding: 0 16rpx;
  border-radius: 999rpx;
  background: var(--tf-primary-soft);
  color: var(--tf-primary-deep);
  font-size: 20rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
}

/* [4] 需求流 */
/* ==========================================================================
   需求流 · 收纳式卡片堆
   --------------------------------------------------------------------------
   容器高度由 JS 动态给（堆叠态矮、展开态高）。
   卡片绝对定位，位置完全由 transform 控制 —— 不再靠 margin 排列。
   入场动画改成「位置插值」本身，所以去掉了原来的 card-in keyframes
   （两者都改 transform 会打架）。
   ========================================================================== */
.deck {
  position: relative;
  /* 与上方留白的间距（静止 152rpx，把整叠底沿顶到悬浮导航栏上方，吃掉底部空白；
     一下滑就收到 0，否则那块留白在滑动中会变成不动的白带）。
     数值由 :style 的 --deck-gap 给（JS 只做一次 rpx→px），逐像素收放交给 transition：
     .deck--scrolled 一挂上，margin-top 就在 200ms 内收到 0，不用滚动逐帧喂。 */
  margin-top: var(--deck-gap, 0px);
  /* ★ 容器高度跟着展开比例线性变（堆叠 → 展开），和卡片读同一个 --deck-p：
     没有过渡的话，每帧的高度跳变会让下面的内容「一格一格」往下窜。
     高度只能留在布局属性上 —— 卡片是 absolute，容器不长高，展开后就压到分类贴纸。 */
  height: calc(var(--h0, 0px) + var(--dh, 0px) * var(--deck-p, 0));
  transition: height 120ms linear, margin-top 200ms ease-out;
}

.deck--scrolled {
  margin-top: 0px;
}

.deal {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  /* ★ 必须 border-box：否则 height 400 + padding 100 = 实际 500rpx，
     比展开间距(416rpx)还高 —— 卡片会互相重叠，把下一张的头像行盖住。
     这就是视频里「第二三张卡只剩底部」的原因。 */
  box-sizing: border-box;
  height: 440rpx;
  /* padding-top 76rpx 远大于 STACK_GAP(8rpx)：
     堆叠时露出的那条正好落在空白区，看到的是干净的圆角轮廓，不是下一张卡的头像。
     间距 8rpx(4px)：10 张叠起来只剩薄薄一叠，上边缘几乎挨在一起。 */
  padding: 76rpx 24rpx 24rpx;
  border-radius: 24rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line);
  /* 阴影要够重 —— 堆叠时每张只露出 64rpx 的顶部空白，
     阴影太淡的话那几条看起来像「空白块」，看不出是一叠卡 */
  box-shadow: 0 10rpx 28rpx rgba(80, 60, 30, 0.18), 0 2rpx 6rpx rgba(80, 60, 30, 0.10);
  /* 不能 overflow:hidden —— 时间紧迫角标在卡片上沿外侧（top:-12rpx），
     会被裁掉。卡片内容本身靠 line-clamp 控制行数，不会溢出圆角。 */
  overflow: visible;
  /* ★ 位置和缩放都在 CSS 里算：JS 只在容器上逐帧写一个 --deck-p。
       --st / --op / --sc 由 :style 一次性给出（只在 feed 变化时重算）。
       translate3d 的 z=0 让每张卡稳定留在独立合成层上，transform 不触发布局也不重绘。
       顺序必须是「先位移、后缩放」：scale 以 center top 为原点，
       顺序换掉每张卡的落点会整体偏。 */
  transform: translate3d(0,
      calc(var(--st, 0px) * (1 - var(--deck-p, 0)) + var(--op, 0px) * var(--deck-p, 0)), 0)
    scale(calc(1 - (1 - var(--deck-p, 0)) * var(--sc, 0)));
  /* 插值仍交给 transition：--deck-p 每帧都在变，120ms 线性把步长磨平，
     也让它和容器高度的过渡同步 —— 两者节奏不一致时卡片会在容器里「跑进跑出」。 */
  transition: transform 120ms linear;
  will-change: transform;
  transform-origin: center top;
}
/* 时间紧迫角标：钉在卡片右上角外侧一点，像贴纸 */
.urgent {
  position: absolute;
  right: 16rpx;
  top: -12rpx;
  height: 32rpx;
  padding: 0 14rpx;
  border-radius: 999rpx;
  background: var(--tf-primary);
  /* 暖黄底上白字只有 1.5:1，必须用深棕 */
  color: #6B4A00;
  font-size: 20rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  box-shadow: 0 4rpx 12rpx rgba(232, 184, 32, 0.3);
}

.fc-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
/* 有头像就渲染图片；没有可用链接就不挂图（v-else 是同样 72rpx 的空圆占位），不用默认头像图，
   也不用昵称首字。图片必须 block + 裁切，否则方角露出圆盒 */
.fc-ava-img {
  display: block;
  overflow: hidden;
  background: var(--tf-card-line);
}
.fc-ava {
  width: 72rpx;
  height: 72rpx;
  flex: none;
  border-radius: 50%;
  background: var(--tf-tag-2);
  color: #3a5a9a;
  font-size: 28rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fc-who {
  flex: 1;
  min-width: 0;
}
.fc-name-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
.fc-name {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.fc-verified {
  height: 30rpx;
  padding: 0 10rpx;
  border-radius: 999rpx;
  background: var(--tf-tag-1);
  color: #1f6b5c;
  font-size: 20rpx;
  display: flex;
  align-items: center;
}
.fc-meta {
  display: block;
  margin-top: 4rpx;
  font-size: 24rpx;
  color: var(--tf-text-3);
}
/* 同频度徽章 */
.fc-sync {
  flex: none;
  width: 72rpx;
  height: 72rpx;
  border-radius: 20rpx;
  background: var(--tf-primary-soft);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.fc-sync-n {
  font-size: 30rpx;
  font-weight: 800;
  color: var(--tf-primary-deep);
  line-height: 1;
}
.fc-sync-l {
  margin-top: 2rpx;
  font-size: 20rpx;
  color: var(--tf-primary-deep);
}

/* 分档迷你标签：22rpx 字号的小胶囊，作者行下方一条。
   卡片高度是固定的 440rpx（堆叠几何靠它算），这一条 38rpx 靠卡片内部
   原有的留白余量吃下，所以只在有 tier 时才渲染。 */
.fc-tier-row {
  margin-top: 8rpx;
  display: flex;
  flex-direction: row;
}

.fc-tier {
  flex: none;
  height: 30rpx;
  padding: 0 12rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  font-weight: 700;
  line-height: 30rpx;
  display: flex;
  align-items: center;
}

/* 同校：跟右上「N 同频」徽章同一套黄底深棕字，一眼看出是同一档信息 */
.fc-tier--school {
  background: var(--tf-primary-soft);
  color: var(--tf-primary-deep);
}

/* 附近：语义色 mist / mint，跟「已认证」那类正向小标签同族 */
.fc-tier--nearby {
  background: var(--tf-mist);
  color: var(--tf-mint);
}

/* 城市：最外一圈，用中性蓝底弱化，不抢同校 / 附近的注意力 */
.fc-tier--city {
  background: var(--tf-tag-2);
  color: #26509C;
}

/* 全站：本地凑不满一屏时从别的城市补进来的卡。不描底色、只留一圈内阴影细线，
   意思是「这里附近没有，先给你看看别处」—— 用 inset 不动盒子尺寸，
   卡片 440rpx 的固定高度不受影响。 */
.fc-tier--remote {
  background: transparent;
  color: var(--tf-text-3);
  box-shadow: inset 0 0 0 1rpx var(--tf-line);
}

.fc-title {
  display: block;
  margin-top: 16rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
  line-height: 1.4;
}
.fc-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--tf-text-2);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fc-foot {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 16rpx;
}
.fc-meta-item {
  font-size: 24rpx;
  color: var(--tf-text-3);
}
.fc-dot {
  font-size: 24rpx;
  color: var(--tf-text-3);
}
/* 空态 */
.feed-empty {
  padding: 64rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}
.fe-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.fe-sub {
  font-size: 24rpx;
  color: var(--tf-text-3);
}
.feed-loading {
  padding: 64rpx 0;
  display: flex;
  justify-content: center;
}
.fl-text {
  font-size: 24rpx;
  color: var(--tf-text-3);
}

/* [5] 分类贴纸：横滑 */
.cats {
  margin-top: 8rpx;
  white-space: nowrap;
}
.cat-row {
  display: flex;
  gap: 16rpx;
  padding-right: 32rpx;
}
.cat {
  flex: none;
  height: 72rpx;
  padding: 0 24rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line);
  white-space: nowrap;
}
.cat-name {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--tf-text);
  white-space: nowrap;
}
.cat-n {
  font-size: 20rpx;
  color: var(--tf-text-3);
  white-space: nowrap;
}
.cat--study { background: var(--tf-tag-1); border-color: transparent; }
.cat--sport { background: var(--tf-tag-2); border-color: transparent; }
.cat--meal  { background: var(--tf-tag-3); border-color: transparent; }
.cat--play  { background: var(--tf-tag-4); border-color: transparent; }

/* [6] 今日局提醒 */
.today-meet {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 16rpx;
  padding: 24rpx;
  border-radius: 24rpx;
  background: var(--tf-tag-4);
}
.tm-label {
  font-size: 20rpx;
  font-weight: 700;
  color: #8a5a00;
}
.tm-text {
  flex: 1;
  font-size: 24rpx;
  color: #6b4a00;
}
.tm-go {
  font-size: 28rpx;
  color: #8a5a00;
}

/* [7] 主 CTA：全屏唯一实色按钮 */
.main-cta {
  margin-top: 32rpx;
  height: 112rpx;
  /* 文档 §11：主 CTA 按下 scale(0.97)，150ms */
  transition: transform var(--dur-micro, 150ms) var(--ease-std, cubic-bezier(0.22, 0.61, 0.36, 1));
  border-radius: 24rpx;
  background: var(--tf-primary);
  box-shadow: 0 10rpx 28rpx rgba(232, 184, 32, 0.32);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}
.main-cta:active {
  transform: scale(0.97);
}

.cta-text {
  font-size: 30rpx;
  font-weight: 800;
  color: #fff;
}
.cta-sub {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.82);
}



/* ==========================================================================
   顶部 · 问候 + 头像
   ========================================================================== */










/* 昵称塞进圆里：字号压小 + 溢出裁掉，两字昵称刚好，三字会裁 */




/* ==========================================================================
   账号条：M1 验收信息压成一行
   ========================================================================== */














/* ==========================================================================
   今日同频：整屏唯一主卡
   深靛蓝玻璃（62% 深蓝 + 大半径模糊 + 白边）—— 保住「一屏一主卡」的重量，
   又和周围的浅玻璃同属一个质感体系。实色会让质感断掉。
   ========================================================================== */


/* 右上角一道高光，玻璃质感靠它 */


/* 高光是绝对定位的，子元素必须抬起来，否则文字被它压住 */


















/* CTA 是用户动作 → 走深靛蓝，不跟着主卡变绿 */




/* ==========================================================================
   便当格：大小不一但严格对齐，搭子大厅独占一整行
   ========================================================================== */






/* 两列半格：减掉中间 gap，否则两个 50% 会换行 */







/* 便当格图标：浅色玻璃底 + 深色描边图标。
   实心饱和块在「清透」语境里最刺眼，会把视线从标题上拽走。 */




/* 高格里标题沉到底部，和宽条的视觉重心拉开 */










/* ==========================================================================
   每日百科：细长条，不跟主卡抢位置
   ========================================================================== */












/* 超 2 行折叠：-webkit-line-clamp 在 App / 小程序 / H5 都生效，
   兜底再加 max-height，老内核截不出来也不会把卡片撑爆 */








/* 往期标：要让「这不是今天的」一眼分得出来，但不该抢过分类标 */




/* ==========================================================================
   自检 + 页脚
   ========================================================================== */
.selftest {
  margin-top: 32rpx;
  padding: 20rpx 28rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-sm);
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

/* 折叠开关：平时只留一行，不占首页版面 */
.selftest-toggle {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

.selftest-btn {
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 999rpx;
  background-color: var(--tf-primary);
  color: #ffffff;
  font-size: 30rpx;
  border: none;
}

.selftest-btn[disabled] {
  background-color: rgba(31, 92, 172, 0.35);
  color: rgba(255, 255, 255, 0.85);
}

.selftest-result {
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
  word-break: break-all;
}





/* ==========================================================================
   头像淡入
   --------------------------------------------------------------------------
   图片来源是 common/avatar/avatarCache.js 的本地文件，没有边下边画的过程；
   这里只负责「空圆 → 完整头像」这一次 160ms 过渡。用 opacity 不用 v-if：
   图片节点一旦挂上就不再摘，避免需求流里整卡重排。
   ========================================================================== */
.ava-fade {
  opacity: 0;
  transition: opacity 160ms ease-out;
}

.ava-fade--in {
  opacity: 1;
}
</style>