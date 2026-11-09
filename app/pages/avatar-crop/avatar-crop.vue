<template>
  <view class="crop-page">
    <view class="crop-hint">拖动调整位置，双指捏合缩放</view>

    <view class="crop-stage">
      <view
        class="crop-frame"
        :style="'width:' + framePx + 'px;height:' + framePx + 'px'"
        @touchstart="onTouchStart"
        @touchmove.stop.prevent="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <canvas
          class="crop-canvas"
          canvas-id="crop"
          id="crop"
          :width="framePx"
          :height="framePx"
          :style="'width:' + framePx + 'px;height:' + framePx + 'px'"
        ></canvas>
        <view class="crop-ring"></view>
      </view>
    </view>

    <view class="crop-bar">
      <view class="crop-btn crop-btn--ghost" @tap="pickImage">重新选择</view>
      <view class="crop-btn crop-btn--primary" @tap="useImage">使用</view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      src: '',
      framePx: 300,
      imgW: 0,
      imgH: 0,
      baseScale: 1,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      gesture: 0,
      gStartX: 0,
      gStartY: 0,
      gStartOffsetX: 0,
      gStartOffsetY: 0,
      gStartDist: 0,
      gStartScale: 1,
      gStartMidX: 0,
      gStartMidY: 0,
      ready: false,
      exporting: false
    }
  },
  onLoad() {
    // 取景框 600rpx：rpx 只跟屏宽走，750rpx 就是 windowWidth，换算这一步必须自己做
    const w = (uni.getSystemInfoSync() || {}).windowWidth || 375
    this.framePx = Math.round(w * 600 / 750)
    const src = uni.getStorageSync('avatarCropSrc') || ''
    // 源图读完就删，避免下次进来又拿上一次的临时路径
    if (src) uni.removeStorageSync('avatarCropSrc')
    if (!src) {
      uni.showToast({ title: '没拿到图片，请重新选', icon: 'none', duration: 1500 })
      return
    }
    this.loadImage(src)
  },
  methods: {
    loadImage(src) {
      uni.getImageInfo({
        src: src,
        success: (info) => {
          this.src = src
          this.imgW = info.width || 1
          this.imgH = info.height || 1
          // cover：先铺满取景框，超出的部分靠拖动取舍 —— 一进来就留白的话，不捏合直接点使用会导出两条白边
          this.baseScale = Math.max(this.framePx / this.imgW, this.framePx / this.imgH)
          this.scale = 1
          // cover 下画幅恒大于取景框，起点必须居中：给 0 会贴左上，把右边（或下边）整条默认切掉
          this.offsetX = (this.framePx - this.imgW * this.baseScale) / 2
          this.offsetY = (this.framePx - this.imgH * this.baseScale) / 2
          this.ready = true
          this.redraw()
        },
        fail: () => {
          uni.showToast({ title: '图片读取失败', icon: 'none', duration: 1500 })
        }
      })
    },

    // 位移夹在图片自己的边界里：某一轴画不满就固定居中，画满了最远也只能边贴边
    clampOffset() {
      const f = this.framePx
      const dw = this.imgW * this.baseScale * this.scale
      const dh = this.imgH * this.baseScale * this.scale
      if (dw <= f) this.offsetX = (f - dw) / 2
      else this.offsetX = Math.min(0, Math.max(f - dw, this.offsetX))
      if (dh <= f) this.offsetY = (f - dh) / 2
      else this.offsetY = Math.min(0, Math.max(f - dh, this.offsetY))
    },

    paint(ctx) {
      const c = ctx || uni.createCanvasContext('crop', this)
      const f = this.framePx
      const dw = this.imgW * this.baseScale * this.scale
      const dh = this.imgH * this.baseScale * this.scale
      // canvas 只吃字面量，取值同 --tf-bg
      c.setFillStyle('#fff8ef')
      c.fillRect(0, 0, f, f)
      c.drawImage(this.src, this.offsetX, this.offsetY, dw, dh)
      return c
    },

    redraw() {
      if (!this.ready) return
      this.clampOffset()
      this.paint().draw()
    },

    distance(t) {
      const dx = t[0].clientX - t[1].clientX
      const dy = t[0].clientY - t[1].clientY
      return Math.sqrt(dx * dx + dy * dy)
    },

    onTouchStart(e) {
      const t = (e && e.touches) || []
      if (!t.length) {
        this.gesture = 0
        return
      }
      this.gesture = t.length
      this.gStartX = t[0].clientX
      this.gStartY = t[0].clientY
      this.gStartOffsetX = this.offsetX
      this.gStartOffsetY = this.offsetY
      this.gStartScale = this.scale
      if (t.length > 1) {
        this.gStartDist = this.distance(t) || 1
        this.gStartMidX = (t[0].clientX + t[1].clientX) / 2
        this.gStartMidY = (t[0].clientY + t[1].clientY) / 2
      }
    },

    onTouchMove(e) {
      if (!this.ready) return
      const t = (e && e.touches) || []
      if (!t.length) return
      // 手指从一根变两根（或反过来）时起点已经变了，重设一次再接着算，不然会跳一下
      if (t.length !== this.gesture) {
        this.onTouchStart(e)
        return
      }
      if (t.length > 1) {
        const next = Math.min(3, Math.max(1, this.gStartScale * (this.distance(t) / this.gStartDist)))
        const k = next / this.gStartScale
        const midX = (t[0].clientX + t[1].clientX) / 2
        const midY = (t[0].clientY + t[1].clientY) / 2
        const c = this.framePx / 2
        // 以取景框中心为锚点缩放，再跟手指中点平移，捏哪儿放大哪儿
        this.offsetX = c - k * (c - this.gStartOffsetX) + (midX - this.gStartMidX)
        this.offsetY = c - k * (c - this.gStartOffsetY) + (midY - this.gStartMidY)
        this.scale = next
      } else {
        this.offsetX = this.gStartOffsetX + (t[0].clientX - this.gStartX)
        this.offsetY = this.gStartOffsetY + (t[0].clientY - this.gStartY)
      }
      this.redraw()
    },

    onTouchEnd(e) {
      const t = (e && e.touches) || []
      this.gesture = t.length
      if (t.length) this.onTouchStart(e)
    },

    pickImage() {
      if (this.exporting) return
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const p = (res.tempFilePaths || [])[0]
          if (!p) return
          if (typeof uni.compressImage !== 'function') {
            this.loadImage(p)
            return
          }
          uni.compressImage({
            src: p,
            quality: 70,
            compressedWidth: 512,
            success: (r) => this.loadImage(r.tempFilePath),
            fail: () => this.loadImage(p)
          })
        }
      })
    },

    useImage() {
      if (!this.ready || this.exporting) return
      this.exporting = true
      // 不弹 loading：原生提示层压在 canvas 上时，个别安卓机导出的是一张空白图
      const ctx = this.paint()
      // draw 落到画布是异步的，必须等回调再导，否则截到的是上一帧
      ctx.draw(false, () => {
        setTimeout(() => {
          uni.canvasToTempFilePath({
            canvasId: 'crop',
            x: 0,
            y: 0,
            width: this.framePx,
            height: this.framePx,
            destWidth: 512,
            destHeight: 512,
            fileType: 'jpg',
            quality: 0.9,
            success: (r) => {
              this.exporting = false
              uni.setStorageSync('avatarCropResult', r.tempFilePath)
              uni.navigateBack()
            },
            fail: () => {
              // 导不出来就退回用原图：不能让人白点一次，也让用户出得去裁剪页
              this.exporting = false
              uni.setStorageSync('avatarCropResult', this.src)
              uni.navigateBack()
            }
          }, this)
        }, 60)
      })
    }
  }
}
</script>

<style>
.crop-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--tf-bg);
  color: var(--tf-text);
}
.crop-hint {
  padding: 32rpx 40rpx 24rpx;
  text-align: center;
  font-size: 25rpx;
  line-height: 1.6;
  color: var(--tf-text-2);
}
.crop-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 取景框以外一律压暗，眼睛只需要盯住那个方框 */
  background: rgba(45, 42, 38, 0.86);
}
.crop-frame {
  position: relative;
  overflow: hidden;
  border-radius: var(--tf-r-lg);
  background: var(--tf-card);
}
.crop-canvas {
  display: block;
}
.crop-ring {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  border: 2rpx solid var(--tf-primary);
  border-radius: var(--tf-r-lg);
  pointer-events: none;
}
.crop-bar {
  display: flex;
  flex-direction: row;
  gap: 24rpx;
  padding: 32rpx 40rpx 48rpx;
  background: var(--tf-card);
  border-top: 2rpx solid var(--tf-line);
}
.crop-btn {
  flex: 1;
  height: 92rpx;
  line-height: 92rpx;
  text-align: center;
  font-size: 29rpx;
  font-weight: 600;
  border-radius: var(--tf-r-md);
}
.crop-btn--ghost {
  color: var(--tf-text-2);
  background: var(--tf-bg);
  border: 2rpx solid var(--tf-line);
}
.crop-btn--primary {
  color: #fff;
  background: var(--tf-primary-deep);
}
</style>
