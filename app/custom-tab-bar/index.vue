<template>
  <view class="tabbar-slot">
    <!-- ① 底槽玻璃：只负责「托住」四个 tab 的视觉重量。
         它必须和文字层分开 —— backdrop-filter 会创建新的层叠上下文，
         若文字和它在同一个元素里，文字再高的 z-index 也压不过外面的滑块。 -->
    <view class="tabbar-tray" />

    <!-- ② 滑块：要凸出栏外，所以必须在 tray 外面。
         放进 tray 内部会被它的 1px 边框和圆角裁掉 —— 那就是「双层边」的来源。 -->
    <view
      class="lg-lens"
      :class="{ 'is-press': pressing, 'is-ready': ready, 'is-anim': animOn }"
      :style="lensStyle"
    >
      <view class="lg-lens__gloss" />
    </view>

    <!-- ③ 文字层：无背景、无 backdrop-filter，所以不与任何东西争层叠上下文，
          只靠 z-index 稳稳压在滑块之上。
          padding 必须为 0：滑块和 tab 共用同一个四等分网格，基准一致才对得齐。 -->
    <view class="tabbar">
      <view
        v-for="(t, i) in list"
        :key="i"
        class="tab"
        :class="{ 'is-on': current === t.pagePath }"
        @tap="go(t)"
      >
        <image class="tab-ico" :src="'/static/icons/' + t.icon + '.png'" mode="aspectFit" />
        <text class="tab-label">{{ t.text }}</text>
        <!-- 未读红点只挂「消息」那一格。数字来自 message-conversations 的 data.total_unread
             （服务端已排除免打扰会话），不用 uni.setTabBarBadge —— 自定义 tabBar 下它无效。
             未登录 / 请求失败时 unread=0，这里不渲染，绝不显示成 0。 -->
        <text
          v-if="t.pagePath === 'pages/messages/messages' && unread > 0"
          class="tab-badge"
        >{{ unread > 99 ? '99+' : unread }}</text>
      </view>
    </view>
  </view>
</template>

<script>
// tab 列表必须与 pages.json 的 tabBar.list 完全一致（路径、文字、顺序）。
// 改这里记得同步改 pages.json，否则 uni.switchTab 会跳到一个不在 tabBar 里的页面而失败。
const LIST = [
  { pagePath: 'pages/index/index', text: '首页', icon: 'home' },
  { pagePath: 'pages/feed/feed', text: '同频圈', icon: 'globe' },
  { pagePath: 'pages/messages/messages', text: '消息', icon: 'chat' },
  { pagePath: 'pages/mine/mine', text: '我的', icon: 'user' }
]

// ★ 未读数的模块级节流状态。
//   每个 tab 页各挂一个 tabBar 实例，但 import 到的模块只有一份 ——
//   节流变量放模块级，四个实例才共享同一份时间戳，切页不会各打一次云函数。
const UNREAD_EVENT = 'tfUnread'
const UNREAD_TTL_MS = 60 * 1000
let unreadFetchedAt = 0
let unreadFetching = false

export default {
  data() {
    return {
      list: LIST,
      current: '',
      // slider 位置确定之前不显示：页面被 switchTab 复用时，组件第一帧的 current
      // 还是空串（getCurrentPages 尚未就绪），滑块会先落在第 0 格再跳过去 ——
      // 那一次跳跃就是用户看到的那下闪烁。
      ready: false,
      // 第一帧定位必须是"瞬移"而不是"滑过去"：
      // 每个 tab 页都挂着一个自己的 tabBar 实例，首次进入某页时那个实例是全新挂载的，
      // 若首帧就带 transition，它会从第 0 格滑到正确位置 —— 那就是"刚登录那几下不流畅"。
      // mounted 之后再打开过渡，后续切换才是有动画的。
      animOn: false,
      pressing: false,
      // 全局未读总数，0 = 不显示红点（未登录/失败也是 0，不会显示成"0"）
      unread: 0
    }
  },
  computed: {
    lensStyle() {
      const i = this.list.findIndex((t) => t.pagePath === this.current)
      return { '--i': i < 0 ? 0 : i }
    }
  },
  created() {
    this.setSelected()
    // 页面 onShow 时由宿主页面广播，组件据此重新读栈。
    // 为什么不用 mounted 一把梭：switchTab 之后 tab 页会被缓存，
    // 切走再切回来既不重新 created 也不重新 mounted，
    // 只在 mounted 读一次会导致滑块停在别的 tab 上（看着像 UI 坏了）。
    try {
      uni.$on('tfTabShow', this.onHostShow)
      // 未读数走另一个频道：自己拉的、以及 messages.vue 读完消息后广播的，都从这里进来。
      // 不并进 tfTabShow —— 那条广播的契约是"重读栈顶 route"，混进数据请求会让它变味。
      uni.$on(UNREAD_EVENT, this.onUnread)
    } catch (e) {}
  },
  mounted() {
    // created 时 getCurrentPages 可能还没就绪，mounted 再同步一次
    this.setSelected()
    // 首帧也拉一次未读数：页面 onShow 的 tfTabShow 可能早于本实例 created 发出，
    // 只靠广播会漏掉"第一次打开 app 就直接落在消息 tab"这种情形。节流保证不会重复请求。
    this.refreshUnread()
    // 下一帧才允许过渡：首帧的定位必须瞬移，后续切换才滑
    this.$nextTick(() => {
      this.animOn = true
    })
  },
  beforeUnmount() {
    try {
      uni.$off('tfTabShow', this.onHostShow)
      uni.$off(UNREAD_EVENT, this.onUnread)
    } catch (e) {}
  },
  methods: {
    // 宿主 tab 页 onShow 时发一次广播，这里重读栈顶 route 修正选中态
    onHostShow() {
      this.setSelected()
      // 顺手刷一次未读数（内部有节流，一分钟内多晚切页也只打一次云函数）
      this.refreshUnread()
    },

    // 收到全局未读数：自己拉的或 messages.vue 广播的，四个实例统一更新
    onUnread(payload) {
      const n = payload && typeof payload.total === 'number' ? payload.total : 0
      this.unread = n > 0 ? n : 0
    },

    /**
     * 拉全局未读总数（message-conversations 的 data.total_unread，服务端已排除免打扰会话）。
     * 节流：模块级时间戳 + in-flight 标记 —— 同一分钟内多次切页只请求一次。
     * 未登录 / 请求失败 → 广播 0，红点消失，不显示"0"、不弹错、不影响主流程。
     */
    async refreshUnread() {
      if (unreadFetching) return
      const now = Date.now()
      if (unreadFetchedAt && now - unreadFetchedAt < UNREAD_TTL_MS) return
      let token = ''
      try {
        token = uni.getStorageSync('token') || ''
      } catch (e) {
        token = ''
      }
      // 未登录：不打云函数，也不占节流名额（登录后要能立刻拉）
      if (!token || typeof uniCloud === 'undefined') {
        try { uni.$emit(UNREAD_EVENT, { total: 0 }) } catch (e) {}
        return
      }
      unreadFetching = true
      unreadFetchedAt = now
      try {
        const res = await uniCloud.callFunction({
          name: 'message-conversations',
          data: { token: token }
        })
        const r = (res && res.result) || {}
        const d = r.data || {}
        const total = r.code === 0 && typeof d.total_unread === 'number' ? d.total_unread : 0
        try { uni.$emit(UNREAD_EVENT, { total: total }) } catch (e) {}
      } catch (e) {
        try { uni.$emit(UNREAD_EVENT, { total: 0 }) } catch (e) {}
      } finally {
        unreadFetching = false
      }
    },
    // 当前选中项只看「栈顶页面的 route」。
    // 不用 props 传 —— 组件是每个 tab 页各自挂载的实例，
    // 它自己从页面栈读，反而不会和页面状态不同步。
    setSelected() {
      try {
        const pages = getCurrentPages()
        const cur = pages[pages.length - 1]
        this.current = cur && cur.route ? cur.route : ''
      } catch (e) {
        this.current = ''
      }
      // 同步置 ready：created 里就定好位置，首帧直接画在正确位置，
      // 不留"先隐藏再淡入"的过度过程（那本身看着也像闪）。
      if (this.current) this.ready = true
    },
    go(t) {
      if (this.current === t.pagePath) return
      // ★ 先本地改选中态再跳页。
      //   只靠目标页 onShow 广播回来的话，点击到页面切换之间的这半秒里
      //   滑块还停在旧位置，看起来就是"点了没反应，过一会儿才动"。
      //   先改本地 → 滑块立刻开始滑 → 目标页 onShow 时再校正一次（幂等）。
      this.current = t.pagePath
      uni.switchTab({ url: '/' + t.pagePath })
    }
  }
}
</script>

<style scoped>
/* ==========================================================================
   自定义 tabBar —— 三层分离
   ① tabbar-tray  底槽玻璃（z 0）
   ② lg-lens      滑块玻璃（z 2，凸出栏外）
   ③ tabbar       纯文字层（z 3，无背景无 blur）
   为什么必须三层：backdrop-filter 会创建层叠上下文。滑块如果放在底槽内部，
   会被底槽的边框和圆角裁掉；文字如果和底槽同一个元素，会被滑块盖住。
   ========================================================================== */
.tabbar-slot {
  position: fixed;
  left: 31rpx;
  right: 31rpx;
  bottom: calc(42rpx + constant(safe-area-inset-bottom));
  bottom: calc(42rpx + env(safe-area-inset-bottom));
  height: 119rpx;
  z-index: 999;
  /* 滑块要凸到栏外，裁切不能发生在这一层 */
  overflow: visible;
}

/* ① 底槽 */
.tabbar-tray {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  border-radius: 46rpx;
  /* 底色用 --tf-card（白 55%）而不是设计稿的 0.12：设计稿背后是深紫底，
     0.12 就够；我们的页面是浅冷底，0.12 会和背景糊成一团、边框也看不见。
     这是「浅底必须提浓」的本地化调整。 */
  background: var(--tf-card);
  /* saturate 只用 1.2，不用全局的 1.9 —— tabBar 背后是页面渐变本身，
     saturate 1.9 会把渐变里的蓝绿色斑放大，整条栏发青。
     诊断对比见 docs/27 §4.4.1。 */
  backdrop-filter: blur(26px) saturate(1.2) brightness(1.04);
  -webkit-backdrop-filter: blur(26px) saturate(1.2) brightness(1.04);
  /* 底槽用柔边：它是容器，不该跟滑块抢白边。
     两道同样亮的白边挨在一起会被看成画错，一强一弱才读成深度。 */
  border: 2rpx solid var(--tf-line);
  box-shadow:
    0 27rpx 65rpx rgba(31, 92, 172, 0.16),
    inset 0 2rpx 0 rgba(255, 255, 255, 0.72),
    inset 0 -2rpx 0 rgba(255, 255, 255, 0.24);
  z-index: 0;
}

/* ② 滑块 */
.lg-lens {
  position: absolute;
  top: -10rpx;
  left: 0;
  /* 与 tab 共用四等分网格：宽度 = 1/N，位移 = i × 自身宽度。
     这样滑块天然精确落在 tab 正中，不需要任何补偿值。 */
  width: calc(100% / 4);
  height: 138rpx;
  /* 半径按高度比例放大（底槽 119rpx/46rpx = 0.387，滑块 138rpx → 53rpx）。
     比例一致两条弧才平行；照抄同一个数字会让弧线交叉。 */
  border-radius: 53rpx;
  transform: translateX(calc(var(--i, 0) * 100%));
  /* 默认不显示也不过渡：首帧要"瞬移"到正确位置，否则新挂载的实例会从第 0 格滑过来 */
  opacity: 0;
  transition: none;
  will-change: transform;
  /* 底色 0.62 而不是设计稿的 0.11：滑块是「选中态」的实体表达，
     太淡会和底槽糊成一片、只剩一道白边。0.62 才读得出是一颗独立的胶囊。
     saturate 同样压到 1.2，理由同底槽。 */
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(22px) saturate(1.2) brightness(1.06);
  -webkit-backdrop-filter: blur(22px) saturate(1.2) brightness(1.06);
  border: 2rpx solid rgba(255, 255, 255, 0.92);
  box-shadow:
    0 19rpx 46rpx rgba(31, 92, 172, 0.20),
    inset 0 3rpx 0 rgba(255, 255, 255, 1),
    inset 0 -3rpx 0 rgba(255, 255, 255, 0.5),
    inset 0 0 31rpx 2rpx rgba(255, 255, 255, 0.34);
  z-index: 2;
  pointer-events: none;
}

/* 滑块内壁的液面反光 */
.lg-lens__gloss {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  border-radius: inherit;
  background: linear-gradient(
    122deg,
    rgba(255, 255, 255, 0.66) 0%,
    rgba(255, 255, 255, 0) 34%,
    rgba(255, 255, 255, 0) 76%,
    rgba(255, 255, 255, 0.22) 100%
  );
}

/* 按下的那一瞬玻璃轻微「挤压」，松开回弹 */
.lg-lens.is-ready {
  opacity: 1;
}

/* ★ 只有"非首帧"才带过渡。原设计那套回弹曲线（0.34, 1.56, 0.64, 1）+ 520ms
   是有意为之的「液态玻璃」手感，不要为了"看着顺"改成单调曲线 —— 那会把动效做没。 */
.lg-lens.is-anim {
  transition: transform 520ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 系统开了「减少动态效果」时不做位移过渡 */
@media (prefers-reduced-motion: reduce) {
  .lg-lens.is-anim {
    transition: none;
  }
}

.lg-lens.is-press {
  transform: translateX(calc(var(--i, 0) * 100%)) scale(1.05, 0.93);
  transition: transform 140ms cubic-bezier(0.3, 0, 0.2, 1);
}

/* ③ 文字层 */
.tabbar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0;
  z-index: 3;
}

.tab {
  flex: 1;
  height: 92rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
  color: var(--tf-text-3);
  transition: color 260ms cubic-bezier(0.16, 1, 0.3, 1);
  /* 红点是绝对定位的，锚点必须是这一格 */
  position: relative;
}

/* 未读红点：压在图标右上角。绝对定位是必须的 —— 让它进 flex 流会把图标挤歪，
   四个 tab 的图标就不在同一水平线上了。 */
.tab-badge {
  position: absolute;
  top: 4rpx;
  left: 50%;
  margin-left: 8rpx;
  min-width: 28rpx;
  height: 28rpx;
  padding: 0 6rpx;
  border-radius: 14rpx;
  background: #ff3b30;
  color: #ffffff;
  font-size: 18rpx;
  line-height: 28rpx;
  font-weight: 600;
  text-align: center;
  box-sizing: border-box;
}

.tab-ico {
  width: 42rpx;
  height: 42rpx;
  /* 未选中态图标偏淡：靠 opacity 把雾蓝渐变压低一档，
     不另外做一套灰色图标 —— 那要多一倍静态资源。
     0.62 是下限：再淡在手机小屏上就「看着像没加载」了。 */
  opacity: 0.62;
}

.tab.is-on .tab-ico {
  opacity: 1;
}

.tab-label {
  font-size: 19rpx;
  letter-spacing: 0.02em;
  font-weight: 500;
}

/* 选中态只换色，不再加底色 —— 滑块本身就是选中态的视觉表达，
   再铺一层底色会变成「框里有框」。 */
.tab.is-on {
  color: var(--tf-primary-deep);
}

.tab.is-on .tab-label {
  font-weight: 600;
}
</style>