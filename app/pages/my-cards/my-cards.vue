<template>
  <view class="page">

    <!-- 导航 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">我的需求</text>
    </view>

    <!-- 顶部说明：为什么首页看不到自己的卡，得在这里说清 -->
    <view class="tip" v-if="!needLogin">
      <text class="tip-t">你发的需求只在这里看</text>
      <text class="tip-h">首页和搭子大厅只显示别人发的，避免自己刷到自己</text>
    </view>

    <!-- ===== 未登录 ===== -->
    <view class="state-box" v-if="needLogin">
      <text class="state-title">登录后才能看到自己发的需求</text>
      <text class="state-hint">需求是跟着账号走的，换台设备也能接着看</text>
      <view class="btn" @tap="goLogin"><text class="btn-t">去登录</text></view>
    </view>

    <!-- ===== 首屏骨架 ===== -->
    <view class="skeleton" v-else-if="loading && list.length === 0">
      <view class="skel-card" v-for="n in 3" :key="n">
        <view class="skel-line skel-line--wide"></view>
        <view class="skel-line"></view>
        <view class="skel-line skel-line--short"></view>
      </view>
    </view>

    <!-- ===== 首屏失败 ===== -->
    <view class="state-box" v-else-if="error && list.length === 0">
      <text class="state-text" @tap="refresh">加载失败，点这里重试</text>
    </view>

    <!-- ===== 空态：没发过就去发一条 ===== -->
    <view class="state-box" v-else-if="!loading && list.length === 0">
      <text class="state-title">你还没有发过需求</text>
      <text class="state-hint">说清时间和地点，更容易遇到同频的人</text>
      <view class="btn" @tap="goPublish"><text class="btn-t">发布一条</text></view>
    </view>

    <!-- ===== 列表 ===== -->
    <view class="list" v-else>
      <view class="item" v-for="c in list" :key="c._id" @tap="openCard(c)">
        <view class="item-top">
          <text class="item-title">{{ c.title }}</text>
          <text class="badge" :class="statusClass(c)">{{ statusText(c) }}</text>
        </view>

        <view class="meta">
          <text class="meta-t">{{ typeText(c.type) }}</text>
          <text class="dot">·</text>
          <text class="meta-t">{{ timeText(c.start_time) }}</text>
          <text class="dot" v-if="c.location_name">·</text>
          <text class="meta-t meta-t--place" v-if="c.location_name">{{ c.location_name }}</text>
        </view>

        <view class="tags" v-if="c.tags && c.tags.length">
          <text class="tag" v-for="t in c.tags" :key="t._id">{{ t.name }}</text>
        </view>

        <view class="item-foot">
          <text class="foot-n">{{ statText(c) }}</text>
          <text class="foot-go">看详情 ›</text>
        </view>

        <!-- 只有进行中（open）的需求才给「编辑 / 关闭」；
             已关闭 / 已找到搭子的卡只留顶部那枚状态徽章，不再给按钮 —— 给了也点不动 -->
        <view class="item-act" v-if="c.status === 'open'">
          <view class="act" @tap.stop="onEdit(c)">
            <text class="act-t">编辑</text>
          </view>
          <view class="act act--close" @tap.stop="onClose(c)">
            <text class="act-t">关闭</text>
          </view>
        </view>
      </view>

      <view class="more" v-if="hasMore">
        <text class="more-t">{{ loading ? '加载中…' : '上拉加载更多' }}</text>
      </view>
      <view class="more" v-else-if="list.length >= PAGE_SIZE">
        <text class="more-t">没有更多了</text>
      </view>
    </view>

  </view>
</template>

<script>
/* ==========================================================================
   我的需求
   --------------------------------------------------------------------------
   为什么有这个页面：card-list 从这一版起不再把自己的卡下发到首页 / 大厅
   （自己跟自己「同校」、标签必然重合，共同标签栏全是噪声），
   自己的卡统一收到这里 —— 首页数字卡「我的需求」点进来。
   接口：card-list { scope: 'mine', token, page, page_size }
         返回 open / matched / closed 三种状态，只排除 removed。
   取舍：不做本地缓存（一页 20 条，进来就有），三态（加载中 / 失败 / 空）都不给白屏。
   ========================================================================== */
const PAGE_SIZE = 20

// 卡片类型：库里存英文 key。新类型不写死会显示成空，所以留兜底
const TYPE_TEXT = {
  study: '自习',
  sport: '健身',
  meal: '干饭',
  fitness: '健身',
  photo: '约拍',
  other: '其他'
}

export default {
  data() {
    return {
      PAGE_SIZE,
      list: [],
      page: 1,
      hasMore: false,
      loading: false,
      error: '',
      needLogin: false,
      // 正在关闭的卡 id：有请求在飞时忽略新的点击，避免连点重复提交同一张卡
      closingId: ''
    }
  },

  onLoad() {
    this.init()
  },

  onReachBottom() {
    if (this.hasMore && !this.loading) this.loadMore()
  },

  // 从详情页改了状态（找到搭子 / 关闭）回来要能看见最新状态
  onShow() {
    if (!this.firstShow) {
      this.firstShow = true
      return
    }
    if (!this.needLogin) this.refresh()
  },

  async onPullDownRefresh() {
    await this.refresh()
    uni.stopPullDownRefresh()
  },

  methods: {
    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/index/index' })
      })
    },

    goLogin() {
      uni.reLaunch({ url: '/pages/login/login' })
    },

    goPublish() {
      uni.navigateTo({ url: '/pages/publish/publish' })
    },

    openCard(c) {
      uni.navigateTo({ url: '/pages/detail/detail?id=' + c._id })
    },

    /* 编辑：复用发布页的编辑模式（publish 带 id 进来就是编辑）。
       表单、标签、时间控件只有一份，两套表单的校验迟早会长歪 */
    onEdit(c) {
      if (!c || !c._id) return
      uni.navigateTo({ url: '/pages/publish/publish?id=' + c._id })
    },

    /* 关闭前二次确认：关掉之后 card-list 不再把这张卡下发给大厅，
       别人搜不到、已经报名的人也看不到，所以先把后果说清楚再问一遍 */
    onClose(c) {
      if (!c || !c._id || this.closingId) return
      uni.showModal({
        title: '关闭这条需求？',
        content: '关闭后别人再也搜不到你的需求，已经报名的同学也看不到它了。',
        confirmText: '关闭需求',
        cancelText: '再想想',
        success: (r) => {
          if (r.confirm) this.doClose(c)
        }
      })
    },

    /* 关闭成功后只改这一张卡的状态：
       整页 refresh 会重新拉列表、卡片跟着跳，用户刚点的那条可能被挤出屏幕 */
    async doClose(c) {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.needLogin = true
        return
      }
      this.closingId = c._id
      try {
        const res = await uniCloud.callFunction({
          name: 'card-update',
          data: { token: token, action: 'close', card_id: c._id }
        })
        const r = (res && res.result) || {}
        if (r.code === 0) {
          c.status = 'closed'
          uni.showToast({ title: '已关闭', icon: 'none' })
          return
        }
        // token 过期时列表已经不可信，退回「未登录」态比留一堆点不动的按钮强
        if (r.code === 401) {
          this.needLogin = true
          this.list = []
          this.hasMore = false
          return
        }
        uni.showToast({ title: r.msg || '关闭失败', icon: 'none' })
      } catch (e) {
        console.warn('[my-cards] card-update close failed', e)
        uni.showToast({ title: '网络不太好，稍后再试', icon: 'none' })
      } finally {
        this.closingId = ''
      }
    },

    init() {
      const token = uni.getStorageSync('token') || ''
      // 没登录就别调云函数：必然 401，白跑一趟还闪错
      if (!token) {
        this.needLogin = true
        this.list = []
        this.hasMore = false
        return
      }
      this.needLogin = false
      return this.refresh()
    },

    refresh() {
      if (this.needLogin) return Promise.resolve()
      this.page = 1
      return this.fetch(true)
    },

    loadMore() {
      this.page += 1
      return this.fetch(false)
    },

    async fetch(reset) {
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        const res = await uniCloud.callFunction({
          name: 'card-list',
          data: {
            token: uni.getStorageSync('token') || '',
            scope: 'mine',
            page: this.page,
            page_size: PAGE_SIZE
          }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          // 401 是 token 过期：按未登录展示，比让用户对着「加载失败」强
          if (r.code === 401) {
            this.needLogin = true
            this.list = []
            this.hasMore = false
            return
          }
          this.error = r.msg || '加载失败'
          if (!reset) this.page -= 1
          return
        }
        const d = r.data || {}
        // 未登录（token 失效但云函数没给 401）：reason='need_login'
        if (d.reason === 'need_login') {
          this.needLogin = true
          this.list = []
          this.hasMore = false
          return
        }
        const incoming = d.list || []
        this.list = reset ? incoming : this.list.concat(incoming)
        this.hasMore = !!d.has_more
      } catch (e) {
        console.warn('[my-cards] card-list failed', e)
        this.error = '网络不太好，稍后再试'
        // 翻页失败要把页码退回去，否则会跳过一页
        if (!reset) this.page -= 1
      } finally {
        this.loading = false
      }
    },

    /* 状态文案：库里是英文 key，这里给人看的话必须翻译；
       未知状态不写成空，直接把原值透出来，比空白好排查。 */
    statusText(c) {
      if (!c) return ''
      if (c.status === 'open') return '进行中'
      if (c.status === 'matched') return '已找到搭子'
      if (c.status === 'closed') return '已关闭'
      return c.status || ''
    },

    statusClass(c) {
      if (!c) return ''
      if (c.status === 'matched') return 'badge--done'
      if (c.status === 'closed') return 'badge--dead'
      return 'badge--open'
    },

    typeText(type) {
      return TYPE_TEXT[type] || type || '搭子'
    },

    /* 出发时间：库里是毫秒时间戳。只显示「今天 / 明天 / M月D日 + HH:mm」，
       不显示年份 —— 搭子需求都是近期的，带年份反而占宽。 */
    timeText(ts) {
      const n = Number(ts)
      if (!n || isNaN(n)) return '时间待定'
      const d = new Date(n)
      const hh = ('0' + d.getHours()).slice(-2)
      const mm = ('0' + d.getMinutes()).slice(-2)
      const now = new Date()
      const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
      const tomorrow = new Date(now.getTime() + 86400000)
      if (sameDay(d, now)) return '今天 ' + hh + ':' + mm
      if (sameDay(d, tomorrow)) return '明天 ' + hh + ':' + mm
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hh + ':' + mm
    },

    /* 底部那行：能申请的人数 / 已报名人数，云函数给了就显示，没给就不占位 */
    statText(c) {
      if (!c) return ''
      const parts = []
      if (typeof c.apply_count === 'number' && c.apply_count > 0) parts.push(c.apply_count + ' 人报名')
      if (typeof c.like_count === 'number' && c.like_count > 0) parts.push(c.like_count + ' 赞')
      return parts.join(' · ')
    }
  }
}
</script>

<style scoped>
/* ==========================================================================
   我的需求：白卡片 + 细描边，底色走主题，主色只用变量
   ========================================================================== */
.page {
  min-height: 100vh;
  background: var(--tf-bg);
  padding-bottom: 60rpx;
}

/* 导航 */
.nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  padding-top: var(--status-bar-height);
}

.nav-back {
  position: absolute;
  left: 20rpx;
  top: calc(var(--status-bar-height) + 10rpx);
  width: 68rpx;
  height: 68rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nav-back-arw {
  font-size: 48rpx;
  line-height: 1;
  margin-top: -4rpx;
  color: var(--tf-text);
}

.nav-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--tf-text);
}

/* 顶部说明 */
.tip {
  margin: 8rpx 28rpx 20rpx;
  padding: 22rpx 24rpx;
  border-radius: var(--tf-r-md);
  background: var(--tf-line-soft);
}

.tip-t {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.tip-h {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* 三态 */
.state-box {
  padding: 140rpx 60rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.state-title {
  font-size: 30rpx;
  font-weight: 600;
  text-align: center;
  color: var(--tf-text);
}

.state-hint {
  margin-top: 14rpx;
  font-size: 24rpx;
  line-height: 1.6;
  text-align: center;
  color: var(--tf-text-2);
}

.state-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.btn {
  margin-top: 36rpx;
  height: 80rpx;
  padding: 0 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--tf-r-md);
  background: var(--tf-primary);
  box-shadow: var(--tf-glass-shadow);
}

.btn-t {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--tf-bg);
}

/* 骨架 */
.skeleton {
  padding: 8rpx 28rpx;
}

.skel-card {
  margin-bottom: 20rpx;
  padding: 28rpx 24rpx;
  border-radius: var(--tf-r-md);
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line-soft);
}

.skel-line {
  height: 22rpx;
  margin-bottom: 16rpx;
  border-radius: 11rpx;
  background: var(--tf-line-soft);
  width: 60%;
}

.skel-line--wide {
  width: 90%;
}

.skel-line--short {
  width: 34%;
  margin-bottom: 0;
}

/* 列表 */
.list {
  padding: 8rpx 28rpx;
}

.item {
  margin-bottom: 20rpx;
  padding: 26rpx 24rpx 20rpx;
  border-radius: var(--tf-r-md);
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line-soft);
  box-shadow: var(--tf-glass-shadow);
}

.item-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.item-title {
  flex: 1;
  font-size: 30rpx;
  font-weight: 700;
  line-height: 1.4;
  color: var(--tf-text);
}

.badge {
  flex-shrink: 0;
  margin-left: 16rpx;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  line-height: 1.6;
}

.badge--open {
  color: #3f7a4d;
  background: rgba(63, 122, 77, 0.12);
}

.badge--done {
  color: #8a6a1f;
  background: rgba(196, 158, 60, 0.16);
}

.badge--dead {
  color: var(--tf-text-2);
  background: var(--tf-line-soft);
}

.meta {
  margin-top: 14rpx;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.meta-t {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.meta-t--place {
  max-width: 320rpx;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dot {
  margin: 0 10rpx;
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.tags {
  margin-top: 14rpx;
  display: flex;
  flex-wrap: wrap;
}

.tag {
  margin: 0 12rpx 10rpx 0;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  color: var(--tf-text-2);
  background: var(--tf-line-soft);
}

.item-foot {
  margin-top: 10rpx;
  padding-top: 16rpx;
  border-top: 2rpx solid var(--tf-line-soft);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.foot-n {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.foot-go {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.more {
  padding: 30rpx 0 10rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.more-t {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

/* 底部操作按钮：靠右排，点击区给足 56rpx 高，手指才按得准 */
.item-act {
  margin-top: 16rpx;
  display: flex;
  justify-content: flex-end;
}

.act {
  margin-left: 16rpx;
  padding: 14rpx 30rpx;
  border-radius: 999rpx;
  background: var(--tf-line-soft);
}

/* 「关闭」是不可逆操作，用描边而不是实心：视觉上比「编辑」轻，减少误点 */
.act--close {
  background: transparent;
  border: 2rpx solid var(--tf-line-soft);
}

.act-t {
  font-size: 24rpx;
  color: var(--tf-text-2);
}
</style>
