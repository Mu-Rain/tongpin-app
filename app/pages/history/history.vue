<template>
  <view class="page">
    <view v-if="loading" class="state">
      <text class="state-text">正在加载记录…</text>
    </view>

    <block v-else>
      <!-- 汇总 -->
      <view class="sum">
        <view class="sum-item">
          <text class="sum-num">{{ list.length }}</text>
          <text class="sum-label">最近训练</text>
        </view>
        <view class="sum-item">
          <text class="sum-num">{{ totalVolume }}</text>
          <text class="sum-label">{{ volumeLabel }}</text>
        </view>
        <view class="sum-item">
          <text class="sum-num">{{ totalSets }}</text>
          <text class="sum-label">{{ setsLabel }}</text>
        </view>
      </view>

      <view v-if="!list.length" class="state">
        <text class="state-ico">📓</text>
        <text class="state-title">还没有训练记录</text>
        <text class="state-text">开始第一训练后，这里会有你的历史</text>
      </view>

      <view v-else class="list">
        <view v-for="s in list" :key="s._id" class="rec" @tap="openDetail(s)">
          <view class="rec-top">
            <text class="rec-date">{{ fmtDate(s.log_date) }}</text>
            <text class="rec-name">{{ s.plan_name || '自由训练' }}</text>
            <text class="rec-arrow">›</text>
          </view>
          <text v-if="s.note" class="rec-note">{{ s.note }}</text>
          <view class="rec-meta">
            <text class="rec-tag">{{ s.total_sets }} 组</text>
            <text class="rec-tag">{{ s.total_volume }} kg</text>
            <text class="rec-tag">{{ fmtDuration(s.duration_sec) }}</text>
          </view>
          <view v-if="s.muscles && s.muscles.length" class="rec-muscles">
            <text v-for="(m, mi) in s.muscles" :key="mi" class="rec-muscle">{{ muscleName(m) }}</text>
          </view>
        </view>

        <view v-if="loadingMore" class="more">
          <text class="more-text">正在加载更多…</text>
        </view>
        <view v-else-if="!hasMore" class="more">
          <text class="more-text">只到这里了</text>
        </view>
      </view>
    </block>

    <!-- 详情弹层 -->
    <view v-if="detail" class="mask" @tap="closeDetail">
      <view class="sheet" @tap.stop>
        <view class="sheet-head">
          <view class="sheet-head-main">
            <text class="sheet-title">{{ detail.session.plan_name || '自由训练' }}</text>
            <text class="sheet-sub">{{ fmtDate(detail.session.log_date) }} · {{ detail.session.total_sets }} 组 · {{ detail.session.total_volume }} kg</text>
          </view>
          <text class="sheet-close" @tap="closeDetail">✕</text>
        </view>

        <view v-if="detail.session.note" class="note-box">
          <text class="note-text">{{ detail.session.note }}</text>
        </view>

        <scroll-view class="sheet-body" scroll-y>
          <view v-for="g in detail.groups" :key="g.exercise_id" class="group">
            <text class="group-name">{{ g.exercise_name }}</text>
            <view class="group-sets">
              <view v-for="(s, si) in g.sets" :key="s._id" class="gset">
                <text class="gset-idx">{{ si + 1 }}</text>
                <text class="gset-val">{{ s.weight }} × {{ s.reps }}</text>
                <text v-if="s.is_pr" class="gset-pr">PR</text>
              </view>
            </view>
          </view>
          <view v-if="!detail.groups.length" class="sheet-empty">
            <text class="sheet-empty-text">这次没记组</text>
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script>
import { muscleName, fmtDuration, fmtDate } from '@/common/fitness/labels.js'

export default {
  data() {
    return {
      loading: true,
      loadingMore: false,
      list: [],
      detail: null,
      page: 1,
      pageSize: 30,
      hasMore: true
    }
  },
  computed: {
    /**
     * D8：这两个数字的数据源只有 action=list 拉到的这些记录，
     * 所以措辞必须跟着数据源走，不能写「累计」——
     * 健身首页的「累计」来自 fit-session 的 stats（60 天窗口），两处不是一个口径。
     */
    volumeLabel() {
      return this.list.length ? '最近 ' + this.list.length + ' 次容量 kg' : '容量 kg'
    },
    setsLabel() {
      return this.list.length ? '最近 ' + this.list.length + ' 次组数' : '组数'
    },
    totalVolume() {
      let v = 0
      for (const s of this.list) v += Number(s.total_volume) || 0
      return Math.round(v)
    },
    totalSets() {
      let n = 0
      for (const s of this.list) n += Number(s.total_sets) || 0
      return n
    }
  },
  onShow() {
    this.load()
  },
  onPullDownRefresh() {
    this.load().then(() => uni.stopPullDownRefresh())
  },
  onReachBottom() {
    // D9：触底加载更多
    this.loadMore()
  },
  methods: {
    muscleName,
    fmtDuration,
    fmtDate,

    async call(name, data) {
      const token = uni.getStorageSync('token') || ''
      const r = await uniCloud.callFunction({
        name: name,
        data: Object.assign({ token: token }, data || {})
      })
      const res = r.result || {}
      if (res.code !== 0) throw new Error(res.msg || '请求失败')
      return res.data || {}
    },

    /** 首屏 / 刷新：从第 1 页重新拉，替换整张列表 */
    async load() {
      this.loading = true
      try {
        const d = await this.call('fit-session', { action: 'list', page: 1, page_size: this.pageSize })
        this.page = 1
        this.list = d.list || []
        this.hasMore = !!d.has_more
      } catch (e) {
        console.warn('[history] 加载失败', e.message)
        uni.showToast({ title: e.message || '加载失败', icon: 'none' })
      } finally {
        this.loading = false
      }
    },

    /** D9：加载更多。只追加，不整块替换已有列表 */
    async loadMore() {
      if (this.loading || this.loadingMore || !this.hasMore) return
      this.loadingMore = true
      const next = this.page + 1
      try {
        const d = await this.call('fit-session', { action: 'list', page: next, page_size: this.pageSize })
        const add = d.list || []
        this.page = next
        this.hasMore = !!d.has_more && add.length > 0
        if (add.length) this.list = this.list.concat(add)
      } catch (e) {
        uni.showToast({ title: e.message || '加载失败', icon: 'none' })
      } finally {
        this.loadingMore = false
      }
    },

    async openDetail(s) {
      try {
        const d = await this.call('fit-session', { action: 'detail', session_id: s._id })
        this.detail = {
          session: d.session || s,
          groups: d.groups || []
        }
      } catch (e) {
        uni.showToast({ title: e.message || '加载失败', icon: 'none' })
      }
    },

    closeDetail() {
      this.detail = null
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 24rpx 32rpx 60rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
}

.sum {
  display: flex;
  flex-direction: row;
  background-color: var(--tf-card);
  border-radius: 26rpx;
  padding: 28rpx 0;
  margin-bottom: 26rpx;
}

.sum-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.sum-num {
  font-size: 38rpx;
  font-weight: 800;
  color: var(--tf-primary);
}

.sum-label {
  font-size: 21rpx;
  color: var(--tf-text-3);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}

.more {
  display: flex;
  flex-direction: row;
  justify-content: center;
  padding: 16rpx 0 8rpx;
}

.more-text {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.rec {
  background-color: var(--tf-card);
  border-radius: 26rpx;
  padding: 26rpx 24rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.rec-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 14rpx;
}

.rec-date {
  font-size: 24rpx;
  color: var(--tf-text-3);
}

.rec-name {
  flex: 1;
  font-size: 29rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.rec-arrow {
  font-size: 30rpx;
  color: var(--tf-text-3);
}

.rec-note {
  font-size: 23rpx;
  color: var(--tf-text-2);
  line-height: 1.6;
}

.rec-meta {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
}

.rec-tag {
  font-size: 21rpx;
  color: var(--tf-text-2);
  background-color: var(--tf-bg);
  border-radius: 8rpx;
  padding: 4rpx 12rpx;
}

.rec-muscles {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10rpx;
}

.rec-muscle {
  font-size: 20rpx;
  color: var(--tf-primary);
  background-color: #FFF1ED;
  border-radius: 8rpx;
  padding: 4rpx 12rpx;
}

/* ---- 状态 ---- */
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 24rpx;
  gap: 14rpx;
}

.state-ico {
  font-size: 80rpx;
  opacity: 0.35;
}

.state-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.state-text {
  font-size: 24rpx;
  color: var(--tf-text-3);
  text-align: center;
}

/* ---- 详情弹层 ---- */
.mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  z-index: 200;
}

.sheet {
  background-color: var(--tf-card);
  border-radius: 32rpx 32rpx 0 0;
  padding: 32rpx 32rpx 40rpx;
  height: 76vh;
  display: flex;
  flex-direction: column;
  gap: 18rpx;
  box-sizing: border-box;
}

.sheet-head {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
}

.sheet-head-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 800;
  color: var(--tf-text);
}

.sheet-sub {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.sheet-close {
  font-size: 28rpx;
  color: var(--tf-text-3);
  padding: 4rpx 8rpx;
}

.note-box {
  background-color: var(--tf-bg);
  border-radius: 16rpx;
  padding: 18rpx 20rpx;
}

.note-text {
  font-size: 24rpx;
  color: var(--tf-text-2);
  line-height: 1.6;
}

.sheet-body {
  flex: 1;
  height: 0;
}

.group {
  margin-bottom: 26rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.group-name {
  font-size: 27rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.group-sets {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}

.gset {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  background-color: var(--tf-bg);
  border-radius: 12rpx;
  padding: 10rpx 16rpx;
}

.gset-idx {
  font-size: 19rpx;
  color: var(--tf-text-3);
}

.gset-val {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.gset-pr {
  font-size: 18rpx;
  color: var(--tf-primary);
  font-weight: 700;
}

.sheet-empty {
  padding: 60rpx 0;
  display: flex;
  justify-content: center;
}

.sheet-empty-text {
  font-size: 24rpx;
  color: var(--tf-text-3);
}
</style>
