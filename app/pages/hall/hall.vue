<template>
  <view class="page">
    <!-- 发布入口：大厅页内唯一的发布按钮（首页悬浮按钮已取消） -->
    <view class="publish-bar" @tap="goPublish">
      <text class="publish-text">发布搭子需求</text>
      <text class="publish-plus">＋</text>
      <text class="publish-sub">每天最多 5 条</text>
    </view>

    <!-- 类型筛选 -->
    <scroll-view class="filters" scroll-x :show-scrollbar="false">
      <view class="filter-row">
        <view
          class="filter"
          :class="{ 'filter--on': type === '' }"
          @tap="setType('')"
        >
          <text class="filter-text" :class="{ 'filter-text--on': type === '' }">全部</text>
        </view>
        <view
          class="filter"
          :class="{ 'filter--on': type === t.key }"
          v-for="t in TYPES"
          :key="t.key"
          @tap="setType(t.key)"
        >
          <text class="filter-text" :class="{ 'filter-text--on': type === t.key }">
            {{ t.label }}
          </text>
        </view>
      </view>
    </scroll-view>

    <!-- 范围切换：同校 / 附近 / 城市 -->
    <view class="scope">
      <view
        class="scope-item"
        :class="{ 'scope-item--on': scope === s.key }"
        v-for="s in SCOPES"
        :key="s.key"
        @tap="setScope(s.key)"
      >
        <text class="scope-text" :class="{ 'scope-text--on': scope === s.key }">{{ s.label }}</text>
      </view>
    </view>

    <!-- 一键匹配入口：放在两级筛选之下，保持与筛选的从属关系，
         不抢「发布搭子需求」那块主视觉；带当前类型过去，空 = 不限类型 -->
    <view class="match-bar" @tap="goMatch">
      <text class="match-icon">⚡</text>
      <view class="match-main">
        <text class="match-title">一键匹配</text>
        <text class="match-sub">按标签贴合度，找出最合拍的需求</text>
      </view>
      <text class="match-go">开始 ›</text>
    </view>

    <!-- 筛选降级说明：只有真降级了才出现，正常筛选不占版面 -->
    <view class="degrade" v-if="degradeTip">
      <text class="degrade-text">ℹ️ {{ degradeTip }}</text>
    </view>

    <!-- 空态 -->
    <view class="empty-box" v-if="!loading && list.length === 0">
      <text class="empty-title">{{ emptyTitle }}</text>
      <text class="empty-hint">{{ emptyHint }}</text>
      <button class="btn" @tap="goPublish">发一条试试</button>
    </view>

    <!-- 卡片流 -->
    <view class="list">
      <view class="card" v-for="c in list" :key="c._id" @tap="openDetail(c)">
        <view class="card-top">
          <view class="avatar">{{ (c.owner.nickname || '同').slice(0, 1) }}</view>
          <view class="card-top-main">
            <view class="name-row">
              <text class="name">{{ c.owner.nickname }}</text>
              <text class="verified" v-if="c.owner.is_verified">✔ 已认证</text>
            </view>
            <text class="meta">{{ c.owner.school || '未填学校' }} · 信誉 {{ c.owner.credit_score }}</text>
          </view>
          <text class="type-tag">{{ typeLabel(c.type) }}</text>
        </view>

        <text class="title">{{ c.title }}</text>
        <text class="desc">{{ c.description }}</text>

        <!-- 标签：与我重合的高亮 -->
        <view class="tags" v-if="c.tags.length">
          <text
            class="tag"
            :class="{ 'tag--hit': c.common_tags.indexOf(t._id) > -1 }"
            v-for="t in c.tags"
            :key="t._id"
          >
            {{ t.name }}
          </text>
        </view>

        <view class="card-foot">
          <text class="foot-item" v-if="c.location_name">📍 {{ c.location_name }}</text>
          <text class="foot-item" v-if="c.start_time">🕐 {{ fmtTime(c.start_time) }}</text>
          <text class="foot-item foot-item--hit" v-if="c.common_tag_count > 0">
            同频 {{ c.common_tag_count }} 个
          </text>
          <text class="foot-item foot-item--mine" v-if="c.is_mine">我发的</text>
        </view>
      </view>
    </view>

    <!-- 加载更多 -->
    <view class="more" v-if="list.length > 0">
      <text class="more-text" v-if="loading">加载中…</text>
      <text class="more-text" v-else-if="hasMore" @tap="loadMore">上拉或点这里加载更多</text>
      <text class="more-text more-text--end" v-else>— 到底了 —</text>
    </view>
  </view>
</template>

<script>
const TYPES = [
  { key: 'study', label: '学习' },
  { key: 'fitness', label: '健身' },
  { key: 'photo', label: '拍照' },
  { key: 'meal', label: '吃饭' },
  { key: 'sport', label: '运动' },
  { key: 'other', label: '其他' }
]

const SCOPES = [
  { key: 'school', label: '同校' },
  { key: 'nearby', label: '附近' },
  { key: 'city', label: '城市' }
]

const TYPE_LABEL = {}
TYPES.forEach((t) => {
  TYPE_LABEL[t.key] = t.label
})

const PAGE_SIZE = 20

export default {
  data() {
    return {
      TYPES,
      SCOPES,
      type: '',
      scope: 'school',
      list: [],
      page: 1,
      hasMore: false,
      loading: false,
      emptyReason: '',
      // 筛选被降级时的标记（由 card-list 返回）：''=正常筛选；
      // no_city / nearby_as_school / no_location = 没城市码，退回了更大范围
      degraded: '',
      // 卡片详情页已接入（第 4 天），点卡片直接跳转
      detailTip: ''
    }
  },
  computed: {
    emptyTitle() {
      if (this.emptyReason === 'no_school') return '同校频道还没开放'
      return '这里还没有卡片'
    },
    emptyHint() {
      if (this.emptyReason === 'no_school') {
        return '完成学生认证后才能进入同校频道。你也可以先切到「附近」或「城市」看看。'
      }
      return '换个筛选条件试试，或者成为第一个发需求的人。'
    },
    // 筛选被降级时的说明。必须显示出来，否则用户以为「附近」已经筛过一遍，
    // 实际看到的是全站 —— 这种「看起来对了」的假象比直接报错更糟。
    degradeTip() {
      if (this.degraded === 'nearby_as_school') return '没填城市，先在全校范围内找'
      if (this.degraded === 'no_location') return '还没填学校和城市，先看看全站的人'
      if (this.degraded === 'no_city') return '还没填城市，先看看全站的人'
      return ''
    }
  },
  onLoad() {
    this.refresh()
  },
  // 从发布页返回时刷新，不然刚发的卡片看不到
  onShow() {
    if (this.loadedOnce) this.refresh()
    this.loadedOnce = true
  },
  // 下拉刷新
  onPullDownRefresh() {
    this.refresh().then(() => uni.stopPullDownRefresh())
  },
  // 触底加载
  onReachBottom() {
    if (this.hasMore && !this.loading) this.loadMore()
  },
  methods: {
    typeLabel(k) {
      return TYPE_LABEL[k] || '其他'
    },

    fmtTime(ts) {
      const d = new Date(ts)
      const now = new Date()
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      if (sameDay) return '今天 ' + p(d.getHours()) + ':' + p(d.getMinutes())
      return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes())
    },

    setType(k) {
      if (this.type === k) return
      this.type = k
      this.refresh()
    },

    setScope(k) {
      if (this.scope === k) return
      this.scope = k
      this.refresh()
    },

    async refresh() {
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
      try {
        const res = await uniCloud.callFunction({
          name: 'card-list',
          data: {
            token: uni.getStorageSync('token') || '',
            type: this.type,
            scope: this.scope,
            page: this.page,
            page_size: PAGE_SIZE
          }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '加载失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        this.emptyReason = d.reason || ''
        this.degraded = d.degraded || ''
        const incoming = d.list || []
        this.list = reset ? incoming : this.list.concat(incoming)
        this.hasMore = !!d.has_more
      } catch (e) {
        uni.showToast({
          title: '云函数 card-list 调用失败，检查是否已部署',
          icon: 'none',
          duration: 2500
        })
      } finally {
        this.loading = false
      }
    },

    goPublish() {
      uni.navigateTo({ url: '/pages/publish/publish' })
    },

    // 一键匹配：带上当前选中的类型（空字符串 = 不限类型）
    goMatch() {
      uni.navigateTo({ url: '/pages/match_result/match_result?type=' + this.type })
    },

    openDetail(c) {
      uni.navigateTo({ url: '/pages/detail/detail?id=' + c._id })
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx 24rpx 60rpx;
  box-sizing: border-box;
}

/* —— 发布条 —— */
.publish-bar {
  position: relative;
  background-color: var(--tf-primary);
  border-radius: 20rpx;
  padding: 30rpx 32rpx 34rpx;
  margin-bottom: 24rpx;
}
.publish-text {
  display: block;
  color: #fff;
  font-size: 36rpx;
  font-weight: 600;
  line-height: 1.3;
}
.publish-plus {
  position: absolute;
  right: 32rpx;
  top: 26rpx;
  color: #fff;
  font-size: 52rpx;
  font-weight: 300;
  line-height: 1;
}
.publish-sub {
  display: block;
  color: rgba(255, 255, 255, 0.8);
  font-size: 24rpx;
  margin-top: 8rpx;
}

/* —— 类型筛选 —— */
.filters {
  white-space: nowrap;
  margin-bottom: 20rpx;
}
.filter-row {
  display: inline-flex;
}
.filter {
  padding: 12rpx 28rpx;
  margin-right: 14rpx;
  background-color: var(--tf-card);
  border-radius: 999rpx;
  border: 2rpx solid var(--tf-line);
}
.filter--on {
  background-color: var(--tf-text);
  border-color: var(--tf-text);
}
.filter-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}
.filter-text--on {
  color: #fff;
  font-weight: 600;
}

/* —— 范围切换 —— */
.scope {
  display: flex;
  background-color: var(--tf-card);
  border-radius: 16rpx;
  padding: 6rpx;
  margin-bottom: 24rpx;
}
.scope-item {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 12rpx;
}
.scope-item--on {
  background-color: var(--tf-primary-soft);
}
.scope-text {
  font-size: 28rpx;
  color: var(--tf-text-2);
}
.scope-text--on {
  color: var(--tf-primary);
  font-weight: 600;
}

/* —— 一键匹配入口 —— */
/* 用描边而不是实心底：它是筛选项下面的一个附属动作，
   跟「发布搭子需求」的实心主按钮拉开层级，不抢视觉。 */
.match-bar {
  display: flex;
  align-items: center;
  background-color: var(--tf-card);
  border: 2rpx solid var(--tf-primary-soft);
  border-radius: 16rpx;
  padding: 18rpx 24rpx;
  margin-bottom: 24rpx;
}
.match-icon {
  font-size: 30rpx;
  margin-right: 16rpx;
}
.match-main {
  flex: 1;
  min-width: 0;
}
.match-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.match-sub {
  display: block;
  font-size: 22rpx;
  color: var(--tf-text-3);
  margin-top: 4rpx;
}
.match-go {
  font-size: 24rpx;
  color: var(--tf-primary);
  font-weight: 600;
  flex-shrink: 0;
}

/* —— 筛选降级提示 —— */
/* 用浅黄底而不是红色：这不是错误，是"给你降了一级"的说明。
   红色会让用户以为出了故障，黄色只是提醒"范围比你以为的大"。 */
.degrade {
  background-color: #fff8e1;
  border-left: 6rpx solid #f2b01e;
  border-radius: 12rpx;
  padding: 18rpx 22rpx;
  margin-bottom: 20rpx;
}
.degrade-text {
  font-size: 25rpx;
  color: #8a6100;
  line-height: 1.5;
}

/* —— 卡片流 —— */
.card {
  background-color: var(--tf-card);
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 20rpx;
}
.card-top {
  display: flex;
  align-items: flex-start;
  margin-bottom: 20rpx;
}
.avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background-color: var(--tf-primary-soft);
  color: var(--tf-primary);
  font-size: 30rpx;
  font-weight: 600;
  text-align: center;
  line-height: 72rpx;
  margin-right: 18rpx;
  flex-shrink: 0;
}
.card-top-main {
  flex: 1;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
}
.name {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
  margin-right: 12rpx;
}
.verified {
  font-size: 20rpx;
  color: var(--tf-success);
  background-color: rgba(18, 183, 106, 0.1);
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}
.meta {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-3);
  margin-top: 6rpx;
}
.type-tag {
  font-size: 22rpx;
  color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
  padding: 6rpx 16rpx;
  border-radius: 8rpx;
  flex-shrink: 0;
}

.title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-text);
  line-height: 1.4;
  margin-bottom: 12rpx;
}
.desc {
  display: block;
  font-size: 27rpx;
  color: var(--tf-text-2);
  line-height: 1.6;
}

/* —— 标签 —— */
.tags {
  display: flex;
  flex-wrap: wrap;
  margin-top: 18rpx;
}
.tag {
  font-size: 22rpx;
  color: var(--tf-text-2);
  background-color: var(--tf-bg);
  padding: 6rpx 16rpx;
  border-radius: 8rpx;
  margin: 0 12rpx 12rpx 0;
}
.tag--hit {
  color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
  font-weight: 600;
}

/* —— 卡片底部 —— */
.card-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 16rpx;
  padding-top: 18rpx;
  border-top: 2rpx solid var(--tf-line);
}
.foot-item {
  font-size: 23rpx;
  color: var(--tf-text-3);
  margin-right: 24rpx;
}
.foot-item--hit {
  color: var(--tf-primary);
  font-weight: 600;
}
.foot-item--mine {
  color: var(--tf-text-2);
  background-color: var(--tf-bg);
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
}

/* —— 空态 —— */
.empty-box {
  background-color: var(--tf-card);
  border-radius: 20rpx;
  padding: 80rpx 40rpx;
  text-align: center;
  margin-bottom: 20rpx;
}
.empty-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-text);
  margin-bottom: 16rpx;
}
.empty-hint {
  display: block;
  font-size: 26rpx;
  color: var(--tf-text-3);
  line-height: 1.6;
  margin-bottom: 36rpx;
}

.btn {
  background-color: var(--tf-primary);
  color: #fff;
  font-size: 30rpx;
  border-radius: 14rpx;
  line-height: 88rpx;
  height: 88rpx;
}
.btn::after {
  border: none;
}

/* —— 加载更多 —— */
.more {
  padding: 30rpx 0;
  text-align: center;
}
.more-text {
  font-size: 25rpx;
  color: var(--tf-text-3);
}
.more-text--end {
  color: #c3c6cc;
}
</style>
