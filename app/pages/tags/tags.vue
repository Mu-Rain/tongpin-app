<template>
  <view class="page">
    <!-- 头图：蓝绿渐变（和「我的动态」同一套） -->
    <view class="tags-hero">
      <view class="th-blob b1" />
      <view class="th-blob b2" />
      <view class="tags-back" @tap="goBack">
        <text class="tags-back-arw">‹</text>
      </view>
      <text class="th-kicker">MY TAGS</text>
      <text class="th-title">我的标签</text>
      <text class="th-sub">标签用来算你和别人的重合度，最多 10 个。性格类权重更高（1.5），因为性格合拍比兴趣一致更重要。</text>
    </view>

    <!-- 已选：十个槽位，选了的填渐变胶囊，没选的是虚线圈 -->
    <view class="picked-box">
      <view class="pb-head">
        <view class="pb-left">
          <text class="pb-title">已选</text>
          <text class="pb-num">{{ myTags.length }}</text>
          <text class="pb-of">/ 10</text>
        </view>
        <text class="pb-hint" :class="{ 'pb-hint--full': myTags.length >= 10 }">
          {{ myTags.length >= 10 ? '已选满' : '还能选 ' + (10 - myTags.length) + ' 个' }}
        </text>
      </view>

      <view class="slots">
        <view
          class="slot slot--on"
          v-for="t in myTags"
          :key="t.tag_id"
          :class="'slot--' + (t.category || 'default')"
          @tap="removeTag(t)"
        >
          <text class="slot-text">{{ t.name }}</text>
          <text class="slot-x">×</text>
        </view>
        <view class="slot slot--empty" v-for="n in (10 - myTags.length)" :key="'e' + n">
          <text class="slot-plus">＋</text>
        </view>
      </view>
    </view>

    <!-- 分类列表 -->
    <view class="card" v-for="g in groups" :key="g.key">
      <view class="group-head">
        <view class="group-dot" :style="{ background: g.color }" />
        <text class="group-title" :style="{ color: g.color }">{{ g.label }}</text>
        <text class="group-count">{{ g.items.length }}</text>
      </view>
      <view class="chips">
        <view
          class="chip"
          :class="['chip--' + g.key, { 'chip--on': isPicked(g.key, item) }]"
          v-for="item in g.items"
          :key="item._id"
          @tap="toggle(item)"
        >
          <text class="chip-text">{{ item.name }}</text>
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

// 每个分类一套颜色（取自色卡六色）：深色做文字/描边，浅色做底
/* 每类三件套：
   c    文字色（浅底上用）
   soft 未选中的浅渐变
   grad 选中的深渐变（配白字） */
const CATEGORY_COLOR = {
  /* 每类都是【跨色相】双色渐变，和头图（蓝→青→绿）一个路子。
     soft = 未选中（更浅），grad = 选中（饱和明亮）。
     两种态都用深色字 —— 明亮底上白字会糊，深字反而更清楚，也更接近头图那种清爽感。 */
  routine: {
    c: '#1E4A7A',
    soft: 'linear-gradient(135deg, #F2F7FE 0%, #EDF9FA 100%)',
    grad: 'linear-gradient(135deg, #C6DEF7 0%, #B2E6EE 100%)'
  },
  intensity: {
    c: '#8A3A1A',
    soft: 'linear-gradient(135deg, #FFF7F2 0%, #FFF4F7 100%)',
    grad: 'linear-gradient(135deg, #FFDCC6 0%, #FFC9DA 100%)'
  },
  personality: {
    c: '#6E4A00',
    soft: 'linear-gradient(135deg, #FFFDF2 0%, #FFF9EE 100%)',
    grad: 'linear-gradient(135deg, #FFEBAE 0%, #FFD8AE 100%)'
  },
  interest: {
    c: '#33540F',
    soft: 'linear-gradient(135deg, #F8FCF2 0%, #F2FBF7 100%)',
    grad: 'linear-gradient(135deg, #D8EBBE 0%, #BEEADA 100%)'
  },
  preference: {
    c: '#3A2088',
    soft: 'linear-gradient(135deg, #F8F6FE 0%, #F4F7FE 100%)',
    grad: 'linear-gradient(135deg, #DACCF9 0%, #C8DAF9 100%)'
  },
  subject: {
    c: '#8A2A4A',
    soft: 'linear-gradient(135deg, #FFF7FA 0%, #FBF6FE 100%)',
    grad: 'linear-gradient(135deg, #FFD2E2 0%, #E8D2F9 100%)'
  }
}

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
      return CATEGORY_ORDER.filter((k) => map[k] && map[k].length > 0).map((k) => {
        const col = CATEGORY_COLOR[k] || {
          c: '#6B6259',
          soft: 'linear-gradient(135deg, #F7F4EE 0%, #F1EDE6 100%)',
          grad: 'linear-gradient(135deg, #9A9186 0%, #6B6259 100%)'
        }
        return {
          key: k,
          label: CATEGORY_LABEL[k] || k,
          items: map[k],
          color: col.c,
          soft: col.soft,
          grad: col.grad
        }
      })
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
    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/mine/mine' })
      })
    },

    isPicked(key, item) {
      return this.myTags.some((t) => t.tag_id === item._id)
    },

    // 点一下选中，再点一下取消
    /* 已选槽位点击 → 移除。不能用 toggle ——
       myTags 里的项没有 _id，toggle 里 findIndex 找不到就当成「新增」了 */
    removeTag(t) {
      const idx = this.myTags.findIndex((x) => x.tag_id === t.tag_id)
      if (idx > -1) this.myTags.splice(idx, 1)
    },

    /* 已选标签按自己所属类别取渐变 */
    gradOf(t) {
      const col = CATEGORY_COLOR[t.category]
      return col ? col.grad : 'linear-gradient(135deg, #FFE07A 0%, #F2A479 100%)'
    },

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
/* ==========================================================================
   头图：蓝绿渐变（和「我的动态」同一套）
   ========================================================================== */
.tags-hero {
  position: relative;
  overflow: hidden;
  margin: -32rpx -32rpx 28rpx;
  padding: calc(var(--status-bar-height) + 84rpx) 32rpx 40rpx;
  border-radius: 0 0 44rpx 44rpx;
  background:
    radial-gradient(56% 48% at 90% 4%, rgba(249, 208, 56, 0.46) 0%, rgba(249, 208, 56, 0) 60%),
    radial-gradient(64% 56% at 4% 98%, rgba(242, 164, 121, 0.26) 0%, rgba(242, 164, 121, 0) 62%),
    linear-gradient(152deg, #5E9BE2 0%, #6FB8D4 32%, #8FC9A8 64%, #C4D888 100%);
}
.th-blob {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.tags-hero .b1 {
  right: -80rpx;
  top: -60rpx;
  width: 320rpx;
  height: 320rpx;
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0) 76%);
}
.tags-hero .b2 {
  left: -50rpx;
  bottom: -90rpx;
  width: 260rpx;
  height: 260rpx;
  background: radial-gradient(closest-side, rgba(242, 164, 121, 0.28), rgba(242, 164, 121, 0) 76%);
}
.tags-back {
  position: absolute;
  left: 24rpx;
  top: calc(var(--status-bar-height) + 10rpx);
  width: 60rpx;
  height: 60rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  border: 1rpx solid rgba(255, 255, 255, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}
.tags-back-arw {
  color: #fff;
  font-size: 44rpx;
  line-height: 1;
  margin-top: -4rpx;
}
.th-title {
  position: relative;
  z-index: 2;
  display: block;
  font-size: 68rpx;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.06em;
  text-shadow: 3rpx 5rpx 0 rgba(34, 72, 40, 0.34), 0 10rpx 28rpx rgba(30, 66, 40, 0.22);
  transform: rotate(-2deg);
  transform-origin: left center;
}
.th-sub {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.90);
  transform: rotate(-2deg);
  transform-origin: left center;
}

/* 分组标题：色点 + 名称 + 数量 */
.group-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 18rpx;
}
.group-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: var(--gc, #6B6259);
  flex: none;
}
.group-count {
  margin-left: auto;
  font-size: 20rpx;
  color: var(--tf-text-3);
}

/* 标签的颜色由内联 style 给（不用 CSS 变量 —— APP 端对 :style 注入变量不可靠） */
.chip--on {
  box-shadow: 0 6rpx 16rpx rgba(0, 0, 0, 0.14);
}

.page {
  min-height: 100vh;
  /* 底部留出悬浮按钮的高度 + 安全区 */
  padding: 32rpx 32rpx calc(200rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  background-color: transparent;
}

/* ---- 顶部摘要 ---- */
.summary {
  padding: 32rpx;
  margin-bottom: 24rpx;
  border-radius: 28rpx;
  /* 原为深灰主卡；新方案里「深色主卡」统一是靛蓝实色卡（对齐效果图首页「今日同频」） */
  background-color: var(--tf-primary);
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
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
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
  color: var(--tf-text-2);
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
  border: 2rpx solid var(--tf-line-soft);
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
  color: var(--tf-text-2);
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
/* 保存条：悬浮胶囊，不要白底、不要顶部阴影、不要那行小字 */
.savebar {
  position: fixed;
  left: 32rpx;
  right: 32rpx;
  bottom: calc(36rpx + constant(safe-area-inset-bottom));
  bottom: calc(36rpx + env(safe-area-inset-bottom));
  padding: 0;
  background: transparent;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.savebar .save-tip {
  display: none;
}

.save-tip {
  font-size: 22rpx;
  color: var(--tf-success);
  text-align: center;
}

.save-tip--muted {
  color: var(--tf-text-2);
}

.btn--save {
  width: 100%;
}

/* 头图里的小标 */
.th-kicker {
  position: relative;
  z-index: 2;
  display: block;
  font-size: 20rpx;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: rgba(255, 255, 255, 0.72);
  margin-bottom: 12rpx;
}

/* ==========================================================================
   已选：十个槽位
   --------------------------------------------------------------------------
   选了的填渐变胶囊，没选的是虚线圈 —— 一眼能看出还剩几个位置。
   ========================================================================== */
.picked-box {
  margin: 28rpx 32rpx 0;
  background: #FFFFFF;
  border-radius: 24rpx;
  padding: 26rpx 24rpx 24rpx;
  border: 2rpx solid var(--tf-line-soft);
  box-shadow: 0 6rpx 20rpx rgba(120, 90, 50, 0.06);
}
.pb-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 20rpx;
}
.pb-left {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 8rpx;
}
.pb-title {
  font-size: 26rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.pb-num {
  font-size: 42rpx;
  font-weight: 800;
  color: #E8A800;
  line-height: 1;
}
.pb-of {
  font-size: 22rpx;
  color: var(--tf-text-3);
}
.pb-hint {
  font-size: 21rpx;
  color: var(--tf-text-3);
}
.pb-hint--full {
  color: #C4713F;
  font-weight: 700;
}

.slots {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}
.slot {
  height: 62rpx;
  padding: 0 20rpx;
  border-radius: 31rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  box-sizing: border-box;
}
/* 已选：暖黄 → 腮红的渐变 */
.slot--on {
  background: linear-gradient(135deg, #FFE07A 0%, #F2A479 100%);
  box-shadow: 0 4rpx 12rpx rgba(242, 164, 121, 0.24);
}
.slot--on:active {
  opacity: 0.7;
}
.slot-text {
  font-size: 24rpx;
  font-weight: 700;
  color: #6B4200;
  line-height: 1;
}
.slot-x {
  font-size: 22rpx;
  color: rgba(107, 66, 0, 0.55);
  line-height: 1;
}
/* 空位：虚线圈 */
.slot--empty {
  width: 62rpx;
  padding: 0;
  justify-content: center;
  border: 2rpx dashed rgba(46, 42, 38, 0.18);
  background: transparent;
}
.slot-plus {
  font-size: 26rpx;
  color: rgba(46, 42, 38, 0.26);
  line-height: 1;
}

/* 保存按钮：绿 → 蓝渐变（和头图同一套色） */
.savebar .btn--save {
  width: 100%;
  height: 96rpx;
  line-height: 96rpx;
  border-radius: 48rpx;
  background: linear-gradient(135deg, #8FB86A 0%, #3B7ADB 100%);
  color: #FFFFFF;
  font-size: 30rpx;
  font-weight: 700;
  border: none;
  box-shadow: 0 10rpx 28rpx rgba(59, 122, 219, 0.30);
}
.savebar .btn--save.btn--off {
  background: #EFE9DF;
  color: var(--tf-text-3);
  box-shadow: none;
}

/* ==========================================================================
   六类标签的跨色相渐变
   --------------------------------------------------------------------------
   必须写成 class，不能走 :style ——
   uni-app 的 :style 对象只认颜色值，background: 'linear-gradient(...)' 会被丢弃，
   真机上就退化成纯色（用户截图里就是这个现象）。
   每条都是「色相 A → 色相 B」，不是同色系深浅。
   ========================================================================== */

/* 作息：蓝 → 青 */
.chip--routine { background: linear-gradient(135deg, #F2F7FE 0%, #EDF9FA 100%); }
.chip--routine.chip--on { background: linear-gradient(135deg, #C6DEF7 0%, #B2E6EE 100%); }
.chip--routine .chip-text { color: #1E4A7A; }

/* 强度：橙 → 粉 */
.chip--intensity { background: linear-gradient(135deg, #FFF7F2 0%, #FFF4F7 100%); }
.chip--intensity.chip--on { background: linear-gradient(135deg, #FFDCC6 0%, #FFC9DA 100%); }
.chip--intensity .chip-text { color: #8A3A1A; }

/* 性格：黄 → 橙 */
.chip--personality { background: linear-gradient(135deg, #FFFDF2 0%, #FFF9EE 100%); }
.chip--personality.chip--on { background: linear-gradient(135deg, #FFEBAE 0%, #FFD8AE 100%); }
.chip--personality .chip-text { color: #6E4A00; }

/* 兴趣：绿 → 青 */
.chip--interest { background: linear-gradient(135deg, #F8FCF2 0%, #F2FBF7 100%); }
.chip--interest.chip--on { background: linear-gradient(135deg, #D8EBBE 0%, #BEEADA 100%); }
.chip--interest .chip-text { color: #33540F; }

/* 偏好：紫 → 蓝 */
.chip--preference { background: linear-gradient(135deg, #F8F6FE 0%, #F4F7FE 100%); }
.chip--preference.chip--on { background: linear-gradient(135deg, #DACCF9 0%, #C8DAF9 100%); }
.chip--preference .chip-text { color: #3A2088; }

/* 科目：粉 → 紫 */
.chip--subject { background: linear-gradient(135deg, #FFF7FA 0%, #FBF6FE 100%); }
.chip--subject.chip--on { background: linear-gradient(135deg, #FFD2E2 0%, #E8D2F9 100%); }
.chip--subject .chip-text { color: #8A2A4A; }

/* 已选槽位：同一套深渐变 */
.slot--routine { background: linear-gradient(135deg, #C6DEF7 0%, #B2E6EE 100%); }
.slot--intensity { background: linear-gradient(135deg, #FFDCC6 0%, #FFC9DA 100%); }
.slot--personality { background: linear-gradient(135deg, #FFEBAE 0%, #FFD8AE 100%); }
.slot--interest { background: linear-gradient(135deg, #D8EBBE 0%, #BEEADA 100%); }
.slot--preference { background: linear-gradient(135deg, #DACCF9 0%, #C8DAF9 100%); }
.slot--subject { background: linear-gradient(135deg, #FFD2E2 0%, #E8D2F9 100%); }
.slot--default { background: linear-gradient(135deg, #FFEBAE 0%, #FFD8AE 100%); }

/* 槽位文字统一深墨 —— 六种明亮底上都够读 */
.slot-text { color: #2E2A26; }
.slot-x { color: rgba(46, 42, 38, 0.5); }
</style>
