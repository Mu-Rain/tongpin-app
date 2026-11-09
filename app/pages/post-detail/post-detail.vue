<template>
  <view class="page">
    <!-- 原生导航已关，自绘吸顶导航 -->
    <view class="nav">
      <view class="nav-back" @tap="goBack">
        <text class="nav-back-arw">‹</text>
      </view>
      <text class="nav-title">动态</text>
    </view>

    <!-- 加载中 -->
    <view class="state" v-if="loading && !post">
      <text class="state-text">加载中…</text>
    </view>

    <!-- 打不开：缺 id / 404 / 网络三种原因都落到这里。
         不静默吞掉 —— 用户至少要知道「是没了还是网差」。 -->
    <view class="state" v-else-if="!post">
      <text class="state-title">打不开这条动态</text>
      <text class="state-hint">{{ errMsg || '它可能已经被删除了' }}</text>
    </view>

    <view class="card" v-else>
      <!-- 作者行：删除入口只在「我发的」上出现，别人看不到这个按钮也就不会误触 -->
      <view class="head">
        <image v-if="avaSrcOf('p' + postId)" class="ava ava-img ava-fade" :class="{ 'ava-fade--in': avaReadyOf('p' + postId) }" :src="avaSrcOf('p' + postId)" mode="aspectFill" @load="avaOnLoad('p' + postId)" @error="onAvaError" />
        <view v-else class="ava ava-img" />
        <view class="who">
          <view class="name-row">
            <text class="name">{{ post.owner.nickname }}</text>
            <text class="verified" v-if="post.owner.is_verified">已认证</text>
          </view>
          <text class="meta">{{ post.owner.school || '未填学校' }} · {{ ago(post.created_at) }}</text>
        </view>
        <text class="del" v-if="post.is_mine" @tap="confirmDelete">删除</text>
      </view>

      <!-- 正文：详情页不截断，feed 里被省略的部分在这里看全 -->
      <text class="body-text" v-if="post.content">{{ post.content }}</text>

      <!-- 图片：1 张给横幅（单图不缩成小方块，主图值得占屏幕），多张两列 -->
      <view class="media" v-if="imgs.length === 1">
        <image class="hero-img" :src="imgs[0]" mode="aspectFill" @tap="previewImage(0)" @error="onImgError" />
      </view>
      <view class="grid" v-else-if="imgs.length > 1">
        <image
          class="grid-img"
          v-for="(img, ii) in imgs"
          :key="ii"
          :src="img"
          mode="aspectFill"
          @tap="previewImage(ii)"
          @error="onImgError"
        />
      </view>

      <!-- 点赞行 -->
      <view class="actbar">
        <view class="act" @tap="onLike">
          <view class="act-heart" :class="{ 'act-heart--on': post.liked }" />
          <text class="act-n">{{ post.like_count || 0 }}</text>
        </view>
      </view>

      <view class="hr"></view>

      <text class="c-title">评论 {{ post.comment_count || 0 }}</text>

      <!-- 空态：列表空时给一句话，不留一片白 -->
      <view class="c-empty" v-if="cLoading && !comments.length">
        <text class="c-empty-text">评论加载中…</text>
      </view>
      <view class="c-empty" v-else-if="!comments.length">
        <text class="c-empty-text">还没有评论，说第一句</text>
      </view>

      <view class="c-item" v-for="cm in comments" :key="cm._id">
        <image v-if="avaSrcOf('cm' + cm._id)" class="c-ava c-ava-img ava-fade" :class="{ 'ava-fade--in': avaReadyOf('cm' + cm._id) }" :src="avaSrcOf('cm' + cm._id)" mode="aspectFill" @load="avaOnLoad('cm' + cm._id)" @error="avaOnError('cm' + cm._id, cm.owner && cm.owner.avatar_url)" />
        <view v-else class="c-ava c-ava-img" />
        <view class="c-main">
          <view class="c-name-row">
            <text class="c-name">{{ cm.owner.nickname }}</text>
            <text class="c-verified" v-if="cm.owner.is_verified">已认证</text>
          </view>
          <text class="c-text">{{ cm.content }}</text>
          <text class="c-time">{{ ago(cm.created_at) }}</text>
        </view>
      </view>

      <view class="c-more" v-if="comments.length">
        <text class="c-more-text" v-if="cLoading">加载中…</text>
        <text class="c-more-text" v-else-if="hasMore" @tap="loadComments(false)">查看更多评论</text>
        <text class="c-more-text c-more-text--end" v-else>— 没有更多了 —</text>
      </view>
    </view>
  </view>

  <!-- 底部输入：放在卡片流之外、fixed 贴视口底。
       不塞进滚动区 —— 塞进去它会跟着内容滚，键盘一弹就找不到了。 -->
  <view class="bar" v-if="post">
    <input
      class="bar-input"
      v-model="draft"
      :maxlength="MAX_COMMENT"
      placeholder="说点什么…"
      placeholder-class="bar-ph"
      confirm-type="send"
      :cursor-spacing="20"
      @confirm="sendComment"
    />
    <button class="bar-btn" :class="{ 'bar-btn--off': !canSend }" :disabled="sending" @tap="sendComment">发送</button>
  </view>
</template>

<script>
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

const PAGE_SIZE = 20
const MAX_COMMENT = 200

export default {
  mixins: [avatarFadeMixin],
  data() {
    return {
      MAX_COMMENT,
      postId: '',
      post: null,
      loading: false,
      errMsg: '',
      comments: [],
      page: 1,
      hasMore: false,
      cLoading: false,
      draft: '',
      sending: false,
      // 浏览上报一次进入只报一次：避免重复进入/重复拉取把同一条动态记成多次
      browseDone: false,
      // 快照里的图片是上次换好的临时链接（约 2 小时过期）：加载失败时补刷一次详情
      imgRetry: false
    }
  },
  watch: {
    /* 正文 / 评论换了就重新挂头像：落盘缓存 + 解码后淡入都在 mixin 里，这里只报「谁的头像、地址是什么」*/
    post(v) {
      this.avaBind('p' + this.postId, (v && v.owner && v.owner.avatar_url) || '')
    },
    comments(v) {
      this.avaSync(v, (cm) => 'cm' + cm._id, (cm) => (cm.owner && cm.owner.avatar_url) || '')
    }
  },
  computed: {
    /* 图片字段兼容三种形态：数组 / JSON 字符串 / 缺失。
       服务端已经把 cloud:// 换成临时链接，这里只管取干净的值。 */
    imgs() {
      const raw = (this.post && this.post.images) || []
      if (Array.isArray(raw)) return raw.filter(Boolean)
      if (typeof raw === 'string') {
        try {
          const arr = JSON.parse(raw)
          return Array.isArray(arr) ? arr.filter(Boolean) : []
        } catch (e) {
          return []
        }
      }
      return []
    },
    canSend() {
      return !!this.draft.trim() && !this.sending
    }
  },
  onLoad(options) {
    this.postId = (options && options.id) || ''
    // 没有 id 就直接进错页面了，别再打一次注定 400 的请求
    if (!this.postId) {
      this.errMsg = '缺少动态 id'
      return
    }
    // 有快照就先画出来，再静默刷新（见 hydrateSnapshot）：从聊天里的分享卡反复点进来，
    // 不该每次都先看一屏「加载中…」再等云函数往返。
    const hit = this.hydrateSnapshot()
    this.loadPost(hit)
    // 评论和正文互不依赖，并行发能省掉一次串行往返
    this.loadComments(true)
  },
  onReachBottom() {
    this.loadComments(false)
  },
  methods: {
    /* 原生导航已关，返回自己处理 */
    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/feed/feed' })
      })
    },

    tokenOf() {
      try {
        return uni.getStorageSync('token') || ''
      } catch (e) {
        return ''
      }
    },
    async loadPost(silent) {
      // 静默刷新（silent=true）不动 loading：屏幕上已经有快照内容，不能再闪一次加载态
      this.loading = !silent
      this.errMsg = ''
      try {
        const res = await uniCloud.callFunction({
          name: 'post-detail',
          data: { token: this.tokenOf(), post_id: this.postId }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          // 静默刷新失败（网络抖 / 冷启动超时）：保留快照，不把已经看到的正文换成错误页。
          // 但 404 是「这条已经没了」，快照必须清掉，否则会一直显示一条已删除的动态。
          if (silent && r.code !== 404) return
          // 404 是「已经没了」，属于正常结果；文案用服务端那句，不再叠一层 toast
          this.post = null
          this.errMsg = r.msg || '加载失败'
          this.clearSnapshot()
          return
        }
        const fresh = (r.data && r.data.post) || null
        if (!fresh) {
          // 服务端说成功却没给正文，等同于已删除：静默刷新时也要清快照并落到错误态
          this.post = null
          this.errMsg = '动态不存在或已被删除'
          this.clearSnapshot()
          return
        }
        this.post = fresh
        this.writeSnapshot()
        // 动态确实存在才记浏览：404 的 id 记进历史，点进去还是一次空
        this.reportBrowse()
      } catch (e) {
        if (silent) return
        this.post = null
        this.errMsg = '网络不好，稍后再试：' + (e.message || '请求失败')
      } finally {
        this.loading = false
      }
    },

    /* ==================== 本地快照（秒开）====================
       存 post + 第一页评论：从聊天里的分享卡反复点进来时，先画上次的内容，
       再静默刷新。键带 postId（全局唯一 id），切账号也不会串。
       体积上限 60KB，超了不存 —— 多图大正文宁可不缓存，也不撑爆 storage。 */
    snapKey() {
      return this.postId ? 'post_snap_v1_' + this.postId : ''
    },

    hydrateSnapshot() {
      const key = this.snapKey()
      if (!key) return false
      try {
        const raw = uni.getStorageSync(key)
        if (!raw || !raw.post) return false
        this.post = raw.post
        if (Array.isArray(raw.comments)) this.comments = raw.comments
        this.page = raw.page || 1
        this.hasMore = !!raw.hasMore
        this.loading = false
        return true
      } catch (e) {
        return false
      }
    },

    writeSnapshot() {
      const key = this.snapKey()
      if (!key || !this.post) return
      try {
        // 只存第一页评论，并把 page / hasMore 一起对齐到"第一页"：
        // 否则用户在页内翻过两页后再进来，快照里只有第一页内容却记着 page=3，
        // 下一次上拉会直接要第 4 页，中间两页就永远跳过了。
        const overOnePage = this.comments.length > PAGE_SIZE
        const payload = {
          post: this.post,
          comments: this.comments.slice(0, PAGE_SIZE),
          page: overOnePage ? 1 : this.page,
          hasMore: overOnePage ? true : this.hasMore,
          savedAt: Date.now()
        }
        const text = JSON.stringify(payload)
        if (text.length > 60000) return
        uni.setStorageSync(key, payload)
      } catch (e) {
        // 缓存写不进去不影响任何功能
      }
    },

    clearSnapshot() {
      const key = this.snapKey()
      if (!key) return
      try {
        uni.removeStorageSync(key)
      } catch (e) {
        // 忽略
      }
    },

    /* 快照里的图片链接是上次换好的临时链接，约 2 小时过期，过期后 <image> 就是白块：
       静默补刷一次详情把新链接换回来（一次进入只补一次，不会死循环）。 */
    onImgError() {
      if (this.imgRetry) return
      this.imgRetry = true
      this.loadPost(true)
    },

    onAvaError() {
      // 头像失效：保持空圆（不落任何默认图），再借同一次补刷换回新链接
      this.avaOnError('p' + this.postId, this.post && this.post.owner ? this.post.owner.avatar_url : '')
      if (this.post && this.post.owner) this.post.owner.avatar_url = ''
      this.onImgError()
    },

    /**
     * 上报一次浏览（browse-record：{ token, target_type:'post', target_id } → { code:0, data:{ recorded:true } }）。
     * 由 loadPost 成功分支调用而不是 onLoad 开头：加载失败或动态已删的 id 不该进浏览记录。
     * browseDone 保证一次进入只报一次；没有 token 直接跳过；失败静默，不影响页面任何表现。
     */
    async reportBrowse() {
      if (this.browseDone || !this.postId) return
      const token = this.tokenOf()
      if (!token) return
      this.browseDone = true
      try {
        await uniCloud.callFunction({
          name: 'browse-record',
          data: { token: token, target_type: 'post', target_id: this.postId }
        })
      } catch (e) {
        // 静默：上报失败不影响页面任何表现
      }
    },

    async loadComments(reset) {
      if (this.cLoading) return
      if (!reset && !this.hasMore) return
      this.cLoading = true
      const page = reset ? 1 : this.page + 1
      try {
        const res = await uniCloud.callFunction({
          name: 'post-comment',
          data: {
            token: this.tokenOf(),
            post_id: this.postId,
            action: 'list',
            page: page,
            page_size: PAGE_SIZE
          }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          // 正文都没打开时不必再叠一条评论错误提示（页面已经是错误态）
          if (this.post) uni.showToast({ title: r.msg || '评论加载失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        const arr = d.list || []
        this.comments = reset ? arr : this.comments.concat(arr)
        this.page = d.page || page
        this.hasMore = !!d.has_more
        // 第一页评论跟正文一起落快照：下次进来直接有内容，不用再等这一趟
        if (reset) this.writeSnapshot()
      } catch (e) {
        if (this.post) uni.showToast({ title: '评论加载失败，稍后再试', icon: 'none' })
      } finally {
        this.cLoading = false
      }
    },

    async sendComment() {
      if (this.sending) return
      const text = (this.draft || '').trim()
      if (!text) {
        uni.showToast({ title: '说点什么', icon: 'none' })
        return
      }
      if (text.length > MAX_COMMENT) {
        uni.showToast({ title: '评论最多 200 字', icon: 'none' })
        return
      }
      const token = this.tokenOf()
      if (!token) {
        uni.showToast({ title: '未登录', icon: 'none' })
        return
      }
      this.sending = true
      try {
        const res = await uniCloud.callFunction({
          name: 'post-comment',
          data: { token: token, post_id: this.postId, action: 'add', content: text }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '发送失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        this.draft = ''
        // 服务端给了权威条数就用它：连发两条时本地累加会和真实条数漂移
        if (this.post) {
          this.post.comment_count =
            typeof d.comment_count === 'number' ? d.comment_count : (this.post.comment_count || 0) + 1
        }
        // 直接插到最前，省一次 list 往返；owner 用本地缓存的自己顶上
        this.comments.unshift({
          _id: d.comment_id || 'local-' + Date.now(),
          content: text,
          created_at: Date.now(),
          is_mine: true,
          owner: this.meOf()
        })
        uni.showToast({ title: '已发送', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: '发送失败，稍后再试', icon: 'none' })
      } finally {
        this.sending = false
      }
    },

    meOf() {
      let u = {}
      try {
        u = uni.getStorageSync('userInfo') || {}
      } catch (e) {
        u = {}
      }
      return {
        _id: u._id || '',
        nickname: u.nickname || '我',
        avatar_url: u.avatar_url || '',
        school: u.school || '',
        is_verified: !!u.is_verified
      }
    },

    confirmDelete() {
      uni.showModal({
        title: '删除这条动态',
        content: '删除后别人就看不到了，确定吗？',
        success: (res) => {
          if (res.confirm) this.doDelete()
        }
      })
    },

    async doDelete() {
      const token = this.tokenOf()
      if (!token) {
        uni.showToast({ title: '未登录', icon: 'none' })
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'post-delete',
          data: { token: token, post_id: this.postId }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '删除失败', icon: 'none' })
          return
        }
        uni.showToast({ title: '已删除', icon: 'success' })
        // 等 toast 露一下再退，否则用户看不到任何反馈就回到列表了
        setTimeout(() => uni.navigateBack(), 600)
      } catch (e) {
        uni.showToast({ title: '删除失败，稍后再试', icon: 'none' })
      }
    },

    /* 点赞：先本地切（即时反馈），再用服务端 like_count 覆盖；
       失败一律回滚，不给用户留一个假的红心 —— 与 feed 保持同一套口径 */
    onLike() {
      const p = this.post
      if (!p) return
      const token = this.tokenOf()
      if (!token) {
        uni.showToast({ title: '登录后才能点赞', icon: 'none' })
        return
      }
      const was = !!p.liked
      const oldCount = p.like_count || 0
      p.liked = !was
      p.like_count = oldCount + (was ? -1 : 1)
      uniCloud
        .callFunction({ name: 'post-like', data: { token: token, card_id: this.postId, like: p.liked } })
        .then((res) => {
          const r = (res && res.result) || {}
          const d = r.data || null
          if (r.code === 0 && d && typeof d.like_count === 'number') {
            p.like_count = d.like_count
          } else {
            p.liked = was
            p.like_count = oldCount
          }
        })
        .catch(() => {
          p.liked = was
          p.like_count = oldCount
        })
    },

    previewImage(i) {
      const urls = this.imgs
      if (!urls.length) return
      uni.previewImage({ urls: urls, current: i })
    },

    ago(t) {
      if (!t) return ''
      const diff = Date.now() - Number(t)
      if (!(diff > 0)) return ''
      const min = Math.floor(diff / 60000)
      if (min < 1) return '刚刚'
      if (min < 60) return min + ' 分钟前'
      const hr = Math.floor(min / 60)
      if (hr < 24) return hr + ' 小时前'
      const day = Math.floor(hr / 24)
      if (day < 30) return day + ' 天前'
      const d = new Date(t)
      const mm = ('0' + (d.getMonth() + 1)).slice(-2)
      const dd = ('0' + d.getDate()).slice(-2)
      return mm + '-' + dd
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  /* ★ 同款坑：简写里带 constant() 会被安卓整条丢弃，左右内边距跟着一起没了 */
  padding: 0 24rpx 180rpx;
  padding-bottom: calc(180rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(180rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

/* 吸顶导航 */
.nav {
  position: sticky;
  top: 0;
  z-index: 30;
  height: 88rpx;
  margin: 0 -24rpx 20rpx;
  padding-top: var(--status-bar-height);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(249, 242, 232, 0.94);
  backdrop-filter: blur(12rpx);
  -webkit-backdrop-filter: blur(12rpx);
}
/* top/bottom + margin auto 居中，不硬算状态栏高度 */
.nav-back {
  position: absolute;
  left: 20rpx;
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

/* ---- 加载 / 失败态 ---- */
.state {
  padding: 140rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}
.state-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}
.state-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.state-hint {
  font-size: 25rpx;
  color: var(--tf-text-2);
  text-align: center;
  line-height: 1.6;
}

/* ---- 主卡：与发动态页同一套视觉变量 ---- */
.card {
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: 32rpx;
  box-shadow: 0 10rpx 28rpx rgba(120, 90, 50, 0.09);
  padding: 30rpx 28rpx;
}

/* ---- 作者行 ---- */
.head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 18rpx;
}
.ava {
  width: 76rpx;
  height: 76rpx;
  border-radius: 50%;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 800;
  color: var(--tf-primary-deep);
  background: var(--tf-primary-soft);
}

/* 有头像时 .ava 只当尺寸盒用：改成图片裁切。
   没有可用链接时只留同尺寸空圆，不放任何默认头像图、也不用昵称首字 */
.ava-img {
  display: block;
  overflow: hidden;
}
.who {
  flex: 1;
  min-width: 0;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.name {
  font-size: 28rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.verified {
  height: 32rpx;
  padding: 0 10rpx;
  border-radius: 999rpx;
  background: var(--tf-mist);
  color: var(--tf-mint);
  font-size: 20rpx;
  display: flex;
  align-items: center;
}
.meta {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--tf-text-3);
}
.del {
  flex: none;
  padding: 8rpx 16rpx;
  border-radius: var(--tf-r-sm);
  font-size: 24rpx;
  color: var(--tf-danger);
}

/* ---- 正文 ----
   长中文串没有空格，默认断行会把它挤成一整行把卡片顶宽。
   break-word 先兜老引擎，overflow-wrap:anywhere 再接管；
   pre-wrap 保留用户自己敲的换行。 */
.body-text {
  display: block;
  margin-top: 20rpx;
  font-size: 30rpx;
  line-height: 1.72;
  color: var(--tf-text);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  overflow-wrap: anywhere;
}

/* ---- 图片 ---- */
.media {
  margin-top: 20rpx;
}
.hero-img {
  width: 100%;
  height: 420rpx;
  display: block;
  border-radius: var(--tf-r-md);
  background: var(--tf-bg);
}
.grid {
  margin-top: 20rpx;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}
.grid-img {
  width: calc((100% - 12rpx) / 2);
  height: 300rpx;
  border-radius: var(--tf-r-sm);
  background: var(--tf-bg);
}

/* ---- 点赞行 ---- */
.actbar {
  display: flex;
  align-items: center;
  gap: 28rpx;
  margin-top: 22rpx;
}
.act {
  display: flex;
  align-items: center;
  gap: 8rpx;
}
/* 通用操作图标（评论 💬 / 分享 ↗） */
.act-ic {
  font-size: 30rpx;
  color: var(--tf-text-3);
  line-height: 1;
}

/* 点赞心：用 SVG 背景，不用字符 ♥
   —— 字符的粗细形状完全由系统字体决定，安卓上和设计稿差很远。
      SVG 背景在任何设备上都一样。 */
.act-heart {
  width: 34rpx;
  height: 34rpx;
  flex: none;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' fill='%239A9186'/%3E%3C/svg%3E") no-repeat center / contain;
  transition: transform 220ms cubic-bezier(0.34, 1.4, 0.5, 1);
}
/* 选中：固定红，不跟 --tf-primary（本页主色是晴空蓝） */
.act-heart--on {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' fill='%23F5455F'/%3E%3C/svg%3E");
  transform: scale(1.12);
}
.act-n {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

.hr {
  height: 2rpx;
  background: var(--tf-line);
  margin: 24rpx 0;
}

/* ---- 评论 ---- */
.c-title {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.c-empty {
  padding: 48rpx 0 24rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.c-empty-text {
  font-size: 25rpx;
  color: var(--tf-text-3);
}
.c-item {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
  padding: 24rpx 0;
  border-bottom: 2rpx solid var(--tf-line-soft);
}
.c-ava-img {
  display: block;
  overflow: hidden;
  background: var(--tf-card-line);
}
.c-ava {
  width: 60rpx;
  height: 60rpx;
  border-radius: 50%;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  font-weight: 800;
  color: var(--tf-primary-deep);
  background: var(--tf-primary-soft);
}
.c-main {
  flex: 1;
  min-width: 0;
}
.c-name-row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}
.c-name {
  font-size: 25rpx;
  font-weight: 700;
  color: var(--tf-text-2);
}
.c-verified {
  height: 28rpx;
  padding: 0 8rpx;
  border-radius: 999rpx;
  background: var(--tf-mist);
  color: var(--tf-mint);
  font-size: 18rpx;
  display: flex;
  align-items: center;
}
/* 评论同样要能断长串：一条 200 字不带空格的评论同样会撑破一行 */
.c-text {
  display: block;
  margin-top: 6rpx;
  font-size: 27rpx;
  line-height: 1.65;
  color: var(--tf-text);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  overflow-wrap: anywhere;
}
.c-time {
  display: block;
  margin-top: 8rpx;
  font-size: 21rpx;
  color: var(--tf-text-3);
}
.c-more {
  padding: 28rpx 0 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.c-more-text {
  font-size: 24rpx;
  color: var(--tf-text-2);
}
.c-more-text--end {
  opacity: 0.7;
}

/* ---- 底部固定输入 ----
   fixed 让它脱离卡片流的滚动，键盘弹起时平台推的是视口/页面，
   这条始终贴在可视区底边；env() 只负责把按钮抬到 iPhone 小黑条之上。 */
.bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 24rpx;
  padding-bottom: calc(16rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(16rpx + env(safe-area-inset-bottom));
  background: var(--tf-card);
  border-top: 2rpx solid var(--tf-card-line);
  box-shadow: var(--tf-lift-sm);
  box-sizing: border-box;
  z-index: 10;
}
.bar-input {
  flex: 1;
  min-width: 0;
  height: 72rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: var(--tf-text);
  background: var(--tf-bg);
  border-radius: 999rpx;
  box-sizing: border-box;
}
.bar-ph {
  color: var(--tf-text-3);
}
.bar-btn {
  flex: none;
  margin: 0;
  height: 72rpx;
  line-height: 72rpx;
  padding: 0 32rpx;
  font-size: 27rpx;
  font-weight: 600;
  color: #ffffff;
  background: var(--tf-primary);
  border-radius: 999rpx;
  border: none;
}
.bar-btn::after {
  border: none;
}
.bar-btn--off {
  background: var(--tf-text-3);
  opacity: 0.6;
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
