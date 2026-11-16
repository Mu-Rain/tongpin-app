<template>
  <view class="page">

    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">接入模型</text>
    </view>

    <!-- 当前用的是哪个 -->
    <view class="card">
      <view class="row">
        <text class="row-k">当前使用</text>
        <text class="row-v">{{ modeText }}</text>
      </view>
      <view class="row" v-if="cfg && cfg.mode === 'self'">
        <text class="row-k">接口地址</text>
        <text class="row-v row-v--mono">{{ cfg.base_url }}</text>
      </view>
      <view class="row" v-if="cfg && cfg.mode === 'self'">
        <text class="row-k">模型</text>
        <text class="row-v row-v--mono">{{ cfg.model }}</text>
      </view>
      <view class="row" v-if="cfg && cfg.mode === 'self'">
        <text class="row-k">Key</text>
        <text class="row-v row-v--mono">{{ cfg.key_masked }}</text>
      </view>
      <view class="row" v-if="quota">
        <text class="row-k">今日用量</text>
        <text class="row-v">{{ quota.used }} / {{ quota.limit }}</text>
      </view>
    </view>

    <!-- 用自己的接口 -->
    <view class="card">
      <text class="card-title">用自己的接口</text>
      <text class="card-sub">
        任何「OpenAI 兼容」的接口都行。填完点「测试一下」，通过再保存 —— 免得存进去一个连不上的地址，用的时候才发现。
      </text>

      <view class="chip-row">
        <view class="chip" v-for="(p, i) in PRESETS" :key="p.name" @tap="usePreset(p)">
          <text class="chip-txt">{{ p.name }}</text>
        </view>
      </view>

      <text class="f-label">接口地址</text>
      <input
        class="f-input"
        v-model="form.base_url"
        placeholder="https://api.deepseek.com/v1"
        placeholder-class="ph"
      />

      <text class="f-label">模型名</text>
      <input class="f-input" v-model="form.model" placeholder="qwen-plus" placeholder-class="ph" />

      <text class="f-label">API Key</text>
      <input
        class="f-input"
        v-model="form.api_key"
        :password="!showKey"
        placeholder="sk-…"
        placeholder-class="ph"
      />
      <view class="eye" @tap="showKey = !showKey">
        <text class="eye-txt">{{ showKey ? '隐藏' : '显示' }}</text>
      </view>

      <view class="btn-row">
        <view class="btn btn--ghost" :class="{ 'btn--busy': testing }" @tap="test">
          <text class="btn-txt">{{ testing ? '测试中…' : '测试一下' }}</text>
        </view>
        <view class="btn" :class="{ 'btn--busy': saving }" @tap="save">
          <text class="btn-txt btn-txt--on">{{ saving ? '保存中…' : '保存并使用' }}</text>
        </view>
      </view>

      <text class="test-ok" v-if="testOk">握手成功：{{ testOk }}（{{ testMs }}ms）</text>
    </view>

    <!-- 默认模型 -->
    <view class="card">
      <text class="card-title">用默认模型</text>
      <text class="card-sub" v-if="def && def.available">
        不用填任何东西，直接就能用。默认模型每天有次数上限，够平时的写需求和找搭子。
      </text>
      <text class="card-sub" v-else>
        管理员还没配置默认模型。你可以先填自己的接口，或者让管理员在云函数环境变量里配一个。
      </text>
      <text class="card-sub" v-if="def && def.missing">
        缺的是{{ def.missing === 'base_url' ? '接口地址' : '模型名' }}：Key 已经配了，这一项还是空的。
      </text>
      <view class="row row--tight" v-if="def && def.available">
        <text class="row-k">接口地址</text>
        <text class="row-v row-v--mono">{{ def.base_url || '没配，用兜底地址' }}</text>
      </view>
      <view class="row row--tight" v-if="def && def.available">
        <text class="row-k">模型</text>
        <text class="row-v row-v--mono">{{ def.model }}</text>
      </view>
      <view class="row row--tight" v-if="def && def.available">
        <text class="row-k">每人每天</text>
        <text class="row-v">{{ def.daily_limit }} 次</text>
      </view>
      <view class="btn btn--ghost" v-if="cfg && cfg.mode === 'self'" @tap="clearSelf">
        <text class="btn-txt">删掉自己的配置，切回默认</text>
      </view>
    </view>

    <view class="foot">
      <text class="foot-txt">
        Key 只存在服务端，前端从头到尾拿不到明文，页面上也只显示尾号。删除配置就立刻失效。
      </text>
    </view>
  </view>
</template>

<script>
import { callAi, aiErrorText, aiToken } from '@/common/ai/client.js'

/* 常见的大模型接口。只填地址和模型名，Key 要用户自己去各家控制台拿 —— 我们不代申请。 */
const PRESETS = [
  { name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-flash' },
  { name: '通义千问', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'Kimi', base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '智谱', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
]

export default {
  data() {
    return {
      PRESETS,
      cfg: null,
      def: null,
      quota: null,
      form: { base_url: '', model: '', api_key: '' },
      showKey: false,
      testing: false,
      saving: false,
      testOk: '',
      testMs: 0
    }
  },
  computed: {
    modeText() {
      if (!this.cfg) return '读取中…'
      if (this.cfg.mode === 'self') return '你自己的接口'
      return this.def && this.def.available ? '默认模型' : '还没配置'
    }
  },
  onLoad() {
    if (!aiToken()) {
      uni.showModal({
        title: '需要登录',
        content: '接入模型要用你的账号存配置，先登录。',
        confirmText: '去登录',
        success: (r) => {
          if (r.confirm) uni.reLaunch({ url: '/pages/login/login' })
        }
      })
      return
    }
    this.load()
  },
  methods: {
    async load() {
      try {
        const d = await callAi('config-get')
        this.cfg = d
        this.def = d.default || null
        if (d.mode === 'self') {
          this.form.base_url = d.base_url || ''
          this.form.model = d.model || ''
          // Key 不会回明文：留空表示「不改」，要改就整条重新填
          this.form.api_key = ''
        }
        const s = await callAi('status')
        if (s && s.daily_limit) {
          this.quota = { used: s.today_count || 0, limit: s.daily_limit }
        }
      } catch (e) {
        uni.showModal({ title: '读取失败', content: aiErrorText(e), showCancel: false })
      }
    },

    usePreset(p) {
      this.form.base_url = p.base_url
      this.form.model = p.model
      this.testOk = ''
    },

    async test() {
      if (this.testing) return
      const err = this.checkForm(true)
      if (err) {
        uni.showToast({ title: err, icon: 'none', duration: 2200 })
        return
      }
      this.testing = true
      this.testOk = ''
      try {
        const d = await callAi('config-test', {
          base_url: this.form.base_url.trim(),
          model: this.form.model.trim(),
          api_key: this.form.api_key.trim()
        })
        this.testOk = d.reply || 'OK'
        this.testMs = d.latency_ms || 0
        uni.showToast({ title: '能连上', icon: 'success' })
      } catch (e) {
        uni.showModal({ title: '连不上', content: aiErrorText(e), showCancel: false })
      } finally {
        this.testing = false
      }
    },

    async save() {
      if (this.saving) return
      const err = this.checkForm(false)
      if (err) {
        uni.showToast({ title: err, icon: 'none', duration: 2200 })
        return
      }
      this.saving = true
      uni.showLoading({ title: '保存中', mask: true })
      try {
        await callAi('config-save', {
          base_url: this.form.base_url.trim(),
          model: this.form.model.trim(),
          api_key: this.form.api_key.trim()
        })
        uni.hideLoading()
        uni.showToast({ title: '已保存', icon: 'success' })
        this.form.api_key = ''
        this.testOk = ''
        setTimeout(() => this.load(), 600)
      } catch (e) {
        uni.hideLoading()
        uni.showModal({ title: '保存失败', content: aiErrorText(e), showCancel: false })
      } finally {
        this.saving = false
      }
    },

    /* 允许不填 Key 时保存吗？不允许 —— 库里存一个没有 Key 的配置，
       下次取配置会当作「没配」，用户会以为自己保存成功了 */
    checkForm(forTest) {
      const b = String(this.form.base_url || '').trim()
      const m = String(this.form.model || '').trim()
      const k = String(this.form.api_key || '').trim()
      if (!b) return '先填接口地址'
      if (b.indexOf('http://') !== 0 && b.indexOf('https://') !== 0) return '地址要以 http:// 或 https:// 开头'
      if (!m) return '先填模型名'
      if (!k) return forTest ? '测试要填 Key' : '先填 API Key'
      return ''
    },

    clearSelf() {
      uni.showModal({
        title: '切回默认模型',
        content: '会删掉你存的服务端配置，之后用的是默认模型。',
        success: async (r) => {
          if (!r.confirm) return
          try {
            await callAi('config-clear')
            uni.showToast({ title: '已切回默认', icon: 'success' })
            this.form.api_key = ''
            setTimeout(() => this.load(), 600)
          } catch (e) {
            uni.showModal({ title: '没成功', content: aiErrorText(e), showCancel: false })
          }
        }
      })
    },

    goBack() {
      uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/mine/mine' }) })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  background: var(--tf-bg);
  padding-bottom: 40rpx;
}

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

.card {
  margin: 20rpx 28rpx 0;
  padding: 26rpx 26rpx 24rpx;
  background: var(--tf-card);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-lift);
}
.card-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.card-sub {
  display: block;
  margin-top: 8rpx;
  font-size: 23rpx;
  line-height: 1.65;
  color: var(--tf-text-3);
}

.row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  padding: 14rpx 0;
}
.row + .row {
  border-top: 2rpx solid var(--tf-line-soft);
}
.row--tight {
  padding: 8rpx 0;
}
.row-k {
  font-size: 25rpx;
  color: var(--tf-text-3);
  flex-shrink: 0;
  margin-right: 24rpx;
}
.row-v {
  flex: 1;
  font-size: 25rpx;
  color: var(--tf-text);
  text-align: right;
  word-break: break-all;
}
.row-v--mono {
  font-family: Menlo, Consolas, monospace;
  font-size: 23rpx;
}

.chip-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 18rpx;
}
.chip {
  padding: 10rpx 20rpx;
  margin: 0 12rpx 12rpx 0;
  background: var(--tf-primary-soft);
  border-radius: 999rpx;
}
.chip-txt {
  font-size: 23rpx;
  color: var(--tf-primary-deep);
}

.f-label {
  display: block;
  margin-top: 20rpx;
  font-size: 23rpx;
  color: var(--tf-text-3);
}
.f-input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 10rpx;
  height: 84rpx;
  padding: 0 18rpx;
  background: var(--tf-bg);
  border-radius: var(--tf-r-md);
  font-size: 25rpx;
  color: var(--tf-text);
}
.ph {
  color: var(--tf-text-3);
}
.eye {
  align-self: flex-end;
  margin-top: 10rpx;
}
.eye-txt {
  font-size: 22rpx;
  color: var(--tf-primary-deep);
}

.btn-row {
  display: flex;
  flex-direction: row;
  margin-top: 26rpx;
}
.btn {
  flex: 1;
  height: 84rpx;
  border-radius: var(--tf-r-md);
  background: var(--tf-primary-deep);
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn + .btn {
  margin-left: 16rpx;
}
.btn--ghost {
  background: transparent;
  border: 2rpx solid var(--tf-line);
}
.btn--ghost .btn-txt {
  color: var(--tf-text-2);
  font-weight: 500;
}
.btn--gain {
  margin-top: 22rpx;
}
.btn--busy {
  opacity: 0.6;
}
.btn-txt {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--tf-text-2);
}
.btn-txt--on {
  color: #fff;
}

.test-ok {
  display: block;
  margin-top: 16rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--tf-success);
}

.foot {
  padding: 30rpx 40rpx 0;
}
.foot-txt {
  font-size: 21rpx;
  line-height: 1.7;
  color: var(--tf-text-3);
}
</style>