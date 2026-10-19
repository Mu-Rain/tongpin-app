<template>
  <view class="page">
    <!-- 顶部数据条：本周 / 连续 / 本月 -->
    <view class="stats">
      <view class="stat">
        <text class="stat-num">{{ stats.week_count }}</text>
        <text class="stat-label">本周训练</text>
      </view>
      <view class="stat">
        <text class="stat-num">{{ stats.streak }}</text>
        <text class="stat-label">连续天数</text>
      </view>
      <view class="stat">
        <text class="stat-num">{{ stats.month_count }}</text>
        <text class="stat-label">本月打卡</text>
      </view>
    </view>

    <!-- 训练进行中：把它顶到最上面，一键继续 -->
    <view v-if="stats.active_session" class="ongoing" @tap="resumeSession">
      <view class="ongoing-main">
        <text class="ongoing-title">有一次训练还没结束</text>
        <text class="ongoing-desc">
          {{ stats.active_session.plan_name || '自由训练' }} · 开始于 {{ fmtTime(stats.active_session.started_at) }}
        </text>
      </view>
      <text class="ongoing-go">继续 ›</text>
    </view>

    <!-- 两个入口 -->
    <view class="entries">
      <view class="entry" @tap="goExercise">
        <text class="entry-ico">🏋️</text>
        <view class="entry-main">
          <text class="entry-title">动作库</text>
          <text class="entry-desc">按肌群和器械找动作</text>
        </view>
        <text class="entry-arrow">›</text>
      </view>
      <view class="entry" @tap="startFree">
        <text class="entry-ico">▶️</text>
        <view class="entry-main">
          <text class="entry-title">自由训练</text>
          <text class="entry-desc">今天想练什么就练什么</text>
        </view>
        <text class="entry-arrow">›</text>
      </view>
    </view>

    <!-- 训练记录入口（第 4 行小条，别抢上面的视觉） -->
    <view class="link-row" @tap="goHistory">
      <text class="link-text">📓 训练记录</text>
      <text class="link-arrow">查看历史 ›</text>
    </view>

    <!-- 计划列表 -->
    <view class="section-head">
      <text class="section-title">今天练什么</text>
      <text class="section-note">{{ plans.length }} 套官方计划</text>
    </view>

    <view v-if="loading" class="loading">
      <text class="loading-text">正在加载计划…</text>
    </view>

    <view v-else-if="!plans.length" class="empty">
      <text class="empty-ico">📋</text>
      <text class="empty-title">还没有计划</text>
      <text class="empty-desc">动作库和官方计划需要先灌一次数据，见验收清单第 1 步</text>
    </view>

    <view v-else class="plan-list">
      <view
        v-for="p in plans"
        :key="p._id"
        class="plan"
        @tap="openPlan(p)"
      >
        <view class="plan-cover" :style="{ backgroundColor: p.cover_color || '#FF6B4A' }">
          <text class="plan-cover-text">{{ goalName(p.goal) }}</text>
        </view>
        <view class="plan-main">
          <text class="plan-name">{{ p.name }}</text>
          <text class="plan-meta">
            每周 {{ p.days_per_week }} 练 · {{ p.day_count }} 个训练日 · {{ p.item_count }} 个动作
          </text>
          <text class="plan-desc">{{ p.desc }}</text>
          <view class="plan-tags">
            <text v-for="(t, ti) in (p.tags || [])" :key="ti" class="plan-tag">{{ t }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 打卡日历 -->
    <view class="section-head">
      <text class="section-title">{{ monthLabel }}</text>
      <text class="section-note">练过的日子会亮</text>
    </view>
    <view class="calendar">
      <view class="cal-week">
        <text v-for="(w, wi) in weekLabels" :key="wi" class="cal-week-text">{{ w }}</text>
      </view>
      <view class="cal-grid">
        <view
          v-for="(d, di) in calendarDays"
          :key="di"
          class="cal-cell"
          :class="{ 'cal-cell--blank': !d.day, 'cal-cell--done': d.done, 'cal-cell--today': d.today }"
        >
          <text class="cal-num">{{ d.day || '' }}</text>
        </view>
      </view>
    </view>

    <view class="tip">
      <text class="tip-text">
        这一期只做轻量界面：动作库、计划、组级训练记录、打卡日历。
        容量曲线、PR 记录、部位分布这些数据已经在库里，以后加页面就能看。
      </text>
    </view>
  </view>
</template>

<script>
import {
  goalName,
  dayKey,
  fmtDuration
} from '@/common/fitness/labels.js'

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export default {
  data() {
    return {
      loading: true,
      plans: [],
      stats: {
        week_count: 0,
        streak: 0,
        month_count: 0,
        month_days: [],
          active_session: null
      },
      weekLabels: WEEK_LABELS,
      calendarDays: [],
      monthLabel: ''
    }
  },
  onShow() {
    // 每次回到这页都刷一次：练完回来数字要变
    this.loadAll()
  },
  onPullDownRefresh() {
    this.loadAll().then(() => uni.stopPullDownRefresh())
  },
  methods: {
    goalName,
    fmtDuration,

    fmtTime(ts) {
      const d = new Date(ts)
      const h = ('0' + d.getHours()).slice(-2)
      const m = ('0' + d.getMinutes()).slice(-2)
      return h + ':' + m
    },

    async call(name, data) {
      const token = uni.getStorageSync('token') || ''
      const r = await uniCloud.callFunction({
        name: name,
        data: Object.assign({ token: token }, data || {})
      })
      const res = r.result || {}
      // 云函数只在网络层失败才 reject，业务错误是正常返回，必须自己判
      if (res.code !== 0) {
        throw new Error(res.msg || '请求失败')
      }
      return res.data || {}
    },

    /**
     * 一个请求失败只影响自己：包成 { ok, data, err }，不往外抛。
     * 首页两个请求的对错不该互相牵连（见 loadAll 的注释）。
     */
    settle(promise) {
      return promise.then(
        function (d) { return { ok: true, data: d || {} } },
        function (e) { return { ok: false, err: e || {} } }
      )
    },

    async loadAll() {
      this.loading = true
      // 计划与统计必须各自兜住异常：
      // fit-session 的 stats 需要登录，token 一过期就整条 reject；
      // 而 fit-plan 不需要登录。合并成一个 try 会让「拿不到统计」顺带把 5 套计划也清空。
      // 用 settle 包而不是两个 await 串起来，是为了仍然并发发出这两个请求。
      const [planRes, statRes] = await Promise.all([
        this.settle(this.call('fit-plan', { action: 'list' })),
        this.settle(this.call('fit-session', { action: 'stats' }))
      ])
      let errMsg = ''
      if (planRes.ok) {
        this.plans = planRes.data.list || []
      } else {
        console.warn('[fitness] 计划加载失败', planRes.err.message)
        errMsg = planRes.err.message || '计划加载失败'
      }
      if (statRes.ok) {
        this.stats = Object.assign(this.stats, statRes.data)
      } else {
        // 统计失败：保留 data() 里的默认数字（0），只提示一次，计划照常显示
        console.warn('[fitness] 统计加载失败', statRes.err.message)
        if (!errMsg) errMsg = statRes.err.message || '统计加载失败'
      }
      this.buildCalendar()
      this.loading = false
      if (errMsg) uni.showToast({ title: errMsg, icon: 'none' })
    },

    /**
     * 生成当月日历格子
     * 周一为每周第一天（和训练习惯一致），月初前面补空格
     */
    buildCalendar() {
      const now = new Date()
      const y = now.getFullYear()
      const m = now.getMonth()
      this.monthLabel = y + ' 年 ' + (m + 1) + ' 月'

      const doneMap = {}
      for (const d of (this.stats.month_days || [])) doneMap[d] = true
      const todayK = dayKey(now.getTime())

      const first = new Date(y, m, 1)
      // getDay(): 0=周日。转成「周一=0」
      const lead = (first.getDay() + 6) % 7
      const daysInMonth = new Date(y, m + 1, 0).getDate()

      const cells = []
      for (let i = 0; i < lead; i++) cells.push({ day: 0, done: false, today: false })
      for (let d = 1; d <= daysInMonth; d++) {
        const k = y + '-' + ('0' + (m + 1)).slice(-2) + '-' + ('0' + d).slice(-2)
        cells.push({ day: d, done: !!doneMap[k], today: k === todayK })
      }
      this.calendarDays = cells
    },

    goExercise() {
      uni.navigateTo({ url: '/pages/exercise/exercise' })
    },

    goHistory() {
      uni.navigateTo({ url: '/pages/history/history' })
    },

    /**
     * D6：进计划要带「今天该练第几天」，否则推拉腿三分化永远打开推日、
     * 上下肢二分化永远打开上肢，「今天练什么」就名不副实。
     * 规则：按这套计划上次完成的训练日 +1，到末尾回第 1 天。
     */
    async openPlan(p) {
      const dayCount = Math.max(1, Number(p.day_count) || 1)
      let dayIndex = 1
      try {
        const d = await this.call('fit-session', { action: 'planProgress', plan_id: p._id })
        const last = Number(d.last_day_index) || 0
        dayIndex = last > 0 ? last + 1 : 1
        // 边界保护：day_count 算出来的位置不允许越界
        if (dayIndex < 1 || dayIndex > dayCount) dayIndex = 1
      } catch (e) {
        // 取不到进度不该挡住进训练页，退回第 1 天
        console.warn('[fitness] 取计划进度失败，按第 1 天进', e.message)
        dayIndex = 1
      }
      uni.navigateTo({
        url: '/pages/workout/workout?plan_id=' + p._id +
          '&plan_name=' + encodeURIComponent(p.name) +
          '&day_index=' + dayIndex
      })
    },

    resumeSession() {
      const s = this.stats.active_session
      if (!s) return
      uni.navigateTo({
        url: '/pages/workout/workout?session_id=' + s._id +
          '&plan_id=' + (s.plan_id || '') +
          '&plan_name=' + encodeURIComponent(s.plan_name || '') +
          // 带上库里的训练日，cloud start 才不会因为「训练日对不上」回 409
          '&day_index=' + (Number(s.plan_day_index) || 1)
      })
    },

    async startFree() {
      // 不再在这里偷偷续上一次训练：
      // 那样点「自由训练」会被静默带进某个计划，用户根本没得选。
      // 现在一律进自由训练，云函数 start 发现已有未结束的**别的**训练时会回 409，
      // 由训练页统一弹「继续上次 / 结束旧的」——和点计划进来完全同一条路。
      uni.navigateTo({ url: '/pages/workout/workout?free=1' })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 24rpx 32rpx 60rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
}

/* ---- 顶部统计 ---- */
.stats {
  display: flex;
  flex-direction: row;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  padding: 32rpx 0;
  margin-bottom: 24rpx;
}

.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.stat-num {
  font-size: 52rpx;
  font-weight: 800;
  color: var(--tf-primary);
  line-height: 1.1;
}

.stat-label {
  font-size: 23rpx;
  color: var(--tf-text-3);
}

/* ---- 进行中的训练 ---- */
.ongoing {
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: #FFF1ED;
  border: 2rpx solid var(--tf-primary);
  border-radius: 24rpx;
  padding: 26rpx 28rpx;
  margin-bottom: 24rpx;
}

.ongoing-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.ongoing-title {
  font-size: 29rpx;
  font-weight: 700;
  color: var(--tf-primary);
}

.ongoing-desc {
  font-size: 23rpx;
  color: var(--tf-text-2);
}

.ongoing-go {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--tf-primary);
}

/* ---- 入口 ---- */
.entries {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
  margin-bottom: 36rpx;
}

.entry {
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: var(--tf-card);
  border-radius: 24rpx;
  padding: 28rpx 22rpx;
  gap: 16rpx;
}

.entry-ico {
  font-size: 40rpx;
}

.entry-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.entry-title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.entry-desc {
  font-size: 21rpx;
  color: var(--tf-text-3);
  line-height: 1.4;
}

.entry-arrow {
  font-size: 32rpx;
  color: var(--tf-text-3);
}

/* ---- 训练记录入口 ---- */
.link-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background-color: var(--tf-card);
  border-radius: 20rpx;
  padding: 24rpx 28rpx;
  margin-bottom: 36rpx;
}

.link-text {
  font-size: 26rpx;
  color: var(--tf-text);
  font-weight: 600;
}

.link-arrow {
  font-size: 23rpx;
  color: var(--tf-text-3);
}

/* ---- 区块标题 ---- */
.section-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.section-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.section-note {
  font-size: 23rpx;
  color: var(--tf-text-3);
}

/* ---- 计划卡片 ---- */
.plan-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.plan {
  display: flex;
  flex-direction: row;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  overflow: hidden;
}

.plan-cover {
  width: 130rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.plan-cover-text {
  font-size: 30rpx;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: 2rpx;
}

.plan-main {
  flex: 1;
  padding: 26rpx 24rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.plan-name {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.plan-meta {
  font-size: 22rpx;
  color: var(--tf-primary);
}

.plan-desc {
  font-size: 23rpx;
  color: var(--tf-text-2);
  line-height: 1.6;
}

.plan-tags {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10rpx;
}

.plan-tag {
  font-size: 20rpx;
  color: var(--tf-text-2);
  background-color: var(--tf-bg);
  border-radius: 8rpx;
  padding: 4rpx 12rpx;
}

/* ---- 状态 ---- */
.loading,
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60rpx 24rpx;
  gap: 14rpx;
  background-color: var(--tf-card);
  border-radius: 28rpx;
}

.loading-text,
.empty-desc {
  font-size: 24rpx;
  color: var(--tf-text-3);
  text-align: center;
  line-height: 1.6;
}

.empty-ico {
  font-size: 80rpx;
  opacity: 0.35;
}

.empty-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}

/* ---- 日历 ---- */
.calendar {
  background-color: var(--tf-card);
  border-radius: 28rpx;
  padding: 24rpx 18rpx;
  margin-bottom: 28rpx;
}

.cal-week {
  display: flex;
  flex-direction: row;
  margin-bottom: 12rpx;
}

.cal-week-text {
  flex: 1;
  text-align: center;
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.cal-grid {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.cal-cell {
  width: 14.285%;
  height: 72rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cal-num {
  font-size: 24rpx;
  color: var(--tf-text-2);
  width: 52rpx;
  height: 52rpx;
  line-height: 52rpx;
  text-align: center;
  border-radius: 26rpx;
}

.cal-cell--done .cal-num {
  background-color: var(--tf-primary);
  color: #ffffff;
  font-weight: 700;
}

.cal-cell--today .cal-num {
  border: 2rpx solid var(--tf-primary);
  box-sizing: border-box;
}

.cal-cell--blank .cal-num {
  color: transparent;
}

/* ---- 底部说明 ---- */
.tip {
  padding: 24rpx;
  background-color: var(--tf-card);
  border-radius: 20rpx;
}

.tip-text {
  font-size: 22rpx;
  color: var(--tf-text-3);
  line-height: 1.7;
}
</style>
