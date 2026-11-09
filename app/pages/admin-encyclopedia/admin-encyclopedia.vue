<!-- 百科与称号都是「内容维护」，条目都很少；合在一个页面用 tab 切，管理员区块才不用排 5 行 -->
<template>
  <view class="page">
    <!-- 非管理员先看空态：本地判定完再决定发不发请求 -->
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
          :class="{ 'tab--on': tab === t.key }"
          @tap="switchTab(t.key)"
        >
          <text class="tab-text" :class="{ 'tab-text--on': tab === t.key }">{{ t.label }}</text>
        </view>
      </view>

      <!-- ---------- 百科 ---------- -->
      <block v-if="tab === 'enc'">
        <text class="hint" v-if="encLoading">加载中…</text>
        <text class="hint hint--err" v-else-if="encErr" @tap="loadEnc">{{ encErr }}，点这里重试</text>
        <text class="hint" v-else-if="!encList.length">还没有百科条目，点下面新增一条</text>

        <view class="item" v-for="e in encList" :key="e._id" @tap="openEnc(e)">
          <view class="item-head">
            <text class="item-name">{{ e.title }}</text>
            <text class="item-mode" v-if="!e.active">已停用</text>
          </view>
          <text class="item-school">{{ catText(e.category) }} · {{ e.publish_date || '未指定日期' }}</text>
          <text class="item-detail">{{ brief(e.content) }}</text>
        </view>

        <button class="btn" v-if="!encLoading && !encErr" @tap="newEnc">＋ 新增百科</button>

        <!-- 72 字是首页「展开」按钮的阈值，正文短了首页就没这个按钮，这里先说清楚 -->
        <text class="proof-tip"
          >正文没有字数下限；但只有超过 72 字，首页列表才会出现「展开」按钮，短正文会被整段显示。</text
        >
      </block>

      <!-- ---------- 称号 ---------- -->
      <block v-else>
        <text class="hint" v-if="titleLoading">加载中…</text>
        <text class="hint hint--err" v-else-if="titleErr" @tap="loadTitles">{{ titleErr }}，点这里重试</text>
        <text class="hint" v-else-if="!titleList.length">没有称号条目</text>

        <view class="item" v-for="t in titleList" :key="t.code" @tap="openTitle(t)">
          <view class="item-head">
            <text class="item-name">{{ t.name || t.code }}</text>
            <text class="item-mode" v-if="!t.active">已停用</text>
            <text class="item-tag" v-if="t.source === 'builtin'">内置</text>
            <text class="item-tag" v-else>自定义</text>
          </view>
          <text class="item-school">{{ t.code }} · {{ rarityText(t.rarity) }} · 排序 {{ t.sort }}</text>
          <text class="item-detail">{{ t.condition_text || '未写条件文案' }}</text>
        </view>

        <text class="proof-tip"
          >内置 3 条不能删，只能停用。保存是 upsert：改内置称号的文案会把它写进表里，之后以表里的为准。</text
        >
      </block>

      <!-- ---------- 百科编辑弹层 ---------- -->
      <view class="mask" v-if="encForm" @tap="closeEnc"></view>
      <view class="sheet" v-if="encForm">
        <view class="sheet-head">
          <text class="sheet-title">{{ encForm._id ? '编辑百科' : '新增百科' }}</text>
          <text class="sheet-close" @tap="closeEnc">✕</text>
        </view>

        <scroll-view class="sheet-body" scroll-y>
          <text class="sec-title">标题</text>
          <input class="input" v-model="encForm.title" placeholder="例如：期末周怎么安排复习" maxlength="60" />

          <text class="sec-title">正文</text>
          <textarea
            class="textarea"
            v-model="encForm.content"
            placeholder="正文，超过 72 字首页才会出现「展开」按钮"
          />
          <text class="proof-tip">当前 {{ encForm.content.length }} 字。</text>

          <text class="sec-title">分类</text>
          <picker mode="selector" :range="categoryLabels" @change="onCategory">
            <view class="picker-box">
              <text class="picker-text">{{ catText(encForm.category) }}</text>
              <text class="picker-arrow">›</text>
            </view>
          </picker>

          <text class="sec-title">日期（可留空）</text>
          <view class="date-row">
            <picker mode="date" :value="encForm.publish_date" @change="onDate">
              <view class="picker-box">
                <text class="picker-text">{{ encForm.publish_date || '不指定日期' }}</text>
                <text class="picker-arrow">›</text>
              </view>
            </picker>
            <text class="date-clear" v-if="encForm.publish_date" @tap="clearDate">清空</text>
          </view>
          <text class="proof-tip">留空表示走回落，不占某一天的位置；非空时这一天不能被别的条目占用。</text>

          <view class="kv">
            <text class="k">启用</text>
            <switch :checked="encForm.active" @change="onEncActive" />
          </view>
        </scroll-view>

        <view class="sheet-foot">
          <button class="btn btn--reject" v-if="encForm._id && encForm.active" :disabled="acting" @tap="stopEnc">
            停用
          </button>
          <button class="btn" :disabled="acting" @tap="saveEnc">保存</button>
        </view>
      </view>

      <!-- ---------- 称号编辑弹层 ---------- -->
      <view class="mask" v-if="titleForm" @tap="closeTitle"></view>
      <view class="sheet" v-if="titleForm">
        <view class="sheet-head">
          <text class="sheet-title">编辑称号</text>
          <text class="sheet-close" @tap="closeTitle">✕</text>
        </view>

        <scroll-view class="sheet-body" scroll-y>
          <view class="kv">
            <text class="k">code</text>
            <text class="v">{{ titleForm.code }}</text>
          </view>
          <text class="proof-tip">code 只读：它已经写进用户的称号记录里，改了等于让已获得的称号失效。</text>

          <text class="sec-title">名字</text>
          <input class="input" v-model="titleForm.name" placeholder="称号名字" maxlength="20" />

          <text class="sec-title">描述</text>
          <input class="input" v-model="titleForm.desc" placeholder="可留空" maxlength="60" />

          <text class="sec-title">稀有度</text>
          <picker mode="selector" :range="rarityLabels" @change="onRarity">
            <view class="picker-box">
              <text class="picker-text">{{ rarityText(titleForm.rarity) }}</text>
              <text class="picker-arrow">›</text>
            </view>
          </picker>

          <text class="sec-title">条件文案</text>
          <textarea
            class="textarea textarea--short"
            v-model="titleForm.condition_text"
            placeholder="例如：填了昵称、头像、学校，并选了至少 1 个标签"
          />
          <text class="proof-tip">这句话就是称号墙上「未获得」时显示的内容，改完立刻对所有人生效。</text>

          <text class="sec-title">排序</text>
          <input class="input" v-model="titleForm.sort" type="number" placeholder="数字，越小越靠前" />

          <view class="kv">
            <text class="k">启用</text>
            <switch :checked="titleForm.active" @change="onTitleActive" />
          </view>
        </scroll-view>

        <view class="sheet-foot">
          <button class="btn" :disabled="acting" @tap="saveTitle">保存</button>
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
      tab: 'enc',
      tabs: [
        { key: 'enc', label: '百科' },
        { key: 'title', label: '称号' }
      ],
      // 两个 tab 各自一套四态：切 tab 不用重拉另一个，慢网下也不会互相拖
      encList: [],
      encLoading: false,
      encErr: '',
      titleList: [],
      titleLoading: false,
      titleErr: '',
      encForm: null,
      titleForm: null,
      acting: false,
      categoryCodes: ['study', 'health', 'life', 'campus'],
      categoryLabels: ['学习', '健康', '生活', '校园'],
      rarityCodes: ['common', 'rare', 'epic'],
      rarityLabels: ['普通 (common)', '稀有 (rare)', '史诗 (epic)']
    };
  },

  onShow() {
    // 本地先判管理员：不是就直接挡住，一个请求都不发
    if (!this.isLocalAdmin()) {
      this.denied = true;
      return;
    }
    this.denied = false;
    if (this.tab === 'enc') this.loadEnc();
    else this.loadTitles();
  },

  onPullDownRefresh() {
    if (this.denied) {
      uni.stopPullDownRefresh();
      return;
    }
    const p = this.tab === 'enc' ? this.loadEnc() : this.loadTitles();
    p.finally(() => uni.stopPullDownRefresh());
  },

  methods: {
    // 管理员两种写法都认，与全项目口径一致
    isLocalAdmin() {
      const info = uni.getStorageSync('userInfo') || {};
      return info.role === 'admin' || info.is_admin === true;
    },

    // 两个云函数的调用写法一致，只差名字；403 一律转到 deny 空态
    async call(name, data) {
      const token = uni.getStorageSync('token') || '';
      const res = await uniCloud.callFunction({
        name,
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

    switchTab(k) {
      if (this.tab === k) return;
      this.tab = k;
      // 只在没数据时补拉，切回来不重复请求
      if (k === 'enc' && !this.encList.length) this.loadEnc();
      if (k === 'title' && !this.titleList.length) this.loadTitles();
    },

    async loadEnc() {
      this.encLoading = true;
      this.encErr = '';
      try {
        const d = await this.call('admin-encyclopedia', { action: 'list' });
        this.encList = d.list || [];
      } catch (e) {
        // 403 已经在 call 里转成 deny 空态，这里只接业务/网络错误
        if (!this.denied) this.encErr = e.message || '加载失败';
      } finally {
        this.encLoading = false;
      }
    },

    async loadTitles() {
      this.titleLoading = true;
      this.titleErr = '';
      try {
        const d = await this.call('admin-titles', { action: 'list' });
        this.titleList = d.list || [];
      } catch (e) {
        if (!this.denied) this.titleErr = e.message || '加载失败';
      } finally {
        this.titleLoading = false;
      }
    },

    // 列表里只露一句摘要，正文全貌留给编辑弹层
    brief(s) {
      const t = String(s || '').replace(/\s+/g, ' ').trim();
      if (!t) return '（还没有正文）';
      return t.length > 40 ? t.slice(0, 40) + '…' : t;
    },

    catText(code) {
      const map = { study: '学习', health: '健康', life: '生活', campus: '校园' };
      return map[code] || code || '未分类';
    },

    rarityText(code) {
      const map = { common: '普通', rare: '稀有', epic: '史诗' };
      return map[code] || code || '普通';
    },

    /* ---------------- 百科 ---------------- */

    newEnc() {
      this.encForm = {
        _id: '',
        title: '',
        content: '',
        category: 'study',
        publish_date: '',
        active: true,
        wasActive: true
      };
    },

    openEnc(e) {
      // 复制一份再编辑：直接绑列表项会让「取消」也把改动留在界面上
      this.encForm = {
        _id: e._id,
        title: e.title || '',
        content: e.content || '',
        category: e.category || 'study',
        publish_date: e.publish_date || '',
        active: e.active !== false,
        // 记住进来时的启用状态：保存时若从启用变成停用，要按危险操作二次确认
        wasActive: e.active !== false
      };
    },

    closeEnc() {
      this.encForm = null;
    },

    onCategory(e) {
      const i = Number(e.detail.value) || 0;
      this.encForm.category = this.categoryCodes[i] || 'study';
    },

    onDate(e) {
      this.encForm.publish_date = e.detail.value || '';
    },

    // 空串表示「不指定日期，走回落」，所以清空是合法操作而不是打错
    clearDate() {
      this.encForm.publish_date = '';
    },

    onEncActive(e) {
      this.encForm.active = e.detail.value;
    },

    async saveEnc() {
      if (this.acting || !this.encForm) return;
      const f = this.encForm;
      const title = (f.title || '').trim();
      const content = (f.content || '').trim();
      if (!title) {
        uni.showToast({ title: '标题不能为空', icon: 'none' });
        return;
      }
      if (!content) {
        uni.showToast({ title: '正文不能为空', icon: 'none' });
        return;
      }
      // 把开关关掉再保存，效果和「停用」一样（首页不再出现），同样要二次确认
      if (f._id && f.wasActive && f.active !== true) {
        const okStop = await new Promise((resolve) => {
          uni.showModal({
            title: '确认停用',
            content: '停用后这条百科不再出现在首页，但不会被删除。确认停用「' + title + '」？',
            success: (res) => resolve(res.confirm)
          });
        });
        if (!okStop) return;
      }
      this.acting = true;
      try {
        const isNew = !f._id;
        const d = await this.call('admin-encyclopedia', {
          action: isNew ? 'create' : 'update',
          id: f._id,
          title,
          content,
          category: f.category,
          publish_date: f.publish_date || '',
          active: f.active === true
        });
        // 原地更新列表：重拉一次会把另一条正在编辑的临时状态也一起冲掉
        const patch = {
          title,
          content,
          category: f.category,
          publish_date: f.publish_date || '',
          active: f.active === true
        };
        if (isNew) {
          this.encList.unshift(Object.assign({ _id: d._id, created_at: Date.now() }, patch));
        } else {
          const target = this.encList.find((x) => x._id === f._id);
          if (target) Object.assign(target, patch);
        }
        this.encForm = null;
        uni.showToast({ title: '已保存', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: e.message, icon: 'none' });
      } finally {
        this.acting = false;
      }
    },

    async stopEnc() {
      if (this.acting || !this.encForm) return;
      const f = this.encForm;
      const ok = await new Promise((resolve) => {
        uni.showModal({
          title: '确认停用',
          content: '停用后这条百科不再出现在首页，但不会被删除。确认停用「' + f.title + '」？',
          success: (res) => resolve(res.confirm)
        });
      });
      if (!ok) return;

      this.acting = true;
      try {
        // 停用走 remove：云函数是软删（active=false），不物理删才不会让看过的人下次打开报不存在
        await this.call('admin-encyclopedia', { action: 'remove', id: f._id });
        const target = this.encList.find((x) => x._id === f._id);
        if (target) target.active = false;
        this.encForm = null;
        uni.showToast({ title: '已停用', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: e.message, icon: 'none' });
      } finally {
        this.acting = false;
      }
    },

    /* ---------------- 称号 ---------------- */

    openTitle(t) {
      this.titleForm = {
        code: t.code,
        name: t.name || '',
        desc: t.desc || '',
        rarity: t.rarity || 'common',
        condition_text: t.condition_text || '',
        active: t.active !== false,
        sort: t.sort === 0 || t.sort ? t.sort : 100
      };
    },

    closeTitle() {
      this.titleForm = null;
    },

    onRarity(e) {
      const i = Number(e.detail.value) || 0;
      this.titleForm.rarity = this.rarityCodes[i] || 'common';
    },

    onTitleActive(e) {
      this.titleForm.active = e.detail.value;
    },

    async saveTitle() {
      if (this.acting || !this.titleForm) return;
      const f = this.titleForm;
      const name = (f.name || '').trim();
      if (!name) {
        uni.showToast({ title: '名字不能为空', icon: 'none' });
        return;
      }
      this.acting = true;
      try {
        const sort = parseInt(f.sort, 10) || 0;
        await this.call('admin-titles', {
          action: 'update',
          code: f.code,
          name,
          desc: (f.desc || '').trim(),
          rarity: f.rarity,
          condition_text: (f.condition_text || '').trim(),
          active: f.active === true,
          sort
        });
        // 原地更新这一条：称号只有个位数条目，重拉一次纯属浪费
        const target = this.titleList.find((x) => x.code === f.code);
        if (target) {
          target.name = name;
          target.desc = (f.desc || '').trim();
          target.rarity = f.rarity;
          target.condition_text = (f.condition_text || '').trim();
          target.active = f.active === true;
          target.sort = sort;
          // upsert 成功后内置那条已经落进表里了，来源跟着变，否则界面还挂着「内置」会误导
          target.source = 'table';
        }
        this.titleForm = null;
        uni.showToast({ title: '已保存', icon: 'none' });
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
  flex-direction: column;
  gap: 8rpx;
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
  color: var(--tf-text-2);
  background-color: var(--tf-bg);
  border-radius: 8rpx;
}

.item-tag {
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
  align-items: center;
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

.input {
  height: 80rpx;
  padding: 0 20rpx;
  font-size: 26rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
  border-radius: 16rpx;
}

.textarea {
  width: 100%;
  height: 200rpx;
  padding: 20rpx;
  font-size: 26rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
  border-radius: 16rpx;
}

.textarea--short {
  height: 132rpx;
}

.picker-box {
  height: 80rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
  border-radius: 16rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.picker-text {
  font-size: 26rpx;
  color: var(--tf-text);
}

.picker-arrow {
  font-size: 30rpx;
  color: var(--tf-text-3);
}

/* 小程序的 picker 不是普通元素，用后代选择器给它设宽度并不可靠，所以纵向排 */
.date-row {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.date-clear {
  font-size: 24rpx;
  color: var(--tf-primary);
  align-self: flex-end;
}

.proof-tip {
  display: block;
  margin-top: 16rpx;
  font-size: 22rpx;
  line-height: 1.7;
  color: var(--tf-text-2);
}

.btn {
  margin-top: 24rpx;
  height: 92rpx;
  line-height: 92rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
  background-color: var(--tf-primary);
  border-radius: 20rpx;
}

.sheet-foot {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
  margin-top: 24rpx;
}

.sheet-foot .btn {
  flex: 1;
  margin-top: 0;
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
</style>
