<template>
  <view class="page">
    <!-- 品牌区 -->
    <view class="hero">
      <view class="brand">同频</view>
      <view class="slogan">找到同频的人</view>
    </view>

    <!-- 表单区 -->
    <view class="card">
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

      <view class="field">
        <text class="label">密码</text>
        <input
          class="input"
          password
          placeholder="请输入密码（至少 6 位）"
          placeholder-class="ph"
          :value="password"
          @input="onPasswordInput"
        />
      </view>

      <button
        class="btn"
        :class="{ 'btn--off': !canSubmit }"
        :disabled="!canSubmit"
        @tap="onLogin"
      >
        登录
      </button>

      <view class="row">
        <text class="link" @tap="onRegister">还没有账号？去注册</text>
      </view>
    </view>

    <view class="tip">
      <text class="tip-text"
        >登录状态会保存在这台手机上，下次打开 App 不用重复登录。</text
      >
    </view>

    <!-- 有本地登录态时，给一个不自动跳的入口（方便测试第二个账号） -->
    <view class="resume" v-if="resumeUser">
      <text class="resume-title">检测到已登录：{{ resumeUser.nickname }}</text>
      <text class="resume-sub">{{ resumeUser.school || '未填学校' }} · 信誉 {{ resumeUser.credit || 100 }}</text>
      <view class="resume-btns">
        <button class="btn btn--ghost" @tap="clearLogin">换个账号登录</button>
        <button class="btn" @tap="goHome">直接进首页 →</button>
      </view>
    </view>
  </view>
</template>

<script>
import book from '@/common/account/book.js'

export default {
  data() {
    return {
      phone: '',
      password: '',
      submitting: false,
      // App.vue 自动登录成功后写进来的用户信息；有值就在登录页顶部显示快捷入口
      resumeUser: null,
      // 补读一次 autoLogin 的定时器（见 onShow 注释）
      resumeTimer: null
    }
  },
  computed: {
    canSubmit() {
      return this.phone.length === 11 && this.password.length >= 6 && !this.submitting
    }
  },
  /**
   * 读自动登录结果。
   *
   * onShow 只在页面显示时触发一次，而 App.vue 的 onLaunch 里那次云函数
   * 调用是异步的 —— 它可能比登录页渲染慢。所以这里做两层：
   *   1. onShow 时读一次（快的情况，App.vue 已经写好了）
   *   2. 300ms 后再读一次（慢的情况，云函数刚返回）
   * 两次都是纯读本地缓存，不会多发请求。
   */
  onShow() {
    this.readAutoLogin()
    this.resumeTimer = setTimeout(() => {
      this.readAutoLogin()
    }, 300)
  },
  onHide() {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer)
      this.resumeTimer = null
    }
  },
  methods: {
    readAutoLogin() {
      // 已经跳走过一次就不再重复跳（onShow 会触发多次）
      if (this._jumped) return

      const info = uni.getStorageSync('userInfo')
      const auto = uni.getStorageSync('autoLogin')

      // 只有「云函数验证通过」才算数，避免拿一个过期 token 直接闯进首页
      if (info && auto && auto.state === 'ok') {
        this._jumped = true
        // ★ 改了点：以前这里只显示一个「直接进首页」的快捷按钮，停在登录页。
        //   那是为了「一台手机测两个账号」方便切号。现在有两台手机，
        //   这个前提不存在了 —— 打开 App 还要点一次才是真的烦。
        //   现在改成自动进首页；要换账号就去「我的」页点「切换账号」。
        uni.reLaunch({ url: '/pages/index/index' })
        return
      }

      this.resumeUser = null
    },

    /** 换个账号：清掉本地登录态，停在登录页 */
    clearLogin() {
      uni.showModal({
        title: '切换账号',
        content: '将退出当前账号，重新输入手机号登录',
        success: (r) => {
          if (!r.confirm) return
          uni.removeStorageSync('token')
          uni.removeStorageSync('userInfo')
          uni.removeStorageSync('autoLogin')
          this.resumeUser = null
          this.phone = ''
          this.password = ''
        }
      })
    },

    onPhoneInput(e) {
      this.phone = e.detail.value
    },
    onPasswordInput(e) {
      this.password = e.detail.value
    },

    // 第 1 天：真接口。调 user-login 云函数，成功则存 token 进首页
    async onLogin() {
      if (!this.canSubmit) return

      this.submitting = true
      uni.showLoading({ title: '登录中…', mask: true })

      try {
        const res = await uniCloud.callFunction({
          name: 'user-login',
          data: {
            phone: this.phone,
            password: this.password
          }
        })

        const result = res.result || {}
        uni.hideLoading()

        if (result.code !== 0) {
          // 云函数自己返回的错误：未注册 / 密码错 / 被封禁
          uni.showToast({ title: result.msg || '登录失败', icon: 'none', duration: 2000 })
          return
        }

        // 登录成功：token 存本地，用户信息也存一份给首页用
        uni.setStorageSync('token', result.data.token)
        uni.setStorageSync('userInfo', result.data.user)
        // 手动登录也算一次有效的自动登录结果，否则换账号后
        // 登录页的「直接进首页」入口不会出现
        uni.setStorageSync('autoLogin', { state: 'ok', at: Date.now() })

        // ★ 记进本地账号簿，以后在「切换账号」里能直接点这个号进来，不用再输密码
        try {
          book.remember({ token: result.data.token, user: result.data.user })
        } catch (e) {
          /* 账号簿写失败不能影响登录 */
        }

        uni.showToast({ title: '登录成功', icon: 'success', duration: 1000 })
        setTimeout(() => {
          uni.reLaunch({ url: '/pages/index/index' })
        }, 600)
      } catch (e) {
        // 网络/云函数没部署等情况
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

    onRegister() {
      uni.navigateTo({ url: '/pages/register/register' })
    },

    goHome() {
      uni.reLaunch({ url: '/pages/index/index' })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 0 48rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
}

.hero {
  padding: 180rpx 8rpx 72rpx;
}

.brand {
  font-size: 72rpx;
  font-weight: 700;
  letter-spacing: -2rpx;
  color: var(--tf-text);
}

.slogan {
  margin-top: 16rpx;
  font-size: 30rpx;
  color: var(--tf-text-3);
}

.card {
  background-color: var(--tf-card);
  border-radius: 28rpx;
  padding: 40rpx 36rpx 28rpx;
}

.field {
  padding: 20rpx 0;
  border-bottom: 1rpx solid var(--tf-line);
}

.label {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.input {
  margin-top: 12rpx;
  height: 72rpx;
  font-size: 32rpx;
  color: var(--tf-text);
}

.ph {
  color: var(--tf-text-3);
}

.btn {
  margin-top: 48rpx;
  height: 92rpx;
  line-height: 92rpx;
  border-radius: 46rpx;
  background-color: var(--tf-primary);
  color: #ffffff;
  font-size: 32rpx;
}

.btn--off {
  background-color: #ffd3c7;
}

.row {
  margin-top: 28rpx;
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

/* —— 已登录快捷入口 —— */
.resume {
  margin-bottom: 40rpx;
  background-color: var(--tf-primary-soft);
  border-radius: 24rpx;
  padding: 32rpx;
}

.resume-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-primary);
}

.resume-sub {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: var(--tf-text-2);
}

.resume-btns {
  display: flex;
  flex-direction: row;
  margin-top: 28rpx;
}

.resume-btns .btn {
  flex: 1;
  margin-top: 0;
  height: 80rpx;
  line-height: 80rpx;
  font-size: 28rpx;
  border-radius: 40rpx;
}

.resume-btns .btn:first-child {
  margin-right: 16rpx;
}

.btn--ghost {
  background-color: #ffffff;
  color: var(--tf-text-2);
}
</style>
