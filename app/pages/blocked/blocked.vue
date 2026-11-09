<template>
  <view class="page">

    <!-- 导航 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">黑名单</text>
    </view>

    <!-- 未登录 -->
    <view class="state-box" v-if="needLogin">
      <text class="state-title">登录后才能查看黑名单</text>
      <text class="state-hint">黑名单跟着账号走，登录后才会显示你拉黑过的人</text>
      <button class="btn" @tap="goLogin">去登录</button>
    </view>

    <!-- 首屏加载 -->
    <view class="state-box" v-else-if="loading && list.length === 0">
      <text class="state-text">加载中…</text>
    </view>

    <!-- 首屏失败 -->
    <view class="state-box" v-else-if="error && list.length === 0">
      <text class="state-title">没能加载黑名单</text>
      <text class="state-hint">{{ error }}</text>
      <text class="retry" @tap="fetch">加载失败，点这里重试</text>
    </view>

    <!-- 空态 -->
    <view class="state-box" v-else-if="list.length === 0">
      <text class="state-title">黑名单是空的</text>
      <text class="state-hint">在聊天页或对方主页点右上角菜单可以把人加进黑名单</text>
    </view>

    <!-- 列表 -->
    <view class="list" v-else>
      <view class="item" v-for="b in list" :key="b.user_id">
        <!-- 头像：common/avatar/avatarCache.js —— 本地落盘 + 解码完成后整体淡入。
             key 用 'bk' + user_id：同一行多次渲染不变，淡入不会反复触发。
             没有可用本地路径就留同尺寸空圆，绝不塞默认头像图。 -->
        <image
          v-if="avaSrcOf('bk' + b.user_id)"
          class="avatar avatar--img ava-fade"
          :class="{ 'ava-fade--in': avaReadyOf('bk' + b.user_id) }"
          :src="avaSrcOf('bk' + b.user_id)"
          mode="aspectFill"
          @load="avaOnLoad('bk' + b.user_id)"
          @error="avaOnError('bk' + b.user_id, b.avatar_url)"
        />
        <view v-else class="avatar" />
        <view class="item-main">
          <text class="item-name">{{ b.nickname || '未命名用户' }}</text>
          <text class="item-meta">{{ blockedLabel(b) }}</text>
        </view>
        <view class="unblock" @tap="unblock(b)">
          <text class="unblock-t">解除</text>
        </view>
      </view>

      <text class="retry" v-if="error" @tap="fetch">刷新失败，点这里重试</text>
    </view>
  </view>
</template>

<script>
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

export default {
  // 头像淡入的公共时序（common/avatar/avatarCache.js）
  mixins: [avatarFadeMixin],
  data() {
    return {
      list: [],
      loading: true,
      error: '',
      needLogin: false,
      removingId: ''
    }
  },

  // 头像：整页一次挂上（fetch 每次换新数组、解除后还会 filter，deep 保证都跟上）
  watch: {
    list: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (b) => 'bk' + (b && b.user_id),
          (b) => b && b.avatar_url
        )
      }
    }
  },

  onShow() {
    const token = uni.getStorageSync('token')
    if (!token) {
      this.needLogin = true
      this.loading = false
      return
    }
    this.needLogin = false
    this.fetch()
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
     * 拉黑列表。
     * 用 onShow 而不是 onLoad：从聊天页/对方主页拉黑后返回，这里必须是最新的。
     * 失败保留旧列表只在底部加一行重试，不让已经看到的人凭空消失。
     */
    async fetch() {
      if (this.loading && this.list.length > 0) return
      this.loading = true
      this.error = ''
      try {
        const res = await uniCloud.callFunction({
          name: 'user-block',
          data: {
            token: uni.getStorageSync('token') || '',
            action: 'list'
          }
        })
        const r = res.result || {}
        if (r.code === 401) {
          this.needLogin = true
          this.list = []
          return
        }
        if (r.code !== 0) {
          this.error = r.msg || '加载失败'
          return
        }
        const d = r.data || {}
        this.list = d.list || []
      } catch (e) {
        console.warn('[黑名单] 加载失败：' + ((e && e.message) || ''))
        this.error = '加载失败'
      } finally {
        this.loading = false
      }
    },

    /**
     * 「拉黑于 M月D日」。
     * created_at 可能是毫秒数也可能是 ISO 串：iOS 只认 yyyy/MM/dd，
     * 所以先把 - 换成 / 再 new Date，解析不出来就退化成一句「时间未知」而不是 NaN月。
     */
    blockedLabel(row) {
      const t = row && row.created_at
      if (!t) return '拉黑时间未知'
      let d = null
      if (typeof t === 'number') {
        d = new Date(t)
      } else {
        d = new Date(String(t).replace(/-/g, '/'))
      }
      if (!d || isNaN(d.getTime())) return '拉黑时间未知'
      return '拉黑于 ' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
    },

    unblock(row) {
      if (this.removingId) return
      const name = row.nickname || '对方'
      uni.showModal({
        title: '解除拉黑',
        content: '解除对 ' + name + ' 的拉黑？解除后对方可以重新给你发消息和好友申请',
        confirmText: '解除',
        confirmColor: '#c0392b',
        success: (r) => {
          if (r.confirm) this.doRemove(row)
        }
      })
    },

    /**
     * 解除拉黑。
     * removingId 同时当「进行中」和「防连点」用：一键解除只发一次请求。
     * 成功才从列表里移除；失败列表不动，用户还能再点一次。
     */
    async doRemove(row) {
      this.removingId = row.user_id
      try {
        const res = await uniCloud.callFunction({
          name: 'user-block',
          data: {
            token: uni.getStorageSync('token') || '',
            action: 'remove',
            target_user_id: row.user_id
          }
        })
        const r = res.result || {}
        if (r.code === 0) {
          this.list = this.list.filter((it) => it.user_id !== row.user_id)
          uni.showToast({ title: '已解除', icon: 'success' })
          return
        }
        if (r.code === 401) {
          this.needLogin = true
          this.list = []
          return
        }
        uni.showToast({ title: r.msg || '解除失败，请重试', icon: 'none' })
      } catch (e) {
        console.warn('[黑名单] 解除失败：' + ((e && e.message) || ''))
        uni.showToast({ title: '解除失败，请重试', icon: 'none' })
      } finally {
        this.removingId = ''
      }
    }
  }
}
</script>

<style>
/* ==========================================================================
   黑名单页
   --------------------------------------------------------------------------
   白卡 + 头像 + 一行「拉黑于」+ 右侧小号描边按钮。
   解除是危险操作：文字用 --tf-danger，但只在按钮文字上，不铺底色。
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

/* 列表 */
.list {
  margin: 24rpx 24rpx 0;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  overflow: hidden;
}
.item {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 24rpx 26rpx;
}
.item + .item::before {
  content: '';
  position: absolute;
  left: 26rpx;
  right: 0;
  top: 0;
  height: 2rpx;
  background: var(--tf-line-soft);
}
.item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  margin-left: 20rpx;
}
.item-name {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--tf-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.item-meta {
  margin-top: 6rpx;
  font-size: 21rpx;
  color: var(--tf-text-3);
}

/* 头像：基类在前，修饰类在后，同权重靠源码顺序生效 */
.avatar {
  flex: none;
  width: 76rpx;
  height: 76rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--tf-primary-soft);
  border: 2rpx solid var(--tf-line);
}
.avatar--img {
  border-radius: 50%;
  overflow: hidden;
  display: block;
  background: var(--tf-card-line);
}
.avatar--def {
  border-radius: 50%;
  overflow: hidden;
  display: block;
  background: var(--tf-primary-soft);
}

/* 解除：小号描边按钮 */
.unblock {
  flex: none;
  margin-left: 16rpx;
  height: 56rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2rpx solid var(--tf-danger);
  border-radius: 999rpx;
}
.unblock:active {
  background: var(--tf-line-soft);
}
.unblock-t {
  font-size: 23rpx;
  font-weight: 600;
  color: var(--tf-danger);
}

/* 重试 */
.retry {
  display: block;
  margin: 24rpx 24rpx 8rpx;
  font-size: 24rpx;
  color: var(--tf-primary-deep);
  text-align: center;
}

/* 状态盒（未登录 / 加载中 / 失败 / 空态） */
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
/* 头像淡入（common/avatar/avatarCache.js）：空圆 → 完整头像 160ms。
   用 opacity 不摘节点，节点一直在，不会引起行高抖动。 */
.ava-fade {
  opacity: 0;
  transition: opacity 160ms ease-out;
}

.ava-fade--in {
  opacity: 1;
}
</style>
