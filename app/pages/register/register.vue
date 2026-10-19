<template>
  <view class="page">
    <!-- 品牌区 -->
    <view class="hero">
      <view class="brand">同频</view>
      <view class="slogan">注册后即可浏览，认证后解锁全部功能</view>
    </view>

    <view class="card">
      <!-- 手机号 -->
      <view class="field">
        <text class="label">手机号</text>
        <input
          class="input"
          type="number"
          maxlength="11"
          placeholder="请输入手机号"
          placeholder-class="ph"
          :value="phone"
          @input="onPhoneInput"
        />
      </view>

      <!-- 密码 -->
      <view class="field">
        <text class="label">密码</text>
        <input
          class="input"
          password
          maxlength="32"
          placeholder="至少 6 位"
          placeholder-class="ph"
          :value="password"
          @input="onPasswordInput"
        />
      </view>

      <!-- 确认密码 -->
      <view class="field">
        <text class="label">确认密码</text>
        <input
          class="input"
          password
          maxlength="32"
          placeholder="再输一次"
          placeholder-class="ph"
          :value="password2"
          @input="onPassword2Input"
        />
      </view>

      <!-- 昵称（选填） -->
      <view class="field">
        <text class="label">昵称<text class="optional">（选填）</text></text>
        <input
          class="input"
          maxlength="12"
          placeholder="不填就自动生成"
          placeholder-class="ph"
          :value="nickname"
          @input="onNicknameInput"
        />
      </view>

      <!-- 学校（选填，用于同校频道） -->
      <view class="field">
        <text class="label">学校<text class="optional">（选填）</text></text>
        <input
          class="input"
          maxlength="20"
          placeholder="用于进入同校频道"
          placeholder-class="ph"
          :value="school"
          @input="onSchoolInput"
        />
      </view>

      <button
        class="btn"
        :class="{ 'btn--off': !canSubmit }"
        :disabled="!canSubmit"
        @tap="onSubmit"
      >
        {{ submitting ? '注册中…' : '注册并进入' }}
      </button>

      <view class="row">
        <text class="link" @tap="goLogin">已有账号？去登录</text>
      </view>
    </view>

    <view class="tip">
      <text class="tip-text"
        >注册后默认可浏览内容；完成学生认证后，卡片会带认证标识并解锁同校频道。</text
      >
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      phone: '',
      password: '',
      password2: '',
      nickname: '',
      school: '',
      submitting: false
    }
  },
  computed: {
    // 手机号 11 位 + 两次密码都 ≥6 位且一致
    canSubmit() {
      return (
        this.phone.length === 11 &&
        this.password.length >= 6 &&
        this.password === this.password2 &&
        !this.submitting
      )
    }
  },
  methods: {
    onPhoneInput(e) {
      this.phone = e.detail.value
    },
    onPasswordInput(e) {
      this.password = e.detail.value
    },
    onPassword2Input(e) {
      this.password2 = e.detail.value
    },
    onNicknameInput(e) {
      this.nickname = e.detail.value
    },
    onSchoolInput(e) {
      this.school = e.detail.value
    },

    async onSubmit() {
      if (!this.canSubmit) return

      // 本地先拦一道，省一次网络往返
      if (this.password !== this.password2) {
        uni.showToast({ title: '两次密码不一致', icon: 'none' })
        return
      }

      this.submitting = true
      uni.showLoading({ title: '注册中…', mask: true })

      try {
        const res = await uniCloud.callFunction({
          name: 'user-register',
          data: {
            phone: this.phone,
            password: this.password,
            nickname: this.nickname,
            school: this.school
          }
        })

        const result = res.result || {}
        uni.hideLoading()

        if (result.code !== 0) {
          uni.showToast({ title: result.msg || '注册失败', icon: 'none', duration: 2000 })
          return
        }

        // 注册即登录：token 直接存下来
        uni.setStorageSync('token', result.data.token)
        uni.setStorageSync('userInfo', result.data.user)

        uni.showToast({ title: '注册成功', icon: 'success', duration: 1200 })
        setTimeout(() => {
          uni.reLaunch({ url: '/pages/index/index' })
        }, 700)
      } catch (e) {
        uni.hideLoading()
        uni.showToast({
          title: '网络异常：' + (e.message || '请检查云函数是否已部署'),
          icon: 'none',
          duration: 2500
        })
      } finally {
        this.submitting = false
      }
    },

    goLogin() {
      uni.navigateBack()
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 0 48rpx 80rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
}

.hero {
  padding: 80rpx 0 48rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.brand {
  font-size: 64rpx;
  font-weight: 700;
  color: var(--tf-text-1);
  letter-spacing: 4rpx;
}

.slogan {
  font-size: 26rpx;
  color: var(--tf-text-3);
}

.card {
  padding: 40rpx 32rpx;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 32rpx;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.label {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.optional {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.input {
  height: 88rpx;
  padding: 0 24rpx;
  font-size: 30rpx;
  color: var(--tf-text-1);
  background-color: var(--tf-bg);
  border-radius: 16rpx;
}

.ph {
  color: var(--tf-text-3);
  font-size: 28rpx;
}

.btn {
  margin-top: 8rpx;
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

.row {
  display: flex;
  flex-direction: row;
  justify-content: center;
}

.link {
  font-size: 26rpx;
  color: var(--tf-primary);
}

.tip {
  margin-top: 40rpx;
  padding: 0 8rpx;
}

.tip-text {
  font-size: 24rpx;
  color: var(--tf-text-3);
  line-height: 1.7;
}
</style>
