<template>
  <view class="page">
    <!-- 非管理员先看空态：本地能判定的就别先发一次请求（与 admin-users 同一处理） -->
    <view class="deny" v-if="denied">
      <text class="deny-ico">🔒</text>
      <text class="deny-title">没有权限</text>
      <text class="deny-desc">后台看板只给管理员用。如果账号已标记为管理员仍看到这行字，退出重新登录一次。</text>
    </view>

    <block v-else>
      <view class="head">
        <text class="head-title">后台总览</text>
        <text class="head-sub">点任意一个数字进入对应页面</text>
      </view>

      <text class="hint" v-if="loading">加载中…</text>
      <text class="hint hint--err" v-else-if="errMsg" @tap="load">{{ errMsg }}，点这里重试</text>

      <block v-else>
        <view class="grid">
          <view class="cell" v-for="c in cells" :key="c.key" @tap="open(c)">
            <view class="cell-top">
              <text class="cell-num">{{ show(c.value) }}</text>
              <text class="cell-arrow" v-if="c.to">›</text>
            </view>
            <text class="cell-label">{{ c.label }}</text>
            <text class="cell-note" v-if="c.note">{{ c.note }}</text>
          </view>
        </view>

        <text class="foot">统计口径：按北京时间切天；已删除的内容不计入总数。</text>
      </block>
    </block>
  </view>
</template>

<script>
const CALL_NAME = 'admin-overview'

export default {
  data() {
    return {
      denied: false,
      loading: true,
      errMsg: '',
      stat: null
    }
  },
  computed: {
    cells() {
      const s = this.stat || {}
      const users = s.users || {}
      const posts = s.posts || {}
      const cards = s.cards || {}
      const reports = s.reports || {}
      const verify = s.verify || {}
      const meetups = s.meetups || {}
      return [
        {
          key: 'users',
          label: '注册用户',
          value: users.total,
          note: '今日 +' + this.show(users.today) + ' · 7 日 +' + this.show(users.week),
          to: '/pages/admin-users/admin-users'
        },
        {
          key: 'banned',
          label: '已封禁',
          value: users.banned,
          note: '在用户列表里筛选查看',
          to: '/pages/admin-users/admin-users'
        },
        {
          key: 'verify',
          label: '待认证',
          value: verify.pending,
          note: '学生证审核积压',
          to: '/pages/verify-admin/verify-admin'
        },
        {
          key: 'reports',
          label: '待处理举报',
          value: reports.pending,
          note: '今日新增 ' + this.show(reports.today),
          to: '/pages/admin-reports/admin-reports'
        },
        {
          key: 'posts',
          label: '同频圈动态',
          value: posts.total,
          note: '今日 +' + this.show(posts.today)
        },
        {
          key: 'cards',
          label: '需求卡片',
          value: cards.total,
          note: '进行中 ' + this.show(cards.open) + ' · 今日 +' + this.show(cards.today)
        },
        {
          key: 'meetups',
          label: '约局',
          value: meetups.total,
          note: '今日 +' + this.show(meetups.today) + ' · 双方签到 ' + this.show(meetups.confirmed)
        }
      ]
    }
  },
  onLoad() {
    const user = uni.getStorageSync('userInfo') || {}
    // 管理员两种写法都认（set-admin 写 role，早期设计写 is_admin），与 mine.vue 一致
    this.denied = !(user.role === 'admin' || user.is_admin === true)
    if (this.denied) {
      this.loading = false
      return
    }
    this.load()
  },
  onPullDownRefresh() {
    this.load(true)
  },
  methods: {
    /* 数字缺了就显示「—」：某个集合还没建时，硬显示 0 会被当成「真的没人」 */
    show(v) {
      return typeof v === 'number' ? String(v) : '—'
    },

    async load(fromPull) {
      if (!fromPull) this.loading = true
      this.errMsg = ''
      const token = uni.getStorageSync('token')
      try {
        const res = await uniCloud.callFunction({
          name: CALL_NAME,
          data: { token: token }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          this.errMsg = r.msg || '看板加载失败'
        } else {
          this.stat = r.data || null
        }
      } catch (e) {
        this.errMsg = '网络没有响应'
      } finally {
        this.loading = false
        if (fromPull) uni.stopPullDownRefresh()
      }
    },

    open(c) {
      if (!c.to) return
      uni.navigateTo({ url: c.to })
    }
  }
}
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  padding: 28rpx 28rpx 60rpx;
  box-sizing: border-box;
  background: var(--tf-bg);
}

.head {
  padding: 8rpx 4rpx 22rpx;
}
.head-title {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
  color: var(--tf-text);
  letter-spacing: 1rpx;
}
.head-sub {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--tf-text-3);
}

.hint {
  display: block;
  padding: 60rpx 0;
  text-align: center;
  font-size: 26rpx;
  color: var(--tf-text-3);
}
.hint--err {
  color: #b4453c;
}

.grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
}
/* 两列：数字要够大才扫得快，一列太浪费，三列数字会挤成一行字 */
.cell {
  width: 48.5%;
  margin-bottom: 20rpx;
  padding: 22rpx 22rpx 20rpx;
  box-sizing: border-box;
  border-radius: 24rpx;
  background: var(--tf-card);
  box-shadow: 0 6rpx 20rpx rgba(40, 40, 40, 0.04);
}
.cell-top {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
}
.cell-num {
  font-size: 52rpx;
  font-weight: 700;
  line-height: 1.1;
  color: var(--tf-text);
}
.cell-arrow {
  font-size: 30rpx;
  line-height: 1;
  color: var(--tf-text-3);
}
.cell-label {
  display: block;
  margin-top: 8rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.cell-note {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: var(--tf-text-3);
}

.foot {
  display: block;
  padding: 16rpx 6rpx 0;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--tf-text-3);
}

/* 空态：非管理员看到的就是这一段，不要给任何操作入口 */
.deny {
  padding: 160rpx 40rpx;
  text-align: center;
}
.deny-ico {
  display: block;
  font-size: 64rpx;
}
.deny-title {
  display: block;
  margin-top: 20rpx;
  font-size: 32rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.deny-desc {
  display: block;
  margin-top: 14rpx;
  font-size: 25rpx;
  line-height: 1.7;
  color: var(--tf-text-3);
}
</style>