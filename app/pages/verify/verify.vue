<template>
  <view class="page">
    <!-- ① 状态块（对齐原型 index.html:431-435 的 block-black） -->
    <view class="status" :class="'status--' + status">
      <text class="status-kicker">STATUS · {{ statusKicker }}</text>
      <text class="status-title">{{ statusTitle }}</text>
      <text class="status-desc">{{ statusDesc }}</text>
    </view>

    <!-- 审核中：只显示等待，不给表单 -->
    <view class="card" v-if="status === 'pending'">
      <text class="card-title">审核中</text>
      <text class="card-hint"
        >已提交于 {{ fmtTime(last && last.created_at) }}，1–2 个工作日出结果。
        结果会通过消息通知你，不用一直在这等。</text
      >
      <button class="btn btn--ghost" @tap="loadStatus">刷新状态</button>
    </view>

    <!-- 已通过：显示徽章信息 -->
    <view class="card" v-if="status === 'approved'">
      <text class="card-title">你已解锁</text>
      <view class="unlock" v-for="(u, i) in unlocks" :key="i">
        <text class="unlock-ico">{{ u.icon }}</text>
        <text class="unlock-text">{{ u.text }}</text>
      </view>
    </view>

    <!-- ② 表单（未提交 / 被拒 时才出现） -->
    <block v-if="canSubmit">
      <!-- 被拒：先把理由摆在最上面，用户才知道改什么 -->
      <view class="reject" v-if="status === 'rejected'">
        <text class="reject-title">上次没通过</text>
        <text class="reject-reason">{{ last.reject_reason || '未填写理由' }}</text>
        <text class="reject-tip">剩余提交次数：{{ remainAttempts }} 次</text>
      </view>

      <!-- 认证方式（两种，用户指定的可切换模式） -->
      <view class="card">
        <text class="card-title">选择认证方式</text>
        <view class="modes">
          <view
            class="mode"
            :class="{ 'mode--on': mode === 'card' }"
            @tap="pickMode('card')"
          >
            <text class="mode-name">① 学生证 / 校园卡</text>
            <text class="mode-desc">填学校 + 学号，上传证件照片，人工核对在读状态</text>
          </view>
          <view
            class="mode"
            :class="{ 'mode--on': mode === 'chsi' }"
            @tap="pickMode('chsi')"
          >
            <text class="mode-name">② 学信网在线验证报告</text>
            <text class="mode-desc">上传《教育部学籍在线验证报告》截图，防伪最强</text>
          </view>
        </view>
      </view>

      <!-- 基本信息 -->
      <view class="card">
        <text class="card-title">基本信息</text>

        <!-- 学校：必须从列表选，不能手打（手打会让同校频道筛不出同一批人） -->
        <view class="field">
          <text class="label">学校</text>
          <view class="picker" @tap="openSchool">
            <text class="picker-text" :class="{ 'picker-text--empty': !schoolName }">
              {{ schoolName || '点这里选择学校' }}
            </text>
            <text class="picker-arrow">›</text>
          </view>
        </view>

        <view class="field">
          <text class="label">真实姓名</text>
          <input
            class="input"
            v-model="realName"
            placeholder="与学生证上一致"
            maxlength="20"
          />
        </view>

        <view class="field">
          <text class="label">学号</text>
          <input
            class="input"
            v-model="studentNo"
            placeholder="学生证上的学号"
            maxlength="30"
          />
        </view>

        <view class="field">
          <text class="label">年级<text class="label-opt">（选填）</text></text>
          <input class="input" v-model="grade" placeholder="如 2023 级" maxlength="10" />
        </view>
      </view>

      <!-- ③ 材料上传（对齐原型 index.html:437-442 的 upload-box） -->
      <view class="card">
        <text class="card-title">{{ mode === 'card' ? '学生证 / 校园卡照片' : '学信网报告截图' }}</text>
        <text class="card-hint" v-if="mode === 'card'"
          >拍学生证里带姓名、学号、学校的那一页，要能看出在读（注册章 / 有效期）。
          不要求拍身份证。</text
        >
        <text class="card-hint" v-else
          >打开学信网 → 学信档案 → 在线验证报告 → 申请《教育部学籍在线验证报告》→ 截图上传。</text
        >

        <view class="upload" @tap="pickImage">
          <image
            v-if="previewUrl"
            class="upload-img"
            :src="previewUrl"
            mode="aspectFill"
            @tap.stop="preview"
          />
          <view v-else class="upload-empty">
            <text class="upload-ico">🎓</text>
            <text class="upload-text">{{ uploading ? '上传中…' : '点这里上传' }}</text>
          </view>
        </view>
        <text class="upload-note">只用于人工审核 · 存私有空间 · 公共页面看不到</text>
      </view>

      <!-- ④ 认证流程三步（对齐原型 index.html:444-458） -->
      <text class="h2">认证流程</text>
      <view class="steps">
        <view class="step" v-for="(s, i) in steps" :key="i">
          <text class="step-no">{{ i + 1 }}</text>
          <view class="step-main">
            <text class="step-title">{{ s.title }}</text>
            <text class="step-desc">{{ s.desc }}</text>
          </view>
        </view>
      </view>

      <button class="btn" :class="{ 'btn--off': !canPush }" :disabled="!canPush" @tap="submit">
        {{ submitting ? '提交中…' : '提交认证' }}
      </button>
    </block>

    <!-- ⑤ 合规提醒（对齐原型 index.html:460-463 的 block-yellow） -->
    <view class="notice">
      <text class="notice-kicker">为什么需要认证</text>
      <text class="notice-text"
        >这个 App 只给在校学生用，目的是把非学生群体挡在外面，避免变成随意交友的地方。
        所以认证材料必须能证明「你确实在读」。</text
      >
      <text class="notice-text"
        >你的证件照片只用于这一次人工审核，公共页面、其他用户都看不到。</text
      >
    </view>

    <!-- 学校选择弹层 -->
    <view class="mask" v-if="schoolOpen" @tap="schoolOpen = false"></view>
    <view class="sheet" v-if="schoolOpen">
      <view class="sheet-head">
        <text class="sheet-title">选择学校</text>
        <text class="sheet-close" @tap="schoolOpen = false">✕</text>
      </view>
      <input
        class="input input--search"
        v-model="keyword"
        placeholder="搜校名或简称，如「北大」"
        @input="onSearch"
      />
      <scroll-view class="sheet-list" scroll-y>
        <view class="school-item" v-for="s in schools" :key="s.school_id" @tap="chooseSchool(s)">
          <view class="school-main">
            <text class="school-name">{{ s.name }}</text>
            <text class="school-sub">{{ s.province }}{{ s.city_code ? ' · ' + s.city_code : '' }}</text>
          </view>
          <text class="school-check" v-if="schoolId === s.school_id">✓</text>
        </view>
        <text class="empty" v-if="!schools.length && !searching">没有匹配的学校</text>
        <text class="empty" v-if="searching">搜索中…</text>
      </scroll-view>
      <text class="sheet-foot">找不到你的学校？说明这所学校还没收录，请联系管理员补充。</text>
    </view>
  </view>
</template>

<script>
const MODE_ENUM = ['card', 'chsi'];

export default {
  data() {
    return {
      loading: true,
      status: 'none', // none / pending / approved / rejected
      verified: false,
      attempts: 0,
      maxAttempts: 3,
      canSubmit: false,
      last: null,

      // 表单
      mode: 'card',
      schoolId: '',
      schoolName: '',
      realName: '',
      studentNo: '',
      grade: '',
      photoFileId: '',
      chsiFileId: '',
      previewUrl: '',
      uploading: false,
      submitting: false,

      // 学校选择器
      schoolOpen: false,
      keyword: '',
      schools: [],
      searching: false,
      _searchTimer: null,

      steps: [
        { title: '上传材料', desc: '学生证带学号那页，或学信网报告截图' },
        { title: '人工审核', desc: '1–2 个工作日，最多提交 3 次' },
        { title: '审核通过', desc: '解锁同校频道 · 卡片带认证标识 · 信誉 +5' }
      ]
    };
  },

  computed: {
    statusKicker() {
      return (
        {
          none: 'NOT VERIFIED',
          pending: 'UNDER REVIEW',
          approved: 'VERIFIED',
          rejected: 'REJECTED'
        }[this.status] || 'NOT VERIFIED'
      );
    },
    statusTitle() {
      return (
        {
          none: '还没认证',
          pending: '审核中',
          approved: '已通过认证',
          rejected: '上次没通过'
        }[this.status] || '还没认证'
      );
    },
    statusDesc() {
      return (
        {
          none: '认证后可进同校频道 · 卡片带认证标识 · 信誉 +5',
          pending: '1–2 个工作日出结果，请耐心等待',
          approved: '已解锁同校频道，卡片会带认证标识',
          rejected: '根据下方理由修改后可以重新提交'
        }[this.status] || ''
      );
    },
    remainsAttempts() {
      return Math.max(0, this.maxAttempts - this.attempts);
    },
    remainAttempts() {
      return Math.max(0, this.maxAttempts - this.attempts);
    },
    canPush() {
      if (this.submitting || this.uploading) return false;
      if (!this.schoolId || !this.realName.trim() || !this.studentNo.trim()) return false;
      if (this.mode === 'card' && !this.photoFileId) return false;
      if (this.mode === 'chsi' && !this.chsiFileId) return false;
      return true;
    },
    unlocks() {
      return [
        { icon: '🏫', text: '进入同校频道，只看到本校的搭子' },
        { icon: '✔', text: '你的卡片和昵称旁出现认证标识' },
        { icon: '⭐', text: '信誉分 +5' }
      ];
    }
  },

  onLoad() {
    this.loadStatus();
  },

  methods: {
    async call(name, data) {
      const token = uni.getStorageSync('token') || '';
      if (!token) {
        uni.reLaunch({ url: '/pages/login/login' });
        throw new Error('未登录');
      }
      const res = await uniCloud.callFunction({ name, data: Object.assign({ token }, data) });
      const r = res.result || {};
      // uniCloud.callFunction 只在网络层失败才 reject，
      // 业务失败（{code:401} 这种）是正常返回，必须自己判。
      if (r.code !== 0) throw new Error(r.msg || '请求失败');
      return r.data || {};
    },

    async loadStatus() {
      this.loading = true;
      try {
        const d = await this.call('verify-submit', { action: 'status' });
        this.status = d.status || 'none';
        this.verified = !!d.verified;
        this.attempts = d.attempts || 0;
        this.maxAttempts = d.max_attempts || 3;
        this.canSubmit = !!d.can_submit;
        this.last = d.last || null;
        this.schoolId = d.school_id || '';
        this.schoolName = d.school || '';
      } catch (e) {
        uni.showToast({ title: e.message || '加载失败', icon: 'none' });
      } finally {
        this.loading = false;
      }
    },

    pickMode(m) {
      if (MODE_ENUM.indexOf(m) < 0) return;
      this.mode = m;
      // 切换模式时把另一种的材料预览清掉，避免用户以为已经传过了
      this.previewUrl = '';
    },

    pickImage() {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const path = res.tempFilePaths[0];
          this.previewUrl = path; // 先本地预览，上传成功再换
          this.uploadFile(path);
        }
      });
    },

    async uploadFile(path) {
      this.uploading = true;
      try {
        const token = uni.getStorageSync('token') || '';
        const userId = uni.getStorageSync('userId') || 'anon';
        // 支付宝云 cloudPath 是绝对路径，同名会覆盖 —— 所以必须带随机串，
        // 否则两个人同时上传会互相冲掉。
        const rand = Math.random().toString(36).slice(2, 10);
        const ext = (path.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0];
        const cloudPath = `verify/${userId}/${Date.now()}_${rand}${ext}`;

        const up = await uniCloud.uploadFile({
          filePath: path,
          cloudPath: cloudPath
          // fileType 在 App 端可不传，小程序端必填；传上无害
        });

        if (!up.fileID) throw new Error('上传失败，请重试');
        if (this.mode === 'card') this.photoFileId = up.fileID;
        else this.chsiFileId = up.fileID;
        uni.showToast({ title: '已上传', icon: 'success' });
      } catch (e) {
        this.previewUrl = '';
        uni.showToast({ title: e.message || '上传失败', icon: 'none' });
      } finally {
        this.uploading = false;
      }
    },

    preview() {
      if (!this.previewUrl) return;
      uni.previewImage({ urls: [this.previewUrl], current: this.previewUrl });
    },

    openSchool() {
      this.schoolOpen = true;
      if (!this.schools.length) this.searchSchools('');
    },

    onSearch() {
      // 防抖：每敲一个字就发请求会打爆云函数调用额度
      if (this._searchTimer) clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(() => this.searchSchools(this.keyword), 300);
    },

    async searchSchools(kw) {
      this.searching = true;
      try {
        const token = uni.getStorageSync('token') || '';
        const res = await uniCloud.callFunction({
          name: 'school-list',
          data: { token, keyword: kw || '', page_size: 50 }
        });
        const r = res.result || {};
        if (r.code !== 0) throw new Error(r.msg || '搜索失败');
        this.schools = (r.data && r.data.list) || [];
      } catch (e) {
        uni.showToast({ title: e.message || '搜索失败', icon: 'none' });
      } finally {
        this.searching = false;
      }
    },

    chooseSchool(s) {
      this.schoolId = s.school_id;
      this.schoolName = s.name;
      this.schoolOpen = false;
    },

    async submit() {
      if (!this.canPush) return;
      this.submitting = true;
      try {
        await this.call('verify-submit', {
          action: 'submit',
          mode: this.mode,
          school_id: this.schoolId,
          real_name: this.realName.trim(),
          student_no: this.studentNo.trim(),
          grade: this.grade.trim(),
          photo_file_id: this.photoFileId,
          chsi_file_id: this.chsiFileId
        });
        uni.showToast({ title: '已提交，等待审核', icon: 'success' });
        this.loadStatus();
      } catch (e) {
        uni.showModal({ title: '提交失败', content: e.message || '请重试', showCancel: false });
      } finally {
        this.submitting = false;
      }
    },

    fmtTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const p = (n) => (n < 10 ? '0' + n : '' + n);
      return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }
};
</script>

<style>
.page {
  min-height: 100vh;
  padding: 32rpx 32rpx 80rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
}

/* ---- 状态块 ---- */
.status {
  padding: 32rpx;
  margin-bottom: 24rpx;
  border-radius: 28rpx;
  background-color: #1f2329;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.status--approved {
  background-color: #12b76a;
}

.status--pending {
  background-color: #f04438;
}

.status--rejected {
  background-color: #f79009;
}

.status-kicker {
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: rgba(255, 255, 255, 0.7);
}

.status-title {
  font-size: 40rpx;
  font-weight: 700;
  color: #ffffff;
}

.status-desc {
  font-size: 24rpx;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.85);
}

/* ---- 通用卡片 ---- */
.card {
  padding: 28rpx;
  margin-bottom: 24rpx;
  background-color: var(--tf-card);
  border-radius: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.card-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.card-hint {
  font-size: 24rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
}

/* ---- 解锁项 ---- */
.unlock {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  padding: 12rpx 0;
}

.unlock-ico {
  font-size: 32rpx;
}

.unlock-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

/* ---- 被拒提示 ---- */
.reject {
  padding: 28rpx;
  margin-bottom: 24rpx;
  background-color: #fff7ed;
  border: 2rpx solid #f79009;
  border-radius: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.reject-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #b54708;
}

.reject-reason {
  font-size: 26rpx;
  line-height: 1.6;
  color: var(--tf-text);
}

.reject-tip {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

/* ---- 认证方式 ---- */
.modes {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.mode {
  padding: 24rpx;
  border: 2rpx solid var(--tf-line);
  border-radius: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.mode--on {
  border-color: var(--tf-primary);
  background-color: var(--tf-primary-soft);
}

.mode-name {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.mode-desc {
  font-size: 23rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* ---- 表单 ---- */
.field {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.label {
  font-size: 25rpx;
  color: var(--tf-text-2);
}

.label-opt {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.input {
  height: 88rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: var(--tf-text);
  background-color: var(--tf-bg);
  border-radius: 16rpx;
  box-sizing: border-box;
}

.input--search {
  margin-bottom: 16rpx;
}

.picker {
  height: 88rpx;
  padding: 0 24rpx;
  background-color: var(--tf-bg);
  border-radius: 16rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.picker-text {
  font-size: 28rpx;
  color: var(--tf-text);
}

.picker-text--empty {
  color: var(--tf-text-3);
}

.picker-arrow {
  font-size: 34rpx;
  color: var(--tf-text-3);
}

/* ---- 上传框 ---- */
.upload {
  height: 320rpx;
  border-radius: 20rpx;
  background-color: var(--tf-bg);
  border: 2rpx dashed var(--tf-line);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.upload-img {
  width: 100%;
  height: 320rpx;
}

.upload-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.upload-ico {
  font-size: 64rpx;
}

.upload-text {
  font-size: 26rpx;
  color: var(--tf-text-2);
}

.upload-note {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

/* ---- 流程 ---- */
.h2 {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
  margin-bottom: 16rpx;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-bottom: 32rpx;
}

.step {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
  padding: 24rpx;
  background-color: var(--tf-card);
  border-radius: 20rpx;
}

.step-no {
  width: 44rpx;
  height: 44rpx;
  flex-shrink: 0;
  border-radius: 22rpx;
  background-color: var(--tf-primary);
  color: #ffffff;
  font-size: 24rpx;
  text-align: center;
  line-height: 44rpx;
}

.step-main {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  flex: 1;
}

.step-title {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--tf-text);
}

.step-desc {
  font-size: 23rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}

/* ---- 合规提醒 ---- */
.notice {
  padding: 28rpx;
  margin-top: 8rpx;
  background-color: #ffde00;
  border-radius: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.notice-kicker {
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: rgba(0, 0, 0, 0.6);
}

.notice-text {
  font-size: 25rpx;
  line-height: 1.7;
  color: #1f2329;
}

/* ---- 按钮 ---- */
.btn {
  height: 96rpx;
  margin-top: 16rpx;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 96rpx;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 20rpx;
}

.btn--off {
  opacity: 0.4;
}

.btn--ghost {
  color: var(--tf-text);
  background-color: var(--tf-bg);
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
  max-height: 78vh;
  padding: 32rpx 32rpx 48rpx;
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
  margin-bottom: 20rpx;
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

.sheet-list {
  flex: 1;
  max-height: 52vh;
}

.school-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 8rpx;
  border-bottom: 2rpx solid var(--tf-line);
}

.school-main {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.school-name {
  font-size: 28rpx;
  color: var(--tf-text);
}

.school-sub {
  font-size: 22rpx;
  color: var(--tf-text-3);
}

.school-check {
  font-size: 30rpx;
  color: var(--tf-primary);
}

.sheet-foot {
  margin-top: 20rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--tf-text-3);
}

.empty {
  display: block;
  padding: 32rpx 0;
  font-size: 25rpx;
  color: var(--tf-text-3);
  text-align: center;
}
</style>
