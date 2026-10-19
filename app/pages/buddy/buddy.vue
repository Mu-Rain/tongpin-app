<template>
  <view class="page">
    <view class="screen-body">
      <!-- ===== 顶部说明 ===== -->
      <view class="head">
        <text class="head-title">我的搭子</text>
        <text class="head-desc"
          >给每个搭子起个专属称呼，它只出现在你这边 —— 对方给你起的由他自己决定。</text
        >
      </view>

      <!-- ===== 加载 / 空态 ===== -->
      <view v-if="loading" class="hint">正在加载…</view>

      <view v-else-if="!buddies.length" class="empty">
        <text class="empty-title">还没有搭子</text>
        <text class="empty-desc">去搭子大厅发一条需求，等有人申请并同意后，这里就会出现他</text>
        <button class="btn btn--block" @tap="goHall">去搭子大厅 →</button>
      </view>

      <!-- ===== 搭子列表 ===== -->
      <view v-else>
        <!-- ★ key 用 other_user_id：一条卡 = 一个人。
             用 relation_id 的话，同一个人名下有多段关系时 key 会跟着第一段关系变，
             Vue 会误判成"换了一个人"而重建卡片。 -->
        <view v-for="b in buddies" :key="b.other_user_id" class="buddy-card">
          <!-- 第一行：头像 + 名字 + 学校 / 信誉 -->
          <view class="buddy-top" @tap="goChat(b)">
            <view class="avatar">{{ b.avatar || (b.name || '同').slice(0, 1) }}</view>
            <view class="buddy-main">
              <view class="buddy-name-row">
                <text class="buddy-name">{{ b.name }}</text>
                <text v-if="b.verified" class="verified">认证</text>
              </view>
              <view class="buddy-meta">
                <text v-if="b.school" class="tag">{{ b.school }}</text>
                <text class="credit">信誉 {{ b.credit }}</text>
              </view>
              <text class="buddy-last">{{ b.last_text }}</text>
            </view>
          </view>

          <!-- 第二行：标签区
               ★ 一张卡 = 一个人。这个人身上可能有 N 段搭子关系（自习 + 夜跑 + 拍照），
                 所以标签要**全部并排铺开**，不是一个。
               ★ 只显示「我给他起的」。
                 搭子标签是**私有备注**：我起的只我能看见，对方起的只对方能看见，
                 两边互不可见。所以这里没有「他叫你」——那是别人的私有备注，
                 本来就无权查看（删掉它是产品规则，不是遗漏）。 -->
          <view class="buddy-tags">
            <view class="tag-cloud">
              <text
                v-for="t in b.tags"
                :key="t.relation_id"
                class="shiny-tag"
                :class="{ 'shiny-tag--none': !t.label }"
                :style="t.label ? { backgroundColor: colorHex(t.color) } : {}"
                >{{ t.label ? t.label + '搭子' : t.category_label + '·未起名' }}</text
              >
            </view>
            <text class="tag-edit" @tap="openEditor(b)">改标签</text>
          </view>

          <!-- 第三行：去聊天 -->
          <button class="btn btn--sm btn--block" @tap="goChat(b)">去聊聊 →</button>
        </view>
      </view>
    </view>

    <!-- ===== 改标签弹层 =====
         ★ 一张卡 = 一个人，但他身上可能有 N 段关系，每段关系各有一个标签。
           所以弹层顶部先让用户**选改哪一段**，再编辑。
           只有一段关系时直接跳过选择，免得多点一下。 -->
    <view v-if="editor.show" class="mask" @tap="closeEditor" />
    <view v-if="editor.show" class="sheet">
      <view class="sheet-head">
        <text class="sheet-title">给 {{ editor.name }} 起个称呼</text>
        <text class="sheet-close" @tap="closeEditor">✕</text>
      </view>

      <!-- 有多段关系时：先选改哪一段 -->
      <block v-if="editor.tags.length > 1">
        <text class="section-label">改哪一段搭子</text>
        <view class="chips">
          <text
            v-for="t in editor.tags"
            :key="t.relation_id"
            class="chip"
            :class="{ 'chip--on': editor.relation_id === t.relation_id }"
            @tap="pickRelation(t)"
            >{{ t.category_label }}{{ t.label ? ' · ' + t.label : ' · 未起名' }}</text
          >
        </view>
      </block>

      <!-- 预览：这里就直接把"搭子"拼出来给用户看 -->
      <view class="preview-box">
        <text class="preview-label">预览</text>
        <text
          v-if="editor.label"
          class="shiny-tag shiny-tag--lg"
          :style="{ backgroundColor: colorHex(editor.color) }"
          >{{ editor.label }}搭子</text
        >
        <text v-else class="tag-none">输入文字后这里显示效果</text>
      </view>

      <!-- 输入框：右边固定显示"搭子"，用户不用自己打 -->
      <view class="input-row">
        <input
          class="input"
          v-model="editor.label"
          :maxlength="MAX_LABEL_LEN"
          placeholder="例如：考研、夜跑、干饭"
          @input="onLabelInput"
        />
        <text class="input-suffix">搭子</text>
      </view>
      <text class="input-hint"
        >{{ (editor.label || '').length }}/{{ MAX_LABEL_LEN }} 字（加上「搭子」共
        {{ (editor.label || '').length + 2 }} 字）</text
      >

      <!-- 推荐词 -->
      <text class="section-label">试试这些</text>
      <view class="chips">
        <text
          v-for="s in SUGGESTIONS"
          :key="s"
          class="chip"
          :class="{ 'chip--on': editor.label === s }"
          @tap="pickSuggestion(s)"
          >{{ s }}搭子</text
        >
      </view>

      <!-- 颜色 -->
      <text class="section-label">颜色</text>
      <view class="swatches">
        <view
          v-for="c in COLORS"
          :key="c"
          class="swatch"
          :class="{ 'swatch--on': editor.color === c }"
          :style="{ backgroundColor: colorHex(c) }"
          @tap="pickColor(c)"
        />
      </view>

      <!-- 操作 -->
      <view class="sheet-actions">
        <button class="btn" :disabled="saving" @tap="closeEditor">取消</button>
        <button class="btn btn--orange" :disabled="saving" @tap="save">保存</button>
      </view>

      <text v-if="editor.label" class="clear-link" @tap="clearLabel">清除这个称呼</text>
    </view>
  </view>
</template>

<script>
/** 8 个预设闪亮色 —— 必须与 buddy-tag 云函数里的 COLORS 完全一致 */
const COLORS = [
  'shine-yellow',
  'shine-orange',
  'shine-rose',
  'shine-violet',
  'shine-cyan',
  'shine-mint',
  'shine-blue',
  'shine-gold'
]

const COLOR_HEX = {
  'shine-yellow': '#ffde00',
  'shine-orange': '#ff4d00',
  'shine-rose': '#ff5fa2',
  'shine-violet': '#a855f7',
  'shine-cyan': '#22d3ee',
  'shine-mint': '#34d399',
  'shine-blue': '#3b82f6',
  'shine-gold': '#e9c46a'
}

/**
 * 推荐词一律存**前缀**，不带"搭子"二字。
 * 原型里写的"自习搭子""饭搭子"如果直接拿来用，拼上后缀会变成"自习搭子搭子"。
 */
const SUGGESTIONS = ['考研', '增肌', '自习', '拍照', '干饭', '竞赛', '夜跑', '雅思']

/** 前缀长度上限：完整标签上限 8 字，"搭子"占 2 字 */
const MAX_LABEL_LEN = 6

export default {
  data() {
    return {
      buddies: [],
      loading: true,
      saving: false,
      COLORS,
      SUGGESTIONS,
      MAX_LABEL_LEN,
      // 从别的页面点「起个名」带过来的 relation_id，加载完要自动打开对应那一段
      pendingHighlight: '',
      editor: {
        show: false,
        relation_id: '',
        name: '',
        label: '',
        color: COLORS[0],
        tags: []
      }
    }
  },

  onLoad(options) {
    // ★ 从 user.vue 的「起个名」占位标签跳过来时带 relation_id。
    //   记下来，等 loadList 拿到数据后再定位到那一段并直接开编辑器。
    this.pendingHighlight = (options && options.highlight) || ''
  },

  onShow() {
    // 从聊天页返回时也要刷新，标签可能在别处改过
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
          name: 'buddy-list',
          data: { token: token }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '加载失败', icon: 'none' })
          return
        }
        this.buddies = (r.data && r.data.list) || []
        this.applyPendingHighlight()
      } catch (e) {
        uni.showToast({ title: '网络不太好', icon: 'none' })
      } finally {
        this.loading = false
      }
    },

    /**
     * 别的页面点了「起个名」跳过来：找到含这段 relation_id 的那个人，
     * 直接打开编辑器并选中那一段。
     * 只在拿到数据后跑一次，跑完就清空，避免每次 onShow 刷新都强制弹层。
     */
    applyPendingHighlight() {
      const rid = this.pendingHighlight
      if (!rid) return
      this.pendingHighlight = ''
      for (let i = 0; i < this.buddies.length; i++) {
        const b = this.buddies[i]
        const tags = b.tags || []
        for (let j = 0; j < tags.length; j++) {
          if (tags[j].relation_id === rid) {
            this.openEditor(b)
            this.pickRelation(tags[j])
            return
          }
        }
      }
      // 关系已经不在了（被解除或数据变更），静默忽略
    },

    colorHex(name) {
      return COLOR_HEX[name] || COLOR_HEX['shine-yellow']
    },

    openEditor(b) {
      // ★ 一张卡 = 一个人，他名下可能有多段关系、多个标签。
      //   默认选中第一段（最早建立的那段），用户可以在弹层里切换改哪一段。
      const tags = b.tags || []
      const first = tags[0] || {}
      this.editor = {
        show: true,
        relation_id: first.relation_id || '',
        name: b.name,
        label: first.label || '',
        color: first.color || COLORS[0],
        tags: tags
      }
    },

    /** 在弹层的"改哪一段搭子"里切换，把该段关系当前的标签读进编辑器 */
    pickRelation(t) {
      this.editor.relation_id = t.relation_id
      this.editor.label = t.label || ''
      this.editor.color = t.color || COLORS[0]
    },

    closeEditor() {
      this.editor.show = false
    },

    onLabelInput(e) {
      // v-model 已经赋值了，这里只做一件事：把用户可能输入的"搭子"后缀剥掉，
      // 否则输入框里打"考研搭子"→ 预览变"考研搭子搭子"
      const v = (e && e.detail && e.detail.value) || this.editor.label || ''
      let s = v.trim()
      if (s.length > 2 && s.slice(-2) === '搭子') {
        s = s.slice(0, -2)
      }
      if (s !== v) this.editor.label = s
    },

    pickSuggestion(s) {
      this.editor.label = s
    },

    pickColor(c) {
      this.editor.color = c
    },

    clearLabel() {
      this.editor.label = ''
    },

    async save() {
      if (this.saving) return
      const token = uni.getStorageSync('token')
      if (!token) {
        uni.showToast({ title: '登录已过期', icon: 'none' })
        return
      }

      this.saving = true
      try {
        const res = await uniCloud.callFunction({
          name: 'buddy-tag',
          data: {
            token: token,
            relation_id: this.editor.relation_id,
            label: this.editor.label || '',
            color: this.editor.color
          }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '保存失败', icon: 'none', duration: 2500 })
          return
        }

        // 本地直接更新，不重新拉整个列表（省一次请求，也不会闪一下）
        // ★ 只改被编辑的那一段关系：这个人的其它标签原样不动。
        const d = r.data || {}
        const target = this.buddies.find((x) => {
          return (x.tags || []).some((t) => t.relation_id === this.editor.relation_id)
        })
        if (target) {
          const t = target.tags.find((x) => x.relation_id === this.editor.relation_id)
          if (t) {
            t.label = d.label || ''
            t.color = d.label_color || ''
          }
          // 同步兼容字段（取第一段的），免得别处还读到旧的
          const f = target.tags[0] || {}
          target.my_label = f.label || ''
          target.my_label_color = f.color || ''
        }

        this.editor.show = false
        uni.showToast({ title: '已保存', icon: 'success', duration: 1200 })
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      } finally {
        this.saving = false
      }
    },

    goChat(b) {
      if (!b.conversation_id) {
        uni.showToast({ title: '这个搭子还没有会话记录', icon: 'none' })
        return
      }
      // ★ 这个人名下可能有多个标签，全部传给聊天页并排显示
      //   格式与消息页一致：label|color,label|color
      const allTags = (b.tags || [])
        .filter((t) => t.label)
        .map((t) => t.label + '|' + (t.color || ''))
        .join(',')
      const q =
        'conversation_id=' + encodeURIComponent(b.conversation_id) +
        '&name=' + encodeURIComponent(b.name || '') +
        '&avatar=' + encodeURIComponent(b.avatar || '') +
        '&school=' + encodeURIComponent(b.school || '') +
        '&tags=' + encodeURIComponent(allTags) +
        '&tag=' + encodeURIComponent(allTags ? '' : '') +
        '&color=' + encodeURIComponent('') +
        // 聊天页要用它做"点头像进主页"
        '&peer_id=' + encodeURIComponent(b.other_user_id || '')
      uni.navigateTo({ url: '/pages/chat/chat?' + q })
    },

    goHall() {
      uni.navigateTo({ url: '/pages/hall/hall' })
    }
  }
}
</script>

<style scoped>
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

/* —— 顶部说明 —— */
.head {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding-bottom: 4rpx;
}
.head-title {
  font-size: 40rpx;
  font-weight: 800;
}
.head-desc {
  font-size: 24rpx;
  color: var(--tf-text-3);
  line-height: 1.5;
}

.hint {
  text-align: center;
  color: var(--tf-text-3);
  font-size: 24rpx;
  padding: 60rpx 0;
}

/* —— 搭子卡片 —— */
.buddy-card {
  border: 3rpx solid var(--tf-text);
  background: var(--tf-card);
  box-shadow: 4rpx 4rpx 0 var(--tf-text);
  padding: 20rpx;
  margin-bottom: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.buddy-top {
  display: flex;
  gap: 18rpx;
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
  overflow: hidden;
}
.buddy-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.buddy-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.buddy-name {
  font-weight: 800;
  font-size: 30rpx;
}
.verified {
  border: 2rpx solid var(--tf-text);
  background: #22d3ee;
  padding: 0 8rpx;
  font-size: 18rpx;
  font-weight: 700;
}
.buddy-meta {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.tag {
  border: 2rpx solid var(--tf-text);
  background: var(--tf-card);
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: var(--tf-text-2);
}
.credit {
  font-size: 20rpx;
  color: var(--tf-text-3);
}
.buddy-last {
  font-size: 24rpx;
  color: var(--tf-text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* —— 标签区 —— */
.buddy-tags {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
  border-top: 2rpx dashed var(--tf-line);
  padding-top: 14rpx;
}
/* 一个人的全部标签并排铺开，放不下就换行。
   ★ 用 flex-wrap 而不是横向滚动：标签一般 3–5 个，全看见比"滑一下才看见"重要。 */
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10rpx 10rpx;
  flex: 1;
  min-width: 0;
}
.tag-slot {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
}
.tag-slot-label {
  font-size: 20rpx;
  color: var(--tf-text-3);
  min-width: 76rpx;
}
.tag-none {
  font-size: 22rpx;
  color: var(--tf-text-3);
}
.tag-edit {
  flex-shrink: 0;
  align-self: center;
  font-size: 22rpx;
  font-weight: 700;
  color: var(--tf-primary);
  text-decoration: underline;
}

/* 闪亮标签：底色 + 白色高光渐变，8 个预设色都能透出来 */
.shiny-tag {
  display: inline-block;
  border: 3rpx solid var(--tf-text);
  padding: 4rpx 14rpx;
  font-size: 24rpx;
  font-weight: 800;
  color: var(--tf-text);
  background-image: linear-gradient(
    115deg,
    rgba(255, 255, 255, 0) 30%,
    rgba(255, 255, 255, 0.75) 48%,
    rgba(255, 255, 255, 0) 62%
  );
  box-shadow: 3rpx 3rpx 0 var(--tf-text);
}
.shiny-tag--sm {
  font-size: 20rpx;
  padding: 2rpx 10rpx;
  box-shadow: 2rpx 2rpx 0 var(--tf-text);
}
.shiny-tag--lg {
  font-size: 32rpx;
  padding: 8rpx 20rpx;
  box-shadow: 4rpx 4rpx 0 var(--tf-text);
}
/* 还没起名的关系：虚线框占位，一眼看出"这段搭子还没起称呼" */
.shiny-tag--none {
  border-style: dashed;
  border-color: var(--tf-text-3);
  color: var(--tf-text-3);
  font-weight: 500;
  box-shadow: none;
  background-image: none;
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
  padding: 0 30rpx;
}

/* —— 按钮 —— */
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
.btn--sm {
  height: 60rpx;
  line-height: 54rpx;
  font-size: 24rpx;
}
.btn--block {
  width: 100%;
}
.btn--orange {
  background: var(--tf-primary);
  color: #fff;
}

/* —— 弹层 —— */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 20;
}
.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--tf-card);
  border-top: 3rpx solid var(--tf-text);
  padding: 24rpx 24rpx 40rpx;
  z-index: 21;
  max-height: 86vh;
  overflow-y: auto;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 18rpx;
}
.sheet-title {
  font-size: 30rpx;
  font-weight: 800;
}
.sheet-close {
  font-size: 32rpx;
  padding: 0 8rpx;
}

.preview-box {
  border: 3rpx solid var(--tf-text);
  background: var(--tf-bg);
  padding: 20rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 18rpx;
}
.preview-label {
  font-size: 20rpx;
  color: var(--tf-text-3);
}

.input-row {
  display: flex;
  align-items: center;
  border: 3rpx solid var(--tf-text);
  background: var(--tf-card);
  padding: 0 20rpx;
  height: 84rpx;
}
.input {
  flex: 1;
  font-size: 28rpx;
  height: 84rpx;
}
.input-suffix {
  font-size: 28rpx;
  font-weight: 800;
  color: var(--tf-text-2);
  padding-left: 10rpx;
  flex: none;
}
.input-hint {
  font-size: 20rpx;
  color: var(--tf-text-3);
  padding: 8rpx 4rpx 18rpx;
  display: block;
}

.section-label {
  font-size: 22rpx;
  font-weight: 700;
  color: var(--tf-text-2);
  display: block;
  padding: 6rpx 0 12rpx;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  padding-bottom: 18rpx;
}
.chip {
  border: 2rpx solid var(--tf-text);
  background: var(--tf-card);
  padding: 8rpx 16rpx;
  font-size: 22rpx;
}
.chip--on {
  background: var(--tf-text);
  color: #fff;
}

.swatches {
  display: flex;
  gap: 16rpx;
  flex-wrap: wrap;
  padding-bottom: 22rpx;
}
.swatch {
  width: 76rpx;
  height: 52rpx;
  border: 3rpx solid var(--tf-text);
}
.swatch--on {
  box-shadow: 0 0 0 6rpx var(--tf-text);
}

.sheet-actions {
  display: flex;
  gap: 18rpx;
}
.sheet-actions .btn {
  flex: 1;
}
.clear-link {
  display: block;
  text-align: center;
  font-size: 22rpx;
  color: var(--tf-danger);
  text-decoration: underline;
  padding-top: 22rpx;
}
</style>
