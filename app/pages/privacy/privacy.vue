<template>
  <view class="page">

    <!-- 导航 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">隐私设置</text>
    </view>

    <view class="intro">
      <text class="intro-text">这个设置影响别人在动态流里能不能看到你发的动态。</text>
    </view>

    <!-- 未登录：说清楚要登录，不留白屏 -->
    <view class="state-box" v-if="needLogin">
      <text class="state-title">登录后才能设置</text>
      <text class="state-hint">隐私设置跟着账号走，登录后才有地方存</text>
      <button class="btn" @tap="goLogin">去登录</button>
    </view>

    <!-- 首屏加载 -->
    <view class="state-box" v-else-if="loading">
      <text class="state-text">加载中…</text>
    </view>

    <view class="body" v-else>
      <view class="card">
        <text class="card-title">谁可以看我的动态</text>
        <view class="opts">
          <view
            v-for="o in options"
            :key="o.key"
            class="opt"
            :class="{ 'opt--on': visibility === o.key }"
            @tap="pick(o.key)"
          >
            <view class="opt-main">
              <text class="opt-label">{{ o.label }}</text>
              <text class="opt-desc">{{ o.desc }}</text>
            </view>
            <view class="dot" :class="{ 'dot--on': visibility === o.key }"></view>
          </view>
        </view>
      </view>

      <!-- 读取失败：卡片照常可点，只是多一行重试，不给白屏 -->
      <text class="retry" v-if="loadError" @tap="load">读取失败，点这里重试</text>
      <text class="foot-tip">改完立刻生效，不用另外保存。</text>
    </view>
  </view>
</template>

<script>
// 三档可见性，key 必须与云函数 user-privacy 的 moments_visibility 枚举完全一致
const OPTIONS = [
  { key: 'all', label: '所有人', desc: '任何同校同学都能看到你发的动态' },
  { key: 'friends', label: '仅好友', desc: '只有互相加为好友的人能看到' },
  { key: 'self', label: '仅自己', desc: '只有你自己能看到，别人那里不显示' }
]

// 校验用白名单：云函数返回别的值就当没读到，不把脏数据画到页面上
const VALID = ['all', 'friends', 'self']

export default {
  data() {
    return {
      options: OPTIONS,
      visibility: 'all',
      loading: true,
      saving: false,
      needLogin: false,
      loadError: ''
    }
  },
  onLoad() {
    const token = uni.getStorageSync('token')
    if (!token) {
      this.needLogin = true
      this.loading = false
      return
    }
    this.load()
  },
  methods: {
    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/mine/mine' })
      })
    },
    goLogin() {
      uni.navigateTo({ url: '/pages/login/login' })
    },

    /**
     * 读当前设置。
     * 失败只记 loadError、把默认档画出来：设置页读不到值也必须能看能改，
     * 否则用户对着空页面完全不知道该点哪里。
     */
    async load() {
      this.loading = true
      this.loadError = ''
      try {
        const res = await uniCloud.callFunction({
          name: 'user-privacy',
          data: {
            token: uni.getStorageSync('token') || '',
            action: 'get'
          }
        })
        const r = res.result || {}
        if (r.code === 401) {
          this.needLogin = true
          return
        }
        if (r.code !== 0) {
          this.loadError = r.msg || '读取失败'
          return
        }
        const d = r.data || {}
        if (VALID.indexOf(d.moments_visibility) >= 0) {
          this.visibility = d.moments_visibility
        }
      } catch (e) {
        // 云函数没部署 / 断网：静默降级，只留一行重试
        console.warn('[隐私设置] 读取失败：' + ((e && e.message) || ''))
        this.loadError = '读取失败'
      } finally {
        this.loading = false
      }
    },

    /**
     * 点选即保存。
     * 先改本地选中态再发请求：点击要立刻有反馈；失败再回滚到 prev，
     * 用户看到的高亮永远等于服务端真正存下来的值。
     */
    async pick(key) {
      if (this.saving) return
      if (key === this.visibility) return
      const prev = this.visibility
      this.visibility = key
      this.saving = true
      try {
        const res = await uniCloud.callFunction({
          name: 'user-privacy',
          data: {
            token: uni.getStorageSync('token') || '',
            action: 'set',
            moments_visibility: key
          }
        })
        const r = res.result || {}
        if (r.code === 0) {
          const d = r.data || {}
          // 以服务端回传的值为准，防止前端和云函数枚举漂移
          if (VALID.indexOf(d.moments_visibility) >= 0) {
            this.visibility = d.moments_visibility
          }
          uni.showToast({ title: '已保存', icon: 'success' })
          return
        }
        if (r.code === 401) {
          this.visibility = prev
          this.needLogin = true
          return
        }
        this.visibility = prev
        uni.showToast({ title: '保存失败，请重试', icon: 'none' })
      } catch (e) {
        console.warn('[隐私设置] 保存失败：' + ((e && e.message) || ''))
        this.visibility = prev
        uni.showToast({ title: '保存失败，请重试', icon: 'none' })
      } finally {
        this.saving = false
      }
    }
  }
}
</script>

<style>
/* ==========================================================================
   隐私设置页
   --------------------------------------------------------------------------
   三张可点卡片替代原生 radio：原生控件在小程序里样式改不动，
   这里自己画圆点，和举报页的原因单选保持同一套语言。
   ========================================================================== */
.page {
  min-height: 100vh;
  background: var(--tf-bg);
  padding-bottom: 60rpx;
}

/* 导航 */
.nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88rpx;
  padding-top: var(--status-bar-height);
}
.nav-back {
  position: absolute;
  left: 20rpx;
  top: calc(var(--status-bar-height) + 10rpx);
  width: 68rpx;
  height: 68rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-back-arw {
  font-size: 48rpx;
  color: var(--tf-text);
  line-height: 1;
  margin-top: -4rpx;
}
.nav-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--tf-text);
}

/* 顶部说明 */
.intro {
  margin: 8rpx 24rpx 0;
  padding: 22rpx 24rpx;
  background: var(--tf-primary-soft);
  border-radius: var(--tf-r-md);
}
.intro-text {
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--tf-primary-deep);
}

.body {
  display: flex;
  flex-direction: column;
}

/* 选项卡片 */
.card {
  margin: 24rpx 24rpx 0;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  padding: 28rpx;
}
.card-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: var(--tf-text);
  margin-bottom: 8rpx;
}

.opts {
  margin-top: 8rpx;
}
.opt {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 2rpx solid var(--tf-line-soft);
}
.opt:last-child {
  border-bottom: none;
}
.opt:active {
  background: var(--tf-line-soft);
}
.opt-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding-right: 24rpx;
}
.opt-label {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.opt--on .opt-label {
  color: var(--tf-primary-deep);
}
.opt-desc {
  margin-top: 6rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: var(--tf-text-2);
}

/* 单选圆点：靠右居中，选中时实心 */
.dot {
  flex: none;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid var(--tf-line);
  background: var(--tf-card);
  box-sizing: border-box;
}
.dot--on {
  border: 12rpx solid var(--tf-primary);
}

/* 重试与页脚 */
.retry {
  display: block;
  margin: 24rpx 24rpx 0;
  font-size: 24rpx;
  color: var(--tf-primary-deep);
  text-align: center;
}
.foot-tip {
  display: block;
  margin: 28rpx 40rpx 0;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--tf-text-3);
  text-align: center;
}

/* 状态盒（未登录 / 加载中） */
.state-box {
  margin: 80rpx 40rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.state-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.state-hint {
  margin-top: 16rpx;
  font-size: 23rpx;
  line-height: 1.6;
  color: var(--tf-text-3);
  text-align: center;
}
.state-text {
  font-size: 26rpx;
  color: var(--tf-text-3);
}
.btn {
  margin-top: 36rpx;
  height: 84rpx;
  line-height: 84rpx;
  padding: 0 64rpx;
  font-size: 28rpx;
  font-weight: 700;
  color: var(--tf-primary-deep);
  background: var(--tf-primary);
  border-radius: var(--tf-r-md);
  border: none;
}
.btn::after {
  border: none;
}
</style>
