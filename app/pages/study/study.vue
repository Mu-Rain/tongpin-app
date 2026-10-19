<template>
  <view class="page">
    <!-- 顶部统计 -->
    <view class="stats">
      <view class="stat">
        <text class="stat-num">{{ stats.today.count }}</text>
        <text class="stat-label">今天番茄</text>
      </view>
      <view class="stat">
        <text class="stat-num">{{ stats.today.minutes }}</text>
        <text class="stat-label">今天分钟</text>
      </view>
      <view class="stat">
        <text class="stat-num">{{ stats.streak }}</text>
        <text class="stat-label">连续天数</text>
      </view>
    </view>

    <!-- 计时主体 -->
    <view class="timer-card">
      <view class="ring">
        <text class="ring-num">{{ clockText }}</text>
        <text class="ring-sub">{{ phaseText }}</text>
      </view>

      <!-- 时长选择（未开始时才能改） -->
      <view v-if="!running" class="duration-row">
        <view
          v-for="m in durations"
          :key="m"
          class="dur"
          :class="{ 'dur--on': !customOn && minutes === m }"
          @tap="pickDuration(m)"
        >
          <text class="dur-text" :class="{ 'dur-text--on': !customOn && minutes === m }">{{ m }} 分</text>
        </view>
        <view class="dur" :class="{ 'dur--on': customOn }" @tap="toggleCustom">
          <text class="dur-text" :class="{ 'dur-text--on': customOn }">自定义</text>
        </view>
      </view>

      <!-- 自定义时长（1 - 180 分钟） -->
      <view v-if="!running && customOn" class="custom-row">
        <input
          class="custom-input"
          type="number"
          :value="customText"
          placeholder="1 - 180"
          @input="onCustomInput"
        />
        <text class="custom-unit">分钟</text>
        <text v-if="!customValid" class="custom-warn">填 1 - 180 的整数</text>
      </view>

      <view class="timer-btns">
        <view v-if="!running" class="tbtn tbtn--start" @tap="start">
          <text class="tbtn-text">开始专注</text>
        </view>
        <block v-else>
          <view class="tbtn tbtn--pause" @tap="togglePause">
            <text class="tbtn-text">{{ paused ? '继续' : '暂停' }}</text>
          </view>
          <view class="tbtn tbtn--giveup" @tap="giveUp">
            <text class="tbtn-text tbtn-text--dark">放弃</text>
          </view>
        </block>
      </view>
    </view>

    <!-- 本周柱状 -->
    <view class="section-head">
      <text class="section-title">这周</text>
      <text class="section-note">累计 {{ stats.total.minutes }} 分钟 · 完成率 {{ stats.completed_rate }}%</text>
    </view>
    <view class="week">
      <view v-for="(d, di) in stats.week" :key="di" class="week-col">
        <view class="bar-wrap">
          <view
            class="bar"
            :class="{ 'bar--today': d.is_today }"
            :style="{ height: barHeight(d.minutes) }"
          ></view>
        </view>
        <text class="week-label" :class="{ 'week-label--today': d.is_today }">{{ d.label }}</text>
        <text class="week-min">{{ d.minutes || '' }}</text>
      </view>
    </view>

    <view class="tip">
      <text class="tip-text">
        支持自定义时长（1 - 180 分钟）。计时按「开始时刻 + 累计时长」推算，
        离开页面或退出 App 都照常走，不依赖页面里的定时器自减。
        中途放弃也会记一条（完成率会下降），以后加时长分布、学科分类不用改表。
      </text>
    </view>
  </view>
</template>

<script>
import {
  readSession,
  writeSession,
  clearSession,
  newSession,
  remainSecOf,
  elapsedMsOf,
  pauseSession,
  resumeSession,
  finishAtOf,
  settleIfDue
} from '@/common/pomodoro/session.js'

const DURATIONS = [15, 25, 45, 60]
const MIN_MINUTES = 1
const MAX_MINUTES = 180

export default {
  data() {
    return {
      durations: DURATIONS,
      minutes: 25,
      customOn: false,
      customText: '',
      remainSec: 25 * 60,
      running: false,
      paused: false,
      session: null,
      timer: null,
      settling: false,
      stats: {
        today: { count: 0, minutes: 0 },
        week: [],
        total: { count: 0, minutes: 0, completed: 0 },
        completed_rate: 0,
        streak: 0
      }
    }
  },
  computed: {
    clockText() {
      const s = Math.max(0, this.remainSec)
      const m = Math.floor(s / 60)
      const r = s % 60
      return ('0' + m).slice(-2) + ':' + ('0' + r).slice(-2)
    },
    phaseText() {
      if (!this.running) return '准备好就开始'
      return this.paused ? '已暂停' : '专注中…'
    },
    customValid() {
      return this.customMinutes() > 0
    }
  },
  onShow() {
    // 回到页面先按墙上时钟重算剩余时间：切走期间计时并没有停
    this.syncSession()
    this.loadStats()
  },
  onHide() {
    // 只停「刷新显示」的定时器，不停真实计时。
    // 真实进度存在本地存储里、按时间戳算，页面可见与否都不影响它。
    this.stopTicker()
  },
  onUnload() {
    this.stopTicker()
  },
  methods: {
    async call(name, data) {
      const token = uni.getStorageSync('token') || ''
      const r = await uniCloud.callFunction({
        name: name,
        data: Object.assign({ token: token }, data || {})
      })
      const res = r.result || {}
      if (res.code !== 0) throw new Error(res.msg || '请求失败')
      return res.data || {}
    },

    async loadStats() {
      try {
        const d = await this.call('study-pomodoro', { action: 'stats' })
        this.stats = {
          today: d.today || { count: 0, minutes: 0 },
          week: d.week || [],
          total: d.total || { count: 0, minutes: 0, completed: 0 },
          completed_rate: d.completed_rate || 0,
          streak: d.streak || 0
        }
      } catch (e) {
        console.warn('[study] 统计加载失败', e.message)
      }
    },

    barHeight(min) {
      const m = Number(min) || 0
      if (!m) return '6rpx'
      // 最大按 120 分钟算满高，超过封顶
      const pct = Math.min(100, Math.round((m / 120) * 100))
      return Math.max(12, pct * 2.2) + 'rpx'
    },

    // 自定义输入解析成分钟数；非法返回 0
    customMinutes() {
      const n = parseInt(this.customText, 10)
      if (isNaN(n) || n < MIN_MINUTES || n > MAX_MINUTES) return 0
      return n
    },

    pickDuration(m) {
      if (this.running) return
      this.customOn = false
      this.minutes = m
      this.remainSec = m * 60
    },

    toggleCustom() {
      if (this.running) return
      this.customOn = !this.customOn
      if (this.customOn) this.customText = String(this.minutes)
      const m = this.customOn ? this.customMinutes() : this.minutes
      if (m) this.remainSec = m * 60
    },

    onCustomInput(e) {
      this.customText = ((e && e.detail ? e.detail.value : '') + '')
      const m = this.customMinutes()
      // 非法输入（0 / 181 / 空）也要让圆环跟着归零，
      // 否则输入框是空的、圆环还显示上一个合法时长，自相矛盾
      this.remainSec = m ? m * 60 : 0
    },

    startTicker() {
      this.stopTicker()
      const self = this
      this.timer = setInterval(function () {
        self.tick()
      }, 1000)
    },

    stopTicker() {
      if (this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    },

    // 把本地存储里的会话同步到界面；没有会话＝还没开始
    syncSession() {
      // 到点判断下沉到 session.js：App.vue 的后台兜底结算用的是同一个判断。
      // 这里沿用 settleIfDue 返回的那一份对象，让 finishSession 里的
      // 「this.session === s」身份判断成立（两次 readSession 会是两个对象）。
      const due = settleIfDue()
      const s = due ? due.session : readSession()
      this.session = s
      if (!s) {
        this.running = false
        this.paused = false
        this.remainSec = this.minutes * 60
        this.stopTicker()
        return
      }
      this.minutes = s.minutes
      this.paused = !!s.paused
      this.running = true
      this.remainSec = remainSecOf(s)
      if (due) {
        // 离开期间已经到点了：补记这一笔，别让它悄悄消失
        this.finishSession(s)
        return
      }
      // 暂停中不必每秒空转
      if (s.paused) this.stopTicker()
      else this.startTicker()
    },

    tick() {
      const s = this.session
      if (!s) return
      this.remainSec = remainSecOf(s)
      if (this.remainSec <= 0) this.finishSession(s)
    },

    start() {
      // 结算中不许开新的：见 finishSession 里「写库成功才清会话」的说明
      if (this.settling) return
      const m = this.customOn ? this.customMinutes() : this.minutes
      if (!m) {
        uni.showToast({ title: '先填 1 - 180 之间的分钟数', icon: 'none' })
        return
      }
      const s = newSession(m)
      writeSession(s)
      this.session = s
      this.minutes = m
      this.running = true
      this.paused = false
      this.remainSec = s.totalSec
      this.startTicker()
    },

    togglePause() {
      const s = this.session
      if (!s || this.settling) return
      if (s.paused) resumeSession(s)
      else pauseSession(s)
      writeSession(s)
      this.paused = !!s.paused
      this.remainSec = remainSecOf(s)
    },

    // 到点结算。留在页面跑完、或切走回来后发现已跑完，都走这里
    // D3：先写库，成功后才 clearSession。写失败时会话还留在存储里，
    //     用户能当场重试，不会「看到🍅但库里没记录」。
    async finishSession(s) {
      if (this.settling) return
      this.settling = true
      this.stopTicker()
      const minutes = s.minutes
      const doneAt = finishAtOf(s)
      // 结算期间保持 running：不能让界面露出「开始专注」，
      // 否则用户在写库的几秒里点了开始，新会话会被随后的 clearSession 抹掉。
      this.paused = false
      this.remainSec = 0
      try {
        await this.save(true, minutes, s.startedAt, doneAt)
      } catch (e) {
        // 会话故意不清、running 也保持：这是「已到点、待补记」状态，
        // 下次进页面 onShow 会自动再结算一次，这里也给一次手动重试的机会。
        this.settling = false
        uni.showModal({
          title: '记录没存上',
          content: (e.message || '网络不给力') + '，点「重试」再存一次',
          confirmText: '重试',
          cancelText: '稍后',
          success: (r) => {
            if (r.confirm) this.finishSession(s)
          }
        })
        return
      }
      // 写库成功：清会话，保证这条番茄不会再被任何入口结算第二次
      clearSession()
      if (this.session === s) this.session = null
      this.settling = false
      this.running = false
      this.remainSec = minutes * 60
      uni.vibrateLong && uni.vibrateLong()
      uni.showModal({
        title: '🍅 完成一个番茄',
        content: '专注了 ' + minutes + ' 分钟，休息一下吧',
        showCancel: false
      })
      this.loadStats()
    },

    giveUp() {
      const self = this
      const s = self.session
      if (!s || self.settling) return
      // 已经到点的会话不算「放弃」，走正常结算，别把跑完的番茄记成未完成
      if (remainSecOf(s) <= 0) {
        self.finishSession(s)
        return
      }
      // D2：先停表，再弹确认框。弹窗期间 ticker 还在跑的话，这一秒正好归零，
      //     tick 会先 finishSession 记一条 completed=true，
      //     用户点「确认」后又用捕获的 s 记一条 completed=false —— 一次专注两条记录。
      self.stopTicker()
      uni.showModal({
        title: '放弃这次专注？',
        content: '会记一条未完成记录，完成率会下降',
        success: async function (r) {
          // 守卫：弹窗打开期间会话可能已被结算或被换掉，此时绝不能再写
          if (self.session !== s) return
          if (!r.confirm) {
            // 用户取消：把表重新起回来，否则计时被意外冻住
            if (!self.paused) self.startTicker()
            return
          }
          const used = Math.floor(elapsedMsOf(s) / 1000)
          // 放弃是本地决定：先回到空闲态（会话必须清掉，否则回页面这个番茄会「复活」）
          clearSession()
          self.session = null
          self.running = false
          self.paused = false
          self.remainSec = s.minutes * 60
          if (used < 60) return
          // 不满 1 分钟的不记，避免误触产生垃圾数据
          try {
            // 分钟数一律记「设定时长」，不再传实际用时
            await self.save(false, s.minutes, s.startedAt, Date.now())
            self.loadStats()
          } catch (e) {
            uni.showToast({ title: '未完成记录没存上', icon: 'none' })
          }
        },
        fail: function () {
          // 弹窗本身失败（极少见）：不要留下一个被冻住的计时
          if (!self.paused) self.startTicker()
        }
      })
    },

    // 写一条番茄记录。失败向上抛：调用方要能区分「写成功了」和「没写成功」（D3）
    async save(completed, minutes, startedAt, finishedAt) {
      await this.call('study-pomodoro', {
        action: 'record',
        minutes: minutes,
        completed: completed,
        started_at: startedAt || (Date.now() - minutes * 60000),
        finished_at: finishedAt || Date.now()
      })
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

/* ---- 统计 ---- */
.stats {
  display: flex;
  flex-direction: row;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  padding: 30rpx 0;
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
  font-size: 48rpx;
  font-weight: 800;
  color: var(--tf-primary);
  line-height: 1.1;
}

.stat-label {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

/* ---- 计时卡 ---- */
.timer-card {
  background-color: var(--tf-card);
  border-radius: 32rpx;
  padding: 48rpx 32rpx 36rpx;
  margin-bottom: 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32rpx;
}

.ring {
  width: 380rpx;
  height: 380rpx;
  border-radius: 50%;
  border: 10rpx solid var(--tf-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
}

.ring-num {
  font-size: 92rpx;
  font-weight: 800;
  color: var(--tf-text);
  letter-spacing: 2rpx;
  line-height: 1;
}

.ring-sub {
  font-size: 23rpx;
  color: var(--tf-text-3);
}

.duration-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14rpx;
}

.dur {
  padding: 12rpx 22rpx;
  border-radius: 16rpx;
  background-color: var(--tf-bg);
}

.dur--on {
  background-color: var(--tf-primary);
}

.dur-text {
  font-size: 25rpx;
  color: var(--tf-text-2);
}

.dur--on .dur-text,
.dur-text--on {
  color: #ffffff;
  font-weight: 700;
}

.custom-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 14rpx;
  width: 100%;
}

.custom-input {
  flex: 1;
  height: 76rpx;
  padding: 0 24rpx;
  border-radius: 16rpx;
  background-color: var(--tf-bg);
  font-size: 30rpx;
  color: var(--tf-text);
  text-align: center;
}

.custom-unit {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.custom-warn {
  font-size: 22rpx;
  color: var(--tf-primary);
}

.timer-btns {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
  width: 100%;
}

.tbtn {
  flex: 1;
  height: 96rpx;
  border-radius: 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tbtn--start {
  background-color: var(--tf-primary);
}

.tbtn--pause {
  background-color: var(--tf-primary);
}

.tbtn--giveup {
  background-color: var(--tf-bg);
  flex: 0.6;
}

.tbtn-text {
  font-size: 30rpx;
  font-weight: 700;
  color: #ffffff;
}

.tbtn-text--dark {
  color: var(--tf-text-2);
}

/* ---- 本周 ---- */
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
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.week {
  display: flex;
  flex-direction: row;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  padding: 28rpx 16rpx 20rpx;
  margin-bottom: 28rpx;
}

.week-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
}

.bar-wrap {
  height: 230rpx;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
}

.bar {
  width: 34rpx;
  background-color: #E6E8EB;
  border-radius: 10rpx;
}

.bar--today {
  background-color: var(--tf-primary);
}

.week-label {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.week-label--today {
  color: var(--tf-primary);
  font-weight: 700;
}

.week-min {
  font-size: 18rpx;
  color: var(--tf-text-3);
  height: 24rpx;
}

/* ---- 说明 ---- */
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
