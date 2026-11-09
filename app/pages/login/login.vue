<template>
  <view class="page">

    <!-- ================= 贴纸区（物理堆叠，层级见下方 z-index） ================= -->
    <view class="stage">
      <view class="stk stk--1"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/curve-yellow.png" mode="aspectFit" /></view></view>
      <view class="stk stk--2"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/bubble-dama.png" mode="aspectFit" /></view></view>
      <view class="stk stk--3"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/star.png" mode="aspectFit" /></view></view>
      <view class="stk stk--4"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/map.png" mode="aspectFit" /></view></view>
      <view class="stk stk--5"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/curve-mint.png" mode="aspectFit" /></view></view>
      <view class="stk stk--6"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/book.png" mode="aspectFit" /></view></view>
      <view class="stk stk--7"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/note.png" mode="aspectFit" /></view></view>
      <view class="stk stk--8"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/ball.png" mode="aspectFit" /></view></view>
      <view class="stk stk--9"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/dumbbell.png" mode="aspectFit" /></view></view>
      <view class="stk stk--10"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/bubble-zouqi.png" mode="aspectFit" /></view></view>
      <view class="stk stk--11"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/mic.png" mode="aspectFit" /></view></view>
      <view class="stk stk--12"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/confetti.png" mode="aspectFit" /></view></view>
      <view class="stk stk--13"><view class="stk-rot"><image class="stk-img" src="/static/login/stickers/hotpot.png" mode="aspectFit" /></view></view>
    </view>

    <!-- ================= 操作区 ================= -->
    <view class="panel">

      <!-- ===== 快捷态：脱敏号码 + 两个胶囊 ===== -->
      <block v-if="mode === 'quick'">
        <text class="masked">{{ maskedPhone || '未登录' }}</text>

        <view class="btn btn-main" :class="{ 'btn--busy': submitting }" @tap="onQuickLogin">
          <text class="t1">{{ submitting ? '登录中…' : '一键登录' }}</text>
          <text class="t2">用本机号码继续</text>
        </view>

        <view class="btn btn-sub" @tap="toForm">
          <text class="t1">使用其他手机号登录</text>
        </view>

        <!-- 首次使用的人在这里找注册入口：放在次按钮正下方，视线必经 -->
        <view class="reg-row">
          <text class="reg-tip">还没有账号？</text>
          <text class="reg-link" @tap="onRegister">立即注册</text>
        </view>
      </block>

      <!-- ===== 手机号密码态 ===== -->
      <block v-else>
        <text class="form-title">手机号登录</text>

        <view class="field" :class="{ 'field--on': focusKey === 'phone' }">
          <input
            class="input"
            type="number"
            maxlength="11"
            placeholder="请输入手机号"
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
            placeholder="请输入密码（至少 6 位）"
            placeholder-class="ph"
            :value="password"
            @input="onPasswordInput"
            @focus="onFocus('pwd')"
            @blur="onBlur"
          />
          <text class="field-op" @tap="togglePwd">{{ showPwd ? '隐藏' : '显示' }}</text>
        </view>

        <view class="btn btn-main btn-main--single" :class="{ 'btn--off': !canSubmit }" @tap="onLogin">
          <text class="t1">{{ submitting ? '登录中…' : '登录' }}</text>
        </view>

        <view class="switch-row">
          <text class="link" v-if="quickAccount" @tap="toQuick">返回一键登录</text>
          <text class="link" @tap="onRegister">还没有账号？去注册</text>
        </view>
      </block>

      <!-- ===== 协议 ===== -->
      <view class="agree">
        <view class="check" :class="{ 'check--on': agreed }" @tap="toggleAgree">
          <view class="tick" v-if="agreed" />
        </view>
        <text class="agree-text" @tap="toggleAgree">请阅读并同意</text>
        <text class="agree-link" @tap.stop="openDoc('terms')">《用户协议》</text>
        <text class="agree-link" @tap.stop="openDoc('privacy')">《隐私政策》</text>
      </view>

    </view>

    <!-- 冷启动遮罩：有本地登录态时先把表单盖住，等 autoLogin 判定完再揭开。
         不加这一层的话，启动页一跳到本页就会露出登录表单，
         零点几秒后判定通了再跳首页 —— 用户看到的就是「闪一下登录页」。 -->
    <view v-if="bootMask" class="boot-mask">
      <image class="boot-bg" src="/static/splash.jpg" mode="aspectFill" />
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
      submitting: false,
      // 当前聚焦的输入框（'phone' / 'pwd' / ''）
      focusKey: '',
      showPwd: false,
      // 是否勾选了用户协议
      agreed: false,
      // quick = 脱敏号码 + 一键登录；form = 手机号密码
      mode: 'quick',
      // 账号簿里最近一个号（用来显示脱敏号码 / 一键登录）
      quickAccount: null,
      resumeTimer: null,
      // 冷启动遮罩初始值在 data 里算：必须比首帧更早，放到 onShow 已经晚一帧了
      bootMask: (function () {
        try {
          return !!(uni.getStorageSync('token') && uni.getStorageSync('userInfo'))
        } catch (e) {
          return false
        }
      })(),
      bootTimer: null
    }
  },
  computed: {
    canSubmit() {
      return this.phone.length === 11 && this.password.length >= 6 && !this.submitting
    },
    /* 150****7126：中间四位打码。没有号码时返回空串，模板显示「未登录」 */
    maskedPhone() {
      const p = (this.quickAccount && this.quickAccount.phone) || ''
      if (String(p).length !== 11) return ''
      return p.slice(0, 3) + '****' + p.slice(-4)
    }
  },
  onShow() {
    // 本页有启动图遮罩时，原生启动图可以关了 —— 两者是同一张图，视觉连续
    if (this.bootMask) this.closeNativeSplash()
    this.readAutoLogin()
    this.loadQuickAccount()
    // App.vue 的自动登录是异步的，可能比本页渲染慢，300ms 后再读一次
    this.resumeTimer = setTimeout(() => {
      this.readAutoLogin()
    }, 300)
    // 判定最多等 1.2 秒：超时（断网 / 云函数慢）也要把登录表单交给用户，
    // 不能让遮罩一直盖着 —— 宁可让用户手动登录，也不能卡在启动图上。
    if (this.bootMask && !this.bootTimer) {
      this.bootTimer = setTimeout(() => {
        this.bootTimer = null
        this.bootMask = false
        // 揭开后再给云函数 800ms：它要是在这之后才回来，也得让人进去
        this.resumeTimer = setTimeout(() => {
          this.readAutoLogin()
        }, 800)
      }, 1200)
    }
  },
  onHide() {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer)
      this.resumeTimer = null
    }
    if (this.bootTimer) {
      clearTimeout(this.bootTimer)
      this.bootTimer = null
    }
  },
  methods: {
    /* ---------------- 基础交互 ---------------- */
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
    toForm() {
      this.mode = 'form'
    },
    toQuick() {
      this.mode = 'quick'
    },

    /**
     * 账号簿里挑一个「能一键登录」的号：
     *   有 11 位手机号（要显示脱敏号码）+ token 还没过期。
     * 找不到能用的就退一步，挑一个「有号码但凭据过期」的 ——
     * 号码还能显示，点一键登录会引导去输密码，不会点了没反应。
     */
    loadQuickAccount() {
      let list = []
      try {
        list = book.listAll() || []
      } catch (e) {
        list = []
      }
      const withPhone = list.filter((a) => a && a.phone && String(a.phone).length === 11)
      const usable = withPhone.find((a) => book.isUsable(a))
      this.quickAccount = usable || withPhone[0] || null

      // ★ 第一次用这台手机（账号簿是空的）：直接进手机号密码表单。
      //   否则首屏是「未登录 + 一键登录」，点下去还是跳表单，白绕一圈，
      //   而且用户看不到注册入口。
      if (!this.quickAccount) this.mode = 'form'
    },

    /**
     * 读自动登录结果。
     * onShow 只在页面显示时触发一次，而 App.vue onLaunch 里那次云函数是异步的，
     * 可能比本页渲染慢 —— 所以 onShow 读一次，300ms 后再读一次。
     * 两次都是纯读本地缓存，不会多发请求。
     */
    closeNativeSplash() {
      try {
        if (typeof plus !== 'undefined' && plus.navigator && plus.navigator.closeSplashscreen) {
          plus.navigator.closeSplashscreen()
        }
      } catch (e) {
        // 关不掉由 App.vue 的 4 秒兜底处理
      }
    },

    readAutoLogin() {
      if (this._jumped) return

      const info = uni.getStorageSync('userInfo')
      const auto = uni.getStorageSync('autoLogin')
      // 只认「本次启动」写下的结论：autoLogin 是上一次启动留下的旧记录时，
      // 直接拿它判断会让遮罩瞬间揭开、登录页闪一下（就是这条 bug 的真正成因）。
      const bid = uni.getStorageSync('bootId') || ''
      const fresh = !!(auto && auto.bootId && auto.bootId === bid)

      // 只有「云函数验证通过」才算数，避免拿过期 token 直接闯进首页
      if (info && auto && auto.state === 'ok') {
        this._jumped = true
        uni.reLaunch({ url: '/pages/index/index' })
        return
      }
      // 本次启动的判定已经有结论（没登录过 / token 失效）：立刻揭开遮罩显示表单。
      // 旧记录不算数（见上面 fresh）；云函数还在飞就继续盖着，等它回来或等 1.2 秒兜底。
      if (fresh && (auto.state === 'none' || auto.state === 'fail')) {
        this.bootMask = false
        if (this.bootTimer) {
          clearTimeout(this.bootTimer)
          this.bootTimer = null
        }
      }
    },

    /* ---------------- 一键登录 ---------------- */

    /**
     * 一键登录 = 用账号簿里那台设备的登录凭据恢复会话。
     *
     * 为什么不是运营商号码认证：项目里没接运营商 SDK（要企业资质 + 付费套餐）。
     * 这里用「本机登录过的号 + 还没过期的 token」做等价体验：
     * 只有用户主动「退出登录」才会清 token，正常使用基本都能一键进。
     *
     * 凭据过期 / 换过设备 → 自动切到手机号密码态并给出提示，不让用户卡在原地。
     */
    async onQuickLogin() {
      if (this.submitting) return
      if (!this.agreed) {
        uni.showToast({ title: '请先勾选并同意用户协议', icon: 'none', duration: 1800 })
        return
      }

      const acc = this.quickAccount
      if (!acc || !book.isUsable(acc)) {
        // 没有可用的号：直接进密码态，别让按钮点了没反应
        this.mode = 'form'
        uni.showToast({
          title: acc ? '登录已过期，请重新输入密码' : '请先输入手机号登录',
          icon: 'none',
          duration: 2000
        })
        return
      }

      this.submitting = true
      uni.showLoading({ title: '登录中…', mask: true })
      try {
        const ok = book.switchTo(acc.user_id)
        if (!ok) throw new Error('凭据已失效')

        // 用 user-me 验一次 token，并补齐 credit / role / school_id 这些字段。
        // 返回 null 说明 token 在服务端也不认了 —— 不能带着坏 token 进首页。
        const me = await book.hydrate()
        if (!me) throw new Error('凭据已失效')

        uni.hideLoading()
        // 已登录就把这台设备绑上推送（静默：绑不上不影响登录）
        registerPush({ silent: true })
        uni.showToast({ title: '登录成功', icon: 'success', duration: 800 })
        setTimeout(() => {
          uni.reLaunch({ url: '/pages/index/index' })
        }, 500)
      } catch (e) {
        uni.hideLoading()
        this.mode = 'form'
        this.phone = acc.phone || ''
        uni.showToast({ title: '登录已过期，请重新输入密码', icon: 'none', duration: 2000 })
      } finally {
        this.submitting = false
      }
    },

    /* ---------------- 手机号密码登录 ---------------- */

    onPhoneInput(e) {
      this.phone = e.detail.value
    },
    onPasswordInput(e) {
      this.password = e.detail.value
    },

    async onLogin() {
      if (!this.canSubmit) return
      if (!this.agreed) {
        uni.showToast({ title: '请先勾选并同意用户协议', icon: 'none', duration: 1800 })
        return
      }

      this.submitting = true
      uni.showLoading({ title: '登录中…', mask: true })

      try {
        const res = await uniCloud.callFunction({
          name: 'user-login',
          data: { phone: this.phone, password: this.password }
        })

        const result = res.result || {}
        uni.hideLoading()

        if (result.code !== 0) {
          // 2001 = 该手机号未注册。这是首次使用最常撞到的一步：
          // 光弹一句「未注册」等于把用户扔在原地，直接给一条去注册的路。
          if (result.code === 2001) {
            uni.showModal({
              title: '还没注册',
              content: '这个手机号还没有账号，现在去注册？',
              confirmText: '去注册',
              cancelText: '再改改',
              success: (r) => {
                if (r.confirm) {
                  uni.navigateTo({ url: '/pages/register/register?phone=' + this.phone })
                }
              }
            })
            return
          }
          // 其它业务错误：密码错 / 被封禁
          uni.showToast({ title: result.msg || '登录失败', icon: 'none', duration: 2000 })
          return
        }

        uni.setStorageSync('token', result.data.token)
        uni.setStorageSync('userInfo', result.data.user)
        // 手动登录也算一次有效的自动登录结果，否则下次进登录页不会自动跳
        uni.setStorageSync('autoLogin', { state: 'ok', at: Date.now() })

        registerPush({ silent: true })

        // 记进账号簿：下次就能一键登录 / 在「切换账号」里直接点
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
    }
  }
}
</script>

<style scoped>
/* ==========================================================================
   登录页 · 贴纸风
   --------------------------------------------------------------------------
   结构：整屏天蓝底 → 贴纸堆（绝对定位 + 手动 z-index）→ 底部操作区。
   贴纸是 13 张 2 倍透明 PNG，位置和设计稿一一对应（设计稿 390px 宽 → 750rpx）。

   ★ 三个必须记住的点：
     1. 贴纸的「厚度」= 接触阴影 + 环境阴影两层 drop-shadow，
        而且要打在 <image> 上（跟着白色描边的形状走），打在容器上会变成方块阴影；
     2. 主按钮是参考图逐像素采样的扁平渐变，没有高光带；
     3. .stage 必须 flex: 1 1 0 + min-height: 0，否则操作区一长就把贴纸区顶出去。
   ========================================================================== */
.page {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  /* 明亮天蓝，哑光纯色（参考图采样 #8CE4F9） */
  background: #8CE4F9;
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
  /* 缓慢浮动，各自相位不同 —— 看起来是「贴着微微呼吸」 */
  animation: stk-float 6s ease-in-out infinite alternate;
}
/* ★ 为什么贴纸要三层：
     .stk      → 只跑浮动动画（transform: translateY）
     .stk-rot  → 只放静态旋转/缩放（每张角度不同，写死）
     .stk-img  → 只跑入场缩放动画（transform: scale）
   CSS 的 transform 会互相覆盖，同一个元素上只能有一份。
   把旋转和动画放在同一层，浮动一跑起来角度就没了 —— 这就是上一版「偏转没生效」的原因。 */
.stk-rot {
  width: 100%;
  height: 100%;
}

.stk-img {
  width: 100%;
  height: 100%;
  /* 入场：从 0.6 倍弹到 1 倍，逐张错开 */
  animation: stk-pop 560ms cubic-bezier(0.2, 1.3, 0.45, 1) both;
  /* 厚度：接触阴影小而深 + 环境阴影大而淡 */
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

/* ===== 13 个贴纸：位置 / 层级 / 浮动相位 ===== */
.stk--1  { left: 150rpx; top: 215rpx; width: 138rpx; height: 115rpx; z-index: 1; animation-delay: -0.4s; }
.stk--1 .stk-rot { transform: rotate(-28deg) scale(1.00); }
.stk--2  { left: 269rpx; top: 238rpx; width: 292rpx; height: 138rpx; z-index: 6; animation-delay: -1.8s; }
.stk--2 .stk-rot { transform: rotate(10deg) scale(1.04); }
.stk--3  { left: 19rpx;  top: 319rpx; width: 181rpx; height: 181rpx; z-index: 3; animation-delay: -3.1s; }
.stk--3 .stk-rot { transform: rotate(-18deg) scale(1.02); }
.stk--4  { left: 181rpx; top: 354rpx; width: 185rpx; height: 167rpx; z-index: 2; animation-delay: -0.9s; }
.stk--4 .stk-rot { transform: rotate(-6deg) scale(1.00); }
.stk--5  { left: 604rpx; top: 215rpx; width: 123rpx; height: 100rpx; z-index: 1; animation-delay: -2.6s; }
.stk--5 .stk-rot { transform: rotate(30deg) scale(1.00); }
.stk--6  { left: 38rpx;  top: 504rpx; width: 200rpx; height: 219rpx; z-index: 5; animation-delay: -4.2s; }
.stk--6 .stk-rot { transform: rotate(-16deg) scale(1.05); }
.stk--7  { left: 235rpx; top: 462rpx; width: 192rpx; height: 211rpx; z-index: 6; animation-delay: -1.2s; }
.stk--7 .stk-rot { transform: rotate(-20deg) scale(1.00); }
.stk--8  { left: 427rpx; top: 342rpx; width: 188rpx; height: 188rpx; z-index: 4; animation-delay: -3.7s; }
.stk--8 .stk-rot { transform: rotate(12deg) scale(1.03); }
.stk--9  { left: 19rpx;  top: 746rpx; width: 192rpx; height: 128rpx; z-index: 2; animation-delay: -2.1s; }
.stk--9 .stk-rot { transform: rotate(-22deg) scale(1.00); }
.stk--10 { left: 177rpx; top: 654rpx; width: 219rpx; height: 135rpx; z-index: 7; animation-delay: -0.2s; }
.stk--10 .stk-rot { transform: rotate(-8deg) scale(1.06); }
.stk--11 { left: 427rpx; top: 635rpx; width: 165rpx; height: 198rpx; z-index: 4; animation-delay: -3.3s; }
.stk--11 .stk-rot { transform: rotate(16deg) scale(1.01); }
.stk--12 { left: 569rpx; top: 496rpx; width: 154rpx; height: 154rpx; z-index: 2; animation-delay: -1.6s; }
.stk--12 .stk-rot { transform: rotate(18deg) scale(1.00); }
.stk--13 { left: 573rpx; top: 696rpx; width: 177rpx; height: 171rpx; z-index: 5; animation-delay: -2.9s; }
.stk--13 .stk-rot { transform: rotate(-6deg) scale(1.02); }

/* 入场延迟：从左到右、从上到下逐张弹出 */
.stk--1  .stk-img { animation-delay: 40ms;  }
.stk--2  .stk-img { animation-delay: 90ms;  }
.stk--3  .stk-img { animation-delay: 140ms; }
.stk--4  .stk-img { animation-delay: 190ms; }
.stk--5  .stk-img { animation-delay: 240ms; }
.stk--6  .stk-img { animation-delay: 290ms; }
.stk--7  .stk-img { animation-delay: 340ms; }
.stk--8  .stk-img { animation-delay: 390ms; }
.stk--9  .stk-img { animation-delay: 440ms; }
.stk--10 .stk-img { animation-delay: 490ms; }
.stk--11 .stk-img { animation-delay: 540ms; }
.stk--12 .stk-img { animation-delay: 590ms; }
.stk--13 .stk-img { animation-delay: 640ms; }

/* ===== 操作区 ===== */
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

.masked {
  font-size: 52rpx;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #12313D;
  margin-bottom: 58rpx;
}

/* ===== 胶囊按钮 ===== */
.btn {
  width: 100%;
  border-radius: 999rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.btn:active {
  transform: scale(0.985);
  transition: transform 120ms ease;
}

/* 主按钮：参考图逐像素采样的扁平三段渐变（绿 → 青 → 奶黄），无高光带 */
.btn-main {
  height: 142rpx;
  background: linear-gradient(90deg,
    #95FF92 0%,
    #A0FDAC 13%,
    #A1FEDB 36%,
    #C4FECD 58%,
    #E4FDC3 81%,
    #F8FAC0 100%);
}
.btn-main--single {
  margin-top: 44rpx;
}
.btn-main .t1 {
  font-size: 35rpx;
  font-weight: 800;
  color: #0D2320;
  letter-spacing: 0.02em;
  line-height: 1.2;
}
.btn-main .t2 {
  font-size: 23rpx;
  font-weight: 600;
  color: rgba(13, 35, 32, 0.55);
  margin-top: 8rpx;
  line-height: 1.2;
}
.btn--off {
  background: #E6F3F6;
}
.btn--off .t1 {
  color: #9DB3B8;
}
.btn--busy {
  opacity: 0.72;
}

/* 次按钮：纯白实心 */
.btn-sub {
  height: 131rpx;
  margin-top: 31rpx;
  background: #FFFFFF;
}
.btn-sub .t1 {
  font-size: 33rpx;
  font-weight: 800;
  color: #12313D;
}

/* ===== 手机号密码态 ===== */
.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  width: 100%;
  height: 108rpx;
  padding: 0 34rpx;
  box-sizing: border-box;
  border-radius: 54rpx;
  background: rgba(255, 255, 255, 0.88);
  border: 3rpx solid transparent;
  margin-top: 20rpx;
  transition: border-color 180ms ease, background 180ms ease;
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
  font-size: 30rpx;
  color: #12313D;
}
.ph {
  color: #8FA9B0;
  font-size: 28rpx;
}
.field-op {
  flex: none;
  font-size: 24rpx;
  font-weight: 700;
  color: #3E7C86;
}

.switch-row {
  display: flex;
  flex-direction: row;
  justify-content: center;
  gap: 44rpx;
  margin-top: 26rpx;
}
.link {
  font-size: 24rpx;
  font-weight: 600;
  color: #12313D;
}

/* 快捷态下方的注册入口 */
.reg-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-top: 30rpx;
}
.reg-tip {
  font-size: 23rpx;
  color: rgba(18, 49, 61, 0.62);
}
.reg-link {
  font-size: 23rpx;
  font-weight: 800;
  color: #12313D;
  margin-left: 4rpx;
}

/* 表单态的小标题 */
.form-title {
  font-size: 30rpx;
  font-weight: 800;
  color: #12313D;
  margin-bottom: 6rpx;
}

/* ===== 协议 ===== */
.agree {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  margin-top: 46rpx;
}
.check {
  width: 34rpx;
  height: 34rpx;
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
  font-size: 22rpx;
  color: rgba(18, 49, 61, 0.66);
}
.agree-link {
  font-size: 22rpx;
  font-weight: 700;
  color: #12313D;
}

/* 冷启动遮罩：和启动页同一张图、同一个底色，视觉上像启动页多停留了一会儿 */
.boot-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 999;
  background: #EAF6EE;
}
.boot-bg {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
