<template>
  <view class="page">

    <!-- ===== 页头 ===== -->
    <view class="pagehead">
      <text class="pagehead-kicker">FAVORITES</text>
      <text class="pagehead-title">我的收藏</text>
      <text class="pagehead-sub" v-if="!needLogin">{{ headSub }}</text>
    </view>

    <!-- ===== 未登录：说清楚要登录，不给白屏 ===== -->
    <view class="state-box" v-if="needLogin">
      <text class="state-title">登录后查看收藏</text>
      <text class="state-hint">收藏是跟着账号走的，登录后你在详情页存下的卡片都会回到这里</text>
      <button class="btn" @tap="goLogin">去登录</button>
    </view>

    <!-- ===== 首屏加载 ===== -->
    <view class="state-box" v-else-if="loading && list.length === 0">
      <text class="state-text">加载中…</text>
    </view>

    <!-- ===== 首屏失败 ===== -->
    <view class="state-box" v-else-if="error && list.length === 0">
      <text class="state-title">没能加载你的收藏</text>
      <text class="state-hint">{{ error }}</text>
      <button class="btn" @tap="refresh">重试</button>
    </view>

    <!-- ===== 空态 ===== -->
    <view class="empty-box" v-else-if="!loading && list.length === 0">
      <text class="empty-title">还没有收藏</text>
      <text class="empty-hint">还没有收藏。看到感兴趣的就去收藏一下</text>
      <button class="btn" @tap="goHall">去搭子大厅逛逛</button>
    </view>

    <!-- ===== 卡片流：视觉语言与大厅一致 ===== -->
    <view class="list">
      <view class="dcard" v-for="c in list" :key="c.card_id" @tap="openDetail(c)">
        <view class="dcard-head">
          <!-- 头像：common/avatar/avatarCache.js —— 本地落盘 + 解码完成后整体淡入。
               key 用 'fv' + card_id：同一张卡多次渲染不变，淡入不会反复触发。
               没有可用本地路径就留同尺寸空圆，绝不塞默认头像图。 -->
          <image
            v-if="avaSrcOf('fv' + c.card_id)"
            class="avatar avatar--img ava-fade"
            :class="{ 'ava-fade--in': avaReadyOf('fv' + c.card_id) }"
            :src="avaSrcOf('fv' + c.card_id)"
            mode="aspectFill"
            lazy-load="true"
            @load="avaOnLoad('fv' + c.card_id)"
            @error="avaOnError('fv' + c.card_id, c.owner.avatar_url)"
          />
          <view v-else class="avatar" />
          <view class="dcard-who">
            <view class="dcard-name-row">
              <text class="dcard-name">{{ c.owner.nickname }}</text>
              <text class="verified" v-if="c.owner.is_verified">已认证</text>
            </view>
            <text class="dcard-meta">{{ c.owner.school || '未填学校' }} · 信誉 {{ c.owner.credit_score }}</text>
          </view>
          <text class="badge-post" v-if="isPost(c)">同频圈动态</text>
          <text class="type" v-else :class="'type--' + c.type">{{ typeLabel(c.type) }}</text>
        </view>

        <!-- ===== 同频圈动态：有封面显示图，没封面显示正文文本块 ===== -->
        <block v-if="isPost(c)">
          <image class="postcover" v-if="c.cover" :src="c.cover" mode="aspectFill" lazy-load="true" />
          <text class="dcard-title" v-if="!c.cover">{{ c.title }}</text>
          <text
            class="dcard-desc"
            v-if="c.description && (c.cover || c.description !== c.title)"
          >{{ c.description }}</text>

          <view class="closedrow" v-if="!isOpen(c)">
            <text class="closed">{{ closedLabel(c) }}</text>
            <text class="closed-hint">这条动态已经不在了，收藏记录还留着</text>
          </view>

          <view class="dcard-foot">
            <text class="foot-item" v-if="c.like_count">♥ {{ c.like_count }}</text>
            <text class="foot-item foot-item--mine" v-if="c.favorited_at">收藏于 {{ fmtDay(c.favorited_at) }}</text>
          </view>
        </block>

        <!-- ===== 搭子卡：渲染与点击都保持原样 ===== -->
        <block v-else>
          <text class="dcard-title">{{ c.title }}</text>
          <text class="dcard-desc" v-if="c.description">{{ c.description }}</text>

          <!-- 卡片已经不开放了：照常显示，但把状态标在最显眼处，用户点进去之前就知道 -->
          <view class="closedrow" v-if="!isOpen(c)">
            <text class="closed">{{ closedLabel(c) }}</text>
            <text class="closed-hint">这张卡不能再申请了，收藏记录还留着</text>
          </view>

          <view class="dcard-tags" v-if="c.tags.length">
            <text class="tag" v-for="t in c.tags" :key="t._id">{{ t.name }}</text>
          </view>

          <view class="dcard-foot">
            <text class="foot-item" v-if="c.location_name">📍 {{ c.location_name }}</text>
            <text class="foot-item" v-if="c.start_time">🕐 {{ fmtTime(c.start_time) }}</text>
            <text class="foot-item foot-item--mine" v-if="c.favorited_at">收藏于 {{ fmtDay(c.favorited_at) }}</text>
          </view>
        </block>
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
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

const TYPES = [
  { key: 'study', label: '学习' },
  { key: 'fitness', label: '健身' },
  { key: 'photo', label: '拍照' },
  { key: 'meal', label: '吃饭' },
  { key: 'sport', label: '运动' },
  { key: 'other', label: '其他' }
]

const TYPE_LABEL = {}
TYPES.forEach((t) => {
  TYPE_LABEL[t.key] = t.label
})

const STATUS_LABEL = {
  open: '招募中',
  matched: '已匹配',
  closed: '已关闭',
  removed: '已下架'
}

const PAGE_SIZE = 20

export default {
  // 头像淡入的公共时序（common/avatar/avatarCache.js）
  mixins: [avatarFadeMixin],
  data() {
    return {
      list: [],
      page: 1,
      hasMore: false,
      total: 0,
      loading: false,
      // 首屏/加载更多的错误文案；列表非空时只在「加载更多」那行显示，不顶掉已有卡片
      error: '',
      needLogin: false
    }
  },

  // 头像：整页一次挂上。list 首屏重置、触底 concat，都会走这里。
  watch: {
    list: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (c) => 'fv' + (c && c.card_id),
          (c) => c && c.owner && c.owner.avatar_url
        )
      }
    }
  },
  computed: {
    headSub() {
      if (this.loading && this.total === 0) return '正在加载…'
      if (this.total === 0) return '存下来的卡片和动态会出现在这里'
      return '共 ' + this.total + ' 条收藏'
    }
  },
  onLoad() {
    this.init()
  },
  // 从详情页返回时刷新：用户可能在那边取消了收藏，不刷新就会残留一张已取消的卡
  onShow() {
    if (this.loadedOnce) this.init()
    this.loadedOnce = true
  },
  // 触底加载
  onReachBottom() {
    if (this.hasMore && !this.loading) this.loadMore()
  },
  methods: {
    typeLabel(k) {
      return TYPE_LABEL[k] || '其他'
    },

    // 服务端下发的 kind 才是权威：老数据没有这个字段 → 一律按卡片渲染
    isPost(c) {
      return c.kind === 'post'
    },

    isOpen(c) {
      return !c.deleted && c.status === 'open'
    },

    closedLabel(c) {
      if (c.deleted) return '已删除'
      return STATUS_LABEL[c.status] || '已关闭'
    },

    fmtTime(ts) {
      const d = new Date(ts)
      const now = new Date()
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      if (sameDay) return '今天 ' + p(d.getHours()) + ':' + p(d.getMinutes())
      return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes())
    },

    fmtDay(ts) {
      const d = new Date(ts)
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    },

    init() {
      const token = uni.getStorageSync('token') || ''
      // 没登录就别调云函数了 —— 调用必然 401，只会闪一条错误提示
      if (!token) {
        this.needLogin = true
        this.list = []
        this.total = 0
        this.hasMore = false
        return
      }
      this.needLogin = false
      return this.refresh()
    },

    refresh() {
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
          name: 'card-favorite',
          data: {
            action: 'list',
            token: uni.getStorageSync('token') || '',
            page: this.page,
            page_size: PAGE_SIZE
          }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          // 401 说明 token 已经失效：按未登录展示，比让用户对着「加载失败」强
          if (r.code === 401) {
            this.needLogin = true
            this.list = []
            return
          }
          this.error = r.msg || '加载失败'
          if (!reset) this.page -= 1
          return
        }
        const d = r.data || {}
        const incoming = d.list || []
        this.list = reset ? incoming : this.list.concat(incoming)
        this.hasMore = !!d.has_more
        this.total = d.total || 0
      } catch (e) {
        this.error = '云函数 card-favorite 调用失败，检查是否已部署'
        if (!reset) this.page -= 1
      } finally {
        this.loading = false
      }
    },

    openDetail(c) {
      // 动态与卡片各进各的详情页；没有 kind 的老数据继续走卡片详情
      if (this.isPost(c)) {
        uni.navigateTo({ url: '/pages/post-detail/post-detail?id=' + c.target_id })
        return
      }
      uni.navigateTo({ url: '/pages/detail/detail?id=' + c.card_id })
    },

    goHall() {
      uni.navigateTo({ url: '/pages/hall/hall' })
    },

    goLogin() {
      uni.reLaunch({ url: '/pages/login/login' })
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx 24rpx 60rpx;
  box-sizing: border-box;
  background-color: transparent;
}

/* ==========================================================================
   页头
   ========================================================================== */
.pagehead {
  display: flex;
  flex-direction: column;
  padding: 8rpx 4rpx 27rpx;
}

.pagehead-kicker {
  font-size: 20rpx;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--tf-text-3);
}

.pagehead-title {
  margin-top: 6rpx;
  font-size: 48rpx;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
  color: var(--tf-text);
}

.pagehead-sub {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--tf-text-2);
}

/* ==========================================================================
   三态：加载中 / 失败 / 未登录
   ========================================================================== */
.state-box {
  padding: 120rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.state-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.state-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.state-hint {
  margin-top: 14rpx;
  font-size: 24rpx;
  line-height: 1.6;
  text-align: center;
  color: var(--tf-text-2);
}

/* ==========================================================================
   卡片：与大厅保持一致的一套视觉语言
   ========================================================================== */
.dcard {
  padding: 29rpx 31rpx 25rpx;
  margin-bottom: 23rpx;
  border-radius: var(--tf-r-lg);
  background: var(--tf-card-strong);
  border: 2rpx solid var(--tf-card-line);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.dcard-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 19rpx;
}

.avatar {
  width: 73rpx;
  height: 73rpx;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--tf-primary-soft);
  border: 2rpx solid var(--tf-line);
  color: var(--tf-primary);
  font-size: 29rpx;
  font-weight: 600;
}

.avatar--img {
  border-radius: 50%;
  overflow: hidden;
  display: block;
  background: var(--tf-card-line);
}
.dcard-who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.dcard-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}

.dcard-name {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.verified {
  padding: 3rpx 12rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  font-weight: 600;
  color: var(--tf-mint);
  background: rgba(201, 221, 196, 0.46);
  border: 2rpx solid rgba(95, 130, 108, 0.24);
}

.dcard-meta {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: var(--tf-text-2);
}

/* 类型标：与大厅同一套色阶，冷调里靠明度分层 */
.type {
  flex: none;
  height: 42rpx;
  padding: 0 17rpx;
  display: flex;
  align-items: center;
  border-radius: 15rpx;
  font-size: 20rpx;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #1B4A72;
  background: rgba(31, 92, 172, 0.12);
}

.type--study { color: #2F5F45; background: rgba(201, 221, 196, 0.52); }
.type--fitness { color: #24634D; background: rgba(47, 125, 99, 0.14); }
.type--meal { color: #46617A; background: rgba(127, 156, 180, 0.22); }
.type--photo { color: #46617A; background: rgba(127, 156, 180, 0.18); }

/* 动态收藏的角标：占类型标的位置，换一套语义 */
.badge-post {
  flex: none;
  height: 42rpx;
  padding: 0 17rpx;
  display: flex;
  align-items: center;
  border-radius: 15rpx;
  font-size: 20rpx;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--tf-primary-deep);
  background: var(--tf-primary-soft);
  border: 2rpx solid var(--tf-line);
}

.dcard-title {
  display: block;
  margin-top: 23rpx;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.005em;
  color: var(--tf-text);
}

.dcard-desc {
  display: -webkit-box;
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 动态封面：一图顶一段正文 */
.postcover {
  display: block;
  width: 100%;
  height: 260rpx;
  margin-top: 21rpx;
  border-radius: var(--tf-r-md);
  background: var(--tf-line-soft);
}

/* 已关闭 / 已删除的卡：不隐藏，但把状态摊在标题下面 */
.closedrow {
  margin-top: 18rpx;
  padding: 14rpx 19rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 14rpx;
  border-radius: 19rpx;
  background: rgba(255, 255, 255, 0.52);
  border: 2rpx solid var(--tf-line-soft);
}

.closed {
  flex: none;
  padding: 3rpx 14rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  font-weight: 600;
  color: var(--tf-text-2);
  background: var(--tf-line-soft);
}

.closed-hint {
  flex: 1;
  font-size: 20rpx;
  line-height: 1.5;
  color: var(--tf-text-3);
}

.dcard-tags {
  margin-top: 21rpx;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}

.tag {
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  font-size: 21rpx;
  color: var(--tf-text-2);
  background: rgba(255, 255, 255, 0.55);
  border: 2rpx solid var(--tf-line-soft);
}

.dcard-foot {
  margin-top: 23rpx;
  padding-top: 21rpx;
  border-top: 2rpx solid var(--tf-line-soft);
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 23rpx;
}

.foot-item {
  font-size: 21rpx;
  color: var(--tf-text-2);
}

.foot-item--mine {
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  color: var(--tf-text-2);
  background: var(--tf-line-soft);
}

/* ==========================================================================
   空态 / 按钮 / 加载更多
   ========================================================================== */
.empty-box {
  padding: 90rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.empty-hint {
  margin-top: 14rpx;
  font-size: 24rpx;
  line-height: 1.6;
  text-align: center;
  color: var(--tf-text-2);
}

.btn {
  margin-top: 34rpx;
  padding: 0 46rpx;
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

.btn::after {
  border: none;
}

.more {
  padding: 27rpx 0 12rpx;
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
/* 头像淡入（common/avatar/avatarCache.js）：空圆 → 完整头像 160ms。
   用 opacity 不摘节点，节点一直在，不会引起行高抖动。 */
.ava-fade {
  opacity: 0;
  transition: opacity 160ms ease-out;
}

.ava-fade--in {
  opacity: 1;
}
</style>
