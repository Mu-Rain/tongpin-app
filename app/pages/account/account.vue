<template>
  <view class="page">
    <view class="head">
      <text class="head-title">切换账号</text>
      <text class="head-desc">这台设备登录过的号都在下面，点一下直接进。登录凭据过期了才需要重新输密码。</text>
    </view>

    <!-- 登录过的号 -->
    <view class="list" v-if="accounts.length">
      <view
        v-for="a in accounts"
        :key="a.user_id"
        class="acc"
        :class="{ 'acc--current': a.user_id === currentId }"
        @tap="onPick(a)"
      >
        <view class="acc-avatar">{{ (a.nickname || '同').slice(0, 1) }}</view>
        <view class="acc-main">
          <view class="acc-top">
            <text class="acc-name">{{ a.nickname || '同学' }}</text>
            <text v-if="a.user_id === currentId" class="acc-badge">当前</text>
            <text v-else-if="!usable(a)" class="acc-badge acc-badge--warn">需重新登录</text>
          </view>
          <text class="acc-sub">{{ maskPhone(a.phone) }}<text v-if="a.school"> · {{ a.school }}</text></text>
        </view>
        <text class="acc-arrow">›</text>
      </view>
    </view>

    <view class="empty" v-else>
      <text class="empty-title">还没有登录过别的号</text>
      <text class="empty-desc">在这里登录过一次的号会自动记下来，下次切换就不用再输密码。</text>
    </view>

    <!-- 用一个新号 -->
    <view class="actions">
      <button class="btn btn--primary" @tap="goNewLogin">用其他手机号登录 →</button>
      <button class="btn btn--plain" @tap="onClearAll" v-if="accounts.length">清空账号列表</button>
    </view>

    <!--
      为什么不是点一下就直接切：
      切号会改变"我是谁"，误触代价大（比如正在给别人发消息时点错），
      所以当前账号那一条不响应点击，其他号点之前再确认一次。
    -->
    <view class="note">
      <text class="note-title">说明</text>
      <text class="note-line">· 切换不会删除任何聊天记录，两个号的数据都还在服务器上</text>
      <text class="note-line">· 这里只记登录凭据，不存密码</text>
      <text class="note-line">· 最多记住 {{ MAX_ACCOUNTS }} 个号，超出的会自动丢掉最久没登的</text>
    </view>
  </view>
</template>

<script>
import book from '@/common/account/book.js'

export default {
  data() {
    return {
      accounts: [],
      currentId: '',
      MAX_ACCOUNTS: 5
    }
  },

  onShow() {
    this.load()
  },

  methods: {
    load() {
      this.accounts = book.listAll()
      this.currentId = book.currentUserId()

      // 当前账号没在簿里（老用户、或者账号簿是这次更新后才有的），
      // 就现补一条，否则用户看到的第一屏是空的，以为坏了。
      if (this.currentId && !this.accounts.some((a) => a.user_id === this.currentId)) {
        const token = uni.getStorageSync('token')
        const u = uni.getStorageSync('userInfo') || {}
        if (token && u._id) {
          book.remember({ token: token, user: u })
          this.accounts = book.listAll()
        }
      }
    },

    usable(a) {
      return book.isUsable(a)
    },

    maskPhone(p) {
      const s = String(p || '')
      if (s.length !== 11) return s || '未记录手机号'
      return s.slice(0, 3) + '****' + s.slice(7)
    },

    onPick(a) {
      if (a.user_id === this.currentId) {
        uni.showToast({ title: '这已经是当前账号', icon: 'none' })
        return
      }

      if (!this.usable(a)) {
        uni.showModal({
          title: '需要重新登录',
          content: '「' + (a.nickname || '这个号') + '」的登录凭据已过期，需要重新输一次密码。',
          success: (r) => {
            if (!r.confirm) return
            this.goNewLogin()
          }
        })
        return
      }

      uni.showModal({
        title: '切换账号',
        content: '切换到「' + (a.nickname || '这个号') + '」？',
        confirmText: '切换',
        success: (r) => {
          if (!r.confirm) return
          const ok = book.switchTo(a.user_id)
          if (!ok) {
            uni.showToast({ title: '切换失败，请重新登录', icon: 'none' })
            return
          }
          uni.showToast({ title: '已切换到 ' + (a.nickname || '新号'), icon: 'none' })
          setTimeout(() => {
            uni.reLaunch({ url: '/pages/index/index' })
          }, 500)
        }
      })
    },

    goNewLogin() {
      // 先把当前会话清掉，登录页才会显示空白表单而不是"以 xxx 继续"
      uni.removeStorageSync('token')
      uni.removeStorageSync('userInfo')
      uni.removeStorageSync('autoLogin')
      uni.reLaunch({ url: '/pages/login/login' })
    },

    onClearAll() {
      uni.showModal({
        title: '清空账号列表',
        content: '会删掉这台设备记住的所有号（不影响服务器上的账号和数据）。下次要用哪个号得重新输密码。',
        confirmText: '清空',
        success: (r) => {
          if (!r.confirm) return
          const cur = this.currentId
          for (const a of book.listAll()) {
            if (a.user_id !== cur) book.remove(a.user_id)
          }
          this.load()
          uni.showToast({ title: '已清空（保留当前账号）', icon: 'none' })
        }
      })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 32rpx 32rpx 80rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
}

.head {
  margin-bottom: 24rpx;
}
.head-title {
  display: block;
  font-size: 40rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.head-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--tf-text-3);
}

/* ---- 账号列表 ---- */
.list {
  background-color: var(--tf-card);
  border-radius: 28rpx;
  overflow: hidden;
}

.acc {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 22rpx;
  padding: 26rpx 28rpx;
  border-bottom: 2rpx solid var(--tf-line);
}
.acc:last-child {
  border-bottom: none;
}
.acc--current {
  background-color: var(--tf-primary-soft);
}

.acc-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 44rpx;
  flex: none;
  background-color: var(--tf-primary);
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.acc-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  overflow: hidden;
}
.acc-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}
.acc-name {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.acc-badge {
  font-size: 20rpx;
  font-weight: 700;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 999rpx;
  padding: 2rpx 14rpx;
}
.acc-badge--warn {
  background-color: var(--tf-danger);
}
.acc-sub {
  font-size: 23rpx;
  color: var(--tf-text-3);
}
.acc-arrow {
  flex: none;
  font-size: 40rpx;
  color: var(--tf-text-3);
  line-height: 1;
}

/* ---- 空态 ---- */
.empty {
  padding: 60rpx 32rpx;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14rpx;
}
.empty-title {
  font-size: 30rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.empty-desc {
  font-size: 24rpx;
  line-height: 1.6;
  text-align: center;
  color: var(--tf-text-3);
}

/* ---- 按钮 ---- */
.actions {
  margin-top: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}
.btn {
  height: 92rpx;
  line-height: 92rpx;
  border-radius: 20rpx;
  font-size: 30rpx;
  font-weight: 700;
  text-align: center;
}
.btn--primary {
  background-color: var(--tf-primary);
  color: #ffffff;
}
.btn--plain {
  background-color: var(--tf-card);
  color: var(--tf-text-2);
  border: 2rpx solid var(--tf-line);
}

/* ---- 说明 ---- */
.note {
  margin-top: 36rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}
.note-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--tf-text-2);
}
.note-line {
  font-size: 22rpx;
  line-height: 1.7;
  color: var(--tf-text-3);
}
</style>
