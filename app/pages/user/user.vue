<template>
  <view class="page">
    <!-- ===== 加载 / 失败 ===== -->
    <view v-if="loading" class="hint">正在加载…</view>
    <view v-else-if="err" class="hint hint--err">
      <text class="hint-text">{{ err }}</text>
      <button class="btn btn--sm" @tap="load">重试</button>
    </view>

    <block v-else>
      <!-- ===== 顶栏：只留三点菜单 =====
           原生导航栏已经有返回和标题，这里不再重复。
           标题在下面的名片区已经有了（备注称呼 + 灰色「用户名：」），
           再写一遍只是重复占位。自己是本人时不显示菜单，整条也不渲染。 -->
      <view v-if="!applyState.is_self" class="topbar">
        <view class="morebtn" @tap="openMenu">⋯</view>
      </view>

      <!-- ===== 已拉黑提示条 =====
           拉黑是单向彻底静默（契约 D2），用户在主页上看不出任何变化会以为没生效，
           所以顶部常驻一条灰条说明「他现在发不了消息给你」。 -->
      <view v-if="isBlocked" class="blockbar">
        <text class="blockbar-text">你已把对方加入黑名单，对方无法给你发消息</text>
        <text class="blockbar-link" @tap="toggleBlock">解除</text>
      </view>

      <!-- ===== 名片区 ===== -->
      <view class="uphead">
        <view class="uphead-ava">
          <image v-if="avaSrcOf('u' + userId)" class="avatar avatar--img ava-fade" :class="{ 'ava-fade--in': avaReadyOf('u' + userId) }" :src="avaSrcOf('u' + userId)" mode="aspectFill" @load="avaOnLoad('u' + userId)" @error="avaOnError('u' + userId, user.avatar)" />
          <view v-else class="avatar avatar--ph" />

          <view class="uphead-main">
            <view class="uphead-name-row">
              <text class="uphead-name">{{ nameText }}</text>
              <!-- 认证标：认证过的用户一眼能看出来 -->
              <text v-if="user.verified" class="verified">已认证</text>
            </view>
            <!-- 起过备注时，昵称位置显示备注，真实昵称降级成下面这行灰色小字。
                 没起备注就不显示，否则同一行字会重复出现两次。 -->
            <text v-if="rawNameText" class="uphead-real">用户名：{{ rawNameText }}</text>
            <text class="uphead-school">
              {{ user.school || '未填写学校' }}<text v-if="user.grade"> · {{ user.grade }}</text>
            </text>
            <view class="uphead-credit-row">
              <text class="credit-chip" :class="'credit-chip--' + creditLevel">信誉 {{ user.credit }} · {{ user.credit_label }}</text>
            </view>
          </view>
        </view>

        <text v-if="user.bio" class="uphead-bio">{{ user.bio }}</text>

        <!-- 佩戴中的称号排第一，其余称号跟在后面 -->
        <view v-if="currentTitle || (user.titles && user.titles.length)" class="uphead-titles">
          <!-- 佩戴中的称号：和称号墙、我的页共用同一套皮肤 -->
          <view v-if="currentTitle" class="tt tt--sm" :class="skinOf(currentTitle.code).cls">
            <text class="tt-ico">{{ skinOf(currentTitle.code).icon }}</text>
            <text class="tt-name">{{ currentTitle.name }}</text>
          </view>
          <text v-for="(t, i) in (user.titles || [])" :key="i" class="titlechip">{{ t }}</text>
        </view>

        <!-- 「TA 的称号」入口（契约 §4.2）：别人的主页才有，自己的主页没有「TA」这回事 -->
        <view v-if="showTitleEntry" class="title-entry" @tap="goTitles">
          <text class="title-entry-text">TA 的称号</text>
          <text class="title-entry-arrow">›</text>
        </view>
      </view>

      <!-- ===== 主要操作 ===== -->
      <view class="upactions" v-if="conversationId || applyState.can_invite || (!applyState.is_self && applyState.reason)">
        <button v-if="conversationId" class="btn btn--ghost btn--grow" @tap="goChat">发消息</button>
        <button v-if="applyState.can_invite" class="btn btn--grow" @tap="openInvite">邀请做搭子</button>
        <text v-else-if="!applyState.is_self && applyState.reason" class="action-hint">{{ applyState.reason }}</text>
      </view>

      <!-- ===== 我们之间的搭子关系 ===== -->
      <view v-if="!applyState.is_self" class="rel">
        <view class="rel-head">
          <text class="rel-title">你们之间的搭子</text>
          <text v-if="relationCount" class="rel-count">{{ relationCount }} 段</text>
        </view>

        <text v-if="!relations.length" class="rel-empty">
          {{ isFriend ? '你们已经是好友了，搭子关系已经收起来。' : '还不是搭子。点上面的「邀请做搭子」，起个标签就能建立关系。' }}
        </text>

        <view v-for="r in relations" :key="r.relation_id" class="rel-row">
          <!-- 只显示我给他起的。
               搭子标签是私有备注：我起的别人看不见，别人起的我也看不见，
               所以这里不显示 his_label（产品规则，见 docs 说明）。 -->
          <!-- 已起名：实心彩色标签 -->
          <text
            v-if="r.my_label"
            class="buddytag"
            :style="{ backgroundColor: colorHex(r.my_label_color) }"
          >{{ tagText(r.my_label) }}</text>
          <!-- 没起名（Q2=1）：灰底 + 虚线框占位，点了直接去补名。
               不用类别名顶替 —— 那会让人误以为「学习搭子」是自己起的名字，
               实际只是关系类型，改不了、也不知道能改。 -->
          <text
            v-else
            class="buddytag buddytag--unnamed"
            @tap="editLabel(r)"
          >{{ r.category_label }} · 起个名</text>

          <text class="rel-since">自 {{ fmtDate(r.since) }}</text>
        </view>

        <text v-if="relations.length" class="rel-note">
          同一对可以有多段搭子，但聊天只有一个窗口 —— 所有消息都在上面「发消息」里。
        </text>
      </view>

      <!-- ===== 共同标签 ===== -->
      <view v-if="common.count > 0" class="common">
        <view class="common-head">
          <text class="common-bolt">⚡</text>
          <text class="common-text">你们有</text>
          <text class="common-num">{{ common.count }}</text>
          <text class="common-text">个共同标签</text>
        </view>
        <view class="common-tags">
          <text v-for="t in common.tags" :key="t.tag_id" class="tag tag--hit">{{ t.name }}</text>
        </view>
      </view>

      <!-- ===== 他在招募的卡 ===== -->
      <view v-if="cards.length" class="recruit">
        <text class="recruit-head">正在招搭子</text>
        <view v-for="c in cards" :key="c.card_id" class="recruit-row" @tap="goCard(c.card_id)">
          <text class="type" :class="'type--' + c.type">{{ c.type_label }}</text>
          <text class="recruit-title">{{ c.title }}</text>
          <text class="recruit-arrow">›</text>
        </view>
      </view>

      <!-- ===== 三点菜单 ===== -->
      <view v-if="menuOpen" class="mask" @tap="closeMenu"></view>
      <view v-if="menuOpen" class="sheet">
        <view class="sheet-head">
          <text class="sheet-title">更多操作</text>
        </view>

        <view class="menu-list">
          <!-- 查找聊天记录：从聊天页顶栏搬过来的入口。
               放在主页而不是会话里，因为"翻这个人跟我说过什么"是看人时的需求，
               不是聊天时的需求；聊天页顶栏也挤不下第四个元素。
               主按钮只留「发消息 / 邀请做搭子」两个，这条挪进菜单。 -->
          <view
            v-if="conversationId"
            class="menu-item"
            @tap="goChatSearchFromMenu"
          >查找聊天记录</view>

          <!-- 成为好友：有搭子、还不是好友、也没有待处理的申请 -->
          <view
            v-if="canUpgrade"
            class="menu-item"
            @tap="upgradeToFriend"
          >成为好友</view>

          <!-- 解除搭子：有搭子关系就能断 -->
          <view
            v-if="hasRelation"
            class="menu-item menu-item--danger"
            @tap="startUnlink"
          >解除搭子关系</view>

          <!-- 删除好友：已经是好友才出现 -->
          <view
            v-if="isFriend"
            class="menu-item menu-item--danger"
            @tap="deleteFriend"
          >删除好友</view>

          <!-- 黑名单：契约 5.3 的顺序是
               成为好友 → 解除搭子关系 → 删除好友 → 加入/解除黑名单 → 举报 → 备注。
               文案随 isBlocked 切换，action 也随之切换。 -->
          <view
            class="menu-item menu-item--danger"
            @tap="toggleBlock"
          >{{ isBlocked ? '解除黑名单' : '加入黑名单' }}</view>

          <!-- 举报：跳到独立举报页，带上 type/id/name -->
          <view class="menu-item" @tap="goReport">举报</view>

          <!-- 备注一直都在：没有时是「设置」，有了是「修改」 -->
          <view class="menu-item" @tap="openRemark">{{ myRemark ? '修改备注' : '设置备注' }}</view>
        </view>

        <view class="menu-cancel" @tap="closeMenu">取消</view>
      </view>

      <!-- ===== 备注弹层 ===== -->
      <view v-if="remarkOpen" class="mask" @tap="closeRemark"></view>
      <view v-if="remarkOpen" class="sheet">
        <view class="sheet-head">
          <text class="sheet-title">设置备注</text>
          <text class="sheet-sub">只出现在你这边，别人看不见</text>
        </view>

        <view class="input-row">
          <input
            class="input"
            v-model="remarkForm"
            :maxlength="REMARK_MAX_LEN"
            placeholder="比如：三班的胖子"
          />
        </view>
        <text class="len-hint">{{ remarkForm.length }}/{{ REMARK_MAX_LEN }} 字</text>

        <view class="sheet-actions">
          <button class="btn btn--ghost" @tap="closeRemark">取消</button>
          <button class="btn" :disabled="savingRemark" @tap="submitRemark">保存</button>
        </view>

        <text v-if="myRemark" class="clear-link" @tap="clearRemark">清除备注</text>
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
          <text class="buddytag" :style="{ backgroundColor: colorHex(form.color) }">
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
  invite: 'buddy-invite',
  friendRequest: 'friend-request',
  friendUnlink: 'friend-unlink',
  buddyUnlink: 'buddy-unlink',
  remark: 'user-remark',
  block: 'user-block'
}

// 备注长度上限。云函数 user-remark 里是同一个数，两边必须一致：
// 前端只管输入体验，真校验在云函数（超了会返回 400「备注最多 12 个字」）
const REMARK_MAX_LEN = 12

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

import { skinOf } from '@/common/title/skins.js'
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

export default {
  mixins: [avatarFadeMixin],
  data() {
    return {
      userId: '',
      loading: true,
      err: '',

      user: {},
      // 对方当前佩戴的称号 { code, name }；没佩戴就是 null（契约 §3.3 的 current_title）
      currentTitle: null,
      relations: [],
      relationCount: 0,
      conversationId: '',
      applyState: {},
      common: { count: 0, tags: [] },
      cards: [],

      colors: COLORS,
      suggestions: SUGGESTIONS,
      categories: CATEGORIES,
      // ★ 模板里要用模块级常量，必须在 data() 里注册一次，否则渲染时访问不到 → 整页白屏
      REMARK_MAX_LEN,

      // 好友 / 备注：A 组的 user-profile 出参里给，页面不自己算
      isFriend: false,
      friendRequestState: 'none',
      myRemark: '',
      // 我有没有拉黑他。来源：user-profile 出参 is_blocked（契约 4.4）。
      // 老版本云函数没有这个字段，兜底成 false，不要写 !is_blocked 之外的花样。
      isBlocked: false,

      // 三点菜单
      menuOpen: false,
      remarkOpen: false,
      remarkForm: '',
      savingRemark: false,
      acting: false,

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
    },
    // 有没有活着的搭子关系（= 能不能「解除搭子」）
    hasRelation() {
      return this.relations.length > 0
    },
    // 成为好友：有搭子 + 不是好友 + 没有待处理申请（对方申请的也算待处理）
    canUpgrade() {
      return this.hasRelation && !this.isFriend && this.friendRequestState === 'none'
    },
    /**
     * 页面上显示的名字。
     * 起过备注就显示「备注（原昵称）」—— 只显示备注会让人忘了这是自己编的名字，
     * 只显示昵称又等于备注白设了，所以两个都给。
     */
    /** 昵称位置显示的名字：起过备注就显示备注，没起就是原昵称 */
    nameText() {
      return this.myRemark || this.user.nickname || '同学'
    },

    /** 有备注时才给真实昵称（渲染成下方的灰色小字），没备注返回空串 */
    rawNameText() {
      return this.myRemark ? (this.user.nickname || '') : ''
    },

    /**
     * 「TA 的称号」入口要不要显示（契约 §4.2）。
     * 自己是本人的时候不显示：页面上没有「TA」这回事，点进去也只是自己那一张墙。
     * applyState 在首屏还是 {}，is_self 取不到就当「不是自己」——宁可多给一个入口，
     * 也不要因为云函数老版本没这个字段而让入口整片消失。
     */
    showTitleEntry() {
      return !this.applyState.is_self && !!this.userId
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
    skinOf,

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
        this.avaBind('u' + this.userId, this.user.avatar)
        // 契约 §3.3：current_title 在出参顶层，不在 user 里；老云函数没有这个字段，兜底 null
        this.currentTitle = d.current_title || null
        this.relations = d.relations || []
        this.relationCount = d.relation_count || 0
        this.conversationId = d.conversation_id || ''
        this.applyState = d.apply_state || {}
        this.common = d.common || { count: 0, tags: [] }
        this.cards = d.cards || []
        // A 组改造后的 user-profile 出参；老版本没有这三个字段，兜底成「都不是」
        this.isFriend = d.is_friend === true
        this.friendRequestState = d.friend_request_state || 'none'
        this.myRemark = d.my_remark || ''
        // 黑名单状态：user-block 的 add/remove 也会回写这里，两处来源同一含义
        this.isBlocked = d.is_blocked === true
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

    // ---------- 三点菜单 ----------
    openMenu() {
      this.menuOpen = true
    },

    closeMenu() {
      this.menuOpen = false
    },

    // ---------- 成为好友 ----------
    // 先弹确认：成为好友会收掉搭子关系，这一步不可预期，必须说清。
    // 用户点「再想想」就一个请求都不发（回调里只有 confirm 分支才有动作）。
    upgradeToFriend() {
      this.menuOpen = false
      uni.showModal({
        title: '加为好友',
        content: '成为好友后，你们之间的搭子关系会自动收起来，只剩好友身份',
        confirmText: '发申请',
        cancelText: '再想想',
        success: (r) => {
          if (r.confirm) this.doUpgradeToFriend()
        }
      })
    },

    async doUpgradeToFriend() {
      if (this.acting) return
      this.acting = true
      try {
        await this.call(API.friendRequest, {
          action: 'send',
          to_user_id: this.userId,
          source: 'buddy'
        })
        // 发出去就算 out_pending：菜单里的「成为好友」随即消失，
        // 不用等下一次拉 user-profile 才知道自己发过了
        this.friendRequestState = 'out_pending'
        uni.showToast({ title: '已发出好友申请', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e.message || '申请失败', icon: 'none', duration: 2500 })
      } finally {
        this.acting = false
      }
    },

    // ---------- 解除搭子关系 ----------
    /**
     * 一段搭子在界面上叫什么。
     * ★ 必须与关系卡片（模板里 rel-row 那一段）的显示规则一模一样，否则同一个人
     *   卡片上写「考研搭子」、解除时列表里写「学习」，用户根本对不上号。
     *   卡片规则：起过名（my_label 非空）显示私有标签，没起名才退回类别名 + 未起名占位。
     * withPlaceholder 只在"选择列表"里用 —— 多段并排时靠「· 未起名」区分，
     * 确认框标题里带上它就啰嗦了。
     */
    relName(r, withPlaceholder) {
      const d = r || {}
      if (d.my_label) return d.my_label + '搭子'
      const cat = d.category_label || '搭子'
      return withPlaceholder ? cat + ' · 未起名' : cat
    },

    // 一个人可能既是自习搭子又是夜跑搭子，所以先确认断哪一段。
    startUnlink() {
      this.menuOpen = false
      const list = this.relations || []
      if (!list.length) {
        uni.showToast({ title: '你们还不是搭子', icon: 'none' })
        return
      }
      if (list.length === 1) {
        this.confirmUnlink(list[0])
        return
      }
      uni.showActionSheet({
        itemList: list.map((r) => this.relName(r, true)),
        success: (res) => {
          const r = list[res.tapIndex]
          if (r) this.confirmUnlink(r)
        }
      })
    },

    // 多段时用户点完 ActionSheet 已经忘了自己选的是哪段，所以标题里把名字带出来
    confirmUnlink(r) {
      const cat = this.relName(r, false)
      uni.showModal({
        title: '解除「' + cat + '」？',
        content: '解除后你们会从彼此的搭子列表里消失，聊天记录还在，但搭子标签会没掉',
        confirmText: '解除',
        confirmColor: '#F04438',
        cancelText: '再想想',
        success: (res) => {
          if (res.confirm) this.doUnlink(r, cat)
        }
      })
    },

    async doUnlink(r, cat) {
      if (this.acting) return
      if (!r || !r.relation_id) {
        uni.showToast({ title: '这段关系已经没了', icon: 'none' })
        return
      }
      this.acting = true
      try {
        await this.call(API.buddyUnlink, { relation_id: r.relation_id })
        await this.load()
        uni.showToast({ title: '已解除' + cat, icon: 'none' })
      } catch (e) {
        // 别人同时在别处解除了：本地数据过期，重拉比报错有用
        if (/已经解除/.test(e.message || '')) {
          await this.load()
          return
        }
        uni.showToast({ title: e.message || '解除失败', icon: 'none', duration: 2500 })
      } finally {
        this.acting = false
      }
    },

    // ---------- 删除好友 ----------
    deleteFriend() {
      this.menuOpen = false
      uni.showModal({
        title: '删除好友？',
        content: '删除后你们不再是好友，聊天记录保留',
        confirmText: '删除',
        confirmColor: '#F04438',
        cancelText: '再想想',
        success: (r) => {
          if (r.confirm) this.doDeleteFriend()
        }
      })
    },

    async doDeleteFriend() {
      if (this.acting) return
      this.acting = true
      try {
        await this.call(API.friendUnlink, { friend_user_id: this.userId })
        await this.load()
        uni.showToast({ title: '已删除', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e.message || '删除失败', icon: 'none', duration: 2500 })
      } finally {
        this.acting = false
      }
    },

    // ---------- 黑名单 ----------
    /**
     * 加入 / 解除黑名单。
     * ★ 拉黑会顺手删好友、撤掉 pending 申请（云函数里做），所以必须先确认。
     * ★ 成功后用云函数返回的 blocked 覆盖本地状态，不靠猜。
     */
    toggleBlock() {
      this.menuOpen = false
      const toAdd = !this.isBlocked
      uni.showModal({
        title: toAdd ? '加入黑名单？' : '解除黑名单？',
        content: toAdd
          ? '加入后对方无法给你发消息，也加不了你好友；你们的好友关系会一并解除'
          : '解除后对方可以重新给你发消息',
        confirmText: toAdd ? '加入' : '解除',
        confirmColor: toAdd ? '#F04438' : '#1F2329',
        cancelText: '再想想',
        success: (res) => {
          if (res.confirm) this.doBlock(toAdd)
        }
      })
    },

    async doBlock(toAdd) {
      if (this.acting) return
      this.acting = true
      try {
        const d = await this.call(API.block, {
          action: toAdd ? 'add' : 'remove',
          target_user_id: this.userId
        })
        // add → { blocked: true }，remove → { blocked: false }
        this.isBlocked = d.blocked === true
        // 拉黑会解掉好友关系，重拉一次让菜单项跟着变
        await this.load()
        uni.showToast({ title: toAdd ? '已加入黑名单' : '已解除黑名单', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e.message || '操作失败', icon: 'none', duration: 2500 })
      } finally {
        this.acting = false
      }
    },

    // ---------- 举报 ----------
    goReport() {
      this.menuOpen = false
      if (!this.userId) return
      uni.navigateTo({
        url:
          '/pages/report/report?type=user&id=' +
          encodeURIComponent(this.userId) +
          '&name=' +
          encodeURIComponent(this.user.nickname || this.nameText || '')
      })
    },

    // ---------- 备注 ----------
    openRemark() {
      this.menuOpen = false
      this.remarkForm = this.myRemark || ''
      this.remarkOpen = true
    },

    closeRemark() {
      this.remarkOpen = false
    },

    async submitRemark() {
      if (this.savingRemark) return
      const r = String(this.remarkForm || '').trim()
      if (r.length > REMARK_MAX_LEN) {
        uni.showToast({ title: '备注最多 ' + REMARK_MAX_LEN + ' 个字', icon: 'none' })
        return
      }
      // 空串等于没备注，走 clear 比走 set 语义更明确
      if (!r) {
        await this.clearRemark()
        return
      }
      this.savingRemark = true
      try {
        const d = await this.call(API.remark, {
          action: 'set',
          target_user_id: this.userId,
          remark: r
        })
        this.myRemark = d.remark || r
        this.remarkOpen = false
        uni.showToast({ title: '已保存', icon: 'success' })
      } catch (e) {
        uni.showToast({ title: e.message || '保存失败', icon: 'none', duration: 2500 })
      } finally {
        this.savingRemark = false
      }
    },

    async clearRemark() {
      if (this.savingRemark) return
      this.savingRemark = true
      try {
        await this.call(API.remark, { action: 'clear', target_user_id: this.userId })
        this.myRemark = ''
        this.remarkOpen = false
        uni.showToast({ title: '已清除', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: e.message || '清除失败', icon: 'none', duration: 2500 })
      } finally {
        this.savingRemark = false
      }
    },

    goChat() {
      this.openChat(false)
    },

    /** 查聊天记录：同一个聊天页，多传一个 search=1，进去直接弹搜索层 */
    goChatSearch() {
      this.openChat(true)
    },

    // 从三点菜单里点「查找聊天记录」：先收菜单再跳。
    // 不收的话，从聊天页返回时那张弹层还盖在主页上，像是没跳成功。
    goChatSearchFromMenu() {
      this.closeMenu()
      this.goChatSearch()
    },

    openChat(withSearch) {
      uni.navigateTo({
        url:
          '/pages/chat/chat?conversation_id=' +
          encodeURIComponent(this.conversationId) +
          // ★ 传显示名（备注优先），聊天页标题才是用户认得的称呼
          '&name=' +
          encodeURIComponent(this.nameText || '搭子') +
          '&school=' +
          encodeURIComponent(this.user.school || '') +
          '&peer_id=' +
          encodeURIComponent(this.userId) +
          (withSearch ? '&search=1' : '')
      })
    },

    // 跳称号墙的对方视角（契约 §4.2）：复用已有路由，pages.json 不加新页面
    goTitles() {
      if (!this.userId) return
      uni.navigateTo({
        url: '/pages/title/title?user_id=' + encodeURIComponent(this.userId)
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
  padding: 16rpx 31rpx 60rpx;
  box-sizing: border-box;
  background-color: transparent;
}

/* ==========================================================================
   加载 / 失败
   ========================================================================== */
.hint {
  padding: 120rpx 0;
  text-align: center;
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.hint--err {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.hint-text {
  font-size: 26rpx;
  color: var(--tf-danger);
}

/* ==========================================================================
   顶栏：只剩三点菜单，靠右
   原生导航栏已经有返回和标题，这里不重复
   ========================================================================== */
.topbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  min-height: 69rpx;
  padding-bottom: 15rpx;
}

.morebtn {
  flex: none;
  width: 69rpx;
  height: 69rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 25rpx;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1;
  color: var(--tf-text-2);
  background: rgba(255, 255, 255, 0.62);
  border: 2rpx solid var(--tf-line-soft);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

/* ==========================================================================
   已拉黑提示条
   灰底 + 主色文字：比危险色克制，因为拉黑是「我主动做的事」，
   不是错误；但要让用户知道它正在生效。
   ========================================================================== */
.blockbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 15rpx;
  margin-bottom: 19rpx;
  padding: 19rpx 25rpx;
  border-radius: var(--tf-r-sm);
  background: rgba(127, 156, 180, 0.18);
  border: 2rpx solid rgba(95, 130, 160, 0.24);
}

.blockbar-text {
  flex: 1;
  min-width: 0;
  font-size: 22rpx;
  line-height: 1.5;
  color: #46617A;
}

.blockbar-link {
  flex: none;
  font-size: 22rpx;
  font-weight: 700;
  color: var(--tf-primary);
}

/* ==========================================================================
   名片区
   ========================================================================== */
.uphead {
  position: relative;
  overflow: hidden;
  padding: 42rpx 37rpx 35rpx;
  border-radius: var(--tf-r-xl);
  background: var(--tf-card-strong);
  background-image: radial-gradient(110% 120% at 100% 0%, rgba(201, 221, 196, 0.42), rgba(201, 221, 196, 0) 58%);
  border: 2rpx solid var(--tf-card-line);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.uphead-ava {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 27rpx;
}

.avatar {
  width: 150rpx;
  height: 150rpx;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 54rpx;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(140deg, var(--tf-primary), var(--tf-primary-deep));
  border: 2rpx solid var(--tf-line);
  box-shadow: 0 12rpx 29rpx rgba(31, 92, 172, 0.24);
}

.avatar--img {
  background: transparent;
}

/* 头像没就绪时的空圆：尺寸/圆角/描边全部继承 .avatar，只把底色换成中性色 */
.avatar--ph {
  background: var(--tf-line-soft);
}

.uphead-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.uphead-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 13rpx;
}

.uphead-name {
  font-size: 40rpx;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--tf-text);
}

.verified {
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  font-weight: 600;
  color: var(--tf-mint);
  background: rgba(201, 221, 196, 0.46);
  border: 2rpx solid rgba(95, 130, 108, 0.24);
}

/* 起过备注时，真实昵称降级成这行灰字 */
.uphead-real {
  margin-top: 6rpx;
  font-size: 21rpx;
  color: var(--tf-text-2);
}

.uphead-school {
  margin-top: 13rpx;
  font-size: 23rpx;
  color: var(--tf-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.uphead-credit-row {
  margin-top: 15rpx;
  display: flex;
  flex-direction: row;
}

/* 信誉 chip：不跟着学校名一起收缩 —— 收缩就会被折成两行 */
.credit-chip {
  flex: none;
  padding: 5rpx 17rpx;
  border-radius: 15rpx;
  font-size: 20rpx;
  font-weight: 600;
  white-space: nowrap;
}

.credit-chip--high {
  color: #24634D;
  background: rgba(47, 125, 99, 0.13);
}

.credit-chip--mid {
  color: #46617A;
  background: rgba(127, 156, 180, 0.22);
}

.credit-chip--low {
  color: var(--tf-danger);
  background: rgba(176, 74, 74, 0.12);
}

.uphead-bio {
  display: block;
  margin-top: 27rpx;
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
}

.uphead-titles {
  margin-top: 23rpx;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 13rpx;
}

/* 称号 chip：金调，属于「荣誉」，不能和主色混用 */
.titlechip {
  padding: 7rpx 19rpx 7rpx 15rpx;
  border-radius: 25rpx;
  font-size: 22rpx;
  font-weight: 600;
  color: #2F4F66;
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.92) 0%, rgba(201, 221, 196, 0.58) 100%);
  border: 2rpx solid rgba(95, 130, 160, 0.24);
  box-shadow: inset 0 2rpx 0 rgba(255, 255, 255, 0.90);
}

/* 佩戴中的称号：加一层雾蓝银，和普通称号分开 */
.titlechip--now {
  color: #2C4358;
  background: linear-gradient(140deg, rgba(255, 255, 255, 0.95) 0%, rgba(127, 156, 180, 0.42) 100%);
  border-color: rgba(95, 130, 160, 0.34);
}

/* 「TA 的称号」入口：整行可点，右侧箭头暗示能进去 */
/* 入口行：用上分隔线而不是整块底色 —— 白底 + 描边在白卡里会长得像输入框 */
.title-entry {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 23rpx;
  padding-top: 21rpx;
  border-top: 2rpx solid var(--tf-line-soft);
}

.title-entry-text {
  font-size: 24rpx;
  color: var(--tf-primary);
}

.title-entry-arrow {
  font-size: 28rpx;
  color: var(--tf-text-3);
}

/* ==========================================================================
   主要操作：只留两个按钮，第三个入口挪进三点菜单
   ========================================================================== */
.upactions {
  margin-top: 23rpx;
  display: flex;
  flex-direction: row;
  gap: 19rpx;
}

.action-hint {
  flex: 1;
  padding: 15rpx 0;
  text-align: center;
  font-size: 23rpx;
  color: var(--tf-text-2);
}

/* ==========================================================================
   搭子关系
   ========================================================================== */
.rel {
  margin-top: 23rpx;
  padding: 27rpx 31rpx;
  border-radius: var(--tf-r-md);
  background: rgba(255, 255, 255, 0.50);
  border: 2rpx solid var(--tf-line-soft);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.rel-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.rel-title {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.rel-count {
  font-size: 20rpx;
  color: var(--tf-text-2);
}

.rel-empty {
  display: block;
  margin-top: 15rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

.rel-row {
  margin-top: 21rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 13rpx;
}

/* 搭子标签：全站唯一的「闪亮色」位置 —— 渐变 + 高光 + 投影，
   跟普通 chip 明确分开。底色由 colorHex 内联注入，这里只叠高光。 */
.buddytag {
  position: relative;
  overflow: hidden;
  padding: 9rpx 23rpx;
  border-radius: 17rpx;
  font-size: 24rpx;
  font-weight: 700;
  color: var(--tf-text);
  background-image: linear-gradient(115deg, rgba(255, 255, 255, 0.62) 0%, rgba(255, 255, 255, 0) 38%);
  box-shadow: 0 10rpx 27rpx rgba(22, 33, 46, 0.12), inset 0 2rpx 0 rgba(255, 255, 255, 0.60);
}

/* 未命名的占位标签：灰底 + 虚线框，明确表达「这里还能填」 */
.buddytag--unnamed {
  color: var(--tf-text-2);
  background-color: rgba(255, 255, 255, 0.50);
  background-image: none;
  border: 2rpx dashed rgba(22, 33, 46, 0.24);
  font-weight: 500;
  box-shadow: none;
}

.rel-since {
  margin-left: auto;
  font-size: 20rpx;
  color: var(--tf-text-2);
}

.rel-note {
  display: block;
  margin-top: 21rpx;
  padding-top: 19rpx;
  border-top: 2rpx dashed var(--tf-line-soft);
  font-size: 20rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* ==========================================================================
   共同标签
   ========================================================================== */
.common {
  margin-top: 23rpx;
  padding: 27rpx 31rpx 29rpx;
  border-radius: var(--tf-r-md);
  background: rgba(201, 221, 196, 0.30);
  border: 2rpx solid rgba(95, 130, 108, 0.20);
}

.common-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 8rpx;
}

.common-bolt {
  font-size: 22rpx;
}

.common-text {
  font-size: 24rpx;
  font-weight: 600;
  color: #37624A;
}

.common-num {
  font-size: 31rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #37624A;
}

.common-tags {
  margin-top: 19rpx;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 13rpx;
}

.tag {
  padding: 7rpx 19rpx;
  border-radius: 999rpx;
  font-size: 21rpx;
  color: var(--tf-text-2);
  background: rgba(255, 255, 255, 0.55);
  border: 2rpx solid var(--tf-line-soft);
}

/* 与我重合的标签：雾绿底，不抢主色 */
.tag--hit {
  color: #37624A;
  background: rgba(255, 255, 255, 0.62);
  border-color: rgba(95, 130, 108, 0.26);
  font-weight: 500;
}

/* ==========================================================================
   正在招搭子
   ========================================================================== */
.recruit {
  margin-top: 23rpx;
  padding: 27rpx 31rpx 19rpx;
  border-radius: var(--tf-r-md);
  background: rgba(255, 255, 255, 0.50);
  border: 2rpx solid var(--tf-line-soft);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.recruit-head {
  display: block;
  margin-bottom: 8rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.recruit-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 17rpx;
  padding: 17rpx 0;
  border-top: 2rpx solid var(--tf-line-soft);
}

.type {
  flex: none;
  height: 42rpx;
  padding: 0 17rpx;
  display: flex;
  align-items: center;
  border-radius: 15rpx;
  font-size: 20rpx;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #1B4A72;
  background: rgba(31, 92, 172, 0.12);
}

.type--study { color: #2F5F45; background: rgba(201, 221, 196, 0.52); }
.type--fitness { color: #24634D; background: rgba(47, 125, 99, 0.14); }
.type--meal { color: #46617A; background: rgba(127, 156, 180, 0.22); }
.type--photo { color: #46617A; background: rgba(127, 156, 180, 0.18); }

.recruit-title {
  flex: 1;
  min-width: 0;
  font-size: 25rpx;
  color: var(--tf-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recruit-arrow {
  flex: none;
  font-size: 30rpx;
  color: var(--tf-text-3);
}

/* ==========================================================================
   按钮
   ========================================================================== */
.btn {
  height: 84rpx;
  line-height: 84rpx;
  margin: 0;
  padding: 0 34rpx;
  border-radius: 999rpx;
  font-size: 27rpx;
  font-weight: 600;
  color: #fff;
  background-color: var(--tf-primary);
  border: 2rpx solid rgba(255, 255, 255, 0.22);
  box-shadow: var(--tf-lift-sm);
}

.btn::after {
  border: none;
}

.btn--ghost {
  background-color: rgba(255, 255, 255, 0.70);
  color: var(--tf-primary);
  border-color: var(--tf-line-soft);
  box-shadow: none;
}

.btn--grow {
  flex: 1;
  padding: 0;
  text-align: center;
}

.btn--sm {
  display: inline-block;
  width: auto;
  height: 68rpx;
  line-height: 68rpx;
  padding: 0 30rpx;
  font-size: 23rpx;
}

.btn[disabled] {
  opacity: 0.45;
}

/* ==========================================================================
   弹层
   ========================================================================== */
.mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(0, 0, 0, 0.45);
  z-index: 90;
}

.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 91;
  max-height: 86vh;
  overflow-y: auto;
  padding: 36rpx 31rpx 48rpx;
  border-radius: var(--tf-r-xl) var(--tf-r-xl) 0 0;
  background-color: rgba(255, 255, 255, 0.94);
  border-top: 2rpx solid var(--tf-line);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.sheet-head {
  margin-bottom: 23rpx;
}

.sheet-title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.sheet-sub {
  display: block;
  margin-top: 8rpx;
  font-size: 23rpx;
  color: var(--tf-text-2);
}

/* ---------- 操作菜单 ---------- */
.menu-list {
  margin-top: 8rpx;
}

.menu-item {
  height: 104rpx;
  line-height: 104rpx;
  text-align: center;
  font-size: 27rpx;
  color: var(--tf-text);
  border-bottom: 2rpx solid var(--tf-line-soft);
}

.menu-item--danger {
  color: var(--tf-danger);
}

.menu-cancel {
  margin-top: 19rpx;
  height: 92rpx;
  line-height: 92rpx;
  text-align: center;
  font-size: 27rpx;
  color: var(--tf-text-2);
  background: rgba(255, 255, 255, 0.55);
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
}

.clear-link {
  display: block;
  padding-top: 23rpx;
  text-align: center;
  font-size: 22rpx;
  color: var(--tf-danger);
  text-decoration: underline;
}

/* ---------- 邀请弹层 ---------- */
.preview {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 19rpx;
  padding: 19rpx 25rpx;
  border-radius: var(--tf-r-sm);
  background: rgba(255, 255, 255, 0.55);
  border: 2rpx solid var(--tf-line-soft);
}

.preview-label {
  margin-right: 19rpx;
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.input-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 92rpx;
  padding: 0 25rpx;
  border-radius: var(--tf-r-sm);
  border: 2rpx solid var(--tf-line-soft);
  background: rgba(255, 255, 255, 0.96);
}

.input {
  flex: 1;
  font-size: 27rpx;
  color: var(--tf-text);
}

.input-suffix {
  margin-left: 10rpx;
  font-size: 27rpx;
  font-weight: 700;
  color: var(--tf-primary);
}

.len-hint {
  display: block;
  margin-top: 10rpx;
  margin-bottom: 23rpx;
  font-size: 21rpx;
  color: var(--tf-text-2);
}

.chips {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 13rpx;
}

.chip {
  padding: 9rpx 21rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: var(--tf-text-2);
  background: rgba(255, 255, 255, 0.55);
  border: 2rpx solid var(--tf-line-soft);
}

.chip--pick {
  border-color: var(--tf-line-soft);
}

.chip--on {
  color: var(--tf-primary);
  background: var(--tf-primary-soft);
  border-color: var(--tf-primary);
  font-weight: 600;
}

.chip--used {
  opacity: 0.5;
}

.chip-tick {
  font-size: 19rpx;
  color: var(--tf-mint);
}

.swatches {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 19rpx;
  margin-top: 23rpx;
  margin-bottom: 23rpx;
}

.swatch {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  border: 2rpx solid var(--tf-line-soft);
  box-shadow: var(--tf-lift-sm);
}

.swatch--on {
  border-width: 5rpx;
  border-color: rgba(31, 92, 172, 0.45);
  transform: scale(1.12);
}

.cat-row {
  margin-bottom: 23rpx;
}

.cat-label {
  display: block;
  margin-bottom: 15rpx;
  font-size: 23rpx;
  font-weight: 600;
  color: var(--tf-text-2);
}

.sheet-actions {
  display: flex;
  flex-direction: row;
  gap: 19rpx;
  margin-top: 15rpx;
}

.sheet-actions .btn {
  flex: 1;
  padding: 0;
  text-align: center;
}

/* 头像淡入：解码完成（@load）后整体亮起。用同一个节点切 class，不摘挂 —— 摘挂会让头像位塌一下再回来 */
.ava-fade {
  opacity: 0;
  transition: opacity 160ms ease-out;
}
.ava-fade--in {
  opacity: 1;
}
</style>
