<template>
  <view class="splash">
    <!-- 用户提供的启动页整图，铺满全屏 -->
    <image class="splash-bg" src="/static/splash.jpg" mode="aspectFill" />

    <!-- 底部一点渐隐，让图片和黑色状态栏之间不留硬边 -->
    <view class="splash-fade" />
  </view>
</template>

<script>
/**
 * 启动页
 *
 * 职责变了：以前固定 1.8 秒后交给登录页，让登录页再判断一次登录态 ——
 * 于是「启动页 → 登录页 → 首页」两跳，中间必然闪一下。
 * 现在这里直接决定落地页：等本次启动的自动登录结论（App.vue 用 bootId 标记），
 * 有结论就一次跳到位；最多等 2.8 秒，超时按有没有 token 兜底。
 *
 * 原生启动图（manifest splashscreen）设成不自动关闭，由落地页渲染后关闭，
 * 所以这一页和启动图是同一张图，视觉上连续。
 */
export default {
  data() {
    return {
      timer: null,
      pollTimer: null,
      startAt: 0,
      jumped: false
    }
  },
  onLoad() {
    this.startAt = Date.now()
    // 至少完整露出 1.5 秒插画，避免一闪而过
    this.timer = setTimeout(() => this.tick(), 1500)
  },
  onUnload() {
    this.clearTimers()
  },
  onHide() {
    this.clearTimers()
  },
  methods: {
    clearTimers() {
      if (this.timer) {
        clearTimeout(this.timer)
        this.timer = null
      }
      if (this.pollTimer) {
        clearTimeout(this.pollTimer)
        this.pollTimer = null
      }
    },

    tick() {
      if (this.jumped) return
      const bootId = uni.getStorageSync('bootId') || ''
      const auto = uni.getStorageSync('autoLogin') || {}
      const fresh = !!(auto.bootId && auto.bootId === bootId)

      if (fresh && auto.state === 'ok') return this.go('/pages/index/index')
      if (fresh && (auto.state === 'none' || auto.state === 'fail')) {
        return this.go('/pages/login/login')
      }
      // 本次启动的结论还没写回来（云函数在飞）：再等一会儿，最多到 2.8 秒
      if (Date.now() - this.startAt < 2800) {
        const self = this
        this.pollTimer = setTimeout(function () {
          self.pollTimer = null
          self.tick()
        }, 120)
        return
      }
      // 超时兜底：有 token 就去首页（首页自己会处理失效），没有就去登录页
      const token = uni.getStorageSync('token')
      this.go(token ? '/pages/index/index' : '/pages/login/login')
    },

    go(url) {
      if (this.jumped) return
      this.jumped = true
      this.clearTimers()
      uni.reLaunch({ url: url })
    }
  }
}
</script>

<style scoped>
.splash {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #EAF6EE;
}

/* 入场：轻微放大 + 淡入。
   比「静止显示」多一点生命感，又不至于让人等。 */
.splash-bg {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: block;
  animation: splash-in 1400ms cubic-bezier(0.22, 0.8, 0.3, 1) both;
}

@keyframes splash-in {
  0% {
    opacity: 0;
    transform: scale(1.08);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

/* 顶部/底部各压一层淡渐隐，避免图边和状态栏、手势条之间出现硬切 */
.splash-fade {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  pointer-events: none;
  background:
    linear-gradient(to bottom, rgba(0, 0, 0, 0.10) 0%, rgba(0, 0, 0, 0) 12%),
    linear-gradient(to top, rgba(0, 0, 0, 0.08) 0%, rgba(0, 0, 0, 0) 10%);
}
</style>
