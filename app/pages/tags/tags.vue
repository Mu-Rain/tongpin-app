<template>
  <view class="page">
    <!-- 顶部：已选摘要 -->
    <view class="summary">
      <text class="summary-kicker">MY TAGS</text>
      <text class="summary-title">我的标签</text>
      <text class="summary-desc"
        >标签用来算你和别人的重合度，最多 10 个。性格类标签权重更高（1.5），
        因为性格合拍比兴趣一致更重要。</text
      >
    </view>

    <!-- 已选（点一下取消） -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">已选 {{ myTags.length }} / 10</text>
        <text class="card-count" :class="{ 'card-count--warn': myTags.length >= 10 }">
          {{ myTags.length >= 10 ? '已满' : '还能选 ' + (10 - myTags.length) + ' 个' }}
        </text>
      </view>

      <view class="picked" v-if="myTags.length > 0">
        <view class="chip chip--on" v-for="t in myTags" :key="t.tag_id" @tap="toggle(t)">
          <text class="chip-text chip-text--on">{{ t.name }}</text>
          <text class="chip-x">×</text>
        </view>
      </view>
      <text class="empty" v-else>还没选标签 —— 从下面挑 1 到 10 个</text>
    </view>

    <!-- 分类列表 -->
    <view class="card" v-for="g in groups" :key="g.key">
      <text class="group-title">{{ g.label }}</text>
      <view class="chips">
        <view
          class="chip"
          :class="{ 'chip--on': isPicked(g.key, item) }"
          v-for="item in g.items"
          :key="item._id"
          @tap="toggle(item)"
        >
          <text class="chip-text" :class="{ 'chip-text--on': isPicked(g.key, item) }">
            {{ item.name }}
          </text>
        </view>
      </view>
    </view>

    <!-- 未登录时给个出口 -->
    <view class="card" v-if="!isLoggedIn">
      <text class="card-hint">你还没登录，标签存不了。</text>
      <button class="btn" @tap="goLogin">去登录</button>
    </view>

    <!-- 吸底保存条：滚到哪都能存 -->
    <view class="savebar" v-if="isLoggedIn">
      <text class="save-tip" v-if="savedAt">✓ 已于 {{ savedAt }} 保存</text>
      <text class="save-tip save-tip--muted" v-else>选 1–10 个标签后保存</text>
      <button class="btn btn--save" :class="{ 'btn--off': !canSave }" :disabled="!canSave" @tap="onSave">
        {{ saving ? '保存中…' : '保存标签' }}
      </button>
    </view>
  </view>
</template>

<script>
// 分类的中文名映射：库里存英文 key，界面显示中文
const CATEGORY_LABEL = {
  routine: '作息',
  intensity: '强度',
  personality: '性格',
  interest: '兴趣',
  preference: '偏好',
  subject: '科目'
}

// 显示顺序
const CATEGORY_ORDER = ['routine', 'intensity', 'personality', 'interest', 'preference', 'subject']

export default {
  data() {
    return {
      dict: [], // 全部可选标签（来自 tag-list）
      myTags: [], // 我已选的（{ tag_id, name, category, weight }）
      saving: false,
      savedAt: ''
    }
  },
  computed: {
    isLoggedIn() {
      return !!uni.getStorageSync('token')
    },
    // 按分类分组，只显示有数据的分类
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
    // 1–10 个才让存
    canSave() {
      return this.myTags.length >= 1 && this.myTags.length <= 10 && !this.saving
    }
  },
  onLoad() {
    this.loadAll()
  },
  methods: {
    isPicked(key, item) {
      return this.myTags.some((t) => t.tag_id === item._id)
    },

    // 点一下选中，再点一下取消
    toggle(item) {
      const idx = this.myTags.findIndex((t) => t.tag_id === item._id)
      if (idx > -1) {
        this.myTags.splice(idx, 1)
        return
      }
      if (this.myTags.length >= 10) {
        uni.showToast({ title: '最多选 10 个标签', icon: 'none' })
        return
      }
      this.myTags.push({
        tag_id: item._id,
        name: item.name,
        category: item.category,
        weight: item.weight || 1
      })
    },

    async loadAll() {
      // 1) 拉标签字典（不需要登录）
      try {
        const res = await uniCloud.callFunction({ name: 'tag-list' })
        const r = res.result || {}
        if (r.code === 0) {
          this.dict = r.data.list || []
        } else {
          uni.showToast({ title: r.msg || '标签字典读取失败', icon: 'none' })
        }
      } catch (e) {
        uni.showToast({
          title: '读不到标签字典，检查 tag-list 是否已部署',
          icon: 'none',
          duration: 2500
        })
      }

      // 2) 拉我已选的标签（需要登录）
      const token = uni.getStorageSync('token')
      if (token) {
        try {
          const res = await uniCloud.callFunction({
            name: 'user-tags',
            data: { action: 'get', token }
          })
          const r = res.result || {}
          if (r.code === 0) {
            this.myTags = r.data.list || []
          } else if (r.code === 3001) {
            // token 过期：清掉本地缓存，提示重登
            uni.removeStorageSync('token')
            uni.removeStorageSync('userInfo')
          }
        } catch (e) {
          // 静默失败：标签没拉回来不影响看字典
        }
      }
    },

    async onSave() {
      if (!this.canSave) return
      const token = uni.getStorageSync('token')
      if (!token) {
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      this.saving = true
      uni.showLoading({ title: '保存中…', mask: true })

      try {
        const res = await uniCloud.callFunction({
          name: 'user-tags',
          data: {
            action: 'save',
            token,
            tagIds: this.myTags.map((t) => t.tag_id)
          }
        })
        const r = res.result || {}
        uni.hideLoading()

        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '保存失败', icon: 'none', duration: 2000 })
          return
        }

        const d = new Date()
        const pad = (n) => (n < 10 ? '0' + n : '' + n)
        this.savedAt = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
        uni.showToast({ title: '保存成功', icon: 'success' })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({
          title: '网络异常：' + (e.message || '检查 user-tags 是否已部署'),
          icon: 'none',
          duration: 2500
        })
      } finally {
        this.saving = false
      }
    },

    goLogin() {
      uni.reLaunch({ url: '/pages/login/login' })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 32rpx 32rpx 200rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
}

/* ---- 顶部摘要 ---- */
.summary {
  padding: 32rpx;
  margin-bottom: 24rpx;
  border-radius: 28rpx;
  background-color: #1f2329;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.summary-kicker {
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: rgba(255, 255, 255, 0.6);
}

.summary-title {
  font-size: 40rpx;
  font-weight: 700;
  color: #ffffff;
}

.summary-desc {
  font-size: 24rpx;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.85);
}

/* ---- 卡片 ---- */
.card {
  padding: 28rpx;
  margin-bottom: 24rpx;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.card-head {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.card-count {
  font-size: 24rpx;
  color: var(--tf-text-3);
}

.card-count--warn {
  color: var(--tf-primary);
  font-weight: 700;
}

.card-hint {
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

.group-title {
  font-size: 26rpx;
  font-weight: 700;
  color: var(--tf-text-2);
}

/* ---- 标签片 ---- */
.picked,
.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 16rpx;
}

.chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  padding: 14rpx 24rpx;
  border-radius: 999rpx;
  background-color: var(--tf-bg);
  border: 2rpx solid var(--tf-line);
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
  font-weight: 700;
}

.chip-x {
  font-size: 24rpx;
  color: var(--tf-primary);
}

.empty {
  font-size: 24rpx;
  color: var(--tf-text-3);
  padding: 8rpx 0;
}

/* ---- 按钮 ---- */
.btn {
  height: 88rpx;
  line-height: 88rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 999rpx;
  border: none;
}

.btn::after {
  border: none;
}

.btn--off {
  background-color: #d8dbe0;
  color: #ffffff;
}

/* ---- 吸底保存条 ---- */
.savebar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20rpx 32rpx calc(20rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background-color: var(--tf-card);
  box-shadow: 0 -4rpx 20rpx rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.save-tip {
  font-size: 22rpx;
  color: var(--tf-success);
  text-align: center;
}

.save-tip--muted {
  color: var(--tf-text-3);
}

.btn--save {
  width: 100%;
}
</style>
