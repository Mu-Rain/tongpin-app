<template>
  <view class="page">

    <!-- 导航：本页自己画返回，和「设置」「系统头像」同一套 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">同频助手</text>
      <view class="nav-set" @tap="goConfig">
        <text class="nav-set-txt">⚙</text>
      </view>
    </view>

    <!-- 模型没配好时先说清楚，不然点按钮只会拿到一句报错 -->
    <view class="warn" v-if="status && !status.ready">
      <text class="warn-txt">还没接入模型。点右上角 ⚙ 填自己的接口，或者找管理员配置默认模型。</text>
    </view>

    <!-- 两个 tab：写需求 / 找搭子。放在同一个页面，是因为它们共用一套模型设置和配额 -->
    <view class="tabs">
      <view class="tab" :class="{ 'tab--on': tab === 'write' }" @tap="setTab('write')">
        <text class="tab-txt" :class="{ 'tab-txt--on': tab === 'write' }">帮我写需求</text>
      </view>
      <view class="tab" :class="{ 'tab--on': tab === 'match' }" @tap="setTab('match')">
        <text class="tab-txt" :class="{ 'tab-txt--on': tab === 'match' }">帮我找搭子</text>
      </view>
    </view>

    <!-- ===================== A · 帮我写需求 ===================== -->
    <view v-if="tab === 'write'">
      <view class="card">
        <text class="card-title">用一句话说你想找什么样的搭子</text>
        <text class="card-sub">AI 会把它写成一张能直接发布的卡片：标题、说明、标签都填好。</text>
        <textarea
          class="ta"
          v-model="writeText"
          placeholder="例：想找晚上一起去图书馆自习的，能安静坐两小时"
          placeholder-class="ph"
          :maxlength="200"
        />
        <view class="ex-row">
          <view class="ex" v-for="(e, i) in WRITE_EXAMPLES" :key="i" @tap="fillWrite(e)">
            <text class="ex-txt">{{ e }}</text>
          </view>
        </view>
        <view class="btn" :class="{ 'btn--busy': writing }" @tap="genCard">
          <text class="btn-txt">{{ writing ? '正在写…' : '生成需求卡' }}</text>
        </view>
      </view>

      <view class="card card--out" v-if="card">
        <view class="out-head">
          <text class="out-type">{{ card.type_label }}</text>
          <text class="out-quota" v-if="quotaLine">{{ quotaLine }}</text>
        </view>
        <text class="out-title">{{ card.title }}</text>
        <text class="out-desc">{{ card.description }}</text>

        <view class="tag-row" v-if="card.tag_names && card.tag_names.length">
          <text class="tag" v-for="(n, i) in card.tag_names" :key="i">{{ n }}</text>
        </view>
        <text class="out-unknown" v-if="card.tags_unknown && card.tags_unknown.length">
          这 {{ card.tags_unknown.length }} 个标签字典里没有，已略过：{{ card.tags_unknown.join('、') }}
        </text>

        <text class="out-extra" v-if="card.location">地点：{{ card.location }}</text>
        <text class="out-extra" v-if="card.start_hint">时间：{{ card.start_hint }}</text>

        <view class="btn btn--primary" @tap="useCard">
          <text class="btn-txt btn-txt--on">用这张卡去发布</text>
        </view>
        <view class="btn btn--ghost" @tap="genCard">
          <text class="btn-txt">换一版</text>
        </view>
        <text class="out-note">AI 写的是草稿，发出去之前自己看一眼 —— 时间和措辞都可能要改。</text>
      </view>

      <view class="empty" v-if="!card && !writing">
        <text class="empty-ico">✍️</text>
        <text class="empty-txt">写完一句话，点「生成需求卡」</text>
      </view>
    </view>

    <!-- ===================== B · 帮我找搭子 ===================== -->
    <view v-else>
      <view class="card">
        <text class="card-title">说说你今晚/这几天想干什么</text>
        <text class="card-sub">AI 会从大厅里的需求里挑出最对得上的几条，并说明为什么推荐。</text>
        <textarea
          class="ta"
          v-model="matchText"
          placeholder="例：想找个人一起夜跑，慢一点的那种"
          placeholder-class="ph"
          :maxlength="120"
        />
        <view class="ex-row">
          <view class="ex" v-for="(e, i) in MATCH_EXAMPLES" :key="i" @tap="fillMatch(e)">
            <text class="ex-txt">{{ e }}</text>
          </view>
        </view>
        <view class="btn" :class="{ 'btn--busy': matching }" @tap="doMatch">
          <text class="btn-txt">{{ matching ? '正在找…' : '帮我找' }}</text>
        </view>
      </view>

      <view class="intent" v-if="intentLine">
        <text class="intent-ico">💡</text>
        <text class="intent-txt">{{ intentLine }}</text>
      </view>

      <view class="hit" v-for="it in hits" :key="it.card_id" @tap="openCard(it)">
        <view class="hit-top">
          <text class="hit-type">{{ it.type_label }}</text>
          <text class="hit-time">{{ timeText(it.start_time) }}</text>
        </view>
        <text class="hit-title">{{ it.title }}</text>
        <text class="hit-reason">{{ it.reason }}</text>
        <view class="hit-foot">
          <text class="hit-place" v-if="it.location_name">{{ it.location_name }}</text>
          <text class="hit-go">看看 ›</text>
        </view>
      </view>

      <view class="empty" v-if="matched && !hits.length">
        <text class="empty-ico">🌙</text>
        <text class="empty-txt">一条都没对上。换个说法再试，或者自己去大厅翻翻。</text>
      </view>

      <view class="empty" v-if="!matched && !matching">
        <text class="empty-ico">🔍</text>
        <text class="empty-txt">写完一句，点「帮我找」</text>
      </view>
    </view>

    <view class="foot">
      <text class="foot-txt">智能助手只做两件事：把话写清楚、把对得上的需求挑出来。发不发、加不加微信，还是你自己决定。</text>
    </view>
  </view>
</template>

<script>
import { callAi, aiErrorText, aiToken } from '@/common/ai/client.js'

const WRITE_EXAMPLES = ['晚上一起自习', '周末去打球', '找人一起吃饭', '想拍一组校园照']
const MATCH_EXAMPLES = ['今晚想夜跑', '找个安静的人自习', '周末想打球', '想约人一起吃饭']

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

export default {
  data() {
    return {
      WRITE_EXAMPLES,
      MATCH_EXAMPLES,
      tab: 'write',
      /* 从发布页点「AI 帮我写」进来时为 true：生成完要退回发布页，而不是另开一个发布页 */
      fromPublish: false,
      /* 从发布页带过来的半成品：有它就按「润色」口径生成，而不是从零写 */
      draftTitle: '',
      draftDesc: '',
      writeText: '',
      matchText: '',
      writing: false,
      matching: false,
      card: null,
      hits: [],
      intent: null,
      fallback: false,
      matched: false,
      quota: null,
      status: null
    }
  },
  computed: {
    quotaLine() {
      const q = this.quota
      if (!q || !q.limit) return ''
      return '今日已用 ' + q.used + '/' + q.limit
    },
    intentLine() {
      const it = this.intent
      if (!it) return ''
      const parts = []
      if (it.note) parts.push(it.note)
      if (it.tags && it.tags.length) parts.push('标签：' + it.tags.join('、'))
      if (it.keywords && it.keywords.length) parts.push('关键词：' + it.keywords.join('、'))
      if (it.time) parts.push('时间：' + it.time)
      if (this.fallback) parts.push('没完全对上，先给你最近的几条')
      return parts.join(' · ')
    }
  },
  onLoad(options) {
    const o = options || {}
    this.tab = o.tab === 'match' ? 'match' : 'write'
    this.fromPublish = o.from === 'publish'
    // 发布页带过来的标题/说明：说明有内容就直接当「要润色的草稿」
    this.draftTitle = o.title ? String(o.title) : ''
    this.draftDesc = o.desc ? String(o.desc) : ''
    if (this.draftDesc || this.draftTitle) {
      this.writeText = this.draftDesc || this.draftTitle
    }
    this.loadStatus()
  },
  methods: {
    async loadStatus() {
      // 没配模型不影响已经配好的用户用，所以这里失败就当没读到，不弹报错
      try {
        this.status = await callAi('status')
      } catch (e) {
        this.status = null
      }
    },

    setTab(k) {
      this.tab = k
    },

    fillWrite(e) {
      this.writeText = e
    },

    fillMatch(e) {
      this.matchText = e
    },

    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/mine/mine' })
      })
    },

    goConfig() {
      uni.navigateTo({ url: '/pages/ai-config/ai-config' })
    },

    /* 生成需求卡：有草稿就带着草稿去，让模型润色而不是另写一版 */
    async genCard() {
      if (this.writing) return
      if (!aiToken()) {
        this.needLogin()
        return
      }
      const text = String(this.writeText || '').trim()
      if (!text) {
        uni.showToast({ title: '先写一句你想找什么', icon: 'none' })
        return
      }
      const payload = { text: text }
      if (this.draftTitle || this.draftDesc) {
        payload.draft = { title: this.draftTitle, description: this.draftDesc }
      }
      this.writing = true
      uni.showLoading({ title: '正在写', mask: true })
      try {
        const d = await callAi('card', payload)
        this.card = d.card || null
        this.quota = d.quota || null
      } catch (e) {
        this.handleErr(e)
      } finally {
        this.writing = false
        uni.hideLoading()
      }
    },

    /* 用这张卡去发布：不直接把内容塞回去，而是写一份草稿给发布页读 ——
       发布页可能是被 navigateBack 唤醒的，也可能不在栈里，两种都得能接住 */
    useCard() {
      const c = this.card
      if (!c) return
      const draft = {
        type: c.type,
        title: c.title,
        description: c.description,
        tag_ids: c.tag_ids || [],
        location: c.location || ''
      }
      uni.setStorageSync('ai_card_draft', draft)
      if (this.fromPublish) {
        uni.navigateBack()
        return
      }
      uni.redirectTo({ url: '/pages/publish/publish' })
    },

    async doMatch() {
      if (this.matching) return
      if (!aiToken()) {
        this.needLogin()
        return
      }
      const text = String(this.matchText || '').trim()
      if (!text) {
        uni.showToast({ title: '先说一句你想找什么', icon: 'none' })
        return
      }
      this.matching = true
      uni.showLoading({ title: '正在找', mask: true })
      try {
        const d = await callAi('match', { text: text })
        this.hits = d.items || []
        this.intent = d.intent || null
        this.fallback = !!d.fallback
        this.quota = d.quota || null
        this.matched = true
      } catch (e) {
        this.handleErr(e)
        this.matched = false
      } finally {
        this.matching = false
        uni.hideLoading()
      }
    },

    openCard(it) {
      if (!it || !it.card_id) return
      uni.navigateTo({ url: '/pages/detail/detail?id=' + it.card_id })
    },

    timeText(ts) {
      if (!ts) return '时间看详情'
      const d = new Date(ts)
      const now = new Date()
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes())
      if (sameDay) return '今天 ' + hm
      return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + hm
    },

    needLogin() {
      uni.showModal({
        title: '需要登录',
        content: '智能助手要用你的身份算配额，先登录。',
        confirmText: '去登录',
        success: (r) => {
          if (r.confirm) uni.reLaunch({ url: '/pages/login/login' })
        }
      })
    },

    handleErr(e) {
      const code = e && e.code
      uni.showModal({
        title: code === 501 ? '还没接入模型' : '没成功',
        content: aiErrorText(e),
        showCancel: code === 501,
        cancelText: '算了',
        confirmText: code === 501 ? '去设置' : '知道了',
        success: (r) => {
          if (r.confirm && code === 501) uni.navigateTo({ url: '/pages/ai-config/ai-config' })
        }
      })
    }
  }
}
</script>

<style>
/* ==========================================================================
   同频助手
   --------------------------------------------------------------------------
   视觉沿用全局令牌。AI 相关的点缀色用已有的 --tf-ai / --tf-ai-soft
   （这两个令牌首页和消息页已经在用），不新增颜色。
   ========================================================================== */
.page {
  min-height: 100vh;
  background: var(--tf-bg);
  padding-bottom: 40rpx;
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
.nav-set {
  position: absolute;
  right: 24rpx;
  top: calc(var(--status-bar-height) + 14rpx);
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-set-txt {
  font-size: 34rpx;
  color: var(--tf-text-2);
  line-height: 1;
}

.warn {
  margin: 4rpx 28rpx 0;
  padding: 18rpx 22rpx;
  background: var(--tf-ai-soft);
  border-radius: var(--tf-r-md);
}
.warn-txt {
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* tab */
.tabs {
  display: flex;
  flex-direction: row;
  margin: 20rpx 28rpx 0;
  background: var(--tf-card);
  border-radius: var(--tf-r-md);
  padding: 6rpx;
}
.tab {
  flex: 1;
  height: 68rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--tf-r-sm);
}
.tab--on {
  background: var(--tf-primary-soft);
}
.tab-txt {
  font-size: 26rpx;
  color: var(--tf-text-2);
}
.tab-txt--on {
  color: var(--tf-primary-deep);
  font-weight: 700;
}

/* 卡片 */
.card {
  margin: 20rpx 28rpx 0;
  padding: 26rpx 26rpx 24rpx;
  background: var(--tf-card);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-lift);
}
.card--out {
  border: 2rpx solid var(--tf-ai);
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
  line-height: 1.6;
  color: var(--tf-text-3);
}
.ta {
  width: 100%;
  box-sizing: border-box;
  margin-top: 18rpx;
  min-height: 150rpx;
  padding: 18rpx;
  background: var(--tf-bg);
  border-radius: var(--tf-r-md);
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--tf-text);
}
.ph {
  color: var(--tf-text-3);
}

.ex-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 14rpx;
}
.ex {
  padding: 10rpx 18rpx;
  margin: 0 12rpx 12rpx 0;
  background: var(--tf-ai-soft);
  border-radius: 999rpx;
}
.ex-txt {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

/* 按钮：主按钮实底、次按钮描边，点下去要能看出在跑 */
.btn {
  margin-top: 20rpx;
  height: 84rpx;
  border-radius: var(--tf-r-md);
  background: var(--tf-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.btn--busy {
  opacity: 0.6;
}
.btn--primary {
  background: var(--tf-primary-deep);
}
.btn--ghost {
  margin-top: 14rpx;
  background: transparent;
  border: 2rpx solid var(--tf-line);
}
.btn-txt {
  font-size: 28rpx;
  font-weight: 600;
  color: #fff;
}
.btn-txt--on {
  color: #fff;
}
.btn--ghost .btn-txt {
  color: var(--tf-text-2);
  font-weight: 500;
}

/* 生成结果 */
.out-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.out-type {
  padding: 6rpx 16rpx;
  background: var(--tf-ai-soft);
  border-radius: 8rpx;
  font-size: 22rpx;
  color: var(--tf-text-2);
}
.out-quota {
  font-size: 21rpx;
  color: var(--tf-text-3);
}
.out-title {
  display: block;
  margin-top: 18rpx;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.45;
  color: var(--tf-text);
}
.out-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.75;
  color: var(--tf-text-2);
}
.tag-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 16rpx;
}
.tag {
  padding: 8rpx 16rpx;
  margin: 0 12rpx 12rpx 0;
  background: var(--tf-primary-soft);
  border-radius: 8rpx;
  font-size: 22rpx;
  color: var(--tf-primary-deep);
}
.out-unknown {
  display: block;
  margin-top: 4rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--tf-text-3);
}
.out-extra {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: var(--tf-text-2);
}
.out-note {
  display: block;
  margin-top: 16rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--tf-text-3);
}

/* 找搭子的意图说明 */
.intent {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  margin: 20rpx 28rpx 0;
  padding: 18rpx 22rpx;
  background: var(--tf-ai-soft);
  border-radius: var(--tf-r-md);
}
.intent-ico {
  font-size: 24rpx;
  margin-right: 12rpx;
  line-height: 1.5;
}
.intent-txt {
  flex: 1;
  font-size: 23rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* 结果条目 */
.hit {
  margin: 18rpx 28rpx 0;
  padding: 24rpx 24rpx 20rpx;
  background: var(--tf-card);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-lift-sm);
}
.hit-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.hit-type {
  padding: 5rpx 14rpx;
  background: var(--tf-primary-soft);
  border-radius: 8rpx;
  font-size: 21rpx;
  color: var(--tf-primary-deep);
}
.hit-time {
  font-size: 21rpx;
  color: var(--tf-text-3);
}
.hit-title {
  display: block;
  margin-top: 14rpx;
  font-size: 29rpx;
  font-weight: 700;
  line-height: 1.5;
  color: var(--tf-text);
}
.hit-reason {
  display: block;
  margin-top: 10rpx;
  font-size: 23rpx;
  line-height: 1.6;
  color: var(--tf-primary-deep);
}
.hit-foot {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 16rpx;
}
.hit-place {
  font-size: 22rpx;
  color: var(--tf-text-3);
}
.hit-go {
  font-size: 23rpx;
  color: var(--tf-text-2);
}

/* 空态 */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 90rpx 40rpx 40rpx;
}
.empty-ico {
  font-size: 56rpx;
  line-height: 1;
}
.empty-txt {
  margin-top: 18rpx;
  font-size: 24rpx;
  color: var(--tf-text-3);
  text-align: center;
}

.foot {
  padding: 34rpx 40rpx 0;
}
.foot-txt {
  font-size: 21rpx;
  line-height: 1.7;
  color: var(--tf-text-3);
}
</style>