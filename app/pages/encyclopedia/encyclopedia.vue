<template>
  <view class="page">
    <!-- 标题常驻页面内：列表页是「翻往期」的地方，比只写导航栏更容易被认出来 -->
    <view class="hero">
      <text class="hero-title">每日百科</text>
      <text class="hero-sub">一天一条，往期都在这儿</text>
    </view>

    <!-- 加载中：第一帧就占位，避免先空一片再突然长出内容 -->
    <view class="hint" v-if="loading">
      <text class="hint-text">正在加载…</text>
    </view>

    <!-- 出错：给重试入口，不把用户扔在一屏错误上 -->
    <view class="hint" v-else-if="errMsg">
      <text class="hint-text">{{ errMsg }}</text>
      <button class="btn btn--ghost" @tap="retry">重新加载</button>
    </view>

    <!-- 空：只有云函数确认一条都没有才走这里，和「加载失败」严格分开 -->
    <view class="hint" v-else-if="list.length === 0">
      <text class="hint-text">还没有百科内容</text>
    </view>

    <block v-else>
      <view class="item" v-for="item in list" :key="item._id" @tap="openDetail(item)">
        <view class="item-head">
          <!-- 「今日」只认「发布日期 == 北京时间今天」；绝不把最近一条冒充成今天 -->
          <text class="item-today" v-if="isToday(item)">今日</text>
          <text class="item-title">{{ item.title }}</text>
        </view>

        <view class="item-meta">
          <text class="item-cat" v-if="catText(item.category)">{{ catText(item.category) }}</text>
          <text class="item-dot" v-if="catText(item.category) && item.publish_date">·</text>
          <text class="item-date" v-if="item.publish_date">{{ item.publish_date }}</text>
        </view>

        <text class="item-summary" v-if="item.summary">{{ item.summary }}</text>
      </view>

      <!-- 加载更多：has_more 为假时连这行都不出现，避免用户白拉一次 -->
      <view class="more" v-if="list.length > 0">
        <text class="more-text" v-if="loadingMore">加载中…</text>
        <text class="more-text" v-else-if="hasMore" @tap="loadMore">上拉或点这里加载更多</text>
        <text class="more-text more-text--end" v-else>— 没有更多了 —</text>
      </view>
    </block>
  </view>
</template>

<script>
export default {
  data() {
    return {
      // 分类英文 key → 中文，口径照首页 index.vue 的 ENC_CATEGORIES。
      // 放 data 而不是顶层 const：本项目铁律是模板不许直接渲染 script 顶层常量。
      catMap: {
        study: '学习',
        health: '健康',
        life: '生活',
        campus: '校园'
      },
      list: [],
      page: 1,
      pageSize: 20,
      total: 0,
      hasMore: false,
      loading: true,
      loadingMore: false,
      errMsg: '',
      // 进页面时算一次「北京时间今天」；服务器和端上时区都可能是 UTC，现取现用会差一天
      todayStr: ''
    }
  },
  onLoad() {
    this.todayStr = this.bjToday()
    this.loadFirst(false)
  },
  onPullDownRefresh() {
    // 下拉也要重算今天：跨零点后还拿旧日期，标记就标错了
    this.todayStr = this.bjToday()
    this.loadFirst(true)
  },
  onReachBottom() {
    this.loadMore()
  },
  methods: {
    // 加 8 小时再取 UTC 日期 = 北京时间的日期，不依赖运行环境时区
    bjToday() {
      const d = new Date()
      return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
    },

    isToday(item) {
      return !!item && !!this.todayStr && item.publish_date === this.todayStr
    },

    // 未知分类兜底显示原值：新分类没来得及加映射时，宁可显示英文也别显示空白
    catText(key) {
      if (!key) return ''
      return this.catMap[key] || key
    },

    openDetail(item) {
      if (!item || !item._id) return
      uni.navigateTo({ url: '/pages/encyclopedia/detail?id=' + item._id })
    },

    retry() {
      this.loadFirst(false)
    },

    loadFirst(fromPull) {
      this.page = 1
      this.hasMore = false
      return this.load(false).then(() => {
        if (fromPull) uni.stopPullDownRefresh()
      })
    },

    loadMore() {
      if (this.loading || this.loadingMore || !this.hasMore) return
      this.load(true)
    },

    // 出参字段严格按契约读，不臆造字段名
    async load(append) {
      const nextPage = append ? this.page + 1 : 1
      if (append) this.loadingMore = true
      else {
        this.loading = true
        this.errMsg = ''
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'encyclopedia-list',
          data: { page: nextPage, page_size: this.pageSize }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          // 翻页失败不该清掉已经看到的条目，只 toast；首屏失败才占满一屏说明
          if (append) uni.showToast({ title: r.msg || '加载失败', icon: 'none' })
          else this.errMsg = r.msg || '加载失败'
          return
        }
        const d = r.data || {}
        const rows = d.list || []
        this.list = append ? this.list.concat(rows) : rows
        this.page = nextPage
        this.total = typeof d.total === 'number' ? d.total : this.list.length
        // 老版本云函数可能没下发 has_more，用 total 兜一次，别让加载更多一直挂着
        this.hasMore = typeof d.has_more === 'boolean' ? d.has_more : this.list.length < this.total
      } catch (e) {
        if (append) uni.showToast({ title: '网络不太好', icon: 'none' })
        else this.errMsg = '加载失败，请检查网络后重试'
      } finally {
        this.loading = false
        this.loadingMore = false
      }
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 32rpx 32rpx 80rpx;
  box-sizing: border-box;
  background-color: transparent;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

/* ---- 标题 ---- */
.hero {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 8rpx 4rpx;
}

.hero-title {
  font-size: 44rpx;
  font-weight: 800;
  color: var(--tf-text);
}

.hero-sub {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

/* ---- 加载 / 空 / 出错 ---- */
.hint {
  padding: 120rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
}

.hint-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
  text-align: center;
  line-height: 1.7;
}

/* ---- 列表项 ---- */
.item {
  padding: 28rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-sm);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.item-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}

/* 今日标用主色实心：一眼看到今天在哪一条，不用比对日期 */
.item-today {
  flex-shrink: 0;
  padding: 4rpx 14rpx;
  font-size: 20rpx;
  font-weight: 600;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 8rpx;
}

.item-title {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.5;
  color: var(--tf-text);
}

.item-meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10rpx;
}

.item-cat {
  padding: 2rpx 12rpx;
  font-size: 20rpx;
  color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
  border-radius: 8rpx;
}

.item-dot {
  font-size: 20rpx;
  color: var(--tf-text-2);
}

.item-date {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

/* 摘要最多两行：列表是索引不是正文，长得一样才扫得快 */
.item-summary {
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

/* ---- 加载更多 ---- */
.more {
  padding: 16rpx 0;
  text-align: center;
}

.more-text {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

.more-text--end {
  color: var(--tf-text-2);
}

/* ---- 按钮 ---- */
.btn {
  height: 92rpx;
  line-height: 92rpx;
  font-size: 32rpx;
  font-weight: 600;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 46rpx;
  border: none;
}

.btn--ghost {
  height: 76rpx;
  line-height: 76rpx;
  font-size: 28rpx;
  color: var(--tf-primary);
  background-color: transparent;
  border: 2rpx solid var(--tf-primary);
  border-radius: 38rpx;
  padding: 0 48rpx;
}
</style>
