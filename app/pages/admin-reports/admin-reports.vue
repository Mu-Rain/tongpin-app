<template>
  <view class="page">
    <!-- 非管理员先看空态：本地判定完再决定发不发请求，避免"先请求再报错"闪一下列表 -->
    <view class="deny" v-if="denied">
      <text class="deny-ico">🔒</text>
      <text class="deny-title">没有权限</text>
      <text class="deny-desc">这个页面只给管理员用。如果你是管理员但没有权限，说明你的账号还没被标记。</text>
    </view>

    <block v-else>
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

      <!-- 四态：加载中 / 出错 / 空 / 正常 -->
      <text class="hint" v-if="loading">加载中…</text>
      <text class="hint hint--err" v-else-if="errMsg" @tap="loadList">{{ errMsg }}，点这里重试</text>
      <text class="hint" v-else-if="!list.length">这里没有{{ statusText }}的举报</text>

      <view class="item" v-for="r in list" :key="r._id" @tap="openDetail(r)">
        <view class="item-head">
          <text class="item-name">{{ r.reporter_name || '匿名用户' }}</text>
          <text class="item-mode">{{ targetText(r) }}</text>
        </view>
        <text class="item-school">{{ r.reason_text || '未填原因' }}</text>
        <text class="item-detail" v-if="r.detail">{{ r.detail }}</text>
        <view class="item-foot">
          <text class="item-no">{{ r.target_type === 'user' ? '用户举报' : '内容举报' }}</text>
          <text class="item-time">{{ fmtTime(r.created_at) }}</text>
        </view>
        <view class="item-status" v-if="r.status !== 'pending'">
          <text class="item-status-text" :class="'item-status-text--' + r.status">
            {{ r.status === 'upheld' ? '已成立' : '已驳回' }}
          </text>
        </view>
      </view>

      <view class="mask" v-if="detail" @tap="closeDetail"></view>
      <view class="sheet" v-if="detail">
        <view class="sheet-head">
          <text class="sheet-title">举报详情</text>
          <text class="sheet-close" @tap="closeDetail">✕</text>
        </view>

        <scroll-view class="sheet-body" scroll-y>
          <view class="kv">
            <text class="k">举报人</text>
            <text class="v">{{ detail.reporter_name || '匿名用户' }}</text>
          </view>
          <view class="kv">
            <text class="k">被举报</text>
            <text class="v">{{ targetText(detail) }}</text>
          </view>
          <view class="kv">
            <text class="k">原因</text>
            <text class="v">{{ detail.reason_text || '未填原因' }}</text>
          </view>
          <view class="kv">
            <text class="k">时间</text>
            <text class="v">{{ fmtFull(detail.created_at) }}</text>
          </view>
          <view class="kv" v-if="detail.status !== 'pending'">
            <text class="k">状态</text>
            <text class="v">{{ detail.status === 'upheld' ? '已成立' : '已驳回' }}</text>
          </view>

          <text class="sec-title">补充说明</text>
          <text class="para">{{ detail.detail || '（举报人没有写补充说明）' }}</text>
          <!-- 被鸽的判据：约局记录里谁到了、离约定点多远。没约局记录就不显示 -->
          <block v-if="detail.meetup">
            <text class="sec-title">约局签到</text>
            <text class="para">{{ meetupText(detail.meetup) }}</text>
          </block>
          <!-- 处置成 upheld 会真扣分，先把「扣谁、扣多少」写在按钮上方，别让人点到才知道 -->
          <view class="deduct" v-if="detail.status === 'pending'">
            <text class="deduct-title">扣几分</text>
            <text class="deduct-tip">{{ aiText(detail) }}</text>
            <text class="deduct-label">违规扣分（1~5）</text>
            <view class="deduct-row">
              <view
                v-for="n in DEDUCT_LIST"
                :key="n"
                class="deduct-chip"
                :class="{ 'deduct-chip--on': deduct === n }"
                @tap="pickDeduct(n)"
              >
                <text class="deduct-chip-txt">{{ n === 0 ? '默认' : n }}</text>
              </view>
            </view>
            <text class="deduct-label">情节轻重（不当行为用这档）</text>
            <view class="deduct-row">
              <view
                v-for="t in SEVERITY_LIST"
                :key="'sev' + t.n"
                class="deduct-chip"
                :class="{ 'deduct-chip--on': deduct === t.n }"
                @tap="pickDeduct(t.n)"
              >
                <text class="deduct-chip-txt">{{ t.label }}</text>
              </view>
            </view>
            <text class="deduct-note">默认档按筛查结论走（没有结论就按规则默认值）。</text>
          </view>
        </scroll-view>

        <view class="sheet-foot" v-if="detail.status === 'pending'">
          <button class="btn btn--reject" :disabled="acting" @tap="decide('dismissed')">驳回</button>
          <button class="btn" :disabled="acting" @tap="decide('upheld')">{{ upheldLabel }}</button>
        </view>
        <view class="sheet-foot" v-else>
          <text class="done-text">这条已处理：{{ detail.status === 'upheld' ? '已成立' : '已驳回' }}</text>
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
      errMsg: '',
      detail: null,
      acting: false,
      // 0 = 按筛查结论/规则默认，其余是管理员手动指定的扣分
      deduct: 0,
      DEDUCT_LIST: [0, 1, 2, 3, 4, 5],
      // 情节档：同一件事「推了一把」和「打人」不是一个量级，
      // 给三档固定值，比让管理员自己拍一个数字更容易一致
      SEVERITY_LIST: [
        { n: 5, label: '轻微 5' },
        { n: 10, label: '一般 10' },
        { n: 20, label: '严重 20' }
      ],
      tabs: [
        { key: 'pending', label: '待处理' },
        { key: 'upheld', label: '已成立' },
        { key: 'dismissed', label: '已驳回' }
      ]
    };
  },

  computed: {
    statusText() {
      const map = { pending: '待处理', upheld: '已成立', dismissed: '已驳回' };
      return map[this.status] || '待处理';
    },
    upheldLabel() {
      return this.deduct > 0 ? '成立（扣 ' + this.deduct + ' 分）' : '成立（按情节扣分）';
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
        name: 'admin-reports',
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
        const d = await this.call({ action: 'list', status: this.status, page: 1, page_size: 20 });
        this.list = d.list || [];
      } catch (e) {
        // 403 已经在 call 里转成 deny 空态，这里只接业务/网络错误
        if (!this.denied) this.errMsg = e.message || '加载失败';
      } finally {
        this.loading = false;
      }
    },

    switchTab(k) {
      if (this.status === k) return;
      this.status = k;
      this.list = [];
      this.detail = null;
      this.errMsg = '';
      this.loadList();
    },

    openDetail(r) {
      this.detail = r;
      // 每开一条都从「默认档」开始，避免上一条选的分数被带到这一条
      this.deduct = 0;
    },

    pickDeduct(n) {
      this.deduct = n;
    },

    /* 约局签到 → 一句人话：谁到了、离约定点多远 */
    meetupText(mt) {
      if (!mt) return '';
      const head = mt.time
        ? '约的 ' + mt.time + ' · ' + (mt.place || '地点未填')
        : mt.place || '约局记录';
      const a = mt.inviter_checkin && mt.inviter_checkin.arrived ? '发起方已签到' : '发起方没签到';
      const b = mt.invitee_checkin && mt.invitee_checkin.arrived ? '被约方已签到' : '被约方没签到';
      let dist = '';
      if (
        mt.invitee_checkin &&
        typeof mt.invitee_checkin.dist === 'number' &&
        mt.invitee_checkin.dist >= 0
      ) {
        dist = '（距约定点 ' + mt.invitee_checkin.dist + ' 米）';
      }
      return head + '　' + a + '、' + b + dist;
    },

    aiText(r) {
      // 云函数 report-screen 写回的是 report.ai 对象，没有 ai 就是还没跑过
      const ai = r && r.ai;
      if (!ai) return '还没做内容筛查，可以自己定分数。';
      if (!ai.hit) return '筛查没发现明显违规，建议驳回或选低档。';
      const cat = ai.category ? '「' + ai.category + '」' : '';
      return '筛查命中' + cat + '，建议扣 ' + (ai.severity || 1) + ' 分。';
    },

    closeDetail() {
      this.detail = null;
    },

    targetText(r) {
      if (!r) return '';
      if (r.target_type === 'user') return r.target_name || '用户';
      if (r.target_type === 'card') return '卡片：' + (r.target_name || '未知');
      if (r.target_type === 'message') return '消息：' + (r.target_name || '未知');
      return r.target_name || (r.target_type === 'user' ? '用户' : '内容');
    },

    async decide(decision) {
      if (this.acting || !this.detail) return;
      const r = this.detail;
      const isUser = r.target_type === 'user';
      const scoreText = this.deduct > 0 ? '扣 ' + this.deduct + ' 分' : '按情节扣分';
      const content =
        decision === 'upheld'
          ? '确认这条举报成立？将' + scoreText + '，处置后不可撤销。'
          : '确认驳回这条举报？驳回后不做任何扣分。';
      const ok = await new Promise((resolve) => {
        uni.showModal({
          title: decision === 'upheld' ? '确认成立' : '确认驳回',
          content,
          success: (res) => resolve(res.confirm)
        });
      });
      if (!ok) return;

      this.acting = true;
      try {
        const payload = { action: 'decide', report_id: r._id, decision };
        if (decision === 'upheld' && this.deduct > 0) payload.deduct = this.deduct;
        const d = await this.call(payload);
        // 原地更新：把这条的状态改掉，待处理 tab 里直接移除，不整页重拉
        const target = this.list.find((x) => x._id === r._id);
        if (this.status === 'pending') {
          this.list = this.list.filter((x) => x._id !== r._id);
        } else if (target) {
          target.status = d.status || decision;
        }
        this.detail = null;
        const delta = d.credit_delta;
        uni.showToast({
          title:
            decision === 'upheld'
              ? delta
                ? '已成立，扣 ' + Math.abs(delta) + ' 分'
                : '已成立'
              : '已驳回',
          icon: 'none'
        });
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
        ? p(d.getHours()) + ':' + p(d.getMinutes())
        : d.getMonth() + 1 + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    },

    fmtFull(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const p = (n) => (n < 10 ? '0' + n : '' + n);
      return (
        d.getFullYear() +
        '-' +
        p(d.getMonth() + 1) +
        '-' +
        p(d.getDate()) +
        ' ' +
        p(d.getHours()) +
        ':' +
        p(d.getMinutes())
      );
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
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
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
  color: var(--tf-text-2);
  text-align: center;
}

/* 出错是可重试的，给它主色，和"真的没有数据"区分开 */
.hint--err {
  color: var(--tf-primary);
}

/* ---- 队列项 ---- */
.item {
  position: relative;
  padding: 26rpx;
  margin-bottom: 16rpx;
  background: var(--tf-card);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
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

.item-detail {
  font-size: 24rpx;
  line-height: 1.6;
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

.item-status {
  position: absolute;
  right: 26rpx;
  top: 26rpx;
}

.item-status-text {
  font-size: 22rpx;
}

.item-status-text--upheld {
  color: var(--tf-danger);
}

.item-status-text--dismissed {
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

.sec-title {
  display: block;
  margin: 28rpx 0 16rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.para {
  display: block;
  font-size: 26rpx;
  line-height: 1.8;
  color: var(--tf-text-2);
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

/* ===== 扣分档位 ===== */
.deduct {
  margin-top: 4rpx;
  padding-top: 20rpx;
  border-top: 1rpx solid var(--tf-line-soft);
}

.deduct-title {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  color: var(--tf-text);
}

.deduct-tip {
  display: block;
  margin-top: 8rpx;
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

.deduct-label {
  display: block;
  margin-top: 18rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: var(--tf-text-2);
}

.deduct-row {
  display: flex;
  flex-wrap: wrap;
  margin-top: 12rpx;
}

.deduct-chip {
  margin: 0 12rpx 12rpx 0;
  padding: 10rpx 22rpx;
  border-radius: 999rpx;
  background: var(--tf-card);
  border: 1rpx solid var(--tf-line);
}

.deduct-chip--on {
  background: var(--tf-primary-soft);
  border-color: var(--tf-primary);
}

.deduct-chip-txt {
  font-size: 25rpx;
  font-weight: 600;
  color: var(--tf-text-2);
}

.deduct-chip--on .deduct-chip-txt {
  color: var(--tf-primary-deep);
}

.deduct-note {
  display: block;
  font-size: 23rpx;
  line-height: 1.6;
  color: var(--tf-text-3);
}
</style>
