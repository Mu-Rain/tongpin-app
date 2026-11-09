<template>
  <view class="page">

    <!-- 导航 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">设置</text>
    </view>

    <!-- ===== 账号 ===== -->
    <view class="group">
      <view class="cell" @tap="goAccount">
        <text class="cell-label">账号与安全</text>
        <text class="cell-value" v-if="verified">已认证</text>
        <text class="cell-arrow">›</text>
      </view>
      <view class="cell" @tap="goPrivacy">
        <text class="cell-label">隐私设置</text>
        <text class="cell-value">谁能看我的动态</text>
        <text class="cell-arrow">›</text>
      </view>
      <view class="cell" @tap="goBlocked">
        <text class="cell-label">黑名单</text>
        <text class="cell-arrow">›</text>
      </view>
    </view>

    <!-- ===== 通知与显示 ===== -->
    <view class="group">
      <view class="cell">
        <text class="cell-label">消息通知</text>
        <switch
          class="cell-switch"
          :checked="notifyOn"
          color="#8FB86A"
          @change="onNotifyChange"
        />
      </view>
      <view class="cell">
        <text class="cell-label">新搭子提醒</text>
        <switch
          class="cell-switch"
          :checked="buddyAlertOn"
          color="#8FB86A"
          @change="onBuddyAlertChange"
        />
      </view>
      <view class="cell" @tap="clearCache">
        <text class="cell-label">清除缓存</text>
        <text class="cell-value">{{ cacheLabel }}</text>
        <text class="cell-arrow">›</text>
      </view>
    </view>

    <!-- ===== 关于 ===== -->
    <view class="group">
      <view class="cell" @tap="about">
        <text class="cell-label">关于同频</text>
        <text class="cell-value">v{{ version }}</text>
        <text class="cell-arrow">›</text>
      </view>
      <view class="cell" @tap="openDoc('terms')">
        <text class="cell-label">用户协议</text>
        <text class="cell-arrow">›</text>
      </view>
      <view class="cell" @tap="openDoc('privacy')">
        <text class="cell-label">隐私政策</text>
        <text class="cell-arrow">›</text>
      </view>
      <view class="cell" @tap="openDoc('community')">
        <text class="cell-label">社区公约</text>
        <text class="cell-arrow">›</text>
      </view>
    </view>

    <!-- ===== 退出登录 ===== -->
    <view class="logout" @tap="logout">
      <text class="logout-t">退出登录</text>
    </view>

    <view class="foot">
      <text class="foot-t">同频 · 找到同频搭子，把日常变有趣</text>
    </view>
  </view>
</template>

<script>
import { registerPush, unbindPush } from '@/common/push.js'

const STORE_KEY = 'appSettings'

export default {
  data() {
    return {
      version: '1.0.0',
      verified: false,
      notifyOn: true,
      buddyAlertOn: true,
      fontSize: 'normal',
      cacheSize: 0
    }
  },
  computed: {
    fontSizeLabel() {
      return { small: '小', normal: '标准', large: '大' }[this.fontSize] || '标准'
    },
    cacheLabel() {
      if (!this.cacheSize) return '0 KB'
      if (this.cacheSize < 1024 * 1024) return Math.round(this.cacheSize / 1024) + ' KB'
      return (this.cacheSize / 1024 / 1024).toFixed(1) + ' MB'
    }
  },
  onLoad() {
    this.restore()
    this.calcCache()
    const u = uni.getStorageSync('userInfo')
    this.verified = !!(u && u.schoolVerified)
  },
  methods: {
    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/mine/mine' })
      })
    },

    /* 设置项存在本地，下次进来还在 */
    restore() {
      const s = uni.getStorageSync(STORE_KEY) || {}
      if (typeof s.notifyOn === 'boolean') this.notifyOn = s.notifyOn
      if (typeof s.buddyAlertOn === 'boolean') this.buddyAlertOn = s.buddyAlertOn
      if (s.fontSize) this.fontSize = s.fontSize
    },
    persist() {
      uni.setStorageSync(STORE_KEY, {
        notifyOn: this.notifyOn,
        buddyAlertOn: this.buddyAlertOn,
        fontSize: this.fontSize
      })
    },

    /* 消息通知开关：开就绑、关就解绑。
       buddyAlertOn 目前只存本地、服务端还没接，本轮不联动。 */
    onNotifyChange(e) {
      this.notifyOn = e.detail.value
      this.persist()
      if (this.notifyOn) {
        registerPush()
      } else {
        unbindPush()
      }
    },
    onBuddyAlertChange(e) {
      this.buddyAlertOn = e.detail.value
      this.persist()
    },

    /* 缓存：uni 只给到「存储占用」，够用 */
    calcCache() {
      try {
        const info = uni.getStorageInfoSync()
        this.cacheSize = (info.currentSize || 0) * 1024
      } catch (e) {
        this.cacheSize = 0
      }
    },
    clearCache() {
      uni.showModal({
        title: '清除缓存',
        content: '会清掉本地图片和临时数据，不影响你的账号和动态。',
        confirmColor: '#8FB86A',
        success: (r) => {
          if (!r.confirm) return
          // 保留登录态和设置，只清临时数据
          const keep = ['userInfo', 'token', STORE_KEY]
          try {
            const info = uni.getStorageInfoSync()
            ;(info.keys || []).forEach((k) => {
              if (keep.indexOf(k) === -1) uni.removeStorageSync(k)
            })
          } catch (e) {}
          this.calcCache()
          uni.showToast({ title: '已清除', icon: 'success' })
        }
      })
    },

    goAccount() {
      uni.navigateTo({ url: '/pages/security/security' })
    },
    goPrivacy() {
      uni.navigateTo({ url: '/pages/privacy/privacy' })
    },
    goBlocked() {
      uni.navigateTo({ url: '/pages/blocked/blocked' })
    },

    about() {
      uni.showModal({
        title: '同频',
        content:
          'v' + this.version + '\n\n找到同频搭子，把日常变有趣。\n\n一个只在校内开放、按标签匹配的搭子平台。',
        showCancel: false,
        confirmColor: '#8FB86A'
      })
    },
    openDoc(kind) {
      uni.navigateTo({ url: '/pages/doc/doc?type=' + kind })
    },

    logout() {
      uni.showModal({
        title: '退出登录',
        content: '退出后需要重新登录才能发布和聊天。',
        confirmText: '退出',
        confirmColor: '#D9534F',
        success: (r) => {
          if (!r.confirm) return
          // 解绑要读 token 与 cid，必须早于清 storage；unbindPush 同步读完才 await，所以不用等它
          unbindPush()
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
   设置页
   --------------------------------------------------------------------------
   干净优先：白卡片 + 细分割线 + 灰字值。
   不玩渐变和色块，只用一处草绿做开关的激活色（和搭子大厅呼应）。
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

/* 分组卡片 */
.group {
  margin: 24rpx 24rpx 0;
  background: var(--tf-card);
  border-radius: 20rpx;
  overflow: hidden;
  border: 2rpx solid var(--tf-line-soft);
}

/* 单元格 */
.cell {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 100rpx;
  padding: 0 26rpx;
}
/* 分割线：只画在中间，不顶到两边（微信那种） */
.cell + .cell::before {
  content: '';
  position: absolute;
  left: 26rpx;
  right: 0;
  top: 0;
  height: 2rpx;
  background: var(--tf-line-soft);
}
.cell:active {
  background: rgba(0, 0, 0, 0.03);
}

.cell-label {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  color: var(--tf-text);
}
.cell-value {
  flex: none;
  max-width: 340rpx;
  font-size: 25rpx;
  color: var(--tf-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-left: 16rpx;
}
.cell-arrow {
  flex: none;
  margin-left: 10rpx;
  font-size: 30rpx;
  color: var(--tf-text-3);
  line-height: 1;
}
.cell-switch {
  flex: none;
  transform: scale(0.86);
  transform-origin: right center;
}

/* 退出登录 */
.logout {
  margin: 40rpx 24rpx 0;
  height: 100rpx;
  background: var(--tf-card);
  border-radius: 20rpx;
  border: 2rpx solid var(--tf-line-soft);
  display: flex;
  align-items: center;
  justify-content: center;
}
.logout:active {
  background: rgba(217, 83, 79, 0.06);
}
.logout-t {
  font-size: 29rpx;
  font-weight: 700;
  color: #D9534F;
}

/* 页脚 */
.foot {
  display: flex;
  justify-content: center;
  padding: 48rpx 40rpx 0;
}
.foot-t {
  font-size: 21rpx;
  color: var(--tf-text-3);
  text-align: center;
  line-height: 1.6;
}
</style>
