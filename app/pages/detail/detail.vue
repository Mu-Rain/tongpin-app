<template>
  <view class="page">
    <!-- 原生导航已关，自绘吸顶导航 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">搭子详情</text>
    </view>

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
      <!-- ===== 主卡：先说明白，再让用户决定要不要搭 ===== -->
      <view class="hero">
        <view class="hero-row1">
          <text class="type" :class="'type--' + card.type">{{ typeLabel(card.type) }}</text>
          <text class="status" :class="'status--' + card.status">{{ statusLabel(card.status) }}</text>
          <text class="mine-tag" v-if="card.is_mine">我发的</text>
          <text class="hero-ago" v-if="createdAgo">{{ createdAgo }}</text>
        </view>

        <text class="hero-title">{{ card.title }}</text>
        <text class="hero-desc">{{ card.description }}</text>

        <!-- 配图：1 张铺满，多张并排；点任意一张可全屏看 -->
        <view class="hero-media" v-if="card.images && card.images.length">
          <image
            class="hero-img"
            :class="{ 'hero-img--multi': card.images.length > 1 }"
            v-for="(img, ii) in card.images"
            :key="ii"
            :src="img"
            mode="aspectFill"
            @tap="previewMedia(ii)"
          />
        </view>

        <!-- 发布者：想判断靠不靠谱，必须能点进主页 -->
        <view class="owner">
          <!-- 头像：common/avatar/avatarCache.js —— 本地落盘 + 解码完成后整体淡入。
               一页只有一张卡，key 固定用 'owner'；换卡时 avaBind 会发现地址变了重新淡入。
               没有可用本地路径就留同尺寸空圆，绝不塞默认头像图。 -->
          <image
            v-if="avaSrcOf('owner')"
            class="avatar avatar--img ava-fade"
            :class="{ 'ava-fade--in': avaReadyOf('owner') }"
            :src="avaSrcOf('owner')"
            mode="aspectFill"
            @load="avaOnLoad('owner')"
            @error="avaOnError('owner', card.owner.avatar_url)"
          />
          <view v-else class="avatar" />
          <view class="owner-main">
            <view class="owner-name-row">
              <text class="owner-name">{{ card.owner.nickname }}</text>
              <text class="verified" v-if="card.owner.is_verified">已认证</text>
            </view>
            <text class="owner-sub">
              {{ card.owner.school || '未填学校' }}
              <text v-if="card.owner.grade"> · {{ card.owner.grade }}</text>
              <text v-if="card.owner.user_no"> · {{ card.owner.user_no }}</text>
            </text>
          </view>
          <text class="owner-go" @tap="goOwnerProfile">看主页 ›</text>
        </view>
        <text class="owner-bio" v-if="card.owner.bio">{{ card.owner.bio }}</text>
      </view>

      <!-- ===== 地点 / 时间 / 想找，合成一块三行 ===== -->
      <view class="infoblock">
        <view class="info-row" v-if="card.location_name">
          <view class="info-ico"><text class="info-ico-txt">📍</text></view>
          <view class="info-main">
            <text class="info-label">地点</text>
            <text class="info-value">{{ card.location_name }}</text>
          </view>
        </view>
        <view class="info-row" v-if="card.start_time">
          <view class="info-ico"><text class="info-ico-txt">🕐</text></view>
          <view class="info-main">
            <text class="info-label">时间</text>
            <text class="info-value">{{ fmtRange(card.start_time, card.end_time) }}</text>
          </view>
        </view>
        <view class="info-row">
          <view class="info-ico"><text class="info-ico-txt">👥</text></view>
          <view class="info-main">
            <text class="info-label">想找</text>
            <text class="info-value">{{ card.expected_people || 1 }} 人</text>
          </view>
        </view>
      </view>

      <!-- ===== 标签：有重合就先把「同频几个」说在最前面 ===== -->
      <view class="overlap" v-if="card.tags.length">
        <view class="overlap-head" v-if="card.common_tag_count > 0">
          <text class="overlap-bolt">⚡</text>
          <text class="overlap-text">你们有</text>
          <text class="overlap-num">{{ card.common_tag_count }}</text>
          <text class="overlap-text">个共同标签</text>
        </view>
        <view class="overlap-head" v-else>
          <text class="overlap-text">标签</text>
        </view>
        <view class="overlap-tags">
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

      <!-- ===== 发布者视角：谁申请了 ===== -->
      <view class="applicants" v-if="card.is_mine">
        <text class="applicants-title">收到的申请（{{ applyState.pending_count || 0 }}）</text>

        <view class="applicant" v-for="a in applyState.applications" :key="a._id">
          <view class="applicant-top">
            <!-- 头像：key 用 'ap' + 申请 _id，逐条独立淡入；空圆是 .avatar--sm，58rpx 与原图一致 -->
            <image
              v-if="avaSrcOf('ap' + a._id)"
              class="avatar avatar--sm avatar--img ava-fade"
              :class="{ 'ava-fade--in': avaReadyOf('ap' + a._id) }"
              :src="avaSrcOf('ap' + a._id)"
              mode="aspectFill"
              @load="avaOnLoad('ap' + a._id)"
              @error="avaOnError('ap' + a._id, a.applicant.avatar_url)"
            />
            <view v-else class="avatar avatar--sm" />
            <view class="applicant-main">
              <view class="owner-name-row">
                <text class="owner-name">{{ a.applicant.nickname }}</text>
                <text class="verified" v-if="a.applicant.is_verified">已认证</text>
              </view>
              <text class="owner-sub">{{ a.applicant.school || '未填学校' }} · 信誉 {{ a.applicant.credit_score }}</text>
            </view>
          </view>
          <text class="applicant-msg" v-if="a.message">「{{ a.message }}」</text>

          <!-- 还没处理：给出同意/婉拒 -->
          <view class="applicant-btns" v-if="a.status === 'pending'">
            <button class="btn btn--ghost btn--half" @tap="decide(a, 'reject')">婉拒</button>
            <button class="btn btn--half" @tap="decide(a, 'accept')">同意，成为搭子</button>
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

      <text class="created">发布于 {{ fmtFull(card.created_at) }}</text>
    </block>

    <!-- ===== 底部常驻操作条 ===== -->
    <view class="actionbar" v-if="card && !card.is_mine">
      <!-- 收藏：只出现在别人的卡上，且必须已登录 —— 没登录点了必然失败，那就是假按钮 -->
      <view class="favbtn" :class="{ 'favbtn--on': favorited }" v-if="hasToken" @tap="toggleFavorite">
        <text class="favbtn-ico">{{ favorited ? '★' : '☆' }}</text>
      </view>
      <text class="action-reason" v-if="!applyState.can_apply">{{ applyState.reason }}</text>
      <block v-else>
        <button class="btn btn--primary btn--grow" @tap="openApply">我想搭</button>
        <button
          class="btn btn--ghost btn--grow"
          v-if="applyState.my_application && applyState.my_application.status === 'pending'"
          @tap="cancelApply"
        >
          撤回申请
        </button>
      </block>
      <button class="btn btn--primary btn--grow" v-if="canChat" @tap="goChat">去聊聊</button>
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
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

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

const VERIFY_PAGE = '/pages/verify/verify'
// 认证态口径：storage userInfo 的 schoolVerified 或 is_verified，两者取或。
// 不用可选链 / 空值合并 —— 项目里有低版本端。
function readVerified() {
  const u = uni.getStorageSync('userInfo') || {}
  return u.schoolVerified === true || u.is_verified === true
}

export default {
  // 头像淡入的公共时序（common/avatar/avatarCache.js）
  mixins: [avatarFadeMixin],
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
      // 浏览上报一次进入只报一次：下拉刷新会再走一遍 fetch，不拦就会重复计数
      browseDone: false,
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
      submitting: false,
      // ---- 收藏 ----
      // 未登录就不显示收藏按钮：收藏是账号级的，点了也只能是失败
      hasToken: false,
      favorited: false,
      // 连点保护：toggle 还没回来时再点一次，会打乱「已收藏/已取消」的最终状态
      favBusy: false
    }
  },

  // 头像：发布者一张 + 申请人若干。card / applyState 都是整对象替换，deep 才能覆盖到嵌套字段。
  watch: {
    card: {
      immediate: true,
      deep: true,
      handler(c) {
        this.avaBind('owner', c && c.owner && c.owner.avatar_url)
      }
    },
    applyState: {
      immediate: true,
      deep: true,
      handler(st) {
        this.avaSync(
          (st && st.applications) || [],
          (a) => 'ap' + (a && a._id),
          (a) => a && a.applicant && a.applicant.avatar_url
        )
      }
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
    },
    // 相对时间：详情页顶部要的是「多新」，不是「几点几分」。
    // 超过 7 天再退回绝对时间 —— 再远相对值就没意义了（「43 天前」不如日期好读）
    createdAgo() {
      const t = this.card && this.card.created_at
      if (!t) return ''
      const diff = Date.now() - t
      if (diff < 60000) return '刚刚'
      const m = Math.floor(diff / 60000)
      if (m < 60) return m + ' 分钟前'
      const h = Math.floor(m / 60)
      if (h < 24) return h + ' 小时前'
      const d = Math.floor(h / 24)
      if (d < 7) return d + ' 天前'
      return this.fmtFull(t)
    }
  },
  onLoad(options) {
    this.id = (options && options.id) || ''
    if (!this.id) {
      this.errMsg = '缺少卡片 id'
      return
    }
    this.hasToken = !!uni.getStorageSync('token')
    this.fetch()
  },
  onPullDownRefresh() {
    this.fetch().then(() => uni.stopPullDownRefresh())
  },
  methods: {
    /** 点图放大：用与卡片同样的顺序，用户点第三张就停在第三张 */
    previewMedia(i) {
      const urls = (this.card && this.card.images) || []
      if (!urls.length) return
      uni.previewImage({ urls, current: urls[i] })
    },

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
        // 数据真的拿到了才记浏览：加载失败/卡片已删的 id 记进历史，点进去还是一次失败
        this.reportBrowse()
        // 回显收藏状态（已收藏 → 实心星）。只查别人的卡，自己的卡没有收藏按钮
        if (this.card && !this.card.is_mine) this.checkFavorite()
      } catch (e) {
        this.errMsg = '云函数 card-detail 调用失败：' + (e.message || '检查是否已部署')
        this.card = null
      } finally {
        this.loading = false
      }
    },

    /**
     * 上报一次浏览（browse-record：{ token, target_type:'card', target_id } → { code:0, data:{ recorded:true } }）。
     * 放在 fetch 成功之后由 fetch 调用，而不是 onLoad 开头：只有用户真的看到卡片才值得进浏览记录。
     * browseDone 兜住下拉刷新与重复 fetch；没有 token 直接跳过，未登录不产生浏览记录。
     * 失败一律静默 —— 少一条浏览记录不该让详情页少任何东西。
     */
    async reportBrowse() {
      if (this.browseDone || !this.id) return
      const token = uni.getStorageSync('token') || ''
      if (!token) return
      this.browseDone = true
      try {
        await uniCloud.callFunction({
          name: 'browse-record',
          data: { token: token, target_type: 'card', target_id: this.id }
        })
      } catch (e) {
        // 静默：上报失败不影响页面任何表现
      }
    },

    /**
     * 详情页进入时回显收藏状态。
     * 失败一律静默：收藏状态拿不到只是少个实心星，不该把整个详情页变成错误页。
     */
    async checkFavorite() {
      if (!this.hasToken || !this.id) return
      try {
        const res = await uniCloud.callFunction({
          name: 'card-favorite',
          data: { action: 'check', token: uni.getStorageSync('token') || '', card_id: this.id }
        })
        const r = res.result || {}
        if (r.code === 0 && r.data) this.favorited = !!r.data.favorited
      } catch (e) {
        // 静默
      }
    },

    /**
     * 收藏 / 取消收藏。
     * 图标以云函数返回的 favorited 为准，不在本地先翻 —— 本地先翻再失败，
     * 用户看到的是「收藏成功」但其实是假的。
     */
    async toggleFavorite() {
      if (!this.hasToken) {
        uni.showToast({ title: '登录后才能收藏', icon: 'none' })
        return
      }
      if (this.favBusy) return
      this.favBusy = true
      try {
        const res = await uniCloud.callFunction({
          name: 'card-favorite',
          data: { action: 'toggle', token: uni.getStorageSync('token') || '', card_id: this.id }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '操作失败', icon: 'none', duration: 2000 })
          return
        }
        this.favorited = !!(r.data && r.data.favorited)
        uni.showToast({ title: this.favorited ? '已收藏' : '已取消收藏', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: '调用 card-favorite 失败，检查是否已部署', icon: 'none', duration: 2500 })
      } finally {
        this.favBusy = false
      }
    },

    openApply() {
      // 申请门槛：未认证先引导去认证，不打开申请弹层
      if (!readVerified()) {
        uni.showModal({
          title: '需要学生认证',
          content: '完成学生认证后才能申请搭子',
          confirmText: '去认证',
          success: (r) => {
            if (r.confirm) uni.navigateTo({ url: VERIFY_PAGE })
          }
        })
        return
      }
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
          // 认证类报错（如「完成学生认证后才能申请搭子」）原样 toast 云函数原文
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

    // 看 TA 的主页。id 走 encodeURIComponent，和 chat.vue 跳 user 页的写法保持一致
    goOwnerProfile() {
      const id = this.card && this.card.owner && this.card.owner._id
      if (!id) return
      uni.navigateTo({ url: '/pages/user/user?id=' + encodeURIComponent(id) })
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
  /* 顶部不留白，导航自己撑；底部留出常驻操作条的高度 */
  padding: 0 31rpx 220rpx;
  box-sizing: border-box;
  background-color: transparent;
}

/* 吸顶导航：滚到哪都看得见返回 */
.nav {
  position: sticky;
  top: 0;
  z-index: 30;
  height: 88rpx;
  margin: 0 -31rpx 20rpx;
  padding-top: var(--status-bar-height);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(249, 242, 232, 0.94);
  backdrop-filter: blur(12rpx);
  -webkit-backdrop-filter: blur(12rpx);
}
/* 返回按钮：用 top/bottom + margin auto 在导航内容区垂直居中。
   原来写 top: statusbar + 12rpx —— absolute 的 top 是相对 nav 的 padding box，
   nav 本身已经有 padding-top: statusbar，等于算了两次，按钮就掉到卡片上了。 */
.nav-back {
  position: absolute;
  left: 22rpx;
  top: 0;
  bottom: 0;
  margin: auto 0;
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-back-arw {
  font-size: 46rpx;
  color: var(--tf-text);
  line-height: 1;
  margin-top: -4rpx;
}
.nav-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}

/* ==========================================================================
   顶栏
   ========================================================================== */


/* 右侧留一个等宽占位，让标题真正居中 */



/* ==========================================================================
   状态页
   ========================================================================== */
.state-box {
  padding: 90rpx 40rpx;
  border-radius: var(--tf-r-lg);
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.state-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.state-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.state-hint {
  margin-top: 14rpx;
  font-size: 24rpx;
  line-height: 1.6;
  text-align: center;
  color: var(--tf-text-2);
}

/* ==========================================================================
   主卡：先说明白，再让用户决定要不要搭
   ========================================================================== */
.hero {
  padding: 34rpx 32rpx 30rpx;
  border-radius: 32rpx;
  background: var(--tf-card-strong);
  border: 2rpx solid var(--tf-card-line);
  box-shadow: 0 10rpx 28rpx rgba(120, 90, 50, 0.09);
}

.hero-row1 {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 15rpx;
}

/* 配图：单张给 420rpx 的横幅，多张两列并排（3 张就是 2+1，不留空档） */
.hero-media {
  display: flex;
  flex-wrap: wrap;
  margin-top: 20rpx;
}
.hero-img {
  display: block;
  width: 100%;
  height: 420rpx;
  border-radius: 16rpx;
  background: var(--tf-bg);
}
.hero-img--multi {
  width: 48%;
  height: 280rpx;
  margin: 0 4% 16rpx 0;
}
/* 两列时第二列不要右边距，否则两张图整体偏左 */
.hero-img--multi:nth-child(2n) {
  margin-right: 0;
}

.type {
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

/* 类型标签：跨色相渐变，和发布页的类型色一致
   学习=蓝 健身=绿 吃饭=橙 拍照=黄 运动=紫 其他=粉 */
.type--study   { color: #1E4A7A; background: linear-gradient(135deg, #C6DEF7 0%, #B2E6EE 100%); }
.type--fitness { color: #33540F; background: linear-gradient(135deg, #D8EBBE 0%, #BEEADA 100%); }
.type--meal    { color: #8A3A1A; background: linear-gradient(135deg, #FFDCC6 0%, #FFC9DA 100%); }
.type--photo   { color: #6E4A00; background: linear-gradient(135deg, #FFEBAE 0%, #FFD8AE 100%); }
.type--sport   { color: #3A2088; background: linear-gradient(135deg, #DACCF9 0%, #C8DAF9 100%); }
.type--other   { color: #8A2A4A; background: linear-gradient(135deg, #FFD2E2 0%, #E8D2F9 100%); }

.status {
  height: 42rpx;
  padding: 0 17rpx;
  display: flex;
  align-items: center;
  border-radius: 15rpx;
  font-size: 20rpx;
  color: var(--tf-text-2);
  background: var(--tf-line-soft);
}

.status--open {
  color: var(--tf-mint);
  background: rgba(201, 221, 196, 0.46);
}

.status--removed {
  color: var(--tf-danger);
  background: rgba(176, 74, 74, 0.12);
}

.mine-tag {
  font-size: 20rpx;
  color: var(--tf-text-2);
}

/* 「发布 12 分钟前」推到最右：它决定这张卡还新不新鲜 */
.hero-ago {
  margin-left: auto;
  font-size: 20rpx;
  color: var(--tf-text-2);
}

.hero-title {
  display: block;
  margin-top: 19rpx;
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.32;
  letter-spacing: -0.02em;
  color: var(--tf-text);
}

.hero-desc {
  display: block;
  margin-top: 15rpx;
  font-size: 26rpx;
  line-height: 1.66;
  color: var(--tf-text-2);
  white-space: pre-wrap;
}

/* ==========================================================================
   发布者
   ========================================================================== */
.owner {
  margin-top: 27rpx;
  padding-top: 25rpx;
  border-top: 2rpx solid var(--tf-line-soft);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 21rpx;
}

.avatar {
  width: 73rpx;
  height: 73rpx;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 29rpx;
  font-weight: 600;
  color: var(--tf-primary);
  background: var(--tf-primary-soft);
  border: 2rpx solid var(--tf-line);
}

.avatar--sm {
  width: 58rpx;
  height: 58rpx;
  font-size: 24rpx;
}

.avatar--img {
  border-radius: 50%;
  overflow: hidden;
  display: block;
  background: var(--tf-card-line);
}
.owner-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.owner-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}

.owner-name {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.verified {
  padding: 3rpx 12rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  font-weight: 600;
  color: var(--tf-mint);
  background: rgba(201, 221, 196, 0.46);
  border: 2rpx solid rgba(95, 130, 108, 0.24);
}

.owner-sub {
  margin-top: 5rpx;
  font-size: 21rpx;
  color: var(--tf-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 不能被名字挤走 —— 挤走就会叠到文字上 */
.owner-go {
  flex: none;
  padding-left: 19rpx;
  font-size: 22rpx;
  font-weight: 600;
  color: var(--tf-primary-deep);
  white-space: nowrap;
}

.owner-bio {
  display: block;
  margin-top: 17rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* ==========================================================================
   地点 / 时间 / 想找：一块三行
   ========================================================================== */
.infoblock {
  margin-top: 19rpx;
  padding: 23rpx 31rpx;
  border-radius: var(--tf-r-md);
  background: rgba(255, 255, 255, 0.50);
  border: 2rpx solid var(--tf-line-soft);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.info-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 21rpx;
  padding: 10rpx 0;
}

.info-row + .info-row {
  border-top: 2rpx solid var(--tf-line-soft);
}

.info-ico {
  width: 58rpx;
  height: 58rpx;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 19rpx;
  background: rgba(31, 92, 172, 0.10);
}

.info-ico-txt {
  font-size: 26rpx;
  line-height: 1;
}

.info-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.info-label {
  font-size: 20rpx;
  color: var(--tf-text-2);
}

.info-value {
  margin-top: 2rpx;
  font-size: 25rpx;
  font-weight: 500;
  line-height: 1.45;
  color: var(--tf-text);
}

/* ==========================================================================
   标签 / 重合
   ========================================================================== */
.overlap {
  margin-top: 19rpx;
  padding: 25rpx 31rpx 27rpx;
  border-radius: var(--tf-r-md);
  background: rgba(255, 255, 255, 0.50);
  border: 2rpx solid var(--tf-line-soft);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.overlap-head {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 8rpx;
}

.overlap-bolt {
  font-size: 22rpx;
}

.overlap-text {
  font-size: 24rpx;
  font-weight: 600;
  color: #37624A;
}

.overlap-num {
  font-size: 29rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #37624A;
}

.overlap-tags {
  margin-top: 21rpx;
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
  background: rgba(201, 221, 196, 0.46);
  border-color: rgba(95, 130, 108, 0.26);
  font-weight: 500;
}

/* ==========================================================================
   发布者视角：收到的申请
   ========================================================================== */
.applicants {
  margin-top: 19rpx;
  padding: 29rpx 31rpx 23rpx;
  border-radius: var(--tf-r-lg);
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.applicants-title {
  display: block;
  font-size: 27rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.applicant {
  padding: 23rpx 0;
  border-bottom: 2rpx solid var(--tf-line-soft);
}

.applicant:last-child {
  border-bottom: none;
}

.applicant-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 17rpx;
}

.applicant-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.applicant-msg {
  display: block;
  margin: 15rpx 0 0 75rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

.applicant-btns {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 15rpx;
  margin: 19rpx 0 0 75rpx;
}

/* 已处理（已同意 / 已婉拒）的提示文字，替代原来的两个按钮 */
.applicant-done {
  flex: 1;
  font-size: 23rpx;
  line-height: 1.6;
  color: var(--tf-mint);
}

.applicant-done--muted {
  color: var(--tf-text-2);
}

.empty-inline {
  display: block;
  padding-top: 15rpx;
  font-size: 23rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
}

.created {
  display: block;
  margin-top: 27rpx;
  padding-left: 8rpx;
  font-size: 21rpx;
  color: var(--tf-text-3);
}

/* ==========================================================================
   底部常驻操作条：浮在内容之上的一块玻璃
   ========================================================================== */
.actionbar {
  position: fixed;
  left: 31rpx;
  right: 31rpx;
  bottom: calc(42rpx + constant(safe-area-inset-bottom));
  bottom: calc(42rpx + env(safe-area-inset-bottom));
  padding: 19rpx;
  display: flex;
  flex-direction: row;
  gap: 19rpx;
  border-radius: 50rpx;
  background: rgba(255, 255, 255, 0.76);
  border: 2rpx solid var(--tf-line);
  box-shadow: 0 31rpx 69rpx rgba(31, 92, 172, 0.18);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  z-index: 10;
}

.action-reason {
  flex: 1;
  padding: 0 15rpx;
  font-size: 23rpx;
  line-height: 76rpx;
  text-align: center;
  color: var(--tf-text-2);
}

/* ==========================================================================
   按钮
   ========================================================================== */
/* 主按钮：绿→蓝渐变。
   原来用 var(--tf-primary) 暖黄配白字，对比度只有 1.49:1。 */
.btn {
  height: 88rpx;
  line-height: 88rpx;
  margin: 0;
  padding: 0 34rpx;
  border-radius: 44rpx;
  font-size: 27rpx;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #8FB86A 0%, #3B7ADB 100%);
  border: none;
  box-shadow: 0 8rpx 20rpx rgba(59, 122, 219, 0.24);
}

.btn::after {
  border: none;
}

.btn--primary {
  background-color: var(--tf-primary);
  color: #fff;
}

.btn--ghost {
  background-color: rgba(255, 255, 255, 0.70);
  color: var(--tf-text-2);
  border-color: var(--tf-line-soft);
  box-shadow: none;
}

.btn--grow {
  flex: 1;
  padding: 0;
  text-align: center;
}

.btn--half {
  flex: 1;
  padding: 0;
  height: 76rpx;
  line-height: 76rpx;
  font-size: 24rpx;
}

.btn--sm {
  flex: none;
  height: 68rpx;
  line-height: 68rpx;
  padding: 0 26rpx;
  font-size: 23rpx;
}

/* 收藏按钮：与三个主按钮同高，但用圆形无底色，不跟「我想搭」抢注意力 */
.favbtn {
  flex: none;
  width: 84rpx;
  height: 84rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.70);
  border: 2rpx solid var(--tf-line-soft);
}

.favbtn-ico {
  font-size: 34rpx;
  line-height: 1;
  color: var(--tf-text-3);
}

/* 已收藏：雾金实心星，颜色是这一条里唯一的强调 */
.favbtn--on {
  background-color: rgba(233, 196, 106, 0.22);
  border-color: rgba(180, 138, 44, 0.34);
}

.favbtn--on .favbtn-ico {
  color: #B4862C;
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
  z-index: 20;
}

.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 36rpx 31rpx;
  padding-bottom: calc(36rpx + env(safe-area-inset-bottom));
  border-radius: var(--tf-r-xl) var(--tf-r-xl) 0 0;
  background-color: rgba(255, 255, 255, 0.94);
  border-top: 2rpx solid var(--tf-line);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  z-index: 21;
  display: flex;
  flex-direction: column;
}

.sheet-title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.sheet-sub {
  display: block;
  margin-top: 10rpx;
  font-size: 25rpx;
  line-height: 1.5;
  color: var(--tf-text-2);
}

.sheet-label {
  display: block;
  margin-top: 26rpx;
  font-size: 23rpx;
  font-weight: 600;
  color: var(--tf-text-2);
}

.sheet-input {
  width: 100%;
  height: 200rpx;
  margin-top: 19rpx;
  padding: 19rpx;
  box-sizing: border-box;
  border-radius: var(--tf-r-sm);
  border: 2rpx solid var(--tf-line-soft);
  background-color: rgba(255, 255, 255, 0.96);
  font-size: 26rpx;
  color: var(--tf-text);
}

.sheet-count {
  display: block;
  margin-top: 10rpx;
  text-align: right;
  font-size: 21rpx;
  color: var(--tf-text-2);
}

.sheet-hint {
  display: block;
  margin-top: 10rpx;
  font-size: 21rpx;
  color: var(--tf-text-2);
}

.sheet-btns {
  display: flex;
  flex-direction: row;
  gap: 15rpx;
  margin-top: 34rpx;
}

.sheet-btns .btn {
  flex: 1;
  padding: 0;
  text-align: center;
}

/* ===== 同意申请后的标签弹层 =====
   与 messages.vue 的接受邀请弹层保持完全一致的视觉与尺寸，
   避免用户在同一件事上看到两套长得不一样的界面。 */
.input-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 84rpx;
  margin-top: 15rpx;
  padding: 0 21rpx;
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
  flex: none;
  margin-left: 10rpx;
  font-size: 27rpx;
  font-weight: 700;
  color: var(--tf-primary);
}

.swatches {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 17rpx;
  margin-top: 15rpx;
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
