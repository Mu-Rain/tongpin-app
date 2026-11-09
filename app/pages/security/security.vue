<template>
  <view class="page">

    <!-- 导航 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">账号与安全</text>
    </view>

    <!-- 未登录 -->
    <view class="state-box" v-if="needLogin">
      <text class="state-title">登录后才能查看账号信息</text>
      <text class="state-hint">手机号、认证状态都跟着账号走，登录后才会显示</text>
      <button class="btn" @tap="goLogin">去登录</button>
    </view>

    <view class="body" v-else>
      <!-- ===== 账号 ===== -->
      <view class="card">
        <text class="card-title">账号</text>
        <view class="row">
          <text class="row-label">手机号</text>
          <text class="row-value">{{ phoneText }}</text>
        </view>
        <view class="row">
          <text class="row-label">昵称</text>
          <text class="row-value">{{ nicknameText }}</text>
        </view>
        <view class="row">
          <text class="row-label">学校</text>
          <text class="row-value">{{ schoolText }}</text>
        </view>
      </view>

      <!-- ===== 认证 ===== -->
      <view class="card">
        <text class="card-title">学生认证</text>
        <view class="row">
          <text class="row-label">认证状态</text>
          <text class="row-value" :class="{ 'row-value--ok': verified }">{{ verified ? '已认证' : '未认证' }}</text>
        </view>
        <view class="act" @tap="goVerify">
          <text class="act-t">{{ verified ? '查看认证' : '去认证' }}</text>
        </view>
      </view>

      <!-- ===== 安全 ===== -->
      <view class="card">
        <text class="card-title">安全</text>
        <view class="note">
          <text class="note-t">当前版本用手机号登录，暂不支持修改密码</text>
        </view>
      </view>

      <view class="logout" @tap="logout">
        <text class="logout-t">退出登录</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      user: {},
      needLogin: false
    }
  },
  computed: {
    phoneText() {
      const u = this.user || {}
      return this.maskPhone(u.phone || u.mobile)
    },
    nicknameText() {
      const u = this.user || {}
      return u.nickname || '未设置'
    },
    schoolText() {
      const u = this.user || {}
      return u.school || '未填写'
    },
    // verify_status 的取值在云函数里可能叫 approved 也可能叫 verified，
    // 字段还没统一，所以按白名单判断，只认明确表示通过的值。
    verified() {
      const u = this.user || {}
      if (u.schoolVerified === true) return true
      const st = String(u.verify_status || '')
      return st === 'approved' || st === 'verified' || st === 'pass'
    }
  },
  onLoad() {
    const token = uni.getStorageSync('token')
    this.restore()
    if (!token) {
      this.needLogin = true
      return
    }
    this.refresh()
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
    goVerify() {
      uni.navigateTo({
        url: '/pages/verify/verify',
        fail: () => uni.showToast({ title: '认证页暂时打不开', icon: 'none' })
      })
    },

    /**
     * 手机号脱敏：前 3 后 4，中间固定四个星。
     * 长度不足 7 就原样返回 —— 宁可显示怪号码，也不要把 400/110 之类
     * 短号码误伤成「138****」这种看不出原形的样子。
     */
    maskPhone(phone) {
      const s = String(phone || '').trim()
      if (!s) return '未绑定'
      if (s.length < 7) return s
      return s.substring(0, 3) + '****' + s.substring(s.length - 4)
    },

    /* 先用本地缓存把页面画出来，再用 user-me 覆盖：先有内容，再求准确 */
    restore() {
      const u = uni.getStorageSync('userInfo')
      if (u && typeof u === 'object') this.user = u
    },

    /**
     * 静默刷新用户信息。
     * 失败/超时/云函数没部署都只是 console.warn：页面上继续用 storage 里的数据，
     * 账号信息页读不到最新值也不该弹错，更不该白屏。
     */
    async refresh() {
      try {
        const res = await uniCloud.callFunction({
          name: 'user-me',
          data: { token: uni.getStorageSync('token') || '' }
        })
        const r = res.result || {}
        if (r.code === 401) {
          this.needLogin = true
          return
        }
        if (r.code !== 0) return
        const d = r.data || {}
        const u = d.user || {}
        if (!u._id && !u.nickname && !u.phone && !u.mobile) return
        this.user = u
      } catch (e) {
        console.warn('[账号与安全] 刷新用户信息失败：' + ((e && e.message) || ''))
      }
    },

    /* 退出登录：与设置页同一套做法，清掉登录态再回登录页 */
    logout() {
      uni.showModal({
        title: '退出登录',
        content: '退出后需要重新登录才能发布和聊天。',
        confirmText: '退出',
        confirmColor: '#c0392b',
        success: (r) => {
          if (!r.confirm) return
          uni.removeStorageSync('userInfo')
          uni.removeStorageSync('token')
          uni.reLaunch({ url: '/pages/login/login' })
        }
      })
    }
  }
}
</script>

<style>
/* ==========================================================================
   账号与安全页
   --------------------------------------------------------------------------
   三段白卡：账号 / 认证 / 安全。都用「标签 + 值」的横向行，值统一右对齐。
   这里不做修改密码入口 —— 后端没有这个接口，画个按钮只会点了没反应。
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

.body {
  display: flex;
  flex-direction: column;
}

/* 卡片 */
.card {
  margin: 24rpx 24rpx 0;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  padding: 24rpx 26rpx;
}
.card-title {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  color: var(--tf-text-2);
  padding-bottom: 12rpx;
}

/* 行 */
.row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 84rpx;
  border-top: 2rpx solid var(--tf-line-soft);
}
.row-label {
  flex: 1;
  min-width: 0;
  font-size: 27rpx;
  color: var(--tf-text);
}
.row-value {
  flex: none;
  max-width: 420rpx;
  font-size: 26rpx;
  color: var(--tf-text-2);
  text-align: right;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.row-value--ok {
  color: var(--tf-primary-deep);
  font-weight: 600;
}

/* 去认证 */
.act {
  margin-top: 16rpx;
  height: 76rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2rpx solid var(--tf-primary);
  background: var(--tf-primary-soft);
  border-radius: var(--tf-r-md);
}
.act:active {
  background: var(--tf-primary-soft);
  opacity: 0.8;
}
.act-t {
  font-size: 26rpx;
  font-weight: 700;
  color: var(--tf-primary-deep);
}

/* 安全说明 */
.note {
  margin-top: 12rpx;
  padding: 20rpx 22rpx;
  background: var(--tf-bg);
  border-radius: var(--tf-r-sm);
}
.note-t {
  font-size: 23rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* 退出登录 */
.logout {
  margin: 40rpx 24rpx 0;
  height: 100rpx;
  background: var(--tf-card);
  border-radius: var(--tf-r-md);
  border: 2rpx solid var(--tf-line-soft);
  display: flex;
  align-items: center;
  justify-content: center;
}
.logout:active {
  background: var(--tf-line-soft);
}
.logout-t {
  font-size: 29rpx;
  font-weight: 700;
  color: var(--tf-danger);
}

/* 状态盒（未登录） */
.state-box {
  margin: 120rpx 40rpx 0;
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
