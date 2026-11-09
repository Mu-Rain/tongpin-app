<template>
  <view class="page">
    <!-- 加载中 -->
    <view class="hint" v-if="loading">
      <text class="hint-text">正在加载…</text>
    </view>

    <!-- 空态 -->
    <view class="hint" v-else-if="list.length === 0">
      <text class="hint-text">{{ errMsg || emptyText }}</text>
      <button class="btn btn--ghost" @tap="load">稍后再试</button>
    </view>

    <block v-else>
      <!-- 顶部：点亮进度 + 当前佩戴（佩戴的称号直接用它的皮肤，一眼看到自己现在是什么身份） -->
      <view class="hero">
        <view class="hero-top">
          <view class="hero-num">
            <text class="hn-big">{{ obtainedCount }}</text>
            <text class="hn-of">/{{ total }}</text>
          </view>
          <text class="hero-label">枚已点亮</text>
        </view>
        <view class="hero-bar">
          <view class="hero-bar-fill" :style="{ width: pct + '%' }" />
        </view>
        <view class="hero-eq">
          <text class="hero-eq-k">当前佩戴</text>
          <view v-if="equipped" class="tt tt--sm" :class="skinOf(equipped.code).cls">
            <text class="tt-ico">{{ skinOf(equipped.code).icon }}</text>
            <text class="tt-name">{{ equipped.name }}</text>
          </view>
          <text v-else class="hero-eq-none">还没挑一个</text>
        </view>
      </view>

      <!-- 按稀有度分组：普通 / 稀有 / 史诗。混在一起看不出"还差哪一档" -->
      <view class="group" v-for="g in groups" :key="g.key">
        <view class="group-head">
          <view class="gh-dot" :class="'gh-dot--' + g.key" />
          <text class="gh-name">{{ g.label }}</text>
          <text class="gh-count">{{ g.got }}/{{ g.items.length }}</text>
          <view class="gh-line" />
        </view>

        <view class="wall">
          <view
            class="badge"
            v-for="t in g.items"
            :key="t.code"
            :class="{ 'badge--off': !t.obtained }"
            @tap="openDetail(t, 0)"
          >
            <!-- 每个称号用自己的皮肤：轮廓都是胶囊，内部配色/字体/图标各不相同 -->
            <view class="tt" :class="skinOf(t.code).cls">
              <text class="tt-ico">{{ skinOf(t.code).icon }}</text>
              <text class="tt-name">{{ t.name }}</text>
            </view>
            <text class="badge-label" :class="{ 'badge-label--on': t.is_equipped }">
              {{ t.is_equipped ? '佩戴中' : t.obtained ? '已获得' : '未获得' }}
            </text>
          </view>
        </view>
      </view>
    </block>

    <!-- 详情弹窗 -->
    <view class="mask" v-if="detail" @tap="closeDetail">
      <view class="sheet" @tap.stop>
        <view class="sheet-badge">
          <view class="tt" :class="skinOf(detail.t.code).cls">
            <text class="tt-ico">{{ skinOf(detail.t.code).icon }}</text>
            <text class="tt-name">{{ detail.t.name }}</text>
          </view>
        </view>
        <text class="sheet-name">{{ detail.t.name }}</text>
        <text class="sheet-rarity">{{ rarityText(detail.t.rarity) }}</text>

        <view class="sheet-rows">
          <view class="sheet-row">
            <text class="sr-k">获得条件</text>
            <text class="sr-v">{{ detail.t.condition_text || '—' }}</text>
          </view>
          <view class="sheet-row" v-if="detail.t.obtained_at">
            <text class="sr-k">获得时间</text>
            <text class="sr-v">{{ fmtDate(detail.t.obtained_at) }}</text>
          </view>
          <view class="sheet-row" v-if="detail.t.desc">
            <text class="sr-k">说明</text>
            <text class="sr-v">{{ detail.t.desc }}</text>
          </view>
        </view>

        <view
          class="sheet-btn"
          :class="{ 'sheet-btn--off': !detail.t.obtained }"
          v-if="!viewUserId"
          @tap="onTap(detail.t)"
        >
          {{ !detail.t.obtained ? '还没点亮' : detail.t.is_equipped ? '摘下' : '佩戴' }}
        </view>
        <view class="sheet-btn sheet-btn--off" v-else>只看模式</view>
      </view>
    </view>
  </view>
</template>

<script>
import { skinOf } from '@/common/title/skins.js'

export default {
  data() {
    return {
      // 列表、条件文案全部来自 title-list，前端不自己拼口径（只在一处才不会两边打架）
      list: [],
      // 当前佩戴的那条；摘下后是 null
      equipped: null,
      total: 0,
      loading: true,
      // 只在加载失败时写：空列表要区分「真的没称号」和「服务没准备好」
      errMsg: '',
      // 正在提交的 code，防连点重复打 title-equip
      busyCode: '',
      // 看别人墙面（契约 §4.2）：非空 = 只看模式，点卡片不佩戴、不调 title-equip。
      // 空串 = 看自己的墙，行为与改造前完全一致
      viewUserId: '',
      // 空态文案按视角分：说「你的墙空了」比「TA 没点亮任何称号」更像人话
      emptyText: '还没有称号。填完资料、认证通过、和同学搭成一次，就会自动点亮。',
      /* 详情弹窗：{ t: 称号对象 }（样式由 skinOf(t.code) 决定，不再按序号挑） */
      detail: null
    }
  },
  computed: {
    obtainedCount() {
      return this.list.filter((t) => t.obtained).length
    },
    /* 进度条百分比：total 还没回来时按 0 处理，别出现 NaN% */
    pct() {
      if (!this.total) return 0
      return Math.round((this.obtainedCount / this.total) * 100)
    },
    /* 按稀有度分组，空组直接不渲染（v-for 与 v-if 不能写在同一个元素上） */
    groups() {
      const meta = [
        { key: 'common', label: '普通' },
        { key: 'rare', label: '稀有' },
        { key: 'epic', label: '史诗' }
      ]
      const out = []
      for (let i = 0; i < meta.length; i++) {
        const items = this.list.filter(function (t) {
          return (t.rarity || 'common') === meta[i].key
        })
        if (!items.length) continue
        out.push({
          key: meta[i].key,
          label: meta[i].label,
          items: items,
          got: items.filter(function (t) {
            return t.obtained
          }).length
        })
      }
      return out
    }
  },
  onLoad(options) {
    // user_id 来自「TA 的称号」入口（pages/user/user.vue），没有就是看自己的墙
    const uid = (options && options.user_id) || ''
    this.viewUserId = typeof uid === 'string' ? uid : ''
    if (this.viewUserId) {
      this.emptyText = 'TA 还没点亮过称号。'
      // 导航栏在 pages.json 里是写死的「称号墙」，这里按视角改一次，
      // 不加路由也不改配置 —— 契约 §4.2 要求不加新路由
      uni.setNavigationBarTitle({ title: 'TA 的称号' })
    }
    this.load()
  },
  onPullDownRefresh() {
    this.load(true)
  },
  methods: {
    /* 模板里按称号 code 取皮肤（类名 + 图标） */
    skinOf,

    async load(fromPull) {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        this.list = []
        this.total = 0
        this.loading = false
        this.errMsg = '还没登录，先登录再看称号'
        if (fromPull) uni.stopPullDownRefresh()
        return
      }
      this.loading = true
      this.errMsg = ''
      try {
        // user_id 只在看别人墙时传（契约 §4.1）：不传 / 传自己都回到原有行为，
        // 云函数那边据此跳过评估补发，只读别人的记录
        const payload = { token: token }
        if (this.viewUserId) payload.user_id = this.viewUserId
        const res = await uniCloud.callFunction({ name: 'title-list', data: payload })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          // 函数还没部署时这里拿到的是业务错误码，同样降级：清空列表 → 走空态 + 稍后再试
          this.list = []
          this.total = 0
          this.errMsg = r.msg || '称号服务还没准备好，稍后再试'
          return
        }
        const d = r.data || {}
        this.list = d.list || []
        this.total = typeof d.total === 'number' ? d.total : this.list.length
        this.equipped = d.equipped || null
      } catch (e) {
        // 函数不存在 / 网络断：一律降级成空态，绝不让页面卡在 loading 或白屏
        this.list = []
        this.total = 0
        this.errMsg = '一时没加载出来，稍后再试'
      } finally {
        this.loading = false
        if (fromPull) uni.stopPullDownRefresh()
      }
    },

    /* 点徽章 → 开详情弹窗（条件是「怎么获得」，时间只有已获得才有） */
    openDetail(t, i) {
      this.detail = { t }
    },
    closeDetail() {
      this.detail = null
    },

    onTap(t) {
      // 只看模式：别人戴什么由他自己决定，这里既不弹佩戴、也绝不调 title-equip
      // —— 那是写操作，看别人的墙去写别人的数据就是越权（契约 §4.1）
      if (this.viewUserId) {
        if (t.obtained) {
          uni.showToast({ title: '称号只能本人佩戴', icon: 'none' })
        } else {
          uni.showToast({ title: '还没获得：' + (t.condition_text || '条件未达成'), icon: 'none' })
        }
        return
      }
      if (!t.obtained) {
        // 点了没反应等于坏了，所以未获得的也给一句说明
        uni.showToast({ title: '还没获得：' + (t.condition_text || '条件未达成'), icon: 'none' })
        return
      }
      // 已经戴着：按钮这时显示"摘下"，不能直接 return（那等于点了没反应）
      this.equip(t.is_equipped ? '' : t.code)
    },

    unequip() {
      this.equip('')
    },

    // code === '' 表示摘下（契约 §3.2）；佩戴结果以云函数回包为准，本地不自己推断
    async equip(code) {
      if (this.busyCode) return
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '还没登录', icon: 'none' })
        return
      }
      this.busyCode = code || 'unequip'
      try {
        const res = await uniCloud.callFunction({
          name: 'title-equip',
          data: { token: token, code: code }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '操作失败，稍后再试', icon: 'none' })
          return
        }
        const d = r.data || {}
        this.equipped = d.equipped || null
        const eqCode = this.equipped ? this.equipped.code : ''
        this.list = this.list.map((it) => Object.assign({}, it, { is_equipped: it.code === eqCode }))
        // ★ 操作成功就把弹窗收起来：不然「佩戴成功但弹窗不动」，
        //   而且弹窗里存的是操作前的旧对象，按钮文案会停在"佩戴"。
        this.detail = null
      } catch (e) {
        uni.showToast({ title: '网络不太好，稍后再试', icon: 'none' })
      } finally {
        this.busyCode = ''
      }
    },

    rarityText(r) {
      const map = { common: '普通', rare: '稀有', epic: '史诗' }
      return map[r] || ''
    },

    fmtDate(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      const p = (n) => (n < 10 ? '0' + n : '' + n)
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 32rpx 32rpx 80rpx;
  box-sizing: border-box;
  background-color: transparent;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

/* ---- 加载 / 空态 ---- */
.hint {
  padding: 140rpx 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
}

.hint-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
  text-align: center;
  line-height: 1.7;
}

/* ---- 按钮 ---- */
.btn--ghost {
  height: 76rpx;
  line-height: 76rpx;
  font-size: 28rpx;
  color: var(--tf-primary);
  background-color: transparent;
  border: 2rpx solid var(--tf-primary);
  border-radius: 38rpx;
  padding: 0 48rpx;
}

/* ==========================================================================
   称号墙
   --------------------------------------------------------------------------
   结构：进度 hero → 按稀有度分组 → 两列胶囊
   皮肤本身在全局 title-skins.css（轮廓固定、内部各异），这里只管排版
   ========================================================================== */

/* ---- 顶部进度 ---- */
.hero {
  margin: 8rpx 32rpx 0;
  padding: 30rpx 30rpx 26rpx;
  border-radius: 30rpx;
  background: linear-gradient(140deg, #FFFFFF 0%, #F3FAFE 100%);
  border: 2rpx solid rgba(140, 228, 249, 0.5);
  box-shadow: 0 10rpx 30rpx rgba(60, 110, 150, 0.1);
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.hero-top {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.hero-num {
  display: flex;
  align-items: baseline;
}

.hn-big {
  font-size: 66rpx;
  font-weight: 900;
  line-height: 1;
  color: var(--tf-text);
  letter-spacing: -0.02em;
}

.hn-of {
  font-size: 26rpx;
  color: var(--tf-text-3);
  margin-left: 4rpx;
}

.hero-label {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.hero-bar {
  height: 10rpx;
  border-radius: 5rpx;
  background: rgba(18, 49, 61, 0.08);
  overflow: hidden;
}

.hero-bar-fill {
  height: 100%;
  border-radius: 5rpx;
  background: linear-gradient(90deg, #8CE4F9 0%, #5FC3BC 100%);
  transition: width 320ms ease;
}

.hero-eq {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 2rpx;
}

.hero-eq-k {
  font-size: 21rpx;
  color: var(--tf-text-3);
}

.hero-eq-none {
  font-size: 21rpx;
  color: var(--tf-text-3);
  opacity: 0.7;
}

/* ---- 分组 ---- */
.group {
  padding: 0 32rpx;
  margin-top: 34rpx;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 18rpx;
}

.gh-dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  flex: none;
}

.gh-dot--common {
  background: #B9C6CC;
}

.gh-dot--rare {
  background: #6B9BE8;
}

.gh-dot--epic {
  background: #C9A44A;
  box-shadow: 0 0 0 4rpx rgba(201, 164, 74, 0.16);
}

.gh-name {
  font-size: 24rpx;
  font-weight: 800;
  color: var(--tf-text);
  letter-spacing: 0.04em;
}

.gh-count {
  font-size: 19rpx;
  color: var(--tf-text-3);
}

.gh-line {
  flex: 1;
  height: 2rpx;
  background: rgba(18, 49, 61, 0.07);
}

/* ---- 两列胶囊 ---- */
.wall {
  display: flex;
  flex-wrap: wrap;
  gap: 20rpx 18rpx;
}

.badge {
  width: calc((100% - 18rpx) / 2);
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.badge:active {
  transform: scale(0.96);
  transition: transform 140ms ease;
}

.badge-label {
  padding-left: 8rpx;
  font-size: 19rpx;
  color: var(--tf-text-3);
  opacity: 0.85;
}

.badge-label--on {
  color: #4E9A6A;
  font-weight: 700;
  opacity: 1;
}

/* 未获得的灰度/半透明在全局 title-skins.css 里（.badge--off .tt） */

/* ==========================================================================
   详情弹窗
   ========================================================================== */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(30, 24, 20, 0.48);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet {
  width: 600rpx;
  background: #FFFFFF;
  border-radius: 32rpx;
  padding: 44rpx 32rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 24rpx 60rpx rgba(40, 30, 20, 0.24);
}
.sheet-badge {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet-name {
  margin-top: 24rpx;
  font-size: 36rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.sheet-rarity {
  margin-top: 8rpx;
  font-size: 21rpx;
  color: var(--tf-text-3);
}
.sheet-rows {
  width: 100%;
  margin-top: 32rpx;
  background: #FAF7F1;
  border-radius: 20rpx;
  padding: 8rpx 24rpx;
}
.sheet-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 20rpx;
  padding: 20rpx 0;
}
.sheet-row + .sheet-row {
  border-top: 2rpx solid rgba(46, 42, 38, 0.06);
}
.sr-k {
  flex: none;
  width: 130rpx;
  font-size: 23rpx;
  color: var(--tf-text-3);
}
.sr-v {
  flex: 1;
  font-size: 24rpx;
  color: var(--tf-text);
  line-height: 1.55;
}
.sheet-btn {
  margin-top: 32rpx;
  width: 100%;
  height: 92rpx;
  border-radius: 46rpx;
  background: #8FB86A;
  color: #fff;
  font-size: 29rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet-btn--off {
  background: #EFE9DF;
  color: var(--tf-text-3);
}
</style>
