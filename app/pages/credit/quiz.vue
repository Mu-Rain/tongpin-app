<template>
  <view class="page">
    <!-- 加载中 -->
    <view class="hint" v-if="loading">
      <text class="hint-text">正在准备…</text>
    </view>

    <!-- 加载失败 -->
    <view class="hint" v-else-if="errMsg">
      <text class="hint-text">{{ errMsg }}</text>
      <button class="btn btn--ghost" @tap="boot">重新加载</button>
    </view>

    <!-- 入场页：说清这次能加多少分 -->
    <block v-else-if="phase === 'intro'">
      <view class="card">
        <text class="card-title">《文明搭档守则》</text>
        <text class="card-desc">10 道题，一题一个场景。答完按规则加信誉分，答错会告诉你为什么。</text>
        <view class="meta-row">
          <text class="meta-k">本次可加</text>
          <text class="meta-v meta-v--plus">+{{ delta }}</text>
        </view>
        <view class="meta-row">
          <text class="meta-k">当前信誉分</text>
          <text class="meta-v">{{ score }}</text>
        </view>
      </view>

      <view class="card card--soft" v-if="kind === 'first'">
        <text class="card-desc">这是你的「新用户一次性特权」：满分 5 分。这次没拿满也不要紧，可以重考，只补差额，拿满 5 分这项才算用完。</text>
      </view>
      <view class="card card--soft" v-else>
        <text class="card-desc">分数低于 90 时，每天可以做一次，全对 +1.5。回到 90 分就不再加分了。</text>
      </view>

      <view class="card card--soft">
        <text class="card-desc">答对 8 题起才有分：全对拿满，9 题按 80%、8 题按 60%。7 题及以下不扣分，也不占今天的次数。</text>
      </view>

      <button class="btn btn--primary" @tap="startPaper">开始答题</button>
    </block>

    <!-- 答题 -->
    <block v-else-if="phase === 'quiz'">
      <view class="progress">
        <text class="progress-text">{{ idx + 1 }} / {{ questions.length }}</text>
        <view class="progress-bar">
          <view class="progress-fill" :style="progressStyle"></view>
        </view>
      </view>

      <view class="card">
        <text class="q-cat">{{ current.category }}</text>
        <text class="q-stem">{{ current.stem }}</text>

        <view
          class="opt"
          v-for="(o, i) in current.options"
          :key="i"
          :class="{ 'opt--on': answers[idx] === i }"
          @tap="choose(i)"
        >
          <text class="opt-idx">{{ ['A', 'B', 'C', 'D'][i] }}</text>
          <text class="opt-text">{{ o }}</text>
        </view>
      </view>

      <button class="btn btn--primary" :class="{ 'btn--dim': answers[idx] === -1 }" @tap="next">
        {{ idx === questions.length - 1 ? '交卷' : '下一题' }}
      </button>
      <text class="foot-note">选好答案才能继续；交卷前都可以改。</text>
    </block>

    <!-- 结果 -->
    <block v-else-if="phase === 'result'">
      <view class="card result">
        <text class="result-score">{{ result.correct }} / {{ result.total }}</text>
        <text class="result-line" v-if="result.delta > 0">信誉分 +{{ result.delta }}，现在是 {{ result.score_after }} 分</text>
        <text class="result-line result-line--dim" v-else>{{ result.reason || '这次不计分' }}</text>
      </view>

      <view class="card">
        <text class="card-title">看看哪里可以更好</text>
        <view class="item" v-for="(it, i) in result.items" :key="it.id">
          <text class="item-idx">{{ i + 1 }}.</text>
          <text class="item-mark" :class="it.ok ? 'item-mark--ok' : 'item-mark--no'">{{ it.ok ? '对' : '错' }}</text>
          <text class="item-explain">{{ it.explain }}</text>
        </view>
      </view>

      <button class="btn btn--primary" @tap="goBack">返回信誉分</button>
    </block>
  </view>
</template>

<script>
export default {
  data() {
    return {
      loading: true,
      errMsg: '',
      phase: 'intro',
      score: 0,
      kind: '',
      delta: 0,
      paperId: '',
      questions: [],
      answers: [],
      idx: 0,
      result: null,
      busy: false
    }
  },
  computed: {
    current() {
      return this.questions[this.idx] || { category: '', stem: '', options: [] }
    },
    progressStyle() {
      const n = this.questions.length || 1
      const w = Math.round(((this.idx + 1) / n) * 100)
      return 'width:' + w + '%'
    }
  },
  onLoad() {
    this.boot()
  },
  methods: {
    call(data) {
      const token = uni.getStorageSync('token')
      return new Promise((resolve, reject) => {
        uniCloud.callFunction({
          name: 'credit-quiz',
          data: Object.assign({ token: token }, data),
          success(res) {
            const r = res.result || {}
            if (r.code === 0) resolve(r.data)
            else reject(new Error(r.msg || '请求失败'))
          },
          fail(err) {
            reject(new Error((err && err.errMsg) || '网络不太顺，稍后再试'))
          }
        })
      })
    },
    boot() {
      this.loading = true
      this.errMsg = ''
      if (!uni.getStorageSync('token')) {
        this.loading = false
        this.errMsg = '还没登录，先登录再来'
        return
      }
      this.call({ action: 'status' })
        .then((d) => {
          this.loading = false
          this.score = d.score
          this.kind = d.kind
          this.delta = d.delta
          if (!d.can_quiz) {
            this.errMsg = d.reason || '现在不能做题'
            return
          }
          this.phase = 'intro'
        })
        .catch((e) => {
          this.loading = false
          this.errMsg = e.message
        })
    },
    startPaper() {
      if (this.busy) return
      this.busy = true
      this.call({ action: 'paper' })
        .then((d) => {
          this.busy = false
          this.paperId = d.paper_id
          this.kind = d.kind
          this.delta = d.delta
          this.questions = d.questions
          this.answers = d.questions.map(() => -1)
          this.idx = 0
          this.phase = 'quiz'
        })
        .catch((e) => {
          this.busy = false
          uni.showToast({ title: e.message, icon: 'none', duration: 2200 })
        })
    },
    choose(i) {
      const next = this.answers.slice()
      next[this.idx] = i
      this.answers = next
    },
    next() {
      if (this.answers[this.idx] === -1) {
        uni.showToast({ title: '先选一个答案', icon: 'none' })
        return
      }
      if (this.idx < this.questions.length - 1) {
        this.idx = this.idx + 1
        return
      }
      this.submit()
    },
    submit() {
      if (this.busy) return
      this.busy = true
      this.call({ action: 'submit', paper_id: this.paperId, answers: this.answers })
        .then((d) => {
          this.busy = false
          this.result = d
          this.phase = 'result'
          if (d.delta > 0) uni.$emit('tfCreditChanged')
        })
        .catch((e) => {
          this.busy = false
          uni.showToast({ title: e.message, icon: 'none', duration: 2200 })
        })
    },
    goBack() {
      uni.navigateBack({
        fail() {
          uni.redirectTo({ url: '/pages/credit/credit' })
        }
      })
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx 24rpx 60rpx;
  background: var(--tf-bg);
  box-sizing: border-box;
}

.hint {
  padding: 120rpx 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.hint-text {
  font-size: 27rpx;
  color: var(--tf-text-3);
  text-align: center;
  line-height: 1.6;
}

.card {
  background: var(--tf-card);
  border-radius: 28rpx;
  padding: 32rpx 28rpx;
  margin-bottom: 24rpx;
  box-shadow: var(--tf-lift-sm);
}
.card--soft {
  background: var(--tf-primary-soft);
  box-shadow: none;
}
.card-title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
  margin-bottom: 16rpx;
}
.card-desc {
  display: block;
  font-size: 26rpx;
  line-height: 1.75;
  color: var(--tf-text-2);
}

.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 20rpx;
  margin-top: 20rpx;
  border-top: 1px solid var(--tf-line-soft);
}
.meta-k {
  font-size: 26rpx;
  color: var(--tf-text-3);
}
.meta-v {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.meta-v--plus {
  color: var(--tf-mint);
}

.progress {
  padding: 8rpx 4rpx 24rpx;
}
.progress-text {
  font-size: 24rpx;
  color: var(--tf-text-3);
}
.progress-bar {
  margin-top: 12rpx;
  height: 8rpx;
  border-radius: 4rpx;
  background: var(--tf-line);
  overflow: hidden;
}
.progress-fill {
  height: 8rpx;
  border-radius: 4rpx;
  background: var(--tf-primary);
  transition: width 220ms ease;
}

.q-cat {
  display: block;
  font-size: 22rpx;
  color: var(--tf-text-3);
  margin-bottom: 12rpx;
}
.q-stem {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.6;
  color: var(--tf-text);
  margin-bottom: 24rpx;
}

.opt {
  display: flex;
  align-items: flex-start;
  padding: 22rpx 20rpx;
  margin-bottom: 16rpx;
  border-radius: 20rpx;
  border: 2rpx solid var(--tf-line);
  background: var(--tf-card);
}
.opt--on {
  border-color: var(--tf-primary);
  background: var(--tf-primary-soft);
}
.opt-idx {
  width: 44rpx;
  font-size: 25rpx;
  font-weight: 700;
  color: var(--tf-text-3);
  line-height: 1.6;
}
.opt--on .opt-idx {
  color: var(--tf-primary-deep);
}
.opt-text {
  flex: 1;
  font-size: 27rpx;
  line-height: 1.6;
  color: var(--tf-text);
}

.btn {
  margin-top: 12rpx;
  height: 92rpx;
  line-height: 92rpx;
  border-radius: 46rpx;
  font-size: 29rpx;
  font-weight: 700;
  border: none;
}
.btn::after {
  border: none;
}
.btn--primary {
  background: var(--tf-primary);
  color: var(--tf-primary-deep);
}
.btn--dim {
  opacity: 0.55;
}
.btn--ghost {
  margin-top: 24rpx;
  background: transparent;
  color: var(--tf-text-2);
  border: 2rpx solid var(--tf-line);
}

.foot-note {
  display: block;
  margin-top: 18rpx;
  font-size: 23rpx;
  color: var(--tf-text-3);
  text-align: center;
}

.result {
  align-items: center;
  display: flex;
  flex-direction: column;
  padding: 44rpx 28rpx;
}
.result-score {
  font-size: 64rpx;
  font-weight: 800;
  color: var(--tf-text);
  letter-spacing: 1rpx;
}
.result-line {
  margin-top: 16rpx;
  font-size: 27rpx;
  color: var(--tf-mint);
}
.result-line--dim {
  color: var(--tf-text-3);
}

.item {
  display: flex;
  align-items: flex-start;
  padding: 18rpx 0;
  border-top: 1px solid var(--tf-line-soft);
}
.item:first-of-type {
  border-top: none;
}
.item-idx {
  width: 42rpx;
  font-size: 24rpx;
  color: var(--tf-text-3);
  line-height: 1.6;
}
.item-mark {
  width: 46rpx;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1.6;
}
.item-mark--ok {
  color: var(--tf-mint);
}
.item-mark--no {
  color: #c0392b;
}
.item-explain {
  flex: 1;
  font-size: 25rpx;
  line-height: 1.65;
  color: var(--tf-text-2);
}
</style>
