<template>
  <view class="page">
    <!-- 类型 -->
    <view class="card">
      <text class="label">需求类型</text>
      <view class="chips">
        <view
          class="chip"
          :class="{ 'chip--on': type === t.key }"
          v-for="t in TYPES"
          :key="t.key"
          @tap="type = t.key"
        >
          <text class="chip-text" :class="{ 'chip-text--on': type === t.key }">{{ t.label }}</text>
        </view>
      </view>
    </view>

    <!-- 标题 + 描述 -->
    <view class="card">
      <view class="label-row">
        <text class="label">一句话说清你要找什么</text>
        <text class="counter" :class="{ 'counter--warn': title.length > 30 }">
          {{ title.length }}/30
        </text>
      </view>
      <input
        class="input"
        v-model="title"
        placeholder="例：找晚上一起自习的搭子"
        placeholder-class="ph"
        :maxlength="40"
      />

      <view class="label-row label-row--gap">
        <text class="label">详细说明</text>
        <text class="counter" :class="{ 'counter--warn': description.length > 200 }">
          {{ description.length }}/200
        </text>
      </view>
      <textarea
        class="textarea"
        v-model="description"
        placeholder="说明你的时间安排、期望、对搭子的要求…"
        placeholder-class="ph"
        :maxlength="260"
      />
    </view>

    <!-- 标签 -->
    <view class="card">
      <view class="label-row">
        <text class="label">相关标签</text>
        <text class="counter" :class="{ 'counter--warn': tagIds.length > 10 }">
          已选 {{ tagIds.length }}/10
        </text>
      </view>
      <text class="hint">标签用来算你和申请者的重合度，选得越准越容易匹配到同频的人。</text>

      <view class="group" v-for="g in groups" :key="g.key">
        <text class="group-title">{{ g.label }}</text>
        <view class="chips">
          <view
            class="chip chip--sm"
            :class="{ 'chip--on': tagIds.indexOf(item._id) > -1 }"
            v-for="item in g.items"
            :key="item._id"
            @tap="toggleTag(item)"
          >
            <text
              class="chip-text"
              :class="{ 'chip-text--on': tagIds.indexOf(item._id) > -1 }"
            >
              {{ item.name }}
            </text>
          </view>
        </view>
      </view>
    </view>

    <!-- 地点与时间 -->
    <view class="card">
      <text class="label">时间和地点（选填）</text>
      <input
        class="input"
        v-model="locationName"
        placeholder="地点，例：图书馆 3 楼"
        placeholder-class="ph"
      />

      <view class="date-row">
        <picker mode="date" :value="startDate" @change="onStartDate">
          <view class="picker">
            <text class="picker-text" :class="{ 'ph-text': !startDate }">
              {{ startDate || '开始日期' }}
            </text>
          </view>
        </picker>
        <picker mode="time" :value="startTime" @change="onStartTime">
          <view class="picker">
            <text class="picker-text" :class="{ 'ph-text': !startTime }">
              {{ startTime || '开始时间' }}
            </text>
          </view>
        </picker>
      </view>
      <text class="clear-time" v-if="startDate || startTime" @tap="clearTime">清除时间</text>
    </view>

    <!-- 提交 -->
    <button class="btn" :class="{ 'btn--off': !canSubmit }" :disabled="!canSubmit || submitting" @tap="onSubmit">
      {{ submitting ? '发布中…' : '发布' }}
    </button>
    <text class="bottom-tip">发布后在大厅可见，同校的人会优先看到。每天最多 5 条。</text>
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

const CATEGORY_LABEL = {
  routine: '作息',
  intensity: '强度',
  personality: '性格',
  interest: '兴趣',
  preference: '偏好',
  subject: '科目'
}
const CATEGORY_ORDER = ['routine', 'intensity', 'personality', 'interest', 'preference', 'subject']

export default {
  data() {
    return {
      TYPES,
      type: 'study',
      title: '',
      description: '',
      locationName: '',
      startDate: '',
      startTime: '',
      tagIds: [],
      dict: [],
      submitting: false
    }
  },
  computed: {
    groups() {
      const map = {}
      this.dict.forEach((t) => {
        if (!map[t.category]) map[t.category] = []
        map[t.category].push(t)
      })
      return CATEGORY_ORDER.filter((k) => map[k] && map[k].length > 0).map((k) => ({
        key: k,
        label: CATEGORY_LABEL[k] || k,
        items: map[k]
      }))
    },
    canSubmit() {
      const t = this.title.trim()
      const d = this.description.trim()
      return !!this.type && t.length >= 1 && t.length <= 30 && d.length >= 1 && d.length <= 200
    }
  },
  onLoad() {
    this.loadTags()
  },
  methods: {
    async loadTags() {
      try {
        const res = await uniCloud.callFunction({ name: 'tag-list' })
        const r = res.result || {}
        if (r.code === 0) this.dict = r.data.list || []
      } catch (e) {
        // 标签拉不到不影响发布，只是少了个选项
      }
    },

    toggleTag(item) {
      const i = this.tagIds.indexOf(item._id)
      if (i > -1) {
        this.tagIds.splice(i, 1)
        return
      }
      if (this.tagIds.length >= 10) {
        uni.showToast({ title: '最多选 10 个标签', icon: 'none' })
        return
      }
      this.tagIds.push(item._id)
    },

    onStartDate(e) {
      this.startDate = e.detail.value
    },
    onStartTime(e) {
      this.startTime = e.detail.value
    },
    clearTime() {
      this.startDate = ''
      this.startTime = ''
    },

    // 日期 + 时间 → 毫秒时间戳。只有日期没时间时算当天 00:00
    startTimestamp() {
      if (!this.startDate) return null
      const parts = this.startDate.split('-')
      const tparts = (this.startTime || '00:00').split(':')
      const d = new Date(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10),
        parseInt(tparts[0], 10),
        parseInt(tparts[1], 10),
        0,
        0
      )
      return d.getTime()
    },

    async onSubmit() {
      if (!this.canSubmit || this.submitting) return
      const token = uni.getStorageSync('token')
      if (!token) {
        uni.showModal({
          title: '需要登录',
          content: '发布卡片需要先登录。',
          confirmText: '去登录',
          success: (r) => {
            if (r.confirm) uni.reLaunch({ url: '/pages/login/login' })
          }
        })
        return
      }

      this.submitting = true
      try {
        const res = await uniCloud.callFunction({
          name: 'card-publish',
          data: {
            token,
            type: this.type,
            title: this.title.trim(),
            description: this.description.trim(),
            location_name: this.locationName.trim(),
            start_time: this.startTimestamp(),
            expected_people: 1,
            tag_ids: this.tagIds
          }
        })
        const r = res.result || {}
        if (r.code === 0) {
          uni.showToast({ title: '发布成功', icon: 'success' })
          setTimeout(() => uni.navigateBack(), 800)
        } else {
          uni.showModal({
            title: '发布失败',
            content: r.msg || '未知错误',
            showCancel: false
          })
        }
      } catch (e) {
        uni.showModal({
          title: '调用失败',
          content: '云函数 card-publish 调用失败，检查是否已部署。\n' + (e.message || ''),
          showCancel: false
        })
      } finally {
        this.submitting = false
      }
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
.card {
  background-color: var(--tf-card);
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 20rpx;
}
.label {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.label-row--gap {
  margin-top: 36rpx;
}
.counter {
  font-size: 23rpx;
  color: var(--tf-text-3);
}
.counter--warn {
  color: var(--tf-danger);
  font-weight: 600;
}
.hint {
  display: block;
  font-size: 23rpx;
  color: var(--tf-text-3);
  line-height: 1.6;
  margin-top: 10rpx;
}

/* —— 输入 —— */
.input {
  background-color: var(--tf-bg);
  border-radius: 12rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
  color: var(--tf-text);
  margin-top: 16rpx;
}
.textarea {
  background-color: var(--tf-bg);
  border-radius: 12rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
  color: var(--tf-text);
  width: 100%;
  height: 220rpx;
  box-sizing: border-box;
  margin-top: 16rpx;
}
.ph {
  color: #b8bcc4;
}

/* —— chips —— */
.chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: 18rpx;
}
.chip {
  padding: 14rpx 30rpx;
  margin: 0 14rpx 14rpx 0;
  background-color: var(--tf-bg);
  border-radius: 999rpx;
  border: 2rpx solid transparent;
}
.chip--sm {
  padding: 10rpx 22rpx;
}
.chip--on {
  background-color: var(--tf-primary-soft);
  border-color: var(--tf-primary);
}
.chip-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}
.chip-text--on {
  color: var(--tf-primary);
  font-weight: 600;
}

.group {
  margin-top: 24rpx;
}
.group-title {
  font-size: 24rpx;
  color: var(--tf-text-3);
}

/* —— 时间 —— */
.date-row {
  display: flex;
  margin-top: 16rpx;
}
.picker {
  background-color: var(--tf-bg);
  border-radius: 12rpx;
  padding: 22rpx 24rpx;
  margin-right: 16rpx;
  min-width: 200rpx;
}
.picker-text {
  font-size: 27rpx;
  color: var(--tf-text);
}
.ph-text {
  color: #b8bcc4;
}
.clear-time {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-3);
  margin-top: 16rpx;
  text-decoration: underline;
}

/* —— 提交 —— */
.btn {
  background-color: var(--tf-primary);
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
  border-radius: 14rpx;
  line-height: 92rpx;
  height: 92rpx;
  margin-top: 12rpx;
}
.btn--off {
  background-color: #d6d9de;
}
.btn::after {
  border: none;
}
.bottom-tip {
  display: block;
  font-size: 23rpx;
  color: var(--tf-text-3);
  text-align: center;
  line-height: 1.6;
  margin-top: 20rpx;
}
</style>
