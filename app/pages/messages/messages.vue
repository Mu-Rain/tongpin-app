<template>
  <view class="page">
    <view class="screen-body">
      <!-- ===== 情绪引导机器人入口（对齐原型 .ai-entry，黄底） ===== -->
      <view class="ai-entry" @tap="goAi">
        <view class="avatar avatar--orange">AI</view>
        <view class="convo-main">
          <view class="convo-top">
            <text class="convo-name">情绪引导机器人</text>
            <text class="mono muted">随时</text>
          </view>
          <text class="convo-last">看起来有点心事？聊两句吧（非医疗建议）</text>
        </view>
        <text class="badge mono">独立聊天框</text>
      </view>

      <!-- ===== 收到的搭子邀请 =====
           丙方案：一对人可以有多个搭子，但只占一条会话。
           所以别人邀请你做第 2、第 3 个搭子时，在会话列表里是"看不见"的 ——
           必须有这块独立的入口，否则邀请发出去对方永远不知道。 -->
      <view v-if="invites.length" class="invite-block">
        <view class="invite-head">
          <text class="invite-title">搭子邀请</text>
          <text class="invite-count">{{ invites.length }} 个待处理</text>
        </view>

        <view v-for="iv in invites" :key="iv.invite_id" class="invite-card">
          <view class="invite-top">
            <view class="avatar">{{ (iv.from_name || '同').slice(0, 1) }}</view>
            <view class="invite-main">
              <text class="invite-name">{{ iv.from_name || '有人' }}</text>
              <!-- ★ 这里不显示对方起的搭子标签。
                   搭子标签是私有备注：谁起的只有谁看得见，
                   别人发来的邀请里那个名字属于对方，我无权查看。
                   所以只按类型说「想和你做学习搭子」，不暴露对方备注。 -->
              <text class="invite-say">想和你做{{ categoryLabel(iv.category) }}</text>
            </view>
          </view>
          <text v-if="iv.message" class="invite-msg">「{{ iv.message }}」</text>
          <view class="invite-btns">
            <button class="btn btn--sm btn--plain" @tap="decideInvite(iv, 'reject')">婉拒</button>
            <button class="btn btn--sm" @tap="openAccept(iv)">接受</button>
          </view>
        </view>
      </view>

      <!-- ===== 会话列表 ===== -->
      <view v-if="loading" class="hint">正在加载…</view>

      <view v-else-if="!conversations.length" class="empty">
        <text class="empty-title">还没有聊过天</text>
        <text class="empty-desc">去搭子大厅找个人，申请通过后就能开聊</text>
        <button class="btn" @tap="goHall">去搭子大厅 →</button>
      </view>

      <view v-else>
        <view
          v-for="c in conversations"
          :key="c.conversation_id"
          class="convo"
          @tap="openChat(c)"
        >
          <view class="avatar">{{ c.avatar || (c.name || '同').slice(0, 1) }}</view>
          <view class="convo-main">
            <view class="convo-top">
              <text class="convo-name">{{ c.name }}</text>
              <text class="mono muted">{{ fmtTime(c.last_at) }}</text>
            </view>
            <text class="convo-last">{{ c.last_text }}</text>
            <view class="convo-meta">
              <!-- 多搭子：同一对人可能有多段关系，标签要全部显示（合成一张卡） -->
              <block v-if="c.buddy_tags && c.buddy_tags.length">
                <text
                  v-for="(t, ti) in c.buddy_tags"
                  :key="ti"
                  class="shiny-tag"
                  :style="{ backgroundColor: colorHex(t.color) }"
                  >{{ tagText(t.label) }}</text
                >
              </block>
              <text
                v-else-if="c.buddy_tag"
                class="shiny-tag"
                :style="{ backgroundColor: colorHex(c.buddy_tag_color) }"
                >{{ tagText(c.buddy_tag) }}</text
              >
              <text v-if="c.school" class="tag">{{ c.school }}</text>
            </view>
          </view>
          <text v-if="c.unread > 0" class="unread">{{ c.unread > 99 ? '99+' : c.unread }}</text>
        </view>
      </view>

      <button class="btn btn--block" @tap="goBuddy">我的搭子与标签 →</button>
    </view>

    <!-- ===== 接受邀请：先给对方起个名（可跳过） =====
         搭子标签是私有备注（我起的只我能看见、对方起的只对方能看见），
         所以这里只让我起**我自己**给对方的名字；
         对方在邀请里写的那个名字不会展示给我，也不在下面回显。 -->
    <view v-if="accepting" class="mask" @tap="closeAccept">
      <view class="sheet" @tap.stop>
        <text class="sheet-title">接受邀请</text>
        <text class="sheet-sub"
          >{{ accepting.from_name || '对方' }} 想和你做{{ categoryLabel(accepting.category) }}</text
        >

        <text class="sheet-label">你打算叫 TA 什么？（可跳过）</text>
        <view class="input-row">
          <input
            class="input"
            v-model="acceptLabel"
            :maxlength="MAX_LABEL_LEN"
            placeholder="比如：自习、夜跑"
            @input="onAcceptLabelInput"
          />
          <text class="input-suffix">搭子</text>
        </view>
        <text class="sheet-hint">{{ acceptLabel.length }}/{{ MAX_LABEL_LEN }} 字，加上「搭子」共 8 字</text>

        <text class="sheet-label">给它一个颜色</text>
        <view class="swatches">
          <!--
            这里不能写 TAG_COLORS[k]：TAG_COLORS 是 script 顶层的 const，
            不在 data() 里，模板访问不到，会抛
            「Property "TAG_COLORS" was accessed during render but is not defined on instance」，
            整个渲染函数崩掉 → 页面白屏。
            必须走 methods 里的 colorHex()，它在实例上，模板能访问。
          -->
          <view
            v-for="k in COLOR_KEYS"
            :key="k"
            class="swatch"
            :class="{ 'swatch--on': acceptColor === k }"
            :style="{ backgroundColor: colorHex(k) }"
            @tap="acceptColor = k"
          />
        </view>

        <view class="sheet-btns">
          <button class="btn btn--plain" @tap="closeAccept">取消</button>
          <button class="btn" @tap="submitAccept(false)">接受，先不起名</button>
          <button class="btn btn--primary" @tap="submitAccept(true)">接受并存名</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
/** 闪亮预设色（与原型 TAG_COLORS 一致） */
const TAG_COLORS = {
  'shine-yellow': '#ffde00',
  'shine-orange': '#ff4d00',
  'shine-rose': '#ff5fa2',
  'shine-violet': '#a855f7',
  'shine-cyan': '#22d3ee',
  'shine-mint': '#34d399',
  'shine-blue': '#3b82f6',
  'shine-gold': '#e9c46a'
}

export default {
  data() {
    return {
      conversations: [],
      loading: true,
      // 收到的待处理邀请（丙方案：不会出现在会话列表里，所以单独拉）
      invites: [],

      // 接受邀请弹层
      accepting: null, // 正在处理的邀请对象
      acceptLabel: '', // 我给对方起的标签（前缀，不含"搭子"）
      acceptColor: 'shine-yellow',
      MAX_LABEL_LEN: 6,
      COLOR_KEYS: [
        'shine-yellow',
        'shine-orange',
        'shine-rose',
        'shine-violet',
        'shine-cyan',
        'shine-mint',
        'shine-blue',
        'shine-gold'
      ]
    }
  },

  onShow() {
    // 每次进这个页面都刷一次：从聊天页返回时未读数要立刻更新
    this.loadList()
  },

  onPullDownRefresh() {
    this.loadList().then(() => uni.stopPullDownRefresh())
  },

  methods: {
    async loadList() {
      const token = uni.getStorageSync('token')
      if (!token) {
        this.loading = false
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'message-conversations',
          data: { token: token }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '加载失败', icon: 'none' })
          this.loading = false
          return
        }
        this.conversations = (r.data && r.data.list) || []
      } catch (e) {
        uni.showToast({ title: '网络不太好', icon: 'none' })
      } finally {
        this.loading = false
      }
      // 邀请单独拉，失败不影响会话列表（少一块不等于整页崩）
      this.loadInvites()
    },

    async loadInvites() {
      const token = uni.getStorageSync('token')
      if (!token) return
      try {
        const res = await uniCloud.callFunction({
          name: 'buddy-invite',
          data: { token: token, action: 'list', box: 'in' }
        })
        const r = res.result || {}
        if (r.code === 0) {
          this.invites = (r.data && r.data.list) || []
        }
      } catch (e) {
        /* 静默失败 */
      }
    },

    async decideInvite(iv, action) {
      const token = uni.getStorageSync('token')
      if (!token) return
      try {
        const res = await uniCloud.callFunction({
          name: 'buddy-invite',
          data: { token: token, action: action, invite_id: iv.invite_id }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '操作失败', icon: 'none' })
          return
        }
        uni.showToast({
          title: action === 'accept' ? '已成为搭子' : '已婉拒',
          icon: 'none'
        })
        // 从本地列表摘掉，不必等整页刷新
        this.invites = this.invites.filter((x) => x.invite_id !== iv.invite_id)
        if (action === 'accept') this.loadList()
      } catch (e) {
        uni.showToast({ title: '网络不太好', icon: 'none' })
      }
    },

    // ---- 接受邀请：先让用户给对方起个名 ----
    openAccept(iv) {
      this.accepting = iv
      this.acceptLabel = ''
      this.acceptColor = 'shine-yellow'
    },

    closeAccept() {
      this.accepting = null
      this.acceptLabel = ''
    },

    // 用户可能把「搭子」两个字也打进去，实时剥掉，避免「自习搭子搭子」
    onAcceptLabelInput(e) {
      let v = (e.detail && e.detail.value) || ''
      v = v.replace(/\s/g, '')
      if (v.length > this.MAX_LABEL_LEN && v.slice(-2) === '搭子') {
        v = v.slice(0, -2)
      }
      this.acceptLabel = v.slice(0, this.MAX_LABEL_LEN)
    },

    async submitAccept(withLabel) {
      const iv = this.accepting
      if (!iv) return
      if (withLabel && !this.acceptLabel.trim()) {
        uni.showToast({ title: '先起个名，或者选「先不起名」', icon: 'none' })
        return
      }

      const token = uni.getStorageSync('token')
      if (!token) return

      const payload = {
        token: token,
        action: 'accept',
        invite_id: iv.invite_id
      }
      if (withLabel) {
        payload.label = this.acceptLabel.trim()
        payload.color = this.acceptColor
      }

      try {
        const res = await uniCloud.callFunction({ name: 'buddy-invite', data: payload })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '操作失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        this.closeAccept()
        this.invites = this.invites.filter((x) => x.invite_id !== iv.invite_id)
        uni.showToast({ title: '已成为搭子', icon: 'none' })
        this.loadList()

        // 建好后直接进聊天，省一次找会话
        if (d.conversation_id) {
          setTimeout(() => {
            uni.navigateTo({
              url:
                '/pages/chat/chat?conversation_id=' +
                encodeURIComponent(d.conversation_id) +
                '&name=' +
                encodeURIComponent(iv.from_name || '') +
                '&peer_id=' +
                encodeURIComponent(iv.from_user_id || '')
            })
          }, 400)
        }
      } catch (e) {
        uni.showToast({ title: '网络不太好', icon: 'none' })
      }
    },

    colorHex(name) {
      return TAG_COLORS[name] || '#ffde00'
    },

    // 搭子标签的固定形状是「前缀 + 搭子」，搭子两个字不能由用户填。
    // 数据库里只存前缀（buddy_relations.label_a / label_b），显示时统一补后缀。
    // 已经带了后缀的老数据要防重复，不然会出现「啊哈哈搭子搭子」。
    tagText(raw) {
      const s = String(raw || '').trim()
      if (!s) return ''
      return s.slice(-2) === '搭子' ? s : s + '搭子'
    },

    // 邀请里的「想和你做 ___ 搭子」，只能按**类型**说，不能说对方起的名字。
    // 搭子标签是私有备注：对方在邀请里填的那个名字属于对方，我无权查看。
    categoryLabel(cat) {
      const map = {
        study: '学习搭子',
        fitness: '健身搭子',
        photo: '拍照搭子',
        meal: '吃饭搭子',
        sport: '运动搭子',
        other: '搭子'
      }
      return map[String(cat || 'other')] || '搭子'
    },

    fmtTime(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      const now = new Date()
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      if (sameDay) {
        return (
          String(d.getHours()).padStart(2, '0') +
          ':' +
          String(d.getMinutes()).padStart(2, '0')
        )
      }
      const y = new Date(now.getTime() - 86400000)
      const isYesterday =
        d.getFullYear() === y.getFullYear() &&
        d.getMonth() === y.getMonth() &&
        d.getDate() === y.getDate()
      if (isYesterday) return '昨天'
      return d.getMonth() + 1 + '/' + d.getDate()
    },

    openChat(c) {
      // 多搭子：把全部标签用「前缀|颜色」拼成逗号串传给聊天页，
      // 让它顶部也能并排显示多个标签，而不是只有一个。
      const allTags = (c.buddy_tags && c.buddy_tags.length
        ? c.buddy_tags
        : c.buddy_tag
        ? [{ label: c.buddy_tag, color: c.buddy_tag_color }]
        : []
      )
        .map((t) => (t.label || '') + '|' + (t.color || ''))
        .join(',')

      const q =
        'conversation_id=' + encodeURIComponent(c.conversation_id) +
        '&name=' + encodeURIComponent(c.name || '') +
        '&avatar=' + encodeURIComponent(c.avatar || '') +
        '&school=' + encodeURIComponent(c.school || '') +
        '&tag=' + encodeURIComponent(c.buddy_tag || '') +
        '&color=' + encodeURIComponent(c.buddy_tag_color || '') +
        '&tags=' + encodeURIComponent(allTags) +
        // 聊天页要用它做"点头像进主页"
        '&peer_id=' + encodeURIComponent(c.other_user_id || '')
      uni.navigateTo({ url: '/pages/chat/chat?' + q })
    },

    goAi() {
      uni.navigateTo({ url: '/pages/chat/chat?conversation_id=ai' })
    },

    goHall() {
      uni.navigateTo({ url: '/pages/hall/hall' })
    },

    goBuddy() {
      uni.navigateTo({ url: '/pages/buddy/buddy' })
    }
  }
}
</script>

<style scoped>
/* ---------- 收到的搭子邀请 ---------- */
.invite-block {
  background-color: var(--tf-card);
  border-radius: 24rpx;
  padding: 24rpx;
  margin-bottom: 24rpx;
  border: 2rpx solid var(--tf-primary);
}
.invite-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}
.invite-title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.invite-count {
  font-size: 22rpx;
  color: var(--tf-primary);
}
.invite-card {
  padding: 18rpx 0;
  border-top: 2rpx solid var(--tf-line);
}
.invite-top {
  display: flex;
  align-items: center;
}
.invite-main {
  margin-left: 18rpx;
  flex: 1;
  min-width: 0;
}
.invite-name {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.invite-say {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-2);
  margin-top: 6rpx;
}
.invite-tag {
  font-size: 22rpx;
  font-weight: 700;
  color: #1f2329;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}
.invite-msg {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-3);
  line-height: 1.5;
  margin-top: 12rpx;
}
.invite-btns {
  display: flex;
  justify-content: flex-end;
  margin-top: 16rpx;
}
.invite-btns .btn {
  margin-left: 16rpx;
  margin-bottom: 0;
  width: auto;
  padding: 0 36rpx;
}
.btn--plain {
  background-color: var(--tf-bg);
  color: var(--tf-text-2);
}

.page {
  min-height: 100vh;
  background: var(--tf-bg);
}
.screen-body {
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.hint {
  text-align: center;
  color: var(--tf-text-3);
  font-size: 24rpx;
  padding: 60rpx 0;
}

/* —— AI 入口：黄底 + 硬阴影 —— */
.ai-entry {
  display: flex;
  align-items: center;
  gap: 20rpx;
  border: 3rpx solid var(--tf-text);
  background: #ffde00;
  box-shadow: 4rpx 4rpx 0 var(--tf-text);
  padding: 20rpx;
}

/* —— 会话卡片 —— */
.convo {
  display: flex;
  align-items: center;
  gap: 20rpx;
  border: 3rpx solid var(--tf-text);
  background: var(--tf-card);
  box-shadow: 4rpx 4rpx 0 var(--tf-text);
  padding: 20rpx;
  margin-bottom: 20rpx;
}
.avatar {
  width: 88rpx;
  height: 88rpx;
  border: 3rpx solid var(--tf-text);
  background: var(--tf-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 32rpx;
  flex: none;
}
.avatar--orange {
  background: var(--tf-primary);
  color: #fff;
  font-size: 24rpx;
}
.convo-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.convo-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12rpx;
}
.convo-name {
  font-weight: 800;
  font-size: 30rpx;
}
.mono {
  font-size: 20rpx;
  color: var(--tf-text-3);
  flex: none;
}
.muted {
  color: var(--tf-text-3);
}
.convo-last {
  font-size: 24rpx;
  color: var(--tf-text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.convo-meta {
  display: flex;
  align-items: center;
  gap: 10rpx;
  padding-top: 6rpx;
}
.shiny-tag {
  border: 3rpx solid var(--tf-text);
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  font-weight: 700;
}
.tag {
  border: 2rpx solid var(--tf-text);
  background: var(--tf-card);
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: var(--tf-text-2);
}

/* —— 未读红点 —— */
.unread {
  min-width: 40rpx;
  height: 40rpx;
  background: var(--tf-primary);
  color: #fff;
  border: 3rpx solid var(--tf-text);
  font-size: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  padding: 0 6rpx;
}

.badge {
  border: 2rpx solid var(--tf-text);
  background: var(--tf-card);
  padding: 2rpx 8rpx;
  font-size: 18rpx;
  flex: none;
}

/* —— 空状态 —— */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14rpx;
  padding: 60rpx 0;
}
.empty-title {
  font-weight: 800;
  font-size: 30rpx;
}
.empty-desc {
  font-size: 24rpx;
  color: var(--tf-text-3);
  text-align: center;
}

.btn {
  border: 3rpx solid var(--tf-text);
  background: var(--tf-card);
  box-shadow: 4rpx 4rpx 0 var(--tf-text);
  padding: 0 24rpx;
  height: 68rpx;
  line-height: 62rpx;
  font-size: 26rpx;
  font-weight: 700;
}
.btn--block {
  width: 100%;
  margin-top: 10rpx;
}

/* ===== 接受邀请弹层 ===== */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 200;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  background: var(--tf-card);
  border-top: 3rpx solid var(--tf-text);
  border-radius: 28rpx 28rpx 0 0;
  padding: 32rpx 28rpx 44rpx;
  max-height: 86vh;
  overflow-y: auto;
}
.sheet-title {
  display: block;
  font-size: 34rpx;
  font-weight: 800;
  color: var(--tf-text);
}
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
.btn--plain {
  background: var(--tf-bg);
  color: var(--tf-text-2);
  border-width: 2rpx;
}
.btn--primary {
  background: var(--tf-primary);
  color: #fff;
}
</style>
