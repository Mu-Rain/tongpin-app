<template>
  <view class="page">
    <!-- 原生导航已关，自己补返回（pages.json 里 navigationStyle: custom） -->
    <view class="nav-back" @tap="goBack">
      <text class="nav-back-arw">‹</text>
    </view>

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
            <!-- 头像：common/avatar/avatarCache.js —— 本地落盘 + 解码完成后整体淡入。
                 key 用 'bd' + other_user_id：一条卡 = 一个人，多次渲染 key 不变。
                 没有可用本地路径就留同尺寸空圆，绝不塞默认头像图。 -->
            <image
              v-if="avaSrcOf('bd' + b.other_user_id)"
              class="avatar avatar--img ava-fade"
              :class="{ 'ava-fade--in': avaReadyOf('bd' + b.other_user_id) }"
              :src="avaSrcOf('bd' + b.other_user_id)"
              mode="aspectFill"
              lazy-load="true"
              @load="avaOnLoad('bd' + b.other_user_id)"
              @error="avaOnError('bd' + b.other_user_id, b.avatar)"
            />
            <view v-else class="avatar" />
            <view class="buddy-main">
              <view class="buddy-name-row">
                <text class="buddy-name">{{ displayName(b) }}</text>
                <text v-if="b.verified" class="verified">认证</text>
              </view>
              <!-- 起过备注时把真实昵称降级成灰色小字，跟个人主页、好友页一致 -->
              <text v-if="rawName(b)" class="buddy-realname">用户名：{{ rawName(b) }}</text>
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
            <view class="tag-ops">
              <text class="tag-edit" @tap="openEditor(b)">改标签</text>
              <text class="tag-unlink" @tap="unlink(b)">解除</text>
            </view>
          </view>

          <!-- 第三行：去聊天。
               「升级为好友」已经搬到个人主页（user.vue）右上角的三点菜单里 ——
               加好友前要能先看清这人是谁，在列表里一键发申请太容易误点。 -->
          <view class="card-foot">
            <button class="btn btn--sm btn--grow" @tap="goChat(b)">去聊聊 →</button>
          </view>

          <!-- 第四行：这次搭完了。
               ★ 按关系逐个显示，不按人合并 —— 「搭完一次」记在某一段关系上，
                 合并到人身上就分不清该给哪段加次数（一个人可能同时有自习和夜跑两段）。 -->
          <view class="buddy-done" v-if="b.tags && b.tags.length">
            <view class="done-row" v-for="t in b.tags" :key="'done-' + t.relation_id">
              <text class="done-count" v-if="doneCountOf(t) > 0">
                已一起搭过 {{ doneCountOf(t) }} 次
              </text>
              <text class="done-count done-count--idle" v-else>{{ t.category_label }}·还没一起搭过</text>
              <button
                class="btn btn--sm"
                :class="{ 'btn--off': mineDone(t) }"
                :disabled="mineDone(t) || completingId === t.relation_id"
                @tap="onComplete(b, t)"
                >{{ mineDone(t) ? '已确认，等对方' : '这次搭完了' }}</button
              >
            </view>
          </view>
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
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

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
  // 头像淡入的公共时序（common/avatar/avatarCache.js）
  mixins: [avatarFadeMixin],
  data() {
    return {
      buddies: [],
      loading: true,
      saving: false,
      unlinking: false,
      // 正在提交「搭完了」的那一段关系 id，用来防重复点（只挡住那一段，不挡别人）
      completingId: '',
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

  // 头像：整页一次挂上。buddies 每次 onShow/下拉都是新数组，deep 保证跟上。
  watch: {
    buddies: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (b) => 'bd' + (b && b.other_user_id),
          (b) => b && b.avatar
        )
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
        this.normalizeDone()
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

    /**
     * 把三段搭完状态补成明确的类型。
     * 老版本 buddy-list 不下发这几个字段，模板里直接比较 undefined 会渲染成
     * "已确认"或"还没搭过"的随机一种；先统一成 false/0，界面才可预期。
     */
    normalizeDone() {
      this.buddies.forEach((b) => {
        ;(b.tags || []).forEach((t) => {
          if (typeof t.done_count !== 'number') t.done_count = 0
          t.my_done = t.my_done === true
          t.peer_done = t.peer_done === true
        })
      })
    },

    doneCountOf(t) {
      return typeof t.done_count === 'number' ? t.done_count : 0
    },

    mineDone(t) {
      return t.my_done === true
    },

    /**
     * 这次搭完了：双方各点一次才算数（契约 §3.2）。
     * ★ 成功后只改这一段关系的三个字段，不整页重拉 —— 重拉会闪一下，
     *   而且用户刚点的按钮会瞬间回到未点状态，看着像没生效。
     */
    async onComplete(b, t) {
      if (this.completingId) return
      const token = uni.getStorageSync('token')
      if (!token) {
        uni.showToast({ title: '登录已过期', icon: 'none' })
        return
      }
      this.completingId = t.relation_id
      try {
        const res = await uniCloud.callFunction({
          name: 'buddy-complete',
          data: { token: token, relation_id: t.relation_id }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          // 按契约的错误码分开说：同一个 toast 说"失败了"，用户不知道该干嘛
          let tip = r.msg || '提交失败'
          if (r.code === 409) tip = '这段搭子关系已结束'
          else if (r.code === 404) tip = '这段搭子关系已经不在了'
          else if (r.code === 403) tip = '你不是这段关系的当事人'
          else if (r.code === 401) tip = '登录已过期，请重新登录'
          uni.showToast({ title: tip, icon: 'none', duration: 2500 })
          return
        }
        const d = r.data || {}
        t.my_done = d.my_done === true
        t.peer_done = d.peer_done === true
        if (typeof d.done_count === 'number') t.done_count = d.done_count
        if (d.rewarded === true) {
          uni.showToast({ title: '双方确认，信誉分 +2', icon: 'none', duration: 2000 })
        } else {
          uni.showToast({ title: '已确认，等对方也点一下', icon: 'none', duration: 1800 })
        }
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      } finally {
        this.completingId = ''
      }
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

    /**
     * 解除搭子（US-25）。
     * ★ 按段解除，不是"跟这个人断交"：一个人身上可能有多段关系，
     *   只有一段时直接确认；多段时先让他选断哪一段。
     */
    unlink(b) {
      const tags = b.tags || []
      if (!tags.length) {
        uni.showToast({ title: '这个人还没有搭子关系', icon: 'none' })
        return
      }
      if (tags.length === 1) {
        this.confirmUnlink(b, tags[0])
        return
      }
      uni.showActionSheet({
        itemList: tags.map((t) => {
          return t.label ? t.label + '搭子 · ' + t.category_label : t.category_label + '·未起名'
        }),
        success: (r) => {
          const t = tags[r.tapIndex]
          if (t) this.confirmUnlink(b, t)
        }
      })
    },

    /** 二次确认。解除不可撤销，必须说清"聊天还在、标签会没" */
    confirmUnlink(b, t) {
      const name = t.label ? t.label + '搭子' : t.category_label + '·未起名'
      uni.showModal({
        title: '解除这段搭子？',
        content:
          '解除后「' + name + '」会从你们双方的搭子列表里消失，聊天记录还在，但标签会没掉。',
        confirmText: '解除',
        confirmColor: '#F04438',
        cancelText: '再想想',
        success: (r) => {
          if (r.confirm) this.doUnlink(b, t)
        }
      })
    },

    async doUnlink(b, t) {
      if (this.unlinking) return
      const token = uni.getStorageSync('token')
      if (!token) {
        uni.showToast({ title: '登录已过期', icon: 'none' })
        return
      }

      this.unlinking = true
      try {
        const res = await uniCloud.callFunction({
          name: 'buddy-unlink',
          data: { token: token, relation_id: t.relation_id }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          // 别人同时在别处解除了 → 本地数据也过期了，重拉一次比报错有用
          if (/已经解除/.test(r.msg || '')) {
            await this.loadList()
            return
          }
          uni.showToast({ title: r.msg || '解除失败', icon: 'none', duration: 2500 })
          return
        }

        // 本地删掉这一段，不重拉整个列表（省一次请求，也不会闪一下）
        const target = this.buddies.find((x) => x.other_user_id === b.other_user_id)
        if (target) {
          target.tags = (target.tags || []).filter((x) => x.relation_id !== t.relation_id)
          const first = target.tags[0] || {}
          target.my_label = first.label || ''
          target.my_label_color = first.color || ''
          // 这个人身上的关系全断了 → 整张卡从我的搭子页消失
          if (!target.tags.length) {
            this.buddies = this.buddies.filter((x) => x.other_user_id !== b.other_user_id)
          }
        }

        this.editor.show = false
        uni.showToast({ title: '已解除', icon: 'success', duration: 1200 })
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      } finally {
        this.unlinking = false
      }
    },

    /**
     * 卡片上显示的名字：起过备注就显示备注，没有就显示昵称。
     * ★ 备注来自 buddy-list 的 b.remark（A 组新增字段），老版本没有这个字段，
     *   所以必须兜底成空串 —— 直接拼会显示成 "undefined"。
     */
    displayName(b) {
      const remark = (b && b.remark) || ''
      const name = (b && b.name) || '同学'
      // 有备注就只显示备注，真实昵称交给下面那行灰色小字
      return remark || name
    },

    /**
     * 灰色小字「用户名：xxx」的内容。
     * ★ 只在"起过备注"时返回真实昵称；没备注时返回空串，模板用 v-if 整行不渲染，
     *   否则每张卡上都会多出一行跟上面一模一样的名字。
     */
    rawName(b) {
      const remark = (b && b.remark) || ''
      return remark ? (b.name || '') : ''
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
        // ★ 传显示名（备注优先），聊天页标题才是用户认得的称呼
        '&name=' + encodeURIComponent(this.displayName(b) || '') +
        '&avatar=' + encodeURIComponent(b.avatar || '') +
        '&school=' + encodeURIComponent(b.school || '') +
        '&tags=' + encodeURIComponent(allTags) +
        '&tag=' + encodeURIComponent(allTags ? '' : '') +
        '&color=' + encodeURIComponent('') +
        // 聊天页要用它做"点头像进主页"
        '&peer_id=' + encodeURIComponent(b.other_user_id || '')
      uni.navigateTo({ url: '/pages/chat/chat?' + q })
    },

    /* 原生导航已关，返回自己处理；没有上一页就回「我的」 */
    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/mine/mine' })
      })
    },

    goHall() {
      uni.navigateTo({ url: '/pages/hall/hall' })
    }
  }
}
</script>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  background: transparent;
}
/* 返回按钮：浮在状态栏下方左侧 */
.nav-back {
  position: absolute;
  left: 28rpx;
  top: calc(var(--status-bar-height) + 16rpx);
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.90);
  box-shadow: 0 4rpx 14rpx rgba(120, 90, 50, 0.14);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.nav-back-arw {
  font-size: 44rpx;
  color: var(--tf-text);
  line-height: 1;
  margin-top: -4rpx;
}
.screen-body {
  /* 顶部让出状态栏 + 返回按钮那一行 */
  padding: calc(var(--status-bar-height) + 92rpx) 24rpx 24rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

/* —— 顶部说明 —— */
/* 头部：一块淡渐变底，把「说明区」和「卡片区」分开 */
.head {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: 26rpx 28rpx;
  margin-bottom: 24rpx;
  border-radius: 28rpx;
  background: linear-gradient(135deg, #F2F7FE 0%, #EAF6F0 100%);
  border: 2rpx solid rgba(143, 184, 106, 0.20);
}
.head-title {
  font-size: 40rpx;
  font-weight: 800;
}
.head-desc {
  font-size: 24rpx;
  color: var(--tf-text-2);
  line-height: 1.5;
}

.hint {
  text-align: center;
  color: var(--tf-text-2);
  font-size: 24rpx;
  padding: 60rpx 0;
}

/* —— 搭子卡片 —— */
.buddy-card {
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: 32rpx;
  box-shadow: 0 10rpx 28rpx rgba(120, 90, 50, 0.09);
  padding: 28rpx 26rpx 22rpx;
  margin-bottom: 22rpx;
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}
.buddy-top {
  display: flex;
  gap: 18rpx;
}
.avatar {
  width: 104rpx;
  height: 104rpx;
  border: 4rpx solid #FFFFFF;
  border-radius: 50%;
  background: var(--tf-primary-soft);
  box-shadow: 0 6rpx 16rpx rgba(120, 90, 50, 0.14);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 32rpx;
  flex: none;
  overflow: hidden;
}
/* 有头像就渲染图片（buddy-list 已换临时链接）；没有可用链接时留同尺寸空圆，不再用昵称首字 */
.avatar--img {
  display: block;
  background: var(--tf-card-line);
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

.buddy-realname {
  display: block;
  font-size: 22rpx;
  color: var(--tf-text-2);
  margin-top: 2rpx;
}
.verified {
  border: 2rpx solid rgba(47, 125, 99, 0.20);
  border-radius: 999rpx;
  background: var(--tf-mist);
  color: var(--tf-mint);
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
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
  background: var(--tf-card-strong);
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  color: var(--tf-text-2);
}
.credit {
  font-size: 20rpx;
  color: var(--tf-text-2);
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
  border-top: 2rpx dashed var(--tf-line-soft);
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
/* 两个操作横排，别竖着挤在右边 */
.tag-ops {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20rpx;
  flex-shrink: 0;
  padding-top: 4rpx;
}
/* 解除是破坏性操作，用危险色且比"改标签"更轻，避免误点的视觉权重压过正常操作 */
.tag-unlink {
  font-size: 22rpx;
  color: var(--tf-danger);
}
.tag-slot {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
}
.tag-slot-label {
  font-size: 20rpx;
  color: var(--tf-text-2);
  min-width: 76rpx;
}
.tag-none {
  font-size: 22rpx;
  color: var(--tf-text-2);
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
/* 搭子标签
   ★ 原来写的是 background-image 在前、background 在后 ——
     background 是简写，会把 background-image 一起重置，那个「闪光」从来没生效过。
     现在拆成 background-color（可被内联 backgroundColor 覆盖）+ background-image（白光）。 */
.shiny-tag {
  display: inline-block;
  border: none;
  border-radius: 999rpx;
  padding: 8rpx 18rpx;
  font-size: 23rpx;
  font-weight: 800;
  color: var(--tf-text);
  background-color: var(--tf-card-strong);
  background-image: linear-gradient(
    120deg,
    rgba(255, 255, 255, 0.58) 0%,
    rgba(255, 255, 255, 0) 46%,
    rgba(255, 255, 255, 0.30) 100%
  );
  box-shadow: 0 4rpx 12rpx rgba(120, 90, 50, 0.14);
}
.shiny-tag--sm {
  font-size: 20rpx;
  padding: 2rpx 10rpx;
}
.shiny-tag--lg {
  font-size: 32rpx;
  padding: 8rpx 20rpx;
}
/* 还没起名的关系：虚线框占位，一眼看出"这段搭子还没起称呼" */
.shiny-tag--none {
  border-style: dashed;
  border-color: var(--tf-text-2);
  color: var(--tf-text-2);
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
  color: var(--tf-text-2);
  text-align: center;
  padding: 0 30rpx;
}

/* —— 按钮 —— */
.btn {
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
  background: var(--tf-card-strong);
  box-shadow: 0 6rpx 16rpx rgba(31, 92, 172, 0.10);
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
/* 卡片底部的「去聊聊」：唯一实色按钮，用绿→蓝渐变 */
.card-foot .btn--sm {
  height: 76rpx;
  line-height: 76rpx;
  border-radius: 38rpx;
  border: none;
  background: linear-gradient(135deg, #8FB86A 0%, #3B7ADB 100%);
  color: #FFFFFF;
  font-size: 26rpx;
  font-weight: 700;
  box-shadow: 0 8rpx 20rpx rgba(59, 122, 219, 0.24);
}
.card-foot .btn--sm:active {
  transform: scale(0.98);
}
.btn--block {
  width: 100%;
}
/* —— 这次搭完了 ——
   ⚠️ 用 --tf-primary 而不是绿色：绿色在本项目已经被「标签高亮」占用了，
      同一页里两种绿用户分不清哪个是状态、哪个是操作。 */
.buddy-done {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  border-top: 2rpx dashed var(--tf-line-soft);
  padding-top: 14rpx;
}
.done-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}
.done-count {
  font-size: 22rpx;
  color: var(--tf-text-2);
  flex: 1;
  min-width: 0;
}
.done-count--idle {
  color: var(--tf-text-2);
}
/* 点过之后按钮只是"等对方"，不该再抢视觉，但也不能像 disabled 那样看着坏掉 */
.btn--off {
  opacity: 0.45;
}

/* 卡片底部按钮区（现在只剩「去聊聊」） */
.card-foot {
  display: flex;
  gap: 12rpx;
}
.btn--grow {
  flex: 1;
  padding: 0;
}
.btn--orange {
  background: var(--tf-primary);
  border-color: rgba(255, 255, 255, 0.22);
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
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  border-top: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-xl) var(--tf-r-xl) 0 0;
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
  border: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-md);
  background: var(--tf-bg);
  padding: 20rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 18rpx;
}
.preview-label {
  font-size: 20rpx;
  color: var(--tf-text-2);
}

.input-row {
  display: flex;
  align-items: center;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-md);
  background: rgba(255, 255, 255, 0.96);
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
  color: var(--tf-text-2);
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
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
  background: var(--tf-card-strong);
  padding: 8rpx 16rpx;
  font-size: 22rpx;
}
.chip--on {
  background: var(--tf-primary);
  border-color: var(--tf-primary);
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
  border: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-sm);
}
.swatch--on {
  box-shadow: 0 0 0 4rpx rgba(31, 92, 172, 0.30);
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
/* 头像淡入（common/avatar/avatarCache.js）：空圆 → 完整头像 160ms。
   用 opacity 不摘节点，节点一直在，不会引起行高抖动。 */
.ava-fade {
  opacity: 0;
  transition: opacity 160ms ease-out;
}

.ava-fade--in {
  opacity: 1;
}
</style>