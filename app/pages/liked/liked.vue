<template>
  <view class="page">

    <!-- 导航 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">喜欢</text>
    </view>

    <!-- ===== 未登录：不请求云函数，直接给登录入口 ===== -->
    <view class="state-box" v-if="needLogin">
      <text class="state-title">登录后才能看到你赞过的内容</text>
      <text class="state-hint">点赞记录是跟着账号走的，登录后你赞过的卡片和动态都会回到这里</text>
      <view class="btn" @tap="goLogin"><text class="btn-t">去登录</text></view>
    </view>

    <!-- ===== 首屏骨架 ===== -->
    <view class="skeleton" v-else-if="loading && list.length === 0">
      <view class="skel-card" v-for="n in 3" :key="n">
        <view class="skel-cover"></view>
        <view class="skel-body">
          <view class="skel-line skel-line--wide"></view>
          <view class="skel-line"></view>
          <view class="skel-line skel-line--short"></view>
        </view>
      </view>
    </view>

    <!-- ===== 首屏失败：给重试，不给白屏 ===== -->
    <view class="state-box" v-else-if="error && list.length === 0">
      <text class="state-text" @tap="refresh">加载失败，点这里重试</text>
    </view>

    <!-- ===== 空态 ===== -->
    <view class="state-box" v-else-if="!loading && list.length === 0">
      <text class="state-title">还没有点赞过任何内容</text>
      <text class="state-hint">在卡片详情或动态里点个赞，赞过的东西会按时间排在这里</text>
    </view>

    <!-- ===== 列表 ===== -->
    <view class="list">
      <view
        class="item"
        v-for="it in list"
        :key="it.kind + '_' + it.target_id"
        :class="it.alive === false ? 'item--dead' : ''"
        @tap="openItem(it)"
      >
        <image v-if="it.cover" class="cover" :src="it.cover" mode="aspectFill" />
        <view v-else class="cover cover--ph"><text class="cover-ph-t">{{ phText(it) }}</text></view>

        <view class="body">
          <view class="title-row">
            <text class="title">{{ it.title }}</text>
            <text class="dead-tag" v-if="it.alive === false">内容已删除</text>
          </view>
          <text class="summary" v-if="showSummary(it)">{{ it.summary }}</text>

          <view class="author">
            <image v-if="avaSrcOf('l' + it.kind + '_' + it.target_id)" class="avatar avatar--img ava-fade" :class="{ 'ava-fade--in': avaReadyOf('l' + it.kind + '_' + it.target_id) }" :src="avaSrcOf('l' + it.kind + '_' + it.target_id)" mode="aspectFill" @load="avaOnLoad('l' + it.kind + '_' + it.target_id)" @error="avaOnError('l' + it.kind + '_' + it.target_id, it.owner && it.owner.avatar_url)" />
            <view v-else class="avatar avatar--def" />
            <text class="author-name">{{ ownerName(it) }}</text>
            <text class="time">{{ timeLabel(it) }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- ===== 加载更多 / 到底了 ===== -->
    <view class="more" v-if="list.length > 0">
      <text class="more-text" v-if="loading">加载中…</text>
      <text class="more-text" v-else-if="error" @tap="loadMore">加载失败，点这里重试</text>
      <text class="more-text" v-else-if="hasMore" @tap="loadMore">上拉或点这里加载更多</text>
      <text class="more-text more-text--end" v-else>— 到底了 —</text>
    </view>
  </view>
</template>

<script>
/* ==========================================================================
   我喜欢的
   --------------------------------------------------------------------------
   入参：{ token, page, page_size }，token 取自本地 storage
   出参：{ code, data: { list, total, has_more } }，list 项见云函数 my-liked 契约
   取舍：列表页不做本地缓存，返回即有；三态（加载中 / 失败 / 空）+ 未登录兜底，
         任何一种都不给白屏。云函数失败只 console.warn，不弹提示打断浏览。
   ========================================================================== */
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

const PAGE_SIZE = 20

export default {
  mixins: [avatarFadeMixin],
  data() {
    return {
      list: [],
      page: 1,
      hasMore: false,
      loading: false,
      error: '',
      needLogin: false,
    }
  },
  onLoad() {
    this.init()
  },
  // 触底加载下一页
  onReachBottom() {
    if (this.hasMore && !this.loading) this.loadMore()
  },
  // pages.json 开了 enablePullDownRefresh 才会触发；无论成败都要收起
  async onPullDownRefresh() {
    await this.refresh()
    uni.stopPullDownRefresh()
  },
  methods: {
    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/mine/mine' })
      })
    },

    goLogin() {
      uni.reLaunch({ url: '/pages/login/login' })
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
          name: 'my-liked',
          data: {
            token: uni.getStorageSync('token') || '',
            page: this.page,
            page_size: PAGE_SIZE
          }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          // 401 是 token 过期：直接按未登录展示，比让用户对着「加载失败」强
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
        const incoming = d.list || []
        this.list = reset ? incoming : this.list.concat(incoming)
        this.avaSync(this.list, (it) => 'l' + it.kind + '_' + it.target_id, (it) => (it.owner && it.owner.avatar_url) || '')
        this.hasMore = !!d.has_more
      } catch (e) {
        console.warn('[liked] my-liked failed', e)
        this.error = '加载失败'
        if (!reset) this.page -= 1
      } finally {
        this.loading = false
      }
    },

    // 时间口径：今天给时刻，昨天给「昨天」，一周内给「N 天前」，再久给月日
    fmtTime(ts) {
      if (!ts) return ''
      let v = ts
      // 云函数可能给秒级时间戳，统一成毫秒，否则会显示 1970
      if (typeof v === 'number' && v < 100000000000) v = v * 1000
      const d = new Date(v)
      if (isNaN(d.getTime())) return ''
      const now = new Date()
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      const diff = Math.round((day(now) - day(d)) / 86400000)
      if (diff <= 0) return p(d.getHours()) + ':' + p(d.getMinutes())
      if (diff === 1) return '昨天'
      if (diff < 7) return diff + ' 天前'
      return (d.getMonth() + 1) + '月' + d.getDate() + '日'
    },

    timeLabel(it) {
      return '赞于 ' + this.fmtTime(it.liked_at)
    },

    // 没封面就用标题首字当占位图，连标题都没有才写「图文」
    phText(it) {
      const t = ((it && it.title) || '') + ''
      return t ? t.slice(0, 1) : '图文'
    },

    // 摘要和标题一模一样时只显示一份，别把同一句话排两遍
    showSummary(it) {
      if (!it || !it.summary) return false
      const s = it.summary + ''
      const t = (it.title || '') + ''
      return s.trim() !== t.trim()
    },

    ownerName(it) {
      const o = (it && it.owner) || {}
      return o.nickname || '匿名用户'
    },

    openItem(it) {
      // 内容已删除：整卡降透明度，点了也不跳
      if (!it || it.alive === false) return
      const id = it.target_id
      if (!id) return
      if (it.kind === 'post') {
        uni.navigateTo({ url: '/pages/post-detail/post-detail?id=' + id })
        return
      }
      uni.navigateTo({ url: '/pages/detail/detail?id=' + id })
    }
  }
}
</script>

<style scoped>
/* ==========================================================================
   我喜欢的：白卡片 + 细描边，底色走主题，主色只用变量
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

/* 三态（未登录 / 失败 / 空） */
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
  color: var(--tf-primary-deep);
}

/* 首屏骨架：三块灰，形状和真卡片一致，切过去不跳 */
.skeleton {
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.skel-card {
  padding: 24rpx;
  display: flex;
  flex-direction: row;
  border-radius: var(--tf-r-lg);
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
}

.skel-cover {
  width: 168rpx;
  height: 168rpx;
  flex: none;
  border-radius: var(--tf-r-md);
  background: var(--tf-line-soft);
}

.skel-body {
  flex: 1;
  min-width: 0;
  margin-left: 22rpx;
  display: flex;
  flex-direction: column;
}

.skel-line {
  height: 22rpx;
  margin-bottom: 18rpx;
  border-radius: var(--tf-r-sm);
  background: var(--tf-line-soft);
}

.skel-line--wide {
  width: 70%;
}

.skel-line--short {
  width: 40%;
}

/* 列表 */
.list {
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

/* 竖卡：封面整宽在上，内容在下（原来是左图右文的横卡） */
.item {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  border-radius: 28rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  box-shadow: 0 8rpx 24rpx rgba(120, 90, 50, 0.08);
}
.item:active {
  transform: scale(0.99);
  transition: transform 140ms ease;
}
.cover-wrap {
  position: relative;
  width: 100%;
  height: 320rpx;
  background: var(--tf-line-soft);
}
.cover {
  width: 100%;
  height: 100%;
  display: block;
}
.cover--ph {
  display: flex;
  align-items: center;
  justify-content: center;
}
.body {
  padding: 24rpx 26rpx 26rpx;
  display: flex;
  flex-direction: column;
}

.title-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
}

.title {
  flex: 1;
  min-width: 0;
  display: -webkit-box;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.4;
  color: var(--tf-text);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 已删除标记：浮在封面右上，白字 + 半透明深底，任何封面上都读得清 */
.dead-tag {
  position: absolute;
  top: 18rpx;
  right: 18rpx;
  padding: 6rpx 14rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  font-weight: 600;
  color: #FFFFFF;
  background: rgba(30, 24, 20, 0.62);
}

.summary {
  display: -webkit-box;
  margin-top: 8rpx;
  font-size: 23rpx;
  line-height: 1.5;
  color: var(--tf-text-2);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 作者行钉在卡片底部，时间靠右 = 右下角 */
.author {
  margin-top: auto;
  padding-top: 16rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.avatar {
  width: 44rpx;
  height: 44rpx;
  flex: none;
  border-radius: 50%;
  background: var(--tf-primary-soft);
  border: 2rpx solid var(--tf-line);
}

.avatar--img {
  display: block;
  overflow: hidden;
  background: var(--tf-card-line);
}

.avatar--def {
  display: block;
  background: var(--tf-line-soft);
}

.author-name {
  flex: 1;
  min-width: 0;
  margin-left: 12rpx;
  font-size: 22rpx;
  color: var(--tf-text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.time {
  flex: none;
  margin-left: 12rpx;
  font-size: 20rpx;
  color: var(--tf-text-3);
}

/* 加载更多 / 到底了 */
.more {
  padding: 24rpx 0 20rpx;
  display: flex;
  justify-content: center;
}

.more-text {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.more-text--end {
  color: var(--tf-text-3);
}

/* 头像淡入：解码完成（@load）后整体亮起。用同一个节点切 class，不摘挂 —— 摘挂会让头像位塌一下再回来 */
.ava-fade {
  opacity: 0;
  transition: opacity 160ms ease-out;
}
.ava-fade--in {
  opacity: 1;
}
</style>
