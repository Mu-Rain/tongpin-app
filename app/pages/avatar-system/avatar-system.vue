<template>
  <view class="page">

    <!-- 导航：本页自己画的返回，跟「设置」页同一套 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">系统头像</text>
    </view>

    <view class="hint-box">
      <text class="hint">点一张就换成它，不用上传，离线也能显示。</text>
    </view>

    <!-- 3 列网格：7 张内置头像 -->
    <view class="grid">
      <view
        class="cell"
        v-for="it in list"
        :key="it.path"
        :class="{ 'cell--on': it.path === current }"
        @tap="pick(it)"
      >
        <view class="face">
          <image class="face-img" :src="it.path" mode="aspectFill" />
        </view>
        <text class="face-label">{{ it.label }}</text>
        <view class="tick" v-if="it.path === current">
          <text class="tick-txt">✓</text>
        </view>
      </view>
    </view>

    <view class="foot">
      <text class="foot-txt">换了系统头像不会删掉云存储里的旧图；换回自己拍的照片也可以。</text>
    </view>
  </view>
</template>

<script>
/* 内置头像：包内静态资源，路径就是可直接渲染的地址，不需要换链。
   ★ 顺序和文件名必须与 app/static/avatars/ 一致（两边一起改）；
     云函数 user-avatar 的白名单也按这份清单校验，改名要三处同步。 */
const PRESET_AVATARS = [
  { path: '/static/avatars/av-study.png', label: '学习' },
  { path: '/static/avatars/av-fitness.png', label: '健身' },
  { path: '/static/avatars/av-photo.png', label: '拍照' },
  { path: '/static/avatars/av-meal.png', label: '吃饭' },
  { path: '/static/avatars/av-sport.png', label: '运动' },
  { path: '/static/avatars/av-competition.png', label: '竞赛' },
  { path: '/static/avatars/av-other.png', label: '其他' }
]

export default {
  data() {
    return {
      list: PRESET_AVATARS,
      /* 当前头像：库里可能是 fileID，也可能已经是包内路径，两者都和本页的 path 直接比 */
      current: '',
      /* 防连点：一次没回来之前不许再发第二次请求 */
      saving: false
    }
  },
  onLoad() {
    this.syncCurrent()
  },
  onShow() {
    // 从别处回来（例如上一页刚换过）重新对一次选中态
    this.syncCurrent()
  },
  methods: {
    syncCurrent() {
      const u = uni.getStorageSync('userInfo') || {}
      const cached = String(u.avatar_url || '')
      const raw = String(u.avatar || '')
      this.current = cached || raw
    },

    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/mine/mine' })
      })
    },

    /* 选中一张：交给云函数落库 —— 前端永远不直连数据库，
       不然谁都能把别人空间的地址写进自己的头像字段。 */
    async pick(item) {
      if (this.saving) return
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '先登录', icon: 'none', duration: 1500 })
        return
      }
      this.saving = true
      uni.showLoading({ title: '保存中', mask: true })
      let ok = false
      let failMsg = ''
      try {
        const res = await uniCloud.callFunction({
          name: 'user-avatar',
          data: { token: token, file_id: item.path }
        })
        const r = res.result || {}
        if (r.code !== 0) throw new Error(r.msg || '设置失败')
        /* 云函数只改了库；「我的」页 onShow 读的是本地 storage，
           所以这份必须跟着改，否则返回去还是上一张头像。
           avatar_url 一起写成这个路径：「我的」页先看 avatar_url，写空会让它又去问一次服务端。 */
        const info = uni.getStorageSync('userInfo') || {}
        const merged = Object.assign({}, info, {
          avatar: item.path,
          avatar_url: item.path
        })
        uni.setStorageSync('userInfo', merged)
        this.current = item.path
        ok = true
      } catch (e) {
        failMsg = e.message || '设置失败'
      } finally {
        this.saving = false
        uni.hideLoading()
      }
      // 提示必须等 loading 关掉之后再弹：两者共用原生提示通道
      if (ok) {
        uni.showToast({ title: '头像已更新', icon: 'success', duration: 1200 })
        uni.navigateBack()
      } else {
        // 失败留在本页，别把人退回去却什么都没变
        uni.showToast({ title: failMsg, icon: 'none', duration: 1800 })
      }
    }
  }
}
</script>

<style>
/* ==========================================================================
   系统头像
   --------------------------------------------------------------------------
   和「我的」页同一套视觉语言：奶油底 + 白卡 + --tf-* 令牌，不加新配色。
   头像用圆形，因为它在「我的」页就是一个圆 —— 选的时候看到的就是最终的样子。
   ========================================================================== */
.page {
  min-height: 100vh;
  background: var(--tf-bg);
  padding-bottom: 40rpx;
}

/* 导航（同设置页） */
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

.hint-box {
  padding: 8rpx 40rpx 24rpx;
}
.hint {
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* 3 列网格：靠 flex-wrap + 33.333% 宽度，不依赖 grid（各端支持不一致） */
.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  padding: 0 16rpx;
}
.cell {
  position: relative;
  width: 33.333%;
  box-sizing: border-box;
  padding: 16rpx 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.face {
  width: 148rpx;
  height: 148rpx;
  border-radius: 50%;
  overflow: hidden;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line-soft);
  box-sizing: border-box;
}
.face-img {
  width: 100%;
  height: 100%;
  display: block;
}
.cell--on .face {
  /* 选中态用主色描边环：不新增颜色，靠 --tf-primary-deep 拉开和白卡的对比 */
  border-color: transparent;
  box-shadow: 0 0 0 6rpx var(--tf-primary-deep);
}
.face-label {
  margin-top: 14rpx;
  font-size: 24rpx;
  color: var(--tf-text-2);
}
.cell--on .face-label {
  color: var(--tf-text);
  font-weight: 600;
}
.tick {
  position: absolute;
  right: 22rpx;
  top: 22rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: var(--tf-primary-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 4rpx solid var(--tf-card);
  box-sizing: content-box;
}
.tick-txt {
  font-size: 22rpx;
  line-height: 1;
  color: #fff;
}

.foot {
  padding: 32rpx 40rpx 0;
}
.foot-txt {
  font-size: 23rpx;
  line-height: 1.7;
  color: var(--tf-text-3);
}
</style>
