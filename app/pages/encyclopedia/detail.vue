<template>
  <view class="page">
    <!-- 加载中 -->
    <view class="hint" v-if="state === 'loading'">
      <text class="hint-text">正在加载…</text>
    </view>

    <!-- 下线 / 查无此条：云函数 404 是合法结果，说清楚再给返回，别让用户卡在空白页 -->
    <view class="hint" v-else-if="state === 'gone'">
      <text class="hint-ico">📕</text>
      <text class="hint-text">{{ goneText }}</text>
      <button class="btn btn--ghost" @tap="goBack">返回</button>
    </view>

    <!-- 网络 / 其他失败：可重试 -->
    <view class="hint" v-else-if="state === 'error'">
      <text class="hint-text">{{ errMsg }}</text>
      <button class="btn btn--ghost" @tap="load">重新加载</button>
    </view>

    <block v-else>
      <view class="card">
        <text class="title">{{ item.title }}</text>

        <view class="meta">
          <text class="cat" v-if="catText">{{ catText }}</text>
          <text class="dot" v-if="catText && item.publish_date">·</text>
          <text class="date" v-if="item.publish_date">{{ item.publish_date }}</text>
        </view>

        <text class="content">{{ item.content }}</text>
      </view>

      <button class="btn btn--ghost" @tap="goBack">返回列表</button>
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
      // loading | gone | error | ok —— 404 单独一态，因为它的文案和「重试」按钮都不一样
      state: 'loading',
      item: {},
      id: '',
      goneText: '这篇百科已经下线了',
      errMsg: ''
    }
  },
  computed: {
    // 未知分类兜底显示原值：新分类没来得及加映射时，宁可显示英文也别显示空白
    catText() {
      const key = this.item && this.item.category
      if (!key) return ''
      return this.catMap[key] || key
    }
  },
  onLoad(query) {
    this.id = (query && query.id) || ''
    if (!this.id) {
      // 没有 id 不可能是「下线」，是进了错的入口，给一句真话
      this.goneText = '没找到这篇百科'
      this.state = 'gone'
      return
    }
    this.load()
  },
  methods: {
    async load() {
      if (!this.id) return
      this.state = 'loading'
      this.errMsg = ''
      try {
        const res = await uniCloud.callFunction({
          name: 'encyclopedia-detail',
          data: { id: this.id }
        })
        const r = (res && res.result) || {}
        if (r.code === 0) {
          const d = r.data || {}
          this.item = d.item || {}
          if (!this.item._id) {
            // code 0 但没给条目等于「没有」，按下线处理，别渲染一个空壳
            this.state = 'gone'
            return
          }
          this.state = 'ok'
          return
        }
        if (r.code === 404) {
          this.state = 'gone'
          return
        }
        this.errMsg = r.msg || '加载失败'
        this.state = 'error'
      } catch (e) {
        this.errMsg = '加载失败，请检查网络后重试'
        this.state = 'error'
      }
    },

    goBack() {
      const pages = getCurrentPages()
      // 从分享 / 扫码直接进详情时栈里只有自己，navigateBack 必定失败，兜底回列表
      if (pages && pages.length > 1) {
        uni.navigateBack({ delta: 1 })
        return
      }
      uni.redirectTo({ url: '/pages/encyclopedia/encyclopedia' })
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

/* ---- 加载 / 下线 / 出错 ---- */
.hint {
  padding: 120rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
}

.hint-ico {
  font-size: 88rpx;
}

.hint-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
  text-align: center;
  line-height: 1.7;
}

/* ---- 正文卡 ---- */
.card {
  padding: 36rpx 32rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-sm);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.title {
  font-size: 40rpx;
  font-weight: 800;
  line-height: 1.4;
  color: var(--tf-text);
}

.meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10rpx;
}

.cat {
  padding: 2rpx 12rpx;
  font-size: 20rpx;
  color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
  border-radius: 8rpx;
}

.dot {
  font-size: 20rpx;
  color: var(--tf-text-2);
}

.date {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

/* 全文行高放大：这一页唯一的任务是读，密排版会让人放弃 */
.content {
  font-size: 29rpx;
  line-height: 1.9;
  color: var(--tf-text);
  white-space: pre-wrap;
  word-break: break-word;
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
