<template>
  <view class="page">
    <!-- ===== 加载 / 失败 ===== -->
    <view v-if="loading" class="hint">正在加载…</view>
    <view v-else-if="err" class="hint hint--err">
      <text>{{ err }}</text>
      <button class="btn btn--sm" @tap="load">重试</button>
    </view>

    <block v-else>
      <!-- ===== 名片区 ===== -->
      <view class="profile">
        <view class="avatar-row">
          <image v-if="user.avatar" class="avatar avatar--img" :src="user.avatar" mode="aspectFill" />
          <view v-else class="avatar">{{ (user.nickname || '同').slice(0, 1) }}</view>

          <view class="profile-main">
            <view class="name-row">
              <text class="nickname">{{ user.nickname }}</text>
              <!-- 认证标：认证过的用户一眼能看出来 -->
              <text v-if="user.verified" class="badge badge--ok">✓ 已认证</text>
            </view>
            <text class="sub">{{ user.school || '未填写学校' }}</text>
            <view class="meta-row">
              <text class="credit" :class="'credit--' + creditLevel">信誉 {{ user.credit_label }}</text>
              <text v-if="user.grade" class="meta-item">{{ user.grade }}</text>
            </view>
          </view>
        </view>

        <text v-if="user.bio" class="bio">{{ user.bio }}</text>

        <!-- 称号 -->
        <view v-if="user.titles && user.titles.length" class="titles">
          <text v-for="(t, i) in user.titles" :key="i" class="title-chip">{{ t }}</text>
        </view>
      </view>

      <!-- ===== 主要操作 ===== -->
      <view class="actions">
        <button v-if="conversationId" class="btn" @tap="goChat">发消息</button>
        <button
          v-if="applyState.can_invite"
          class="btn btn--ghost"
          @tap="openInvite"
        >邀请做搭子</button>
        <view v-else-if="!applyState.is_self && applyState.reason" class="action-hint">
          {{ applyState.reason }}
        </view>
      </view>

      <!-- ===== 我们之间的搭子关系 ===== -->
      <view v-if="!applyState.is_self" class="card">
        <view class="card-head">
          <text class="card-title">你们之间的搭子</text>
          <text v-if="relationCount" class="card-count">{{ relationCount }} 段</text>
        </view>

        <view v-if="!relations.length" class="empty">
          还不是搭子。点上面的「邀请做搭子」，起个标签就能建立关系。
        </view>

        <view v-for="r in relations" :key="r.relation_id" class="rel-row">
          <view class="rel-tags">
            <!-- 只显示我给他起的。
                 搭子标签是私有备注：我起的别人看不见，别人起的我也看不见，
                 所以这里不显示 his_label（产品规则，见 docs 说明）。 -->
            <!-- 已起名：实心彩色标签 -->
            <text
              v-if="r.my_label"
              class="tag tag--mine"
              :style="{ backgroundColor: colorHex(r.my_label_color) }"
            >{{ tagText(r.my_label) }}</text>
            <!-- 没起名（Q2=1）：灰底 + 虚线框占位，点了直接去补名。
                 不用类别名顶替 —— 那会让人误以为「学习搭子」是自己起的名字，
                 实际只是关系类型，改不了、也不知道能改。 -->
            <text
              v-else
              class="tag tag--unnamed"
              @tap="editLabel(r)"
            >{{ r.category_label }} · 起个名</text>
          </view>
          <view class="rel-foot">
            <text class="rel-since">自 {{ fmtDate(r.since) }}</text>
            <text class="rel-cat">{{ r.category_label }}</text>
          </view>
        </view>

        <view v-if="relations.length" class="rel-note">
          同一对可以有多段搭子，但聊天只有一个窗口 —— 所有消息都在上面「发消息」里。
        </view>
      </view>

      <!-- ===== 共同标签 ===== -->
      <view v-if="common.count > 0" class="card">
        <view class="card-head">
          <text class="card-title">你们有 {{ common.count }} 个共同标签</text>
        </view>
        <view class="chips">
          <text v-for="t in common.tags" :key="t.tag_id" class="chip">{{ t.name }}</text>
        </view>
      </view>

      <!-- ===== 他在招募的卡 ===== -->
      <view v-if="cards.length" class="card">
        <view class="card-head">
          <text class="card-title">正在招搭子</text>
        </view>
        <view v-for="c in cards" :key="c.card_id" class="card-row" @tap="goCard(c.card_id)">
          <text class="card-row-type">{{ c.type_label }}</text>
          <text class="card-row-title">{{ c.title }}</text>
          <text class="card-row-arrow">›</text>
        </view>
      </view>

      <!-- ===== 邀请弹层 ===== -->
      <view v-if="inviteOpen" class="mask" @tap="closeInvite"></view>
      <view v-if="inviteOpen" class="sheet">
        <view class="sheet-head">
          <text class="sheet-title">邀请做搭子</text>
          <text class="sheet-sub">给他起个称呼，只出现在你这边</text>
        </view>

        <!-- 预览 -->
        <view class="preview">
          <text class="preview-label">预览</text>
          <text class="tag tag--preview" :style="{ backgroundColor: colorHex(form.color) }">
            {{ tagText(form.label) || '搭子' }}
          </text>
        </view>

        <!-- 输入：前缀 + 固定的「搭子」后缀 -->
        <view class="input-row">
          <input
            class="input"
            v-model="form.label"
            placeholder="比如：考研、夜跑"
            maxlength="6"
            @input="onLabelInput"
          />
          <text class="input-suffix">搭子</text>
        </view>
        <text class="len-hint">{{ form.label.length }}/6 字（加上「搭子」共 8 字）</text>

        <!-- 推荐词 -->
        <view class="chips">
          <text
            v-for="s in suggestions"
            :key="s"
            class="chip chip--pick"
            :class="{ 'chip--on': form.label === s }"
            @tap="form.label = s"
          >{{ s }}</text>
        </view>

        <!-- 颜色 -->
        <view class="swatches">
          <view
            v-for="c in colors"
            :key="c.key"
            class="swatch"
            :class="{ 'swatch--on': form.color === c.key }"
            :style="{ backgroundColor: c.hex }"
            @tap="form.color = c.key"
          ></view>
        </view>

        <!-- 期望类型：决定这是哪一类搭子，不同类型可以各建一段 -->
        <view class="cat-row">
          <text class="cat-label">是哪一类</text>
          <view class="chips">
            <text
              v-for="c in categories"
              :key="c.key"
              class="chip chip--pick"
              :class="{ 'chip--on': form.category === c.key, 'chip--used': isUsed(c.key) }"
              @tap="pickCategory(c.key)"
            >{{ c.label }}<text v-if="isUsed(c.key)" class="chip-tick"> 已有</text></text>
          </view>
        </view>

        <view class="sheet-actions">
          <button class="btn btn--ghost" @tap="closeInvite">取消</button>
          <button class="btn" :disabled="!canSubmit || inviting" @tap="submitInvite">
            {{ inviting ? '发送中…' : '发送邀请' }}
          </button>
        </view>
      </view>
    </block>
  </view>
</template>

<script>
const API = {
  profile: 'user-profile',
  invite: 'buddy-invite'
}

// ★ 八个闪亮色，前后端必须完全一致（buddy-tag / buddy-invite 里也有同一份）
const COLORS = [
  { key: 'shine-yellow', hex: '#ffde00' },
  { key: 'shine-orange', hex: '#ff4d00' },
  { key: 'shine-rose', hex: '#ff5fa2' },
  { key: 'shine-violet', hex: '#a855f7' },
  { key: 'shine-cyan', hex: '#22d3ee' },
  { key: 'shine-mint', hex: '#34d399' },
  { key: 'shine-blue', hex: '#3b82f6' },
  { key: 'shine-gold', hex: '#e9c46a' }
]

// 推荐词一律存**前缀**（不带"搭子"），因为后缀是前端拼的
const SUGGESTIONS = ['考研', '增肌', '自习', '拍照', '干饭', '竞赛', '夜跑', '雅思']

const CATEGORIES = [
  { key: 'study', label: '学习' },
  { key: 'fitness', label: '健身' },
  { key: 'photo', label: '拍照' },
  { key: 'meal', label: '吃饭' },
  { key: 'sport', label: '运动' },
  { key: 'other', label: '其他' }
]

export default {
  data() {
    return {
      userId: '',
      loading: true,
      err: '',

      user: {},
      relations: [],
      relationCount: 0,
      conversationId: '',
      applyState: {},
      common: { count: 0, tags: [] },
      cards: [],

      colors: COLORS,
      suggestions: SUGGESTIONS,
      categories: CATEGORIES,

      inviteOpen: false,
      inviting: false,
      form: {
        label: '',
        color: 'shine-yellow',
        category: 'other'
      }
    }
  },

  computed: {
    creditLevel() {
      const c = this.user.credit || 0
      if (c >= 85) return 'high'
      if (c >= 60) return 'mid'
      return 'low'
    },
    // 已用类型 = 后端给的 existing_categories ∪ 本地 relations 里的类型。
    // 两处都收是因为关系刚建好时本地 relations 已经更新、后端还没重拉。
    //
    // ★ 判重看「关系是否存在」，**不看有没有起名**。
    //   原来这里写的是 if (!r.my_label) continue —— 与 user-profile 里同一个错误：
    //   没起名就等于没建过关系 → 同一类型能反复邀请 → 与后端
    //   「同一对人在同一类型下只能有一条」的判重键 (ua,ub,category) 冲突，
    //   后端会复用旧关系，新标签覆盖进同一条，用户看到的就是「旧关系不见了」。
    usedCategories() {
      const fromApi = this.applyState.existing_categories || []
      const out = fromApi.slice()
      for (const r of this.relations || []) {
        const c = r.category || 'other'
        if (out.indexOf(c) < 0) out.push(c)
      }
      return out
    },
    canSubmit() {
      return this.form.label.trim().length > 0 && !this.inviting
    }
  },

  onLoad(options) {
    this.userId = (options && options.id) || ''
    if (!this.userId) {
      this.loading = false
      this.err = '缺少用户 id'
      return
    }
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => uni.stopPullDownRefresh())
  },

  methods: {
    async call(name, data) {
      const token = uni.getStorageSync('token') || ''
      const r = await uniCloud.callFunction({
        name: name,
        data: Object.assign({ token: token }, data)
      })
      const res = r.result || {}
      // uniCloud.callFunction 只在网络层失败才 reject，
      // 业务错误是正常返回的 { code: 4xx }，必须自己判
      if (res.code !== 0) throw new Error(res.msg || '请求失败')
      return res.data || {}
    },

    async load() {
      this.loading = true
      this.err = ''
      try {
        const d = await this.call(API.profile, { user_id: this.userId })
        this.user = d.user || {}
        this.relations = d.relations || []
        this.relationCount = d.relation_count || 0
        this.conversationId = d.conversation_id || ''
        this.applyState = d.apply_state || {}
        this.common = d.common || { count: 0, tags: [] }
        this.cards = d.cards || []
      } catch (e) {
        this.err = e.message || '加载失败'
      } finally {
        this.loading = false
      }
    },

    /** 剥掉用户可能自己打的"搭子"后缀，防止存成"考研搭子搭子" */
    onLabelInput(e) {
      let v = (e && e.detail && e.detail.value) || this.form.label || ''
      if (v.length > 6 && v.slice(-2) === '搭子') {
        v = v.slice(0, -2)
      }
      if (v.length > 6) v = v.slice(0, 6)
      this.form.label = v
    },

    pickCategory(key) {
      // 同一类型下同一对人只能有一段搭子，已建过的类型不能再选。
      // 这里明确挡一下并说明原因，否则用户点了没反应会以为坏了。
      if (this.isUsed(key)) {
        uni.showToast({ title: '这一类的搭子你们已经有了', icon: 'none' })
        return
      }
      this.form.category = key
    },

    // 我（当前登录用户）在这段关系里的那一侧标签是否非空？
    // 只有"我起过名"才算已有 —— 对方起的不算，因为那侧还没定。
    isUsed(catKey) {
      return this.usedCategories.indexOf(catKey) >= 0
    },

    openInvite() {
      // 默认选中第一个还没建过的类型；全建过了就从「学习」开始，让用户自己换。
      // 原来这里 dft 初值是 'other'，如果前面都没匹配上就会默认落到「其他」，
      // 于是「其他」上莫名多出一个勾 —— 那个勾是"默认值"留下的痕迹，不是真实数据。
      let dft = ''
      for (const c of CATEGORIES) {
        if (!this.isUsed(c.key)) {
          dft = c.key
          break
        }
      }
      if (!dft) dft = CATEGORIES[0].key
      this.form = { label: '', color: 'shine-yellow', category: dft }
      this.inviteOpen = true
    },

    closeInvite() {
      this.inviteOpen = false
    },

    async submitInvite() {
      if (!this.canSubmit) return
      this.inviting = true
      try {
        await this.call(API.invite, {
          action: 'invite',
          to_user_id: this.userId,
          label: this.form.label.trim(),
          color: this.form.color,
          category: this.form.category
        })
        uni.showToast({ title: '邀请已发送', icon: 'success' })
        this.inviteOpen = false
        await this.load()
      } catch (e) {
        uni.showToast({ title: e.message || '发送失败', icon: 'none' })
      } finally {
        this.inviting = false
      }
    },

    goChat() {
      uni.navigateTo({
        url:
          '/pages/chat/chat?conversation_id=' +
          encodeURIComponent(this.conversationId) +
          '&name=' +
          encodeURIComponent(this.user.nickname || '搭子') +
          '&school=' +
          encodeURIComponent(this.user.school || '') +
          '&peer_id=' +
          encodeURIComponent(this.userId)
      })
    },

    goCard(cardId) {
      uni.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(cardId) })
    },

    /**
     * 没起名时点灰标签 → 去「我的搭子」页给这段关系起名。
     * 不在这里弹输入框，是为了只保留一套起名交互（那边有推荐词和调色板）。
     */
    editLabel(r) {
      if (!r || !r.relation_id) return
      uni.navigateTo({ url: '/pages/buddy/buddy?highlight=' + r.relation_id })
    },

    /** 「搭子」是固定后缀，库里只存前缀。这里做一次防重复 */
    tagText(raw) {
      const s = String(raw || '').trim()
      if (!s) return ''
      return s.slice(-2) === '搭子' ? s : s + '搭子'
    },

    colorHex(key) {
      const c = COLORS.filter((x) => x.key === key)[0]
      return c ? c.hex : '#ffde00'
    },

    fmtDate(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate()
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background-color: var(--tf-bg);
  padding: 24rpx;
  padding-bottom: 60rpx;
}

.hint {
  padding: 120rpx 0;
  text-align: center;
  font-size: 28rpx;
  color: var(--tf-text-3);
}
.hint--err {
  color: var(--tf-danger);
}

/* ---------- 名片 ---------- */
.profile {
  background-color: var(--tf-card);
  border-radius: 28rpx;
  padding: 32rpx;
  margin-bottom: 24rpx;
}
.avatar-row {
  display: flex;
  align-items: center;
}
.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background-color: var(--tf-primary);
  color: #fff;
  font-size: 48rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.avatar--img {
  background-color: transparent;
}
.profile-main {
  margin-left: 24rpx;
  flex: 1;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}
.nickname {
  font-size: 38rpx;
  font-weight: 700;
  color: var(--tf-text);
  margin-right: 12rpx;
}
.badge {
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
}
.badge--ok {
  color: #fff;
  background-color: var(--tf-success);
}
.sub {
  display: block;
  font-size: 26rpx;
  color: var(--tf-text-2);
  margin-top: 8rpx;
}
.meta-row {
  display: flex;
  align-items: center;
  margin-top: 10rpx;
}
.credit {
  font-size: 24rpx;
  padding: 4rpx 14rpx;
  border-radius: 8rpx;
  margin-right: 16rpx;
}
.credit--high {
  color: #fff;
  background-color: var(--tf-success);
}
.credit--mid {
  color: var(--tf-text);
  background-color: #ffe58a;
}
.credit--low {
  color: #fff;
  background-color: var(--tf-danger);
}
.meta-item {
  font-size: 24rpx;
  color: var(--tf-text-3);
}
.bio {
  display: block;
  font-size: 27rpx;
  color: var(--tf-text-2);
  line-height: 1.6;
  margin-top: 24rpx;
}
.titles {
  display: flex;
  flex-wrap: wrap;
  margin-top: 20rpx;
}
.title-chip {
  font-size: 22rpx;
  color: #8a6d00;
  background-color: #fff8d6;
  padding: 6rpx 16rpx;
  border-radius: 8rpx;
  margin-right: 12rpx;
  margin-bottom: 12rpx;
}

/* ---------- 操作 ---------- */
.actions {
  margin-bottom: 24rpx;
}
.btn {
  background-color: var(--tf-primary);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  border-radius: 16rpx;
  height: 88rpx;
  line-height: 88rpx;
  margin-bottom: 16rpx;
}
.btn--ghost {
  background-color: var(--tf-card);
  color: var(--tf-primary);
  border: 2rpx solid var(--tf-primary);
}
.btn--sm {
  height: 64rpx;
  line-height: 64rpx;
  font-size: 26rpx;
  padding: 0 32rpx;
  display: inline-block;
  width: auto;
}
.btn[disabled] {
  opacity: 0.45;
}
.action-hint {
  font-size: 25rpx;
  color: var(--tf-text-3);
  text-align: center;
  padding: 12rpx 0;
}

/* ---------- 卡片 ---------- */
.card {
  background-color: var(--tf-card);
  border-radius: 28rpx;
  padding: 28rpx;
  margin-bottom: 24rpx;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}
.card-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.card-count {
  font-size: 24rpx;
  color: var(--tf-text-3);
}
.empty {
  font-size: 26rpx;
  color: var(--tf-text-3);
  line-height: 1.6;
}

/* ---------- 关系行 ---------- */
.rel-row {
  padding: 20rpx 0;
  border-bottom: 2rpx solid var(--tf-line);
}
.rel-row:last-of-type {
  border-bottom: none;
}
.rel-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}
.tag {
  font-size: 24rpx;
  font-weight: 700;
  color: #1f2329;
  padding: 8rpx 18rpx;
  border-radius: 10rpx;
  margin-right: 14rpx;
  margin-bottom: 10rpx;
}
/* 未命名的占位标签：灰底 + 虚线框，明确表达「这里还能填」 */
.tag--unnamed {
  color: var(--tf-text-3);
  background-color: transparent;
  border: 2rpx dashed var(--tf-line);
  font-weight: 500;
}
.rel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6rpx;
}
.rel-since,
.rel-cat {
  font-size: 22rpx;
  color: var(--tf-text-3);
}
.rel-note {
  font-size: 22rpx;
  color: var(--tf-text-3);
  line-height: 1.6;
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 2rpx dashed var(--tf-line);
}

/* ---------- chips ---------- */
.chips {
  display: flex;
  flex-wrap: wrap;
}
.chip {
  font-size: 24rpx;
  color: var(--tf-text-2);
  background-color: var(--tf-bg);
  padding: 10rpx 20rpx;
  border-radius: 10rpx;
  margin-right: 14rpx;
  margin-bottom: 14rpx;
}
.chip--pick {
  border: 2rpx solid transparent;
}
.chip--on {
  border-color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
  color: var(--tf-primary);
  font-weight: 600;
}
.chip--used {
  opacity: 0.5;
}
.chip-tick {
  color: var(--tf-success);
  font-size: 20rpx;
}

/* ---------- 卡片列表 ---------- */
.card-row {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 2rpx solid var(--tf-line);
}
.card-row:last-child {
  border-bottom: none;
}
.card-row-type {
  font-size: 22rpx;
  color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  margin-right: 16rpx;
  flex-shrink: 0;
}
.card-row-title {
  flex: 1;
  font-size: 27rpx;
  color: var(--tf-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.card-row-arrow {
  font-size: 32rpx;
  color: var(--tf-text-3);
  margin-left: 12rpx;
}

/* ---------- 邀请弹层 ---------- */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.45);
  z-index: 90;
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 91;
  background-color: var(--tf-card);
  border-radius: 32rpx 32rpx 0 0;
  padding: 36rpx 32rpx 48rpx;
  max-height: 86vh;
  overflow-y: auto;
}
.sheet-head {
  margin-bottom: 24rpx;
}
.sheet-title {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.sheet-sub {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-3);
  margin-top: 8rpx;
}
.preview {
  display: flex;
  align-items: center;
  background-color: var(--tf-bg);
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 20rpx;
}
.preview-label {
  font-size: 24rpx;
  color: var(--tf-text-3);
  margin-right: 20rpx;
}
.tag--preview {
  margin: 0;
}

.input-row {
  display: flex;
  align-items: center;
  border: 2rpx solid var(--tf-line);
  border-radius: 16rpx;
  padding: 0 24rpx;
  height: 92rpx;
}
.input {
  flex: 1;
  font-size: 30rpx;
  color: var(--tf-text);
}
.input-suffix {
  font-size: 30rpx;
  color: var(--tf-text-3);
  margin-left: 8rpx;
}
.len-hint {
  display: block;
  font-size: 22rpx;
  color: var(--tf-text-3);
  margin-top: 10rpx;
  margin-bottom: 24rpx;
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  margin-bottom: 24rpx;
}
.swatch {
  width: 64rpx;
  height: 64rpx;
  border-radius: 12rpx;
  margin-right: 20rpx;
  margin-bottom: 16rpx;
  border: 4rpx solid transparent;
  box-sizing: border-box;
}
.swatch--on {
  border-color: var(--tf-text);
}

.cat-row {
  margin-bottom: 24rpx;
}
.cat-label {
  display: block;
  font-size: 25rpx;
  color: var(--tf-text-2);
  margin-bottom: 14rpx;
}

.sheet-actions {
  display: flex;
  margin-top: 12rpx;
}
.sheet-actions .btn {
  flex: 1;
  margin-bottom: 0;
}
.sheet-actions .btn:first-child {
  margin-right: 20rpx;
}
</style>
