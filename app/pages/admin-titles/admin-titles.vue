<!-- 称号配置：mine 的「百科与称号」进的是 admin-encyclopedia（两个 tab），这里留一条独立路由给深链直接用 -->
<template>
  <view class="page">
    <!-- 非管理员先看空态：本地判定完再决定发不发请求 -->
    <view class="deny" v-if="denied">
      <text class="deny-ico">🔒</text>
      <text class="deny-title">没有权限</text>
      <text class="deny-desc">这个页面只给管理员用。如果你是管理员但没有权限，说明你的账号还没被标记。</text>
    </view>

    <block v-else>
      <!-- 四态：加载中 / 出错 / 空 / 正常 -->
      <text class="hint" v-if="loading">加载中…</text>
      <text class="hint hint--err" v-else-if="errMsg" @tap="loadList">{{ errMsg }}，点这里重试</text>
      <text class="hint" v-else-if="!list.length">没有称号条目</text>

      <view class="item" v-for="t in list" :key="t.code" @tap="openForm(t)">
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

      <view class="mask" v-if="form" @tap="closeForm"></view>
      <view class="sheet" v-if="form">
        <view class="sheet-head">
          <text class="sheet-title">编辑称号</text>
          <text class="sheet-close" @tap="closeForm">✕</text>
        </view>

        <scroll-view class="sheet-body" scroll-y>
          <view class="kv">
            <text class="k">code</text>
            <text class="v">{{ form.code }}</text>
          </view>
          <text class="proof-tip">code 只读：它已经写进用户的称号记录里，改了等于让已获得的称号失效。</text>

          <text class="sec-title">名字</text>
          <input class="input" v-model="form.name" placeholder="称号名字" maxlength="20" />

          <text class="sec-title">描述</text>
          <input class="input" v-model="form.desc" placeholder="可留空" maxlength="60" />

          <text class="sec-title">稀有度</text>
          <picker mode="selector" :range="rarityLabels" @change="onRarity">
            <view class="picker-box">
              <text class="picker-text">{{ rarityText(form.rarity) }}</text>
              <text class="picker-arrow">›</text>
            </view>
          </picker>

          <text class="sec-title">条件文案</text>
          <textarea
            class="textarea"
            v-model="form.condition_text"
            placeholder="例如：填了昵称、头像、学校，并选了至少 1 个标签"
          />
          <text class="proof-tip">这句话就是称号墙上「未获得」时显示的内容，改完立刻对所有人生效。</text>

          <text class="sec-title">排序</text>
          <input class="input" v-model="form.sort" type="number" placeholder="数字，越小越靠前" />

          <view class="kv">
            <text class="k">启用</text>
            <switch :checked="form.active" @change="onActive" />
          </view>
        </scroll-view>

        <view class="sheet-foot">
          <button class="btn" :disabled="acting" @tap="save">保存</button>
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
      list: [],
      loading: false,
      errMsg: '',
      form: null,
      acting: false,
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
        name: 'admin-titles',
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
        const d = await this.call({ action: 'list' });
        this.list = d.list || [];
      } catch (e) {
        // 403 已经在 call 里转成 deny 空态，这里只接业务/网络错误
        if (!this.denied) this.errMsg = e.message || '加载失败';
      } finally {
        this.loading = false;
      }
    },

    rarityText(code) {
      const map = { common: '普通', rare: '稀有', epic: '史诗' };
      return map[code] || code || '普通';
    },

    openForm(t) {
      // 复制一份再编辑：直接绑列表项会让「取消」也把改动留在界面上
      this.form = {
        code: t.code,
        name: t.name || '',
        desc: t.desc || '',
        rarity: t.rarity || 'common',
        condition_text: t.condition_text || '',
        active: t.active !== false,
        sort: t.sort === 0 || t.sort ? t.sort : 100
      };
    },

    closeForm() {
      this.form = null;
    },

    onRarity(e) {
      const i = Number(e.detail.value) || 0;
      this.form.rarity = this.rarityCodes[i] || 'common';
    },

    onActive(e) {
      this.form.active = e.detail.value;
    },

    async save() {
      if (this.acting || !this.form) return;
      const f = this.form;
      const name = (f.name || '').trim();
      if (!name) {
        uni.showToast({ title: '名字不能为空', icon: 'none' });
        return;
      }
      this.acting = true;
      try {
        const sort = parseInt(f.sort, 10) || 0;
        await this.call({
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
        const target = this.list.find((x) => x.code === f.code);
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
        this.form = null;
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
  height: 160rpx;
  padding: 20rpx;
  font-size: 26rpx;
  box-sizing: border-box;
  background-color: var(--tf-bg);
  border-radius: 16rpx;
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

.proof-tip {
  display: block;
  margin-top: 16rpx;
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
</style>
