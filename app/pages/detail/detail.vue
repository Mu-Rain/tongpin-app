<template>
  <view class="page">
    <!-- 加载中 -->
    <view class="state-box" v-if="loading && !card">
      <text class="state-text">加载中…</text>
    </view>

    <!-- 加载失败 -->
    <view class="state-box" v-else-if="!card">
      <text class="state-title">打不开这张卡片</text>
      <text class="state-hint">{{ errMsg || '它可能已经被删除了' }}</text>
      <button class="btn" @tap="goBack">返回大厅</button>
    </view>

    <!-- 正常内容 -->
    <block v-else>
      <!-- 发布者 -->
      <view class="owner-card">
        <view class="avatar">{{ (card.owner.nickname || '同').slice(0, 1) }}</view>
        <view class="owner-main">
          <view class="name-row">
            <text class="name">{{ card.owner.nickname }}</text>
            <text class="verified" v-if="card.owner.is_verified">✔ 已认证</text>
          </view>
          <text class="meta">
            {{ card.owner.school || '未填学校' }}
            <text v-if="card.owner.grade"> · {{ card.owner.grade }}</text>
            <text v-if="card.owner.user_no"> · {{ card.owner.user_no }}</text>
          </text>
          <text class="bio" v-if="card.owner.bio">{{ card.owner.bio }}</text>
        </view>
        <view class="credit">
          <text class="credit-num">{{ card.owner.credit_score }}</text>
          <text class="credit-label">信誉分</text>
        </view>
      </view>

      <!-- 卡片正文 -->
      <view class="main-card">
        <view class="type-row">
          <text class="type-tag">{{ typeLabel(card.type) }}</text>
          <text class="status-tag" :class="'status-tag--' + card.status">{{ statusLabel(card.status) }}</text>
          <text class="mine-tag" v-if="card.is_mine">我发的</text>
        </view>

        <text class="title">{{ card.title }}</text>
        <text class="desc">{{ card.description }}</text>

        <!-- 标签 -->
        <view class="section" v-if="card.tags.length">
          <text class="section-title">标签</text>
          <view class="tags">
            <text
              class="tag"
              :class="{ 'tag--hit': card.common_tags.indexOf(t._id) > -1 }"
              v-for="t in card.tags"
              :key="t._id"
            >
              {{ t.name }}
            </text>
          </view>
        </view>

        <!-- 重合度 -->
        <view class="common-box" v-if="card.common_tag_count > 0">
          <text class="common-title">你们有 {{ card.common_tag_count }} 个共同标签</text>
          <view class="tags">
            <text class="tag tag--hit" v-for="t in card.common_tag_detail" :key="t._id">{{ t.name }}</text>
          </view>
        </view>

        <!-- 时间地点 -->
        <view class="section" v-if="hasTimePlace">
          <text class="section-title">时间地点</text>
          <text class="info-line" v-if="card.location_name">📍 {{ card.location_name }}</text>
          <text class="info-line" v-if="card.start_time">🕐 {{ fmtRange(card.start_time, card.end_time) }}</text>
          <text class="info-line">👥 想找 {{ card.expected_people || 1 }} 人</text>
        </view>

        <text class="created">发布于 {{ fmtFull(card.created_at) }}</text>
      </view>

      <!-- 发布者视角：谁申请了 -->
      <view class="main-card" v-if="card.is_mine">
        <text class="section-title">收到的申请（{{ applyState.pending_count || 0 }}）</text>
        <view class="applicant" v-for="a in applyState.applications" :key="a._id">
          <view class="applicant-top">
            <view class="avatar avatar--sm">{{ (a.applicant.nickname || '同').slice(0, 1) }}</view>
            <view class="applicant-main">
              <view class="name-row">
                <text class="name">{{ a.applicant.nickname }}</text>
                <text class="verified" v-if="a.applicant.is_verified">✔</text>
              </view>
              <text class="meta">{{ a.applicant.school || '未填学校' }} · 信誉 {{ a.applicant.credit_score }}</text>
            </view>
          </view>
          <text class="applicant-msg" v-if="a.message">「{{ a.message }}」</text>

          <!-- 还没处理：给出同意/婉拒 -->
          <view class="applicant-btns" v-if="a.status === 'pending'">
            <button class="btn btn--ghost" @tap="decide(a, 'reject')">婉拒</button>
            <button class="btn btn--sm" @tap="decide(a, 'accept')">同意，成为搭子</button>
          </view>

          <!-- 已同意：发布者也要能进这个会话，否则同意完就没地方说话了 -->
          <view class="applicant-btns" v-else-if="a.status === 'accepted'">
            <text class="applicant-done">已同意 · 已成为搭子</text>
            <button class="btn btn--sm" v-if="a.conversation_id" @tap="goChatWith(a)">去聊聊</button>
          </view>

          <!-- 已婉拒 -->
          <view class="applicant-btns" v-else>
            <text class="applicant-done applicant-done--muted">已婉拒</text>
          </view>
        </view>
        <text class="empty-inline" v-if="!applyState.applications.length">
          还没有人申请。再等等，或者去大厅看看别人的需求。
        </text>
      </view>
    </block>

    <!-- 底部操作条 -->
    <view class="action-bar" v-if="card && !card.is_mine">
      <text class="action-reason" v-if="!applyState.can_apply">{{ applyState.reason }}</text>
      <button class="btn btn--wide" v-else @tap="openApply">我想搭 · 申请</button>
      <button
        class="btn btn--wide btn--ghost"
        v-if="applyState.my_application && applyState.my_application.status === 'pending'"
        @tap="cancelApply"
      >
        撤回申请
      </button>
      <button class="btn btn--wide" v-if="canChat" @tap="goChat">去聊聊</button>
    </view>

    <!-- 同意申请后的「设置搭子标签」弹层 -->
    <!--
      为什么要有这个弹层：同意申请是**双方**建立搭子关系的时刻，
      但此前只有「接受他人邀请」那条路径会让我起名，「同意别人的申请」这条不会，
      于是就出现：配上了 → 聊天栏里对方没有任何标签 → 用户以为关系没建成功。
      这里只让我起**我自己**给对方的名字；对方那一侧属于对方的私有备注，我无权设置。
    -->
    <view class="mask" v-if="showLabel" @tap="skipLabel"></view>
    <view class="sheet" v-if="showLabel">
      <text class="sheet-title">成为搭子了，给 TA 起个名</text>
      <text class="sheet-sub">{{ labelTargetName || '对方' }} 通过了你的同意</text>

      <text class="sheet-label">你打算叫 TA 什么？（可跳过）</text>
      <view class="input-row">
        <input
          class="input"
          v-model="labelDraft"
          :maxlength="MAX_LABEL_LEN"
          placeholder="比如：自习、夜跑"
          @input="onLabelInput"
        />
        <text class="input-suffix">搭子</text>
      </view>
      <text class="sheet-hint">{{ labelDraft.length }}/{{ MAX_LABEL_LEN }} 字，加上「搭子」共 8 字</text>

      <text class="sheet-label">给它一个颜色</text>
      <view class="swatches">
        <view
          v-for="k in COLOR_KEYS"
          :key="k"
          class="swatch"
          :class="{ 'swatch--on': labelColor === k }"
          :style="{ backgroundColor: colorHex(k) }"
          @tap="labelColor = k"
        ></view>
      </view>

      <view class="sheet-btns">
        <button class="btn btn--ghost" @tap="skipLabel">先不起名</button>
        <button class="btn" @tap="confirmLabel">就叫这个</button>
      </view>
    </view>

    <!-- 申请弹层 -->
    <view class="mask" v-if="showApply" @tap="showApply = false"></view>
    <view class="sheet" v-if="showApply">
      <text class="sheet-title">说一句话，让对方知道你是谁</text>
      <textarea
        class="sheet-input"
        v-model="applyMessage"
        placeholder="例如：我也在准备考研，每天晚上 7 点图书馆三楼"
        maxlength="100"
      />
      <text class="sheet-count">{{ applyMessage.length }}/100</text>
      <view class="sheet-btns">
        <button class="btn btn--ghost" @tap="showApply = false">再想想</button>
        <button class="btn" @tap="submitApply" :disabled="submitting">
          {{ submitting ? '提交中…' : '发送申请' }}
        </button>
      </view>
    </view>
  </view>
</template>

<script>
const TYPE_LABEL = {
  study: '学习',
  fitness: '健身',
  photo: '拍照',
  meal: '吃饭',
  sport: '运动',
  other: '其他'
}

const STATUS_LABEL = {
  open: '招募中',
  matched: '已匹配',
  closed: '已关闭',
  removed: '已下架'
}

export default {
  data() {
    return {
      id: '',
      card: null,
      applyState: {
        can_apply: false,
        reason: '',
        my_application: null,
        pending_count: 0,
        applications: []
      },
      loading: false,
      errMsg: '',
      showApply: false,
      // ---- 同意申请后的标签弹层 ----
      showLabel: false,
      labelDraft: '',
      labelColor: 'shine-yellow',
      labelTargetName: '',
      // 正在处理的那条申请（弹层确认后要回传给 card-apply）
      pendingApp: null,
      // 8 个预设色 key —— 必须与 buddy-tag 的 COLORS 一致。
      // 不能把 TAG_COLORS 放 data 里以外的地方直接给模板用，模板只能访问实例上的东西。
      COLOR_KEYS: [
        'shine-yellow',
        'shine-orange',
        'shine-rose',
        'shine-violet',
        'shine-cyan',
        'shine-mint',
        'shine-blue',
        'shine-gold'
      ],
      MAX_LABEL_LEN: 6,
      applyMessage: '',
      submitting: false
    }
  },
  computed: {
    hasTimePlace() {
      const c = this.card
      if (!c) return false
      return !!(c.location_name || c.start_time)
    },
    canChat() {
      const a = this.applyState.my_application
      return !!(a && a.status === 'accepted')
    }
  },
  onLoad(options) {
    this.id = (options && options.id) || ''
    if (!this.id) {
      this.errMsg = '缺少卡片 id'
      return
    }
    this.fetch()
  },
  onPullDownRefresh() {
    this.fetch().then(() => uni.stopPullDownRefresh())
  },
  methods: {
    typeLabel(k) {
      return TYPE_LABEL[k] || '其他'
    },
    statusLabel(k) {
      return STATUS_LABEL[k] || k
    },

    fmtFull(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      return (
        d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
      )
    },

    fmtRange(start, end) {
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      const d = new Date(start)
      let s = d.getMonth() + 1 + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes())
      if (end && end > start) {
        const e = new Date(end)
        s += ' – ' + p(e.getHours()) + ':' + p(e.getMinutes())
      }
      return s
    },

    async fetch() {
      this.loading = true
      try {
        const res = await uniCloud.callFunction({
          name: 'card-detail',
          data: { token: uni.getStorageSync('token') || '', card_id: this.id }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          this.errMsg = r.msg || '加载失败'
          this.card = null
          return
        }
        this.card = r.data.card
        this.applyState = r.data.apply_state || this.applyState
      } catch (e) {
        this.errMsg = '云函数 card-detail 调用失败：' + (e.message || '检查是否已部署')
        this.card = null
      } finally {
        this.loading = false
      }
    },

    openApply() {
      this.applyMessage = ''
      this.showApply = true
    },

    async submitApply() {
      if (this.submitting) return
      this.submitting = true
      try {
        const res = await uniCloud.callFunction({
          name: 'card-apply',
          data: {
            action: 'apply',
            token: uni.getStorageSync('token') || '',
            card_id: this.id,
            message: this.applyMessage
          }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '申请失败', icon: 'none', duration: 2500 })
          return
        }
        this.showApply = false
        uni.showToast({ title: '申请已发送', icon: 'success' })
        this.fetch()
      } catch (e) {
        uni.showToast({ title: '调用 card-apply 失败，检查是否已部署', icon: 'none', duration: 2500 })
      } finally {
        this.submitting = false
      }
    },

    async cancelApply() {
      const a = this.applyState.my_application
      if (!a) return
      const res = await uniCloud.callFunction({
        name: 'card-apply',
        data: { action: 'cancel', token: uni.getStorageSync('token') || '', application_id: a._id }
      })
      const r = res.result || {}
      if (r.code !== 0) {
        uni.showToast({ title: r.msg || '撤回失败', icon: 'none' })
        return
      }
      uni.showToast({ title: '已撤回', icon: 'none' })
      this.fetch()
    },

    /**
     * 同意或婉拒一条申请。
     *
     * ★ 同意时**不直接调云函数**，而是先把标签弹层拉起来：
     *   同意申请 = 双方建立搭子关系的唯一时刻（卡片配对这条路径），
     *   错过这一刻，用户下次想给这个搭子起名就得绕去「我的搭子」页。
     *   而且此前这条路径压根没有起名入口，导致聊天栏里对方一个标签都没有。
     *   婉拒没有后续语义，仍然直接调用。
     */
    decide(a, action) {
      if (action === 'accept') {
        this.pendingApp = a
        this.labelDraft = ''
        this.labelColor = 'shine-yellow'
        const who = (a && a.applicant) || null
        this.labelTargetName = (who && (who.nickname || who.name)) || ''
        this.showLabel = true
        return
      }
      this.submitDecide(a, 'reject', '', '')
    },

    /** 标签弹层：输入清洗 —— 去掉用户自己带的「搭子」后缀，与云函数 cleanLabel 一致 */
    onLabelInput(e) {
      let v = (e && e.detail ? e.detail.value : '') || ''
      if (v.length > this.MAX_LABEL_LEN && v.slice(-2) === '搭子') {
        v = v.slice(0, -2)
      }
      this.labelDraft = v.slice(0, this.MAX_LABEL_LEN)
    },

    /** 预设色 → 十六进制。必须走 methods，模板访问不到 script 顶层常量。 */
    colorHex(k) {
      const M = {
        'shine-yellow': '#FFD84D',
        'shine-orange': '#FF9F45',
        'shine-rose': '#FF6B8A',
        'shine-violet': '#B47CFF',
        'shine-cyan': '#3FD8E0',
        'shine-mint': '#4FE0A8',
        'shine-blue': '#5B9BFF',
        'shine-gold': '#E8B94A'
      }
      return M[k] || '#FFD84D'
    },

    /** 弹层：跳过着色，直接同意 */
    skipLabel() {
      const a = this.pendingApp
      this.showLabel = false
      if (!a) return
      this.submitDecide(a, 'accept', '', '')
    },

    /** 弹层：带着名字和颜色同意 */
    confirmLabel() {
      const a = this.pendingApp
      const label = (this.labelDraft || '').trim()
      if (!label) {
        uni.showToast({ title: '先起个名，或者点「先不起名」', icon: 'none' })
        return
      }
      this.showLabel = false
      if (!a) return
      this.submitDecide(a, 'accept', label, this.labelColor)
    },

    /** 真正调用 card-apply。label / color 只在 accept 且非空时才传。 */
    async submitDecide(a, action, label, color) {
      const payload = {
        action,
        token: uni.getStorageSync('token') || '',
        application_id: a._id
      }
      if (action === 'accept' && label) {
        payload.label = label
        payload.color = color
      }

      const res = await uniCloud.callFunction({ name: 'card-apply', data: payload })
      const r = res.result || {}
      if (r.code !== 0) {
        uni.showToast({ title: r.msg || '操作失败', icon: 'none', duration: 2500 })
        return
      }
      this.pendingApp = null
      if (action === 'accept') {
        uni.showToast({ title: '配对成功，去消息里聊聊', icon: 'none', duration: 2000 })
      } else {
        uni.showToast({ title: '已婉拒', icon: 'none' })
      }
      this.fetch()
    },

    // 申请人视角：「去聊聊」。会话 id 来自 card-detail 的 apply_state.my_application
    goChat() {
      const st = this.applyState || {}
      const a = st.my_application
      if (!a || !a.conversation_id) {
        uni.showToast({ title: '还没建立会话，先等对方同意', icon: 'none', duration: 2000 })
        return
      }
      this.enterChat(a.conversation_id)
    },

    // 发布者视角：某一条申请对应的会话。会话 id 来自 applications[].conversation_id
    goChatWith(a) {
      if (!a || !a.conversation_id) {
        uni.showToast({ title: '会话还没建好，稍后再试', icon: 'none', duration: 2000 })
        return
      }
      // 发布者点的是「某一条申请」，对方就是这条申请的申请人
      this.enterChat(a.conversation_id, a.applicant || {})
    },

    // 两个视角共用的跳转。
    // 申请人视角对方是 card.owner；发布者视角对方是那条申请的 applicant，
    // 由调用方传进来（详情页可能同时有多个申请人，不能从卡片上取）。
    enterChat(convId, peer) {
      const card = (this.data && this.data.card) || {}
      const other = peer && peer._id ? peer : card.owner || {}
      const q =
        'conversation_id=' + encodeURIComponent(convId) +
        '&name=' + encodeURIComponent(other.nickname || '') +
        '&school=' + encodeURIComponent(other.school || '') +
        // 聊天页要用它做"点头像进主页"
        '&peer_id=' + encodeURIComponent(other._id || '')
      uni.navigateTo({ url: '/pages/chat/chat?' + q })
    },

    goBack() {
      uni.navigateBack({
        fail() {
          uni.reLaunch({ url: '/pages/hall/hall' })
        }
      })
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 24rpx 24rpx 180rpx;
  box-sizing: border-box;
}

/* —— 状态 —— */
.state-box {
  background-color: var(--tf-card);
  border-radius: 20rpx;
  padding: 80rpx 40rpx;
  text-align: center;
}
.state-title {
  display: block;
  font-size: 34rpx;
  font-weight: 600;
  color: var(--tf-text);
  margin-bottom: 16rpx;
}
.state-text {
  font-size: 28rpx;
  color: var(--tf-text-3);
}
.state-hint {
  display: block;
  font-size: 26rpx;
  color: var(--tf-text-3);
  line-height: 1.6;
  margin-bottom: 36rpx;
}

/* —— 发布者 —— */
.owner-card {
  display: flex;
  align-items: center;
  background-color: var(--tf-card);
  border-radius: 20rpx;
  padding: 28rpx;
  margin-bottom: 20rpx;
}
.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background-color: var(--tf-primary-soft);
  color: var(--tf-primary);
  font-size: 36rpx;
  font-weight: 600;
  text-align: center;
  line-height: 88rpx;
  margin-right: 20rpx;
  flex-shrink: 0;
}
.avatar--sm {
  width: 64rpx;
  height: 64rpx;
  font-size: 28rpx;
  line-height: 64rpx;
  margin-right: 16rpx;
}
.owner-main {
  flex: 1;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
}
.name {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-text);
  margin-right: 12rpx;
}
.verified {
  font-size: 20rpx;
  color: var(--tf-success);
  background-color: rgba(18, 183, 106, 0.1);
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}
.meta {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-3);
  margin-top: 6rpx;
}
.bio {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-2);
  margin-top: 8rpx;
}
.credit {
  text-align: center;
  flex-shrink: 0;
  padding-left: 16rpx;
}
.credit-num {
  display: block;
  font-size: 40rpx;
  font-weight: 700;
  color: var(--tf-primary);
  line-height: 1.1;
}
.credit-label {
  font-size: 20rpx;
  color: var(--tf-text-3);
}

/* —— 正文 —— */
.main-card {
  background-color: var(--tf-card);
  border-radius: 20rpx;
  padding: 32rpx 28rpx;
  margin-bottom: 20rpx;
}
.type-row {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}
.type-tag {
  font-size: 22rpx;
  color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
  padding: 6rpx 16rpx;
  border-radius: 8rpx;
  margin-right: 12rpx;
}
.status-tag {
  font-size: 22rpx;
  color: var(--tf-text-2);
  background-color: var(--tf-bg);
  padding: 6rpx 16rpx;
  border-radius: 8rpx;
  margin-right: 12rpx;
}
.status-tag--open {
  color: var(--tf-success);
  background-color: rgba(18, 183, 106, 0.1);
}
.status-tag--removed {
  color: var(--tf-danger, #e5484d);
  background-color: rgba(229, 72, 77, 0.1);
}
.mine-tag {
  font-size: 22rpx;
  color: var(--tf-text-3);
}
.title {
  display: block;
  font-size: 38rpx;
  font-weight: 700;
  color: var(--tf-text);
  line-height: 1.4;
  margin-bottom: 16rpx;
}
.desc {
  display: block;
  font-size: 29rpx;
  color: var(--tf-text-2);
  line-height: 1.7;
  white-space: pre-wrap;
}

.section {
  margin-top: 32rpx;
  padding-top: 28rpx;
  border-top: 2rpx solid var(--tf-line);
}
.section-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--tf-text);
  margin-bottom: 18rpx;
}
.info-line {
  display: block;
  font-size: 27rpx;
  color: var(--tf-text-2);
  line-height: 1.9;
}
.created {
  display: block;
  font-size: 23rpx;
  color: var(--tf-text-3);
  margin-top: 28rpx;
}

/* —— 标签 —— */
.tags {
  display: flex;
  flex-wrap: wrap;
}
.tag {
  font-size: 24rpx;
  color: var(--tf-text-2);
  background-color: var(--tf-bg);
  padding: 8rpx 18rpx;
  border-radius: 8rpx;
  margin: 0 12rpx 12rpx 0;
}
.tag--hit {
  color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
  font-weight: 600;
}

/* —— 重合度 —— */
.common-box {
  margin-top: 28rpx;
  background-color: var(--tf-primary-soft);
  border-radius: 16rpx;
  padding: 24rpx;
}
.common-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--tf-primary);
  margin-bottom: 16rpx;
}
.common-box .tag--hit {
  background-color: rgba(255, 255, 255, 0.85);
}

/* —— 申请人 —— */
.applicant {
  padding: 24rpx 0;
  border-bottom: 2rpx solid var(--tf-line);
}
.applicant:last-child {
  border-bottom: none;
}
.applicant-top {
  display: flex;
  align-items: center;
}
.applicant-main {
  flex: 1;
  min-width: 0;
}
.applicant-msg {
  display: block;
  font-size: 26rpx;
  color: var(--tf-text-2);
  line-height: 1.6;
  margin: 16rpx 0 0 80rpx;
}
.applicant-btns {
  display: flex;
  align-items: center;
  margin: 20rpx 0 0 80rpx;
}
/* 已处理（已同意 / 已婉拒）的提示文字，替代原来的两个按钮 */
.applicant-done {
  flex: 1;
  font-size: 25rpx;
  color: var(--tf-success);
  line-height: 1.6;
}
.applicant-done--muted {
  color: var(--tf-text-3);
}
.empty-inline {
  display: block;
  font-size: 25rpx;
  color: var(--tf-text-3);
  line-height: 1.7;
}

/* —— 底部操作条 —— */
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--tf-card);
  border-top: 2rpx solid var(--tf-line);
  padding: 20rpx 24rpx;
  padding-bottom: calc(20rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  z-index: 10;
}
.action-reason {
  display: block;
  font-size: 26rpx;
  color: var(--tf-text-3);
  text-align: center;
  line-height: 88rpx;
}

/* —— 按钮 —— */
.btn {
  background-color: var(--tf-primary);
  color: #fff;
  font-size: 29rpx;
  border-radius: 14rpx;
  line-height: 84rpx;
  height: 84rpx;
  margin: 0;
}
.btn::after {
  border: none;
}
.btn--wide {
  width: 100%;
  margin-bottom: 12rpx;
}
.btn--wide:last-child {
  margin-bottom: 0;
}
.btn--ghost {
  background-color: var(--tf-bg);
  color: var(--tf-text-2);
}
.btn--sm {
  flex: 1;
  margin-left: 16rpx;
  font-size: 27rpx;
  line-height: 76rpx;
  height: 76rpx;
}
.applicant-btns .btn--ghost {
  flex: 0 0 160rpx;
  margin-left: 0;
  font-size: 27rpx;
  line-height: 76rpx;
  height: 76rpx;
}

/* —— 弹层 —— */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.45);
  z-index: 20;
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--tf-card);
  border-radius: 28rpx 28rpx 0 0;
  padding: 36rpx 28rpx;
  padding-bottom: calc(36rpx + env(safe-area-inset-bottom));
  z-index: 21;
}
.sheet-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
  margin-bottom: 20rpx;
}
.sheet-input {
  width: 100%;
  height: 200rpx;
  background-color: var(--tf-bg);
  border-radius: 14rpx;
  padding: 20rpx;
  font-size: 28rpx;
  color: var(--tf-text);
  box-sizing: border-box;
}
.sheet-count {
  display: block;
  text-align: right;
  font-size: 22rpx;
  color: var(--tf-text-3);
  margin-top: 10rpx;
}
.sheet-btns {
  display: flex;
  margin-top: 20rpx;
}
.sheet-btns .btn {
  flex: 1;
}
.sheet-btns .btn:first-child {
  margin-right: 16rpx;
}
/* ===== 同意申请后的标签弹层 =====
   与 messages.vue 的接受邀请弹层保持完全一致的视觉与尺寸，
   避免用户在同一件事上看到两套长得不一样的界面。 */
.sheet-sub {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  color: var(--tf-text-2);
  line-height: 1.5;
}
.sheet-label {
  display: block;
  margin-top: 26rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: var(--tf-text-2);
}
.sheet-hint {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--tf-text-3);
}
.input-row {
  display: flex;
  align-items: center;
  margin-top: 12rpx;
  border: 3rpx solid var(--tf-text);
  border-radius: 16rpx;
  background: var(--tf-bg);
  padding: 0 20rpx;
  height: 84rpx;
}
.input {
  flex: 1;
  font-size: 28rpx;
  color: var(--tf-text);
}
.input-suffix {
  flex: none;
  font-size: 28rpx;
  font-weight: 800;
  color: var(--tf-primary);
  margin-left: 8rpx;
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 14rpx;
}
.swatch {
  width: 64rpx;
  height: 64rpx;
  border: 3rpx solid var(--tf-text);
  border-radius: 32rpx;
  box-shadow: 3rpx 3rpx 0 var(--tf-text);
}
.swatch--on {
  border-width: 5rpx;
  transform: scale(1.12);
}
.sheet-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 34rpx;
}
</style>
