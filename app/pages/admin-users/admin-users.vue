<template>
  <view class="page">
    <!-- 非管理员先看空态：本地判定完再决定发不发请求 -->
    <view class="deny" v-if="denied">
      <text class="deny-ico">🔒</text>
      <text class="deny-title">没有权限</text>
      <text class="deny-desc">这个页面只给管理员用。如果你是管理员但没有权限，说明你的账号还没被标记。</text>
    </view>

    <block v-else>
      <!-- 搜索：昵称 / UID；学校单独一行，避免和关键词混成一个框让人以为能一起搜 -->
      <view class="search">
        <input
          class="search-input"
          v-model="keyword"
          placeholder="搜索昵称 / UID"
          confirm-type="search"
          @confirm="search"
        />
        <input
          class="search-input"
          v-model="school"
          placeholder="学校（完整校名，留空不筛）"
          confirm-type="search"
          @confirm="search"
        />
        <view class="search-btn" @tap="search">
          <text class="search-btn-text">筛选</text>
        </view>
      </view>

      <view class="filter-row">
        <text class="filter-label">认证</text>
        <view class="tabs">
          <view
            class="tab"
            v-for="t in verifyTabs"
            :key="'v' + t.key"
            :class="{ 'tab--on': verifyStatus === t.key }"
            @tap="switchVerify(t.key)"
          >
            <text class="tab-text" :class="{ 'tab-text--on': verifyStatus === t.key }">{{ t.label }}</text>
          </view>
        </view>
      </view>

      <view class="filter-row">
        <text class="filter-label">信誉</text>
        <view class="tabs">
          <view
            class="tab"
            v-for="t in creditTabs"
            :key="'c' + t.key"
            :class="{ 'tab--on': creditBand === t.key }"
            @tap="switchCredit(t.key)"
          >
            <text class="tab-text" :class="{ 'tab-text--on': creditBand === t.key }">{{ t.label }}</text>
          </view>
        </view>
      </view>

      <!-- 四态：加载中 / 出错 / 空 / 正常 -->
      <text class="hint" v-if="loading">加载中…</text>
      <text class="hint hint--err" v-else-if="errMsg" @tap="loadList">{{ errMsg }}，点这里重试</text>
      <text class="hint" v-else-if="!list.length">没有符合条件的用户</text>

      <view class="item" v-for="u in list" :key="u.user_id" @tap="openDetail(u)">
        <!-- 头像：common/avatar/avatarCache.js —— 本地落盘 + 解码完成后整体淡入。
             key 用 'au' + user_id：同一行多次渲染不变，淡入不会反复触发。
             没有可用本地路径就留同尺寸空圆，绝不塞默认头像图。 -->
        <image
          v-if="avaSrcOf('au' + u.user_id)"
          class="item-avatar ava-fade"
          :class="{ 'ava-fade--in': avaReadyOf('au' + u.user_id) }"
          :src="avaSrcOf('au' + u.user_id)"
          mode="aspectFill"
          @load="avaOnLoad('au' + u.user_id)"
          @error="avaOnError('au' + u.user_id, u.avatar)"
        />
        <view v-else class="item-avatar" />
        <view class="item-main">
          <view class="item-head">
            <text class="item-name">{{ u.nickname || '未填昵称' }}</text>
            <text class="item-mode" v-if="u.is_verified">已认证</text>
            <text class="item-banned" v-if="u.status === 'banned'">已封禁</text>
          </view>
          <text class="item-school">{{ u.school || '未填学校' }}</text>
          <view class="item-foot">
            <text class="item-no">UID {{ u.uid || '未生成' }}</text>
            <text class="item-time">信誉 {{ u.credit_score === null || u.credit_score === undefined ? '—' : u.credit_score }}</text>
          </view>
        </view>
      </view>

      <view class="mask" v-if="detail" @tap="closeDetail"></view>
      <view class="sheet" v-if="detail">
        <view class="sheet-head">
          <text class="sheet-title">用户</text>
          <text class="sheet-close" @tap="closeDetail">✕</text>
        </view>

        <scroll-view class="sheet-body" scroll-y>
          <view class="kv">
            <text class="k">昵称</text>
            <text class="v">{{ detail.nickname || '—' }}</text>
          </view>
          <view class="kv">
            <text class="k">UID</text>
            <text class="v">{{ detail.uid || '—' }}</text>
          </view>
          <view class="kv">
            <text class="k">学校</text>
            <text class="v">{{ detail.school || '—' }}</text>
          </view>
          <view class="kv">
            <text class="k">认证</text>
            <text class="v">{{ detail.is_verified ? '已认证' : '未认证' }}</text>
          </view>
          <view class="kv">
            <text class="k">信誉分</text>
            <text class="v">{{ detail.credit_score === null || detail.credit_score === undefined ? '—' : detail.credit_score }}</text>
          </view>
          <view class="kv">
            <text class="k">状态</text>
            <text class="v">{{ detail.status === 'banned' ? '已封禁' : '正常' }}</text>
          </view>

          <!-- 封禁会立刻影响对方能不能登录，后果写清楚再让人确认 -->
          <text class="proof-tip" v-if="detail.status !== 'banned'"
            >封禁后该用户无法登录、无法发布卡片，也无法被匹配。解封可随时恢复。</text
          >
          <text class="proof-tip" v-else>解封后该用户可以重新登录和发布。</text>
        </scroll-view>

        <view class="sheet-foot">
          <button class="btn" v-if="detail.status !== 'banned'" :disabled="acting" @tap="ban">
            封禁该用户
          </button>
          <button class="btn btn--reject" v-else :disabled="acting" @tap="unban">解封该用户</button>
        </view>
      </view>
    </block>
  </view>
</template>
<script>
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

export default {
  // 头像淡入的公共时序（common/avatar/avatarCache.js）
  mixins: [avatarFadeMixin],
  data() {
    return {
      denied: false,
      keyword: '',
      school: '',
      verifyStatus: '',
      creditBand: '',
      list: [],
      loading: false,
      errMsg: '',
      detail: null,
      acting: false,
      verifyTabs: [
        { key: '', label: '全部' },
        { key: 'verified', label: '已认证' },
        { key: 'unverified', label: '未认证' }
      ],
      creditTabs: [
        { key: '', label: '全部' },
        { key: 'low', label: '低 (<60)' },
        { key: 'mid', label: '中 (60-79)' },
        { key: 'high', label: '高 (≥80)' }
      ]
    };
  },

  // 头像：整页一次挂上。list 每次搜索/切 tab 都是新数组，deep 保证字段回填也能重挂。
  watch: {
    list: {
      immediate: true,
      deep: true,
      handler(list) {
        this.avaSync(
          list,
          (u) => 'au' + (u && u.user_id),
          (u) => u && u.avatar
        )
      }
    }
  },

  onShow() {
    // 本地先判管理员：不是就直接挡住，一个请求都不发
    if (!this.isLocalAdmin()) {
      this.denied = true;
      return;
    }
    this.denied = false;
    this.loadList();
  },

  onPullDownRefresh() {
    if (this.denied) {
      uni.stopPullDownRefresh();
      return;
    }
    this.loadList().finally(() => uni.stopPullDownRefresh());
  },

  methods: {
    // 管理员两种写法都认，与全项目口径一致
    isLocalAdmin() {
      const info = uni.getStorageSync('userInfo') || {};
      return info.role === 'admin' || info.is_admin === true;
    },

    // 写法与 verify-admin 保持一致：403 当权限问题处理，其它非 0 一律当错误消息
    async call(data) {
      const token = uni.getStorageSync('token') || '';
      const res = await uniCloud.callFunction({
        name: 'admin-users',
        data: Object.assign({ token }, data)
      });
      const r = res.result || {};
      if (r.code === 403) {
        this.denied = true;
        throw new Error(r.msg || '没有权限');
      }
      if (r.code !== 0) throw new Error(r.msg || '请求失败');
      return r.data || {};
    },

    async loadList() {
      this.loading = true;
      this.errMsg = '';
      try {
        const data = { action: 'list', page: 1, page_size: 20 };
        // 空串不下发：把空串当筛选条件会筛出 0 条，用户会以为库里没人
        if (this.keyword && this.keyword.trim()) data.keyword = this.keyword.trim();
        if (this.school && this.school.trim()) data.school = this.school.trim();
        if (this.verifyStatus) data.verify_status = this.verifyStatus;
        if (this.creditBand) data.credit_band = this.creditBand;
        const d = await this.call(data);
        this.list = d.list || [];
      } catch (e) {
        // 403 已经在 call 里转成 deny 空态，这里只接业务/网络错误
        if (!this.denied) this.errMsg = e.message || '加载失败';
      } finally {
        this.loading = false;
      }
    },

    search() {
      this.detail = null;
      this.loadList();
    },

    switchVerify(k) {
      if (this.verifyStatus === k) return;
      this.verifyStatus = k;
      this.list = [];
      this.detail = null;
      this.loadList();
    },

    switchCredit(k) {
      if (this.creditBand === k) return;
      this.creditBand = k;
      this.list = [];
      this.detail = null;
      this.loadList();
    },

    openDetail(u) {
      this.detail = u;
    },

    closeDetail() {
      this.detail = null;
    },

    async ban() {
      if (this.acting || !this.detail) return;
      const u = this.detail;
      const ok = await new Promise((resolve) => {
        uni.showModal({
          title: '确认封禁',
          content:
            '封禁后该用户无法登录、无法发布。确认封禁「' + (u.nickname || '该用户') + '」？',
          success: (res) => resolve(res.confirm)
        });
      });
      if (!ok) return;

      this.acting = true;
      try {
        const d = await this.call({ action: 'ban', user_id: u.user_id });
        // 原地更新这一条，不整页重拉；封禁后留在列表里才好马上解封
        const target = this.list.find((x) => x.user_id === u.user_id);
        if (target) target.status = d.status || 'banned';
        this.detail = null;
        uni.showToast({ title: '已封禁', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: e.message, icon: 'none' });
      } finally {
        this.acting = false;
      }
    },

    async unban() {
      if (this.acting || !this.detail) return;
      const u = this.detail;
      const ok = await new Promise((resolve) => {
        uni.showModal({
          title: '确认解封',
          content: '解封后「' + (u.nickname || '该用户') + '」可以重新登录和发布。',
          success: (res) => resolve(res.confirm)
        });
      });
      if (!ok) return;

      this.acting = true;
      try {
        const d = await this.call({ action: 'unban', user_id: u.user_id });
        const target = this.list.find((x) => x.user_id === u.user_id);
        if (target) target.status = d.status || 'normal';
        this.detail = null;
        uni.showToast({ title: '已解封', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: e.message, icon: 'none' });
      } finally {
        this.acting = false;
      }
    }
  }
};
</script>

<style>
.page {
  min-height: 100vh;
  padding: 24rpx 32rpx 80rpx;
  box-sizing: border-box;
  background-color: transparent;
}

/* ---- 无权限 ---- */
.deny {
  padding: 120rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
}

.deny-ico {
  font-size: 96rpx;
}

.deny-title {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.deny-desc {
  font-size: 25rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
  text-align: center;
}

/* ---- 搜索 ---- */
.search {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  margin-bottom: 20rpx;
}

.search-input {
  height: 72rpx;
  padding: 0 24rpx;
  font-size: 26rpx;
  box-sizing: border-box;
  background-color: rgba(255, 255, 255, 0.96);
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 16rpx;
}

.search-btn {
  height: 72rpx;
  background-color: var(--tf-primary);
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-btn-text {
  font-size: 26rpx;
  font-weight: 600;
  color: #ffffff;
}

.filter-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 16rpx;
}

.filter-label {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

/* ---- 筛选 ---- */
.tabs {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12rpx;
}

.tab {
  padding: 10rpx 24rpx;
  border-radius: 999rpx;
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}

.tab--on {
  background-color: var(--tf-primary);
}

.tab-text {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

.tab-text--on {
  color: #ffffff;
  font-weight: 600;
}

.hint {
  display: block;
  padding: 60rpx 0;
  font-size: 25rpx;
  color: var(--tf-text-2);
  text-align: center;
}

/* 出错是可重试的，给它主色，和"真的没有数据"区分开 */
.hint--err {
  color: var(--tf-primary);
}

/* ---- 列表项 ---- */
.item {
  position: relative;
  padding: 26rpx;
  margin-bottom: 16rpx;
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  border-radius: 24rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20rpx;
}

.item-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 44rpx;
  flex-shrink: 0;
  background-color: var(--tf-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.item-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}

.item-name {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.item-mode {
  padding: 4rpx 14rpx;
  font-size: 20rpx;
  color: var(--tf-success);
  background-color: var(--tf-primary-soft);
  border-radius: 8rpx;
}

/* 封禁是危险状态，用红色标出来，一眼能扫到 */
.item-banned {
  padding: 4rpx 14rpx;
  font-size: 20rpx;
  color: #ffffff;
  background-color: var(--tf-danger);
  border-radius: 8rpx;
}

.item-school {
  font-size: 25rpx;
  color: var(--tf-text-2);
}

.item-foot {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 4rpx;
}

.item-no {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

.item-time {
  font-size: 22rpx;
  color: var(--tf-text-2);
}

/* ---- 弹层 ---- */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.45);
  z-index: 20;
}

.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 86vh;
  padding: 32rpx 32rpx 40rpx;
  box-sizing: border-box;
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  border-radius: 32rpx 32rpx 0 0;
  z-index: 21;
  display: flex;
  flex-direction: column;
}

.sheet-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.sheet-close {
  font-size: 32rpx;
  color: var(--tf-text-2);
  padding: 0 8rpx;
}

.sheet-body {
  flex: 1;
  max-height: 64vh;
}

.kv {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 18rpx 0;
  border-bottom: 2rpx solid var(--tf-line-soft);
}

.k {
  font-size: 25rpx;
  color: var(--tf-text-2);
}

.v {
  font-size: 26rpx;
  color: var(--tf-text);
}

.proof-tip {
  display: block;
  margin-top: 24rpx;
  font-size: 22rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
}

.sheet-foot {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
  margin-top: 24rpx;
}

.sheet-foot .btn {
  flex: 1;
  height: 92rpx;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 92rpx;
  color: #ffffff;
  background-color: var(--tf-danger);
  border-radius: 20rpx;
}

.sheet-foot .btn--reject {
  background-color: var(--tf-success);
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
