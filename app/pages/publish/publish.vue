<template>
  <view class="page">
    <!-- 原生导航已关，自绘小头图（表单页不需要大标题） -->
    <view class="pub-head">
      <view class="pub-blob b1" />
      <view class="pub-back" @tap="goBack">
        <text class="pub-back-arw">‹</text>
      </view>
      <text class="pub-title">{{ editId ? '编辑需求' : '发布需求' }}</text>
      <text class="pub-sub" v-if="!editId">说清时间和地点，更容易遇到同频的人</text>
      <text class="pub-sub" v-else>改完保存，大厅里立刻是新内容</text>
    </view>

    <!-- 未认证引导卡：整页不渲染表单，只给这一块（认证通过后才出现下面的表单） -->
    <view class="guard" v-if="!verified">
      <text class="guard-ico">🎓</text>
      <text class="guard-title">完成学生认证后才能发布搭子需求</text>
      <view class="guard-btn" @tap="goVerify">
        <text class="guard-btn-text">去认证</text>
      </view>
    </view>

    <block v-if="verified">

    <!-- 今日配额：只读查询，拿不到就整行不渲染（不挡表单、不弹错） -->
    <view class="quota" v-if="quotaText" :class="{ 'quota--warn': quotaBlocked }">
      <text class="quota-text">{{ quotaText }}</text>
    </view>

    <!-- 类型 -->
    <view class="card">
      <text class="label">需求类型</text>
      <view class="chips">
        <view
          class="chip"
          :class="['chip--t-' + t.key, { 'chip--on': type === t.key }]"
          v-for="t in TYPES"
          :key="t.key"
          @tap="type = t.key"
        >
          <text class="chip-text" :class="{ 'chip-text--on': type === t.key }">{{ t.label }}</text>
        </view>
      </view>
    </view>

    <!-- 标题 + 描述 -->
    <view class="card">
      <view class="label-row">
        <text class="label">一句话说清你要找什么</text>
        <text class="counter" :class="{ 'counter--warn': title.length > 30 }">
          {{ title.length }}/30
        </text>
      </view>
      <input
        class="input"
        v-model="title"
        placeholder="例：找晚上一起自习的搭子"
        placeholder-class="ph"
        :maxlength="40"
      />

      <view class="label-row label-row--gap">
        <text class="label">详细说明</text>
        <text class="counter" :class="{ 'counter--warn': description.length > 200 }">
          {{ description.length }}/200
        </text>
      </view>
      <textarea
        class="textarea"
        v-model="description"
        placeholder="说明你的时间安排、期望、对搭子的要求…"
        placeholder-class="ph"
        :maxlength="260"
      />
    </view>

    <!-- 标签 -->
    <view class="card">
      <view class="label-row">
        <text class="label">相关标签</text>
        <text class="counter" :class="{ 'counter--warn': tagIds.length > 10 }">
          已选 {{ tagIds.length }}/10
        </text>
      </view>
      <text class="hint">标签用来算你和申请者的重合度，选得越准越容易匹配到同频的人。</text>

      <view class="group" v-for="g in groups" :key="g.key">
        <text class="group-title">{{ g.label }}</text>
        <view class="chips">
          <view
            class="chip chip--sm chip--tag"
            :class="['chip--g-' + g.key, { 'chip--on': tagIds.indexOf(item._id) > -1 }]"
            v-for="item in g.items"
            :key="item._id"
            @tap="toggleTag(item)"
          >
            <text
              class="chip-text"
              :class="{ 'chip-text--on': tagIds.indexOf(item._id) > -1 }"
            >
              {{ item.name }}
            </text>
          </view>
        </view>
      </view>
    </view>

    <!-- 地点与时间 -->
    <view class="card">
      <text class="label">时间和地点（选填）</text>
      <input
        class="input"
        v-model="locationName"
        placeholder="地点，例：图书馆 3 楼"
        placeholder-class="ph"
      />

      <view class="date-row">
        <picker mode="date" :value="startDate" @change="onStartDate">
          <view class="picker">
            <text class="picker-text" :class="{ 'ph-text': !startDate }">
              {{ startDate || '开始日期' }}
            </text>
          </view>
        </picker>
        <picker mode="time" :value="startTime" @change="onStartTime">
          <view class="picker">
            <text class="picker-text" :class="{ 'ph-text': !startTime }">
              {{ startTime || '开始时间' }}
            </text>
          </view>
        </picker>
      </view>
      <text class="clear-time" v-if="startDate || startTime" @tap="clearTime">清除时间</text>
    </view>

    <!-- 配图（选填）：同频圈是动态流，带图的卡片明显更容易被点开。
         编辑模式下整块不渲染：card-detail 回填的是 getTempFileURL 换出的临时链接
         （约 2 小时过期），既不能当 fileID 存回去，也不该让用户在这儿看不见原图。 -->
    <view class="card" v-if="!editId">
      <view class="label-row">
        <text class="label">配图（选填）</text>
        <text class="counter">{{ images.length }}/{{ MAX_IMAGES }}</text>
      </view>
      <text class="hint">最多 {{ MAX_IMAGES }} 张。选好即开始上传，不用等发布。</text>

      <view class="img-row">
        <view class="img-cell" v-for="(im, i) in images" :key="i">
          <image class="img-thumb" :src="im.localPath" mode="aspectFill" @tap="previewImage(i)" />
          <view class="img-del" @tap.stop="removeImage(i)">×</view>
          <view class="img-mask" v-if="im.uploading">
            <text class="img-mask-text">上传中</text>
          </view>
        </view>
        <view class="img-add" v-if="images.length < MAX_IMAGES" @tap="pickImages">
          <text class="img-add-plus">+</text>
        </view>
      </view>
    </view>

    <!-- 提交 -->
    <button class="btn" :class="{ 'btn--off': !canSubmit }" :disabled="!canSubmit || submitting" @tap="onSubmit">
      {{ submitting ? (editId ? '保存中…' : '发布中…') : (editId ? '保存修改' : '发布') }}
    </button>
    <!-- 「每天最多 5 条」只约束新建，编辑不受配额限制，别在这儿吓人 -->
    <text class="bottom-tip" v-if="!editId">发布后在大厅可见，同校的人会优先看到。每天最多 5 条。</text>
    <text class="bottom-tip" v-else>保存后立即生效，这一页不会改动已有配图。</text>

    </block>
  </view>
</template>

<script>
import track from '@/utils/track.js'

const VERIFY_PAGE = '/pages/verify/verify'
// 云函数认证类报错的开头：这类消息原样 toast，不换成通用文案
const VERIFY_ERR_HEAD = '完成学生认证后'

// 认证态口径：storage userInfo 的 schoolVerified 或 is_verified，两者取或。
// 不用可选链 / 空值合并 —— 项目里有低版本端。
function readVerified() {
  const u = uni.getStorageSync('userInfo') || {}
  return u.schoolVerified === true || u.is_verified === true
}

// 时间戳 → picker 的 value：日期与时间控件只收 'YYYY-MM-DD' / 'HH:mm' 字符串
function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

const TYPES = [
  { key: 'study', label: '学习' },
  { key: 'fitness', label: '健身' },
  { key: 'photo', label: '拍照' },
  { key: 'meal', label: '吃饭' },
  { key: 'sport', label: '运动' },
  { key: 'other', label: '其他' }
]

// 配图上限，必须与 card-publish 的 MAX_IMAGES 一致（前端在这里拦，后端还有一道）
const MAX_IMAGES = 3

const CATEGORY_LABEL = {
  routine: '作息',
  intensity: '强度',
  personality: '性格',
  interest: '兴趣',
  preference: '偏好',
  subject: '科目'
}
const CATEGORY_ORDER = ['routine', 'intensity', 'personality', 'interest', 'preference', 'subject']

export default {
  data() {
    return {
      TYPES,
      // 学生认证态：未认证时整页不渲染表单，只显示引导卡
      // data 阶段就读一次，避免已认证用户首帧闪一下引导卡
      verified: readVerified(),
      type: 'study',
      title: '',
      description: '',
      locationName: '',
      startDate: '',
      startTime: '',
      tagIds: [],
      MAX_IMAGES,
      // 每项 { fileID, localPath, uploading }：localPath 只用于本页预览，
      // fileID 是最终提交给云函数的值（cloud:// 形式，渲染时由 card-list 换成链接）
      images: [],
      dict: [],
      // 编辑模式：onLoad 带 id 进来就是来改一张已发布的卡，不是来发新卡。
      // 两种身份共用这一页（表单、校验、图片上传全复用），差异只有回填 / 提交接口 / 不查配额
      editId: '',
      // 原卡的结束时间与人数：表单里没有这两个控件，回填时记下来、保存时原样带回，
      // 避免「只改了标题，结束时间和人数却被悄悄清掉」
      loadedEndTime: null,
      loadedPeople: 1,
      submitting: false,
      // card-publish action='quota' 的只读回执：{ today_count, daily_limit, credit_score, can_publish, reason }
      // null = 还没查到 / 查不到（未登录、请求失败）→ 整行不显示，绝不拿本地计数冒充
      quota: null
    }
  },
  computed: {
    groups() {
      const map = {}
      this.dict.forEach((t) => {
        if (!map[t.category]) map[t.category] = []
        map[t.category].push(t)
      })
      return CATEGORY_ORDER.filter((k) => map[k] && map[k].length > 0).map((k) => ({
        key: k,
        label: CATEGORY_LABEL[k] || k,
        items: map[k]
      }))
    },
    canSubmit() {
      const t = this.title.trim()
      const d = this.description.trim()
      return !!this.type && t.length >= 1 && t.length <= 30 && d.length >= 1 && d.length <= 200
    },
    // 顶部配额那一行的文案：数字全部来自云函数，本地不加任何推算
    quotaText() {
      const q = this.quota
      if (!q) return ''
      const line = '今日已发 ' + q.today_count + '/' + q.daily_limit
      // 不能发时必须把原因说清楚，否则用户点发布才知道被挡住
      return q.can_publish === false && q.reason ? line + ' · ' + q.reason : line
    },
    quotaBlocked() {
      return !!(this.quota && this.quota.can_publish === false)
    }
  },
  onLoad(options) {
    // 编辑模式入口：/pages/publish/publish?id=xxx。
    // 必须在这里（首帧之前）就定下来，否则标题会先闪一下「发布需求」再变「编辑需求」
    const editId = (options && options.id) || ''
    if (editId) this.editId = editId
    // 埋点：发布漏斗的起点。
    // 用 onLoad 而不是 onShow —— onShow 在「从相册/系统页面返回」「切后台再回来」
    // 都会再触发一次，会把同一张卡的漏斗起点数成好几次；onLoad 每个页面实例正好一次。
    // 编辑需求不属于发布漏斗，计进去会把「发布开始 → 发布成功」的转化率稀释掉
    if (!this.editId) track('publish_start')
    // 进页面先判认证态：未认证不渲染表单（从认证页返回时 onShow 会再刷一次）
    this.verified = readVerified()
    if (this.verified) this.loadTags()
    if (this.editId) this.loadCard(this.editId)
  },
  onShow() {
    // 认证态可能刚从认证页返回就变了：先刷认证态，未认证不查配额
    this.verified = readVerified()
    if (!this.verified) return
    // 编辑模式不查配额：配额只管「今天还能发几条」，跟改一条已发布的卡无关
    if (this.editId) return
    // 每次进页面都刷一次：从"发布成功后返回"或"改了今天已发条数"再进来，数字要跟着变
    this.loadQuota()
  },
  methods: {
    /* 原生导航已关，返回自己处理 */
    goBack() {
      uni.navigateBack({
        fail: () => uni.switchTab({ url: '/pages/index/index' })
      })
    },

    /* 引导卡的「去认证」：认证页在 pages.json 里已注册 */
    goVerify() {
      uni.navigateTo({ url: VERIFY_PAGE })
    },

    /**
     * 查今日配额（card-publish 的只读分支 action='quota'）。
     * 失败、未登录、字段不全一律把 quota 置 null → 顶部那一行不渲染，
     * 表单照用；发布接口自己还有一道硬校验，配额行只是提前告知。
     */
    async loadQuota() {
      const token = uni.getStorageSync('token')
      if (!token || typeof uniCloud === 'undefined') {
        this.quota = null
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'card-publish',
          data: { action: 'quota', token: token }
        })
        const r = (res && res.result) || {}
        const d = r.data || {}
        if (r.code === 0 && typeof d.today_count === 'number' && typeof d.daily_limit === 'number') {
          this.quota = {
            today_count: d.today_count,
            daily_limit: d.daily_limit,
            credit_score: typeof d.credit_score === 'number' ? d.credit_score : null,
            can_publish: d.can_publish !== false,
            reason: d.reason || ''
          }
        } else {
          this.quota = null
        }
      } catch (e) {
        this.quota = null
      }
    },

    async loadTags() {
      try {
        const res = await uniCloud.callFunction({ name: 'tag-list' })
        const r = res.result || {}
        if (r.code === 0) this.dict = r.data.list || []
      } catch (e) {
        // 标签拉不到不影响发布，只是少了个选项
      }
    },

    /* 编辑模式回填：数据源用 card-detail，不用列表项 ——
       列表项没有 tags 明细，字段也不全，回填出来必然缺一块 */
    async loadCard(cardId) {
      const token = uni.getStorageSync('token') || ''
      if (!token || typeof uniCloud === 'undefined') {
        uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
        setTimeout(() => uni.navigateBack(), 800)
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'card-detail',
          data: { token: token, card_id: cardId }
        })
        const r = (res && res.result) || {}
        const card = (r.data && r.data.card) || null
        if (r.code !== 0 || !card) {
          uni.showToast({ title: r.msg || '这条需求不存在或已被删除', icon: 'none' })
          setTimeout(() => uni.navigateBack(), 800)
          return
        }
        // 后端 card-update 还会再拦一道；这里拦是为了不让用户在别人的卡上白填一屏
        if (!card.is_mine) {
          uni.showToast({ title: '只能编辑自己发布的需求', icon: 'none' })
          setTimeout(() => uni.navigateBack(), 800)
          return
        }
        if (card.status !== 'open') {
          uni.showToast({ title: '已找到搭子或已关闭的需求不能再修改', icon: 'none' })
          setTimeout(() => uni.navigateBack(), 800)
          return
        }
        this.fillForm(card)
      } catch (e) {
        uni.showToast({ title: '加载需求失败，稍后再试', icon: 'none' })
        setTimeout(() => uni.navigateBack(), 800)
      }
    },

    /* 卡片字段 → 表单字段。时间要拆成 picker 认的两个字符串，直接塞时间戳控件不认 */
    fillForm(card) {
      this.type = card.type || this.type
      this.title = card.title || ''
      this.description = card.description || ''
      this.locationName = card.location_name || ''
      // card-detail 给的 tags 是 [{_id,name,category}]，表单只认 _id
      const ids = Array.isArray(card.tags) ? card.tags.map((t) => t && t._id).filter(Boolean) : []
      this.tagIds = ids.slice(0, 10)
      const ts = Number(card.start_time)
      if (ts && !isNaN(ts)) {
        const d = new Date(ts)
        this.startDate = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
        this.startTime = pad2(d.getHours()) + ':' + pad2(d.getMinutes())
      } else {
        this.startDate = ''
        this.startTime = ''
      }
      this.loadedEndTime = typeof card.end_time === 'number' ? card.end_time : null
      this.loadedPeople = typeof card.expected_people === 'number' ? card.expected_people : 1
    },

    toggleTag(item) {
      const i = this.tagIds.indexOf(item._id)
      if (i > -1) {
        this.tagIds.splice(i, 1)
        return
      }
      if (this.tagIds.length >= 10) {
        uni.showToast({ title: '最多选 10 个标签', icon: 'none' })
        return
      }
      this.tagIds.push(item._id)
    },

    onStartDate(e) {
      this.startDate = e.detail.value
    },
    onStartTime(e) {
      this.startTime = e.detail.value
    },
    clearTime() {
      this.startDate = ''
      this.startTime = ''
    },

    // 日期 + 时间 → 毫秒时间戳。只有日期没时间时算当天 00:00
    startTimestamp() {
      if (!this.startDate) return null
      const parts = this.startDate.split('-')
      const tparts = (this.startTime || '00:00').split(':')
      const d = new Date(
        parseInt(parts[0], 10),
        parseInt(parts[1], 10) - 1,
        parseInt(parts[2], 10),
        parseInt(tparts[0], 10),
        parseInt(tparts[1], 10),
        0,
        0
      )
      return d.getTime()
    },

    /** 选图：一次最多选到上限，选完立刻逐张上传 */
    pickImages() {
      const left = MAX_IMAGES - this.images.length
      if (left <= 0) return
      uni.chooseImage({
        count: left,
        // 原图一张 2-4 MB，直传云存储同时吃存储和 CDN 流量；列表里看图不需要原图
        sizeType: ['compressed'],
        success: (res) => {
          const paths = res.tempFilePaths || []
          paths.forEach((p) => {
            const item = { fileID: '', localPath: p, uploading: true }
            this.images.push(item)
            this.uploadImage(item)
          })
        }
      })
    },

    /**
     * 上传一张图。
     * 失败时把这张从列表里摘掉：留在列表里会让 images 少一项 fileID，
     * 用户看到缩略图却发不出去，比直接消失更难理解。
     */
    uploadImage(item) {
      const self = this
      const doUpload = async (filePath) => {
        try {
          // cloudPath 必须带随机串：支付宝云的 cloudPath 就是文件绝对路径，同路径直接覆盖
          const rand = Math.random().toString(36).slice(2, 10)
          const up = await uniCloud.uploadFile({
            filePath: filePath,
            cloudPath: 'card/' + Date.now() + '-' + rand + '.jpg',
            fileType: 'image'
          })
          if (!up || !up.fileID) throw new Error('no fileID')
          // 阿里云给 https 直链、支付宝云给 cloud://，后端两种都收，这里原样存
          item.fileID = up.fileID
        } catch (e) {
          const i = self.images.indexOf(item)
          if (i > -1) self.images.splice(i, 1)
          uni.showToast({ title: '图片上传失败', icon: 'none' })
        } finally {
          item.uploading = false
        }
      }
      // 上传前先压一道（长边 1280 / 质量 60），失败就用原图，不阻断发布
      if (typeof uni.compressImage !== 'function') return doUpload(item.localPath)
      uni.compressImage({
        src: item.localPath,
        quality: 60,
        compressedWidth: 1280,
        success: (res) => doUpload(res.tempFilePath),
        fail: () => doUpload(item.localPath)
      })
    },

    removeImage(i) {
      this.images.splice(i, 1)
    },

    previewImage(i) {
      const urls = this.images.map((x) => x.localPath)
      if (!urls.length) return
      uni.previewImage({ urls, current: urls[i] })
    },

    async onSubmit() {
      if (!this.canSubmit || this.submitting) return
      // 图还在传就发出去，卡片会少一张图且用户以为发了
      if (this.images.some((x) => x.uploading)) {
        uni.showToast({ title: '图片还在上传，稍等一下', icon: 'none' })
        return
      }
      const token = uni.getStorageSync('token')
      if (!token) {
        uni.showModal({
          title: '需要登录',
          content: '发布卡片需要先登录。',
          confirmText: '去登录',
          success: (r) => {
            if (r.confirm) uni.reLaunch({ url: '/pages/login/login' })
          }
        })
        return
      }

      // 编辑模式走 card-update，发布那套配额 / 认证口径一条都不复用
      if (this.editId) {
        await this.submitEdit(token)
        return
      }

      this.submitting = true
      try {
        const res = await uniCloud.callFunction({
          name: 'card-publish',
          data: {
            token,
            type: this.type,
            title: this.title.trim(),
            description: this.description.trim(),
            location_name: this.locationName.trim(),
            start_time: this.startTimestamp(),
            expected_people: 1,
            tag_ids: this.tagIds,
            images: this.images.map((x) => x.fileID).filter(Boolean)
          }
        })
        const r = res.result || {}
        if (r.code === 0) {
          // 埋点：card-publish 成功回执里带新卡 id（data.card_id），拿它关联后续的
          // publish_to_first_response。拿不到就报空串，不为埋点拦住发布流程。
          const created = (r.data && r.data.card_id) || ''
          track('publish_success', { card_id: created })
          uni.showToast({ title: '发布成功', icon: 'success' })
          setTimeout(() => uni.navigateBack(), 800)
        } else {
          // 认证类报错（如「完成学生认证后才能发布搭子需求」）原样 toast，不吞掉、不换通用文案
          const msg = r.msg || ''
          if (msg.indexOf(VERIFY_ERR_HEAD) > -1) {
            uni.showToast({ title: msg, icon: 'none', duration: 2500 })
            return
          }
          uni.showModal({
            title: '发布失败',
            content: r.msg || '未知错误',
            showCancel: false
          })
        }
      } catch (e) {
        uni.showModal({
          title: '调用失败',
          content: '云函数 card-publish 调用失败，检查是否已部署。\n' + (e.message || ''),
          showCancel: false
        })
      } finally {
        this.submitting = false
      }
    },

    /* 编辑提交：走 card-update，字段口径与 card-publish 完全一致（同一个 tag_ids、
       同一套 type / 字数 / 时间关系校验）。
       **不带 images**：card-detail 回填的是 getTempFileURL 换出的临时链接，两小时过期，
       原样写回去等于给以后的自己埋白框；配图入口在编辑模式下整块隐藏了，
       所以这一页也不存在「新传的图发不出去」的问题。 */
    async submitEdit(token) {
      if (this.submitting) return
      const startTs = this.startTimestamp()
      // 结束时间表单里改不了：原值不动。但如果新的开始时间已经越过它，
      // 留着只会让后端「结束不能早于开始」必然报错、用户又无从修改，这种时候清空
      let endTs = this.loadedEndTime
      if (endTs !== null && startTs && endTs < startTs) endTs = null

      this.submitting = true
      try {
        const res = await uniCloud.callFunction({
          name: 'card-update',
          data: {
            token: token,
            action: 'edit',
            card_id: this.editId,
            type: this.type,
            title: this.title.trim(),
            description: this.description.trim(),
            location_name: this.locationName.trim(),
            start_time: startTs,
            end_time: endTs,
            expected_people: this.loadedPeople,
            tag_ids: this.tagIds
          }
        })
        const r = (res && res.result) || {}
        if (r.code === 0) {
          uni.showToast({ title: '已保存', icon: 'success' })
          // 回上一页：my-cards 的 onShow 会自己 refresh，看到的就是新内容
          setTimeout(() => uni.navigateBack(), 600)
          return
        }
        uni.showToast({ title: r.msg || '保存失败', icon: 'none', duration: 2500 })
      } catch (e) {
        uni.showModal({
          title: '调用失败',
          content: '云函数 card-update 调用失败，检查是否已部署。\n' + (e.message || ''),
          showCancel: false
        })
      } finally {
        this.submitting = false
      }
    }
  }
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  padding: 0 24rpx 60rpx;
  box-sizing: border-box;
}

/* ==========================================================================
   小头图：表单页不需要大标题，一块矮的渐变条就够
   ========================================================================== */
.pub-head {
  position: relative;
  overflow: hidden;
  margin: 0 -24rpx 24rpx;
  padding: calc(var(--status-bar-height) + 76rpx) 32rpx 36rpx;
  border-radius: 0 0 40rpx 40rpx;
  background:
    radial-gradient(60% 50% at 92% 8%, rgba(249, 208, 56, 0.42) 0%, rgba(249, 208, 56, 0) 60%),
    linear-gradient(152deg, #5E9BE2 0%, #6FB8D4 34%, #8FC9A8 68%, #C4D888 100%);
}
.pub-blob {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}
.pub-head .b1 {
  right: -70rpx;
  top: -70rpx;
  width: 280rpx;
  height: 280rpx;
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0) 76%);
}
.pub-back {
  position: absolute;
  left: 24rpx;
  top: calc(var(--status-bar-height) + 12rpx);
  width: 60rpx;
  height: 60rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.24);
  border: 1rpx solid rgba(255, 255, 255, 0.34);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
}
.pub-back-arw {
  color: #fff;
  font-size: 42rpx;
  line-height: 1;
  margin-top: -4rpx;
}
.pub-title {
  position: relative;
  z-index: 2;
  display: block;
  font-size: 60rpx;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.05em;
  text-shadow: 3rpx 5rpx 0 rgba(34, 72, 40, 0.32), 0 10rpx 26rpx rgba(30, 66, 40, 0.20);
  transform: rotate(-2deg);
  transform-origin: left center;
}
.pub-sub {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: 14rpx;
  font-size: 23rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.90);
  transform: rotate(-2deg);
  transform-origin: left center;
}
/* 顶部今日配额（一行小字，不抢版面；达上限才变警示色） */
.quota {
  margin: 0 0 20rpx;
  padding: 18rpx 24rpx;
  border-radius: 14rpx;
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
}
.quota--warn {
  border-color: var(--tf-danger);
}
.quota-text {
  font-size: 23rpx;
  color: var(--tf-text-2);
  line-height: 1.5;
}
.quota--warn .quota-text {
  color: var(--tf-danger);
  font-weight: 600;
}

.card {
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-glass-shadow);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  padding: 28rpx;
  margin-bottom: 20rpx;
}
.label {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.label-row--gap {
  margin-top: 36rpx;
}
.counter {
  font-size: 23rpx;
  color: var(--tf-text-2);
}
.counter--warn {
  color: var(--tf-danger);
  font-weight: 600;
}
.hint {
  display: block;
  font-size: 23rpx;
  color: var(--tf-text-2);
  line-height: 1.6;
  margin-top: 10rpx;
}

/* —— 输入 —— */
.input {
  background-color: var(--tf-bg);
  border-radius: 12rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
  color: var(--tf-text);
  margin-top: 16rpx;
}
.textarea {
  background-color: var(--tf-bg);
  border-radius: 12rpx;
  padding: 22rpx 24rpx;
  font-size: 28rpx;
  color: var(--tf-text);
  width: 100%;
  height: 220rpx;
  box-sizing: border-box;
  margin-top: 16rpx;
}
.ph {
  color: #b8bcc4;
}

/* —— chips —— */
.chips {
  display: flex;
  flex-wrap: wrap;
  margin-top: 18rpx;
}
.chip {
  padding: 14rpx 30rpx;
  margin: 0 14rpx 14rpx 0;
  background-color: var(--tf-bg);
  border-radius: 999rpx;
  border: 2rpx solid transparent;
}

/* ==========================================================================
   六色渐变：未选中极浅版，选中饱和版
   --------------------------------------------------------------------------
   写成 class 不用 :style —— uni-app 的 :style 对象会丢弃 linear-gradient。
   类型和分类共用同一套色相（蓝/橙/黄/绿/紫/粉），只有浅深两档。
   ========================================================================== */
/* 类型：学习=蓝 健身=绿 拍照=黄 吃饭=橙 运动=紫 其他=粉 */
.chip--t-study   { background: linear-gradient(135deg, #F2F7FE 0%, #EDF9FA 100%); }
.chip--t-study.chip--on   { background: linear-gradient(135deg, #C6DEF7 0%, #B2E6EE 100%); border-color: transparent; }
.chip--t-fitness { background: linear-gradient(135deg, #F8FCF2 0%, #F2FBF7 100%); }
.chip--t-fitness.chip--on { background: linear-gradient(135deg, #D8EBBE 0%, #BEEADA 100%); border-color: transparent; }
.chip--t-photo   { background: linear-gradient(135deg, #FFFDF2 0%, #FFF9EE 100%); }
.chip--t-photo.chip--on   { background: linear-gradient(135deg, #FFEBAE 0%, #FFD8AE 100%); border-color: transparent; }
.chip--t-meal    { background: linear-gradient(135deg, #FFF7F2 0%, #FFF4F7 100%); }
.chip--t-meal.chip--on    { background: linear-gradient(135deg, #FFDCC6 0%, #FFC9DA 100%); border-color: transparent; }
.chip--t-sport   { background: linear-gradient(135deg, #F8F6FE 0%, #F4F7FE 100%); }
.chip--t-sport.chip--on   { background: linear-gradient(135deg, #DACCF9 0%, #C8DAF9 100%); border-color: transparent; }
.chip--t-other   { background: linear-gradient(135deg, #FFF7FA 0%, #FBF6FE 100%); }
.chip--t-other.chip--on   { background: linear-gradient(135deg, #FFD2E2 0%, #E8D2F9 100%); border-color: transparent; }

/* 标签分类：作息=蓝 强度=橙 性格=黄 兴趣=绿 偏好=紫 科目=粉 */
.chip--g-routine     { background: linear-gradient(135deg, #F2F7FE 0%, #EDF9FA 100%); }
.chip--g-routine.chip--on     { background: linear-gradient(135deg, #2F6BB8 0%, #1C7A8C 100%); border-color: transparent; }
.chip--g-intensity   { background: linear-gradient(135deg, #FFF7F2 0%, #FFF4F7 100%); }
.chip--g-intensity.chip--on   { background: linear-gradient(135deg, #B85A28 0%, #A03A5C 100%); border-color: transparent; }
.chip--g-personality { background: linear-gradient(135deg, #FFFDF2 0%, #FFF9EE 100%); }
.chip--g-personality.chip--on { background: linear-gradient(135deg, #8F6800 0%, #96501C 100%); border-color: transparent; }
.chip--g-interest    { background: linear-gradient(135deg, #F8FCF2 0%, #F2FBF7 100%); }
.chip--g-interest.chip--on    { background: linear-gradient(135deg, #4A7522 0%, #247060 100%); border-color: transparent; }
.chip--g-preference  { background: linear-gradient(135deg, #F8F6FE 0%, #F4F7FE 100%); }
.chip--g-preference.chip--on  { background: linear-gradient(135deg, #5A3DC0 0%, #2A5AB8 100%); border-color: transparent; }
.chip--g-subject     { background: linear-gradient(135deg, #FFF7FA 0%, #FBF6FE 100%); }
.chip--g-subject.chip--on     { background: linear-gradient(135deg, #A03A60 0%, #653394 100%); border-color: transparent; }

/* 标签文字：未选中深墨（六种浅底上都够读）；
   选中后是纯白 —— 前提是选中底色换成饱和渐变，浅色底上白字是看不见的。
   （之前选中态用的是 var(--tf-primary) 暖黄，压在浅粉浅蓝上又糊又脏） */
.chip-text {
  font-size: 26rpx;
  color: #2E2A26;
}
.chip--tag.chip--on .chip-text {
  color: #FFFFFF;
  font-weight: 800;
}

.group {
  margin-top: 24rpx;
}
.group-title {
  font-size: 24rpx;
  color: var(--tf-text-2);
}

/* —— 时间 —— */
.date-row {
  display: flex;
  margin-top: 16rpx;
}
.picker {
  background-color: var(--tf-bg);
  border-radius: 12rpx;
  padding: 22rpx 24rpx;
  margin-right: 16rpx;
  min-width: 200rpx;
}
.picker-text {
  font-size: 27rpx;
  color: var(--tf-text);
}
.ph-text {
  color: #b8bcc4;
}
.clear-time {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-2);
  margin-top: 16rpx;
  text-decoration: underline;
}

/* —— 提交 —— */
/* —— 配图 —— */
.img-row {
  display: flex;
  flex-wrap: wrap;
  margin-top: 20rpx;
}
.img-cell {
  position: relative;
  width: 180rpx;
  height: 180rpx;
  margin: 0 16rpx 16rpx 0;
  border-radius: 14rpx;
  overflow: hidden;
  background-color: var(--tf-bg);
}
.img-thumb {
  width: 100%;
  height: 100%;
  display: block;
}
/* 删除按钮压在右上角：透明底在任意图片上都看得见 */
.img-del {
  position: absolute;
  top: 0;
  right: 0;
  width: 48rpx;
  height: 48rpx;
  line-height: 44rpx;
  text-align: center;
  font-size: 32rpx;
  color: #fff;
  background-color: rgba(0, 0, 0, 0.45);
  border-bottom-left-radius: 14rpx;
}
.img-mask {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.3);
}
.img-mask-text {
  font-size: 22rpx;
  color: #fff;
}
.img-add {
  width: 180rpx;
  height: 180rpx;
  margin: 0 16rpx 16rpx 0;
  border-radius: 14rpx;
  border: 2rpx dashed var(--tf-card-line);
  background-color: var(--tf-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.img-add-plus {
  font-size: 56rpx;
  line-height: 1;
  color: var(--tf-text-2);
}

/* ---- 未认证引导卡 ---- */
.guard {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 96rpx 40rpx 64rpx;
  gap: 16rpx;
}

.guard-ico {
  font-size: 88rpx;
  opacity: 0.45;
}

.guard-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--tf-text);
  text-align: center;
  line-height: 1.5;
}

.guard-btn {
  margin-top: 12rpx;
  padding: 0 56rpx;
  height: 84rpx;
  border-radius: 42rpx;
  background: linear-gradient(135deg, #8FB86A 0%, #3B7ADB 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.guard-btn-text {
  font-size: 29rpx;
  font-weight: 700;
  color: #FFFFFF;
}

/* 提交按钮：绿→蓝渐变。
   原来用 var(--tf-primary) 暖黄配白字，对比度只有 1.49:1 —— 几乎看不见。 */
.btn {
  background: linear-gradient(135deg, #8FB86A 0%, #3B7ADB 100%);
  color: #FFFFFF;
  font-size: 31rpx;
  font-weight: 700;
  border: none;
  border-radius: 46rpx;
  line-height: 96rpx;
  height: 96rpx;
  margin-top: 16rpx;
  box-shadow: 0 10rpx 28rpx rgba(59, 122, 219, 0.28);
}
.btn--off {
  background: #E4DFD6;
  color: #9A9186;
  box-shadow: none;
}
.btn::after {
  border: none;
}
.bottom-tip {
  display: block;
  font-size: 23rpx;
  color: var(--tf-text-2);
  text-align: center;
  line-height: 1.6;
  margin-top: 20rpx;
}
</style>
