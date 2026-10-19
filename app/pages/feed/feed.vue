<template>
  <view class="page">
    <!-- 三栏切换（对齐原型 index.html 的同频圈屏：同校 / 地区 / 发现） -->
    <view class="seg">
      <view
        class="seg-item"
        :class="{ 'seg-item--on': tab === 'school' }"
        @tap="switchTab('school')"
      >
        <text class="seg-text">同校</text>
      </view>
      <view
        class="seg-item"
        :class="{ 'seg-item--on': tab === 'area' }"
        @tap="switchTab('area')"
      >
        <text class="seg-text">地区</text>
      </view>
      <view
        class="seg-item"
        :class="{ 'seg-item--on': tab === 'all' }"
        @tap="switchTab('all')"
      >
        <text class="seg-text">发现</text>
      </view>
    </view>

    <!-- 空态：这一期只做占位，不写真数据 -->
    <view class="empty">
      <text class="empty-ico">📰</text>
      <text class="empty-title">{{ tabTitle }}</text>
      <text class="empty-desc">{{ tabDesc }}</text>
    </view>

    <!-- 说明进度，免得看起来像坏了 -->
    <view class="card">
      <text class="card-title">这一块还没做</text>
      <text class="card-body"
        >同频圈是发日常内容的（图文 / 视频 / 吐槽），计划排在 P2。当前 11-18
        的交付范围是搭子主链 + 关系信誉 + 学习健身 + 最简后台，所以这里先占着位置，不做假数据。</text
      >
      <text class="card-note">位置已在底部导航里留好，功能接上时不用改导航结构</text>
    </view>

    <!-- 引导去真正能用的地方 -->
    <view class="guide" @tap="goHall">
      <view class="guide-main">
        <text class="guide-title">想找搭子？去搭子大厅</text>
        <text class="guide-desc">发布需求 · 看同频的人 · 已经能用了</text>
      </view>
      <text class="guide-arrow">→</text>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      tab: 'school'
    }
  },
  computed: {
    tabTitle() {
      const m = {
        school: '同校的同学还没发内容',
        area: '这个地区还没有内容',
        all: '还没有人发日常'
      }
      return m[this.tab] || ''
    },
    tabDesc() {
      const m = {
        school: '等你的学校有人发第一条，就会出现在这里',
        area: '等附近的人发第一条，就会出现在这里',
        all: '等第一个人发出来，这里就热闹了'
      }
      return m[this.tab] || ''
    }
  },
  methods: {
    switchTab(k) {
      this.tab = k
    },
    goHall() {
      uni.navigateTo({ url: '/pages/hall/hall' })
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

/* ---- 三栏切换 ---- */
.seg {
  display: flex;
  flex-direction: row;
  background-color: var(--tf-card);
  border-radius: 24rpx;
  padding: 8rpx;
  margin-bottom: 32rpx;
}

.seg-item {
  flex: 1;
  padding: 18rpx 0;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.seg-item--on {
  background-color: var(--tf-primary);
}

.seg-text {
  font-size: 28rpx;
  color: var(--tf-text-2);
}

.seg-item--on .seg-text {
  color: #ffffff;
  font-weight: 600;
}

/* ---- 空态 ---- */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 72rpx 24rpx 56rpx;
  gap: 14rpx;
}

.empty-ico {
  font-size: 96rpx;
  opacity: 0.35;
}

.empty-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.empty-desc {
  font-size: 25rpx;
  color: var(--tf-text-3);
  text-align: center;
  line-height: 1.6;
}

/* ---- 说明卡 ---- */
.card {
  padding: 28rpx;
  margin-bottom: 24rpx;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.card-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.card-body {
  font-size: 25rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
}

.card-note {
  font-size: 23rpx;
  color: var(--tf-text-3);
}

/* ---- 引导条 ---- */
.guide {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 28rpx;
  background-color: var(--tf-primary-soft);
  border-radius: 28rpx;
}

.guide-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.guide-title {
  font-size: 29rpx;
  font-weight: 600;
  color: var(--tf-primary);
}

.guide-desc {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

.guide-arrow {
  font-size: 34rpx;
  color: var(--tf-primary);
}
</style>
