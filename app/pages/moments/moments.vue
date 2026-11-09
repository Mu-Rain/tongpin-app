<template>
  <view class="page">

    <!-- ===== 封面 ===== -->
    <view class="cover">
      <view class="cover-blob b1" />
      <view class="cover-blob b2" />
      <view class="cover-back" @tap="goBack">
        <text class="cover-back-arw">‹</text>
      </view>
      <text class="cover-title">我的动态</text>
    </view>

    <!-- ===== 头像 + 昵称（压在封面下沿） ===== -->
    <view class="me">
      <view class="me-ava">
        <image v-if="avaSrcOf('me')" class="me-ava-img ava-fade" :class="{ 'ava-fade--in': avaReadyOf('me') }" :src="avaSrcOf('me')" mode="aspectFill" @load="avaOnLoad('me')" @error="onAvaError" />
        <view v-else class="me-ava-img" />
      </view>
      <text class="me-name">{{ user.nickname || '我' }}</text>
      <text class="me-count" v-if="moments.length">{{ moments.length }} 条动态</text>
    </view>

    <!-- ===== 动态列表 ===== -->
    <view class="feed" v-if="moments.length">
      <view class="moment" v-for="m in moments" :key="m._id" @tap="openPost(m)">
        <!-- 时间：仿微信「今天 14:30 / 昨天 / 3 天前」 -->
        <text class="m-time">{{ fmtTime(m.created_at || m.createdAt) }}</text>

        <!-- 正文取 content：同频圈动态的字段叫 content，description 是搭子需求卡的字段 -->
        <text class="m-text" v-if="m.content">{{ m.content }}</text>

        <!-- 图片：1 张大图，多张九宫格 -->
        <view class="m-imgs" :class="{ 'm-imgs--single': imgsOf(m).length === 1 }" v-if="imgsOf(m).length">
          <image
            class="m-img"
            v-for="(img, ii) in imgsOf(m).slice(0, 9)"
            :key="ii"
            :src="img"
            mode="aspectFill"
          />
        </view>

        <!-- 底部只留点赞/评论数：动态没有 type / location，那是搭子需求的字段 -->
        <view class="m-foot">
          <text class="m-type">♡ {{ m.like_count || 0 }}</text>
          <text class="m-place">💬 {{ m.comment_count || 0 }}</text>
        </view>
      </view>
    </view>

    <!-- 未登录：动态跟着账号走，没登录根本认不出「我」是谁 -->
    <view class="empty" v-else-if="needLogin">
      <text class="empty-emoji">🔒</text>
      <text class="empty-t">登录后才能看到自己的动态</text>
      <text class="empty-s">动态跟着账号走，换台设备也能接着看</text>
      <view class="empty-btn" @tap="goLogin">
        <text class="empty-btn-t">去登录</text>
      </view>
    </view>

    <!-- 首屏失败：给一个能点的重试，别让人停在无声的空白里 -->
    <view class="empty" v-else-if="error">
      <text class="empty-emoji">☁️</text>
      <text class="empty-t">加载失败</text>
      <text class="empty-s">{{ error }}</text>
      <view class="empty-btn" @tap="loadMoments">
        <text class="empty-btn-t">点这里重试</text>
      </view>
    </view>

    <!-- 真空态：确实一条都没发过 -->
    <view class="empty" v-else-if="!loading">
      <text class="empty-emoji">🌱</text>
      <text class="empty-t">还没有发过动态</text>
      <text class="empty-s">在同频圈发一条，这里就会出现</text>
    </view>

    <view class="loading" v-else>
      <text class="loading-t">加载中…</text>
    </view>

    <view class="pad" />
  </view>
</template>

<script>
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

export default {
  mixins: [avatarFadeMixin],
  data() {
    return {
      loading: true,
      moments: [],
      // 未登录（token 缺失或失效）：单独一态，不能和「确实没发过」混成同一个空态
      needLogin: false,
      // 首屏失败文案；空串表示这次没失败
      error: '',
      user: {},
      avatarUrl: '',
      // 图裂兜底的一次性额度：同一页面生命周期只补一次，否则服务端也换不出链时会无限重试
      avatarRetried: false
    }
  },
  watch: {
    /* 地址一变就重新挂一次：落盘缓存 + 解码后淡入都在 mixin 里，页面只负责把地址解析出来 */
    avatarUrl(v) {
      this.avaBind('me', v)
    }
  },
  onLoad() {
    this.loadUser()
    this.loadMoments()
  },
  methods: {
    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/mine/mine' })
      })
    },

    /* 头像四级兜底。storage 里的 userInfo 是登录当时的投影：老账号根本没有 avatar_url，
       有的那条临时链接也早过期了 —— 只读 storage 就会出现「明明设了头像却一直显示默认图」。
       每级失败都不弹错，全拿不到就留空串，模板留同尺寸空圆。 */
    async loadUser() {
      const u = uni.getStorageSync('userInfo') || {}
      this.user = u
      this.avatarUrl = ''
      this.avatarRetried = false
      const raw = String(u.avatar || '')
      const cached = String(u.avatar_url || u.avatarUrl || '')

      // ① 库里是 cloud:// fileID：客户端换链最快，一次只换这一个
      if (raw.indexOf('cloud://') === 0) {
        let url = ''
        try {
          const res = await uniCloud.getTempFileURL({ fileList: [raw] })
          const item = ((res && res.fileList) || [])[0] || {}
          url = item.tempFileURL || ''
        } catch (e) {
          url = ''
        }
        // ② 客户端换不到（云环境凭证/权限问题）就回服务端要一次，那边一定拿得到真值
        if (!url) url = await this.avatarFromServer()
        this.avatarUrl = url || ''
        return
      }
      // ③ storage 里已有 http 链接：先用着，真过期了由 onAvatarError 兜底重换
      if (cached.indexOf('http') === 0) {
        this.avatarUrl = cached
        return
      }
      // ③.5 自带头像：包内静态路径，直接可用
      if (cached.indexOf('/') === 0) {
        this.avatarUrl = cached
        return
      }
      if (raw.indexOf('http') === 0) {
        this.avatarUrl = raw
        return
      }
      // ④ 四种本地来源都没有：有 token 就问一次服务端；问不到就留空串 → 默认图
      const token = uni.getStorageSync('token') || ''
      if (token) this.avatarUrl = (await this.avatarFromServer()) || ''
    },

    /* 服务端换好链的头像（user-me 里已经做过 fileID → 临时链接）。
       拿到就写回 storage：不写回，下次进页面还拿着旧值重走一遍坏路径。
       Object.assign 合并而不是整体替换，且不让空值把有效的 avatar 覆盖掉。 */
    async avatarFromServer() {
      const token = uni.getStorageSync('token') || ''
      if (!token) return ''
      try {
        const res = await uniCloud.callFunction({
          name: 'user-me',
          data: { token: token }
        })
        const r = res.result || {}
        const su = (r.code === 0 && r.data && r.data.user) || null
        if (!su) return ''
        const url = su.avatar_url || ''
        const merged = Object.assign({}, this.user, su, {
          // avatar 是库里的原值：服务端回空就留本地那份，别把有值的头像抹成空
          avatar: su.avatar || (this.user && this.user.avatar) || '',
          // avatar_url 是派生值，只认服务端这次给的，不回退到旧链接
          avatar_url: url
        })
        uni.setStorageSync('userInfo', merged)
        this.user = merged
        return url.indexOf('http') === 0 ? url : ''
      } catch (e) {
        return ''
      }
    },

    /* 图裂：先让这条缓存失效、保持空圆，再走下面的一次性换链重试 */
    onAvaError() {
      this.avaOnError('me', this.avatarUrl)
      this.onAvatarError()
    },

    /* 图裂兜底：src 拿到了却取不回来，典型是 storage 里那条临时链接已经过期。
       一生只重试一次（avatarRetried），重试仍失败就置空 —— 模板留空圆，不放任何默认图。 */
    async onAvatarError() {
      if (this.avatarRetried) return
      this.avatarRetried = true
      const url = await this.avatarFromServer()
      if (url && url !== this.avatarUrl) {
        this.avatarUrl = url
        return
      }
      this.avatarUrl = ''
    },

    /* 「我的动态」= 我在同频圈发的动态（posts 集合），不是搭子需求卡。
       走 post-list 的 scope='mine'：这是唯一能读到同频圈动态的接口。
       两者是两件事 —— 需求卡在「我的需求」页，动态在「我的动态」页。 */
    async loadMoments() {
      this.loading = true
      this.error = ''
      this.needLogin = false
      try {
        const r = await uniCloud.callFunction({
          name: 'post-list',
          data: {
            // ★ token 必传：mine 档靠它认「我」，不传就认不出来 → 云函数回 reason='need_login'
            token: uni.getStorageSync('token') || '',
            scope: 'mine',
            page: 1,
            page_size: 30
          }
        })
        const res = (r && r.result) || {}
        if (res.code === 401) {
          // 401 是 token 过期：按未登录展示，比让用户对着「加载失败」强
          this.moments = []
          this.needLogin = true
          return
        }
        if (res.code !== 0) {
          this.error = res.msg || '加载失败'
          return
        }
        const d = res.data || {}
        // 云函数没认出「我」→ 未登录态。空列表不等于「你确实没发过动态」
        if (d.reason === 'need_login') {
          this.moments = []
          this.needLogin = true
          return
        }
        this.moments = d.list || []
      } catch (e) {
        // 网络/云函数不可用：进可重试的失败态，别静默留一个空页面
        this.error = '网络不太好，稍后再试'
      } finally {
        this.loading = false
      }
    },

    /* 兼容三种图片字段命名 */
    imgsOf(m) {
      if (!m) return []
      let raw = m.images || m.media || m.image_urls
      if (!raw) return []
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw)
        } catch (e) {
          return raw.indexOf('http') === 0 ? [raw] : []
        }
      }
      return Array.isArray(raw) ? raw.filter((x) => x && typeof x === 'string') : []
    },

    /* 仿微信的时间显示：今天 / 昨天 / N 天前 / 具体日期 */
    fmtTime(ts) {
      if (!ts) return ''
      const d = new Date(typeof ts === 'number' ? ts : String(ts).replace(/-/g, '/'))
      if (isNaN(d.getTime())) return ''
      const now = new Date()
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      if (sameDay) return '今天 ' + hh + ':' + mm

      const diff = Math.floor((now - d) / 86400000)
      if (diff === 1) return '昨天 ' + hh + ':' + mm
      if (diff > 1 && diff < 7) return diff + ' 天前'
      if (d.getFullYear() === now.getFullYear()) {
        return d.getMonth() + 1 + '月' + d.getDate() + '日'
      }
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
    },

    /* 去登录：和「我的需求」页同一套跳法。
       用 reLaunch 而不是 navigateTo —— 登录成功后回首页，二级页不该留在栈里。 */
    goLogin() {
      uni.reLaunch({ url: '/pages/login/login' })
    },

    openPost(m) {
      // 动态详情在同频圈：post-detail。原来指向 /pages/detail/detail（那是需求卡详情）
      uni.navigateTo({ url: '/pages/post-detail/post-detail?id=' + m._id })
    }
  }
}
</script>

<style>
/* ==========================================================================
   我的动态 —— 仿微信朋友圈
   --------------------------------------------------------------------------
   封面大图 + 头像压在封面下沿 + 时间线列表。
   主色用紫蝶（和「我的」页一致），封面是紫→蓝的渐变。
   ========================================================================== */
.page {
  min-height: 100vh;
  background: var(--tf-bg);
  padding-bottom: 40rpx;
}

/* 封面 */
.cover {
  position: relative;
  height: 400rpx;
  overflow: hidden;
  /* 下沿圆角，和米色背景柔和衔接（不然是硬切一刀） */
  border-radius: 0 0 44rpx 44rpx;
  /* 蓝 → 青 → 绿：色卡里的晴空蓝和浅草绿，中间用青绿过渡
     右上一点暖黄做阳光，左下腮红做暖意 */
  background:
    radial-gradient(56% 48% at 90% 4%, rgba(249, 208, 56, 0.46) 0%, rgba(249, 208, 56, 0) 60%),
    radial-gradient(64% 56% at 4% 98%, rgba(242, 164, 121, 0.26) 0%, rgba(242, 164, 121, 0) 62%),
    linear-gradient(152deg, #5E9BE2 0%, #6FB8D4 32%, #8FC9A8 64%, #C4D888 100%);
}
.cover-blob {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.b1 {
  right: -80rpx;
  top: -60rpx;
  width: 360rpx;
  height: 360rpx;
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.20), rgba(255, 255, 255, 0) 76%);
}
.b2 {
  left: -60rpx;
  bottom: -100rpx;
  width: 300rpx;
  height: 300rpx;
  background: radial-gradient(closest-side, rgba(242, 164, 121, 0.26), rgba(242, 164, 121, 0) 76%);
}
.cover-back {
  position: absolute;
  left: 24rpx;
  top: calc(var(--status-bar-height) + 20rpx);
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  border: 1rpx solid rgba(255, 255, 255, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}
.cover-back-arw {
  color: #fff;
  font-size: 44rpx;
  line-height: 1;
  margin-top: -4rpx;
}
.cover-title {
  position: absolute;
  left: 32rpx;
  bottom: 96rpx;
  font-size: 52rpx;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.06em;
  text-shadow: 3rpx 5rpx 0 rgba(34, 72, 40, 0.34), 0 10rpx 28rpx rgba(30, 66, 40, 0.22);
  transform: rotate(-2deg);
}

/* 头像压住封面下沿 */
.me {
  position: relative;
  margin-top: -76rpx;
  padding: 0 32rpx;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  z-index: 4;
}
.me-ava {
  width: 152rpx;
  height: 152rpx;
  /* 圆形头像：像微信朋友圈那种 */
  border-radius: 50%;
  background: linear-gradient(150deg, #F9D038, #F2A479);
  border: 6rpx solid var(--tf-bg);
  box-shadow: 0 8rpx 24rpx rgba(30, 66, 40, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.me-ava-img {
  width: 100%;
  height: 100%;
}
.me-name {
  margin-top: 14rpx;
  font-size: 32rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.me-count {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--tf-text-3);
}

/* 动态列表 */
.feed {
  margin: 32rpx 32rpx 0;
}
.moment {
  padding: 28rpx 0;
  border-bottom: 2rpx solid var(--tf-line-soft);
}
.moment:last-child {
  border-bottom: none;
}
.m-time {
  display: block;
  font-size: 22rpx;
  font-weight: 700;
  color: #2A6BB8;
  letter-spacing: 0.02em;
}
.m-text {
  display: block;
  margin-top: 12rpx;
  font-size: 27rpx;
  line-height: 1.6;
  color: var(--tf-text);
}
.m-imgs {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 16rpx;
}
.m-img {
  width: 208rpx;
  height: 208rpx;
  border-radius: 14rpx;
  background: #EFE9DF;
}
/* 单图放大 */
.m-imgs--single .m-img {
  width: 420rpx;
  height: 420rpx;
  border-radius: 18rpx;
}
.m-foot {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 14rpx;
}
.m-type {
  font-size: 20rpx;
  font-weight: 700;
  color: #26509C;
  background: #D6E4FA;
  padding: 4rpx 12rpx;
  border-radius: 10rpx;
}
.m-place {
  font-size: 20rpx;
  color: var(--tf-text-3);
}

/* 空态 / 加载 */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 140rpx 40rpx 0;
}
.empty-emoji {
  font-size: 72rpx;
  line-height: 1;
}
.empty-t {
  margin-top: 24rpx;
  font-size: 28rpx;
  font-weight: 700;
  color: var(--tf-text-2);
}
.empty-s {
  margin-top: 10rpx;
  font-size: 23rpx;
  color: var(--tf-text-3);
}
/* 空态里的动作按钮（去登录 / 重试）：沿用页面里「动态类型」小标签那套蓝，
   不引入新色值，也就不会和既有视觉风格打架 */
.empty-btn {
  margin-top: 28rpx;
  padding: 14rpx 40rpx;
  border-radius: 999rpx;
  background: #D6E4FA;
}
.empty-btn-t {
  font-size: 26rpx;
  font-weight: 700;
  color: #26509C;
}
.loading {
  display: flex;
  justify-content: center;
  padding: 100rpx 0;
}
.loading-t {
  font-size: 24rpx;
  color: var(--tf-text-3);
}
.pad {
  height: 60rpx;
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
