<template>
  <view class="page">
    <!-- 非管理员：直接挡在门外 -->
    <view class="deny" v-if="denied">
      <text class="deny-ico">🔒</text>
      <text class="deny-title">没有权限</text>
      <text class="deny-desc">这个页面只给管理员用。如果你是管理员但没有权限，说明你的账号还没被标记。</text>
    </view>

    <block v-else>
      <!-- 顶部筛选 -->
      <view class="tabs">
        <view
          class="tab"
          v-for="t in tabs"
          :key="t.key"
          :class="{ 'tab--on': status === t.key }"
          @tap="switchTab(t.key)"
        >
          <text class="tab-text" :class="{ 'tab-text--on': status === t.key }">{{ t.label }}</text>
        </view>
      </view>

      <text class="hint" v-if="!list.length && !loading">这里没有待处理的申请</text>

      <!-- 队列 -->
      <view class="item" v-for="r in list" :key="r._id" @tap="openDetail(r)">
        <view class="item-head">
          <text class="item-name">{{ r.real_name || '未填姓名' }}</text>
          <text class="item-mode">{{ r.mode === 'card' ? '学生证' : '学信网' }}</text>
        </view>
        <text class="item-school">{{ r.school_name }}</text>
        <view class="item-foot">
          <text class="item-no">学号 {{ r.student_no }}</text>
          <text class="item-time">{{ fmtTime(r.created_at) }}</text>
        </view>
        <view class="item-status" v-if="r.status !== 'pending'">
          <text class="item-status-text" :class="'item-status-text--' + r.status">
            {{ r.status === 'approved' ? '已通过' : '已拒绝' }}
          </text>
        </view>
      </view>

      <!-- 详情弹层 -->
      <view class="mask" v-if="detail" @tap="detail = null"></view>
      <view class="sheet" v-if="detail">
        <view class="sheet-head">
          <text class="sheet-title">审核</text>
          <text class="sheet-close" @tap="detail = null">✕</text>
        </view>

        <scroll-view class="sheet-body" scroll-y>
          <view class="kv">
            <text class="k">姓名</text>
            <text class="v">{{ detail.request.real_name }}</text>
          </view>
          <view class="kv">
            <text class="k">学校</text>
            <text class="v">{{ detail.request.school_name }}</text>
          </view>
          <view class="kv">
            <text class="k">学号</text>
            <text class="v">{{ detail.request.student_no }}</text>
          </view>
          <view class="kv" v-if="detail.request.grade">
            <text class="k">年级</text>
            <text class="v">{{ detail.request.grade }}</text>
          </view>
          <view class="kv">
            <text class="k">方式</text>
            <text class="v">{{ detail.request.mode === 'card' ? '学生证 / 校园卡' : '学信网报告' }}</text>
          </view>
          <view class="kv">
            <text class="k">用户昵称</text>
            <text class="v">{{ detail.user.nickname || '—' }}</text>
          </view>

          <!-- 证件图：点开放大 -->
          <text class="sec-title">材料</text>
          <image
            v-if="detail.request.photo_url"
            class="proof"
            :src="detail.request.photo_url"
            mode="widthFix"
            @tap="zoom(detail.request.photo_url)"
          />
          <image
            v-if="detail.request.chsi_url"
            class="proof"
            :src="detail.request.chsi_url"
            mode="widthFix"
            @tap="zoom(detail.request.chsi_url)"
          />
          <text class="empty" v-if="!detail.request.photo_url && !detail.request.chsi_url"
            >图片加载失败，可能是临时链接过期，请重开这条</text
          >
          <text class="proof-tip">点图片可放大。核对：证件上的姓名/学号/学校是否与上方一致，且能看出在读。</text>

          <!-- 拒绝理由 -->
          <block v-if="detail.request.status === 'pending'">
            <text class="sec-title">若拒绝，必须填理由</text>
            <textarea
              class="textarea"
              v-model="reason"
              placeholder="例如：照片模糊看不清学号 / 证件上没有学校名 / 学号与表单不一致"
              maxlength="100"
            />
          </block>
        </scroll-view>

        <view class="sheet-foot" v-if="detail.request.status === 'pending'">
          <button class="btn btn--reject" :disabled="acting" @tap="reject">拒绝</button>
          <button class="btn" :disabled="acting" @tap="pass">通过</button>
        </view>
        <view class="sheet-foot" v-else>
          <text class="done-text"
            >这条已处理：{{ detail.request.status === 'approved' ? '已通过' : '已拒绝' }}</text
          >
        </view>
      </view>
    </block>
  </view>
</template>

<script>
export default {
  data() {
    return {
      denied: false,
      status: 'pending',
      list: [],
      loading: false,
      detail: null,
      reason: '',
      acting: false,
      tabs: [
        { key: 'pending', label: '待审' },
        { key: 'approved', label: '已通过' },
        { key: 'rejected', label: '已拒绝' }
      ]
    };
  },

  onShow() {
    if (!this.denied) this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => uni.stopPullDownRefresh());
  },

  methods: {
    async call(data) {
      const token = uni.getStorageSync('token') || '';
      const res = await uniCloud.callFunction({
        name: 'verify-review',
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
      try {
        const d = await this.call({ action: 'list', status: this.status });
        this.list = d.list || [];
      } catch (e) {
        if (!this.denied) uni.showToast({ title: e.message, icon: 'none' });
      } finally {
        this.loading = false;
      }
    },

    switchTab(k) {
      if (this.status === k) return;
      this.status = k;
      this.list = [];
      this.loadList();
    },

    async openDetail(r) {
      this.reason = '';
      try {
        uni.showLoading({ title: '加载中' });
        const d = await this.call({ action: 'detail', request_id: r._id });
        this.detail = d;
      } catch (e) {
        uni.showToast({ title: e.message, icon: 'none' });
      } finally {
        uni.hideLoading();
      }
    },

    zoom(url) {
      uni.previewImage({ urls: [url], current: url });
    },

    async pass() {
      if (this.acting) return;
      const ok = await new Promise((resolve) => {
        uni.showModal({
          title: '确认通过',
          content: `确认「${this.detail.request.real_name}」是 ${this.detail.request.school_name} 的在校学生？通过后会发认证徽章并解锁同校频道。`,
          success: (res) => resolve(res.confirm)
        });
      });
      if (!ok) return;

      this.acting = true;
      try {
        await this.call({ action: 'pass', request_id: this.detail.request._id });
        uni.showToast({ title: '已通过', icon: 'success' });
        this.detail = null;
        this.loadList();
      } catch (e) {
        uni.showToast({ title: e.message, icon: 'none' });
      } finally {
        this.acting = false;
      }
    },

    async reject() {
      if (this.acting) return;
      const reason = (this.reason || '').trim();
      // 理由必填：不写理由用户不知道错在哪，会反复提交同一张图
      if (!reason) {
        uni.showToast({ title: '请填写拒绝理由', icon: 'none' });
        return;
      }
      this.acting = true;
      try {
        await this.call({ action: 'reject', request_id: this.detail.request._id, reason });
        uni.showToast({ title: '已拒绝', icon: 'success' });
        this.detail = null;
        this.reason = '';
        this.loadList();
      } catch (e) {
        uni.showToast({ title: e.message, icon: 'none' });
      } finally {
        this.acting = false;
      }
    },

    fmtTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const now = new Date();
      const p = (n) => (n < 10 ? '0' + n : '' + n);
      const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
      return sameDay
        ? `${p(d.getHours())}:${p(d.getMinutes())}`
        : `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }
};
</script>

<style>
.page {
  min-height: 100vh;
  padding: 24rpx 32rpx 80rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
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

/* ---- 筛选 ---- */
.tabs {
  display: flex;
  flex-direction: row;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.tab {
  padding: 14rpx 32rpx;
  border-radius: 999rpx;
  background-color: var(--tf-card);
}

.tab--on {
  background-color: var(--tf-primary);
}

.tab-text {
  font-size: 26rpx;
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
  color: var(--tf-text-3);
  text-align: center;
}

/* ---- 队列项 ---- */
.item {
  position: relative;
  padding: 26rpx;
  margin-bottom: 16rpx;
  background-color: var(--tf-card);
  border-radius: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.item-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 14rpx;
}

.item-name {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.item-mode {
  padding: 4rpx 14rpx;
  font-size: 20rpx;
  color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
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
  color: var(--tf-text-3);
}

.item-time {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.item-status {
  position: absolute;
  right: 26rpx;
  top: 26rpx;
}

.item-status-text {
  font-size: 22rpx;
}

.item-status-text--approved {
  color: var(--tf-success);
}

.item-status-text--rejected {
  color: var(--tf-danger);
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
  background-color: var(--tf-card);
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
  color: var(--tf-text-3);
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
  border-bottom: 2rpx solid var(--tf-line);
}

.k {
  font-size: 25rpx;
  color: var(--tf-text-2);
}

.v {
  font-size: 26rpx;
  color: var(--tf-text);
}

.sec-title {
  display: block;
  margin: 28rpx 0 16rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.proof {
  width: 100%;
  margin-bottom: 16rpx;
  border-radius: 16rpx;
  background-color: var(--tf-bg);
}

.proof-tip {
  display: block;
  font-size: 22rpx;
  line-height: 1.7;
  color: var(--tf-text-3);
  margin-bottom: 16rpx;
}

.textarea {
  width: 100%;
  height: 180rpx;
  padding: 20rpx;
  font-size: 26rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
  border-radius: 16rpx;
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
  background-color: var(--tf-primary);
  border-radius: 20rpx;
}

.sheet-foot .btn--reject {
  background-color: var(--tf-danger);
}

.done-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.empty {
  display: block;
  padding: 24rpx 0;
  font-size: 24rpx;
  color: var(--tf-text-3);
}
</style>
