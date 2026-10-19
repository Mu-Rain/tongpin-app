<template>
  <view class="page">
    <view class="page-head">
      <text class="page-title">{{ planName || '自由训练' }}</text>
      <text class="page-sub">{{ headerSub }}</text>
    </view>

    <!-- 加载 / 失败 -->
    <view v-if="loading" class="state">
      <text class="state-text">正在准备训练…</text>
    </view>

    <block v-else>
      <!-- 进行中的提示条 -->
      <view class="bar">
        <view class="bar-item">
          <text class="bar-num">{{ sets.length }}</text>
          <text class="bar-label">已完成组数</text>
        </view>
        <view class="bar-item">
          <text class="bar-num">{{ volumeText }}</text>
          <text class="bar-label">总容量 kg</text>
        </view>
        <view class="bar-item">
          <text class="bar-num">{{ elapsedText }}</text>
          <text class="bar-label">已用时</text>
        </view>
      </view>

      <!-- 训练日选择（只有带计划、且计划有多个训练日时出现） -->
      <view v-if="planDays.length > 1" class="day-picker">
        <scroll-view scroll-x :show-scrollbar="false">
          <view class="day-row">
            <view
              v-for="d in planDays"
              :key="d.day_index"
              class="day-chip"
              :class="{ 'day-chip--on': dayIndex === d.day_index }"
              @tap="pickDay(d)"
            >
              <text class="day-text" :class="{ 'day-text--on': dayIndex === d.day_index }">
                {{ d.day_name }}
              </text>
            </view>
          </view>
        </scroll-view>
      </view>

      <!-- 今天要练的动作 -->
      <view class="section-head">
        <text class="section-title">今天的动作</text>
        <text class="section-add" @tap="openPicker">＋ 加动作</text>
      </view>

      <view v-if="!blocks.length" class="state state--in">
        <text class="state-ico">💪</text>
        <text class="state-title">今天还没选动作</text>
        <text class="state-text">点右上角「加动作」选一个开始练</text>
      </view>

      <view v-for="(b, bi) in blocks" :key="b.exercise_id" class="block">
        <view class="block-head">
          <view class="block-main">
            <text class="block-name">{{ b.exercise_name }}</text>
            <text class="block-plan">计划 {{ b.sets }} 组{{ b.reps ? ' × ' + b.reps : '' }} · 休息 {{ b.rest }} 秒</text>
          </view>
          <text class="block-del" @tap="removeBlock(bi)">移除</text>
        </view>

        <!-- 已记录的各组 -->
        <view v-if="b.logged.length" class="logged">
          <view v-for="(s, si) in b.logged" :key="s._id" class="set-row">
            <text class="set-idx">{{ si + 1 }}</text>
            <text class="set-val">{{ s.weight }} kg × {{ s.reps }}</text>
            <text v-if="s.is_warmup" class="set-badge set-badge--warm">热身</text>
            <text v-if="s.is_pr" class="set-badge set-badge--pr">新纪录</text>
            <text class="set-del" @tap="removeSet(b, s)">✕</text>
          </view>
        </view>

        <!-- 记一组：重量 / 次数 / 完成 -->
        <view class="set-form">
          <view class="input-box">
            <input
              class="set-input"
              type="digit"
              v-model="b.inputWeight"
              placeholder="0"
              @focus="onFocus(b, 'weight')"
            />
            <text class="input-unit">kg</text>
          </view>
          <text class="set-times">×</text>
          <view class="input-box">
            <input
              class="set-input"
              type="number"
              v-model="b.inputReps"
              placeholder="0"
              @focus="onFocus(b, 'reps')"
            />
            <text class="input-unit">次</text>
          </view>
          <view class="set-done" @tap="addSet(b)">
            <text class="set-done-text">记一组</text>
          </view>
        </view>

        <!-- 快速调整：上次的重量，点一下就填进去 -->
        <view v-if="b.last_weight > 0" class="last-hint">
          <text class="last-text">上次 {{ b.last_weight }}kg × {{ b.last_reps }}</text>
          <text class="last-fill" @tap="fillLast(b)">用上次的</text>
        </view>
      </view>

      <!-- 底部结算 -->
      <view class="finish">
        <view class="finish-btn" @tap="finish(0)">
          <text class="finish-text">结束训练</text>
          <text class="finish-sub">保存这次记录</text>
        </view>
      </view>
    </block>

    <!-- 选动作弹层 -->
    <view v-if="pickerOpen" class="mask" @tap="closePicker">
      <view class="sheet" @tap.stop>
        <view class="sheet-head">
          <text class="sheet-title">加一个动作</text>
          <text class="sheet-close" @tap="closePicker">✕</text>
        </view>
        <view class="sheet-search">
          <input
            class="sheet-input"
            v-model="pickerKeyword"
            placeholder="搜动作名"
            @input="searchPicker"
          />
        </view>
        <scroll-view class="sheet-list" scroll-y>
          <view
            v-for="ex in pickerList"
            :key="ex._id"
            class="sheet-item"
            @tap="addBlock(ex)"
          >
            <text class="sheet-item-name">{{ ex.name }}</text>
            <text class="sheet-item-meta">{{ muscleName(ex.muscle) }} · {{ ex.default_sets }}×{{ ex.default_reps }}</text>
          </view>
          <view v-if="!pickerList.length" class="sheet-empty">
            <text class="sheet-empty-text">没有找到动作</text>
          </view>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<script>
import { muscleName, fmtDuration, dayKey } from '@/common/fitness/labels.js'

export default {
  data() {
    return {
      loading: true,
      sessionId: '',
      planId: '',
      planName: '',
      planDays: [],
      dayIndex: 1,
      // URL 里带的训练日；0 = 没带（交给库里的 plan_day_index 决定）
      urlDayIndex: 0,
      blocks: [],
      sets: [],
      startedAt: 0,
      nowTick: Date.now(),
      timer: null,
      pickerOpen: false,
      pickerKeyword: '',
      pickerList: [],
      searchTimer: null
    }
  },
  computed: {
    headerSub() {
      if (this.planName) return '按计划练，记完一组点「记一组」'
      return '自由训练：想练什么加什么'
    },
    volumeText() {
      let v = 0
      for (const s of this.sets) {
        if (s.is_warmup) continue
        v += (Number(s.weight) || 0) * (Number(s.reps) || 0)
      }
      return Math.round(v)
    },
    elapsedText() {
      if (!this.startedAt) return '0 秒'
      const sec = Math.max(0, Math.round((this.nowTick - this.startedAt) / 1000))
      const m = Math.floor(sec / 60)
      if (m < 60) return m + ' 分'
      return Math.floor(m / 60) + ' 时 ' + (m % 60) + ' 分'
    }
  },
  onLoad(options) {
    const o = options || {}
    this.planId = o.plan_id || ''
    this.planName = o.plan_name ? decodeURIComponent(o.plan_name) : ''
    this.sessionId = o.session_id || ''
    // 0 = URL 没指定训练日（例如从「继续上次训练」进来），交给库里的 plan_day_index
    this.urlDayIndex = Number(o.day_index) || 0
    this.dayIndex = this.urlDayIndex || 1
    this._pendingExercise = o.exercise_id
      ? {
          _id: o.exercise_id,
          name: decodeURIComponent(o.exercise_name || ''),
          // 动作库直接带了建议组次就用它，没带就进页面后查一次 fit-exercise detail（D7）
          default_sets: Number(o.default_sets) || 0,
          default_reps: o.default_reps || '',
          default_rest: Number(o.default_rest) || 0
        }
      : null
    this.init()
  },
  onShow() {
    // 从动作库回来可能带了新动作
    if (this.sessionId && this._pendingExercise) {
      this.loadPendingExercise()
    }
  },
  onUnload() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },
  methods: {
    muscleName,
    fmtDuration,
    dayKey,

    async call(name, data) {
      const token = uni.getStorageSync('token') || ''
      const r = await uniCloud.callFunction({
        name: name,
        data: Object.assign({ token: token }, data || {})
      })
      const res = r.result || {}
      if (res.code !== 0) {
        // 业务错误码和 data 一起挂到 error 上：init() 要靠 code 409 区分
        // 「计划对不上，继续上次 / 结束旧的再开新的」
        const err = new Error(res.msg || '请求失败')
        err.code = res.code
        err.data = res.data || {}
        throw err
      }
      return res.data || {}
    },

    async init() {
      this.loading = true
      try {
        // 1) 开始（或继续）这次训练
        const session = await this.startSession()
        await this.applySession(session)
      } catch (e) {
        console.warn('[workout] 初始化失败', e.message)
        uni.showModal({
          title: '打不开训练',
          content: e.message || '未知错误',
          showCancel: false,
          success: () => uni.navigateBack()
        })
      } finally {
        this.loading = false
      }
    },

    /**
     * 开一次训练。云函数在「已有一条未结束的训练、但计划/训练日对不上」时回 409，
     * 这里弹窗把选择权交给用户：继续上次那次，还是结束它再开这次要练的。
     */
    async startSession() {
      try {
        return await this.startRequest(this.planId, this.urlDayIndex)
      } catch (e) {
        if (e.code !== 409) throw e
        return await this.resolveOngoing(e.data)
      }
    },

    async startRequest(planId, dayIndex) {
      const d = await this.call('fit-session', {
        action: 'start',
        plan_id: planId || '',
        // 0 表示「没指定训练日」，云函数此时不校验训练日
        day_index: dayIndex || 0
      })
      return d.session || {}
    },

    /** 409：返回最终要用的 session（resolve）或抛出（reject） */
    resolveOngoing(data) {
      const ongoing = (data && data.ongoing) || {}
      return new Promise((resolve, reject) => {
        uni.showModal({
          title: '你有一次未结束的训练',
          content: (ongoing.plan_name || '自由训练') + ' · 第 ' + (Number(ongoing.plan_day_index) || 1) +
            ' 天，继续它还是结束它？',
          confirmText: '继续上次',
          cancelText: '结束旧的',
          success: async (r) => {
            try {
              if (r.confirm) {
                // 继续上次：计划和训练日都按库里那条来，否则又会 409
                this.planId = ongoing.plan_id || ''
                this.planName = ongoing.plan_name || ''
                this.dayIndex = Number(ongoing.plan_day_index) || 1
                this.urlDayIndex = this.dayIndex
                resolve(await this.startRequest(this.planId, this.dayIndex))
                return
              }
              // 结束旧的，再开这次的
              await this.call('fit-session', {
                action: 'finish',
                session_id: ongoing._id,
                note: '中途切换训练'
              })
              resolve(await this.startRequest(this.planId, this.urlDayIndex))
            } catch (e2) {
              reject(e2)
            }
          },
          fail: function () {
            reject(new Error('已取消'))
          }
        })
      })
    },

    async applySession(session) {
      this.sessionId = session._id || this.sessionId
      this.startedAt = Number(session.started_at) || Date.now()
      if (!this.planId && session.plan_id) this.planId = session.plan_id
      if (!this.planName && session.plan_name) this.planName = session.plan_name
      // D5：训练日以库里的 plan_day_index 为准（pickDay 会落库，重进页面不会退回旧值）
      this.dayIndex = Number(session.plan_day_index) || this.dayIndex

      // 2) 已有记录（可能是继续上次的训练）
      await this.loadSets()

      // 3) 计划训练日 → 自动填充今天的动作
      if (this.planId) {
        await this.loadPlan()
      }

      // 4) 动作库带过来的动作
      await this.loadPendingExercise()

      this.startTimer()
    },

    startTimer() {
      if (this.timer) return
      const self = this
      this.timer = setInterval(function () {
        self.nowTick = Date.now()
      }, 1000)
    },

    async loadPlan() {
      try {
        const d = await this.call('fit-plan', { action: 'detail', plan_id: this.planId })
        this.planDays = d.days || []
        if (!this.planName && d.plan && d.plan.name) this.planName = d.plan.name
        const today = this.planDays.filter(function (x) {
          return Number(x.day_index) === Number(this.dayIndex)
        }, this)
        // 边界保护：URL 里的 day_index 超出这套计划的训练日数时，落到第 1 天，
        // 不允许拿一个不存在的训练日继续用
        const day = today.length ? today[0] : this.planDays[0]
        if (!day) return
        this.dayIndex = Number(day.day_index) || 1
        // 已经有记录的动作不重复加
        const existing = {}
        for (const b of this.blocks) existing[b.exercise_id] = true
        for (const it of (day.items || [])) {
          if (existing[it.exercise_id]) continue
          this.blocks.push(this.makeBlock({
            _id: it.exercise_id,
            name: it.exercise_name,
            sets: it.sets,
            reps: it.reps,
            rest: it.rest
          }))
        }
      } catch (e) {
        console.warn('[workout] 读计划失败', e.message)
      }
    },

    async loadSets() {
      if (!this.sessionId) return
      try {
        const d = await this.call('fit-session', { action: 'detail', session_id: this.sessionId })
        const groups = d.groups || []
        this.sets = []
        this.blocks = []
        for (const g of groups) {
          const b = this.makeBlock({
            _id: g.exercise_id,
            name: g.exercise_name,
            sets: Math.max(1, g.sets.length),
            reps: g.sets.length ? g.sets[g.sets.length - 1].reps : 8,
            rest: 90
          })
          b.logged = g.sets || []
          this.blocks.push(b)
          for (const s of b.logged) this.sets.push(s)
        }
        this.fillInputsFromHistory()
      } catch (e) {
        console.warn('[workout] 读记录失败', e.message)
      }
    },

    makeBlock(ex) {
      return {
        exercise_id: ex._id || ex.exercise_id,
        exercise_name: ex.name || ex.exercise_name || '',
        rest: Number(ex.rest) || 90,
        sets: Number(ex.sets) || 3,
        reps: String(ex.reps || '8'),
        logged: [],
        inputWeight: '',
        inputReps: String(ex.reps || '8').split('-')[0],
        last_weight: 0,
        last_reps: 0
      }
    },

    /**
     * 用历史记录做输入预填
     * 为什么要额外查：fit-session detail 只给这次训练的组，
     * 用户想「抄上次的重量」得知道上次练了多少。这里用最近一次
     * 同动作的记录做参考，避免每次从 0 开始填。
     */
    async fillInputsFromHistory() {
      // 这一期不额外发请求（会拖慢进入速度），
      // 先用手上已有的组当参考：本次上一组的重量就是下一组的默认值。
      for (const b of this.blocks) {
        const own = b.logged[b.logged.length - 1]
        if (own) {
          b.inputWeight = String(own.weight || '')
          b.inputReps = String(own.reps || b.inputReps)
          b.last_weight = Number(own.weight) || 0
          b.last_reps = Number(own.reps) || 0
        }
      }
    },

    fillLast(b) {
      if (!b.last_weight) return
      b.inputWeight = String(b.last_weight)
      b.inputReps = String(b.last_reps || b.inputReps)
    },

    onFocus(b, which) {
      // 空着就把建议值填上，省一次打字
      if (which === 'weight' && !b.inputWeight && b.last_weight) {
        b.inputWeight = String(b.last_weight)
      }
      if (which === 'reps' && !b.inputReps) {
        b.inputReps = String(b.reps || 8)
      }
    },

    async addSet(b) {
      const weight = Number(b.inputWeight) || 0
      const reps = parseInt(b.inputReps, 10) || 0
      if (reps <= 0) {
        uni.showToast({ title: '先填次数', icon: 'none' })
        return
      }
      if (!this.sessionId) {
        uni.showToast({ title: '训练还没准备好，稍等', icon: 'none' })
        return
      }
      try {
        const d = await this.call('fit-session', {
          action: 'addSet',
          session_id: this.sessionId,
          exercise_id: b.exercise_id,
          weight: weight,
          reps: reps,
          rest_sec: b.rest
        })
        const set = d.set
        b.logged.push({
          _id: set._id,
          set_index: set.set_index,
          weight: set.weight,
          reps: set.reps,
          is_warmup: !!set.is_warmup,
          is_pr: !!set.is_pr
        })
        this.sets.push(b.logged[b.logged.length - 1])
        b.inputWeight = String(weight)
        b.last_weight = weight
        b.last_reps = reps
        if (d.is_pr) {
          uni.showToast({ title: '🏆 新纪录！', icon: 'none' })
        } else {
          uni.showToast({ title: '记下了', icon: 'none', duration: 800 })
        }
      } catch (e) {
        uni.showToast({ title: e.message || '保存失败', icon: 'none' })
      }
    },

    async removeSet(b, s) {
      uni.showModal({
        title: '删掉这一组？',
        content: s.weight + 'kg × ' + s.reps,
        success: async (r) => {
          if (!r.confirm) return
          try {
            await this.call('fit-session', {
              action: 'delSet',
              session_id: this.sessionId,
              set_id: s._id
            })
            b.logged = b.logged.filter(function (x) { return x._id !== s._id })
            this.sets = this.sets.filter(function (x) { return x._id !== s._id })
          } catch (e) {
            uni.showToast({ title: e.message || '删除失败', icon: 'none' })
          }
        }
      })
    },

    removeBlock(bi) {
      const b = this.blocks[bi]
      if (!b) return
      if (b.logged.length) {
        uni.showToast({ title: '这个动作已经记了组，删不了', icon: 'none' })
        return
      }
      this.blocks.splice(bi, 1)
    },

    /**
     * D7：从动作库带过来的动作 URL 里只有 exercise_id / exercise_name，
     * 直接 addBlock 会落到默认 3 组 × 8 次 × 90 秒，把动作自己的建议组次丢掉
     * （比如深蹲 5 组、休息 180 秒）。所以没带 default_* 时补查一次 detail。
     * 只能在这边补：动作库页面不归本任务改。
     */
    async loadPendingExercise() {
      const p = this._pendingExercise
      this._pendingExercise = null
      if (!p) return
      if (this.blocks.some(function (x) { return x.exercise_id === p._id })) return

      let ex = { _id: p._id, name: p.name }
      if (p.default_sets || p.default_reps || p.default_rest) {
        ex = p
      } else {
        try {
          const d = await this.call('fit-exercise', { action: 'detail', exercise_id: p._id })
          const full = d.exercise || {}
          ex = {
            _id: p._id,
            name: full.name || p.name,
            default_sets: full.default_sets,
            default_reps: full.default_reps,
            default_rest: full.default_rest
          }
        } catch (e) {
          console.warn('[workout] 查动作建议组次失败，用默认 3×8×90', e.message)
        }
      }
      this.addBlock(ex)
    },

    addBlock(ex) {
      const id = ex._id || ex.exercise_id
      if (!id) return
      if (this.blocks.some(function (x) { return x.exercise_id === id })) {
        uni.showToast({ title: '已经加过这个动作了', icon: 'none' })
        this.closePicker()
        return
      }
      this.blocks.push(this.makeBlock({
        _id: id,
        name: ex.name || ex.exercise_name,
        sets: ex.default_sets || 3,
        reps: ex.default_reps || 8,
        rest: ex.default_rest || 90
      }))
      this.closePicker()
    },

    async openPicker() {
      this.pickerOpen = true
      this.pickerKeyword = ''
      await this.searchPicker()
    },

    closePicker() {
      this.pickerOpen = false
    },

    async searchPicker() {
      const self = this
      if (this.searchTimer) clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(async function () {
        try {
          const d = await self.call('fit-exercise', {
            action: 'list',
            keyword: self.pickerKeyword.trim(),
            page: 1,
            page_size: 40
          })
          self.pickerList = d.list || []
        } catch (e) {
          self.pickerList = []
        }
      }, 300)
    },

    async pickDay(d) {
      if (this.dayIndex === d.day_index) return
      if (this.sets.length) {
        uni.showToast({ title: '已经开练了，不能再换训练日', icon: 'none' })
        return
      }
      this.dayIndex = d.day_index
      this.blocks = []
      // 已有记录时不重复走 start，直接换动作清单
      this.applyDayItems(d)
      // D5：训练日要落库，否则重进页面按会话里的 plan_day_index 恢复旧值，切换白切
      await this.saveDay()
    },

    async saveDay() {
      if (!this.sessionId) return
      try {
        await this.call('fit-session', {
          action: 'setDay',
          session_id: this.sessionId,
          day_index: this.dayIndex
        })
      } catch (e) {
        console.warn('[workout] 训练日没保存', e.message)
        uni.showToast({ title: e.message || '训练日没保存', icon: 'none' })
      }
    },

    applyDayItems(d) {
      const existing = {}
      for (const b of this.blocks) existing[b.exercise_id] = true
      for (const it of (d.items || [])) {
        if (existing[it.exercise_id]) continue
        this.blocks.push(this.makeBlock({
          _id: it.exercise_id,
          name: it.exercise_name,
          sets: it.sets,
          reps: it.reps,
          rest: it.rest
        }))
      }
    },

    finish(mode) {
      const self = this
      if (!this.sets.length) {
        uni.showModal({
          title: '一组都没记',
          content: '现在结束的话这次训练不会算进打卡，确定吗？',
          success: function (r) {
            if (!r.confirm) return
            self.doFinish('')
          }
        })
        return
      }
      uni.showModal({
        title: '结束这次训练？',
        content: '共 ' + this.sets.length + ' 组，容量 ' + this.volumeText + ' kg',
        editable: true,
        placeholderText: '写点感受（可不填）',
        success: function (r) {
          if (!r.confirm) return
          self.doFinish(r.content || '')
        }
      })
    },

    async doFinish(note) {
      try {
        const d = await this.call('fit-session', {
          action: 'finish',
          session_id: this.sessionId,
          note: note
        })
        if (d.abandoned) {
          // 0 组的会话云函数记成 status:'abandoned'：不计入打卡，也不进训练记录页
          uni.showModal({
            title: '这次没记组',
            content: '已结束，不计入打卡',
            showCancel: false,
            success: function () {
              uni.navigateBack()
            }
          })
          return
        }
        const s = (d.summary) || {}
        uni.showModal({
          title: '训练完成',
          content: '组数 ' + (s.total_sets || 0) + ' · 容量 ' + (s.total_volume || 0) +
            ' kg · 用时 ' + fmtDuration(s.duration_sec || 0),
          showCancel: false,
          success: function () {
            uni.navigateBack()
          }
        })
      } catch (e) {
        uni.showToast({ title: e.message || '保存失败', icon: 'none' })
      }
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 24rpx 32rpx 200rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
}

.page-head {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  margin-bottom: 24rpx;
}

.page-title {
  font-size: 40rpx;
  font-weight: 800;
  color: var(--tf-text);
}

.page-sub {
  font-size: 23rpx;
  color: var(--tf-text-3);
}

/* ---- 顶部数字条 ---- */
.bar {
  display: flex;
  flex-direction: row;
  background-color: var(--tf-card);
  border-radius: 26rpx;
  padding: 26rpx 0;
  margin-bottom: 24rpx;
}

.bar-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}

.bar-num {
  font-size: 38rpx;
  font-weight: 800;
  color: var(--tf-primary);
}

.bar-label {
  font-size: 21rpx;
  color: var(--tf-text-3);
}

/* ---- 训练日选择 ---- */
.day-picker {
  white-space: nowrap;
  margin-bottom: 24rpx;
}

.day-row {
  display: flex;
  flex-direction: row;
  gap: 14rpx;
}

.day-chip {
  padding: 12rpx 24rpx;
  background-color: var(--tf-card);
  border-radius: 18rpx;
  flex-shrink: 0;
}

.day-chip--on {
  background-color: var(--tf-primary);
}

.day-text {
  font-size: 25rpx;
  color: var(--tf-text-2);
}

.day-text--on {
  color: #ffffff;
  font-weight: 700;
}

/* ---- 区块标题 ---- */
.section-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}

.section-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.section-add {
  font-size: 25rpx;
  color: var(--tf-primary);
  font-weight: 600;
  padding: 6rpx 0 6rpx 20rpx;
}

/* ---- 动作块 ---- */
.block {
  background-color: var(--tf-card);
  border-radius: 26rpx;
  padding: 26rpx 24rpx;
  margin-bottom: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}

.block-head {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
}

.block-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.block-name {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.block-plan {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.block-del {
  font-size: 23rpx;
  color: var(--tf-text-3);
  padding: 4rpx 0;
}

/* ---- 已记录的组 ---- */
.logged {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  background-color: var(--tf-bg);
  border-radius: 18rpx;
  padding: 16rpx 18rpx;
}

.set-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 14rpx;
}

.set-idx {
  width: 36rpx;
  font-size: 22rpx;
  color: var(--tf-text-3);
  text-align: center;
}

.set-val {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.set-badge {
  font-size: 19rpx;
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
}

.set-badge--warm {
  background-color: #EFF0F2;
  color: var(--tf-text-3);
}

.set-badge--pr {
  background-color: #FFF1ED;
  color: var(--tf-primary);
  font-weight: 700;
}

.set-del {
  margin-left: auto;
  font-size: 24rpx;
  color: var(--tf-text-3);
  padding: 0 6rpx;
}

/* ---- 记一组 ---- */
.set-form {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 14rpx;
}

.input-box {
  flex: 1;
  display: flex;
  flex-direction: row;
  align-items: center;
  background-color: var(--tf-bg);
  border-radius: 16rpx;
  padding: 0 18rpx;
  height: 82rpx;
}

.set-input {
  flex: 1;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
  text-align: center;
}

.input-unit {
  font-size: 21rpx;
  color: var(--tf-text-3);
}

.set-times {
  font-size: 26rpx;
  color: var(--tf-text-3);
}

.set-done {
  width: 160rpx;
  height: 82rpx;
  background-color: var(--tf-primary);
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.set-done-text {
  font-size: 27rpx;
  font-weight: 700;
  color: #ffffff;
}

.last-hint {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.last-text {
  font-size: 21rpx;
  color: var(--tf-text-3);
}

.last-fill {
  font-size: 21rpx;
  color: var(--tf-primary);
  padding: 4rpx 0 4rpx 16rpx;
}

/* ---- 状态 ---- */
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 24rpx;
  gap: 14rpx;
}

.state--in {
  background-color: var(--tf-card);
  border-radius: 26rpx;
  padding: 60rpx 24rpx;
}

.state-ico {
  font-size: 76rpx;
  opacity: 0.4;
}

.state-title {
  font-size: 29rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.state-text {
  font-size: 23rpx;
  color: var(--tf-text-3);
  text-align: center;
}

/* ---- 底部结算 ---- */
.finish {
  margin-top: 30rpx;
}

.finish-btn {
  height: 108rpx;
  background-color: var(--tf-text);
  border-radius: 26rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}

.finish-text {
  font-size: 30rpx;
  font-weight: 800;
  color: #ffffff;
}

.finish-sub {
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.6);
}

/* ---- 选动作弹层 ---- */
.mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  z-index: 200;
}

.sheet {
  background-color: var(--tf-card);
  border-radius: 32rpx 32rpx 0 0;
  padding: 32rpx 32rpx 40rpx;
  height: 72vh;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  box-sizing: border-box;
}

.sheet-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.sheet-close {
  font-size: 28rpx;
  color: var(--tf-text-3);
  padding: 4rpx 8rpx;
}

.sheet-search {
  background-color: var(--tf-bg);
  border-radius: 18rpx;
  padding: 0 20rpx;
  height: 78rpx;
  display: flex;
  align-items: center;
}

.sheet-input {
  flex: 1;
  font-size: 26rpx;
  color: var(--tf-text);
}

.sheet-list {
  flex: 1;
  height: 0;
}

.sheet-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 6rpx;
  border-bottom: 2rpx solid var(--tf-line);
}

.sheet-item-name {
  font-size: 27rpx;
  color: var(--tf-text);
}

.sheet-item-meta {
  font-size: 21rpx;
  color: var(--tf-text-3);
}

.sheet-empty {
  padding: 60rpx 0;
  display: flex;
  justify-content: center;
}

.sheet-empty-text {
  font-size: 24rpx;
  color: var(--tf-text-3);
}
</style>
