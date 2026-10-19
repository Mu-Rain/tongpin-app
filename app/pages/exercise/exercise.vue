<template>
  <view class="page">
    <!-- 搜索 -->
    <view class="search">
      <text class="search-ico">🔍</text>
      <input
        class="search-input"
        v-model="keyword"
        placeholder="搜动作名，比如 卧推 / 深蹲"
        confirm-type="search"
        @confirm="reload"
        @input="onKeywordInput"
      />
      <text v-if="keyword" class="search-clear" @tap="clearKeyword">✕</text>
    </view>

    <!-- 肌群横向栏 -->
    <scroll-view class="muscle-bar" scroll-x :show-scrollbar="false">
      <view class="muscle-row">
        <view
          class="muscle-chip"
          :class="{ 'muscle-chip--on': muscle === '' }"
          @tap="pickMuscle('')"
        >
          <text class="muscle-chip-text" :class="{ 'muscle-chip-text--on': muscle === '' }">全部</text>
        </view>
        <view
          v-for="m in muscleList"
          :key="m.key"
          class="muscle-chip"
          :class="{ 'muscle-chip--on': muscle === m.key }"
          @tap="pickMuscle(m.key)"
        >
          <text class="muscle-chip-text" :class="{ 'muscle-chip-text--on': muscle === m.key }">
            {{ muscleName(m.key) }}
          </text>
          <text class="muscle-chip-num" :class="{ 'muscle-chip-num--on': muscle === m.key }">
            {{ m.count }}
          </text>
        </view>
      </view>
    </scroll-view>

    <!-- 器械横栏 -->
    <scroll-view class="equip-bar" scroll-x :show-scrollbar="false">
      <view class="equip-row">
        <view
          class="equip-chip"
          :class="{ 'equip-chip--on': equipment === '' }"
          @tap="pickEquipment('')"
        >
          <text class="equip-text" :class="{ 'equip-text--on': equipment === '' }">不限器械</text>
        </view>
        <view
          v-for="e in equipmentList"
          :key="e.key"
          class="equip-chip"
          :class="{ 'equip-chip--on': equipment === e.key }"
          @tap="pickEquipment(e.key)"
        >
          <text class="equip-text" :class="{ 'equip-text--on': equipment === e.key }">
            {{ equipmentName(e.key) }}
          </text>
        </view>
      </view>
    </scroll-view>

    <!-- 列表 -->
    <view v-if="loading && !list.length" class="state">
      <text class="state-text">正在加载动作…</text>
    </view>

    <view v-else-if="!list.length" class="state">
      <text class="state-ico">🤷</text>
      <text class="state-title">没找到符合的动作</text>
      <text class="state-text">换个肌群或器械试试</text>
    </view>

    <view v-else class="ex-list">
      <view v-for="ex in list" :key="ex._id" class="ex" @tap="openDetail(ex)">
        <view class="ex-dot" :style="{ backgroundColor: muscleColor(ex.muscle) }"></view>
        <view class="ex-main">
          <text class="ex-name">{{ ex.name }}</text>
          <text v-if="aliasText(ex.alias)" class="ex-alias">又叫 {{ aliasText(ex.alias) }}</text>
          <view class="ex-meta">
            <text class="ex-tag">{{ muscleName(ex.muscle) }}</text>
            <text class="ex-tag">{{ equipmentName(ex.equipment) }}</text>
            <text v-if="ex.level" class="ex-tag">{{ levelName(ex.level) }}</text>
            <text v-if="ex.mechanics === 'compound'" class="ex-tag ex-tag--hot">复合</text>
          </view>
        </view>
        <view class="ex-right">
          <text class="ex-default">{{ ex.default_sets }}×{{ ex.default_reps }}</text>
          <text class="ex-arrow">›</text>
        </view>
      </view>
    </view>

    <view v-if="list.length" class="list-foot">
      <text class="list-foot-text">{{ loadingMore ? '正在加载更多…' : moreText }}</text>
    </view>

    <!-- 动作详情弹层 -->
    <view v-if="detail" class="mask" @tap="closeDetail">
      <view class="sheet" @tap.stop>
        <view class="sheet-head">
          <view class="sheet-head-main">
            <text class="sheet-title">{{ detail.name }}</text>
            <text v-if="aliasText(detail.alias)" class="sheet-alias">又叫 {{ aliasText(detail.alias) }}</text>
          </view>
          <text class="sheet-close" @tap="closeDetail">✕</text>
        </view>

        <view class="kv-row">
          <view class="kv">
            <text class="kv-k">主要肌群</text>
            <text class="kv-v">{{ muscleName(detail.muscle) }}</text>
          </view>
          <view class="kv">
            <text class="kv-k">器械</text>
            <text class="kv-v">{{ equipmentName(detail.equipment) }}</text>
          </view>
        </view>
        <view class="kv-row">
          <view class="kv">
            <text class="kv-k">具体部位</text>
            <text class="kv-v">{{ detail.muscle_sub || '——' }}</text>
          </view>
          <view class="kv" v-if="detail.force">
            <text class="kv-k">发力方式</text>
            <text class="kv-v">{{ forceName(detail.force) }}</text>
          </view>
          <view class="kv" v-if="detail.level">
            <text class="kv-k">难度</text>
            <text class="kv-v">{{ levelName(detail.level) }}</text>
          </view>
        </view>
        <view class="kv-row">
          <view class="kv">
            <text class="kv-k">协同肌群</text>
            <text class="kv-v">{{ secondaryText || '——' }}</text>
          </view>
        </view>

        <view class="default-box">
          <text class="default-title">建议</text>
          <text class="default-text">
            {{ detail.default_sets }} 组 × {{ detail.default_reps }} 次，组间休息 {{ detail.default_rest }} 秒
          </text>
        </view>

        <view v-if="detail.tip" class="tip-box">
          <text class="tip-title">要点</text>
          <text class="tip-text">{{ detail.tip }}</text>
        </view>

        <view class="sheet-btns">
          <view class="btn btn--plain" @tap="closeDetail">
            <text class="btn-text btn-text--plain">知道了</text>
          </view>
          <view class="btn btn--primary" @tap="startWithExercise">
            <text class="btn-text">用这个动作练</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import {
  muscleName,
  equipmentName,
  muscleColor,
  MUSCLE_ORDER,
  EQUIPMENT_ORDER
} from '@/common/fitness/labels.js'

const LEVEL_LABEL = {
  beginner: '入门',
  intermediate: '进阶',
  advanced: '高阶'
}

// force 有 push / pull / static 三个值，用三元会把 static 显示成「拉」
const FORCE_LABEL = {
  push: '推',
  pull: '拉',
  static: '静力'
}

// 云函数 MAX_LIMIT 就是 100，验收要求默认一次列出全部动作
const PAGE_SIZE = 100

// 输入防抖句柄：挂在模块级，不进响应式 data（小程序 setData 会序列化它）
let searchTimer = null

export default {
  data() {
    return {
      keyword: '',
      muscle: '',
      equipment: '',
      list: [],
      loading: true,
      loadingMore: false,
      page: 1,
      hasMore: false,
      muscleList: MUSCLE_ORDER.map(function (k) { return { key: k, count: 0 } }),
      equipmentList: EQUIPMENT_ORDER.map(function (k) { return { key: k, count: 0 } }),
      detail: null
    }
  },
  computed: {
    moreText() {
      if (this.loading) return ''
      return this.hasMore ? '上拉加载更多' : '没有更多了'
    },
    secondaryText() {
      const d = this.detail
      if (!d || !d.secondary || !d.secondary.length) return ''
      return d.secondary.map(muscleName).join(' / ')
    }
  },
  onLoad(options) {
    // 从健身首页或训练页带肌群进来时直接过滤
    if (options && options.muscle) this.muscle = options.muscle
  },
  onShow() {
    this.loadGroups()
    this.reload()
  },
  onPullDownRefresh() {
    Promise.all([this.loadGroups(), this.reload()]).then(function () {
      uni.stopPullDownRefresh()
    })
  },
  onReachBottom() {
    if (this.hasMore && !this.loading && !this.loadingMore) this.loadMore()
  },
  onUnload() {
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
  },
  methods: {
    muscleName,
    equipmentName,
    muscleColor,

    levelName(k) {
      return LEVEL_LABEL[k] || k || ''
    },

    forceName(k) {
      return FORCE_LABEL[k] || k || ''
    },

    /**
     * 别名在库里是数组（硬拉 = ["传统硬拉"]，杠铃划船 = ["俯身划船","划船"]）。
     * 直接 {{ ex.alias }} 会把数组原样打印成 ["传统硬拉"]，所以要拼成一句人话。
     */
    aliasText(v) {
      if (!v) return ''
      if (Array.isArray(v)) {
        return v.filter(function (s) { return !!s }).join(' / ')
      }
      return String(v)
    },

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

    async loadGroups() {
      try {
        const d = await this.call('fit-exercise', { action: 'groups' })
        if (d.muscles && d.muscles.length) this.muscleList = d.muscles
        if (d.equipments && d.equipments.length) this.equipmentList = d.equipments
      } catch (e) {
        console.warn('[exercise] 分组数量加载失败', e.message)
      }
    },

    async reload() {
      this.page = 1
      this.list = []
      this.loading = true
      await this.fetchPage(1)
      this.loading = false
    },

    async loadMore() {
      if (this.loadingMore) return
      const next = this.page + 1
      this.loadingMore = true
      const before = this.list.length
      await this.fetchPage(next)
      if (this.list.length > before) this.page = next
      this.loadingMore = false
    },

    async fetchPage(page) {
      try {
        const d = await this.call('fit-exercise', {
          action: 'list',
          muscle: this.muscle,
          equipment: this.equipment,
          keyword: this.keyword.trim(),
          page: page,
          page_size: PAGE_SIZE
        })
        const incoming = d.list || []
        if (page === 1) {
          this.list = incoming
        } else {
          this.list = this.list.concat(incoming)
        }
        this.hasMore = !!d.has_more
      } catch (e) {
        console.warn('[exercise] 列表加载失败', e.message)
        uni.showToast({ title: e.message || '加载失败', icon: 'none' })
        this.hasMore = false
      }
    },

    /** 输入防抖：连打字时不要每敲一下就请求一次 */
    onKeywordInput() {
      const self = this
      if (searchTimer) clearTimeout(searchTimer)
      searchTimer = setTimeout(function () {
        self.reload()
      }, 350)
    },

    clearKeyword() {
      this.keyword = ''
      this.reload()
    },

    pickMuscle(k) {
      this.muscle = this.muscle === k ? '' : k
      this.reload()
    },

    pickEquipment(k) {
      this.equipment = this.equipment === k ? '' : k
      this.reload()
    },

    async openDetail(ex) {
      try {
        const d = await this.call('fit-exercise', { action: 'detail', exercise_id: ex._id })
        this.detail = d.exercise || null
      } catch (e) {
        uni.showToast({ title: e.message || '加载失败', icon: 'none' })
      }
    },

    closeDetail() {
      this.detail = null
    },

    /** 带着这个动作开一次自由训练：训练页会把它预置进今天的清单 */
    startWithExercise() {
      const d = this.detail
      if (!d) return
      this.closeDetail()
      uni.navigateTo({
        url: '/pages/workout/workout?free=1&exercise_id=' + d._id +
          '&exercise_name=' + encodeURIComponent(d.name)
      })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 20rpx 32rpx 60rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
}

/* ---- 搜索 ---- */
.search {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: var(--tf-card);
  border-radius: 24rpx;
  padding: 0 24rpx;
  height: 80rpx;
  margin-bottom: 20rpx;
}

.search-ico {
  font-size: 26rpx;
  margin-right: 12rpx;
}

.search-input {
  flex: 1;
  font-size: 27rpx;
  color: var(--tf-text);
}

.search-clear {
  font-size: 26rpx;
  color: var(--tf-text-3);
  padding: 0 6rpx;
}

/* ---- 肌群栏 ---- */
.muscle-bar {
  white-space: nowrap;
  margin-bottom: 16rpx;
}

.muscle-row {
  display: flex;
  flex-direction: row;
  gap: 14rpx;
  padding: 4rpx 0;
}

.muscle-chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 12rpx 22rpx;
  background-color: var(--tf-card);
  border-radius: 20rpx;
  gap: 8rpx;
  flex-shrink: 0;
}

.muscle-chip--on {
  background-color: var(--tf-primary);
}

.muscle-chip-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.muscle-chip-text--on {
  color: #ffffff;
  font-weight: 700;
}

.muscle-chip-num {
  font-size: 20rpx;
  color: var(--tf-text-3);
}

.muscle-chip-num--on {
  color: rgba(255, 255, 255, 0.8);
}

/* ---- 器械栏 ---- */
.equip-bar {
  white-space: nowrap;
  margin-bottom: 28rpx;
}

.equip-row {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
}

.equip-chip {
  padding: 8rpx 18rpx;
  border-radius: 14rpx;
  border: 2rpx solid var(--tf-line);
  background-color: transparent;
  flex-shrink: 0;
}

.equip-chip--on {
  border-color: var(--tf-primary);
  background-color: #FFF1ED;
}

.equip-text {
  font-size: 23rpx;
  color: var(--tf-text-3);
}

.equip-text--on {
  color: var(--tf-primary);
  font-weight: 600;
}

/* ---- 列表 ---- */
.ex-list {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.ex {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: var(--tf-card);
  border-radius: 24rpx;
  padding: 24rpx 24rpx 24rpx 20rpx;
  gap: 18rpx;
}

.ex-dot {
  width: 8rpx;
  height: 56rpx;
  border-radius: 4rpx;
  flex-shrink: 0;
}

.ex-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  min-width: 0;
}

.ex-name {
  font-size: 29rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.ex-alias {
  font-size: 21rpx;
  color: var(--tf-text-3);
}

.ex-meta {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10rpx;
}

.ex-tag {
  font-size: 20rpx;
  color: var(--tf-text-2);
  background-color: var(--tf-bg);
  border-radius: 8rpx;
  padding: 4rpx 12rpx;
}

.ex-tag--hot {
  background-color: #FFF1ED;
  color: var(--tf-primary);
}

.ex-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8rpx;
  flex-shrink: 0;
}

.ex-default {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.ex-arrow {
  font-size: 32rpx;
  color: var(--tf-text-3);
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

.list-foot {
  padding: 36rpx 0 10rpx;
  display: flex;
  justify-content: center;
}

.list-foot-text {
  font-size: 22rpx;
  color: var(--tf-text-3);
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
  padding: 36rpx 32rpx 44rpx;
  max-height: 82vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}

.sheet-head {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20rpx;
}

.sheet-head-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.sheet-title {
  font-size: 36rpx;
  font-weight: 800;
  color: var(--tf-text);
}

.sheet-alias {
  font-size: 23rpx;
  color: var(--tf-text-3);
}

.sheet-close {
  font-size: 30rpx;
  color: var(--tf-text-3);
  padding: 6rpx 10rpx;
}

.kv-row {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
}

.kv {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.kv-k {
  font-size: 21rpx;
  color: var(--tf-text-3);
}

.kv-v {
  font-size: 26rpx;
  color: var(--tf-text);
  font-weight: 600;
}

.default-box {
  background-color: var(--tf-bg);
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.default-title {
  font-size: 21rpx;
  color: var(--tf-text-3);
}

.default-text {
  font-size: 26rpx;
  color: var(--tf-text);
  font-weight: 600;
}

.tip-box {
  border-left: 6rpx solid var(--tf-primary);
  padding-left: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.tip-title {
  font-size: 21rpx;
  color: var(--tf-primary);
  font-weight: 600;
}

.tip-text {
  font-size: 24rpx;
  color: var(--tf-text-2);
  line-height: 1.7;
}

.sheet-btns {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
  margin-top: 10rpx;
}

.btn {
  flex: 1;
  height: 92rpx;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn--plain {
  background-color: var(--tf-bg);
}

.btn--primary {
  background-color: var(--tf-primary);
}

.btn-text {
  font-size: 29rpx;
  font-weight: 700;
  color: #ffffff;
}

.btn-text--plain {
  color: var(--tf-text-2);
}
</style>
