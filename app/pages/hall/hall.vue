<template>
  <view class="page">

    <!-- ===== 头图：渐变底 + 艺术字标题（原生导航栏已关掉，这块顶到状态栏） ===== -->
    <view class="hall-hero">
      <view class="hero-blob b1" />
      <view class="hero-blob b2" />
      <view class="hall-back" @tap="goBack">
        <text class="hall-back-arw">‹</text>
      </view>
      <text class="hall-title">搭子大厅</text>
      <text class="hall-sub">{{ scopeLabel }}</text>
    </view>

    <!-- ===== 范围切换：推荐 / 同校 / 附近 / 城市 ===== -->
    <view class="seg">
      <view
        class="seg-item"
        :class="{ 'seg-item--on': scope === s.key }"
        v-for="s in SCOPES"
        :key="s.key"
        @tap="setScope(s.key)"
      >
        <text class="seg-lock" v-if="s.key === 'school' && !verified">🔒</text>
        <text
          class="seg-text"
          :class="{ 'seg-text--on': scope === s.key, 'seg-text--lock': s.key === 'school' && !verified }"
        >{{ s.label }}</text>
      </view>
    </view>

    <!-- ===== 定位入口：显示当前定位名（geo_name），点开换一个 / 重新定位 =====
         只认本地缓存 userGeo，定位一次就一直用 —— 进页面不自动定位。 -->
    <view class="geo-row">
      <view class="geo-btn" @tap="openGeoSheet">
        <text class="geo-ico">◎</text>
        <text class="geo-name">{{ geoName || '未定位' }}</text>
        <text class="geo-arw">›</text>
      </view>
      <text class="geo-hint" v-if="!hasGeo">还没定位，点这里定位</text>
    </view>

    <!-- ===== 类型筛选 ===== -->
    <scroll-view class="chips" scroll-x :show-scrollbar="false">
      <view class="chip-row">
        <view class="chip" :class="{ 'chip--on': type === '' }" @tap="setType('')">
          <text class="chip-text" :class="{ 'chip-text--on': type === '' }">全部</text>
        </view>
        <view
          class="chip"
          :class="{ 'chip--on': type === t.key }"
          v-for="t in TYPES"
          :key="t.key"
          @tap="setType(t.key)"
        >
          <text class="chip-text" :class="{ 'chip-text--on': type === t.key }">{{ t.label }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- ===== 一键匹配（文档 §6）=====
         从「浅色小条」升级为本页核心卡片：
         这是本页唯一有产品想象力的功能，必须是最显眼的东西之一。
         卡片本身用主色实色底（视觉重心），按钮反过来用白底 ——
         发布条撤掉后它是页面上唯一的实色大块，仍守住「一屏单实色按钮」（§3.3）。 -->
    <view class="matchcard">
      <view class="mc-top">
        <view class="mc-ico"><text class="mc-ico-txt">⚡</text></view>
        <view class="mc-head">
          <text class="mc-title">一键匹配</text>
          <text class="mc-sub">按标签贴合度，找出最合拍的需求</text>
        </view>
      </view>
      <view class="mc-body">
        <text class="mc-hint" v-if="total > 0">已为你比对 {{ total }} 条需求</text>
        <text class="mc-hint" v-else>填好标签后，匹配会更准</text>
      </view>
      <view class="mc-btn" @tap="goMatch">开始匹配</view>
    </view>

    <!-- ===== 筛选降级说明：只有真降级了才出现 ===== -->
    <view class="degrade" v-if="degradeTip">
      <text class="degrade-text">{{ degradeTip }}</text>
    </view>

    <!-- ===== 分组标题 ===== -->
    <view class="sechead" v-if="list.length > 0">
      <text class="sechead-title">{{ syncCount > 0 ? '本页 ' + syncCount + ' 条与你同频' : '本页暂无同频' }}</text>
      <text class="sechead-more">按贴合度排序</text>
    </view>

    <!-- ===== 空态 ===== -->
    <!-- 空态（文档 §6 / §10.2）：
         发布入口整体搬去首页了，大厅这里不再挂任何发布 CTA ——
         一屏两个主 CTA 是文档明确禁止的，空态只留筛选相关的次级动作。
         同校频道未认证时给「去认证」，其余档只留描边的「看附近」。
         「推荐」档不给「看附近」：它本来就含附近，切过去只会更空，是死路。 -->
    <view class="empty-box" v-if="!loading && list.length === 0">
      <text class="empty-title">{{ emptyTitle }}</text>
      <text class="empty-hint">{{ emptyHint }}</text>
      <view class="empty-actions">
        <view class="empty-btn empty-btn--ghost" v-if="scope !== 'all'" @tap="setScope('nearby')">看附近</view>
        <view class="empty-btn empty-btn--main" v-if="needVerify" @tap="goVerify">去认证</view>
      </view>
    </view>

    <!-- ===== 卡片流 ===== -->
    <view>
      <view class="dcard" v-for="c in list" :key="c._id" @tap="openDetail(c)">
        <view class="dcard-head">
          <image v-if="avaSrcOf('c' + c._id)" class="avatar avatar--img ava-fade" :class="{ 'ava-fade--in': avaReadyOf('c' + c._id) }" :src="avaSrcOf('c' + c._id)" mode="aspectFill" lazy-load="true" @load="avaOnLoad('c' + c._id)" @error="avaOnError('c' + c._id, c.owner && c.owner.avatar_url)" />
          <view v-else class="avatar avatar--img" />
          <view class="dcard-who">
            <view class="dcard-name-row">
              <text class="dcard-name">{{ c.owner.nickname }}</text>
              <text class="verified" v-if="c.owner.is_verified">已认证</text>
            </view>
            <text class="dcard-meta">{{ c.owner.school || '未填学校' }} · 信誉 {{ c.owner.credit_score }}</text>
          </view>
          <text class="type" :class="'type--' + c.type">{{ typeLabel(c.type) }}</text>
        </view>

        <text class="dcard-title">{{ c.title }}</text>
        <text class="dcard-desc">{{ c.description }}</text>

        <!-- 标签：与我重合的高亮 -->
        <view class="dcard-tags" v-if="c.tags.length">
          <text
            class="tag"
            :class="{ 'tag--hit': c.common_tags.indexOf(t._id) > -1 }"
            v-for="t in c.tags"
            :key="t._id"
          >
            {{ t.name }}
          </text>
        </view>

        <view class="dcard-foot">
          <text class="foot-item" v-if="c.location_name">📍 {{ c.location_name }}</text>
          <text class="foot-item" v-if="c.start_time">🕐 {{ fmtTime(c.start_time) }}</text>
          <text class="foot-item foot-item--hit" v-if="c.common_tag_count > 0">
            同频 {{ c.common_tag_count }} 个
          </text>
          <text class="foot-item foot-item--mine" v-if="c.is_mine">我发的</text>
        </view>
      </view>
    </view>

    <!-- ===== 加载更多 ===== -->
    <view class="more" v-if="list.length > 0">
      <text class="more-text" v-if="loading">加载中…</text>
      <text class="more-text" v-else-if="hasMore" @tap="loadMore">上拉或点这里加载更多</text>
      <text class="more-text more-text--end" v-else>— 到底了 —</text>
    </view>
  </view>
</template>

<script>
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

const TYPES = [
  { key: 'study', label: '学习' },
  { key: 'fitness', label: '健身' },
  { key: 'photo', label: '拍照' },
  { key: 'meal', label: '吃饭' },
  { key: 'sport', label: '运动' },
  { key: 'other', label: '其他' }
]

// 「推荐」档 = 全站全部 open 需求（scope='all'）：大厅是所有搭子需求的中心，
// 只有翻得到全站才叫中心。档位标签仍然逐卡算（同校 / 附近 / 城市 / 全站），
// 排序交给服务端 —— 这里只负责把 key 传下去。
const SCOPES = [
  { key: 'all', label: '推荐' },
  { key: 'school', label: '同校' },
  { key: 'nearby', label: '附近' },
  { key: 'city', label: '城市' }
]

const TYPE_LABEL = {}
TYPES.forEach((t) => {
  TYPE_LABEL[t.key] = t.label
})

const PAGE_SIZE = 20

export default {
  mixins: [avatarFadeMixin],
  data() {
    return {
      TYPES,
      SCOPES,
      type: '',
      // 默认落在「推荐」= 全站全部 open 需求（card-list scope='all'）。
      // 首页是它的子集（同城优先，不够才补位），所以首页看到的卡片在大厅
      // 「推荐」里一定翻得到；反过来不成立 —— 大厅是全集，首页是推荐子集。
      scope: 'all',
      list: [],
      page: 1,
      hasMore: false,
      loading: false,
      // 云函数返回的总条数（card-list 的 data.total），给页头副标题用
      total: 0,
      emptyReason: '',
      // 筛选被降级时的标记（由 card-list 返回）：''=正常筛选；
      // no_city / nearby_as_school / no_location = 没城市码，退回了更大范围
      degraded: '',
      // 卡片详情页已接入（第 4 天），点卡片直接跳转
      detailTip: '',
      // ——— 定位（契约：uni-id-users 的 geo_lat / geo_lng / geo_name / geo_at）———
      // 只认本地缓存 userGeo：定位一次后一直有效，除非用户主动重新定位。
      // 所以 onShow 里不做自动定位 —— 那块更耗电，也不该每次进页面都弹权限框。
      geoName: '',
      geoLat: 0,
      geoLng: 0,
      // 有没有可用坐标：决定「还没定位」那句提示要不要出现
      hasGeo: false,
      locating: false,
      // 学生认证状态（storage userInfo 的 schoolVerified / is_verified 取或）。
      // 同校档只对已认证用户开放：未认证时 chip 是锁定态，点了不切档。
      verified: false
    }
  },
  computed: {
    emptyTitle() {
      // 「还没开放」单独出现是禁用词（文档 §10.3），改成说明条件
      if (this.emptyReason === 'no_school') return '同校频道需要认证后进入'
      // 四档各自的空态：all（推荐）/ school / nearby / city
      if (this.scope === 'all') return '全站暂时还没有搭子'
      if (this.scope === 'school') return '同校暂时还没有搭子'
      if (this.scope === 'nearby') return '附近暂时还没有搭子'
      if (this.scope === 'city') return '你所在的城市暂时还没有搭子'
      return '这个筛选下还没有搭子'
    },
    emptyHint() {
      if (this.emptyReason === 'no_school') {
        return '完成学生认证就能看到同校的人。也可以先切到「附近」或「城市」。'
      }
      if (this.scope === 'all') {
        return '推荐档就是全站的全部需求，现在还没有人发。换个类型看看，或者自己发一条需求。'
      }
      if (this.scope === 'school') {
        return '同校还没有人发需求，换个类型看看，或者切到「推荐」看全站。'
      }
      if (this.scope === 'nearby') {
        return '附近还没有人发需求，切到「推荐」或「城市」能看到更多。'
      }
      if (this.scope === 'city') {
        return '同城还没有人发需求，切到「推荐」能看到全站的需求。'
      }
      return '换个筛选条件或类型看看，也可以切到「附近」或「城市」。'
    },
    // 空态是否要显示「去认证」（同校频道未开放时才显示）
    needVerify() {
      return this.emptyReason === 'no_school'
    },
    // 筛选被降级时的说明。必须显示出来，否则用户以为「附近」已经筛过一遍，
    // 实际看到的是全站 —— 这种「看起来对了」的假象比直接报错更糟。
    degradeTip() {
      if (this.degraded === 'nearby_as_school') return '没填城市，先在全校范围内找'
      if (this.degraded === 'no_location') return '还没填学校和城市，先看看全站的人'
      if (this.degraded === 'no_city') return '还没填城市，先看看全站的人'
      // 未认证用户落在同校档：云函数按契约返回 degraded = 'need_verify'
      if (this.degraded === 'need_verify') return '完成学生认证后才能看同校'
      return ''
    },
    // 与我有重合标签的卡片数：给列表上方的分组标题用。
    // 只用当前已加载的 list 算，不额外请求 —— 所以文案写「本页 N 条」，
    // 不写「共 N 条」（那会把 20 条说成全站总数）
    syncCount() {
      return this.list.filter((c) => c.common_tag_count > 0).length
    },
    // 页头副标题：学校 + 总条数。total 来自 card-list 的 data.total，
    // 是真实的筛选结果总数（不是当前页条数）
    scopeLabel() {
      const info = uni.getStorageSync('userInfo') || {}
      const head = info.school ? info.school + ' · ' : ''
      if (this.loading && !this.total) return head + '正在加载…'
      // 文档 §10.1「不汇报库存」：0 时不裸展示计数，改成邀请参与
      if (!this.total) {
        // 推荐档本身就是全站，连全站都空了，不该再说「成为你们学校第一个」
        if (this.scope === 'all') return head + '全站暂时还没有需求'
        return head + '成为你们学校第一个发需求的人'
      }
      if (this.scope === 'all') return head + '全站 ' + this.total + ' 条需求'
      return head + this.total + ' 条需求'
    }
  },
  onLoad() {
    this.syncVerified()
    this.loadGeo()
    this.refresh()
  },
  // 回到大厅时刷新一次，不然别处刚发的卡片看不到
  onShow() {
    // 可能刚从认证页回来，认证状态要重读一次（只读缓存，不发请求）。
    // 定位不在这里做 —— 定位一次就一直保存，除非用户自己点重新定位。
    this.syncVerified()
    if (this.loadedOnce) this.refresh()
    this.loadedOnce = true
  },
  // 下拉刷新
  onPullDownRefresh() {
    this.refresh().then(() => uni.stopPullDownRefresh())
  },
  // 触底加载
  onReachBottom() {
    if (this.hasMore && !this.loading) this.loadMore()
  },
  methods: {
    typeLabel(k) {
      return TYPE_LABEL[k] || '其他'
    },

    fmtTime(ts) {
      const d = new Date(ts)
      const now = new Date()
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      if (sameDay) return '今天 ' + p(d.getHours()) + ':' + p(d.getMinutes())
      return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes())
    },

    setType(k) {
      if (this.type === k) return
      this.type = k
      this.refresh()
    },

    /* 去学生认证：同校频道未认证时，空态给这个入口（文档 §6） */
    goVerify() {
      uni.navigateTo({ url: '/pages/verify/verify' })
    },

    /* 未认证点「同校」：不切档，先说清条件，再给一个入口 */
    askVerify() {
      uni.showModal({
        title: '完成学生认证后才能看同校',
        content: '认证后就能看到你们学校的搭子。',
        confirmText: '去认证',
        cancelText: '先看推荐',
        success: (res) => {
          if (res.confirm) this.goVerify()
          // 推荐档就是全站（最宽的一档），取消时落到它而不是更窄的「附近」
          else this.setScope('all')
        }
      })
    },

    setScope(k) {
      // 同校档只对已认证用户开放（契约）：未认证时 chip 是锁定态，
      // 点了不切档，改成说清条件 + 给「去认证」入口
      if (k === 'school' && !this.verified) {
        this.askVerify()
        return
      }
      if (this.scope === k) return
      this.scope = k
      this.refresh()
    },

    async refresh() {
      this.page = 1
      return this.fetch(true)
    },

    loadMore() {
      this.page += 1
      return this.fetch(false)
    },

    async fetch(reset) {
      if (this.loading) return
      this.loading = true
      try {
        const res = await uniCloud.callFunction({
          name: 'card-list',
          data: {
            token: uni.getStorageSync('token') || '',
            type: this.type,
            scope: this.scope,
            page: this.page,
            page_size: PAGE_SIZE
          }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '加载失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        this.emptyReason = d.reason || ''
        this.degraded = d.degraded || ''
        const incoming = d.list || []
        this.list = reset ? incoming : this.list.concat(incoming)
        this.avaSync(this.list, (c) => 'c' + c._id, (c) => (c.owner && c.owner.avatar_url) || '')
        this.hasMore = !!d.has_more
        this.total = d.total || 0
      } catch (e) {
        uni.showToast({
          title: '云函数 card-list 调用失败，检查是否已部署',
          icon: 'none',
          duration: 2500
        })
      } finally {
        this.loading = false
      }
    },

    /* ———————— 定位 ————————

       契约：用户定位存 uni-id-users 的 geo_lat / geo_lng / geo_name / geo_at，
       本地缓存 key = userGeo，字段名跟库里保持一致 —— 将来直接回填 user-me 的出参不用改名。
       全程失败只 toast：定位是加分项，不能把浏览挡死。 */

    /* 认证状态：两个字段取或（schoolVerified 是第 1 天的写法，is_verified 是 03 文档的写法）。
       读本地缓存就够：认证页成功后写的是同一个 key，回大厅 onShow 会重读一次。 */
    syncVerified() {
      let info = null
      try {
        info = uni.getStorageSync('userInfo')
      } catch (e) {
        info = null
      }
      this.verified = !!(info && (info.schoolVerified === true || info.is_verified === true))
      // 未认证却停在同校档：首屏会是空列表 + need_verify 降级条，等于进来就没东西看。
      // 这里静默落到附近（同校档对未认证不开放，反过来没有这条就必须弹窗打扰）。
      if (!this.verified && this.scope === 'school') this.scope = 'nearby'
    },

    /* 进页面先认缓存；缓存没有才去 user-me 要一次并回写。
       两者都没有就停在「未定位」+ 一句提示，绝不主动弹定位权限。 */
    loadGeo() {
      let cached = null
      try {
        cached = uni.getStorageSync('userGeo')
      } catch (e) {
        cached = null
      }
      if (cached && typeof cached === 'object' && this.applyGeo(cached)) return
      this.loadGeoFromUser()
    },

    /* 把一份 geo 写进页面状态。有效坐标才算数（缺 / 0 = 没坐标，跟云函数契约一致）。
       返回 true 表示这份数据可用。 */
    applyGeo(g) {
      const lat = Number(g.geo_lat) || 0
      const lng = Number(g.geo_lng) || 0
      if (!lat && !lng) return false
      const name = String(g.geo_name || '')
      this.geoLat = lat
      this.geoLng = lng
      this.geoName = name || '当前位置'
      this.hasGeo = true
      return true
    },

    /* 缓存没有时兜底：user-me 出参里的 geo_*（换手机 / 清过缓存的老用户） */
    loadGeoFromUser() {
      const token = uni.getStorageSync('token') || ''
      if (!token) return
      uniCloud
        .callFunction({ name: 'user-me', data: { token } })
        .then((res) => {
          const r = (res && res.result) || {}
          if (r.code !== 0) return
          const u = (r.data && r.data.user) || {}
          const geo = {
            geo_lat: Number(u.geo_lat) || 0,
            geo_lng: Number(u.geo_lng) || 0,
            geo_name: String(u.geo_name || ''),
            geo_at: Number(u.geo_at) || 0
          }
          if (!this.applyGeo(geo)) return
          try {
            uni.setStorageSync('userGeo', geo)
          } catch (e) {
            // 写缓存失败不影响这次显示，下次进来重新取一遍
          }
        })
        .catch(() => {})
    },

    /* 定位入口：两项都走同一条 uni.getLocation，
       分开只是让「第一次」和「想换一个」看起来是两件事。 */
    openGeoSheet() {
      uni.showActionSheet({
        itemList: ['使用当前位置', '重新定位'],
        success: () => this.locate()
      })
    },

    /* 拿坐标：gcj02 跟国内底图一致；geocode 顺带要一个地名。
       失败分「没权限」和「拿不到」两种情况说 —— 只说一句「定位失败」，
       用户不知道该去改什么。 */
    locate() {
      if (this.locating) return
      this.locating = true
      uni.getLocation({
        type: 'gcj02',
        geocode: true,
        success: (res) => this.saveGeo(res),
        fail: (err) => {
          this.locating = false
          const msg = String((err && (err.errMsg || err.message)) || '')
          const denied =
            msg.indexOf('deny') > -1 || msg.indexOf('auth') > -1 || msg.indexOf('permission') > -1
          uni.showToast({
            title: denied ? '没拿到定位权限，去设置里打开再试' : '没拿到位置，检查手机定位是否打开',
            icon: 'none',
            duration: 2500
          })
        }
      })
    },

    /* 定位成功 → 存服务端 → 写缓存 → 立刻换显示名 → 用新坐标重刷列表。
       任何一步失败只 toast，不影响浏览。 */
    async saveGeo(res) {
      try {
        const lat = Number(res && res.latitude) || 0
        const lng = Number(res && res.longitude) || 0
        if (!lat || !lng) {
          uni.showToast({ title: '没拿到位置，检查手机定位是否打开', icon: 'none' })
          return
        }
        const name = this.geoNameOf(res)
        const r0 = await uniCloud.callFunction({
          name: 'user-locate',
          data: {
            token: uni.getStorageSync('token') || '',
            lat: lat,
            lng: lng,
            name: name
          }
        })
        const r = (r0 && r0.result) || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '定位保存失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        const geo = {
          geo_lat: Number(d.geo_lat) || lat,
          geo_lng: Number(d.geo_lng) || lng,
          geo_name: String(d.geo_name || name),
          geo_at: Number(d.geo_at) || Date.now()
        }
        try {
          uni.setStorageSync('userGeo', geo)
        } catch (e) {
          // 缓存写不进去也先把这次的结果显示出来
        }
        this.applyGeo(geo)
        uni.showToast({ title: '定位已更新', icon: 'none' })
        this.refresh()
      } catch (e) {
        uni.showToast({ title: '定位保存失败，稍后再试', icon: 'none' })
      } finally {
        this.locating = false
      }
    },

    /* 地名：优先 POI，其次街道，再退到区 / 市；都没有就用「当前位置」 */
    geoNameOf(res) {
      const a = (res && res.address) || null
      if (a) {
        const parts = [a.poiName, a.street, a.district, a.city]
        for (let i = 0; i < parts.length; i++) {
          const s = String(parts[i] || '')
          if (s) return s
        }
      }
      return '当前位置'
    },

    /* 返回：头图左上角的返回按钮（原生导航栏已关，得自己处理） */
    goBack() {
      uni.navigateBack({
        fail: () => {
          // 从分享/扫码直接进来时没有上一页，回首页兜底
          uni.switchTab({ url: '/pages/index/index' })
        }
      })
    },

    // 一键匹配：带上当前选中的类型（空字符串 = 不限类型）
    goMatch() {
      uni.navigateTo({ url: '/pages/match_result/match_result?type=' + this.type })
    },

    openDetail(c) {
      uni.navigateTo({ url: '/pages/detail/detail?id=' + c._id })
    }
  }
}
</script>

<style scoped>
.page {
  /* 本页主色：草绿 + 暖黄。紫色只做小面积点缀，不当主色 */
  --tf-primary:      #8FB86A;
  --tf-primary-deep: #6E9450;
  min-height: 100vh;
  padding: 0 24rpx 60rpx;
  box-sizing: border-box;
  background-color: transparent;
}

/* ==========================================================================
   头图：渐变底 + 艺术字标题
   --------------------------------------------------------------------------
   原生导航栏已关（pages.json navigationStyle: custom），这块自己让出状态栏高度。
   负 margin 撑满左右，下沿圆角接住后面的内容。
   ========================================================================== */
.hall-hero {
  position: relative;
  overflow: hidden;
  margin: 0 -24rpx 24rpx;
  padding: calc(var(--status-bar-height) + 96rpx) 32rpx 44rpx;
  border-radius: 0 0 44rpx 44rpx;
  background:
    /* 右上暖黄 */
    radial-gradient(70% 60% at 92% 8%, rgba(249, 208, 56, 0.62) 0%, rgba(249, 208, 56, 0) 62%),
    /* 右下一点紫蝶，只做点缀 */
    radial-gradient(48% 40% at 96% 92%, rgba(89, 60, 201, 0.22) 0%, rgba(89, 60, 201, 0) 66%),
    /* 主体：晴空蓝 → 青绿 → 草绿 → 暖黄 */
    linear-gradient(152deg, #5E9BE2 0%, #7FC0C0 34%, #A8C97E 66%, #F2D06A 100%);
}
/* 两团柔光斑，让色块不死板 */
.hero-blob {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.b1 {
  right: -60rpx;
  top: -40rpx;
  width: 300rpx;
  height: 300rpx;
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0) 76%);
}
.b2 {
  left: -40rpx;
  bottom: -80rpx;
  width: 260rpx;
  height: 260rpx;
  background: radial-gradient(closest-side, rgba(242, 164, 121, 0.28), rgba(242, 164, 121, 0) 76%);
}

/* 返回按钮：浮在头图左上 */
.hall-back {
  position: absolute;
  left: 24rpx;
  top: calc(var(--status-bar-height) + 20rpx);
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.24);
  border: 1rpx solid rgba(255, 255, 255, 0.34);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}
.hall-back-arw {
  color: #fff;
  font-size: 44rpx;
  line-height: 1;
  margin-top: -4rpx;
}

/* ==========================================================================
   页头
   ========================================================================== */
.hall-head {
  display: flex;
  flex-direction: column;
  padding: 8rpx 4rpx 27rpx;
}

.hall-title {
  position: relative;
  z-index: 2;
  display: block;
  font-size: 76rpx;
  font-weight: 800;
  letter-spacing: 0.06em;
  line-height: 1.05;
  color: #fff;
  /* 深紫偏移描边，做出「贴纸/手绘」的厚度感 */
  text-shadow:
    4rpx 6rpx 0 rgba(40, 78, 32, 0.38),
    0 12rpx 32rpx rgba(40, 70, 30, 0.24);
  transform: rotate(-2deg);
  transform-origin: left center;
}

.hall-sub {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: var(--tf-text-2);
}

/* ==========================================================================
   范围切换：底槽玻璃 + 滑块纯白
   ========================================================================== */
.seg {
  margin-top: 31rpx;
  display: flex;
  flex-direction: row;
  padding: 8rpx;
  height: 85rpx;
  border-radius: 31rpx;
  background: rgba(255, 255, 255, 0.40);
  border: 2rpx solid var(--tf-line-soft);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.seg-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 25rpx;
}

.seg-item--on {
  background: #fff;
  box-shadow: 0 8rpx 23rpx rgba(31, 92, 172, 0.14);
}

.seg-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.seg-text--on {
  color: var(--tf-text);
  font-weight: 600;
}

/* 未认证时「同校」的锁定态：只加一把小锁 + 文字转灰，不把整块禁掉 ——
   整块变灰看着像坏了，用户根本不会去点，也就看不到那句解释了 */
.seg-lock {
  margin-right: 6rpx;
  font-size: 22rpx;
  line-height: 1;
  opacity: 0.72;
}

.seg-text--lock {
  color: var(--tf-text-3);
}

/* ==========================================================================
   定位入口：一枚胶囊贴在范围切换下方
   ========================================================================== */
.geo-row {
  margin-top: 16rpx;
  padding-left: 4rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.geo-btn {
  flex: none;
  height: 52rpx;
  padding: 0 20rpx;
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  border-radius: 999rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line);
}

.geo-ico {
  font-size: 22rpx;
  line-height: 1;
  color: var(--tf-primary-deep);
}

.geo-name {
  margin-left: 8rpx;
  max-width: 320rpx;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 24rpx;
  color: var(--tf-text-2);
}

.geo-arw {
  margin-left: 6rpx;
  font-size: 24rpx;
  line-height: 1;
  color: var(--tf-text-3);
}

.geo-hint {
  margin-left: 14rpx;
  font-size: 22rpx;
  color: var(--tf-text-3);
}

/* ==========================================================================
   类型筛选：横向滚动小胶囊
   ========================================================================== */
.chips {
  margin-top: 23rpx;
  white-space: nowrap;
}

/* 分类胶囊行：横滑，不换行不挤压 */
.chip-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

/* ★ 修「两字标签被挤成 学\n习」的 bug（文档 §6 要求最先修）：
   1. white-space: nowrap —— 文字绝不换行
   2. flex: none —— 胶囊不被 flex 容器压缩
   3. display: inline-flex + 固定高度 —— 两个字和三个字的胶囊高度一致
   4. padding 0 24rpx —— 给足左右内边距，文字不贴边 */
.chip {
  flex: none;
  height: 56rpx;
  padding: 0 24rpx;
  margin-right: 16rpx;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--tf-r-pill, 999rpx);
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line);
  white-space: nowrap;
}

/* 未选中的标签也带颜色 —— 一排全白太寡淡，用色卡四色轮换 */
.chip:nth-child(1) { background: #FFF3C8; border-color: #F2E3B0; }
.chip:nth-child(1) .chip-text { color: #8A6A10; }

.chip:nth-child(2) { background: #E8F0D0; border-color: #D8E4B8; }
.chip:nth-child(2) .chip-text { color: #4A6B1E; }

.chip:nth-child(3) { background: #FDE6D6; border-color: #F6D4BC; }
.chip:nth-child(3) .chip-text { color: #A4542A; }

.chip:nth-child(4) { background: #D6E4FA; border-color: #C2D6F6; }
.chip:nth-child(4) .chip-text { color: #26509C; }

.chip:nth-child(5) { background: #E4DCFA; border-color: #D4C8F4; }
.chip:nth-child(5) .chip-text { color: #4A2FA8; }

.chip:nth-child(6) { background: #FCE4EC; border-color: #F6CCD8; }
.chip:nth-child(6) .chip-text { color: #A83A5A; }

/* 选中态盖掉轮换色，统一成主色 */
.chip--on {
  background: var(--tf-primary) !important;
  border-color: transparent !important;
  box-shadow: 0 6rpx 16rpx rgba(107, 127, 216, 0.32);
}
.chip--on .chip-text {
  color: #fff !important;
}

.chip-text {
  font-size: 24rpx;
  line-height: 1;
  white-space: nowrap;
  color: var(--tf-text-2);
}

.chip-text--on {
  color: #fff;
  font-weight: 700;
  white-space: nowrap;
}

/* 空态动作按钮（文档 §10.2：一句邀请 + 一个可点击动作） */
.empty-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 32rpx;
  justify-content: center;
}
.empty-btn {
  height: 72rpx;
  padding: 0 32rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--tf-r-btn, 20rpx);
  font-size: 26rpx;
  font-weight: 700;
}
.empty-btn--ghost {
  background: var(--tf-card);
  border: 2rpx solid var(--tf-line);
  color: var(--tf-text-2);
}
.empty-btn--main {
  background: var(--tf-primary);
  color: #fff;
}

/* ==========================================================================
   一键匹配 · 核心卡片（文档 §6）
   --------------------------------------------------------------------------
   从「浅色小条」升级为本页视觉重心之一。
   卡片用主色实色底，按钮用白底 —— 发布条撤掉后页面上只剩它这一块实色，
   照样守住 §3.3「一屏单实色按钮」。
   ========================================================================== */
.matchcard {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: var(--tf-r-md, 24rpx);
  /* 草绿渐变，和头图右段呼应。浅绿底配深字 */
  background: linear-gradient(135deg, #B6D28E 0%, #9CC47A 52%, #7FA855 100%);
  box-shadow: 0 12rpx 32rpx rgba(122, 154, 70, 0.28);
}

.mc-top {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

/* 图标：白半透明底 + 大号闪电，比原来那个小方块显著得多 */
.mc-ico {
  width: 80rpx;
  height: 80rpx;
  flex: none;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
}
.mc-ico-txt {
  font-size: 40rpx;
  line-height: 1;
}

.mc-head {
  flex: 1;
  min-width: 0;
}
.mc-title {
  display: block;
  font-size: 32rpx;
  font-weight: 800;
  color: #2E3A1E;
  letter-spacing: 0.02em;
}
.mc-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: rgba(46, 58, 30, 0.72);
  line-height: 1.4;
}

.mc-body {
  margin-top: 16rpx;
}
.mc-hint {
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.78);
}

/* 大按钮：白底 + 主色字，全宽，够大 */
.mc-btn {
  margin-top: 20rpx;
  height: 88rpx;
  border-radius: var(--tf-r-btn, 20rpx);
  background: #fff;
  color: var(--tf-primary-deep);
  font-size: 30rpx;
  font-weight: 800;
  letter-spacing: 0.04em;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6rpx 16rpx rgba(180, 70, 20, 0.20);
  transition: transform var(--dur-micro, 150ms) var(--ease-std, cubic-bezier(0.22, 0.61, 0.36, 1));
}
.mc-btn:active {
  transform: scale(0.97);
}

/* ==========================================================================
   筛选降级说明
   用冷灰蓝而不是黄色：这不是错误，是「给你降了一级」的说明。
   ========================================================================== */
.degrade {
  margin-top: 23rpx;
  padding: 19rpx 23rpx;
  border-radius: 25rpx;
  background: rgba(127, 156, 180, 0.20);
  border: 2rpx solid rgba(95, 130, 160, 0.26);
}

.degrade-text {
  font-size: 22rpx;
  line-height: 1.55;
  color: #46617A;
}

/* ==========================================================================
   分组标题
   ========================================================================== */
.sechead {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  padding: 27rpx 12rpx 19rpx;
}

.sechead-title {
  font-size: 29rpx;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--tf-text);
}

.sechead-more {
  font-size: 23rpx;
  font-weight: 500;
  color: var(--tf-primary-deep);
}

/* ==========================================================================
   搭子卡片
   ========================================================================== */
.dcard {
  padding: 29rpx 31rpx 25rpx;
  margin-bottom: 23rpx;
  border-radius: var(--tf-r-lg);
  background: var(--tf-card-strong);
  border: 2rpx solid var(--tf-card-line);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.dcard-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 19rpx;
}

.avatar {
  width: 73rpx;
  height: 73rpx;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--tf-primary-soft);
  border: 2rpx solid var(--tf-line);
  color: var(--tf-primary);
  font-size: 29rpx;
  font-weight: 600;
}

/* 有链就渲染图片（card-list 的 resolveListAvatars 已换临时 https），没有可用链接就留
   同尺寸空圆占位，不再用昵称首字、也不放任何默认头像图 */
.avatar--img {
  display: block;
  overflow: hidden;
  background: var(--tf-card-line);
  border-radius: 50%;
}

.dcard-who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.dcard-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}

.dcard-name {
  font-size: 26rpx;
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

.dcard-meta {
  margin-top: 4rpx;
  font-size: 20rpx;
  color: var(--tf-text-2);
}

/* 类型标：三个类型各给一档色相内的不同深浅，不做彩虹 —— 冷调里靠明度分层更高级 */
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

.dcard-title {
  display: block;
  margin-top: 23rpx;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.005em;
  color: var(--tf-text);
}

.dcard-desc {
  display: -webkit-box;
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dcard-tags {
  margin-top: 21rpx;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}

.tag {
  padding: 6rpx 18rpx;
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

.dcard-foot {
  margin-top: 23rpx;
  padding-top: 21rpx;
  border-top: 2rpx solid var(--tf-line-soft);
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 23rpx;
}

.foot-item {
  font-size: 21rpx;
  color: var(--tf-text-2);
}

.foot-item--hit {
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-weight: 600;
  color: var(--tf-primary-deep);
  background: var(--tf-primary-soft);
}

.foot-item--mine {
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  color: var(--tf-text-2);
  background: var(--tf-line-soft);
}

/* ==========================================================================
   空态 / 加载更多
   ========================================================================== */
.empty-box {
  padding: 90rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.empty-hint {
  margin-top: 14rpx;
  font-size: 24rpx;
  line-height: 1.6;
  text-align: center;
  color: var(--tf-text-2);
}

.more {
  padding: 27rpx 0 12rpx;
  display: flex;
  justify-content: center;
}

.more-text {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.more-text--end {
  color: var(--tf-text-3);
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
