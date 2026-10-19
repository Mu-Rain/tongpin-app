<template>
  <view class="page">
    <!-- 结果摘要：告诉用户这就是「按标签算出来的贴合度排序」 -->
    <view class="head" v-if="!needTags && !failed && list.length > 0">
      <text class="head-title">匹配结果</text>
      <text class="head-sub">{{ type ? typeLabels[type] || type : '全部类型' }} · 按贴合度从高到低 · 共 {{ list.length }} 条</text>
      <text class="head-note">结果来自已发布的搭子需求，点一条去看原卡片</text>
    </view>

    <!-- 加载中 -->
    <view class="state-box" v-if="loading && list.length === 0">
      <text class="state-title">正在按贴合度匹配…</text>
      <text class="state-hint">拿你的标签和已发布的需求一条条比</text>
    </view>

    <!-- 一个标签都没选：算不出分母，如实告诉用户并给出口 -->
    <view class="state-box" v-else-if="needTags">
      <text class="state-title">还算不出贴合度</text>
      <text class="state-hint">{{ hint }}</text>
      <button class="btn" @tap="goTags">去选「我的标签」</button>
      <button class="btn btn--ghost" @tap="goHall">先去搭子大厅逛逛</button>
    </view>

    <!-- 请求失败 -->
    <view class="state-box" v-else-if="failed">
      <text class="state-title">匹配失败</text>
      <text class="state-hint">{{ errMsg || '云函数 match-cards 调用失败，检查是否已部署' }}</text>
      <button class="btn" @tap="reload">重试</button>
      <button class="btn btn--ghost" @tap="goHall">去搭子大厅逛逛</button>
    </view>

    <!-- 空结果：两条出口（放宽条件 / 去大厅） -->
    <view class="state-box" v-else-if="list.length === 0">
      <text class="state-title">{{ emptyTitle }}</text>
      <text class="state-hint">{{ emptyHint }}</text>
      <button class="btn" v-if="type" @tap="relax">放宽条件：不限类型</button>
      <button class="btn btn--ghost" @tap="goHall">去搭子大厅浏览</button>
    </view>

    <!-- 结果列表 -->
    <block v-else>
      <view class="card" v-for="c in list" :key="c.card_id" @tap="openDetail(c)">
        <view class="card-top">
          <image class="avatar-img" v-if="c.owner.avatar" :src="c.owner.avatar" mode="aspectFill" />
          <view class="avatar" v-else>{{ (c.owner.nickname || '同').slice(0, 1) }}</view>
          <view class="top-main">
            <view class="name-row">
              <text class="name">{{ c.owner.nickname }}</text>
              <text class="verified" v-if="c.owner.is_verified">✔ 已认证</text>
              <text class="same" v-if="c.same_school">同校</text>
            </view>
            <text class="meta">{{ typeLabel(c.type) }} · 信誉 {{ c.owner.credit_score }}</text>
          </view>
          <view class="score">
            <text class="score-num">{{ c.score }}%</text>
            <text class="score-label">贴合度</text>
          </view>
        </view>

        <text class="title">{{ c.title }}</text>
        <text class="desc">{{ c.description }}</text>

        <view class="tags" v-if="c.common_tags.length">
          <text class="tags-label">共同标签</text>
          <text class="tag" v-for="t in c.common_tags" :key="t.tag_id">{{ t.name }}</text>
        </view>

        <view class="card-foot">
          <text class="foot-item">共同标签 {{ c.common_tag_count }} 个</text>
          <text class="foot-item" v-if="c.created_at">发布于 {{ fmtTime(c.created_at) }}</text>
          <text class="foot-item foot-item--go">查看原需求 ›</text>
        </view>
      </view>

      <view class="more">
        <text class="more-text" v-if="loading">换一批中…</text>
        <text class="more-text more-text--tap" v-else @tap="nextBatch">换一批</text>
      </view>
    </block>
  </view>
</template>

<script>
const TYPE_LABEL = {
  study: '学习',
  fitness: '健身',
  photo: '拍照',
  meal: '吃饭',
  sport: '运动',
  other: '其他'
}

const PAGE_LIMIT = 10
const MAX_EXCLUDE = 200

export default {
  data() {
    return {
      typeLabels: TYPE_LABEL,
      type: '',
      list: [],
      // 「换一批」时把已展示过的 card_id 累积进来，服务端据此排除
      excludeIds: [],
      loading: false,
      failed: false,
      errMsg: '',
      // 服务端返回 need_tags=true 表示我一个标签都没选，list 一定为空
      needTags: false,
      hint: ''
    }
  },
  computed: {
    emptyTitle() {
      if (this.excludeIds.length) return '这一轮的匹配已经看完了'
      if (this.type) return '当前没有匹配的搭子'
      return '当前没有匹配的搭子'
    },
    emptyHint() {
      if (this.excludeIds.length) {
        return '已经展示过的需求不会再出现。可以放宽条件重新开始，或者去搭子大厅自己挑。'
      }
      if (this.type) {
        return '还没人发过与你的标签重合的「' + this.typeLabel(this.type) + '」需求。'
      }
      return '还没人发过与你的标签重合的需求。换个时间再来，或者自己先发一条。'
    }
  },
  onLoad(options) {
    // 从大厅带过来的当前类型筛选；空字符串 = 不限类型
    const t = options && options.type ? options.type : ''
    this.type = t
    this.fetchList()
  },
  onPullDownRefresh() {
    this.reload().then(() => uni.stopPullDownRefresh())
  },
  methods: {
    typeLabel(k) {
      return TYPE_LABEL[k] || '其他'
    },

    fmtTime(ts) {
      const d = new Date(ts)
      const now = new Date()
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      const sameYear = d.getFullYear() === now.getFullYear()
      const md = d.getMonth() + 1 + '月' + d.getDate() + '日'
      return (sameYear ? '' : d.getFullYear() + '年') + md
    },

    async callMatch() {
      const token = uni.getStorageSync('token') || ''
      const res = await uniCloud.callFunction({
        name: 'match-cards',
        data: {
          action: 'list',
          token: token,
          type: this.type,
          exclude_ids: this.excludeIds,
          limit: PAGE_LIMIT
        }
      })
      return res.result || {}
    },

    async fetchList() {
      if (this.loading) return
      this.loading = true
      this.failed = false
      this.errMsg = ''
      try {
        const r = await this.callMatch()
        if (r.code !== 0) {
          if (r.code === 401) {
            uni.removeStorageSync('token')
            uni.removeStorageSync('userInfo')
          }
          this.needTags = false
          this.hint = ''
          this.list = []
          this.failed = true
          this.errMsg = r.msg || '匹配失败'
          return
        }
        const d = r.data || {}
        // 跨层字段名不同名，这里显式映射，不靠同名约定
        this.needTags = !!d.need_tags
        this.hint = d.hint || ''
        this.list = d.list || []
      } catch (e) {
        this.list = []
        this.needTags = false
        this.failed = true
        this.errMsg = '云函数 match-cards 调用失败，检查是否已部署'
      } finally {
        this.loading = false
      }
    },

    // 第一次进页 / 放宽条件 / 下拉刷新：清掉已展示记录重新开始
    reload() {
      this.excludeIds = []
      return this.fetchList()
    },

    // 换一批：把当前展示过的 card_id 累积进 exclude_ids 再请求
    nextBatch() {
      if (this.loading) return
      const shown = this.list.map((c) => c.card_id)
      const merged = this.excludeIds.concat(shown)
      const seen = {}
      const dedup = []
      merged.forEach((id) => {
        if (!id || seen[id]) return
        seen[id] = true
        dedup.push(id)
      })
      this.excludeIds = dedup.slice(-MAX_EXCLUDE)
      this.fetchList()
    },

    // US-17 出口①：放宽条件 —— 清掉类型重查
    relax() {
      if (this.loading) return
      this.type = ''
      this.reload()
    },

    openDetail(c) {
      // US-18：匹配的是「已发布的需求」，点进去就是原卡片详情
      uni.navigateTo({ url: '/pages/detail/detail?id=' + c.card_id })
    },

    goTags() {
      uni.navigateTo({ url: '/pages/tags/tags' })
    },

    // US-17 出口②：去搭子大厅浏览。本页是二级页，优先返回上一页
    goHall() {
      const pages = getCurrentPages()
      if (pages && pages.length > 1) {
        uni.navigateBack()
        return
      }
      uni.navigateTo({ url: '/pages/hall/hall' })
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

/* —— 结果摘要 —— */
.head {
  margin-bottom: 24rpx;
}
.head-title {
  display: block;
  font-size: 38rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.head-sub {
  display: block;
  font-size: 25rpx;
  color: var(--tf-text-3);
  margin-top: 8rpx;
}
.head-note {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-2);
  margin-top: 6rpx;
}

/* —— 卡片 —— */
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
.avatar-img {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  margin-right: 18rpx;
  flex-shrink: 0;
  background-color: var(--tf-primary-soft);
}
.top-main {
  flex: 1;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
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
  margin-right: 10rpx;
}
.same {
  font-size: 20rpx;
  color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}
.meta {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-3);
  margin-top: 6rpx;
}

/* —— 贴合度 —— */
.score {
  flex-shrink: 0;
  text-align: right;
  padding-left: 16rpx;
}
.score-num {
  display: block;
  font-size: 40rpx;
  font-weight: 600;
  color: var(--tf-primary);
  line-height: 1.1;
}
.score-label {
  display: block;
  font-size: 20rpx;
  color: var(--tf-text-3);
  margin-top: 2rpx;
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

/* —— 共同标签 —— */
.tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 18rpx;
}
.tags-label {
  font-size: 22rpx;
  color: var(--tf-text-3);
  margin: 0 12rpx 12rpx 0;
}
.tag {
  font-size: 22rpx;
  color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
  font-weight: 600;
  padding: 6rpx 16rpx;
  border-radius: 8rpx;
  margin: 0 12rpx 12rpx 0;
}

/* —— 卡片底部 —— */
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16rpx;
  padding-top: 18rpx;
  border-top: 2rpx solid var(--tf-line);
}
.foot-item {
  font-size: 23rpx;
  color: var(--tf-text-3);
}
.foot-item--go {
  color: var(--tf-primary);
}

/* —— 状态框（加载中 / 无标签 / 失败 / 空结果）—— */
.state-box {
  background-color: var(--tf-card);
  border-radius: 20rpx;
  padding: 80rpx 40rpx;
  text-align: center;
}
.state-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-text);
  margin-bottom: 16rpx;
}
.state-hint {
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
  margin-bottom: 20rpx;
}
.btn::after {
  border: none;
}
.btn--ghost {
  background-color: var(--tf-primary-soft);
  color: var(--tf-primary);
}

/* —— 换一批 —— */
.more {
  padding: 30rpx 0;
  text-align: center;
}
.more-text {
  font-size: 25rpx;
  color: var(--tf-text-3);
}
.more-text--tap {
  color: var(--tf-primary);
  font-weight: 600;
}
</style>
