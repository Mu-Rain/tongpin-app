<template>
  <view class="page">
    <view class="screen-body">
      <!-- ===== 顶部说明 ===== -->
      <view class="head">
        <text class="head-title">我的好友</text>
        <text class="head-desc">处得来的搭子可以升级成好友，也可以按 UID 精确搜人。</text>
      </view>

      <!-- ===== 搜人区（两个 tab 都可见） ===== -->
      <view class="search-box">
        <input
          class="search-input"
          v-model="keyword"
          type="number"
          maxlength="8"
          :focus="searchFocus"
          confirm-type="search"
          placeholder="输入对方 UID（8 位数字）"
          @input="onSearchInput"
        />
        <text v-if="keyword" class="search-clear" @tap="clearSearch">✕</text>
      </view>

      <view v-if="searching" class="hint">搜索中…</view>
      <!-- UID 没输满：边输边提示，不发请求，也不显示「没找到」 -->
      <view v-else-if="keyword && !isUidKw" class="hint">{{ uidHint }}</view>
      <view v-else-if="selfHit" class="hint">这是你自己的 UID</view>
      <view v-else-if="results.length" class="card">
        <view v-for="u in results" :key="u.user_id" class="row">
          <!-- 头像：common/avatar/avatarCache.js —— 本地落盘 + 解码完成后整体淡入。
               key 用 'fr' + user_id：同一个人多次渲染不变，淡入不会反复触发。
               没有可用本地路径就留同尺寸空圆，绝不塞默认头像图。 -->
          <image
            v-if="avaSrcOf('fr' + u.user_id)"
            class="avatar avatar--img ava-fade"
            :class="{ 'ava-fade--in': avaReadyOf('fr' + u.user_id) }"
            :src="avaSrcOf('fr' + u.user_id)"
            mode="aspectFill"
            lazy-load="true"
            @load="avaOnLoad('fr' + u.user_id)"
            @error="avaOnError('fr' + u.user_id, u.avatar_url)"
          />
          <view v-else class="avatar" />
          <view class="row-main">
            <view class="row-name-line">
              <text class="row-name">{{ u.name }}</text>
              <text v-if="u.verified" class="verified">认证</text>
            </view>
            <view v-if="u.school || u.uid" class="row-meta">
              <text v-if="u.school" class="tag">{{ u.school }}</text>
              <text v-if="u.uid" class="user-no">UID {{ u.uid }}</text>
            </view>
          </view>
          <text v-if="u.request_state === 'friend'" class="state">已是好友</text>
          <text v-else-if="u.request_state === 'out_pending'" class="state">已申请</text>
          <button
            v-else-if="u.request_state === 'in_pending'"
            class="btn btn--sm"
            :disabled="acting"
            @tap="goPendingTab"
            >去待处理</button
          >
          <button
            v-else
            class="btn btn--sm btn--orange"
            :disabled="acting"
            @tap="sendRequest(u)"
            >加好友</button
          >
        </view>
      </view>
      <view v-else-if="searched" class="hint">没找到这个 UID 对应的用户</view>

      <!-- ===== 两个 tab ===== -->
      <view class="tabs">
        <view class="tab" :class="{ 'tab--on': tab === 'friends' }" @tap="switchTab('friends')">
          <text class="tab-text">我的好友 ({{ friendTotal }})</text>
        </view>
        <view class="tab" :class="{ 'tab--on': tab === 'pending' }" @tap="switchTab('pending')">
          <text class="tab-text">待处理 ({{ pendingTotal }})</text>
          <text v-if="pendingTotal > 0" class="tab-badge">{{ pendingTotal }}</text>
        </view>
      </view>

      <!-- ===== 加载 ===== -->
      <view v-if="loading" class="hint">正在加载…</view>

      <block v-else>
        <!-- ===== 我的好友 ===== -->
        <view v-if="tab === 'friends'">
          <view v-if="!friends.length" class="empty">
            <text class="empty-title">还没有好友</text>
            <text class="empty-desc">处得来的搭子可以升级成好友，也可以按 UID 精确搜人</text>
            <button class="btn btn--block" @tap="focusSearch">搜人加好友</button>
          </view>

          <view v-else class="card">
            <view v-for="f in friends" :key="f.user_id" class="row" @tap="openChat(f)">
              <!-- 头像：key 用 'fd' + user_id，逐人独立淡入；空圆 .avatar 尺寸与图片一致 -->
              <image
                v-if="avaSrcOf('fd' + f.user_id)"
                class="avatar avatar--img ava-fade"
                :class="{ 'ava-fade--in': avaReadyOf('fd' + f.user_id) }"
                :src="avaSrcOf('fd' + f.user_id)"
                mode="aspectFill"
                lazy-load="true"
                @load="avaOnLoad('fd' + f.user_id)"
                @error="avaOnError('fd' + f.user_id, f.avatar_url)"
              />
              <view v-else class="avatar" />
              <view class="row-main">
                <view class="row-name-line">
                  <text class="row-name">{{ displayName(f) }}</text>
                  <text v-if="f.verified" class="verified">认证</text>
                </view>
                <!-- 起过备注时把真实昵称降级成灰色小字，跟个人主页一致 -->
                <text v-if="rawName(f)" class="row-realname">用户名：{{ rawName(f) }}</text>
                <view v-if="f.school" class="row-meta">
                  <text class="tag">{{ f.school }}</text>
                </view>
              </view>
              <button class="btn btn--sm btn--orange" @tap.stop="openChat(f)">聊聊</button>
            </view>
          </view>
        </view>

        <!-- ===== 待处理 ===== -->
        <view v-else>
          <view v-if="!inList.length && !outList.length" class="empty">
            <text class="empty-title">没有待处理的申请</text>
            <text class="empty-desc">别人申请加你、或者你发出去的申请，都会出现在这里</text>
          </view>

          <block v-else>
            <block v-if="inList.length">
              <text class="section-label">别人想加你</text>
              <view class="card">
                <view v-for="r in inList" :key="r.request_id" class="row">
                  <!-- 头像：key 用 'fin' + request_id；空圆 .avatar 尺寸与图片一致 -->
                  <image
                    v-if="avaSrcOf('fin' + r.request_id)"
                    class="avatar avatar--img ava-fade"
                    :class="{ 'ava-fade--in': avaReadyOf('fin' + r.request_id) }"
                    :src="avaSrcOf('fin' + r.request_id)"
                    mode="aspectFill"
                    lazy-load="true"
                    @load="avaOnLoad('fin' + r.request_id)"
                    @error="avaOnError('fin' + r.request_id, r.avatar_url)"
                  />
                  <view v-else class="avatar" />
                  <view class="row-main">
                    <view class="row-name-line">
                      <text class="row-name">{{ r.name }}</text>
                      <text v-if="r.verified" class="verified">认证</text>
                    </view>
                    <view v-if="r.school" class="row-meta">
                      <text class="tag">{{ r.school }}</text>
                    </view>
                  </view>
                  <view class="row-ops">
                    <button
                      class="btn btn--sm btn--orange"
                      :disabled="acting"
                      @tap="accept(r)"
                      >同意</button
                    >
                    <button class="btn btn--sm" :disabled="acting" @tap="reject(r)">拒绝</button>
                  </view>
                </view>
              </view>
            </block>

            <block v-if="outList.length">
              <text class="section-label">你发出去的</text>
              <view class="card">
                <view v-for="r in outList" :key="r.request_id" class="row">
                  <!-- 头像：key 用 'fout' + request_id；空圆 .avatar 尺寸与图片一致 -->
                  <image
                    v-if="avaSrcOf('fout' + r.request_id)"
                    class="avatar avatar--img ava-fade"
                    :class="{ 'ava-fade--in': avaReadyOf('fout' + r.request_id) }"
                    :src="avaSrcOf('fout' + r.request_id)"
                    mode="aspectFill"
                    lazy-load="true"
                    @load="avaOnLoad('fout' + r.request_id)"
                    @error="avaOnError('fout' + r.request_id, r.avatar_url)"
                  />
                  <view v-else class="avatar" />
                  <view class="row-main">
                    <view class="row-name-line">
                      <text class="row-name">{{ r.name }}</text>
                      <text v-if="r.verified" class="verified">认证</text>
                    </view>
                    <view v-if="r.school" class="row-meta">
                      <text class="tag">{{ r.school }}</text>
                    </view>
                  </view>
                  <button class="btn btn--sm" :disabled="acting" @tap="cancel(r)">撤回</button>
                </view>
              </view>
            </block>
          </block>
        </view>
      </block>
    </view>
  </view>
</template>

<script>
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

/**
 * 搜人防抖的定时器。
 * ★ 必须放在模块级（不是 data）：每次输入都重新 setTimeout，
 *   data 里放定时器 id 会被 Vue3 当成响应式数据、还会在下划线前缀上报警告。
 */
let searchTimer = null

export default {
  // 头像淡入的公共时序（common/avatar/avatarCache.js）
  mixins: [avatarFadeMixin],
  data() {
    return {
      // friends / pending 两个 tab
      tab: 'friends',
      loading: true,
      // 好友列表（friend-list）
      friends: [],
      // 待处理：in = 别人想加你，out = 你发出去的（friend-request list）
      inList: [],
      outList: [],
      // friend-list 返回的 pending_count，用来做「待处理」角标
      pendingCount: 0,
      // 搜人
      keyword: '',
      results: [],
      searching: false,
      // 搜过一次没有（用来区分「没找到」和「还没搜」）
      searched: false,
      // 搜到的就是自己：和「没找到」区分开，否则页面会说你自己的号不存在
      selfHit: false,
      searchFocus: false,
      // 同意 / 拒绝 / 撤回 / 加好友 的并发锁，防连点
      acting: false
    }
  },

  // 头像：本页四条列表各用各的前缀，互不串号（同一个 id 在不同列表里含义不同）。
  watch: {
    results: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (u) => 'fr' + (u && u.user_id),
          (u) => u && u.avatar_url
        )
      }
    },
    friends: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (f) => 'fd' + (f && f.user_id),
          (f) => f && f.avatar_url
        )
      }
    },
    inList: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (r) => 'fin' + (r && r.request_id),
          (r) => r && r.avatar_url
        )
      }
    },
    outList: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (r) => 'fout' + (r && r.request_id),
          (r) => r && r.avatar_url
        )
      }
    }
  },

  computed: {
    friendTotal() {
      return this.friends.length
    },
    pendingTotal() {
      return this.pendingCount
    },
    /**
     * 关键词是不是一个完整的 UID。
     * ★ 对外唯一身份号只有 UID（8 位数字，首位非 0），昵称允许重名、
     *   手机号已退成登录凭据不再对外搜索，
     *   所以必须凑满 8 位才发请求 —— 否则每敲一位就打一次云函数。
     */
    isUidKw() {
      return /^[1-9]\d{7}$/.test(String(this.keyword || '').trim())
    },
    /**
     * 没到 8 位 / 8 位但格式不对，提示语要分开：
     * 输到 8 位还提示「输完才会搜」，用户会以为自己没输完。
     */
    uidHint() {
      const k = String(this.keyword || '').trim()
      if (k.length >= 8) return 'UID 是 8 位数字，且不以 0 开头'
      return 'UID 是 8 位数字，输完才会开始搜'
    }
  },

  onShow() {
    // 从别处回来时 pending_count 可能变了，整页重拉
    this.refreshAll()
  },

  onPullDownRefresh() {
    this.refreshAll().then(() => {
      uni.stopPullDownRefresh()
    })
  },

  onUnload() {
    // 页面销毁时清掉未触发的防抖，避免在已卸载的页面上 setData 报错
    if (searchTimer) {
      clearTimeout(searchTimer)
      searchTimer = null
    }
  },

  methods: {
    /**
     * 好友列表显示名：起过备注就显示备注，并把真实昵称降级成灰色小字。
     * 备注由 user-remark 云函数按人存（owner_id → target_user_id），
     * friend-list 已经把它带在 remark 字段上，这里只负责显示。
     */
    displayName(u) {
      if (!u) return ''
      return u.remark || u.name || ''
    },

    /** 有备注时返回真实昵称（渲染成灰色小字），没备注返回空串不占位 */
    rawName(u) {
      if (!u || !u.remark) return ''
      return u.name || ''
    },
    async refreshAll() {
      // 好友列表与待处理申请是两个接口、两处状态，彼此不依赖：并发发。
      // 两者内部各自 try/catch（失败只 toast / 静默），一个挂不会拖垮另一个；
      // Promise.all 只把两个 RTT 压成一个。
      await Promise.all([this.loadFriends(), this.loadRequests()])
    },

    /* ---------------- 列表 ---------------- */

    async loadFriends() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.loading = false
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'friend-list',
          data: { token: token, action: 'list' }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '加载失败', icon: 'none', duration: 2500 })
          return
        }
        const d = r.data || {}
        this.friends = d.list || []
        this.pendingCount = d.pending_count || 0
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      } finally {
        this.loading = false
      }
    },

    /** 待处理：in 与 out 各拉一次。失败静默，不打断好友列表。 */
    async loadRequests() {
      const token = uni.getStorageSync('token') || ''
      if (!token) return
      try {
        // in / out 是同一次查询的两个 box，各查各的、顺序无关：并发发。
        const pair = await Promise.all([
          uniCloud.callFunction({
            name: 'friend-request',
            data: { token: token, action: 'list', box: 'in' }
          }),
          uniCloud.callFunction({
            name: 'friend-request',
            data: { token: token, action: 'list', box: 'out' }
          })
        ])
        const ir = (pair[0] && pair[0].result) || {}
        if (ir.code === 0) this.inList = (ir.data && ir.data.list) || []
        const orr = (pair[1] && pair[1].result) || {}
        if (orr.code === 0) this.outList = (orr.data && orr.data.list) || []
      } catch (e) {
        // 静默：申请列表拉不到不影响好友列表
      }
    },

    switchTab(t) {
      this.tab = t
    },

    goPendingTab() {
      this.tab = 'pending'
    },

    /* ---------------- 搜人 ---------------- */

    onSearchInput(e) {
      // v-model 已经写过 this.keyword，这里再取一次，保证纯事件调用也正确
      let v = (e && e.detail && e.detail.value) || ''
      // type=number 的 maxlength 在部分安卓 WebView 上不生效，粘贴长串会超；
      // 这里硬截一次，否则后面的「8 位」判断和输入框里的内容会对不上。
      if (v.length > 8) v = v.slice(0, 8)
      this.keyword = v

      if (searchTimer) {
        clearTimeout(searchTimer)
        searchTimer = null
      }

      const kw = v.trim()
      if (!kw) {
        this.results = []
        this.searched = false
        this.selfHit = false
        this.searching = false
        return
      }

      // 没凑满 8 位 UID：不发请求，页面直接提示「输完才会搜」。
      // ★ 这里把 searching 关掉很重要：否则会一直卡在「搜索中…」。
      if (!/^[1-9]\d{7}$/.test(kw)) {
        this.results = []
        this.searched = false
        this.selfHit = false
        this.searching = false
        return
      }

      this.searching = true
      searchTimer = setTimeout(() => {
        searchTimer = null
        this.doSearch(kw)
      }, 300)
    },

    async doSearch(kw) {
      // 兜底：只有完整 UID 才查库（onSearchInput 已经拦过一道）
      if (!/^[1-9]\d{7}$/.test(String(kw || '').trim())) {
        this.searching = false
        return
      }
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.searching = false
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'friend-search',
          data: { token: token, keyword: kw }
        })
        // 请求回来时用户又改了关键词 → 这份结果已经过期，丢掉
        if (kw !== String(this.keyword || '').trim()) return
        const r = res.result || {}
        this.searching = false
        this.searched = true
        if (r.code !== 0) {
          this.results = []
          this.selfHit = false
          uni.showToast({ title: r.msg || '搜索失败', icon: 'none', duration: 2500 })
          return
        }
        this.results = (r.data && r.data.list) || []
        // 搜到自己：接口给 self 标记，页面提示「这是你自己的 UID」
        this.selfHit = !!(r.data && r.data.self)
      } catch (e) {
        if (kw !== String(this.keyword || '').trim()) return
        this.searching = false
        this.searched = true
        this.results = []
        this.selfHit = false
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      }
    },

    clearSearch() {
      if (searchTimer) {
        clearTimeout(searchTimer)
        searchTimer = null
      }
      this.keyword = ''
      this.results = []
      this.searched = false
      this.selfHit = false
      this.searching = false
    },

    focusSearch() {
      this.searchFocus = true
    },

    /* ---------------- 申请动作 ---------------- */

    /** 搜人结果里点「加好友」 */
    async sendRequest(u) {
      if (this.acting) return
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      this.acting = true
      try {
        const res = await uniCloud.callFunction({
          name: 'friend-request',
          data: {
            token: token,
            action: 'send',
            to_user_id: u.user_id,
            source: 'search'
          }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '申请失败', icon: 'none', duration: 2500 })
          return
        }
        // 本地直接改成「已申请」，不重拉整个搜索结果
        u.request_state = 'out_pending'
        uni.showToast({ title: '申请已发出', icon: 'none' })
        // 顺手刷新「你发出去的」，失败静默
        this.loadRequests()
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      } finally {
        this.acting = false
      }
    },

    /** 同意：静默，不需要二次确认（同意是正向操作） */
    async accept(r) {
      if (this.acting) return
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      this.acting = true
      try {
        const res = await uniCloud.callFunction({
          name: 'friend-request',
          data: { token: token, action: 'accept', request_id: r.request_id }
        })
        const rr = res.result || {}
        if (rr.code !== 0) {
          uni.showToast({ title: rr.msg || '操作失败', icon: 'none', duration: 2500 })
          return
        }
        uni.showToast({ title: '已经是好友了', icon: 'success', duration: 1200 })
        await this.refreshAll()
        this.tab = 'friends'
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      } finally {
        this.acting = false
      }
    },

    /** 拒绝：破坏性操作，二次确认 */
    reject(r) {
      uni.showModal({
        title: '拒绝这条申请？',
        content: '拒绝后对方会收到通知，你们还是能互相看到资料。',
        confirmText: '拒绝',
        confirmColor: '#F04438',
        cancelText: '再想想',
        success: (m) => {
          if (m.confirm) this.doReject(r)
        }
      })
    },

    async doReject(r) {
      if (this.acting) return
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      this.acting = true
      try {
        const res = await uniCloud.callFunction({
          name: 'friend-request',
          data: { token: token, action: 'reject', request_id: r.request_id }
        })
        const rr = res.result || {}
        if (rr.code !== 0) {
          uni.showToast({ title: rr.msg || '操作失败', icon: 'none', duration: 2500 })
          return
        }
        this.inList = this.inList.filter((x) => x.request_id !== r.request_id)
        uni.showToast({ title: '已拒绝', icon: 'none' })
        await this.loadFriends()
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      } finally {
        this.acting = false
      }
    },

    /** 撤回：破坏性操作，二次确认 */
    cancel(r) {
      uni.showModal({
        title: '撤回这条申请？',
        content: '撤回后对方就看不到这条申请了。',
        confirmText: '撤回',
        confirmColor: '#F04438',
        cancelText: '再想想',
        success: (m) => {
          if (m.confirm) this.doCancel(r)
        }
      })
    },

    async doCancel(r) {
      if (this.acting) return
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }
      this.acting = true
      try {
        const res = await uniCloud.callFunction({
          name: 'friend-request',
          data: { token: token, action: 'cancel', request_id: r.request_id }
        })
        const rr = res.result || {}
        if (rr.code !== 0) {
          uni.showToast({ title: rr.msg || '操作失败', icon: 'none', duration: 2500 })
          return
        }
        this.outList = this.outList.filter((x) => x.request_id !== r.request_id)
        uni.showToast({ title: '已撤回', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      } finally {
        this.acting = false
      }
    },

    /* ---------------- 跳转 ---------------- */

    openChat(f) {
      if (!f.conversation_id) {
        uni.showToast({ title: '这个好友还没有会话记录', icon: 'none' })
        return
      }
      const q =
        'conversation_id=' + encodeURIComponent(f.conversation_id) +
        '&peer_id=' + encodeURIComponent(f.user_id || '') +
        '&name=' + encodeURIComponent(this.displayName(f) || '') +
        '&school=' + encodeURIComponent(f.school || '')
      uni.navigateTo({ url: '/pages/chat/chat?' + q })
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: transparent;
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
  color: var(--tf-text-2);
  line-height: 1.5;
}

.hint {
  text-align: center;
  color: var(--tf-text-2);
  font-size: 24rpx;
  padding: 40rpx 0;
}

/* —— 搜人区 —— */
.search-box {
  display: flex;
  align-items: center;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-md);
  background: rgba(255, 255, 255, 0.96);
  padding: 0 20rpx;
  height: 84rpx;
}
.search-input {
  flex: 1;
  font-size: 28rpx;
  height: 84rpx;
}
.search-clear {
  font-size: 28rpx;
  color: var(--tf-text-2);
  padding-left: 16rpx;
  flex: none;
}

/* —— tab —— */
.tabs {
  display: flex;
  gap: 12rpx;
}
.tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-md);
  background: var(--tf-card-strong);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  padding: 14rpx 0;
}
.tab--on {
  background: var(--tf-primary);
  border-color: transparent;
}
.tab-text {
  font-size: 26rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.tab--on .tab-text {
  color: #fff;
}
.tab-badge {
  font-size: 20rpx;
  font-weight: 800;
  color: #fff;
  background: var(--tf-primary);
  padding: 0 10rpx;
}

/* —— 列表卡 —— */
.card {
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  padding: 8rpx 20rpx;
}
.row {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 20rpx 0;
  border-bottom: 2rpx dashed var(--tf-line-soft);
}
.row:last-child {
  border-bottom: none;
}
.avatar {
  width: 84rpx;
  height: 84rpx;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 50%;
  background: var(--tf-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 30rpx;
  flex: none;
  overflow: hidden;
}
.avatar--img {
  border-radius: 50%;
  overflow: hidden;
  display: block;
  background: var(--tf-card-line);
}
.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.row-name-line {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.row-realname {
  display: block;
  font-size: 22rpx;
  color: var(--tf-text-2);
  margin-top: 2rpx;
}
.row-name {
  font-weight: 800;
  font-size: 28rpx;
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
.row-meta {
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
.user-no {
  font-size: 20rpx;
  color: var(--tf-text-2);
}
.row-ops {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex: none;
}
/* 不可点的状态文字：不给按钮，只说明情况 */
.state {
  font-size: 22rpx;
  color: var(--tf-text-2);
  flex: none;
}

.section-label {
  font-size: 22rpx;
  font-weight: 700;
  color: var(--tf-text-2);
  display: block;
  padding: 6rpx 0 12rpx;
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
  line-height: 1.6;
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
  margin: 0;
  flex: none;
}
.btn--sm {
  height: 60rpx;
  line-height: 54rpx;
  font-size: 24rpx;
  padding: 0 20rpx;
}
.btn--block {
  width: 100%;
  flex: none;
}
.btn--orange {
  background: var(--tf-primary);
  border-color: rgba(255, 255, 255, 0.22);
  color: #fff;
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
