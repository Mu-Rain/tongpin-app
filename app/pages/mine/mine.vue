<template>
  <view class="page">
    <!-- 资料卡 -->
    <view class="profile">
      <view class="avatar">{{ avatarText }}</view>
      <view class="profile-main">
        <view class="profile-name-row">
          <text class="profile-name">{{ user.nickname || '未登录' }}</text>
          <text class="badge" v-if="user.schoolVerified">✔ 已认证</text>
          <text class="badge badge--off" v-else>未认证</text>
        </view>
        <text class="profile-sub">{{ user.school || '未填学校' }}</text>
        <text class="profile-sub">信誉分 {{ user.credit }} · 标签 {{ myTagCount }}/10</text>
      </view>
    </view>

    <!-- 两个入口模块：我的标签 / 学生认证。点进去才是具体页面。 -->
    <view class="mods">
      <view class="mod" @tap="goTags">
        <view class="mod-main">
          <text class="mod-kicker">TAGS</text>
          <text class="mod-title">我的标签</text>
          <text class="mod-desc">{{ myTagCount > 0 ? '已选 ' + myTagCount + ' / 10 个' : '还没选，点进去挑' }}</text>
        </view>
        <text class="mod-arrow">›</text>
      </view>

      <view class="mod" @tap="goVerify">
        <view class="mod-main">
          <text class="mod-kicker">VERIFY</text>
          <text class="mod-title">学生认证</text>
          <text class="mod-desc">{{ verifyDesc }}</text>
        </view>
        <text class="mod-arrow">›</text>
      </view>
    </view>

    <!-- 管理员专用：审核入口。普通用户看不到这一块。 -->
    <view class="card card--admin" v-if="isAdmin">
      <view class="card-head">
        <text class="card-title">🔧 管理员</text>
        <text class="card-count">{{ pendingCount }} 条待审</text>
      </view>
      <text class="card-hint">这里能看到别人上传的学生证照片，属于敏感数据，只有管理员可见。</text>
      <button class="btn btn--admin" @tap="goAdmin">进入认证审核 →</button>
    </view>

    <!-- 未登录时给个出口 -->
    <view class="card" v-if="!isLoggedIn">
      <text class="card-hint">你还没登录，标签存不了。</text>
      <button class="btn" @tap="goLogin">去登录</button>
    </view>

    <view class="row">
      <text class="link" @tap="onSwitchAccount" v-if="isLoggedIn">切换账号</text>
      <text class="link link--muted" @tap="onLogout" v-if="isLoggedIn">退出登录</text>
    </view>

    <!--
      权限自检。
      排查「管理员卡片不显示」时加的：把前端实际读到的角色原样打出来，
      否则只能在"到底是没权限、还是本地缓存旧、还是页面没跳"之间瞎猜。
      非管理员默认折叠，管理员自动展开。
    -->
    <view class="diag">
      <text class="diag-toggle" @tap="showDiag = !showDiag">
        {{ showDiag ? '▾' : '▸' }} 权限自检
      </text>
      <view class="diag-body" v-if="showDiag || isAdmin">
        <text class="diag-line">role = "{{ user.role || '(空)' }}"</text>
        <text class="diag-line">is_admin = {{ user.is_admin === true ? 'true' : 'false / 没这个字段' }}</text>
        <text class="diag-line">isAdmin 判定 = {{ isAdmin ? '通过 ✓' : '不通过 ✗' }}</text>
        <text class="diag-line">nickname = "{{ user.nickname || '(空)' }}"</text>
        <view class="diag-btn" @tap="refreshMe">重新从服务器拉一次我的资料</view>
        <text class="diag-hint" v-if="refreshMsg">{{ refreshMsg }}</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      user: {},
      // 认证状态摘要，给「学生认证」入口卡显示一句话用
      verifyStatus: 'none', // none / pending / approved / rejected
      // 标签数量摘要（只取数字，完整编辑器在 pages/tags）
      myTagCount: 0,
      // 管理员入口：只有 role === 'admin' 或 is_admin === true 才显示
      pendingCount: 0,
      showDiag: false,
      refreshMsg: ''
    }
  },
  computed: {
    // 管理员的两种写法都认：role='admin'（set-admin 写的）/ is_admin=true（早期设计）
    isAdmin() {
      return this.user.role === 'admin' || this.user.is_admin === true
    },
    isLoggedIn() {
      return !!uni.getStorageSync('token')
    },
    avatarText() {
      const n = this.user.nickname || ''
      return n ? n.slice(0, 1) : '同'
    },
    // 认证入口卡的一句话状态
    verifyDesc() {
      const map = {
        approved: '已认证 · 校园身份已解锁',
        pending: '审核中，1–2 个工作日出结果',
        rejected: '上次没通过，可以重新提交'
      }
      return map[this.verifyStatus] || '未认证 · 认证后才能进同校频道'
    }
  },
  onShow() {
    const info = uni.getStorageSync('userInfo')
    this.user = info || {}
    // 每次回到这页都刷新一下入口卡上的状态（刚从标签页/认证页回来时会变）
    this.loadVerifyStatus()
    this.loadTagCount()
    // 管理员：顺手拉一次待审数量，让入口上能看到数字
    if (this.isAdmin) this.loadPendingCount()
  },
  methods: {
    // 只取标签数量，用于入口卡的「已选 N / 10」。完整编辑在 pages/tags。
    // 轻量：不拉标签字典，只读我已选的那份。
    async loadTagCount() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.myTagCount = 0
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'user-tags',
          data: { action: 'get', token }
        })
        const r = res.result || {}
        if (r.code === 0) this.myTagCount = ((r.data && r.data.list) || []).length
      } catch (e) {
        // 静默：拉不到就保持原值，不影响页面
      }
    },

    // 管理员：待审数量
    async loadPendingCount() {
      try {
        const res = await uniCloud.callFunction({
          name: 'verify-review',
          data: { action: 'list', token: uni.getStorageSync('token') || '', status: 'pending' }
        })
        const r = res.result || {}
        if (r.code === 0) this.pendingCount = (r.data && r.data.total) || 0
      } catch (e) {
        // 静默：拉不到数字不影响进入审核页
      }
    },

    goAdmin() {
      uni.navigateTo({ url: '/pages/verify-admin/verify-admin' })
    },

    /**
     * 重新从服务器拉一次「我的资料」，并覆盖本地缓存。
     *
     * 为什么需要它：userInfo 是登录那一刻写进本地存储的，之后再改数据库里的
     * role/is_admin，本地那份不会跟着变。以前只能靠「退出再登录」刷新，
     * 现在给一个按钮，省得反复登录。
     *
     * 走的是 user-me 云函数（读库里的最新记录），不重新走登录流程 ——
     * 登录要密码，这里不需要。
     */
    async refreshMe() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.refreshMsg = '没登录，先登录'
        return
      }
      this.refreshMsg = '拉取中…'
      try {
        const res = await uniCloud.callFunction({
          name: 'user-me',
          data: { token }
        })
        const r = res.result || {}
        if (r.code === 0 && r.data && r.data.user) {
          // 用服务器返回的覆盖本地，合并而不是整体替换，避免丢掉本地独有字段
          const merged = Object.assign({}, this.user, r.data.user)
          uni.setStorageSync('userInfo', merged)
          this.user = merged
          this.refreshMsg = '✓ 已刷新：role=' + (merged.role || '(空)')
          if (this.isAdmin) this.loadPendingCount()
        } else {
          this.refreshMsg = '✗ ' + (r.msg || '拉取失败')
        }
      } catch (e) {
        this.refreshMsg = '✗ ' + (e.message || '调用失败') + '（user-me 部署了吗？）'
      }
    },

    // 入口模块：我的标签 / 学生认证
    goTags() {
      uni.navigateTo({ url: '/pages/tags/tags' })
    },

    goVerify() {
      uni.navigateTo({ url: '/pages/verify/verify' })
    },

    // 认证入口卡上的一句话状态。失败就保持 none，不让整页报错。
    async loadVerifyStatus() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.verifyStatus = 'none'
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'verify-submit',
          data: { token, action: 'status' }
        })
        const r = res.result || {}
        if (r.code === 0 && r.data) this.verifyStatus = r.data.status || 'none'
      } catch (e) {
        // 静默：拉不到就按未认证显示
      }
    },

    goLogin() {
      uni.reLaunch({ url: '/pages/login/login' })
    },

    onLogout() {
      uni.showModal({
        title: '退出登录',
        content: '确定要退出吗？',
        success: (r) => {
          if (!r.confirm) return
          uni.removeStorageSync('token')
          uni.removeStorageSync('userInfo')
          // ★ autoLogin 也要清。不清的话登录页读到的还是 state:'ok'，
          //   在新一轮自动登录逻辑下会立刻把人又弹回首页 —— 等于退不出去。
          uni.removeStorageSync('autoLogin')
          this.user = {}
          this.myTagCount = 0
          uni.reLaunch({ url: '/pages/login/login' })
        }
      })
    },

    /**
     * 切换账号。
     * 现在跳专门的「切换账号」页：那里列出这台设备登录过的所有号，
     * 点一下就切过去，不用再输一次手机号密码。
     * （以前是直接清 token 回登录页，用户得多打一遍密码，测试两个号时很烦。）
     */
    onSwitchAccount() {
      uni.navigateTo({ url: '/pages/account/account' })
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

/* ---- 资料卡 ---- */
.profile {
  padding: 32rpx;
  margin-bottom: 24rpx;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 24rpx;
}

.avatar {
  width: 112rpx;
  height: 112rpx;
  border-radius: 56rpx;
  background-color: var(--tf-primary);
  color: #ffffff;
  font-size: 48rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.profile-main {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  flex: 1;
}

.profile-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}

.profile-name {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--tf-text-1);
}

.badge {
  padding: 4rpx 14rpx;
  font-size: 20rpx;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 18rpx;
}

.badge--off {
  color: var(--tf-text-3);
  background-color: var(--tf-bg);
}

.profile-sub {
  font-size: 24rpx;
  color: var(--tf-text-3);
}

/* ---- 两个入口模块：我的标签 / 学生认证 ---- */
.mods {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-bottom: 24rpx;
}

.mod {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 32rpx;
  background-color: var(--tf-card);
  border-radius: 28rpx;
}

/* 按下时轻微回缩，给一点点击反馈（uni-app 里 hover-class 也可，这里用 CSS 兜底） */
.mod:active {
  opacity: 0.85;
}

.mod-main {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  flex: 1;
}

.mod-kicker {
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: var(--tf-text-3);
}

.mod-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.mod-desc {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

.mod-arrow {
  font-size: 40rpx;
  color: var(--tf-text-3);
  line-height: 1;
}

/* ---- 标签卡 ---- */
.card {
  padding: 32rpx;
  margin-bottom: 24rpx;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

/* 管理员卡：加橙色边 + 浅橙底，和普通卡区分开 */
.card--admin {
  border: 2rpx solid var(--tf-primary);
  background-color: var(--tf-primary-soft);
}

.card-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-text-1);
}

.card-count {
  font-size: 26rpx;
  color: var(--tf-text-3);
}

.card-count--warn {
  color: var(--tf-primary);
}

.card-hint {
  font-size: 24rpx;
  color: var(--tf-text-3);
  line-height: 1.7;
}

.empty {
  font-size: 26rpx;
  color: var(--tf-text-3);
}

/* ---- 标签块 ---- */
.picked {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 16rpx;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.group-title {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--tf-text-2);
}

.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 16rpx;
}

.chip {
  padding: 12rpx 26rpx;
  background-color: var(--tf-bg);
  border-radius: 30rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
}

.chip--on {
  background-color: var(--tf-primary);
}

.chip-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.chip-text--on {
  color: #ffffff;
}

.chip-x {
  font-size: 30rpx;
  color: #ffffff;
  line-height: 1;
}

/* ---- 按钮 ---- */
.btn {
  margin-top: 8rpx;
  height: 92rpx;
  line-height: 92rpx;
  font-size: 32rpx;
  font-weight: 600;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 46rpx;
  border: none;
}

.btn--off {
  opacity: 0.4;
}

/* 管理员入口按钮：方一点，区别于主操作按钮 */
.btn--admin {
  border-radius: 20rpx;
  font-size: 28rpx;
  height: 84rpx;
  line-height: 84rpx;
}

.save-tip {
  font-size: 24rpx;
  color: var(--tf-text-3);
  text-align: center;
}

.row {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  padding: 16rpx 0;
}

.link {
  font-size: 26rpx;
  color: var(--tf-primary);
  padding: 0 28rpx;
}

/* 「退出登录」比「切换账号」更低优先：切号是常用操作，登出不是 */
.link--muted {
  color: var(--tf-text-3);
}

/* ---- 权限自检（排查用，样式刻意低调）---- */
.diag {
  margin-top: 40rpx;
  padding: 20rpx 24rpx;
  background-color: var(--tf-card);
  border-radius: 16rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.diag-toggle {
  font-size: 24rpx;
  color: var(--tf-text-3);
}

.diag-body {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding-top: 8rpx;
}

.diag-line {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.diag-btn {
  margin-top: 12rpx;
  padding: 16rpx;
  font-size: 24rpx;
  color: var(--tf-primary);
  text-align: center;
  border: 2rpx solid var(--tf-primary);
  border-radius: 12rpx;
}

.diag-hint {
  font-size: 22rpx;
  color: var(--tf-text-3);
  text-align: center;
}
</style>
