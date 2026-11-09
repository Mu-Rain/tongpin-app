<template>
  <view class="page">
    <view class="head">
      <text class="head-title">切换账号</text>
      <text class="head-desc">这台设备登录过的号都在下面，点一下直接进。登录凭据过期了才需要重新输密码。</text>
    </view>

    <!-- 登录过的号 -->
    <view class="list" v-if="accounts.length">
      <view
        v-for="a in accounts"
        :key="a.user_id"
        class="acc"
        :class="{ 'acc--current': a.user_id === currentId }"
        @tap="onPick(a)"
      >
        <!-- 头像：common/avatar/avatarCache.js —— 本地落盘 + 解码完成后整体淡入。
             key 用 'acc' + user_id：同一个号在多次渲染间不变，淡入不会反复触发。
             没有可用本地路径就留同尺寸空圆，绝不塞默认头像图。 -->
        <image
          v-if="avaSrcOf('acc' + a.user_id)"
          class="acc-avatar acc-avatar--img ava-fade"
          :class="{ 'ava-fade--in': avaReadyOf('acc' + a.user_id) }"
          :src="avaSrcOf('acc' + a.user_id)"
          mode="aspectFill"
          @load="avaOnLoad('acc' + a.user_id)"
          @error="onAccImgError(a)"
        />
        <view v-else class="acc-avatar" />
        <view class="acc-main">
          <view class="acc-top">
            <text class="acc-name">{{ a.nickname || '同学' }}</text>
            <text v-if="a.user_id === currentId" class="acc-badge">当前</text>
            <text v-else-if="!usable(a)" class="acc-badge acc-badge--warn">需重新登录</text>
          </view>
          <text class="acc-sub">{{ maskPhone(a.phone) }}<text v-if="a.school"> · {{ a.school }}</text></text>
        </view>
        <text class="acc-arrow">›</text>
      </view>
    </view>

    <view class="empty" v-else>
      <text class="empty-title">还没有登录过别的号</text>
      <text class="empty-desc">在这里登录过一次的号会自动记下来，下次切换就不用再输密码。</text>
    </view>

    <!-- 用一个新号 -->
    <view class="actions">
      <button class="btn btn--primary" @tap="goNewLogin">用其他手机号登录 →</button>
      <button class="btn btn--plain" @tap="onClearAll" v-if="accounts.length">清空账号列表</button>
    </view>

    <!--
      为什么不是点一下就直接切：
      切号会改变"我是谁"，误触代价大（比如正在给别人发消息时点错），
      所以当前账号那一条不响应点击，其他号点之前再确认一次。
    -->
    <view class="note">
      <text class="note-title">说明</text>
      <text class="note-line">· 切换不会删除任何聊天记录，两个号的数据都还在服务器上</text>
      <text class="note-line">· 这里只记登录凭据，不存密码</text>
      <text class="note-line">· 最多记住 {{ MAX_ACCOUNTS }} 个号，超出的会自动丢掉最久没登的</text>
    </view>
  </view>
</template>

<script>
import book from '@/common/account/book.js'
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

export default {
  // 头像淡入的公共时序（common/avatar/avatarCache.js）
  mixins: [avatarFadeMixin],
  data() {
    return {
      accounts: [],
      currentId: '',
      MAX_ACCOUNTS: 5
    }
  },

  // 头像：整页一次挂上。avatar_url 由 fillAvatars 批量换链后回填，
  // 所以 watch 必须 deep：字段改了也要重新挂。
  watch: {
    accounts: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (a) => 'acc' + (a && a.user_id),
          (a) => a && a.avatar_url
        )
      }
    }
  },

  onShow() {
    this.load()
    // 换链在 load 之后：listAll 每次返回新对象，先拿到这一屏的记录再批量换
    this.fillAvatars()
  },

  methods: {
    load() {
      this.accounts = book.listAll()
      this.currentId = book.currentUserId()

      // 当前账号没在簿里（老用户、或者账号簿是这次更新后才有的），
      // 就现补一条，否则用户看到的第一屏是空的，以为坏了。
      if (this.currentId && !this.accounts.some((a) => a.user_id === this.currentId)) {
        const token = uni.getStorageSync('token')
        const u = uni.getStorageSync('userInfo') || {}
        if (token && u._id) {
          book.remember({ token: token, user: u })
          this.accounts = book.listAll()
        }
      }
    },

    /**
     * 头像地址：账号簿存的是「稳定标识」（cloud:// fileID 优先，其次 /static/...，再次 http），
     * <image> 只认 http / 本地路径，所以先批量换一次链。
     * 换不到就**不写**（保留上一次的地址，下次进页面再试）—— 老实现写空串，
     * 一次失败的换链就被记成「这个号没头像」，之后再也不试了。
     * 还有一层兜底：本地怎么都凑不出地址、而它凭据还能用，就拿它自己的 token 问一次 user-me。
     * 失败一律静默留同尺寸空圆 —— 绝不塞默认头像图。
     */
    async fillAvatars() {
      const unconverted = await this.paintAvatars()

      // 本地换不动链/根本没标识的才联网问（每个号每进程只问一次，见 book.refreshAvatar）
      const pending = []
      for (const a of unconverted) {
        if (book.isUsable(a)) pending.push(a)
      }
      for (const a of this.accounts || []) {
        if (!book.avatarOf(a) && book.isUsable(a)) pending.push(a)
      }
      if (!pending.length) return

      let changed = false
      for (const a of pending) {
        const got = await book.refreshAvatar(a.user_id)
        if (got) changed = true
      }
      if (!changed) return
      // refreshAvatar 已经把结果写回账号簿，重取一份再换一次链
      this.accounts = book.listAll()
      await this.paintAvatars()
    },

    /** 把每条记录的显示地址落到 avatar_url；返回「云链换不出来」的那几条 */
    async paintAvatars() {
      const list = this.accounts || []
      const srcs = []
      const ids = []
      for (const a of list) {
        const src = book.avatarOf(a)
        srcs.push(src)
        if (src.indexOf('cloud://') === 0 && ids.indexOf(src) < 0) ids.push(src)
      }

      const map = {}
      if (ids.length) {
        try {
          const res = await uniCloud.getTempFileURL({ fileList: ids })
          const fl = (res && res.fileList) || []
          for (const it of fl) {
            // fileID 由服务端原样带回；tempFileURL 为空说明文件没了或没权限
            if (it && it.fileID && it.tempFileURL) map[it.fileID] = it.tempFileURL
          }
        } catch (e) {
          // 静默：整批换不到链，各条保留上一次的地址（没有就空圆）
        }
      }

      const unconverted = []
      for (let i = 0; i < list.length; i++) {
        const a = list[i]
        const src = srcs[i]
        if (src.indexOf('cloud://') === 0) {
          const url = map[src]
          if (url) a.avatar_url = url
          else {
            unconverted.push(a)
            // 客户端换不动链时，先用服务端上次给的临时链接顶着（下次 user-me 会给新的）
            const alt = String((a.profile || {}).avatar_url || '')
            if (!a.avatar_url && alt.indexOf('http') === 0) a.avatar_url = alt
          }
        } else if (src.charAt(0) === '/' || src.indexOf('http') === 0) {
          // 包内静态路径和 http 直链本身就是可用地址
          a.avatar_url = src
        }
        // 空标识：不动 avatar_url（没有就是空圆），也不把上一次的地址抹掉
      }
      return unconverted
    },

    /* 头像图裂了：先按 mixin 作废旧缓存，再把「已经死掉的 http 地址」降级，
       最后问一次服务端（book.refreshAvatar 失败会撤回「已问过」标记，所以这里能真重试）。
       不这么做的话，一条过期的临时链接会被一直当成 bestAvatar，页面永远显示空圆。 */
    onAccImgError(a) {
      if (!a) return
      this.avaOnError('acc' + a.user_id, a.avatar_url)
      a.avatar_url = ''
      const dropped = book.markAvatarDead(a.user_id)
      if (dropped || !book.avatarOf(a)) this.healOne(a)
    },

    async healOne(a) {
      const got = await book.refreshAvatar(a.user_id)
      if (!got) return
      this.accounts = book.listAll()
      await this.paintAvatars()
    },

    usable(a) {
      return book.isUsable(a)
    },

    maskPhone(p) {
      const s = String(p || '')
      if (s.length !== 11) return s || '未记录手机号'
      return s.slice(0, 3) + '****' + s.slice(7)
    },

    onPick(a) {
      if (a.user_id === this.currentId) {
        uni.showToast({ title: '这已经是当前账号', icon: 'none' })
        return
      }

      if (!this.usable(a)) {
        uni.showModal({
          title: '需要重新登录',
          content: '「' + (a.nickname || '这个号') + '」的登录凭据已过期，需要重新输一次密码。',
          success: (r) => {
            if (!r.confirm) return
            this.goNewLogin()
          }
        })
        return
      }

      uni.showModal({
        title: '切换账号',
        content: '切换到「' + (a.nickname || '这个号') + '」？',
        confirmText: '切换',
        success: async (r) => {
          if (!r.confirm) return
          const ok = book.switchTo(a.user_id)
          if (!ok) {
            uni.showToast({ title: '切换失败，请重新登录', icon: 'none' })
            return
          }
          // ★ 账号簿只保证「能切回去」，字段不一定齐（信誉分/角色/school_id 都可能缺），
          //   老版本 remember 甚至只存了昵称头像。切完补一次 user-me，
          //   否则「我的」页信誉条是空的、管理员入口也不显示（m02962）。
          //   失败不影响切换本身，hydrate 内部已经吞掉异常。
          await book.hydrate()
          uni.showToast({ title: '已切换到 ' + (a.nickname || '新号'), icon: 'none' })
          setTimeout(() => {
            uni.reLaunch({ url: '/pages/index/index' })
          }, 500)
        }
      })
    },

    goNewLogin() {
      // 先把当前会话清掉，登录页才会显示空白表单而不是"以 xxx 继续"
      uni.removeStorageSync('token')
      uni.removeStorageSync('userInfo')
      uni.removeStorageSync('autoLogin')
      uni.reLaunch({ url: '/pages/login/login' })
    },

    onClearAll() {
      uni.showModal({
        title: '清空账号列表',
        content: '会删掉这台设备记住的所有号（不影响服务器上的账号和数据）。下次要用哪个号得重新输密码。',
        confirmText: '清空',
        success: (r) => {
          if (!r.confirm) return
          const cur = this.currentId
          for (const a of book.listAll()) {
            if (a.user_id !== cur) book.remove(a.user_id)
          }
          this.load()
          uni.showToast({ title: '已清空（保留当前账号）', icon: 'none' })
        }
      })
    }
  }
}
</script>

<style>
.page {
  min-height: 100vh;
  padding: 32rpx 32rpx 80rpx;
  box-sizing: border-box;
  background-color: transparent;
}

.head {
  margin-bottom: 24rpx;
}
.head-title {
  display: block;
  font-size: 40rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.head-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* ---- 账号列表 ---- */
.list {
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  border-radius: 28rpx;
  overflow: hidden;
}

.acc {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 22rpx;
  padding: 26rpx 28rpx;
  border-bottom: 2rpx solid var(--tf-line-soft);
}
.acc:last-child {
  border-bottom: none;
}
.acc--current {
  background-color: var(--tf-primary-soft);
}

.acc-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 44rpx;
  flex: none;
  background-color: var(--tf-primary);
  color: #ffffff;
  font-size: 36rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 真实头像：铺满圆形。基类的 --tf-primary 底色是给「首个字」占位用的，图铺满后透出来会发脏，
   这里换成中性底 + 显式裁切；写在基类之后，同权重靠源码顺序覆盖。 */
.acc-avatar--img {
  display: block;
  overflow: hidden;
  background-color: var(--tf-card-line);
  border-radius: 44rpx;
}

.acc-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  overflow: hidden;
}
.acc-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}
.acc-name {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--tf-text);
}
.acc-badge {
  font-size: 20rpx;
  font-weight: 700;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 999rpx;
  padding: 2rpx 14rpx;
}
.acc-badge--warn {
  background-color: var(--tf-danger);
}
.acc-sub {
  font-size: 23rpx;
  color: var(--tf-text-2);
}
.acc-arrow {
  flex: none;
  font-size: 40rpx;
  color: var(--tf-text-3);
  line-height: 1;
}

/* ---- 空态 ---- */
.empty {
  padding: 60rpx 32rpx;
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  border-radius: 28rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14rpx;
}
.empty-title {
  font-size: 30rpx;
  font-weight: 800;
  color: var(--tf-text);
}
.empty-desc {
  font-size: 24rpx;
  line-height: 1.6;
  text-align: center;
  color: var(--tf-text-2);
}

/* ---- 按钮 ---- */
.actions {
  margin-top: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 18rpx;
}
.btn {
  height: 92rpx;
  line-height: 92rpx;
  border-radius: 20rpx;
  font-size: 30rpx;
  font-weight: 700;
  text-align: center;
}
.btn--primary {
  background-color: var(--tf-primary);
  color: #ffffff;
}
.btn--plain {
  background: var(--tf-card);
  color: var(--tf-text-2);
  border: 2rpx solid var(--tf-line-soft);
}

/* ---- 说明 ---- */
.note {
  margin-top: 36rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}
.note-title {
  font-size: 24rpx;
  font-weight: 700;
  color: var(--tf-text-2);
}
.note-line {
  font-size: 22rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
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
