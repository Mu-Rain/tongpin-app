<template>
  <view class="page">
    <!-- 顶部问候 -->
    <view class="header">
      <text class="hello">{{ helloText }}</text>
      <text class="sub">今天想找点什么搭子？</text>
    </view>

    <!-- 登录状态卡：M1 验收用，能看见自己的昵称/学校/信誉分就说明登录通了 -->
    <view class="usercard" v-if="userInfo">
      <view class="usercard-top">
        <text class="usercard-name">{{ userInfo.nickname }}</text>
        <text class="usercard-badge" v-if="userInfo.schoolVerified">✔ 已认证</text>
        <text class="usercard-badge usercard-badge--off" v-else>未认证</text>
      </view>
      <view class="usercard-meta">
        <text class="usercard-item">信誉 {{ userInfo.credit }}</text>
        <text class="usercard-item" v-if="userInfo.school">{{ userInfo.school }}</text>
        <text class="usercard-item" v-else>未填学校</text>
      </view>
      <text class="usercard-logout" @tap="onLogout">退出登录</text>
    </view>

    <!-- 未登录提示（本地没缓存时出现） -->
    <view class="usercard usercard--guest" v-else>
      <text class="usercard-guest-text">当前未登录，点这里去登录</text>
      <text class="usercard-logout" @tap="goLogin">去登录 →</text>
    </view>

    <!-- 连通性自检：M0 的验收按钮。M0 已过，这里收起来，不影响日常使用 -->
    <view class="selftest">
      <text class="selftest-toggle" @tap="showSelfTest = !showSelfTest">
        {{ showSelfTest ? '▾' : '▸' }} 云函数连通性自检
      </text>
      <block v-if="showSelfTest">
        <button class="selftest-btn" :disabled="testing" @tap="runSelfTest">
          {{ testing ? '测试中…' : '测试云函数连通性' }}
        </button>
        <text class="selftest-result">{{ testResult }}</text>
      </block>
    </view>

    <!-- 功能入口（两列，用 flex 实现，不用 grid） -->
    <view class="entry-wrap">
      <view
        class="entry"
        v-for="item in entries"
        :key="item.key"
        @tap="onEntry(item)"
      >
        <text class="entry-icon">{{ item.icon }}</text>
        <text class="entry-title">{{ item.title }}</text>
        <text class="entry-desc">{{ item.desc }}</text>
      </view>
    </view>

    <!-- 每日百科（占位） -->
    <view class="card">
      <text class="card-title">每日百科</text>
      <text class="card-body">这里每天推送一条校园生活小知识，由云函数定时更新。</text>
      <text class="card-note">数据待接入</text>
    </view>

    <view class="tip">
      <text class="tip-text">当前是骨架版本，各模块的接口与页面按 05 计划逐天接入。</text>
    </view>
  </view>
</template>
<script>
export default {
  data() {
    return {
      entries: [
        {
          key: 'buddy',
          icon: '🤝',
          title: '搭子大厅',
          desc: '发布需求 · 找同频的人',
          day: '第 3 天'
        },
        {
          key: 'mybuddy',
          icon: '🏷️',
          title: '我的搭子',
          desc: '给搭子起专属称呼',
          day: '第 6 天'
        },
        {
          key: 'fitness',
          icon: '🏃',
          title: '健身',
          desc: '动作库 · 计划 · 训练记录',
          day: '第 20 天'
        },
        {
          key: 'study',
          icon: '📚',
          title: '学习',
          desc: '番茄钟 · 自习记录',
          day: '第 22 天'
        }
      ],
      testing: false,
      showSelfTest: false,
      testResult: '还没测过 —— 点上面的按钮，用来确认云函数能不能调通。',
      userInfo: null
    }
  },
  computed: {
    greeting() {
      const h = new Date().getHours()
      if (h < 6) return '夜深了'
      if (h < 12) return '早上好'
      if (h < 18) return '下午好'
      return '晚上好'
    },
    // 顶部问候语带上昵称；没登录就退回默认
    helloText() {
      if (this.userInfo && this.userInfo.nickname) {
        return this.greeting + '，' + this.userInfo.nickname
      }
      return this.greeting
    }
  },
  onShow() {
    // 每次进页面都刷一次本地用户信息（登录/注册后会写这个 key）
    const info = uni.getStorageSync('userInfo')
    this.userInfo = info || null
  },
  methods: {
    onEntry(item) {
      // 已经做好的模块直接跳，其余还没到日子，先弹提示。
      // 注意：「消息」和「我的」现在是底部 tabBar 的固定入口，
      // 这里不再重复放，所以也去掉了对应的分支。
      if (item.key === 'buddy') {
        uni.navigateTo({ url: '/pages/hall/hall' })
        return
      }
      if (item.key === 'mybuddy') {
        uni.navigateTo({ url: '/pages/buddy/buddy' })
        return
      }
      if (item.key === 'fitness') {
        uni.navigateTo({ url: '/pages/fitness/fitness' })
        return
      }
      if (item.key === 'study') {
        uni.navigateTo({ url: '/pages/study/study' })
        return
      }
      uni.showToast({
        title: item.title + '：' + item.day + '接入',
        icon: 'none'
      })
    },

    // 退出登录：清本地 token 回登录页
    onLogout() {
      uni.showModal({
        title: '退出登录',
        content: '确定要退出吗？',
        success: (r) => {
          if (!r.confirm) return
          uni.removeStorageSync('token')
          uni.removeStorageSync('userInfo')
          // 必须一起清掉 autoLogin，否则回到登录页时
          // 那个「检测到已登录」的快捷入口还会显示出来
          uni.removeStorageSync('autoLogin')
          this.userInfo = null
          uni.reLaunch({ url: '/pages/login/login' })
        }
      })
    },

    goLogin() {
      uni.reLaunch({ url: '/pages/login/login' })
    },

    /**
     * 连通性自检（M0 验收）
     * 调用云函数 hello，能拿到返回值 = 服务空间关联成功、云函数部署成功、App 能联网。
     * 失败会把原因写在按钮下面，方便直接截图排查。
     */
    async runSelfTest() {
      if (this.testing) return
      this.testing = true
      this.testResult = '正在调用云函数 hello…'

      // 先确认 uniCloud 在这个平台能不能用（H5 端默认用不了，要配代理）
      if (typeof uniCloud === 'undefined') {
        this.testing = false
        this.testResult = '✗ 当前平台用不了 uniCloud（如果你是在浏览器里看，请改用「运行到手机」）'
        return
      }

      try {
        const res = await uniCloud.callFunction({ name: 'hello' })
        const body = (res && res.result) || {}
        if (body.code === 0) {
          this.testResult =
            '✓ 连通成功：' + body.data.text + '｜服务空间 ' + (body.data.spaceId || '(未知)')
          uni.showToast({ title: '连通成功', icon: 'success' })
        } else {
          this.testResult = '✗ 云函数返回错误：' + (body.msg || '未知')
        }
      } catch (err) {
        // 常见原因见 05 文档：没关联服务空间 / 云函数没上传 / 网络不通
        this.testResult = '✗ 调用失败：' + (err && err.message ? err.message : String(err))
      } finally {
        this.testing = false
      }
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 32rpx 32rpx 60rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
}

.header {
  padding: 24rpx 8rpx 40rpx;
  display: flex;
  flex-direction: column;
}

.hello {
  font-size: 48rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.sub {
  margin-top: 12rpx;
  font-size: 28rpx;
  color: var(--tf-text-3);
}

.entry-wrap {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
}

.entry {
  width: 334rpx;
  margin-bottom: 24rpx;
  padding: 32rpx 28rpx;
  box-sizing: border-box;
  background-color: var(--tf-card);
  border-radius: 24rpx;
  display: flex;
  flex-direction: column;
}

.entry-icon {
  font-size: 48rpx;
}

.entry-title {
  margin-top: 16rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.entry-desc {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--tf-text-3);
}

.card {
  margin-top: 12rpx;
  padding: 32rpx 28rpx;
  background-color: var(--tf-card);
  border-radius: 24rpx;
  display: flex;
  flex-direction: column;
}

.card-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.card-body {
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
}

.card-note {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: var(--tf-text-3);
}

.tip {
  margin-top: 40rpx;
  padding: 0 8rpx;
}

.selftest {
  margin-bottom: 24rpx;
  padding: 20rpx 28rpx;
  background-color: var(--tf-card);
  border-radius: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

/* ---- 登录状态卡 ---- */
.usercard {
  margin-bottom: 24rpx;
  padding: 28rpx;
  background-color: var(--tf-card);
  border-radius: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.usercard--guest {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.usercard-guest-text {
  font-size: 28rpx;
  color: var(--tf-text-2);
}

.usercard-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
}

.usercard-name {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--tf-text-1);
}

.usercard-badge {
  padding: 4rpx 16rpx;
  font-size: 22rpx;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 20rpx;
}

.usercard-badge--off {
  color: var(--tf-text-3);
  background-color: var(--tf-bg);
}

.usercard-meta {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 24rpx;
}

.usercard-item {
  font-size: 26rpx;
  color: var(--tf-text-3);
}

.usercard-logout {
  font-size: 26rpx;
  color: var(--tf-primary);
}

.selftest-title {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--tf-text-2);
}

/* 折叠开关：平时只留一行，不占首页版面 */
.selftest-toggle {
  font-size: 24rpx;
  color: var(--tf-text-3);
}

.selftest-btn {
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 44rpx;
  background-color: var(--tf-primary);
  color: #ffffff;
  font-size: 30rpx;
}

.selftest-btn[disabled] {
  background-color: #ffd3c7;
}

.selftest-result {
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
  word-break: break-all;
}

.tip-text {
  font-size: 24rpx;
  color: var(--tf-text-3);
  line-height: 1.7;
}
</style>
