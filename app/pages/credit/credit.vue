<template>
  <view class="page">
    <!-- 顶部大号分数：这一页的主角是分数本身，规则和流水都是它的注解 -->
    <view class="hero">
      <text class="hero-score">{{ score }}</text>
      <text class="hero-level">{{ levelText }}</text>
      <text class="hero-desc">{{ levelDesc }}</text>
    </view>

    <!-- 低于 60 时先说清原因：不给发布入口又不解释，用户只会以为坏了 -->
    <view class="tip" v-if="canPublish === false">
      <text class="tip-text">信誉分低于 60，暂时不能发布卡片，完成搭子或通过认证可以加分</text>
    </view>

    <!-- 加载中 -->
    <view class="hint" v-if="loading">
      <text class="hint-text">正在加载…</text>
    </view>

    <!-- 加载失败 -->
    <view class="hint" v-else-if="errMsg">
      <text class="hint-text">{{ errMsg }}</text>
      <button class="btn btn--ghost" @tap="loadFirst">重新加载</button>
    </view>

    <block v-else>
      <!-- 怎么算的 -->
      <view class="card" v-if="rules.length > 0">
        <text class="card-title">怎么算的</text>
        <view class="rule-row" v-for="r in rules" :key="r.code">
          <text class="rule-text">{{ r.text }}</text>
          <text class="rule-delta" :class="deltaClass(r.delta)">{{ deltaText(r.delta) }}</text>
        </view>
      </view>

      <!-- 变动记录 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">变动记录</text>
          <text class="card-count">{{ total }} 条</text>
        </view>

        <text class="empty" v-if="list.length === 0">还没有记录</text>

        <view class="event" v-for="e in list" :key="e._id">
          <view class="event-main">
            <text class="event-text">{{ e.reason_text }}</text>
            <text class="event-delta" :class="deltaClass(e.delta)">{{ deltaText(e.delta) }}</text>
          </view>
          <text class="event-meta">{{ fmtTime(e.created_at) }} · 之后余额 {{ e.score_after }} 分</text>
        </view>

        <!-- 没有更多 -->
        <view class="more" v-if="list.length > 0">
          <text class="more-text" v-if="loadingMore">加载中…</text>
          <text class="more-text" v-else-if="hasMore" @tap="loadMore">上拉或点这里加载更多</text>
          <text class="more-text more-text--end" v-else>— 没有更多了 —</text>
        </view>
      </view>
    </block>

    <button class="btn" :class="{ 'btn--off': canPublish === false }" :disabled="canPublish === false" @tap="goPublish">
      去发布卡片
    </button>
  </view>
</template>

<script>
export default {
  data() {
    return {
      // 分数与等级全部来自 credit-list，前端不自己算（口径只在一处，才不会两边打架）
      score: 0,
      level: '',
      levelText: '',
      canPublish: true,
      rules: [],
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
      hasMore: false,
      loading: true,
      loadingMore: false,
      errMsg: ''
    }
  },
  computed: {
    // 等级四个值由云函数定，说明文案放前端（要改口吻不用动后端）
    levelDesc() {
      const map = {
        limited: '低于 60 分，暂时不能发布卡片',
        normal: '60–79 分，正常使用',
        good: '80–89 分，良好，发布和匹配都不受限',
        excellent: '90–100 分，优秀，同校同学更容易看到你'
      }
      return map[this.level] || '完成搭子、通过学生认证都会加分'
    }
  },
  onLoad() {
    this.loadFirst()
  },
  onPullDownRefresh() {
    this.loadFirst(true)
  },
  methods: {
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

    // 云函数出参字段严格按契约 §3.1 读，不臆造字段名
    async load(append) {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.loading = false
        this.loadingMore = false
        this.errMsg = '还没登录，先登录再看信誉分'
        return
      }
      const nextPage = append ? this.page + 1 : 1
      if (append) this.loadingMore = true
      else {
        this.loading = true
        this.errMsg = ''
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'credit-list',
          data: { token: token, page: nextPage, page_size: this.pageSize }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          // 翻页失败不该把已经看到的记录清掉，只 toast；首屏失败才占满一屏说明
          if (append) uni.showToast({ title: r.msg || '加载失败', icon: 'none' })
          else this.errMsg = r.msg || '加载失败'
          return
        }
        const d = r.data || {}
        const rows = d.list || []
        if (typeof d.score === 'number') this.score = d.score
        if (d.level) this.level = d.level
        if (d.level_text) this.levelText = d.level_text
        // 缺字段时按「能发布」处理：宁可不提示，也不要拿一个没读到的值去挡人
        this.canPublish = d.can_publish !== false
        if (!append) this.rules = d.rules || []
        this.list = append ? this.list.concat(rows) : rows
        this.page = nextPage
        this.total = typeof d.total === 'number' ? d.total : this.list.length
        this.hasMore = this.list.length < this.total
      } catch (e) {
        if (append) uni.showToast({ title: '网络不太好', icon: 'none' })
        else this.errMsg = '加载失败，请检查网络后重试'
      } finally {
        this.loading = false
        this.loadingMore = false
      }
    },

    // 正数带 + 号：一眼分辨加还是扣，比看颜色更可靠（色盲用户也读得出）
    deltaText(delta) {
      const n = typeof delta === 'number' ? delta : 0
      return n > 0 ? '+' + n : String(n)
    },

    deltaClass(delta) {
      const n = typeof delta === 'number' ? delta : 0
      return n < 0 ? 'delta--minus' : 'delta--plus'
    },

    fmtTime(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      return (
        d.getFullYear() +
        '-' +
        p(d.getMonth() + 1) +
        '-' +
        p(d.getDate()) +
        ' ' +
        p(d.getHours()) +
        ':' +
        p(d.getMinutes())
      )
    },

    goPublish() {
      if (this.canPublish === false) {
        uni.showToast({ title: '信誉分低于 60，暂时不能发布卡片', icon: 'none' })
        return
      }
      uni.navigateTo({ url: '/pages/publish/publish' })
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

/* ---- 分数卡 ---- */
.hero {
  padding: 48rpx 32rpx;
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  border-radius: 28rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.hero-score {
  font-size: 108rpx;
  font-weight: 800;
  line-height: 1.1;
  color: var(--tf-text);
}

.hero-level {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-primary);
}

.hero-desc {
  font-size: 24rpx;
  color: var(--tf-text-2);
  text-align: center;
  line-height: 1.6;
}

/* ---- 低信誉提示 ---- */
.tip {
  padding: 24rpx 28rpx;
  background-color: var(--tf-primary-soft);
  border: 2rpx solid var(--tf-primary);
  border-radius: 20rpx;
}

.tip-text {
  font-size: 24rpx;
  color: var(--tf-text-2);
  line-height: 1.7;
}

/* ---- 加载 / 失败 ---- */
.hint {
  padding: 60rpx 0;
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

/* ---- 通用卡片 ---- */
.card {
  padding: 32rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.card-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text-1);
}

.card-count {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

/* ---- 规则 ---- */
.rule-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}

.rule-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
  flex: 1;
}

.rule-delta {
  font-size: 26rpx;
  font-weight: 600;
}

/* ---- 明细 ---- */
.event {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  padding-bottom: 20rpx;
  border-bottom: 2rpx solid var(--tf-line-soft);
}

.event-main {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}

.event-text {
  font-size: 28rpx;
  color: var(--tf-text-1);
  flex: 1;
}

.event-delta {
  font-size: 30rpx;
  font-weight: 700;
}

.event-meta {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.delta--plus {
  color: var(--tf-success);
}

.delta--minus {
  color: var(--tf-danger);
}

.empty {
  font-size: 26rpx;
  color: var(--tf-text-2);
  padding: 20rpx 0;
}

/* ---- 加载更多 ---- */
.more {
  padding-top: 8rpx;
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

.btn--off {
  opacity: 0.4;
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
