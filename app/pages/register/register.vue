<template>
  <view class="page">

    <!-- 返回：原生导航已关，自己处理 -->
    <view class="back" @tap="goBack">
      <text class="back-arw">‹</text>
    </view>

    <!-- ================= 贴纸区 ================= -->
    <view class="stage">
      <view class="stk stk--1"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/curve-yellow.png" mode="aspectFit" /></view></view>
      <view class="stk stk--2"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/bubble-dama.png" mode="aspectFit" /></view></view>
      <view class="stk stk--3"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/star.png" mode="aspectFit" /></view></view>
      <view class="stk stk--4"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/book.png" mode="aspectFit" /></view></view>
      <view class="stk stk--5"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/ball.png" mode="aspectFit" /></view></view>
      <view class="stk stk--6"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/hotpot.png" mode="aspectFit" /></view></view>
      <view class="stk stk--7"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/curve-mint.png" mode="aspectFit" /></view></view>
      <view class="stk stk--8"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/mic.png" mode="aspectFit" /></view></view>
    </view>

    <!-- ================= 表单 ================= -->
    <view class="panel">
      <text class="title">创建账号</text>
      <text class="sub">30 秒填完，马上开始找搭子</text>

      <view class="field" :class="{ 'field--on': focusKey === 'phone' }">
        <input
          class="input"
          type="number"
          maxlength="11"
          placeholder="手机号"
          placeholder-class="ph"
          :value="phone"
          @input="onPhoneInput"
          @focus="onFocus('phone')"
          @blur="onBlur"
        />
      </view>

      <view class="field" :class="{ 'field--on': focusKey === 'pwd' }">
        <input
          class="input"
          :password="!showPwd"
          maxlength="32"
          placeholder="设置密码（至少 6 位）"
          placeholder-class="ph"
          :value="password"
          @input="onPasswordInput"
          @focus="onFocus('pwd')"
          @blur="onBlur"
        />
        <text class="field-op" @tap="togglePwd">{{ showPwd ? '隐藏' : '显示' }}</text>
      </view>

      <view class="field" :class="{ 'field--on': focusKey === 'pwd2' }">
        <input
          class="input"
          :password="!showPwd"
          maxlength="32"
          placeholder="再输一次密码"
          placeholder-class="ph"
          :value="password2"
          @input="onPassword2Input"
          @focus="onFocus('pwd2')"
          @blur="onBlur"
        />
        <text class="field-op" @tap="togglePwd">{{ showPwd ? '隐藏' : '显示' }}</text>
      </view>

      <view class="field" :class="{ 'field--on': focusKey === 'nick' }">
        <input
          class="input"
          maxlength="12"
          placeholder="昵称（选填，默认同学+随机号）"
          placeholder-class="ph"
          :value="nickname"
          @input="onNicknameInput"
          @focus="onFocus('nick')"
          @blur="onBlur"
        />
      </view>

      <view class="btn" :class="{ 'btn--off': !canSubmit }" @tap="onSubmit">
        <text class="t1">{{ submitting ? '注册中…' : '注册并进入' }}</text>
      </view>

      <view class="agree">
        <view class="check" :class="{ 'check--on': agreed }" @tap="toggleAgree">
          <view class="tick" v-if="agreed" />
        </view>
        <text class="agree-text" @tap="toggleAgree">请阅读并同意</text>
        <text class="agree-link" @tap.stop="openDoc('terms')">《用户协议》</text>
        <text class="agree-link" @tap.stop="openDoc('privacy')">《隐私政策》</text>
      </view>
    </view>
  </view>
</template>

<script>
import book from '@/common/account/book.js'
import { registerPush } from '@/common/push.js'

export default {
  data() {
    return {
      phone: '',
      password: '',
      password2: '',
      nickname: '',
      submitting: false,
      // 当前聚焦的输入框
      focusKey: '',
      // 两个密码框共用一个「显示/隐藏」
      showPwd: false,
      agreed: false
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
  /**
   * 从登录页「该手机号未注册 → 去注册」跳过来时带着 ?phone=xxx，
   * 直接把手机号填好，省得用户再输一遍。
   */
  onLoad(options) {
    const p = (options && options.phone) || ''
    const phone = decodeURIComponent(p)
    if (/^[0-9]{11}$/.test(phone)) this.phone = phone
  },

  methods: {
    /* 原生导航已关，返回自己处理 */
    goBack() {
      uni.navigateBack({
        fail: () => uni.reLaunch({ url: '/pages/login/login' })
      })
    },

    onFocus(key) {
      this.focusKey = key
    },
    onBlur() {
      this.focusKey = ''
    },
    togglePwd() {
      this.showPwd = !this.showPwd
    },
    toggleAgree() {
      this.agreed = !this.agreed
    },
    openDoc(kind) {
      uni.navigateTo({ url: '/pages/doc/doc?type=' + kind })
    },

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

    async onSubmit() {
      if (!this.canSubmit) return
      if (!this.agreed) {
        uni.showToast({ title: '请先勾选并同意用户协议', icon: 'none', duration: 1800 })
        return
      }

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
            nickname: this.nickname
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
        // 和登录页保持一致：不写这一条，下次启动不会自动进首页
        uni.setStorageSync('autoLogin', { state: 'ok', at: Date.now() })

        // 顺手把推送绑上，失败静默
        registerPush({ silent: true })

        // 记进账号簿：下次就能在登录页一键登录 / 切换账号里直接点
        try {
          book.remember({ token: result.data.token, user: result.data.user })
        } catch (e) {
          /* 账号簿写失败不能影响注册 */
        }

        // 注册成功：把 UID 亮出来。
        // ★ UID 是唯一能被别人搜到的号码，只弹一句「注册成功」，
        //   用户根本不知道自己有个号，也不知道加好友要报什么。
        const uid = (result.data.user && result.data.user.uid) || ''
        if (uid) {
          uni.showModal({
            title: '注册成功',
            content: '你的 UID：' + uid + '\n加好友时把它告诉对方，对方就能搜到你',
            showCancel: false,
            confirmText: '开始使用',
            success: () => {
              uni.reLaunch({ url: '/pages/index/index' })
            }
          })
        } else {
          // 极端兜底：UID 没回来也别把用户卡在注册页
          uni.showToast({ title: '注册成功', icon: 'success', duration: 1200 })
          setTimeout(() => {
            uni.reLaunch({ url: '/pages/index/index' })
          }, 700)
        }
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

<style scoped>
/* ==========================================================================
   注册页 · 贴纸风（和登录页同一套语言）
   --------------------------------------------------------------------------
   登录页 13 个贴纸，这里只放 8 个 —— 注册有 4 个输入框，得给表单留地方。
   贴纸同样是三层结构（浮动 / 旋转 / 入场），原因见 login.vue 的注释。
   ========================================================================== */
.page {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #8CE4F9;
}

/* 返回：浮在贴纸上层 */
.back {
  position: absolute;
  left: 24rpx;
  top: calc(var(--status-bar-height) + 12rpx);
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}
.back-arw {
  font-size: 44rpx;
  color: #12313D;
  line-height: 1;
  margin-top: -4rpx;
}

/* ===== 贴纸区 ===== */
.stage {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}
.stk {
  position: absolute;
  animation: stk-float 6s ease-in-out infinite alternate;
}
.stk-rot {
  width: 100%;
  height: 100%;
}
.stk-img {
  width: 100%;
  height: 100%;
  animation: stk-pop 560ms cubic-bezier(0.2, 1.3, 0.45, 1) both;
  filter: drop-shadow(0 4rpx 6rpx rgba(18, 49, 61, 0.34))
          drop-shadow(0 18rpx 28rpx rgba(18, 49, 61, 0.16));
}
@keyframes stk-float {
  from { transform: translateY(0); }
  to   { transform: translateY(-12rpx); }
}
@keyframes stk-pop {
  from { opacity: 0; transform: scale(0.6); }
  to   { opacity: 1; transform: scale(1); }
}

/* ===== 8 个贴纸 ===== */
.stk--1  { left: 569rpx; top: 177rpx; width: 127rpx; height: 106rpx; z-index: 1; animation-delay: -1.4s; }
.stk--1 .stk-rot { transform: rotate(-22deg); }
.stk--2  { left: 246rpx; top: 146rpx; width: 288rpx; height: 137rpx; z-index: 6; animation-delay: -2.8s; }
.stk--2 .stk-rot { transform: rotate(8deg); }
.stk--3  { left: 42rpx;  top: 292rpx; width: 165rpx; height: 165rpx; z-index: 3; animation-delay: -0.6s; }
.stk--3 .stk-rot { transform: rotate(-16deg); }
.stk--4  { left: 200rpx; top: 342rpx; width: 173rpx; height: 190rpx; z-index: 4; animation-delay: -3.6s; }
.stk--4 .stk-rot { transform: rotate(-12deg); }
.stk--5  { left: 446rpx; top: 285rpx; width: 169rpx; height: 169rpx; z-index: 4; animation-delay: -1.9s; }
.stk--5 .stk-rot { transform: rotate(14deg); }
.stk--6  { left: 577rpx; top: 400rpx; width: 158rpx; height: 152rpx; z-index: 5; animation-delay: -4.4s; }
.stk--6 .stk-rot { transform: rotate(-6deg); }
.stk--7  { left: 635rpx; top: 112rpx; width: 119rpx; height: 98rpx;  z-index: 1; animation-delay: -2.2s; }
.stk--7 .stk-rot { transform: rotate(26deg); }
.stk--8  { left: 12rpx;  top: 485rpx; width: 112rpx; height: 135rpx; z-index: 2; animation-delay: -0.9s; }
.stk--8 .stk-rot { transform: rotate(-14deg); }

.stk--1 .stk-img { animation-delay: 60ms;  }
.stk--2 .stk-img { animation-delay: 20ms;  }
.stk--3 .stk-img { animation-delay: 120ms; }
.stk--4 .stk-img { animation-delay: 170ms; }
.stk--5 .stk-img { animation-delay: 220ms; }
.stk--6 .stk-img { animation-delay: 270ms; }
.stk--7 .stk-img { animation-delay: 320ms; }
.stk--8 .stk-img { animation-delay: 370ms; }

/* ===== 表单 ===== */
.panel {
  position: relative;
  z-index: 20;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* ★ 不要把 constant()/env() 写进 padding 简写：安卓会把整条声明丢掉 */
  padding: 0 65rpx 65rpx;
  padding-bottom: calc(65rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(65rpx + env(safe-area-inset-bottom));
}

.title {
  font-size: 65rpx;
  font-weight: 800;
  color: #12313D;
  letter-spacing: 0.01em;
}
.sub {
  font-size: 25rpx;
  font-weight: 500;
  color: rgba(18, 49, 61, 0.58);
  margin-top: 15rpx;
  margin-bottom: 42rpx;
}

.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  width: 100%;
  height: 108rpx;
  margin-top: 19rpx;
  padding: 0 38rpx;
  box-sizing: border-box;
  border-radius: 54rpx;
  background: rgba(255, 255, 255, 0.9);
  border: 3rpx solid transparent;
  transition: background 180ms ease, border-color 180ms ease;
}
.field--on {
  background: #FFFFFF;
  border-color: #12313D;
}
.input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 29rpx;
  color: #12313D;
}
.ph {
  color: #8FA9B0;
  font-size: 27rpx;
}
.field-op {
  flex: none;
  font-size: 23rpx;
  font-weight: 700;
  color: #3E7C86;
}

/* ===== 主按钮：和登录页同一条渐变 ===== */
.btn {
  width: 100%;
  height: 142rpx;
  margin-top: 38rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(90deg,
    #95FF92 0%,
    #A0FDAC 13%,
    #A1FEDB 36%,
    #C4FECD 58%,
    #E4FDC3 81%,
    #F8FAC0 100%);
}
.btn:active {
  transform: scale(0.985);
  transition: transform 120ms ease;
}
.btn .t1 {
  font-size: 35rpx;
  font-weight: 800;
  color: #0D2320;
  letter-spacing: 0.02em;
}
.btn--off {
  background: #E6F3F6;
}
.btn--off .t1 {
  color: #9DB3B8;
}

/* ===== 协议 ===== */
.agree {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  margin-top: 42rpx;
}
.check {
  width: 33rpx;
  height: 33rpx;
  border-radius: 50%;
  border: 3rpx solid rgba(18, 49, 61, 0.55);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12rpx;
  flex: none;
  box-sizing: border-box;
}
.check--on {
  background: #12313D;
  border-color: #12313D;
}
/* 勾用两条边画，不用字体里的 ✓（字形跨设备不一致） */
.tick {
  width: 9rpx;
  height: 16rpx;
  border-right: 4rpx solid #FFFFFF;
  border-bottom: 4rpx solid #FFFFFF;
  transform: rotate(42deg) translate(-1rpx, -2rpx);
}
.agree-text {
  font-size: 21rpx;
  color: rgba(18, 49, 61, 0.66);
}
.agree-link {
  font-size: 21rpx;
  font-weight: 700;
  color: #12313D;
}
</style>
