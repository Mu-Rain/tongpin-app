<template>
  <view class="page">
    <view class="card">
      <view class="label-row">
        <text class="label">发点什么</text>
        <text class="counter" :class="{ 'counter--warn': content.length >= MAX_CONTENT }">
          {{ content.length }}/{{ MAX_CONTENT }}
        </text>
      </view>
      <textarea
        class="ta"
        v-model="content"
        :maxlength="MAX_CONTENT"
        :auto-height="true"
        placeholder="今天的自习、食堂、操场…随便写"
        placeholder-class="ta-ph"
      />
    </view>

    <view class="card">
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

    <button class="btn" :class="{ 'btn--off': !canSubmit }" :disabled="!canSubmit || submitting" @tap="onSubmit">
      {{ submitting ? '发布中…' : '发布' }}
    </button>
    <text class="bottom-tip">发出去同频圈可见。找搭子请去首页发需求，这里是日常动态。每天最多 20 条。</text>
  </view>
</template>

<script>
const MAX_IMAGES = 3
const MAX_CONTENT = 500

export default {
  data() {
    return {
      MAX_IMAGES,
      MAX_CONTENT,
      content: '',
      // 每一项 { fileID, localPath, uploading, dim }
      // dim 是这张图真正发出去时的像素宽高 { w, h }，量不到就是 null
      images: [],
      submitting: false
    }
  },
  computed: {
    canSubmit() {
      if (this.submitting) return false
      // 有字或有图就能发；空动态发出去就是一张空白卡片
      const hasText = !!this.content.trim()
      const hasImg = this.images.some((x) => !!x.fileID)
      return hasText || hasImg
    }
  },
  methods: {
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
          // ★ 量的是即将上传的这个文件（压缩后的临时文件），它才是详情页要展示的那张，
          //   宽高比未必等于原图（compressedWidth 只约束宽）。
          // ★ 量不到就记 null 而不是中断：尺寸只是让首屏不跳，不该让一张图发不出去。
          item.dim = await self.measureSize(filePath)
          // cloudPath 必须带随机串：支付宝云的 cloudPath 就是文件绝对路径，同路径直接覆盖
          const rand = Math.random().toString(36).slice(2, 10)
          const up = await uniCloud.uploadFile({
            filePath: filePath,
            cloudPath: 'post/' + Date.now() + '-' + rand + '.jpg',
            fileType: 'image'
          })
          if (!up || !up.fileID) throw new Error('no fileID')
          // 支付宝云给 cloud://、阿里云给 https 直链，后端两种都收，这里原样存
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
        success: (r) => doUpload(r.tempFilePath || item.localPath),
        fail: () => doUpload(item.localPath)
      })
    },

    removeImage(i) {
      this.images.splice(i, 1)
    },

    previewImage(i) {
      const urls = this.images.map((x) => x.localPath)
      uni.previewImage({ urls, current: i })
    },

    /**
     * 量本地文件的像素宽高，量不到返回 null。
     * 只用来填 images_dim，任何失败都静默降级成 null。
     */
    measureSize(filePath) {
      return new Promise(function (resolve) {
        if (!filePath || typeof uni.getImageInfo !== 'function') return resolve(null)
        uni.getImageInfo({
          src: filePath,
          success(info) {
            const w = Math.round(Number(info && info.width) || 0)
            const h = Math.round(Number(info && info.height) || 0)
            resolve(w > 0 && h > 0 ? { w: w, h: h } : null)
          },
          fail() {
            resolve(null)
          }
        })
      })
    },

    async onSubmit() {
      if (!this.canSubmit) return
      if (this.images.some((x) => x.uploading)) {
        uni.showToast({ title: '图片还在上传', icon: 'none' })
        return
      }

      const token = uni.getStorageSync('token')
      if (!token) {
        uni.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      this.submitting = true
      try {
        // 先筛一遍再各自 map：images 与 images_dim 必须同序同长，
        // 两个数组各写一次过滤条件，条件一旦写歪就会错位，配错图的尺寸比没有尺寸更糟。
        const ready = this.images.filter((x) => !!x.fileID)
        const res = await uniCloud.callFunction({
          name: 'post-publish',
          data: {
            token,
            content: this.content.trim(),
            images: ready.map((x) => x.fileID),
            // 缺尺寸给 null 占位而不是丢项：长度一变，后端就不知道哪个尺寸属于哪张图
            images_dim: ready.map((x) => x.dim || null)
          }
        })
        const r = res.result || {}
        if (r.code === 0) {
          uni.showToast({ title: '已发布', icon: 'success' })
          // 回上一页；同频圈的 onShow 会重新拉一次列表，不用手动通知
          setTimeout(() => uni.navigateBack(), 700)
        } else {
          uni.showModal({
            title: '发布失败',
            content: r.msg || '未知错误',
            showCancel: false
          })
        }
      } catch (e) {
        uni.showModal({
          title: '调用失败',
          content: '云函数 post-publish 调用失败，检查是否已部署。\n' + (e.message || ''),
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
  padding: 24rpx 24rpx 60rpx;
  box-sizing: border-box;
}

.card {
  background: var(--tf-card);
  border: 2rpx solid var(--tf-card-line);
  border-radius: var(--tf-r-lg);
  box-shadow: var(--tf-glass-shadow);
  padding: 28rpx;
  margin-bottom: 20rpx;
}

.label-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}
.label {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--tf-text);
}
.counter {
  font-size: 24rpx;
  color: var(--tf-text-3);
  font-variant-numeric: tabular-nums;
}
.counter--warn {
  color: var(--tf-danger);
}

.ta {
  width: 100%;
  min-height: 260rpx;
  font-size: 30rpx;
  line-height: 1.6;
  color: var(--tf-text);
  box-sizing: border-box;
}
.ta-ph {
  color: var(--tf-text-3);
}

.hint {
  display: block;
  font-size: 24rpx;
  color: var(--tf-text-3);
  line-height: 1.6;
  margin-bottom: 20rpx;
}

.img-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 16rpx;
}
.img-cell {
  position: relative;
  width: 180rpx;
  height: 180rpx;
  border-radius: var(--tf-r-sm);
  overflow: hidden;
  border: 2rpx solid var(--tf-card-line);
}
.img-thumb {
  width: 100%;
  height: 100%;
  display: block;
}
.img-del {
  position: absolute;
  top: 0;
  right: 0;
  width: 44rpx;
  height: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  border-bottom-left-radius: var(--tf-r-sm);
}
.img-mask {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}
.img-mask-text {
  font-size: 22rpx;
  color: #fff;
}

.img-add {
  width: 180rpx;
  height: 180rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2rpx dashed var(--tf-line);
  border-radius: var(--tf-r-sm);
  background: var(--tf-bg);
}
.img-add-plus {
  font-size: 56rpx;
  line-height: 1;
  color: var(--tf-text-3);
}

.btn {
  margin-top: 12rpx;
  height: 92rpx;
  line-height: 92rpx;
  border-radius: var(--tf-r-md);
  background: var(--tf-primary);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  border: none;
}
.btn::after {
  border: none;
}
.btn--off {
  background: var(--tf-text-3);
  opacity: 0.6;
}

.bottom-tip {
  display: block;
  margin-top: 20rpx;
  font-size: 23rpx;
  color: var(--tf-text-3);
  line-height: 1.6;
  text-align: center;
}
</style>
