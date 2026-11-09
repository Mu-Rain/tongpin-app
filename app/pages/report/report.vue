<template>
  <view class="page">
    <!-- ===== 举报对象 ===== -->
    <view class="target-card">
      <text class="target-label">举报对象</text>
      <text class="target-name">{{ targetName }}</text>
      <text class="target-type">{{ typeLabel }}</text>
    </view>

    <!-- ===== 举报原因（单选） ===== -->
    <view class="card">
      <text class="card-title">请选择举报原因</text>
      <view class="reason-list">
        <view
          v-for="r in reasons"
          :key="r.key"
          class="reason-item"
          :class="{ 'reason-item--on': reason === r.key }"
          @tap="pickReason(r.key)"
        >
          <text class="reason-text">{{ r.label }}</text>
          <text class="reason-desc">{{ r.desc }}</text>
          <view class="radio" :class="{ 'radio--on': reason === r.key }"></view>
        </view>
      </view>
    </view>

    <!-- ===== 补充说明：只有选「其他」才展开，契约 5.4 ===== -->
    <view v-if="reason === 'other'" class="card">
      <text class="card-title">补充说明（选填）</text>
      <view class="textarea-wrap">
        <textarea
          class="textarea"
          v-model="detail"
          :maxlength="DETAIL_MAX_LEN"
          placeholder="说说具体情况，能帮我们更快处理"
          @input="onDetailInput"
        />
      </view>
      <text class="len-hint">{{ detailLen }}/{{ DETAIL_MAX_LEN }} 字</text>
    </view>

    <text class="tip">恶意举报会影响你的信誉分，请如实填写。</text>

    <button class="btn btn--block" :disabled="submitting" @tap="submit">
      {{ submitting ? '提交中…' : '提交举报' }}
    </button>
  </view>
</template>

<script>
// 举报原因枚举，必须与云函数 report-submit 的 REASON_ENUM 完全一致：
// 前端传错一个值就会被云函数 400「请选择举报原因」挡回来。
const REASONS = [
  { key: 'harassment', label: '骚扰谩骂', desc: '辱骂、人身攻击、频繁骚扰' },
  { key: 'fake', label: '虚假信息', desc: '冒充他人、伪造身份或经历' },
  { key: 'ad', label: '广告推销', desc: '拉群、卖课、刷单等营销内容' },
  { key: 'other', label: '其他', desc: '以上都不符合，请在下方说明' }
]

// 补充说明上限。云函数按 Array.from().length 数码点，这里用同一个算法，
// 否则 emoji 会被前端算成 2 个字、后端算成 1 个，两边长度提示对不上。
const DETAIL_MAX_LEN = 200

// target_type 的中文名。举报页对 user / message / card 三类都可用。
const TYPE_LABELS = {
  user: '用户',
  message: '消息',
  card: '搭子卡片',
  material: '资料'
}

export default {
  data() {
    return {
      // 路由参数
      targetType: 'user',
      targetId: '',
      targetNameRaw: '',

      reason: '',
      detail: '',
      submitting: false,

      // ★ 模块级常量必须在 data() 里注册，模板才访问得到（否则整页白屏）
      reasons: REASONS,
      DETAIL_MAX_LEN
    }
  },

  computed: {
    /** 举报对象显示名：没传 name 时退回 id 的后 6 位，绝不显示 undefined */
    targetName() {
      if (this.targetNameRaw) return this.targetNameRaw
      const id = String(this.targetId || '')
      return id ? '对象 ' + id.slice(-6) : '未知对象'
    },

    typeLabel() {
      return TYPE_LABELS[this.targetType] || '对象'
    },

    /** 按码点数长度，与云函数一致 */
    detailLen() {
      return Array.from(String(this.detail || '')).length
    }
  },

  onLoad(options) {
    const o = options || {}
    this.targetType = o.type || 'user'
    this.targetId = o.id || ''
    this.targetNameRaw = o.name ? decodeURIComponent(o.name) : ''
    if (!this.targetId) {
      uni.showToast({ title: '缺少举报对象', icon: 'none' })
      setTimeout(() => uni.navigateBack(), 800)
    }
  },

  methods: {
    pickReason(key) {
      this.reason = key
      // 从「其他」切走时把补充说明清掉，避免用户以为它还生效
      if (key !== 'other') this.detail = ''
    },

    /** 实时按码点截断，防止 emoji 把 200 字撑爆 */
    onDetailInput(e) {
      const v = (e && e.detail && e.detail.value) || ''
      const chars = Array.from(v)
      this.detail = chars.length > DETAIL_MAX_LEN ? chars.slice(0, DETAIL_MAX_LEN).join('') : v
    },

    async submit() {
      if (this.submitting) return
      if (!this.reason) {
        uni.showToast({ title: '请选择举报原因', icon: 'none' })
        return
      }
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      const payload = {
        token: token,
        target_type: this.targetType,
        target_id: this.targetId,
        reason: this.reason
      }
      // detail 只有「其他」且非空才传，避免后端存一堆空串
      const d = String(this.detail || '').trim()
      if (this.reason === 'other' && d) payload.detail = d

      this.submitting = true
      try {
        const res = await uniCloud.callFunction({ name: 'report-submit', data: payload })
        const r = res.result || {}
        if (r.code !== 0) {
          // 业务错误按 res.msg 原样提示：重复举报、举报自己等文案都在云函数里
          uni.showToast({ title: r.msg || '提交失败', icon: 'none', duration: 2500 })
          return
        }
        uni.showToast({ title: '举报已提交，我们会尽快处理', icon: 'none', duration: 2000 })
        setTimeout(() => uni.navigateBack(), 1200)
      } catch (e) {
        uni.showToast({ title: '网络不太好', icon: 'none' })
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
  background-color: transparent;
  padding: 24rpx;
  padding-bottom: 60rpx;
}

/* ---------- 举报对象 ---------- */
.target-card {
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  border-radius: 24rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12rpx;
}
.target-label {
  font-size: 24rpx;
  color: var(--tf-text-2);
}
.target-name {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.target-type {
  font-size: 22rpx;
  color: var(--tf-text-2);
  background-color: var(--tf-bg);
  border-radius: 8rpx;
  padding: 2rpx 12rpx;
}

/* ---------- 卡片 ---------- */
.card {
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  padding: 28rpx;
  margin-bottom: 24rpx;
}
.card-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: var(--tf-text);
  margin-bottom: 8rpx;
}

/* ---------- 原因单选 ---------- */
.reason-list {
  margin-top: 8rpx;
}
.reason-item {
  position: relative;
  padding: 22rpx 60rpx 22rpx 0;
  border-bottom: 2rpx solid var(--tf-line-soft);
}
.reason-item:last-child {
  border-bottom: none;
}
.reason-item--on .reason-text {
  color: var(--tf-primary);
}
.reason-text {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.reason-desc {
  display: block;
  font-size: 22rpx;
  color: var(--tf-text-2);
  margin-top: 6rpx;
  line-height: 1.5;
}
/* 单选圆点：靠右居中，选中时实心 */
.radio {
  position: absolute;
  right: 0;
  top: 50%;
  margin-top: -20rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 3rpx solid var(--tf-line-soft);
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  box-sizing: border-box;
}
.radio--on {
  border-color: var(--tf-primary);
  background-color: var(--tf-primary);
  box-shadow: inset 0 0 0 8rpx var(--tf-card);
}

/* ---------- 补充说明 ---------- */
.textarea-wrap {
  margin-top: 12rpx;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 16rpx;
  background-color: var(--tf-bg);
  padding: 16rpx;
}
.textarea {
  width: 100%;
  height: 200rpx;
  font-size: 26rpx;
  color: var(--tf-text);
  line-height: 1.6;
}
.len-hint {
  display: block;
  text-align: right;
  font-size: 22rpx;
  color: var(--tf-text-2);
  margin-top: 8rpx;
}

.tip {
  display: block;
  font-size: 22rpx;
  color: var(--tf-text-2);
  line-height: 1.6;
  padding: 0 8rpx 24rpx;
}

/* ---------- 按钮 ---------- */
.btn {
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
  background: var(--tf-card-strong);
  box-shadow: var(--tf-lift-sm);
  padding: 0 24rpx;
  height: 88rpx;
  line-height: 82rpx;
  font-size: 30rpx;
  font-weight: 700;
}
.btn--block {
  width: 100%;
}
</style>
