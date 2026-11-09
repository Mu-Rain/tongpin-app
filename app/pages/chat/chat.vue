<template>
  <view class="chat-wrap">
    <!-- 状态栏占位 —— 自定义导航栏后必须自己留出这一块，
         否则顶部内容会被状态栏（时间、电量）压住 -->
    <view class="status-bar" :style="{ height: statusBarHeight + 'px' }" />

    <!-- ===== 顶部会话条（对齐原型 #chatBar） ===== -->
    <view class="chat-bar">
      <!-- ← 返回键：自定义导航栏后没有系统返回箭头了，要自己给一个 -->
      <text class="bar-back" @tap="goBack">‹</text>
      <!-- ★ 点头像/名字进对方主页（仿微信、QQ）。
           为什么要有这个入口：一对人现在可以有多条搭子关系（考研搭子 + 夜跑搭子），
           但只有一个聊天室，消息列表里也只占一行 —— 那些"别的搭子关系"
           在列表里看不见，只能从对方主页里找。 -->
      <view class="bar-left">
        <!-- ★ 只有头像可点进对方主页。
             原来整块 bar-left（头像 + 名字 + 学校 + 标签行）都绑了 goPeer，
             用户想滚动或只是碰了一下名字就跳走了。头像才是"这个人"的象征，
             和微信/QQ 一致；名字区保持静态。 -->
        <image
          v-if="!isAi && avaSrcOf('peer')"
          class="avatar avatar-img ava-fade"
          :class="{ 'ava-fade--in': avaReadyOf('peer') }"
          :src="avaSrcOf('peer')"
          mode="aspectFill"
          @tap="goPeer"
          @load="avaOnLoad('peer')"
          @error="onPeerAvatarError"
        />
        <!-- 头像没拿到/加载失败：留一个空心位，不再用默认笑脸顶替 -->
        <view v-else-if="!isAi" class="avatar avatar-ph" @tap="goPeer" />
        <view v-else class="avatar avatar--orange" @tap="goPeer">AI</view>
        <view class="bar-main">
          <text class="convo-name">{{ isAi ? '情绪引导机器人' : name || '搭子' }}</text>
          <text class="bar-sub">{{
            isAi ? '非医疗建议 · 紧急情况请联系校心理中心' : school || '同频搭子'
          }}</text>
        </view>
      </view>
      <!-- 多搭子：全部标签并排显示。v-for 与 v-if 不能写在同一个元素上 -->
      <template v-if="!isAi && tags.length">
        <text
          v-for="(t, ti) in tags"
          :key="ti"
          class="chat-buddy-tag"
          :style="{ backgroundColor: colorHex(t.color) }"
          >{{ tagText(t.label) }}</text
        >
      </template>
      <text
        v-else-if="!isAi && tag"
        class="chat-buddy-tag"
        :style="{ backgroundColor: colorHex(tagColor) }"
        >{{ tagText(tag) }}</text
      >
      <!-- 连接状态
           ★ 只在**出问题**时才显示。
             之前这里常驻一个绿色的「已连接」——那是给开发者看的调试信息，
             用户看到只会问"这是什么、为什么会有"。正常的网络状态不需要占位，
             坏了才需要提醒。所以：online 什么都不显示，只有 connecting/offline
             才冒出来。判断逻辑在 statusText 计算属性里。 -->
      <text v-if="statusText" class="conn" :class="'conn--' + status">{{ statusText }}</text>
      <!-- 更多菜单（文档 §5）：危险操作收进这里，不在顶栏大声展示 -->
      <text v-if="!isAi" class="bar-more" @tap="showMore = true">⋯</text>
      <!-- 搜索入口已移到「对方主页」（user.vue 的「查找聊天记录」）。
           顶栏这一行已经排了名字、学校、搭子标签、连接状态，
           再插一个放大镜会被挤成小点，也容易被误触。 -->
    </view>

    <!-- ===== 陌生人提示条（契约 §5.1）=====
         只在**曾经是好友、现在已经解除**时置顶提醒：聊天还能继续，但关系已经断了。
         ★ 从来没加过好友的搭子（'none'）不显示 —— 他们本来就不叫"已不是好友"；
           未知（''）也不显示，接口没回来不能冤枉人。
         两个按钮就地给出出路，不让用户自己去翻设置。 -->
    <!-- 文档 §5：文案去宣判感；危险操作不在一级界面大声展示。
         「你们已不是好友」→「你们还未互加好友」（说的是状态，不是判决）；
         「加入黑名单」已收进顶栏「…」菜单，这里只留一个描边的「加为好友」。 -->
    <view v-if="!isAi && peerRelation === 'unfriended'" class="stranger-bar">
      <text class="stranger-text">你们还未互加好友</text>
      <view class="stranger-actions">
        <text class="stranger-btn stranger-btn--ghost" @tap="addFriend">加为好友</text>
      </view>
    </view>

    <!-- ===== 消息区 ===== -->
    <scroll-view
      class="chat-scroll"
      scroll-y
      :scroll-into-view="scrollInto"
      :scroll-with-animation="scrollAnimated"
      :class="{ 'chat-scroll--hidden': !listReady }"
      @scroll="onScroll"
      @touchmove="onUserTakeOver"
      @scrolltoupper="loadOlder"
      upper-threshold="60"
    >
      <view v-if="loading" class="chat-hint">正在加载聊天记录…</view>

      <view v-else-if="!messages.length" class="chat-hint">
        {{ isAi ? '随便说点什么，我在这儿听着。' : '还没有消息，打个招呼吧。' }}
      </view>

      <!-- 上拉加载更早：确实到头了才显示这一行（has_more_before === false） -->
      <view v-if="noMoreBefore && messages.length" class="earlier-end">没有更早的消息了</view>

      <view
          v-for="(m, idx) in messages"
          :key="m.key"
          :id="'msg-' + m.key"
          class="msg-row"
        >
        <!-- 撤回：居中灰字，不显示头像和气泡（契约 §5.1） -->
        <view v-if="m.recalled" class="recall-row">
          <text class="recall-text">{{ m.is_me ? '你撤回了一条消息' : '对方撤回了一条消息' }}</text>
        </view>
        <!-- ★ 长按不绑在这一行上：.bubble-row 是满宽的 flex 行，头像、时间、
             行尾空白都在里面，绑在这儿等于长按整行任意位置都弹菜单。
             热区收窄在下面的 .bubble-hit（只覆盖气泡本体）。 -->
        <view
          v-else
          class="bubble-row"
          :class="{ 'is-me': m.is_me, 'bubble-row--hl': highlightKey === m.key }"
        >
          <!-- ===== 头像：仿 QQ / 抖音，每条消息旁边一个 =====
               自己发的在右边、对方在左边，靠 .is-me 的 flex-direction 反转。 -->
          <view class="msg-avatar" :class="{ 'msg-avatar--me': m.is_me }">
            <image
              v-if="avaSrcOf(m.key)"
              class="msg-avatar-img ava-fade"
              :class="{ 'ava-fade--in': avaReadyOf(m.key) }"
              :src="avaSrcOf(m.key)"
              mode="aspectFill"
              @load="avaOnLoad(m.key)"
              @error="onBubbleAvatarError(m)"
            />
          </view>

          <view class="bubble-col">
            <!-- ★ 好友申请卡片：它本身就是聊天记录里的一条消息，会被新消息冲走 ——
                 状态不存在消息里，渲染时按 fr_request_id 现查（message-list 已补好 fr_* 字段）。 -->
            <view v-if="m.type === 'friend_request'" class="fr-card" :class="'fr-card--' + frState(m)">
              <text class="fr-title">{{ frTitle(m) }}</text>
              <text class="fr-body">{{ frBody(m) }}</text>
              <view v-if="frCanAct(m)" class="fr-actions">
                <button class="fr-btn fr-btn--main" :disabled="frBusy" @tap="onFriendRequest(m, 'accept')">同意</button>
                <button class="fr-btn" :disabled="frBusy" @tap="onFriendRequest(m, 'reject')">拒绝</button>
              </view>
              <view v-else-if="m.fr_status === 'pending'" class="fr-bar">
                <text class="fr-bar-text">{{ frBarText(m) }}</text>
              </view>
            </view>

            <!-- ===== AI 情绪提示（文档 §5）=====
                 后端下发时机由后端决定，前端只负责渲染与关闭。
                 可关闭，不做自动情绪识别的前端逻辑。 -->
            <view
              v-else-if="m.type === 'ai-hint'"
              class="ai-hint"
            >
              <view class="ah-bar" />
              <view class="ah-main">
                <text class="ah-text">{{ m.content }}</text>
                <text class="ah-hint">要不要聊聊？</text>
              </view>
              <text class="ah-close" @tap.stop="dismissAiHint(m)">×</text>
            </view>

            <!-- ★ 长按弹「删除/举报」只绑在下面这一层「气泡本体」上，不再绑外层 .bubble-row：
                 .bubble-row 是满宽的 flex 行（头像 / 时间 / 行尾空白都在里面），
                 绑在它上面等于长按整行任意位置都弹菜单。这一层的宽高恰好等于
                 气泡自己（.bubble-col 是 align-items: flex-start 的纵向 flex），
                 所以头像、时间、行里的空白一律不响应。 -->
            <view
              v-else
              class="bubble-hit"
              @touchstart="onHitStart"
              @touchmove="onHitMove"
              @touchend="onHitEnd"
              @touchcancel="onHitEnd"
              @longpress="onHitLongPress(m)"
            >
              <!-- ★ 图片气泡自适应图片比例（详见 setImgBox）：
                   宽高都由图片原始宽高比算出来，长图把高度封顶、宽度跟着变窄，
                   所以整张图直接显示在气泡里，不必点开才看到全图。
                   mode 用 aspectFit 而不是 widthFix：widthFix 只给宽度，
                   长图会撑到几屏高，一旦算出来的高度有零头就会被容器裁掉。 -->
              <!-- 尺寸未知时先放一个看不见的探针（.bubble-probe）量出原始宽高比，
                   量到之前一个像素都不画 —— 否则就得先用 380×260 的白框占位，
                   那就是"图还没出来先冒出一个固定长宽的白框"。
                   量到之后真正的图片才渲染，且盒子比例与图片完全一致：
                   这种盒子里 aspectFit / aspectFill / scaleToFill 画出来一模一样，
                   所以就算某个端不支持 mode，也不会把人像、全景图裁掉。 -->
              <image
                v-if="m.type === 'image' && m.displayUrl && !m.imgFailed && !hasImgBox(m)"
                class="bubble-probe"
                :src="m.displayUrl"
                mode="widthFix"
                @load="onImgLoad($event, m)"
                @error="onImgError(m)"
              />
              <image
                v-else-if="m.type === 'image' && m.displayUrl && !m.imgFailed"
                class="bubble-img"
                :src="m.thumbUrl || m.displayUrl"
                mode="aspectFit"
                :style="imgStyle(m)"
                @tap="previewImage(m.displayUrl)"
                @error="onImgError(m)"
                @load="onImgLoad($event, m)"
              />
              <view v-else-if="m.type === 'image'" class="bubble-img-ph" @tap="retryImage(m)">
                <text class="bubble-img-ph-text">{{
                  m.imgFailed ? '图片加载失败，点此重试' : '图片加载中…'
                }}</text>
              </view>
              <!-- 语音气泡：点一下播放，正在播时显示另一套图标 -->
              <view v-else-if="m.type === 'voice'" class="bubble bubble--voice" @tap="playVoiceMsg(m)">
                <text class="voice-icon">{{ playingKey === m.key ? '❚❚' : '▶' }}</text>
                <text class="voice-dur">{{ voiceDurText(m) }}</text>
              </view>
              <!-- ===== 结构化卡片（文档 §5）=====
                   把「周六 19:00 · 操场」这种约局确认做成一张小卡片，
                   比纯文本好扫读。数据在 m.meta（JSON 字符串或对象），
                   字段约定见 docs/30-后端交接.md -->
              <view
                v-else-if="m.type === 'structured'"
                class="bubble bubble--card"
                @tap="openStructured(m)"
              >
                <view class="sc-row" v-if="scOf(m).time">
                  <text class="sc-k">时间</text>
                  <text class="sc-v">{{ scOf(m).time }}</text>
                </view>
                <view class="sc-row" v-if="scOf(m).place">
                  <text class="sc-k">地点</text>
                  <text class="sc-v">{{ scOf(m).place }}</text>
                </view>
                <view class="sc-row" v-if="scOf(m).note">
                  <text class="sc-k">备注</text>
                  <text class="sc-v">{{ scOf(m).note }}</text>
                </view>
                <!-- 只给对方的卡按钮：确认/婉拒走 meetup-confirm 落服务端状态，
                     拿到 _meetup_status 之后就撤掉按钮，改显示结论，免得反复改口 -->
                <view class="sc-actions" v-if="!m.is_me">
                  <template v-if="!m._meetup_status">
                    <text
                      class="sc-btn"
                      :class="{ 'sc-btn--off': m._busy }"
                      @tap.stop="confirmStructured(m)"
                      >{{ m._busy ? '确认中…' : '确认' }}</text
                    >
                    <text
                      class="sc-btn sc-btn--ghost"
                      :class="{ 'sc-btn--off': m._busy }"
                      @tap.stop="declineStructured(m)"
                      >再说</text
                    >
                  </template>
                  <text v-else class="sc-status">{{ meetupStatusText(m) }}</text>
                </view>
              </view>
              <!-- ===== 同频圈动态分享卡（m.type === 'share'）=====
                   一条 share 消息不该显示成裸文字：它代表"别人的一条动态"，
                   所以画成一张卡 —— 封面 + 正文两行 + 作者 + 「同频圈动态」角标，
                   点整张卡进动态详情。字段：meta = { post_id, text, cover, owner_name, owner_id }
                   （meta 用 scOf 解析，与上面约局卡片共用同一套兼容逻辑） -->
              <view
                v-else-if="m.type === 'share'"
                class="bubble bubble--share"
                @tap="openShare(m)"
              >
                <!-- 封面只画"能直接访问"的链接（见 shareCover）：纯文字动态 cover 是 ''，
                     这时整块不渲染，卡片就是"角标 + 作者 + 正文"。 -->
                <view v-if="shareCover(m)" class="share-cover-box">
                  <image
                    class="share-cover"
                    :src="shareCover(m)"
                    mode="aspectFill"
                    @error="onShareCoverError(m)"
                  />
                  <text class="share-tag share-tag--overlay">同频圈动态</text>
                </view>
                <view class="share-body">
                  <text v-if="!shareCover(m)" class="share-tag">同频圈动态</text>
                  <text v-if="scOf(m).owner_name" class="share-owner">{{ scOf(m).owner_name }}</text>
                  <text v-if="scOf(m).text" class="share-text">{{ scOf(m).text }}</text>
                </view>
              </view>
              <view v-else class="bubble">
                <text class="bubble-text">{{ m.content }}</text>
              </view>
            </view>
            <text v-if="showBubbleTime(m, idx)" class="bubble-time">{{ m.timeText }}</text>
            <!-- 已读回执：只标我发的最后一条，每行都标既吵又没信息量 -->
            <text v-if="showReadReceipt(m)" class="bubble-read">{{ readReceiptText(m) }}</text>
            <!-- 发送失败：给一个明确的重试入口，不要只弹一下 toast -->
            <text v-if="m.failed" class="bubble-retry" @tap="retry(m)">发送失败，点此重试</text>
          </view>
        </view>
      </view>

      <!-- ★ 底部锚点：进入页面时把 scroll-into-view 直接设成它，
           页面首帧就渲染在底部，而不是先渲染在顶部再滚过去。 -->
      <view v-if="messages.length" id="msg-end" class="chat-end-pad" />
    </scroll-view>

    <!-- ===== 输入区 ===== -->
    <view class="chat-input">
      <text class="pic-btn" @tap="pickImage">🖼</text>
      <!-- 语音：按住说话。用 touchstart/touchend 而不是 longpress ——
           longpress 只是"按久了"，松手后还得再判断一次，反而绕。 -->
      <text
        class="pic-btn mic-btn"
        :class="{ 'mic-btn--on': recording }"
        @touchstart.stop="onMicStart"
        @touchend.stop="onMicEnd"
        @touchcancel.stop="onMicCancel"
        >🎤</text>
      <input
        class="input input--flat"
        v-model="draft"
        placeholder="说点什么…"
        confirm-type="send"
        @confirm="sendText"
        @input="onTyping"
      />
      <button class="btn btn--orange btn--sm" :disabled="sending" @tap="sendText">发送</button>
    </view>

    <!-- ===== 消息搜索弹层（契约 §5.1）=====
         盖在整页之上，关闭后回到原滚动位置 —— 不改 scroll-into-view 就不会丢位置。 -->
    <view v-if="searchOpen" class="search-mask" @tap="closeSearch">
      <view class="search-panel" @tap.stop>
        <view class="search-head">
          <input
            class="search-input"
            v-model="searchKeyword"
            placeholder="搜索聊天记录"
            confirm-type="search"
            focus
            @confirm="doSearch"
          />
          <text class="search-cancel" @tap="closeSearch">取消</text>
        </view>
        <view v-if="searching" class="search-hint">搜索中…</view>
        <view v-else-if="searchKeyword && !searchResults.length" class="search-hint">没有找到相关消息</view>
        <scroll-view v-else scroll-y class="search-list">
          <view v-for="s in searchResults" :key="s._id" class="search-item" @tap="jumpToMessage(s)">
            <image v-if="avaSrcOf('s' + s._id)" class="avatar avatar-img ava-fade" :class="{ 'ava-fade--in': avaReadyOf('s' + s._id) }" :src="avaSrcOf('s' + s._id)" mode="aspectFill" @load="avaOnLoad('s' + s._id)" @error="avaOnError('s' + s._id, s.avatar_url)" />
            <view v-else class="avatar avatar-img" />
            <view class="search-item-body">
              <text class="search-item-text">{{ s.content }}</text>
              <text class="search-item-meta">{{ s.sender_name }} · {{ fmtBubbleTime(s.created_at) }}</text>
            </view>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 情绪机器人：只做情绪引导，不做诊断，这句话必须一直在 -->
    <view v-if="isAi" class="ai-note">
      <text class="ai-note-text">AI 不是心理咨询师，也不能替代专业帮助。如有紧急情况请立刻联系校心理中心或拨打当地急救电话。</text>
    </view>
    <!-- ===== 顶栏「…」更多菜单（文档 §5）=====
         危险操作（加入黑名单）收在这里，不在顶栏用红色按钮大声展示。 -->
    <view v-if="showMore" class="more-mask" @tap="showMore = false">
      <view class="more-sheet" @tap.stop>
        <view class="more-item" @tap="showMore = false; goPeer()">查看对方主页</view>
        <view class="more-item more-item--danger" @tap="showMore = false; blockPeer()">加入黑名单</view>
        <view class="more-item more-item--cancel" @tap="showMore = false">取消</view>
      </view>
    </view>
  </view>
</template>

<script>
import { createChatTransport } from '@/common/chat/transport.js'
import { getImageUrl, putImageUrls, invalidateImageUrl } from '@/common/chat/imageCache.js'
import { getLocalImage, ensureLocalImage, forgetLocalImage } from '@/common/chat/imageFile.js'
import { MAX_VOICE_SEC, isRecordSupported, startRecord, stopRecord, abortRecord, playVoice, stopVoice, destroyVoice } from '@/common/chat/voice.js'
import track from '@/utils/track.js'
import { avatarFadeMixin } from '@/common/avatar/avatarCache.js'

/** 契约 D4：撤回窗口 2 分钟。只在 methods 里用，不进模板 */
const RECALL_WINDOW_MS = 120000

const TAG_COLORS = {
  'shine-yellow': '#ffde00',
  'shine-orange': '#ff4d00',
  'shine-rose': '#ff5fa2',
  'shine-violet': '#a855f7',
  'shine-cyan': '#22d3ee',
  'shine-mint': '#34d399',
  'shine-blue': '#3b82f6',
  'shine-gold': '#e9c46a'
}

const STATUS_TEXT = {
  connecting: '连接中',
  online: '已连接',
  offline: '重连中'
}

/**
 * 图片气泡的尺寸约束（rpx）。
 *
 * ★ 目标：进来就看见整张图，不用先点开预览。
 *   - 常规横图 / 方图：按 380rpx 宽等比缩，和原来的观感一致；
 *   - 很长的图（长截图）：高度封顶 640rpx（约半屏），宽度跟着比例变窄 ——
 *     气泡是"自适应图片"，不是固定 380rpx 宽再让长图撑出几屏高；
 *   - 很小的图（表情 / 图标）：不放大到 380，按原像素等比显示，避免糊。
 */
const IMG_MAX_W = 380
const IMG_MAX_H = 640
// 极长图（比如 1:8 的长截图）高度封顶后宽度会很窄，给个下限只为了气泡还点得中。
// 渲染用 mode="aspectFit"，缩到多窄都是整张图，永远不会被裁。
const IMG_MIN_W = 96
// 尺寸还没算出来（图片还没 load）时的占位：沿用原来 380×260 的观感
const IMG_PLACEHOLDER_W = 380
const IMG_PLACEHOLDER_H = 260

/* ==================== 消息窗口（DOM 上界）====================
   聊天页的 v-for 是全量渲染：翻几十屏之后 DOM 节点线性增长，滚动开始掉帧。
   这里不做"虚拟列表"（scroll-view 拿不到每行真实高度，硬做必然跳位），
   而是做**数据窗口**：只在「用户贴着底部」时把最旧的若干条从数组头部丢掉。
   为什么这样安全：
     · 贴底时顶部被裁掉，可视区底部不动，滚动位置天然不变；
     · 用户上翻历史时（autoStick=false）绝不裁，所以不会把他正在看的内容抽走；
     · 丢掉的历史还能再用 loadOlder 从服务端拉回来（beforeMessageId 用当前最旧一条）。
   代价：内存里最多保留 MAX_KEEP 条，更早的要重新拉一次（有网络成本，但不丢功能）。 */
const MAX_KEEP = 200
const TRIM_BATCH = 80

/**
 * 把各端上传回来的 fileID 统一成 cloud:// 形式。
 * 阿里云 uploadFile 返回的是 https://xxx 直链，支付宝云/腾讯云返回的本来就是 cloud://。
 * 统一成 cloud:// 之后，渲染层只需要判断一次"是不是 cloud 协议"，
 * 不用到处区分平台（这些函数将来抽到 common/ 里给同频圈、头像复用）。
 */
function toCloudFileID(fileID) {
  if (!fileID) return ''
  return String(fileID)
}

/** 判断这个地址是不是需要换成临时 URL 的 cloud:// fileID */
function isCloudFileID(val) {
  return typeof val === 'string' && val.indexOf('cloud://') === 0
}

/* 缩略图的 fileID 约定：原图 xxx.jpg 旁边存一张 xxx_t.jpg。
   为什么用命名约定而不是消息字段：
     · 老消息没有这个字段，走约定可以直接"有没有"自愈，服务端零改动；
     · 分享/转发/历史记录都不用改契约；
     · 找不到 _t 文件时换链接会失败，客户端自动回退原图（见 resolveThumbs）。
   只对我们自己上传的 .jpg 生效，其它形态一律返回空串。 */
function thumbIdOf(fileID) {
  if (!isCloudFileID(fileID)) return ''
  if (fileID.indexOf('/chat/') < 0 && fileID.indexOf('chat/') < 0) return ''
  if (!/\.jpg$/.test(fileID)) return ''
  return fileID.replace(/\.jpg$/, '_t.jpg')
}

export default {
  mixins: [avatarFadeMixin],
  data() {
    return {
      conversationId: '',
      // 顶栏「…」更多菜单（文档 §5：危险操作收进来）
      showMore: false,
      // 对方 user id，用来点头像进主页
      peerId: '',
      // 对方头像（http 链接，由消息列表换链后经 query 传来；空则顶栏留空心位，不落默认头像图，也不用昵称首字）
      peerAvatar: '',
      // 本机账号自己的头像（已换成可访问链接），用于自己那条气泡
      myAvatar: '',
      // 顶部头像加载失败（临时链接过期 / 文件被删）→ 不再重试，直接落空位
      peerAvatarFailed: false,
      // 有没有单独向 user-profile 要过对方头像（只补一次，避免死循环）
      peerAvatarFetched: false,
      // 补拉次数上限：失败一次就够了，别把接口当轮询用
      peerAvatarTries: 0,
      name: '',
      school: '',
      tag: '',
      tagColor: '',
      // 多搭子：这一对人之间的全部标签（合成一行显示）
      tags: [],

      messages: [],
      // 长按判定：按下时的坐标 + 是否已经滑走（见 onHitStart / onHitMove）。
      // 放在 data 里而不是实例属性——Vue 不代理 _ 开头的 data 键，用实名字段最省事。
      hitFrom: null,
      hitMoved: false,
      draft: '',
      loading: true,
      // ★ 上拉加载更早历史：请求并发锁 + 「确实没有更早的了」
      //   （服务端 has_more_before === false 才把 noMoreBefore 置 true）
      loadingOlder: false,
      noMoreBefore: false,
      // 本地快照落盘的 debounce 定时器（见 scheduleSnapshot / writeSnapshot）
      snapTimer: null,
      sending: false,
      status: 'connecting',
      scrollInto: '',
      // ★ 首帧不显示消息区：scroll-view 的初始滚动位置永远是顶部，
      //   scroll-into-view 要等内容渲染完才生效 —— 也就是说"第一帧在顶部"是
      //   scroll-view 的固有行为，改锚点参数救不回来。
      //   这里在锚定完成前把消息区隐藏（不透明），锚好之后再淡入，
      //   用户看到的第一眼就已经在底部，不会看到"先露一屏再跳下去"。
      listReady: false,
      // ★ 进入页面首次定位不开动画：设一次锚点直接落到底部，
      //   用户看到的第一帧就在最下面，不会出现从顶部滚下来的过程。
      //   之后的新消息跟随仍然带动画。
      scrollAnimated: false,
      // 首次定位是否已做过（只在第一次拉到消息时做一次）
      firstAnchorDone: false,
      // 首帧锚底的时间点：用于「首屏尺寸稳定前补锚」的时间窗判断（见 scheduleFirstSettle）
      firstAnchorAt: 0,
      // 消息区已经排过放出流程（只走一次，避免锚底/补锚反复触发）
      revealScheduled: false,
      // 「等图片量完」的硬上限兜底计时器（见 maybeReveal）
      revealCapTimer: null,
      // 见 scrollToEnd：滚完之后要把 scroll-into-view 复位，否则布局一变就再滚一次
      scrollResetTimer: null,
      // 本次 mergeMessages 是否真的新增了消息。
      // 轮询每 3 秒回调一次，但绝大多数轮次没有新消息；
      // 只有真的来了新消息才值得自动滚到底，否则图片回填、高度微调都会把用户拽下去。
      mergedNewCount: 0,
      // 好友申请卡片「同意 / 拒绝」的并发锁：连点两次会发两次请求
      frBusy: false,
      frRefreshing: false,
      frRefreshAt: 0,
      // ★ 是否继续"跟随底部"。
      //   进页面为 true；用户主动往上翻历史后置 false，滚回底部再置回 true。
      //   图片加载完把气泡撑高时，只有它为 true 才重新贴底 ——
      //   否则用户正在看上面的历史，会被一张刚加载完的图一路拽到最下面。
      autoStick: true,
      // ★ 程序滚动锁（ms 时间戳）。
      //   我们自己设 scroll-into-view 触发的滚动同样会回调 onScroll，
      //   而滚动过程中 scrollTop 还没到位，会被误判成"用户往上翻了"，
      //   于是 autoStick 被错误关掉、后面图片加载完就再也不贴底。
      //   在这个时刻之前，onScroll 不修改 autoStick。
      stickLockUntil: 0,
      // ★ 用户在首屏时间窗里主动拖过消息区（见 onUserTakeOver）。
      //   一旦为真，「补锚」和「等图片量完再放出」必须立刻停手 ——
      //   否则用户刚往上一滑就被我们拽回底部，体感就是「进聊天页 1~2 秒内不能往上滑」。
      userTookOver: false,
      // 首屏补锚挂的定时器（scheduleFirstSettle），用户接管时要能一次清掉
      settleTimers: [],
      // 图片加载完补贴的合并定时器：一屏十张图会连续触发十次，
      // 合并成"最后一张加载完再滚一次"，既不会滚十遍，也不会漏掉最后的高度变化。
      imgStickTimer: null,
      // fileID → 临时 URL 的缓存（一轮会话内的内存加速层）。
      //   持久的那一份在 common/chat/imageCache.js（落本地存储），
      //   切页面 / 杀 App 重进都能直接命中，不必重新换链接。
      //   轮询每 3 秒回来一次，没有内存层会反复请求。
      urlCache: {},
      // 自定义导航栏：状态栏高度（px），把 content 顶到安全区下面
      statusBarHeight: 0,
      // 屏幕逻辑宽（px）。把图片原始像素换算成 rpx 要用它，否则不同机型算出来的尺寸不一致
      winW: 375,
      // 图片气泡的实际尺寸（rpx），key 是图片的 displayUrl 而不是消息 key。
      //   ★ 为什么按 URL：mergeMessages 会在服务端回包到达时把本地气泡的 key
      //     从 clientMsgId 换成服务端 _id，按消息 key 存的话刚算好的尺寸就丢了，
      //     而 <image> 的 src 没变、load 不会重发，气泡会一直卡在占位高度。
      //   { w, h } 由图片自身宽高比算出，见 setImgBox。
      imgBox: {},

      // ===== 聊天增强（契约 §5.1）=====
      // 我和对方的关系，三态 + 未知：
      //   'friend'     现在是好友
      //   'unfriended' 当过好友、现在已经解除
      //   'none'       从来不是好友（纯搭子关系就落在这一态）
      //   ''           未知：接口失败 / 字段缺失，绝不当成任何一态用
      // ★ 为什么不用 is_friend：friendships 没有 status 字段，解除好友是把关系行删掉，
      //   光看 is_friend:false 分不清"从来不是好友"和"当过好友又解除" —— 三态只能云函数给。
      peerRelation: '',
      // 对方的已读游标（message-list 返回的 peer_last_read_message_id）
      peerLastReadId: '',
      // 搜索弹层
      searchOpen: false,
      searchKeyword: '',
      searchResults: [],
      searching: false,
      // 点搜索结果跳转后高亮的那条（key），1.5 秒后自动清空
      highlightKey: '',
      highlightTimer: null,
      // 正在播放的语音气泡 key（同时只播一条）
      playingKey: '',
      // 是否正在录音（按住麦克风）
      recording: false,
      // 录音开始时间戳：松手时算时长，用于 1 秒以内的误触判断
      recordStartAt: 0,
      // 已读回执的节流时间戳（见 refreshPeerRead）
      peerReadAt: 0
    }
  },

  computed: {
    isAi() {
      return this.conversationId === 'ai'
    },

    /**
     * 聊天页顶部的对方头像。
     *
     * 优先用入口页传来的（消息列表 → query），没有就从聊天记录里捞一条对方消息的头像。
     * 为什么要兜这一层：消息列表的 avatar 和消息里的 sender_avatar 是两个接口，
     * 老账号的「头像只存在 avatar_url 里」那个 bug 修好之前/之后，
     * 任何一边取不到都不该让顶部变成默认头像 —— 头像就在聊天记录里躺着。
     */
    displayPeerAvatar() {
      if (this.peerAvatarFailed) return ''
      if (this.peerAvatar) return this.peerAvatar
      const list = this.messages || []
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i]
        if (m && !m.is_me && m.sender_avatar) return m.sender_avatar
      }
      return ''
    },
    /** 我发出的最后一条（未撤回）消息的 key。已读回执只标这一条 */
    lastMineMsgKey() {
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i]
        if (m.is_me && !m.recalled) return m.key
      }
      return ''
    },
    statusText() {
      // ★ 只有异常状态才返回文字，正常在线返回空串（模板 v-if 会把它藏起来）。
      //   一个常驻的"已连接"对用户没有信息量，反而像报错。
      const s = this.status
      if (s === 'online') return ''
      return STATUS_TEXT[s] || ''
    }
  },

  /* 头像绑定。三种来源（顶栏对方 / 我的 / 每条消息自带的）都要走同一套本地落盘 + 淡入：
     - 顶栏用一个固定 key ('peer')；气泡按消息自己的 m.key，一条就绪不会带动整屏；
     - messages 用 deep：列表会整批替换，也可能只是尾部追加一条；
     - displayPeerAvatar / myAvatar 单独 watch：对方消息没带 sender_avatar 时借的就是这两张。 */
  watch: {
    displayPeerAvatar: {
      immediate: true,
      handler(v) {
        this.avaBind('peer', v)
        this.syncBubbleAvatars()
      }
    },
    myAvatar: {
      immediate: true,
      handler() {
        this.syncBubbleAvatars()
      }
    },
    messages: {
      immediate: true,
      deep: true,
      handler() {
        this.syncBubbleAvatars()
      }
    }
  },
  onLoad(options) {
    this.conversationId = (options && options.conversation_id) || ''
    // 对方 user id：用来进对方主页。老入口没传就留空，点头像时再兜
    this.peerId = (options && options.peer_id) || ''
    this.name = decodeURIComponent((options && options.name) || '')
    this.peerAvatar = decodeURIComponent((options && options.avatar) || '')
    // 入口没传头像 → 自己按 peer_id 要一次，不依赖消息列表那边给得对不对。
    // 传了就先不请求：user-profile 不便宜（还要查关系/黑名单），
    // 真加载不出来时 onPeerAvatarError 会补这一次。
    if (!this.peerAvatar) this.ensurePeerAvatar()
    this.loadMyAvatar()
    // 兜底：空会话（没有 msg-end 元素）或锚点异常时，1.2 秒后也要把消息区放出来，
    // 否则用户会一直看着一块空白。
    const self = this
    setTimeout(function () {
      self.listReady = true
    }, 2000)
    this.school = decodeURIComponent((options && options.school) || '')
    this.tag = decodeURIComponent((options && options.tag) || '')
    this.tagColor = decodeURIComponent((options && options.color) || '')
    // ★ 多搭子：同一对人可能有多段关系（自习搭子 + 夜跑搭子），
    //   入口页可以把全部标签用逗号拼起来传进来，这里拆成数组全显示。
    //   老入口只传 tag/color 一个，就自动降级成单标签。
    const tagsRaw = decodeURIComponent((options && options.tags) || '')

    // ★ 自定义导航栏：拿到状态栏高度，把顶部内容顶到安全区下面。
    //   为什么不用系统导航栏：系统栏会占掉一整行，只能写一个静态标题（比如"聊天"），
    //   而这一行对我们完全没用（对方名字、标签已经在下面显示），还白白把内容往下推。
    try {
      const sys = uni.getSystemInfoSync()
      this.statusBarHeight = sys.statusBarHeight || 0
      this.winW = sys.windowWidth || 375
    } catch (e) {
      this.statusBarHeight = 0
    }
    if (tagsRaw) {
      this.tags = tagsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const parts = pair.split('|')
          return { label: parts[0] || '', color: parts[1] || '' }
        })
        .filter((t) => t.label)
    } else if (this.tag) {
      this.tags = [{ label: this.tag, color: this.tagColor }]
    }

    if (this.isAi) {
      // 情绪机器人还没接（第 6 天之后），先把话说清楚，别让用户以为坏了
      this.loading = false
      this.messages = [
        {
          key: 'ai-0',
          is_me: false,
          type: 'text',
          content: '情绪引导机器人还没接入（排在聊天之后）。这里将来是一个简单的情绪引导对话，不做诊断、不做量表。',
          timeText: '',
          failed: false
        }
      ]
      return
    }

    if (!this.conversationId) {
      uni.showToast({ title: '会话参数缺失', icon: 'none' })
      this.loading = false
      return
    }

    // ★ 秒开：先用本地快照把上次的最近 40 条画出来，用户立刻看到内容；
    //   transport 首轮到货后照常由 mergeMessages 合并（_id / clientMsgId 去重，逻辑没动）。
    this.restoreSnapshot()
    // 快照是 800ms 前写的，可能还留着刚删的那条：恢复后立刻清一遍
    this.pruneHidden()
    this.autoSaveDraft()
    // 关系状态决定顶部提示条显不显示。异步、失败静默：
    // 拿不到就当"未知"（peerRelation 保持空串），聊天功能一点不受影响。
    this.loadPeerRelation()

    // 从对方主页的「查找聊天记录」进来：一打开就弹出搜索层。
    if (options && options.search === '1') this.openSearch()
  },

  onShow() {
    // onLoad 只跑一次，从系统通知栏点进来时 onShow 会再次触发，这里补一次 start
    if (this.isAi || !this.conversationId) return
    if (this.chat) this.chat.start()
    // ★ 关系会变：去对方主页解了好友再退回来，提示条和搭子标签必须跟着变。
    //   导航参数里的 tag 只是进页面那一刻的快照，不刷新就永远挂着已经解除的标签。
    this.loadPeerRelation()
    // ★ 回到页面立刻按缓存补一次图片链接。
    //   命中的是本地存储里的缓存，不发请求，所以切回来时图片是秒出的；
    //   只有真的没缓存过的那几张才会去换链接。
    this.resolveFileURLs()
    // share 卡片的封面也走"cloud:// 换临时链接"，与图片气泡同一套（见 resolveShareCovers）
    this.resolveShareCovers()
    // 从后台切回来补刷一次好友申请卡片：停轮询期间对方可能已经同意了。
    // 清掉节流时间戳，保证这次是真的去问一次，不被节流吞掉。
    this.frRefreshAt = 0
    this.refreshFriendRequestStates()
  },

  onHide() {
    // ★ 退到后台前同步写一次快照（不等 debounce）：下次进页面就靠它秒开
    this.flushSnapshot()
    // 退到后台就停止轮询：省电、省免费额度
    if (this.chat) this.chat.stop()
    // 切走时语音必须停：否则微信都退到后台了还在念聊天记录
    this.stopPlayVoice()
    // 录音同理：切走后松手事件收不到，录音会一直开着
    if (this.recording) {
      this.recording = false
      abortRecord()
    }
  },

  onUnload() {
    this.clearSettleTimers()
    // ★ 页面销毁也要落一次：用户多半是直接返回，而不是切后台
    this.flushSnapshot()
    // 必须停：否则定时器会一直跑，页面已经没了还在请求
    if (this.chat) this.chat.stop()
    this.chat = null
    if (this.scrollResetTimer) {
      clearTimeout(this.scrollResetTimer)
      this.scrollResetTimer = null
    }
    if (this.imgStickTimer) {
      clearTimeout(this.imgStickTimer)
      this.imgStickTimer = null
    }
    if (this.highlightTimer) {
      clearTimeout(this.highlightTimer)
      this.highlightTimer = null
    }
    // 播放器与录音器都是全局单例，页面销毁必须一起收掉，
    // 否则下次进聊天页会拿到绑着旧回调的实例（按住麦克风没反应）。
    destroyVoice()
    this.recording = false
  },

  methods: {
    /**
     * 当前登录用户的 id。
     * 登录/注册/自动登录存的是 userInfo = 云函数返回的 user 对象，
     * 里面带 _id —— 用它来区分本地缓存归属，避免同一台手机切账号时串号。
     */
    myUid() {
      // ★ 不能一次性缓存：冷启动时 userInfo 可能还没写进来，一旦缓存成 'anon'，
      //   后面所有「是不是我发的」判断都会错 —— 自己的消息会被画到对方那侧，
      //   顶部对方头像还会从自己发的消息里捞到自己的头像。
      //   每次读 storage 代价很小（同步读），只在真的变了才更新缓存。
      const u = uni.getStorageSync('userInfo') || {}
      const id = u._id || u.id || 'anon'
      if (this._uid !== id) this._uid = id
      return id
    },

    /* ==================== 本机删除黑名单 ====================
       删除只在本机生效（不调云函数，对方无感），所以必须自己记一份黑名单：
       否则下一轮 3 秒轮询会把同一条消息原样推回来 ——
       这就是「删掉的气泡过一会儿又冒出来」的根因。
       按 <uid>_<conversationId> 分键：切号、换会话互不干扰；上限 300 条，超了丢最旧的。 */
    delKey() {
      return 'chat_del_v1_' + this.myUid() + '_' + this.conversationId
    },

    loadHidden() {
      if (this._hidden) return this._hidden
      let arr = []
      try {
        arr = uni.getStorageSync(this.delKey()) || []
      } catch (e) {
        arr = []
      }
      const map = {}
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) {
          if (arr[i]) map[arr[i]] = true
        }
      }
      this._hidden = map
      return map
    },

    markHidden(id) {
      if (!id) return
      const map = this.loadHidden()
      if (map[id]) return
      map[id] = true
      const ids = Object.keys(map)
      if (ids.length > 300) {
        const drop = ids.slice(0, ids.length - 300)
        for (let i = 0; i < drop.length; i++) delete map[drop[i]]
      }
      try {
        uni.setStorageSync(this.delKey(), Object.keys(map))
      } catch (e) {
        // 写不进去最多是下次进页面又冒出来一条，不影响聊天本身
      }
    },

    /* 把已经删掉的消息从当前数组里剔除。
       为什么要单独一步：删除是纯本机的，服务端永远还会下发它；
       只要有任何一条路径把消息塞回 this.messages（轮询合并 / 快照恢复 / 上拉历史），
       这里就统一清掉，不依赖每条路径各自判断。 */
    pruneHidden() {
      const map = this.loadHidden()
      const ids = Object.keys(map)
      if (!ids.length || !this.messages.length) return
      const kept = this.messages.filter(function (m) {
        if (m._id && map[m._id]) return false
        if (m.clientMsgId && map[m.clientMsgId]) return false
        return true
      })
      if (kept.length !== this.messages.length) this.messages = kept
    },

    /* 贴底时裁掉最旧的消息，把 DOM 数量压回 MAX_KEEP 以内（见常量区说明）。
       两个前提缺一不可：
         · autoStick —— 用户正在跟随底部，裁顶部不会改变他眼前的画面；
         · 不在上拉加载中 —— 否则会把 loadOlder 刚插进来的历史立刻裁掉，白拉一次。 */
    trimOldMessages() {
      if (!this.autoStick || this.loadingOlder) return
      if (this.messages.length <= MAX_KEEP) return
      const drop = this.messages.length - MAX_KEEP + TRIM_BATCH
      if (drop <= 0) return
      this.messages = this.messages.slice(drop)
      // 裁完立刻锚回底部：顶部少了几十条会把内容整体上移，不锚会看到"页面往上窜"
      this.anchorBottomNoAnimation()
    },

    /** 返回上一页。自定义导航栏后没有系统返回箭头，必须自己实现。
     *  从通知栏/分享直接进来时页面栈只有一层，退不回去就 reLaunch 到首页，
     *  否则点了没反应，用户会以为卡死。 */
    /* ==================== 结构化卡片（骨架，文档 §5）====================
       数据格式约定见 docs/30-后端交接.md：
         m.type = 'structured'
         m.meta = { time: '周六 19:00', place: '南湖操场', note: '带水' }
       meta 可能是 JSON 字符串（数据库存 String）也可能是对象，两种都兼容。
       ================================================================= */
    scOf(m) {
      const raw = m.meta
      if (!raw) return {}
      if (typeof raw === 'object') return raw
      try {
        return JSON.parse(raw)
      } catch (e) {
        return {}
      }
    },

    /* 点卡片：暂时只把地点回显出来。场地库还没建，venue_id 无处可跳 */
    openStructured(m) {
      const d = this.scOf(m)
      if (!d.place) return
      // TODO(后端)：暂无场地库，venue_id 暂不跳转
      uni.showToast({ title: d.place, icon: 'none' })
    },

    /* ==================== 同频圈动态分享卡（m.type === 'share'）====================
       数据格式（云函数侧同步在写，字段名固定）：
         m.meta = { post_id, text, cover, owner_name, owner_id }，m.content 也等于 post_id
       cover 可能是 https 临时链接、cloud:// fileID，或者 ''（纯文字动态）。
       ================================================================= */

    /* 封面地址：只把「已经能直接访问」的链接交给 <image>。
       cloud:// fileID 直接当 src 是白框，所以：
         · http / data: / blob: 开头 —— 直接用
         · cloud:// —— 用 resolveShareCovers 换好、挂在 m.coverUrl 上的临时链接；
                       还没换好（或换失败）就返回 ''，当作"没有封面"
         · 其它（含空串）—— 返回 ''，模板不渲染图片块 */
    shareCover(m) {
      // ★ 补回来的新链接优先。meta.cover 里存的是发送那一刻的临时链接（约 2 小时失效），
      //   一旦 refreshShareCover 换到了新链接就必须用新的；
      //   以前这里先返回 meta 里的 https 原值，补链等于白补，卡片永远加载那张死链。
      if (m.coverUrl) return m.coverUrl
      // 确认过这条动态没有图（纯文字动态）：直接走文字卡，别再去试那张死链
      if (m.coverNoImage) return ''
      const c = this.scOf(m).cover
      if (!c) return ''
      const s = String(c)
      if (m.coverFailed) return ''
      if (s.indexOf('http') === 0 || s.indexOf('data:') === 0 || s.indexOf('blob:') === 0) {
        return s
      }
      // cloud:// 还没换好 → 当作没有封面，等 resolveShareCovers 换上
      return ''
    },

    /* 点整张卡 → 动态详情。post_id 为空（老消息 / 纯文字转发）时什么都不做：
       这里刻意不弹 toast —— 点了没反应，比弹一个"暂无"更像"这张卡不是入口"。 */
    openShare(m) {
      const pid = this.scOf(m).post_id
      if (!pid) return
      uni.navigateTo({ url: '/pages/post-detail/post-detail?id=' + pid })
    },

    /**
     * share 封面的 cloud:// → 临时链接。
     * 和图片消息同一个坑（fileID 直接塞给 <image> 就是白框），所以复用同一份链接缓存：
     * 查询顺序是「内存 urlCache → imageCache 落盘的那份 → 才发一次 getTempFileURL」，
     * 换到的链接也写回同一个缓存，下次进页面不再请求。
     * 换链接失败就保持"无封面"，绝不把 fileID 落到 src 上。
     */
    async resolveShareCovers() {
      const self = this
      const pending = self.messages.filter(function (m) {
        return m.type === 'share' && !m.coverResolved && isCloudFileID(self.scOf(m).cover)
      })
      if (!pending.length) return

      const needFetch = []
      pending.forEach(function (m) {
        const id = String(self.scOf(m).cover)
        const hit = self.urlCache[id] || getImageUrl(id)
        if (hit) {
          self.urlCache[id] = hit
          // Vue3（manifest vueVersion=3）下往消息对象上新增属性本身响应式，直接赋值即可
          m.coverUrl = hit
          m.coverResolved = true
        } else {
          needFetch.push(id)
        }
      })

      if (needFetch.length) {
        // 去重：同一张封面转发多次时只问一次
        const uniq = needFetch.filter(function (v, i, arr) {
          return arr.indexOf(v) === i
        })
        const saved = {}
        try {
          const res = await uniCloud.getTempFileURL({ fileList: uniq })
          const list = (res && res.fileList) || []
          list.forEach(function (item) {
            const id = item.fileID
            const url = item.tempFileURL
            // fileID 无效时 SDK 会把 tempFileURL 填回原 fileID，这种要丢掉
            if (id && url && url !== id) {
              self.urlCache[id] = url
              self.$set(self.urlCache, id, url)
              saved[id] = url
            }
          })
        } catch (e) {
          // 换链接失败不该让整个聊天页崩掉：这张卡退化成"无封面"
          console.warn('[chat] share 封面换链接失败', e)
        }
        if (Object.keys(saved).length) putImageUrls(saved)
      }

      pending.forEach(function (m) {
        const id = String(self.scOf(m).cover)
        const url = self.urlCache[id]
        if (url) {
          m.coverUrl = url
          m.coverResolved = true
        }
      })
    },

    /* 主动补封面：不能只等 <image> 的 @error。
       老消息的 meta.cover 是 2 小时就失效的临时链接，很多端加载死链时
       根本不回调 error（也有被缓存成 403 的），结果就是「有的卡能显示、有的永远白着」。
       做法：只要这条 share 的封面是 http（可能已过期）或为空，就按 post_id 补一次；
       补链本身有 20 分钟 storage 缓存、同 id 并发去重、每页 12 条上限（见 refreshShareCover）。 */
    ensureShareCovers() {
      const self = this
      if (this.shareCoverTimer) return
      this.shareCoverTimer = setTimeout(function () {
        self.shareCoverTimer = null
        const list = self.messages.filter(function (m) {
          if (m.type !== 'share' || m.coverChecked) return false
          const pid = self.scOf(m).post_id
          if (!pid) return false
          const c = String(self.scOf(m).cover || '')
          return !c || c.indexOf('http') === 0
        })
        if (!list.length) return
        list.slice(0, 12).forEach(function (m) {
          m.coverChecked = true
          self.refreshShareCover(m)
        })
      }, 300)
    },

    /* 分享卡封面加载失败 —— 两种情况：
         ①meta.cover 是发送那一刻换好的临时链接，2 小时后必然失效（最常见）；
         ②文件被删。
       共同点是「这条消息本身还在」，所以不能让它变成 260rpx 的空白块：
       先把 coverFailed 置真（模板立刻退化成「角标 + 作者 + 正文」的文字卡），
       再按 post_id 去动态详情里要一次新的图片链接补回来。 */
    onShareCoverError(m) {
      const pid = this.scOf(m).post_id
      if (m.coverRetried) {
        // 已经补过一次还是加载不出来（文件被删 / 缓存里那条链接也过期）：
        // 永久退回文字卡，并把本机缓存丢掉，下次进页面重新取一次
        m.coverFailed = true
        if (pid) {
          try {
            uni.removeStorageSync('share_cover_v1_' + pid)
          } catch (e) {
            // 忽略
          }
        }
        return
      }
      m.coverRetried = true
      m.coverFailed = true
      this.refreshShareCover(m)
    },

    /* 按 post_id 重新取一次封面。
       成本控制三件事：
         · 结果写 storage（share_cover_v1_<post_id>，20 分钟内复用）—— 反复进出聊天不重复请求；
         · 同一个 post_id 并发只发一次（this.shareCoverBusy）；
         · 每次进页面最多补 4 张（this.shareCoverQuota），别让一屏老消息把接口当轮询用。 */
    async refreshShareCover(m) {
      const pid = this.scOf(m).post_id
      if (!pid) return
      const key = 'share_cover_v1_' + pid
      try {
        const cached = uni.getStorageSync(key)
        if (cached && cached.url && Date.now() - (cached.at || 0) < 20 * 60 * 1000) {
          m.coverUrl = cached.url
          m.coverFailed = false
          return
        }
      } catch (e) {
        // storage 读不到就当没缓存
      }
      if (!this.shareCoverBusy) this.shareCoverBusy = {}
      if (this.shareCoverBusy[pid]) return
      if (typeof this.shareCoverQuota !== 'number') this.shareCoverQuota = 12
      if (this.shareCoverQuota <= 0) return
      this.shareCoverBusy[pid] = true
      this.shareCoverQuota = this.shareCoverQuota - 1
      try {
        const token = uni.getStorageSync('token') || ''
        const res = await uniCloud.callFunction({
          name: 'post-detail',
          data: { token: token, post_id: pid }
        })
        const r = (res && res.result) || {}
        if (r.code !== 0) console.warn('[chat] 分享封面补链：post-detail 返回', r.code, r.msg)
        const post = r.code === 0 && r.data ? r.data.post : null
        const arr = post && Array.isArray(post.images) ? post.images.filter(Boolean) : []
        const url = arr.length ? String(arr[0]) : ''
        if (!url) {
          // 这条动态确实没有配图（纯文字）：记下来，别再拿那条死链反复试
          m.coverNoImage = true
          m.coverFailed = false
          return
        }
        if (url) {
          m.coverUrl = url
          m.coverNoImage = false
          m.coverFailed = false
          try {
            uni.setStorageSync(key, { url: url, at: Date.now() })
          } catch (e) {
            // 写不进去就算了，下次再取
          }
        }
      } catch (e) {
        // 不弹窗（一屏可能有好几张卡），但要在控制台留痕，方便定位是接口问题还是没图
        console.warn('[chat] 分享封面补链失败', pid, e && e.message)
      } finally {
        this.shareCoverBusy[pid] = false
      }
    },

    /* 约局状态 → 一句人话。_meetup_status 只活在本页内存（不落库），
       重进页面以服务端卡片记录为准，所以这里不缓存到 storage */
    meetupStatusText(m) {
      const s = m._meetup_status
      if (s === 'declined') return '已婉拒'
      if (s === 'both_confirmed') return '双方都确认了'
      return '已确认，等对方'
    },

    /* 确认约局：走 meetup-confirm 把状态落到服务端。
       原来是发一条普通文本回执 —— 字发出去了，约局状态却没落地，
       两边都说不清到底算不算约成，所以换成接口。 */
    async confirmStructured(m) {
      // 已确认或正在请求就别再打：连点会把状态来回打乱
      if (m._busy || m._meetup_status) return
      if (!m._id) {
        uni.showToast({ title: '这张卡还没同步好，稍后再试', icon: 'none' })
        return
      }
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
        return
      }
      m._busy = true
      try {
        const res = await uniCloud.callFunction({
          name: 'meetup-confirm',
          data: { token: token, message_id: m._id, action: 'accept' }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          // 失败不动本地状态：宁可让用户再点一次，也别显示成"已确认"
          uni.showToast({ title: r.msg || '确认失败，稍后再试', icon: 'none', duration: 2500 })
          return
        }
        const d = r.data || {}
        // both 是接口的快捷标记，用它兜住 status 没给全的情况
        m._meetup_status = d.both ? 'both_confirmed' : (d.status || 'one_confirmed')
        // 埋点：约局确认成功才算数（失败在上面已经 return）。
        // card_id 来自结构化卡片的 meta（契约 §5.1 里 card_id 是可选字段，没带就报空串），
        // message_id 就是这条卡消息自己的 _id —— meetup-confirm 用的也是它。
        track('meetup_confirmed', { card_id: this.scOf(m).card_id || '', message_id: m._id })
        uni.showToast({
          title: d.both ? '双方都确认了，到时候见' : '已确认，等对方回应',
          icon: 'none',
          duration: 2500
        })
      } catch (e) {
        uni.showToast({ title: '确认失败，稍后再试', icon: 'none' })
      } finally {
        // 成功失败都要松开：接口挂了按钮不能永久停在"确认中"
        m._busy = false
      }
    },

    /* 婉拒同理，只是 action 换成 decline */
    async declineStructured(m) {
      if (m._busy || m._meetup_status) return
      if (!m._id) {
        uni.showToast({ title: '这张卡还没同步好，稍后再试', icon: 'none' })
        return
      }
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
        return
      }
      m._busy = true
      try {
        const res = await uniCloud.callFunction({
          name: 'meetup-confirm',
          data: { token: token, message_id: m._id, action: 'decline' }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '操作失败，稍后再试', icon: 'none', duration: 2500 })
          return
        }
        m._meetup_status = 'declined'
      } catch (e) {
        uni.showToast({ title: '操作失败，稍后再试', icon: 'none' })
      } finally {
        m._busy = false
      }
    },

    /* ==================== AI 情绪提示（骨架，文档 §5）====================
       前端只负责渲染和关闭；什么时候下发由后端决定。
       ================================================================= */
    dismissAiHint(m) {
      // 先从本地列表拿掉：关掉要即时，不能等接口回来才消失
      const i = this.messages.findIndex((x) => x.key === m.key)
      if (i > -1) {
        this.messages.splice(i, 1)
      }
      // 再静默告诉服务端，免得下次又推同一条。
      // 失败不 toast、不把提示塞回来 —— 用户已经点掉了，弹回来最惹人烦。
      const token = uni.getStorageSync('token') || ''
      if (!token || !m._id) return
      uniCloud
        .callFunction({
          name: 'hint-dismiss',
          data: { token: token, message_id: m._id }
        })
        .catch(function () {})
    },

    /**
     * 主动向 user-profile 要一次对方头像。
     *
     * 为什么不靠入口传：消息列表的 avatar 和消息里的 sender_avatar 是两个接口，
     * 任何一边给空了，顶部就只剩默认头像。user-profile 是「看别人主页」用的接口，
     * 头像一定在里面，拿它兜底最稳。
     * 只补一次（peerAvatarFetched / peerAvatarTries 双保险），失败就算了 ——
     * 头像补不上不该影响聊天。
     */
    /* 载入本机账号自己的头像：先读本地 storage（登录/上传都写过 avatar_url），
       是 cloud:// 就换一次链接；都拿不到再问 user-me 兜底。
       自己气泡的头像不该依赖聊天记录里那条消息有没有 sender_avatar。 */
    async loadMyAvatar() {
      const u = uni.getStorageSync('userInfo') || {}
      const raw = String(u.avatar_url || u.avatar || '')
      if (raw.indexOf('http') === 0) {
        this.myAvatar = raw
        return
      }
      // 自带头像：包内静态路径，直接可用，不需要换链
      if (raw.indexOf('/') === 0) {
        this.myAvatar = raw
        return
      }
      if (raw.indexOf('cloud://') === 0) {
        try {
          const res = await uniCloud.getTempFileURL({ fileList: [raw] })
          const item = (res && res.fileList && res.fileList[0]) || null
          if (item && item.tempFileURL && item.tempFileURL !== item.fileID) {
            this.myAvatar = item.tempFileURL
            return
          }
        } catch (e) {
          // 换链失败继续往下问 user-me
        }
      }
      const token = uni.getStorageSync('token') || ''
      if (!token) return
      try {
        const res = await uniCloud.callFunction({ name: 'user-me', data: { token: token } })
        const r = (res && res.result) || {}
        const me = r.code === 0 && r.data ? r.data.user : null
        const url = (me && me.avatar_url) || ''
        if (url && (url.indexOf('http') === 0 || url.indexOf('/') === 0)) this.myAvatar = url
      } catch (e) {
        // 静默：拿不到就是空位，不落默认图
      }
    },

    async ensurePeerAvatar() {
      if (this.isAi || this.peerAvatarFetched) return
      if (!this.peerId) return
      const token = uni.getStorageSync('token') || ''
      if (!token) return
      this.peerAvatarFetched = true
      try {
        const res = await uniCloud.callFunction({
          name: 'user-profile',
          data: { token: token, user_id: this.peerId }
        })
        const r = res.result || {}
        const u = (r.code === 0 && r.data && r.data.user) || null
        const url = (u && u.avatar) || ''
        if (url && url.indexOf('http') === 0) {
          this.peerAvatar = url
          this.peerAvatarFailed = false
        }
      } catch (e) {
        /* 静默：头像补不上不影响聊天 */
      }
    },

    /* 顶部头像加载失败：先把这个 key 的绑定清掉（落空位），再换一条新链接试一次（可能是临时链接过期） */
    onPeerAvatarError() {
      // 先清掉这个 key 的绑定（否则同一个失效地址会被反复挂回去），再走「换一条链接试一次」
      this.avaOnError('peer', this.displayPeerAvatar)
      this.peerAvatarFailed = true
      if (this.peerAvatarTries >= 1) return
      this.peerAvatarTries += 1
      this.peerAvatarFetched = false
      this.ensurePeerAvatar()
    },

    /* 气泡头像：优先用这条消息自带的；对方消息没带就借顶部的（同一个人）。
       ★ 自己那侧优先用「本机已解析好的头像」（userInfo.avatar_url / myAvatar）：
         消息里的 sender_avatar 是服务端快照，早期消息里根本没这个字段，
         只靠它就会把自己的气泡一律画成默认头像。 */
    /* 把「每条消息当前该显示哪张头像」重新喂给 mixin（同 key 同地址不会重复解析）。 */
    syncBubbleAvatars() {
      this.avaSync(
        this.messages || [],
        (m) => m && m.key,
        (m) => this.bubbleAvatar(m)
      )
    },
    bubbleAvatar(m) {
      if (!m) return ''
      if (m.sender_avatar) return m.sender_avatar
      if (m.is_me) return this.myAvatar || ''
      return this.displayPeerAvatar || ''
    },

    /* 气泡头像加载失败（临时链接过期 / 文件被删）：清掉这条的来源，
       让它退化成空位，而不是一直挂着一个加载不出来的 URL。 */
    onBubbleAvatarError(m) {
      if (!m) return
      this.avaOnError(m.key, this.bubbleAvatar(m))
      if (m.is_me) {
        this.myAvatar = ''
        m.sender_avatar = ''
      } else {
        m.sender_avatar = ''
        if (this.peerAvatar) this.peerAvatarFailed = true
      }
    },

    goBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) {
        uni.navigateBack()
      } else {
        uni.reLaunch({ url: '/pages/index/index' })
      }
    },

    initChat() {
      const self = this

      // ★ 进页面永远从空起点开始，即"全量拉最近 N 条"。
      //   曾经用本地缓存 chat_last_<用户>_<会话> 做起点，想让重进时只补新的，
      //   但那个起点会随着每次收到消息一直往前跳；一旦跳到最新一条，
      //   服务端就没有"比它更新"的消息了 → 返回空数组 → 页面空白。
      //   进页面要的是"最近 N 条完整历史"，轮询要的是"比上次新的"，
      //   两者要求相反，不能共用同一个起点。
      //   增量起点只活在 transport 的内存里，页面关闭即失效。
      this.chat = createChatTransport({
        conversationId: this.conversationId,
        lastMessageId: '',

        onMessages(list) {
          self.mergeMessages(list)
          // 撤回 / 语音时长这两个字段是 message-list 新加的，
          // 单独贴一次，不动 mergeMessages 里已有的去重与首帧逻辑。
          self.applyMsgMeta(list)
          // 顺带刷一次好友申请卡片状态。不新起定时器 —— transport 已经是 3 秒一轮，
          // 再开一个 setInterval 会让请求翻倍。
          self.refreshFriendRequestStates()
          self.refreshPeerRead()
        },
        // ★ 首轮就算一条消息都没有也要放开 loading。
        // transport 只在 list.length > 0 时才回调 onMessages，
        // 空会话 / 缓存起点太新时回调永远不来，页面就卡在「正在加载聊天记录」。
        onLoaded() {
          self.loading = false
          // ★ 这里才是「对方同意了好友申请」真正的刷新时机。
          //   transport 只在 list.length > 0 时回调 onMessages，
          //   而同意申请不会往会话里写新消息 —— 轮询拉到的是空列表，
          //   走的就是这个 onLoaded。只挂 onMessages 的话，
          //   发申请的人会永远停在「等待对方同意」。
          self.refreshFriendRequestStates()
          self.refreshPeerRead()
        },
        onStatus(s) {
          self.status = s
        },
        onError() {
          // 不弹 toast：轮询失败会反复触发，弹窗会烦死人。
          // 顶部「重连中」已经说明了状态，用户发消息时会再看到具体错误。
        }
      })

      this.chat.start()
    },

    /**
     * 合并服务端消息。
     * 去重靠 clientMsgId：本地乐观插入的气泡和服务端回来的同一条消息
     * 用同一个 clientMsgId，所以能对上，不会出现"发一次变两条"。
     */
    mergeMessages(list) {
      const self = this
      // 统计本轮真正新增（或从失败态恢复）的条数，决定要不要自动滚到底
      let newCount = 0
      list.forEach(function (s) {
        const mid = s._id
        // ★ 云函数返回的是 client_msg_id（snake_case），本地气泡用的是 clientMsgId
        const srvClientId = s.client_msg_id || s.clientMsgId || ''

        // 本机删过的消息不许再插回来：服务端还在（删除只在本机生效），
        // 去掉这道判断就会「删了 3 秒后又冒出来」。_id 与 clientMsgId 都认。
        const hidden = self.loadHidden()
        if ((mid && hidden[mid]) || (srvClientId && hidden[srvClientId])) return

        // 先看是不是自己刚发的那条（乐观气泡）
        const localIdx = self.messages.findIndex(function (m) {
          return m.clientMsgId && srvClientId && m.clientMsgId === srvClientId
        })

        if (localIdx > -1) {
          // 用服务端时间覆盖本地时间，并清掉"发送中"
          const local = self.messages[localIdx]
          const merged = Object.assign({}, local, {
            key: mid || local.key,
            _id: mid,
            sender_id: s.sender_id || local.sender_id || '',
            is_me: s.is_me === true || (!!s.sender_id && s.sender_id === self.myUid()),
            // ★ 自己发的乐观气泡本来没有头像（sender_avatar: ''），
            //   合并时不把服务端这份带过来，自己那侧就永远显示默认头像。
            sender_avatar: s.sender_avatar || local.sender_avatar || '',
            created_at: s.created_at,
            timeText: self.fmtBubbleTime(s.created_at),
            failed: false
          })
          self.$set(self.messages, localIdx, merged)
          // 自己发的那条首次从服务端确认回来，也算「有新东西」，值得跟随
          newCount++
          return
        }

        // 完全重复（同一条消息被拉两次）直接跳过；但顺手用服务端的权威数据
        // 修正归属 —— 老快照里缺 sender_id 的消息就是靠这一步自己纠正过来的。
        const dup = self.messages.some(function (m) {
          return m._id === mid
        })
        if (dup) {
          if (mid) {
            const mine = s.is_me === true || (!!s.sender_id && s.sender_id === self.myUid())
            self.messages.forEach(function (m) {
              if (m._id !== mid) return
              if (s.sender_id && m.sender_id !== s.sender_id) m.sender_id = s.sender_id
              if (m.is_me !== mine) m.is_me = mine
            })
          }
          return
        }
        // 走到这里说明是一条真正的新消息
        newCount++

        self.messages.push({
          key: mid || 'srv-' + Math.random().toString(36).slice(2, 8),
          _id: mid,
          clientMsgId: srvClientId,
          sender_id: s.sender_id || '',
          // 服务端会给 is_me，但它一旦缺字段/算错，消息就会跳到对方那一侧（看起来像
          // "自己的气泡变成了对方的"）。sender_id 是硬事实，两者取或更稳。
          is_me: s.is_me === true || (!!s.sender_id && s.sender_id === self.myUid()),
          type: s.type || 'text',
          content: s.content || '',
          // meta 是卡片类消息（structured / share）的载荷，JSON 字符串或对象。
          // 不接住它，这两种卡就只剩一个空气泡（字段约定见 docs/30-后端交接.md）
          meta: s.meta || '',
          // 图片的 content 是 cloud:// fileID，不能直接当 src；
          // displayUrl 由 resolveFileURLs 批量换算后填入。
          // resolved=true 表示 displayUrl 已经是可直接用的链接，不用再换。
          displayUrl: (s.type === 'image' && !isCloudFileID(s.content)) ? s.content : '',
          resolved: !!(s.type === 'image' && s.content && !isCloudFileID(s.content)),
          // ★ 每条消息都带发送者信息，用来在气泡旁边画头像（仿 QQ / 抖音）。
          //   sender_avatar 由 message-list 云函数已经返回，这里只是接住它。
          sender_name: s.sender_name || '同学',
          sender_avatar: s.sender_avatar || '',
          created_at: s.created_at,
          timeText: self.fmtBubbleTime(s.created_at),
          failed: false,
          // ★ 好友申请卡片的四个字段由 message-list 现查补上（状态会变，不能存进消息里）。
          //   非 friend_request 消息这四个字段是空值，模板里用不到。
          fr_request_id: s.fr_request_id || '',
          fr_status: s.fr_status || '',
          fr_from_id: s.fr_from_id || '',
          fr_to_id: s.fr_to_id || ''
        })
      })

      self.sortMessages()
      // 兜底再清一遍：无论这条是从哪条路径钻回来的（轮询/快照/上拉），
      // 本机删过的一律不许留在数组里。只靠 mergeMessages 的 return 不够稳 ——
      // 页面重进时第一次渲染走的是快照，那条路径与轮询不是同一处判断。
      self.pruneHidden()
      // ★ 不再写 chat_last_ 缓存。
      //   这个缓存曾用于"下次进页面从上次位置续拉"，但起点会随每条新消息
      //   一路往前跳，跳到最新一条后服务端就没有"比它更新"的消息 → 空列表。
      //   进页面现在一律全量拉最近 30 条，增量起点只活在 transport 内存里。
      self.loading = false
      // ★ 快照落盘：800ms 内再来一轮就合并成一次写（见 scheduleSnapshot）
      self.scheduleSnapshot()

      // 图片消息存的是 cloud:// fileID，必须换成临时 URL 才能显示
      self.resolveFileURLs()
      // share 卡片封面：本轮新消息里可能有 cloud:// 封面，一起换掉
      self.resolveShareCovers()
      // 封面可能是已过期的 http：主动补一次（不依赖 @error）
      self.ensureShareCovers()
      // 贴底且消息过多时裁最旧的（DOM 上界，见 trimOldMessages）
      self.trimOldMessages()

      // ★ 自动滚到底需要同时满足两个条件：
      //   ① 用户仍在跟随底部（autoStick）—— 在往上翻历史时不能打断他；
      //   ② 这一轮**确实有新消息**（newCount > 0）。
      //   第 ② 个条件是关键：轮询每 3 秒回调一次，但多数轮次没有新消息；
      //   若只要贴底就滚，那么图片本地化回填、气泡高度微调这类**布局变化**
      //   也会被当成"该滚了"，于是出现「图片一张张加载、页面跟着一路往下滚」。
      self.mergedNewCount = newCount

      // ★ 首次拉到消息：直接停在底部，不做滚动动作。
      //   scroll-into-view 首次设成底部锚点时页面还没渲染完，
      //   设下去就处在最底部，用户看到的第一帧就在最下面，
      //   不存在每次进来都快速滚一遍的过程。
      if (!self.firstAnchorDone && self.messages.length) {
        self.firstAnchorDone = true
        self.firstAnchorAt = Date.now()
        self.anchorBottomNoAnimation()
        // ★ 首帧锚底时，图片气泡还在用占位高度（真实尺寸是 getImageInfo 异步量到的）。
        //   量到之后内容变高，页面看起来就是「没贴底、又被一路顶下去」。
        //   所以首屏 1.5 秒内补两次锚底；用户已经开始上翻（autoStick=false）就跳过。
        self.scheduleFirstSettle()
        return
      }

      if (self.autoStick && newCount > 0) self.scrollToEnd()
    },

    /* 这一屏的图片是否都量到真实比例了。
       为什么要等它：图片气泡在量到之前是占位高度（380×260），
       此时锚"底部"其实锚在半空（正好停在图片气泡那一带）；
       等下面几张图量完、高度撑开，才会真的到底 —— 用户看到的就是「先停在图片处，再滑下去」。 */
    imagesSettled() {
      const list = this.messages || []
      for (let i = 0; i < list.length; i++) {
        const m = list[i]
        if (!m || m.type !== 'image' || m.imgFailed) continue
        if (!m.displayUrl) continue
        if (!this.hasImgBox(m)) return false
      }
      return true
    },

    /* 放开消息区的时机：图片都量完（或超过 1.5 秒硬上限）。
       放开前再瞬时定位一次，滚动生效后再显示 —— 用户第一眼就在底部。 */
    maybeReveal() {
      if (this.listReady || this.revealScheduled) return
      if (this.userTookOver) {
        // 用户已经自己拖动画面了：不再锚底、不再等图片，直接把消息区放出来交给他
        this.revealScheduled = true
        this.listReady = true
        return
      }
      const self = this
      const since = Date.now() - (this.firstAnchorAt || 0)
      if (since < 1500 && !this.imagesSettled()) {
        // ★ 还没到硬上限：约在 1.5 秒到点再看一眼。
        //   没有这个计时器，一旦图片既量不到尺寸也不报错（死链、懒加载没触发），
        //   就没有任何东西会再调用本方法 —— 消息区会一直藏着，用户看到一块空白。
        if (!this.revealCapTimer) {
          this.revealCapTimer = setTimeout(function () {
            self.revealCapTimer = null
            self.maybeReveal()
          }, Math.max(80, 1500 - since + 40))
        }
        return
      }
      this.revealScheduled = true
      if (this.revealCapTimer) {
        clearTimeout(this.revealCapTimer)
        this.revealCapTimer = null
      }
      this.anchorBottomNoAnimation()
      setTimeout(function () {
        self.listReady = true
      }, 120)
    },

    /* 首屏尺寸稳定前的补锚：图片气泡的真实高度是异步量到的，
       量到之前锚底用的是占位高度，量到之后内容会变高，看起来像"没在底部"。
       只在首帧 1.5 秒内、且用户仍在跟随底部时补两次。 */
    scheduleFirstSettle() {
      const self = this
      const settle = function (delay) {
        const id = setTimeout(function () {
          if (self.userTookOver) return
          if (!self.firstAnchorDone) return
          if (!self.autoStick) return
          if (Date.now() - (self.firstAnchorAt || 0) > 1500) return
          self.anchorBottomNoAnimation()
          self.maybeReveal()
        }, delay)
        if (!self.settleTimers) self.settleTimers = []
        self.settleTimers.push(id)
      }
      settle(260)
      settle(700)
    },

    /* ==================== 本地快照：进页面秒开 ====================
       上次离开时把最近 40 条精简消息写进本地，下次进页面先用它渲染一屏；
       transport 首轮到货后照常走 mergeMessages 合并（去重逻辑一行没动）。
       ★ 绝不把换链得到的临时 https 链接写进 storage —— 那种链接几小时就过期，
         存下来既没用，还会把过期地址摊到首屏上。 */

    /** 快照的 storage key；没 token / 没 uid / 没会话 id 就不读不写 */
    snapKey() {
      const token = uni.getStorageSync('token') || ''
      if (!token) return ''
      const u = uni.getStorageSync('userInfo') || {}
      const uid = u._id || ''
      if (!uid || !this.conversationId) return ''
      return 'chat_snap_v1_' + uid + '_' + this.conversationId
    },

    /** meta 先字符串化，抹掉 http(s) 链接（临时链接过期即废），再截到 500 字 */
    snapMeta(raw) {
      if (!raw) return ''
      let s = raw
      if (typeof s === 'object') {
        try {
          s = JSON.stringify(s)
        } catch (e) {
          return ''
        }
      }
      s = String(s).replace(/https?:\/\/[^"'\s\\]+/g, '')
      if (s.length > 500) s = s.slice(0, 500)
      return s
    },

    /** 一条消息 → 精简快照项。白名单取字段，
        所以 displayUrl / localUrl / resolved / imgFailed / _busy 天然进不来 */
    snapItem(m) {
      const uid = this.myUid()
      const avatar = String(m.sender_avatar || '')
      const recalled = m.recalled === true
      return {
        _id: m._id || '',
        client_msg_id: m.client_msg_id || m.clientMsgId || '',
        type: m.type || 'text',
        // ★ 撤回的正文一律不落盘：既不该留在本地，也不该在下次进页面时先闪一下原文
        content: recalled ? '' : m.content || '',
        // ★ 之前漏了这个字段 —— 快照里的撤回消息会被当成普通消息画成气泡，
        //   等网络数据回来才变成「对方撤回了一条消息」，用户看到的就是「先有气泡、再变提示」
        recalled: recalled,
        meta: this.snapMeta(m.meta),
        duration: m.duration || 0,
        created_at: m.created_at || 0,
        sender_id: m.sender_id || '',
        // 老快照没有 sender_id（自己发的乐观气泡早期没带），存一份 is_me 兜底
        is_me: m.is_me === true,
        sender_name: m.sender_name || '',
        // 头像换过链就是临时 https 地址，存下来会过期 —— 留空走默认头像
        sender_avatar: avatar.indexOf('http') === 0 ? '' : avatar,
        fr_request_id: m.fr_request_id || '',
        fr_status: m.fr_status || '',
        fr_from_me: !!(m.fr_from_id && m.fr_from_id === uid)
      }
    },

    /** 写快照：最近 40 条，100KB 封顶（超了从最旧的丢）。失败一律静默 */
    writeSnapshot() {
      const key = this.snapKey()
      if (!key) return
      try {
        const all = this.messages
        if (!all.length) return
        const start = all.length > 40 ? all.length - 40 : 0
        const list = []
        for (let i = start; i < all.length; i++) list.push(this.snapItem(all[i]))
        const LIMIT = 100 * 1024
        while (list.length) {
          const payload = { at: Date.now(), list: list }
          if (JSON.stringify(payload).length <= LIMIT) {
            uni.setStorageSync(key, payload)
            return
          }
          list.shift()
        }
      } catch (e) {
        /* 写快照失败不影响聊天：它只是加速手段 */
      }
    },

    /** mergeMessages 之后调用：800ms 内再有结果就合并成一次写 */
    scheduleSnapshot() {
      const self = this
      if (this.snapTimer) clearTimeout(this.snapTimer)
      this.snapTimer = setTimeout(function () {
        self.snapTimer = null
        self.writeSnapshot()
      }, 800)
    },

    /** onHide / onUnload：立即写（同步，不等 debounce） */
    flushSnapshot() {
      if (this.snapTimer) {
        clearTimeout(this.snapTimer)
        this.snapTimer = null
      }
      this.writeSnapshot()
    },

    /** 读快照并补齐渲染字段。命中返回 true；没快照 / 读失败一律静默 false */
    restoreSnapshot() {
      const key = this.snapKey()
      if (!key) return false
      let raw = null
      try {
        raw = uni.getStorageSync(key)
      } catch (e) {
        return false
      }
      if (!raw || !raw.list || !raw.list.length) return false
      const uid = this.myUid()
      const hiddenSnap = this.loadHidden()
      const list = []
      for (let i = 0; i < raw.list.length; i++) {
        const s = raw.list[i]
        if (!s) continue
        const id = s._id || s.client_msg_id || ''
        if (!id) continue
        // 快照是 800ms 前写的，可能还留着刚删掉的那条
        if (hiddenSnap[id] || (s._id && hiddenSnap[s._id])) continue
        // ★ 归属未知（老快照：既没有 sender_id，也没有 is_me）就别画了 ——
        //   画出来会把「自己的消息」显示成对方的（连顶部头像都会被带错）。
        //   这类条目服务端 3 秒内就会重新下发，届时归属是权威的。
        if (!s.sender_id && typeof s.is_me !== 'boolean') continue
        list.push({
          key: id,
          _id: s._id || '',
          clientMsgId: s.client_msg_id || '',
          // sender_id 是硬事实；老快照可能缺它（自己发的气泡早期没写），
          // 那就退回快照里的 is_me，绝不默认成 false（会画到对方那一侧）
          is_me: s.sender_id ? s.sender_id === uid : s.is_me === true,
          type: s.type || 'text',
          content: s.recalled === true ? '' : s.content || '',
          meta: s.meta || '',
          duration: s.duration || 0,
          created_at: s.created_at || 0,
          timeText: this.fmtBubbleTime(s.created_at),
          sender_name: s.sender_name || '同学',
          sender_avatar: s.sender_avatar || '',
          // displayUrl 一律留空：真正的临时链接由 resolveFileURLs 换
          displayUrl: '',
          resolved: false,
          // 快照里带了 recalled 就照它画，别一律当普通消息（会先闪一个气泡）
          recalled: s.recalled === true,
          failed: false,
          fr_request_id: s.fr_request_id || '',
          fr_status: s.fr_status || '',
          fr_from_id: s.fr_from_me ? uid : '',
          fr_to_id: ''
        })
      }
      if (!list.length) return false
      this.messages = list
      // 有快照就先别挂「正在加载聊天记录」
      this.loading = false
      // ★ 仍然落在底部：沿用首帧定位（不做滚动动画），autoStick 照旧是 true
      this.anchorBottomNoAnimation()
      // 图片 / share 封面还是 cloud:// fileID，立刻换一次链接
      this.resolveFileURLs()
      this.resolveShareCovers()
      // 老消息的封面可能是过期链接：主动补一次（见 ensureShareCovers）
      this.ensureShareCovers()
      return true
    },

    /* ==================== 上拉加载更早历史 ====================
       服务端契约：data 是升序数组，外层带 has_more_before（boolean）。
       前插而不是整页重拉：重拉会让聊天记录闪一下、滚动位置也丢。 */

    /** 服务端一条消息 → 页面气泡对象。字段与 mergeMessages 里 push 的那份保持一致 */
    fromServerMsg(s) {
      const mid = s._id
      return {
        key: mid,
        _id: mid,
        clientMsgId: s.client_msg_id || s.clientMsgId || '',
        sender_id: s.sender_id || '',
        is_me: s.is_me === true || (!!s.sender_id && s.sender_id === this.myUid()),
        type: s.type || 'text',
        content: s.content || '',
        meta: s.meta || '',
        displayUrl: (s.type === 'image' && !isCloudFileID(s.content)) ? s.content : '',
        resolved: !!(s.type === 'image' && s.content && !isCloudFileID(s.content)),
        recalled: s.recalled === true,
        duration: typeof s.duration === 'number' ? s.duration : 0,
        sender_name: s.sender_name || '同学',
        sender_avatar: s.sender_avatar || '',
        created_at: s.created_at,
        timeText: this.fmtBubbleTime(s.created_at),
        failed: false,
        fr_request_id: s.fr_request_id || '',
        fr_status: s.fr_status || '',
        fr_from_id: s.fr_from_id || '',
        fr_to_id: s.fr_to_id || ''
      }
    },

    /**
     * 上拉到顶：拉更早的 30 条，前插并保持滚动位置不动。
     * 失败只 toast，不动 noMoreBefore（下一把还能再试）。
     */
    async loadOlder() {
      if (this.loadingOlder || this.noMoreBefore) return
      if (!this.messages.length) return
      // 最旧一条必须是服务端消息（有 _id）才能当 before 游标；本地乐观气泡没有 _id
      const first = this.messages[0]
      if (!first || !first._id) return
      const token = uni.getStorageSync('token') || ''
      if (!token) return
      // 记住当前最顶那条：插完要滚回它，不能跳到别处
      const anchorKey = first.key
      this.loadingOlder = true
      try {
        const res = await uniCloud.callFunction({
          name: 'message-list',
          data: {
            token: token,
            conversationId: this.conversationId,
            beforeMessageId: first._id,
            limit: 30
          }
        })
        const r = res.result || {}
        if (r.code !== 0) throw new Error(r.msg || 'message-list failed')
        const list = r.data || []
        const seen = {}
        for (let i = 0; i < this.messages.length; i++) {
          if (this.messages[i]._id) seen[this.messages[i]._id] = true
        }
        const older = []
        const hiddenMap = this.loadHidden()
        for (let i = 0; i < list.length; i++) {
          const s = list[i]
          const mid = s && s._id
          // 按 _id 去重：轮询已经补进来的那些不再插一遍
          if (!mid || seen[mid]) continue
          // 本机删过的历史消息，上拉翻回来时同样不许出现
          if (hiddenMap[mid]) continue
          seen[mid] = true
          older.push(this.fromServerMsg(s))
        }
        // ★ 服务端明确说没有更早的了，才关掉上拉；接口失败时不置
        if (r.has_more_before === false) this.noMoreBefore = true
        if (!older.length) return
        this.messages = older.concat(this.messages)
        this.sortMessages()
        this.resolveFileURLs()
        this.resolveShareCovers()
        this.restoreScrollAnchor(anchorKey)
      } catch (e) {
        uni.showToast({ title: '加载更早的消息失败', icon: 'none', duration: 2000 })
      } finally {
        this.loadingOlder = false
      }
    },

    /** 前插后的保位：锚回原来最顶那条（先清锚点，下一帧再设，滚完再清） */
    restoreScrollAnchor(anchorKey) {
      const self = this
      if (!anchorKey) return
      // 这次滚动是我们自己发起的：锁住 onScroll 的跟随判定，别把滚动过程当成"用户上翻"
      this.stickLockUntil = Date.now() + 600
      this.scrollInto = ''
      this.$nextTick(function () {
        self.scrollAnimated = false
        self.scrollInto = 'msg-' + anchorKey
        self.$nextTick(function () {
          self.scrollInto = ''
        })
      })
    },

    sortMessages() {
      this.messages.sort(function (a, b) {
        const ta = a.created_at || Number.MAX_SAFE_INTEGER
        const tb = b.created_at || Number.MAX_SAFE_INTEGER
        return ta - tb
      })
    },

    /* 时间只在「需要分隔」时显示：第一条、与上一条间隔 ≥5 分钟、或跨天。
       微信/QQ 都是这个规则 —— 每行都挂时间，一屏十几行时间反而看不出节奏。 */
    showBubbleTime(m, idx) {
      if (!m || !m.created_at) return false
      if (!idx) return true
      const prev = this.messages[idx - 1]
      if (!prev || !prev.created_at) return true
      if (m.created_at - prev.created_at >= 5 * 60 * 1000) return true
      const a = new Date(prev.created_at)
      const b = new Date(m.created_at)
      return (
        a.getFullYear() !== b.getFullYear() ||
        a.getMonth() !== b.getMonth() ||
        a.getDate() !== b.getDate()
      )
    },

    fmtBubbleTime(ts) {
      if (!ts) return ''
      const d = new Date(ts)
      return (
        String(d.getHours()).padStart(2, '0') +
        ':' +
        String(d.getMinutes()).padStart(2, '0')
      )
    },

    /** 输入时告诉 transport "还在动"，避免敲字期间降到 10 秒一轮 */
    onTyping() {
      if (this.chat) this.chat.touch()
    },

    async sendText() {
      const text = (this.draft || '').trim()
      if (!text || this.sending) return
      await this.doSend({ type: 'text', content: text })
      this.draft = ''
    },

    /** 选图上传，再把图片地址当一条消息发出去 */
    pickImage() {
      const self = this
      uni.chooseImage({
        count: 1,
        // 手机原图一张 2-4 MB，直传云存储会同时吃掉 CDN 流量和存储。
        // compressed 让系统先压一道，聊天看图不需要原图。
        sizeType: ['compressed'],
        success(res) {
          const path = res.tempFilePaths[0]
          if (path) self.prepareImage(path)
        }
      })
    },

    /**
     * 上传前把长边压到 1280、质量 60。
     * 3 MB 的原图大约落到 150 KB，同一份 CDN 流量能多发二三十倍。
     * compressImage 在个别端没有/失败时直接发原图，不阻断聊天。
     */
    prepareImage(filePath) {
      const self = this
      const send = function (p) {
        self.uploadAndSend(p || filePath)
      }
      if (typeof uni.compressImage !== 'function') return send(filePath)
      uni.compressImage({
        src: filePath,
        quality: 60,
        compressedWidth: 1280,
        success(res) {
          send(res.tempFilePath)
        },
        fail(e) {
          console.warn('[chat] 图片二次压缩失败，发原图', e && e.errMsg)
          send(filePath)
        }
      })
    },

    /**
     * 量本地文件（压缩后的那张）的像素宽高，量不到返回 null。
     *
     * ★ 为什么要发之前量：气泡高度只能由真实宽高比算出来，
     *   渲染方自己量要等图片下载完，首帧就只能给占位高度 ——
     *   于是"进页面没贴底、图出来后又被顶下去"。
     * ★ 为什么失败要安静返回 null：尺寸只是让首帧更好看，
     *   量不出来也必须照常发送，否则一个不支持的端就再也发不出图。
     */
    localImageSize(filePath) {
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

    /** meta 统一收敛成 JSON 字符串：气泡里 m.meta 是字符串，发请求时也不用再猜类型 */
    metaText(raw) {
      if (!raw) return ''
      if (typeof raw === 'string') return raw
      try {
        return JSON.stringify(raw)
      } catch (e) {
        return ''
      }
    },

    async uploadAndSend(filePath) {
      if (this.sending) return
      this.sending = true
      uni.showLoading({ title: '上传中…' })
      try {
        // 图片直传云存储，不走云函数（云函数中转会把图片塞进请求体，容易超限）
        // ★ cloudPath 必须带随机串：支付宝云/腾讯云的 cloudPath 是"文件的绝对路径"，
        //   同路径会直接覆盖。只用毫秒时间戳，连点两下同一毫秒就会互覆盖。
        const rand = Math.random().toString(36).slice(2, 10)
        const up = await uniCloud.uploadFile({
          filePath: filePath,
          cloudPath: 'chat/' + this.conversationId + '/' + Date.now() + '-' + rand + '.jpg',
          fileType: 'image'
        })
        uni.hideLoading()
        if (!up || !up.fileID) {
          uni.showToast({ title: '上传失败', icon: 'none' })
          return
        }
        // ★ 统一把 fileID 存成 cloud:// 形式，渲染时再换临时 URL。
        //   阿里云返回的是 https 链接可以直接用，支付宝云返回 cloud:// 必须转换；
        //   这里统一成 cloud://，渲染层就不用到处判断平台。
        const fileID = toCloudFileID(up.fileID)
        // 顺手传一张 320 宽的缩略图（同一路径加 _t 后缀）：气泡只用它，
        // 点开预览才读原图。CDN 流量能省一个数量级，失败也只当没有缩略图。
        this.uploadThumb(filePath, fileID)
        const localUrl = filePath
        // ★ 上传完才量尺寸：量的必须是真正发出去的那张（压缩后的临时文件），
        //   原图和压缩图的宽高比可能不同（个别端 compressedWidth 会等比缩放但带取整）。
        //   量不到就给 null —— 尺寸只决定首帧高度，绝不能让它挡住发送。
        const dim = await this.localImageSize(filePath)
        await this.doSend({ type: 'image', content: fileID, meta: dim }, localUrl)
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: '图片上传失败', icon: 'none' })
      } finally {
        this.sending = false
      }
    },

    /* 生成并上传缩略图（fire-and-forget）。
       压缩参数：540 宽 / quality 62 —— 气泡宽 380rpx 在 3 倍屏上约 570 物理像素，
       320 会糊（上一版就是 320），540 在清晰度和流量之间取平衡（约 40~70KB）。
       任何一步失败都静默：聊天照发，图片照看原图。 */
    uploadThumb(filePath, fileID) {
      const self = this
      const thumbId = thumbIdOf(fileID)
      if (!thumbId) return
      if (typeof uni.compressImage !== 'function') return
      uni.compressImage({
        src: filePath,
        quality: 62,
        compressedWidth: 540,
        success(res) {
          const p = res && res.tempFilePath
          if (!p) return
          uniCloud
            .uploadFile({
              filePath: p,
              cloudPath: thumbId.replace(/^cloud:\/\/[^/]+\//, ''),
              fileType: 'image'
            })
            .then(function () {
              // 上传成功后把本机缓存里这张图的 thumb 链接补上，当前会话立刻能用
              self.hashThumb(fileID)
            })
            .catch(function (e) {
              console.warn('[chat] 缩略图上传失败', e && e.message)
            })
        },
        fail() {
          // 某些端不支持压缩：直接当没有缩略图
        }
      })
    },

    /* 为某张原图解析缩略图链接（单独一次请求，不影响原图换链）。
       找不到 _t 文件时保留 m.thumbUrl 为空，渲染自动回退原图。 */
    hashThumb(fileID) {
      const self = this
      const thumbId = thumbIdOf(fileID)
      if (!thumbId) return
      const hit = getImageUrl(thumbId) || self.urlCache[thumbId]
      if (hit) {
        self.applyThumb(fileID, hit)
        return
      }
      uniCloud
        .getTempFileURL({ fileList: [thumbId] })
        .then(function (res) {
          const list = (res && res.fileList) || []
          const item = list[0]
          if (!item || !item.tempFileURL || item.tempFileURL === item.fileID) return
          self.urlCache[thumbId] = item.tempFileURL
          putImageUrls({ [thumbId]: item.tempFileURL })
          self.applyThumb(fileID, item.tempFileURL)
        })
        .catch(function (e) {
          console.warn('[chat] 缩略图换链失败', e && e.message)
        })
    },

    applyThumb(fileID, url) {
      if (!fileID || !url) return
      this.messages.forEach(function (m) {
        if (m.type === 'image' && m.content === fileID) m.thumbUrl = url
      })
    },

    /**
     * 乐观发送：先插本地气泡（发送中），再调 transport。
     * 失败时不清空气泡，而是标记 failed，让用户能重试 —— 
     * 直接删掉用户刚打的字是最让人恼火的交互。
     */
    async doSend(payload, localUrl) {
      const clientMsgId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      // 自己发的气泡也要有头像 —— 从本地缓存的登录信息里取，
      // 不然等服务端回包才出图，气泡会先空着再突然长出来一个头像。
      const me = uni.getStorageSync('userInfo') || {}
      const local = {
        key: clientMsgId,
        _id: '',
        clientMsgId: clientMsgId,
        is_me: true,
        // ★ 必须带 sender_id：快照按它判归属（restoreSnapshot），
        //   漏了就会在「退出重进」时把自己发的气泡画到对方那一侧。
        sender_id: me._id || me.id || '',
        type: payload.type,
        content: payload.content,
        sender_name: me.nickname || '我',
        // 本地乐观插入的气泡不带头像：库里的是 cloud:// fileID，<image> 不认。
        // 服务端回包（message-list）已经换好临时链接，下一次轮询就把这一行替换掉。
        sender_avatar: '',
        created_at: Date.now(),
        timeText: this.fmtBubbleTime(Date.now()),
        failed: false,
        // 语音时长（秒）；非语音为 0。模板按它渲染「▶ N"」
        duration: payload.duration || 0,
        // 撤回标记：本地新建的气泡一律未撤回
        recalled: false,
        // ★ 图片的像素宽高要随气泡一起先写上：message-list 回包之前，
        //   这一条只能靠本地 meta 撑出正确高度，否则首帧又是占位高度。
        meta: this.metaText(payload.meta)
      }
      // ★ 图片刚发出去时 content 是 cloud:// 的 fileID，还不能直接当 src 用，
      //   所以先用本地临时路径顶上（localUrl），等 resolveFileURLs 换成临时 URL 后再覆盖。
      //   resolved 必须为 false：本地临时路径重启后会被系统清掉，
      //   只有换成云链接之后这张图才是稳定可用的。
      local.resolved = false
      if (payload.type === 'image') local.displayUrl = localUrl || ''
      this.messages.push(local)
      this.sortMessages()
      this.scrollToEnd()
      if (this.chat) this.chat.touch()

      this.sending = true
      try {
        const sendPayload = {
          type: payload.type,
          content: payload.content,
          clientMsgId: clientMsgId
        }
        // 语音必须带时长：message-send 对 type='voice' 会校验 duration 是 1~60 的整数
        if (payload.duration) sendPayload.duration = payload.duration
        // 空串一律不发：文字/语音的请求体保持与改造前完全一致，
        // 只有真带着 {w,h} 的图片消息才多出这一个键
        if (local.meta) sendPayload.meta = local.meta
        const msg = await this.chat.send(sendPayload)
        // ★ 这里不写 chat_last_ 缓存。
        //   缓存是"下次进页面从这个 _id 往后拉"的起点。如果发完消息就把它
        //   写成自己刚发的那条，下次进页面只会拿到这一条 —— 之前的历史全部丢失
        //   （录屏实测：发 147 之后重进，只剩 147）。
        //   起点统一由 mergeMessages 在收到服务端消息后推进。
        if (msg && msg._id) {
          // 只把本地气泡补上服务端 _id，让它在后续去重里能对上
          const i = this.messages.findIndex(function (m) {
            return m.clientMsgId === clientMsgId
          })
          if (i > -1 && !this.messages[i]._id) {
            this.$set(
              this.messages,
              i,
              Object.assign({}, this.messages[i], {
                _id: msg._id,
                created_at: msg.created_at || this.messages[i].created_at,
                timeText: this.fmtBubbleTime(msg.created_at || this.messages[i].created_at)
              })
            )
          }
        }
      } catch (e) {
        const idx = this.messages.findIndex(function (m) {
          return m.clientMsgId === clientMsgId
        })
        if (idx > -1) {
          this.$set(this.messages, idx, Object.assign({}, this.messages[idx], { failed: true }))
        }
      } finally {
        this.sending = false
      }
    },

    retry(m) {
      const idx = this.messages.findIndex(function (x) {
        return x.key === m.key
      })
      if (idx > -1) this.messages.splice(idx, 1)
      // 重发图片要把像素宽高一起带上：那条 meta 已经在气泡上了，丢了首帧就退回占位高度。
      // 其它类型不带 meta —— 它们在改造前就没带，不在本次范围内。
      this.doSend({
        type: m.type,
        content: m.content,
        duration: m.duration || 0,
        meta: m.type === 'image' ? m.meta || '' : ''
      })
    },

    /**
     * 滚动监听：判断用户是不是"贴着底部"。
     *
     * 为什么要它：轮询每 3 秒拉一次消息，每次 mergeMessages 都会让列表变化。
     * 如果无条件滚到底，用户正在往上翻历史时会被一路拽回来。
     * 这里记下用户的位置，只有他本来就在底部（新消息本来就该出现在视野里）
     * 才自动跟随；一旦他往上翻了，新消息只静静插入，不打断阅读。
     *
     * 阈值 40px：留一点余量，因为图片加载、气泡高度微调都会让 scrollTop 差几个像素，
     * 用严格相等会导致"明明在底部却不跟随"。
     */
    onScroll(e) {
      const d = e.detail || {}
      const st = d.scrollTop || 0
      const sh = d.scrollHeight || 0
      const ch = d.clientHeight || 0
      // scrollHeight 拿不到时（部分平台不返回），保守认为在底部，保持原有跟随行为
      if (sh <= 0) {
        this.autoStick = true
        return
      }
      const atBottom = sh - st - ch <= 40
      // ★ 程序滚动期间不改跟随状态：这时的 scrollTop 是滚动过程中的中间值，
      //   不代表用户想离开底部。
      if (Date.now() < this.stickLockUntil) return
      // 用户真的滑到了底部 → 恢复跟随；往上翻了 → 停止跟随，并解除钉底
      this.autoStick = atBottom
      if (!atBottom) this.onUserTakeOver()
    },

    /**
     * ★ 用户接管消息区（拖动，或真的往上翻离开了底部）。
     *
     * 首屏那套「藏起来 → 补两次锚 → 等图片量完再放出」全都靠"我们自己说了算"，
     * 但它有 1.5 秒的窗口：用户在这个窗口里往上滑，会先被 stickLockUntil 挡掉
     * 跟随状态更新、再被 scheduleFirstSettle / maybeReveal 拽回底部，
     * 体感就是"进聊天页一两秒内滑不动"。这里在用户真正动手的瞬间全部停手。
     */
    onUserTakeOver() {
      if (this.userTookOver) return
      this.userTookOver = true
      this.clearSettleTimers()
      if (this.revealCapTimer) {
        clearTimeout(this.revealCapTimer)
        this.revealCapTimer = null
      }
      // 图片加载完的那次补锚（imgStickTimer）同样在路上，必须一起掐掉
      if (this.imgStickTimer) {
        clearTimeout(this.imgStickTimer)
        this.imgStickTimer = null
      }
      // 首帧锚底那次还会在 320ms 后复位 scrollInto；不清掉的话它照样会把用户拽下去
      if (this.scrollResetTimer) {
        clearTimeout(this.scrollResetTimer)
        this.scrollResetTimer = null
      }
      this.scrollInto = ''
      this.autoStick = false
      // 已经在操作了，不要再让他对着一块不透明的区域滑
      this.listReady = true
    },

    clearSettleTimers() {
      const list = this.settleTimers || []
      for (let i = 0; i < list.length; i++) clearTimeout(list[i])
      this.settleTimers = []
    },

    /**
     * ★ 首次进入：把消息区**直接**定位到底部，不做滚动动画。
     *
     * 为什么不复用 scrollToEnd：那个方法是「先清空锚点、下一帧再设锚点」，
     * 配合 scroll-with-animation 会走一段可见的滚动过程。用户要的是
     * 点进会话就在底部，而不是每次进来都快速滚一遍。
     *
     * 这里做三件事：确认锚点已生效、挂上复位计时、把"跟随底部"打开。
     * 定位完成后 autoStick = true，后续图片撑高才会继续贴底；
     * 用户一旦往上翻历史，onScroll 会把它关掉。
     */
    anchorBottomNoAnimation() {
      const self = this
      // ★ 快照秒开路径（restoreSnapshot）也会走到这里，而它不经过 mergeMessages 的首次锚底分支，
      //   于是 firstAnchorAt 一直是 0 —— maybeReveal 里 (Date.now() - 0) 永远 > 1500，
      //   硬上限第一帧就命中，消息区在图片还没量到真实高度时就被放出来，
      //   用户看到的还是「先停在图片气泡，再自己滑下去」。这里补上时间原点。
      if (!this.firstAnchorAt) this.firstAnchorAt = Date.now()
      if (this.scrollResetTimer) clearTimeout(this.scrollResetTimer)
      // 这次定位是我们自己发起的：锁住 onScroll 的跟随判定，别把滚动过程误判成"用户上翻"
      this.stickLockUntil = Date.now() + 600
      this.$nextTick(function () {
        // ★ 必须先清空再设：scroll-into-view 只在值**变化**时才触发滚动。
        //   连续两次设成同一个 'msg-end'，第二次是空操作 ——
        //   这就是「图片撑高后补锚没生效、页面还是没到底」的真正原因。
        self.scrollInto = ''
        self.$nextTick(function () {
          self.scrollInto = 'msg-end'
        })
        // 与 scrollToEnd 同样要复位：锚点留着会让任何布局变化再次触发滚动
        self.scrollResetTimer = setTimeout(function () {
          self.scrollInto = ''
          self.scrollResetTimer = null
          // 首次定位完成后才允许后续跟随带动画
          self.scrollAnimated = true
          // 锚定完成不代表高度稳定：图片气泡此时还是占位高度，
          // 所以放出的时机交给 maybeReveal()（等这一屏图片都量到真实比例）
          self.maybeReveal()
          // 首帧已落在底部：恢复跟随，后续图片撑高会继续贴底
          self.autoStick = true
        }, 320)
      })
    },

    scrollToEnd() {
      const self = this
      if (this.scrollResetTimer) clearTimeout(this.scrollResetTimer)
      // 同上：这次滚动是我们发起的，别让 onScroll 把中间态当成用户上翻
      this.stickLockUntil = Date.now() + 600
      this.$nextTick(function () {
        self.scrollInto = ''
        self.$nextTick(function () {
          self.scrollInto = 'msg-end'
          // ★ 关键：滚到底之后必须把 scrollInto 复位。
          //   scroll-into-view 只要还留着值，任何布局变化都会**再次**触发滚动 ——
          //   图片一张张加载完、气泡高度随之变化，就会把用户一路拽到末尾。
          //   这正是「图片从旧到新加载时页面跟着滚」的原因。
          //   复位成空串后，布局变化不再触发滚动；后续要滚由 mergeMessages /
          //   doSend 在需要时重新调用本方法。
          self.scrollResetTimer = setTimeout(function () {
            self.scrollInto = ''
            self.scrollResetTimer = null
            // 滚完确认仍在跟随（滚到末尾就是"贴着底部"）
            self.autoStick = true
            // ★ 这里也要置 true：本方法的复位定时器会顶掉首帧定位的那个定时器，
            //   而 scrollAnimated 只在那一个里被打开。不补这一句，
            //   只要图片在首帧定位完成前就加载完，整个会话页就再也滚不动动画了。
            self.scrollAnimated = true
          }, 320)
        })
      })
    },

    previewImage(url) {
      if (!url) return
      uni.previewImage({ urls: [url], current: url })
    },

    /** 图片加载失败：标记一下，模板里换成"图片加载失败"占位，不要一直白框 */
    onImgError(m) {
      const idx = this.messages.findIndex(function (x) {
        return x.key === m.key
      })
      if (idx > -1) {
        m.imgFailed = true
      }
      // ★ 这条链接已不可用（多半是临时链接过期）。
      //   删掉持久缓存里那条、并清掉气泡上的 displayUrl，
      //   下一次 resolveFileURLs 会重新换一条新链接，而不是一直白框。
      if (m.type === 'image' && isCloudFileID(m.content) && m.content) {
        // ★ 三处记录都要作废，少一处都会导致同一个坏路径被反复取用、一直白框：
        //   ① 链接缓存  ② 本地文件记录  ③ 气泡上的 displayUrl 与 resolved 标记
        invalidateImageUrl(m.content)
        forgetLocalImage(m.content)
        delete this.urlCache[m.content]
        m.displayUrl = ''
        m.resolved = false // 下次 resolveFileURLs 会重新换一条链接
        // 下一次会重新走「换链接 → 存本地」的完整流程
      }
    },

    /* 失败态点一下重试。
       失败通常只有一种原因：临时链接过期 / 文件被删。onImgError 已经把三处缓存作废，
       这里只需把气泡标回「未解析」，再让 resolveFileURLs 重新换一条链接量尺寸。 */
    retryImage(m) {
      if (!m || !m.imgFailed) return
      m.imgFailed = false
      m.resolved = false
      if (isCloudFileID(m.content)) m.displayUrl = ''
      this.resolveFileURLs()
    },


    /**
     * 图片 load 事件里取原始宽高（个别端 detail 是空的，退回 getImageInfo）。
     */
    applyImgBox(e, m) {
      if (!m) return
      const d = (e && e.detail) || {}
      const nw = Number(d.width) || 0
      const nh = Number(d.height) || 0
      if (nw > 0 && nh > 0) {
        this.setImgBox(m, nw, nh)
        return
      }
      if (!m.displayUrl) return
      const self = this
      uni.getImageInfo({
        src: m.displayUrl,
        success(info) {
          self.setImgBox(m, Number(info.width) || 0, Number(info.height) || 0)
        }
      })
    },

    /**
     * 原始像素宽高 → 气泡该多大（rpx）。宽或高有一个不是正数就返回 null（不做除法）。
     *
     * 三条约束，顺序不能换：
     *   ① 常规图按 IMG_MAX_W 宽等比缩；
     *   ② 高度超 IMG_MAX_H（长截图）就先封高、宽度按比例变窄 —— 这才是"长图缩小气泡"；
     *   ③ 很窄的原图不要放大（表情包按原尺寸显示才不糊）。
     * 宽度算出来过窄时兜到 IMG_MIN_W，只影响气泡宽度，图本身仍是整张（aspectFit）。
     *
     * ★ 为什么抽成纯函数：发送方写进 meta 的 w/h 和渲染方量到的 w/h 必须走同一套算法，
     *   否则同一条消息在"刚发出"和"下一轮刷新"两个时刻会差几 rpx，看起来就是气泡抖一下。
     */
    boxFromNative(nw, nh) {
      if (!(nw > 0) || !(nh > 0)) return null
      const ratio = nh / nw
      let w = IMG_MAX_W
      let h = Math.round(IMG_MAX_W * ratio)
      if (h > IMG_MAX_H) {
        h = IMG_MAX_H
        w = Math.round(IMG_MAX_H / ratio)
      }
      const nativeW = Math.round((nw * 750) / (this.winW || 375))
      if (nativeW > 0 && nativeW < w) {
        w = nativeW
        h = Math.round(nativeW * ratio)
      }
      if (w < IMG_MIN_W) w = IMG_MIN_W
      // 兜底再判一次：IMG_MIN_W 这类常量的兜底也可能算出非正数，
      // 宁可退回占位高度也不要写一个 0/NaN 进去（NaN 的 style 会让气泡整块塌掉）
      if (!(w > 0) || !(h > 0)) return null
      return { w: w, h: h }
    },

    /** 把量到的原始宽高记进 this.imgBox[displayUrl]（图片真下下来之后的权威值） */
    setImgBox(m, nw, nh) {
      if (!m || !m.displayUrl) return
      const box = this.boxFromNative(nw, nh)
      if (!box) return
      const key = m.displayUrl
      const old = this.imgBox[key]
      if (old && old.w === box.w && old.h === box.h) return
      this.imgBox[key] = box
    },

    /**
     * 消息 meta 里带来的像素宽高折成气泡尺寸（发送方量的）。
     * 老消息没有 meta、云端把非法值丢掉了、或图不是 image 类型 → 返回 null，
     * 渲染自然退回"等量到再撑开"的老路径。
     */
    metaBox(m) {
      if (!m || m.type !== 'image') return null
      let obj = m.meta
      if (typeof obj === 'string') {
        if (!obj) return null
        try {
          obj = JSON.parse(obj)
        } catch (e) {
          return null
        }
      }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
      // Number(undefined)=NaN，下面的 > 0 判定会把它挡掉，不用另外判类型
      return this.boxFromNative(Number(obj.w), Number(obj.h))
    },

    /** 这张图的比例是否已经确定：量到的优先，发送方写进 meta 的也算 */
    hasImgBox(m) {
      if (!m) return false
      const box = m.displayUrl ? this.imgBox[m.displayUrl] : null
      if (box && box.w > 0 && box.h > 0) return true
      // ★ meta 里的 w/h 也算"已知"：imagesSettled() 靠它把这类图直接放行，
      //   首屏不再为它们空等 1.5 秒硬上限；等待只对真正量不到的图还有意义。
      // ★ 顺带让模板里的探针不再出现：这类图第一帧就按真实比例画出来，没有白框。
      return !!this.metaBox(m)
    },

    /**
     * 主动量一张图的原始尺寸。
     *
     * ★ 为什么除了 @load 还要这一条：模板里的探针依赖 image 的 load 事件，
     *   个别端对已缓存/本地文件不回调 load，那这张图就永远不会渲染。
     *   在拿到 displayUrl 的那一刻直接问一次系统，是最稳的来源。
     *   失败什么都不做 —— 探针那一路还会再试一次。
     */
    measureImage(m) {
      if (!m || !m.displayUrl || this.hasImgBox(m)) return
      const self = this
      uni.getImageInfo({
        src: m.displayUrl,
        success(info) {
          self.setImgBox(m, Number(info.width) || 0, Number(info.height) || 0)
        }
      })
    },

    /** 图片气泡的内联尺寸：量到的 > 消息 meta 带来的 > 占位高度 */
    imgStyle(m) {
      const box = (m && m.displayUrl && this.imgBox[m.displayUrl]) || this.metaBox(m)
      const w = box ? box.w : IMG_PLACEHOLDER_W
      const h = box ? box.h : IMG_PLACEHOLDER_H
      return 'width:' + w + 'rpx;height:' + h + 'rpx;'
    },

    /**
     * 图片加载完成。
     *
     * ★ 为什么需要它：首帧定位时图片还没下载完，气泡只有占位高度（IMG_PLACEHOLDER_H）；
     *   真实尺寸算出来之后底部会被推出屏幕，用户还得往下滑一下。
     *
     * ★ 三个前置条件，缺一不可：
     *   ① firstAnchorDone —— 首帧定位已经做过（否则这次贴底会和首帧定位打架）；
     *   ② autoStick —— 用户仍在跟随底部（往上翻历史时不能被拉回去）；
     *   ③ 首次贴底后 3 秒内 —— 时间窗口。超过 3 秒用户已经在读了，
     *      再被图片加载拽回底部就是 bug。
     *
     * ★ 这里只看 autoStick，不再有"首帧后 3 秒内"的时间窗口 ——
     *   图片往往 3 秒后才下载完，那个窗口正是"进来没在底部"的根因。
     */
    onImgLoad(e, m) {
      // ★ 先按图片真实宽高比把气泡尺寸算出来，再判断要不要补贴 ——
      //   顺序反了会拿旧高度去算滚动位置，图一撑开又差一截。
      this.applyImgBox(e, m)
      // 每张图量到比例都看一眼：这一屏最后一张量完时就把消息区放出来
      this.maybeReveal()
      // ★ 气泡尺寸是图片加载完才算出来的（setImgBox）：算出来之前只有占位高度，
      //   算出来之后高度可能变好几次，内容一变高，最后一条消息就被推出视野 ——
      //   用户看到的就是"进来没在底部，还得自己往下滑"。
      //   所以只要还处在跟随状态，每张图加载完都要重新贴底。
      //   以前这里有个「首帧后 3 秒内才补贴」的窗口，但图片走本地文件/网络下载，
      //   往往 3 秒后才到 —— 那个窗口正是这条 bug 的根因，已删除。
      if (!this.firstAnchorDone) return
      if (!this.autoStick) return
      // ★ 合并而不是丢弃：一屏多张图会连续回调，每张都滚既费性能也没必要；
      //   但如果"120ms 内的直接 return"，最后一张带来的高度变化就被丢了，
      //   那恰好是用户最需要贴底的那一次。所以挂一个短定时器，到点只滚一次。
      const self = this
      if (this.imgStickTimer) clearTimeout(this.imgStickTimer)
      this.imgStickTimer = setTimeout(function () {
        self.imgStickTimer = null
        // ★ 只判「挂定时器那一刻」的状态不够：80ms 内用户完全可能已经上手了。
        //   到点必须再判一次，否则就是"能滑了，但滑上去又被拖回来一次"。
        if (self.userTookOver || !self.autoStick) return
        // ★ 进页面后的头 2 秒用「无动画锚底」：这时图片正一张张量到真实高度，
        //   如果走 scrollToEnd（scroll-into-view 带动画），用户看到的就是
        //   「进页面没在最底部，然后一路往下滚到底」。
        //   锚底是瞬时定位，视觉上就是"一直贴着底部"，没有滚动过程。
        if (Date.now() - (self.firstAnchorAt || 0) < 2000) {
          self.anchorBottomNoAnimation()
        } else {
          self.scrollToEnd()
        }
      }, 80)
    },

    /* ================= 好友申请卡片 ================= */

    /** 卡片当前状态。fr_status 由 message-list 现查补上，缺省按已失效处理 */
    frState(m) {
      const s = m.fr_status
      if (s === 'pending' || s === 'accepted' || s === 'rejected' || s === 'canceled') return s
      return 'gone'
    },

    frTitle(m) {
      const s = this.frState(m)
      if (s === 'accepted') return '已成为好友'
      if (s === 'rejected') return '好友申请被拒绝'
      if (s === 'canceled') return '好友申请已撤回'
      // 收到的是"邀请"，发出的是"申请" —— 两个词就把谁在等谁说清了
      return m.fr_from_id === this.myUid() ? '好友申请' : '好友邀请'
    },

    frBody(m) {
      const s = this.frState(m)
      const me = this.myUid()
      if (s === 'pending') {
        // 谁发的决定文案：自己发的是「等待对方同意」，收到的是「对方想加你」
        return m.fr_from_id === me
          ? '已发出，等待对方同意'
          : '对方想加你成为好友'
      }
      if (s === 'accepted') return '你们现在是好友了'
      if (s === 'rejected') return '对方拒绝了好友申请'
      if (s === 'canceled') return '好友申请已撤回'
      return '这条申请已失效'
    },

    /** 底部状态条文案：发出方是等，接收方是"请你处理" */
    frBarText(m) {
      return m.fr_from_id === this.myUid() ? '等待对方回应' : '等待你回应'
    },

    /** 只有「别人发给我、且还没处理」的申请才给按钮 */
    frCanAct(m) {
      return this.frState(m) === 'pending' && m.fr_from_id !== this.myUid()
    },

    /**
     * 同意 / 拒绝好友申请。
     * 入参字段名按 friend-request 的 accept / reject 分支：{ token, action, request_id }。
     * 成功后只改本地这条消息的状态，不整页重拉 —— 重拉会让聊天记录闪一下、滚动位置也丢。
     */
    async onFriendRequest(m, action) {
      if (this.frBusy) return
      const requestId = m.fr_request_id
      if (!requestId) {
        uni.showToast({ title: '这条申请已失效', icon: 'none' })
        return
      }
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
        return
      }

      this.frBusy = true
      try {
        const res = await uniCloud.callFunction({
          name: 'friend-request',
          data: { token: token, action: action, request_id: requestId }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '操作失败', icon: 'none', duration: 2500 })
          return
        }
        const idx = this.messages.findIndex(function (x) {
          return x.key === m.key
        })
        if (idx > -1) {
          this.$set(
            this.messages,
            idx,
            Object.assign({}, this.messages[idx], {
              fr_status: action === 'accept' ? 'accepted' : 'rejected'
            })
          )
        }
        uni.showToast({ title: action === 'accept' ? '已添加好友' : '已拒绝', icon: 'none' })
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      } finally {
        this.frBusy = false
      }
    },

    /**
     * 刷新本地 pending 卡片的状态。
     *
     * 为什么需要：卡片消息本身不会再变，而 transport 的增量轮询只拉
     * 「比 lastMessageId 更新的消息」—— 早就加载过的那条永远不会重新拉一次。
     * 不主动问，发申请的人就会一直停在「等待对方同意」，只能退出重进。
     *
     * 失败静默：这只是一次状态补刷，不能反过来影响聊天。
     */
    async refreshFriendRequestStates() {
      // 上一轮还没回来就别再发：轮询 3 秒一轮，网络慢时请求会叠加
      if (this.frRefreshing) return
      // 节流：onLoaded 每轮空轮询都会触发（3~10 秒一次），
      // 不节流的话「等对方同意」这件事会让每个开着聊天页的用户
      // 每 3 秒多发一个请求。10 秒一次足够及时，也不至于翻倍。
      const nowTs = Date.now()
      if (this.frRefreshAt && nowTs - this.frRefreshAt < 10000) return
      this.frRefreshAt = nowTs

      const ids = []
      for (const m of this.messages) {
        if (m.type !== 'friend_request') continue
        if (m.fr_status !== 'pending') continue
        const id = m.fr_request_id
        if (!id) continue
        if (ids.indexOf(id) > -1) continue
        ids.push(id)
      }
      // 绝大多数会话没有卡片：一个都没有就直接返回，不白发请求
      if (!ids.length) return

      const token = uni.getStorageSync('token') || ''
      if (!token) return

      this.frRefreshing = true
      try {
        const res = await uniCloud.callFunction({
          name: 'friend-request',
          data: { token: token, action: 'status', request_ids: ids.slice(0, 50) }
        })
        const r = res.result || {}
        if (r.code !== 0) return
        const map = (r.data && r.data.map) || {}
        const self = this
        this.messages.forEach(function (m, i) {
          if (m.type !== 'friend_request') return
          if (m.fr_status !== 'pending') return
          const hit = map[m.fr_request_id]
          if (!hit) return
          const st = hit.status || ''
          // 状态没变就不动：$set 会触发重渲染，没变化的重渲染是纯浪费
          if (st === m.fr_status) return
          self.$set(
            self.messages,
            i,
            Object.assign({}, m, {
              fr_status: st,
              fr_from_id: hit.from_user_id || m.fr_from_id,
              fr_to_id: hit.to_user_id || m.fr_to_id
            })
          )
        })
      } catch (e) {
        console.log('chat: 刷新好友申请状态失败', e && e.message)
      } finally {
        this.frRefreshing = false
      }
    },

    /**
     * 把消息里 cloud:// 的 fileID 批量换成临时 URL。
     *
     * 为什么必须做：支付宝云 uploadFile 返回的 fileID 是 cloud:// 形式，
     * 不是可以直接访问的链接（官方文档：阿里云返回链接形式可直接用，
     * 支付宝云与腾讯云需调用 getTempFileURL 换链接）。直接塞给 <image> 就是白框。
     *
     * 为什么批量：一屏 30 条消息里可能有 10 张图，逐张调用要发 10 次请求，
     * 免费版 1.5 万次/月的额度撑不住。这里一次请求全换。
     *
     * 为什么要有缓存：轮询每 3 秒回来一次，如果每次都重新换一遍，
     * 额度和流量都会爆。tempFileURL 有效期内（默认约 2 小时）直接复用。
     */
    async resolveFileURLs() {
      const self = this
      // 收集需要换链接的图片消息。
      // ★ 判据是显式的 resolved 标记，不是「displayUrl 是否为空」：
      //   自己刚发的图，乐观气泡里 displayUrl 是本地临时路径（filePath），
      //   非空但并不是云链接，重启后会被系统清掉。
      //   按「非空就跳过」会让这张图永远换不成云链接，重启后要白一下才显示。
      const pending = self.messages.filter(function (m) {
        return m.type === 'image' && isCloudFileID(m.content) && !m.resolved
      })
      if (!pending.length) return

      // 查询顺序：手机上已存的文件 → 内存链接 → 本地存储链接 → 才发请求
      // 最理想的是命中已存文件：直接用 file:// 本地路径渲染，图片一个字节都不下载。
      const needFetch = []
      pending.forEach(function (m) {
        const local = getLocalImage(m.content)
        if (local) {
          m.displayUrl = local
          m.resolved = true
          return
        }
        const hit = self.urlCache[m.content] || getImageUrl(m.content)
        if (hit) {
          m.displayUrl = hit // 直接改对象属性，Vue2 对已存在属性是响应式的
          m.resolved = true
          self.urlCache[m.content] = hit
          // 已经拿到云链接了，顺手把它存成本地文件，下次就不用下载了
          self.saveToLocal(m.content, hit)
        } else {
          needFetch.push(m.content)
        }
      })
      if (!needFetch.length) return

      // 去重后一次请求
      const uniq = needFetch.filter(function (v, i, arr) {
        return arr.indexOf(v) === i
      })

      // 换到的链接先攒起来，一次写进本地存储（避免每张图各写一遍）
      const saved = {}
      // ★ 分批请求。一次把几十个 fileID 丢过去，只要其中一个 fileID 已失效
      //   （图片被删、fileID 拼错），整批都可能失败 → 这一屏的图全部白屏。
      //   分小批 + 批间互不影响，坏的那张只影响它自己。
      const BATCH = 20
      for (let b = 0; b < uniq.length; b += BATCH) {
        const batch = uniq.slice(b, b + BATCH)
        try {
          const res = await uniCloud.getTempFileURL({ fileList: batch })
          const list = (res && res.fileList) || []
          list.forEach(function (item) {
            const id = item.fileID
            const url = item.tempFileURL
            // fileID 无效时 SDK 会把 tempFileURL 填成原 fileID，这种要丢掉
            if (id && url && url !== id) {
              self.urlCache[id] = url
              self.$set(self.urlCache, id, url)
              // ★ 落本地存储：下次进页面不再为这些图发请求
              saved[id] = url
            }
          })
        } catch (e) {
          // 单批失败不影响其它批：换链接失败不该让整个聊天页崩掉
          console.warn('[chat] getTempFileURL 单批失败', e)
        }
      }
      if (Object.keys(saved).length) putImageUrls(saved)
      // 回填到消息上（含本地路径那批：现在被换成云链接了）
      self.messages.forEach(function (m) {
        if (m.type === 'image' && isCloudFileID(m.content) && !m.resolved) {
          const url = self.urlCache[m.content]
          if (url) {
            m.displayUrl = url
            m.resolved = true
            m.imgFailed = false // 拿到可用链接了，把失败标记清掉
            self.measureImage(m) // 立刻量原始尺寸，不等探针的 load
          }
        }
      })
      // ★ 再把这一批云链接的图存到手机本地。
      //   存好之后 displayUrl 会被换成 file:// 本地路径，
      //   以后再进这个会话，这几张图直接读本地文件，完全不联网。
      //   下载是后台排队做的（最多 3 张并发），不阻塞本次渲染。
      Object.keys(saved).forEach(function (id) {
        self.saveToLocal(id, saved[id])
      })
      // 原图链接到手之后再单独补缩略图（另一批 fileID，失败只影响清晰度）
      self.resolveThumbs()
    },

    /* 批量换缩略图链接：把这一屏里还没有 thumbUrl 的图片收集起来，一次请求换完。
       为什么单独一批而不是和原图混在一起：
         老消息根本没有 _t 文件，混在一起时一旦整批报错，连原图都换不出来。
       找不到链接的消息保持 thumbUrl 为空，渲染自动回退原图。 */
    resolveThumbs() {
      const self = this
      const ids = []
      this.messages.forEach(function (m) {
        if (m.type !== 'image' || m.imgFailed) return
        if (m.thumbUrl || !isCloudFileID(m.content)) return
        const tid = thumbIdOf(m.content)
        if (!tid) return
        const hit = self.urlCache[tid] || getImageUrl(tid)
        if (hit) {
          m.thumbUrl = hit
          return
        }
        if (ids.indexOf(tid) < 0) ids.push(tid)
      })
      if (!ids.length) return
      uniCloud
        .getTempFileURL({ fileList: ids })
        .then(function (res) {
          const list = (res && res.fileList) || []
          const map = {}
          for (let i = 0; i < list.length; i++) {
            const it = list[i]
            if (it && it.tempFileURL && it.tempFileURL !== it.fileID) map[it.fileID] = it.tempFileURL
          }
          if (!Object.keys(map).length) return
          putImageUrls(map)
          self.messages.forEach(function (m) {
            if (m.type !== 'image' || !m.content) return
            const tid = thumbIdOf(m.content)
            if (tid && map[tid]) {
              m.thumbUrl = map[tid]
              if (!self.urlCache) self.urlCache = {}
              self.urlCache[tid] = map[tid]
            }
          })
        })
        .catch(function (e) {
          console.warn('[chat] 缩略图批量换链失败', e && e.message)
        })
    },

    /**
     * 把一张图下载并存到手机本地，存好后把气泡的 displayUrl 换成本地路径。
     * 失败无副作用：图片继续用云链接显示，只是下次还得再下一次。
     */
    saveToLocal(fileID, url) {
      const self = this
      ensureLocalImage(fileID, url, function (id, localPath) {
        self.messages.forEach(function (m) {
          if (m.type === 'image' && m.content === id) {
            m.displayUrl = localPath
            m.resolved = true
            self.measureImage(m)
          }
        })
      })
    },

    /* ================= 聊天增强（契约 §5.1）================= */

    /**
     * 拉一次「我和对方是什么关系」，同时决定顶部提示条和搭子标签。
     * 入参字段按 user-profile 的约定：{ token, user_id }，
     * 关系三态在返回体顶层 relation_state（'friend' | 'unfriended' | 'none'）。
     * ★ 不再看 is_friend：解除好友是把关系行删掉，is_friend:false 分不清
     *   "从来不是好友的搭子"和"当过好友又解除的"，三态只能由云函数给。
     * 失败静默：peerRelation 保持空串、搭子标签保留 onLoad 从导航参数拿到的快照，
     * 页面表现与改造前完全一致（不许因为一次请求失败把标签变空白）。
     */
    async loadPeerRelation() {
      if (this.isAi || !this.peerId) return
      const token = uni.getStorageSync('token') || ''
      if (!token) return
      try {
        const res = await uniCloud.callFunction({
          name: 'user-profile',
          data: { token: token, user_id: this.peerId }
        })
        const r = res.result || {}
        if (r.code !== 0) return
        const d = r.data || {}
        // ★ 只认这三个值，其它（字段缺失 / 云端还是老版本）一律当未知：
        //   peerRelation 保持空串，提示条不显示、标签留在导航参数那份快照上。
        const st = d.relation_state
        if (st !== 'friend' && st !== 'unfriended' && st !== 'none') return
        this.peerRelation = st
        // 搭子标签：只有"从来不是好友"这一态才显示，与消息列表口径一致 ——
        // 成为好友、或者当过好友又解除，一律收掉，否则解除好友后标签还挂在那儿。
        // ★ 单标签兜底也必须在这里一并收掉：模板 40-45 行是 v-else-if="tag"，
        //   tags 一清空它就接手，把导航参数带进来的那个旧标签原样画出来 ——
        //   只清 tags 等于只关了"多搭子"，"单搭子"照样挂着，缺陷等于没修。
        //   导航参数只有"云端没给数据"时才算真相（失败/未知走上面那条 return，不动标签）。
        this.tag = ''
        this.tagColor = ''
        if (st !== 'none') {
          this.tags = []
          return
        }
        // 每条关系带 my_label / my_label_color（云函数只下发我这一侧的私有备注），
        // 映射成模板在用的 { label, color }；空 label 过滤掉，避免冒出空气泡。
        const rels = Array.isArray(d.relations) ? d.relations : []
        this.tags = rels
          .map((rel) => ({
            label: (rel && rel.my_label) || '',
            color: (rel && rel.my_label_color) || ''
          }))
          .filter((t) => t.label)
      } catch (e) {
        /* 网络失败：保持 ''，不弹 toast（进页面就弹窗最招人烦） */
      }
    },

    /** 提示条「加为好友」：走 friend-request 的 send 分支 */
    async addFriend() {
      if (!this.peerId) {
        uni.showToast({ title: '资料加载中，稍后再试', icon: 'none' })
        return
      }
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'friend-request',
          data: { token: token, action: 'send', to_user_id: this.peerId, source: 'search' }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          // 「你们已经是好友了」「你已经发过申请了」这些文案都在云函数里，原样透出
          uni.showToast({ title: r.msg || '发送失败', icon: 'none', duration: 2500 })
          return
        }
        uni.showToast({ title: '好友申请已发出', icon: 'none' })
        // 申请发出去了，对方还没同意 —— 提示条继续留着，等下次进页面重新判关系
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      }
    },

    /** 提示条「加入黑名单」：二次确认后再调 user-block 的 add 分支 */
    blockPeer() {
      if (!this.peerId) return
      const self = this
      uni.showModal({
        title: '加入黑名单',
        content: '加入后对方将无法给你发消息，好友关系也会解除。',
        confirmText: '加入',
        confirmColor: '#e5484d',
        success(res) {
          if (res.confirm) self.doBlockPeer()
        }
      })
    },

    async doBlockPeer() {
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'user-block',
          data: { token: token, action: 'add', target_user_id: this.peerId }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '操作失败', icon: 'none', duration: 2500 })
          return
        }
        uni.showToast({ title: '已加入黑名单', icon: 'none' })
        // 拉黑后云函数会把好友关系解掉（走 friend-unlink 那条路）。
        // ★ 只有本来确实是好友的才降级成 'unfriended'：从来不是好友的人被拉黑，
        //   关系一点没变，凭空写 'unfriended' 会谎报"你们当过好友"。
        if (this.peerRelation === 'friend') this.peerRelation = 'unfriended'
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      }
    },

    /* 长按必须「按住不动」才算数。
       @longpress 只判按住时长，不看手指有没有移动：滚聊天记录时只要按住超过阈值，
       每滑一下都会弹一次「删除/举报」。所以自己记起点，位移超过 10px 就判为滑动，
       长按回调进来直接返回。
       10px 是「手抖能过、滑屏必拦」之间的取值：正常滑动一屏位移几百 px，
       按住时的轻微抖动通常不超过 5px。 */
    onHitStart(e) {
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
      this.hitFrom = t ? { x: t.clientX, y: t.clientY } : null
      this.hitMoved = false
    },
    onHitMove(e) {
      if (this.hitMoved || !this.hitFrom) return
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0])
      if (!t) return
      const dx = Math.abs(t.clientX - this.hitFrom.x)
      const dy = Math.abs(t.clientY - this.hitFrom.y)
      if (dx > 10 || dy > 10) this.hitMoved = true
    },
    onHitEnd() {
      // 松手就复位：下一次按下重新开始判定（长按回调可能在 touchend 之后才到，
      // 所以这里只清起点、不清 moved）
      this.hitFrom = null
    },
    onHitLongPress(m) {
      // 滑过就不认这次长按
      if (this.hitMoved) return
      this.openMsgMenu(m)
    },

    /**
     * 长按消息 → 菜单。
     * 菜单项按契约 §5.1 动态拼：复制只有文字消息才有，撤回只有自己发的、且 2 分钟内才有。
     * 用 uni.showActionSheet 而不是自绘弹层：系统弹层在小程序/App 上都免费可用，
     * 自绘还得处理安全区、点穿、滚动锁，收益不成比例。
     */
    openMsgMenu(m) {
      if (!m) return
      const items = []
      const actions = []
      if (m.type === 'text' && !m.recalled && m.content) {
        items.push('复制')
        actions.push('copy')
      }
      if (this.canRecall(m)) {
        items.push('撤回')
        actions.push('recall')
      }
      items.push('举报')
      actions.push('report')
      items.push('删除')
      actions.push('delete')

      const self = this
      uni.showActionSheet({
        itemList: items,
        success(res) {
          const act = actions[res.tapIndex]
          if (act === 'copy') self.copyMsg(m)
          else if (act === 'recall') self.recallMsg(m)
          else if (act === 'report') self.reportMsg(m)
          else if (act === 'delete') self.deleteMsg(m)
        }
      })
    },

    /** 撤回条件：自己发的 + 没撤回 + 2 分钟内。窗口常量与 message-recall 一致 */
    canRecall(m) {
      if (!m || m.recalled) return false
      if (!m.is_me) return false
      const ts = m.created_at || 0
      if (!ts) return false
      return Date.now() - ts <= RECALL_WINDOW_MS
    },

    copyMsg(m) {
      uni.setClipboardData({
        data: String(m.content || ''),
        success() {
          uni.showToast({ title: '已复制', icon: 'none' })
        }
      })
    },

    async recallMsg(m) {
      if (!m._id) {
        uni.showToast({ title: '这条消息还没发出去', icon: 'none' })
        return
      }
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
        return
      }
      try {
        const res = await uniCloud.callFunction({
          name: 'message-recall',
          data: { token: token, message_id: m._id }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          uni.showToast({ title: r.msg || '撤回失败', icon: 'none', duration: 2500 })
          return
        }
        const d = r.data || {}
        // 只改本地这一条，不整页重拉：重拉会让聊天记录闪一下、滚动位置也丢
        const idx = this.messages.findIndex(function (x) {
          return x.key === m.key
        })
        if (idx > -1) {
          this.$set(
            this.messages,
            idx,
            Object.assign({}, this.messages[idx], {
              recalled: true,
              recalled_at: d.recalled_at || Date.now(),
              content: ''
            })
          )
        }
      } catch (e) {
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      }
    },

    /** 举报：跳举报页。report 页 onLoad 取 type / id / name 三个参数 */
    reportMsg(m) {
      const label = m.type === 'text' ? String(m.content || '').slice(0, 20) : '这条消息'
      uni.navigateTo({
        url:
          '/pages/report/report?type=message&id=' +
          encodeURIComponent(m._id || '') +
          '&name=' +
          encodeURIComponent(label)
      })
    },

    /** 删除：只从我这一侧移除，不调云函数（物理删对方的消息是另一套契约，这里不做） */
    deleteMsg(m) {
      const self = this
      uni.showModal({
        title: '删除这条消息',
        content: '只在你这一侧删除，不影响对方。',
        success(res) {
          if (!res.confirm) return
          const idx = self.messages.findIndex(function (x) {
            return x.key === m.key
          })
          if (idx > -1) self.messages.splice(idx, 1)
          // 记进本机黑名单：否则下一轮轮询会把它原样推回来（见 loadHidden 注释）
          self.markHidden(m._id)
          self.markHidden(m.clientMsgId)
          self.scheduleSnapshot()
        }
      })
    },

    /**
     * 把 message-list 新加的字段贴到本地气泡上。
     * 单独一个方法而不是塞进 mergeMessages：那边是去重 + 首帧定位的核心，
     * 本会话反复修过，一行都不动更安全。
     */
    applyMsgMeta(list) {
      if (!Array.isArray(list) || !list.length) return
      const byId = {}
      list.forEach(function (s) {
        if (s && s._id) byId[s._id] = s
      })
      this.messages.forEach(function (m, i) {
        const s = byId[m._id]
        if (!s) return
        const recalled = s.recalled === true
        const duration = typeof s.duration === 'number' ? s.duration : 0
        // 没变化就不 $set：轮询 3 秒一轮，无变化的重渲染是纯浪费
        if (m.recalled === recalled && (m.duration || 0) === duration) return
        const patch = { recalled: recalled, duration: duration }
        if (recalled) patch.content = ''
        this.$set(this.messages, i, Object.assign({}, m, patch))
      }, this)
    },

    /**
     * 刷对方的已读游标。
     * ★ 为什么不放进 transport：transport 的 7 个接口是给「收消息」用的，
     *   已读回执是另一条信息，硬塞进去会污染它的语义（06 文档铁律）。
     *   这里直接调 message-list —— 它本来就顺手返回 peer_last_read_message_id，
     *   但 transport 只把 data 交给页面，外层字段被它吃掉了。
     *   节流 5 秒：轮询 3 秒一轮，不节流等于把请求翻倍。
     */
    async refreshPeerRead() {
      if (this.isAi || !this.conversationId) return
      // 已知不是好友（解除过 / 从来不是）不显示已读回执，就没必要为它发请求；
      // 未知('')照常请求 —— 保持改造前行为，不拿"没查到"当"不是好友"。
      if (this.peerRelation === 'unfriended' || this.peerRelation === 'none') return
      const nowTs = Date.now()
      if (this.peerReadAt && nowTs - this.peerReadAt < 5000) return
      const token = uni.getStorageSync('token') || ''
      if (!token) return
      this.peerReadAt = nowTs
      // 起点用本地最后一条：增量拉取通常返回空数组，只是顺手把
      // peer_last_read_message_id 带回来。传空串会每次都把最近 30 条全拉一遍。
      const last = this.messages.length ? this.messages[this.messages.length - 1]._id || '' : ''
      try {
        const res = await uniCloud.callFunction({
          name: 'message-list',
          data: { token: token, conversationId: this.conversationId, lastMessageId: last }
        })
        const r = res.result || {}
        if (r.code !== 0) return
        this.peerLastReadId = r.peer_last_read_message_id || ''
      } catch (e) {
        /* 失败静默：已读回执降级成「未读」，不影响聊天 */
      }
    },

    /** 我发的最后一条才显示已读回执；已知不是好友（解除过 / 从来不是）不显示 */
    showReadReceipt(m) {
      if (this.isAi) return false
      if (this.peerRelation === 'unfriended' || this.peerRelation === 'none') return false
      if (!m || m.recalled || !m.is_me) return false
      return this.lastMineMsgKey === m.key
    },

    readReceiptText(m) {
      if (!m._id) return '未读'
      return this.peerLastReadId && this.peerLastReadId === m._id ? '已读' : '未读'
    },

    /* ---------- 消息搜索 ---------- */

    openSearch() {
      this.searchOpen = true
      this.searchKeyword = ''
      this.searchResults = []
    },

    closeSearch() {
      this.searchOpen = false
      this.searching = false
    },

    async doSearch() {
      const kw = String(this.searchKeyword || '').trim()
      if (!kw) return
      const token = uni.getStorageSync('token') || ''
      if (!token) {
        uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
        return
      }
      this.searching = true
      try {
        const res = await uniCloud.callFunction({
          name: 'message-search',
          data: { token: token, conversation_id: this.conversationId, keyword: kw, limit: 20 }
        })
        const r = res.result || {}
        if (r.code !== 0) {
          this.searchResults = []
          uni.showToast({ title: r.msg || '搜索失败', icon: 'none' })
          return
        }
        const d = r.data || {}
        this.searchResults = d.list || []
        this.avaSync(this.searchResults, (s) => 's' + s._id, (s) => s.avatar_url)
      } catch (e) {
        this.searchResults = []
        uni.showToast({ title: '网络不太好，再试一次', icon: 'none' })
      } finally {
        this.searching = false
      }
    },

    /**
     * 点搜索结果 → 关弹层、滚到那条、高亮 1.5 秒。
     * 滚动走页面已有的 scroll-into-view 锚点（消息节点 id 就是 'msg-' + key），
     * 不动 scrollToEnd / anchorBottomNoAnimation 的内部。
     */
    jumpToMessage(s) {
      this.closeSearch()
      if (!s || !s._id) return
      const idx = this.messages.findIndex(function (m) {
        return m._id === s._id
      })
      if (idx < 0) {
        uni.showToast({ title: '这条消息不在当前聊天记录里', icon: 'none' })
        return
      }
      const self = this
      const key = this.messages[idx].key
      // 这次滚动是我们发起的：锁住 onScroll 的跟随判定，
      // 否则滚到中途会被误判成「用户往上翻了」，autoStick 被关掉。
      this.stickLockUntil = Date.now() + 800
      this.$nextTick(function () {
        self.scrollInto = 'msg-' + key
        self.highlightKey = key
        if (self.highlightTimer) clearTimeout(self.highlightTimer)
        self.highlightTimer = setTimeout(function () {
          self.highlightTimer = null
          self.highlightKey = ''
        }, 1500)
      })
    },

    /* ---------- 语音 ---------- */

    onMicStart() {
      if (this.sending) return
      if (!isRecordSupported()) {
        uni.showToast({ title: '当前环境不支持录音', icon: 'none' })
        return
      }
      const self = this
      const ok = startRecord({
        onStop(res) {
          self.onRecordDone(res || {})
        },
        onError() {
          self.recording = false
          uni.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' })
        }
      })
      if (!ok) {
        uni.showToast({ title: '录音启动失败', icon: 'none' })
        return
      }
      this.recording = true
      this.recordStartAt = Date.now()
    },

    onMicEnd() {
      if (!this.recording) return
      this.recording = false
      // 时长以本地计时为准：onStop 返回的 duration 在个别端是 0
      this.recordStartAt = this.recordStartAt || Date.now()
      stopRecord()
    },

    /** 手指划走 / 来电打断：取消，不发送 */
    onMicCancel() {
      if (!this.recording) return
      this.recording = false
      this.recordStartAt = 0
      abortRecord()
    },

    /** 录音结束 → 上传 → 发一条 type='voice' 的消息 */
    async onRecordDone(res) {
      const tempPath = res.tempFilePath || ''
      const startedAt = this.recordStartAt || 0
      this.recordStartAt = 0
      if (!tempPath) return
      // 秒数取本地计时，夹在 1..MAX_VOICE_SEC 之间（message-send 会校验）
      let sec = Math.round((Date.now() - (startedAt || Date.now())) / 1000)
      if (!sec || sec < 1) {
        uni.showToast({ title: '说话时间太短', icon: 'none' })
        return
      }
      if (sec > MAX_VOICE_SEC) sec = MAX_VOICE_SEC
      if (this.sending) return
      this.sending = true
      uni.showLoading({ title: '上传中…' })
      try {
        const rand = Math.random().toString(36).slice(2, 10)
        const up = await uniCloud.uploadFile({
          filePath: tempPath,
          cloudPath: 'chat/' + this.conversationId + '/' + Date.now() + '-' + rand + '.mp3',
          fileType: 'audio'
        })
        uni.hideLoading()
        if (!up || !up.fileID) {
          uni.showToast({ title: '语音上传失败', icon: 'none' })
          return
        }
        await this.doSend({ type: 'voice', content: toCloudFileID(up.fileID), duration: sec })
      } catch (e) {
        uni.hideLoading()
        uni.showToast({ title: '语音上传失败', icon: 'none' })
      } finally {
        this.sending = false
      }
    },

    voiceDurText(m) {
      const d = parseInt(m.duration, 10)
      return (d > 0 ? d : 1) + '"'
    },

    /** 点语音气泡播放 / 再点停止。同一时刻只播一条 */
    playVoiceMsg(m) {
      if (!m || !m.content) return
      if (this.playingKey === m.key) {
        this.stopPlayVoice()
        return
      }
      const self = this
      // 语音的 content 是 cloud:// fileID，必须先换成可访问链接
      const url = this.urlCache[m.content] || getImageUrl(m.content) || m.content
      const ok = playVoice(url, {
        onEnded() {
          self.playingKey = ''
        },
        onError() {
          self.playingKey = ''
          uni.showToast({ title: '语音播放失败', icon: 'none' })
        }
      })
      if (ok) this.playingKey = m.key
    },

    stopPlayVoice() {
      this.playingKey = ''
      stopVoice()
    },

    colorHex(name) {
      return TAG_COLORS[name] || '#ffde00'
    },

    // 搭子标签固定形状是「前缀 + 搭子」，库里只存前缀，显示时补后缀。
    // 已带后缀的防重复，避免「啊哈哈搭子搭子」。
    tagText(raw) {
      const s = String(raw || '').trim()
      if (!s) return ''
      return s.slice(-2) === '搭子' ? s : s + '搭子'
    },

    /** 点顶部头像 / 名字 → 对方主页 */
  goPeer() {
    if (this.isAi) return
    if (!this.peerId) {
      uni.showToast({ title: '资料加载中，稍后再试', icon: 'none' })
      return
    }
    uni.navigateTo({
      url: '/pages/user/user?id=' + encodeURIComponent(this.peerId)
    })
  },

    /** 草稿本地保存：切出去接个电话回来，打了一半的字还在 */
    autoSaveDraft() {
      const key = 'chat_draft_' + this.conversationId
      this.draft = uni.getStorageSync(key) || ''
      this.$watch('draft', (v) => {
        uni.setStorageSync(key, v || '')
      })
    },
  },

  /**
   * 页面渲染完成再起轮询（不用 onLoad：onLoad 时页面还没挂载，
   * 首次 setData 可能被吞掉，气泡会闪一下才出现）。
   * initChat 内部有 running 判断，重复调是安全的。
   */
  onReady() {
    if (!this.isAi && this.conversationId && !this.chat) {
      this.initChat()
    }
  }
}
</script>

<style scoped>
/* 头像 + 名字一起点，热区大一点好点中 */
.bar-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.chat-wrap {
  /* ==========================================================================
     聊天气泡专用「浮起」变量（第一套敲定的设计）
     --------------------------------------------------------------------------
     为什么不直接用全局 --tf-lift：
     全局那个在 UI 整改时按文档 §2.3 改成了柔和弥散投影（卡片用，正确）。
     但气泡不是卡片 —— 气泡是「一张纸浮在页面上」的隐喻，必须有厚度。
     实心偏移（不加模糊）才读得出这张纸的边，模糊会把边缘糊掉。

     所以这里单独定义一组，只作用于聊天页，不影响其他页面。
     ========================================================================== */
  --bub-lift:      4rpx 4rpx 0 rgba(45, 42, 38, 0.42);   /* 大档：气泡 / 图片 */
  --bub-lift-sm:   2rpx 2rpx 0 rgba(45, 42, 38, 0.34);   /* 小档：小卡片 / 徽章 */
  --bub-line:      rgba(45, 42, 38, 0.30);               /* 配套的暗描边 */

  height: 100vh;
  display: flex;
  flex-direction: column;
  /* 透明：让 App.vue 的 page{} 渐变透上来，否则玻璃后面是一片平色 */
  background: transparent;
}

/* 自定义导航栏后的状态栏占位：高度由 JS 按机型注入，这里只保证不被压缩 */
.status-bar {
  flex: none;
  background: var(--tf-card);
}

/* —— 顶部条 —— */
.chat-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  /* 顶栏压在消息流上方，55% 白会透出底下的字 —— 提浓度并加模糊 */
  background: var(--tf-card-strong);
  border-bottom: 2rpx solid var(--tf-line-soft);
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  flex: none;
  /* 标签多的时候允许换行，不要把名字挤没 */
  flex-wrap: wrap;
}
/* 返回键：自定义导航栏后系统箭头没了，自己给一个 */
.bar-back {
  flex: none;
  font-size: 52rpx;
  line-height: 1;
  font-weight: 700;
  padding: 0 8rpx 4rpx 0;
}
.avatar-img {
  display: block;
  overflow: hidden;
  background: var(--tf-card-line);
}
.avatar {
  width: 76rpx;
  height: 76rpx;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 50%;
  background: var(--tf-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 30rpx;
  flex: none;
}
.avatar-ph {
  /* 头像拿不到时留的空位：只画一个淡色圆，不带笑脸、不带首字。
     用户明确要求过「加载不出来不要用默认头像顶替」。 */
  background: var(--tf-line-soft);
  border-color: transparent;
}
.avatar--orange {
  background: var(--tf-primary);
  /* 浅草绿上白字只有 2.2:1，改深绿黑 */
  color: #2E3A1E;
  font-size: 22rpx;
}
.bar-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.convo-name {
  font-weight: 800;
  font-size: 30rpx;
}
.bar-sub {
  font-size: 20rpx;
  color: var(--tf-text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.chat-buddy-tag {
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
  background: var(--tf-card-strong);
  padding: 2rpx 10rpx;
  font-size: 20rpx;
  font-weight: 700;
  flex: none;
}
.conn {
  font-size: 18rpx;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
  padding: 2rpx 8rpx;
  flex: none;
  color: var(--tf-text-2);
}
.conn--online {
  color: var(--tf-success);
  border-color: var(--tf-success);
}
.conn--offline {
  color: var(--tf-danger);
  border-color: var(--tf-danger);
}


/* —— 临时聊天提示条（契约 §5.1）——
   灰条 + 两个就地按钮。不用红色：关系断了不是错误，是状态。 */
.stranger-bar {
  flex: none;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 12rpx 24rpx;
  background: var(--tf-line-soft);
  border-bottom: 2rpx solid var(--tf-text-3);
}
.stranger-text {
  font-size: 22rpx;
  color: var(--tf-text-2);
  flex: none;
}
.stranger-actions {
  display: flex;
  flex-direction: row;
  gap: 12rpx;
  flex: none;
}
.stranger-btn {
  font-size: 22rpx;
  font-weight: 700;
  color: var(--tf-primary);
  padding: 4rpx 14rpx;
  border: 2rpx solid var(--tf-primary);
  background: var(--tf-card);
}
.stranger-btn--ghost {
  background: transparent;
  border: 2rpx solid var(--tf-primary);
  color: var(--tf-primary);
}
.stranger-btn--danger {
  color: var(--tf-danger);
  border-color: var(--tf-danger);
}

/* —— 消息区 —— */
.chat-scroll {
  flex: 1;
  /* 底边不留给 padding：那一截和页面同色，看起来就是输入框上方一条无用横条 */
  padding: 24rpx 24rpx 0;
  box-sizing: border-box;
  overflow: hidden;
  /* 首帧隐藏 → 锚定后 160ms 淡入（见 data.listReady）：
     scroll-view 初始位置恒在顶部，只有"先藏后排"才能做到第一眼就在底部。 */
  transition: opacity 160ms ease-out;
}
.chat-scroll--hidden {
  opacity: 0;
}
.chat-hint {
  text-align: center;
  color: var(--tf-text-2);
  font-size: 24rpx;
  padding: 60rpx 0;
}
/* 上拉到头的一行小字：与 .chat-hint 同一套 subdued 观感，但不占 60rpx 高 */
.earlier-end {
  text-align: center;
  color: var(--tf-text-2);
  font-size: 20rpx;
  padding: 16rpx 0;
}
/* 这个节点是 scroll-into-view 的落点（第一帧贴底靠它），不能删，只能压到几乎不可见：
   20rpx 的空白同样构成输入框上方那条横条 */
.chat-end-pad {
  height: 2rpx;
}

/* 一条消息 = 头像 + 气泡，横向排列（仿 QQ / 抖音）。
   对方的头像在左、自己的在右，靠 .is-me 把 flex-direction 反过来，
   这样模板里永远是"先头像后气泡"，不用写两套结构。 */
.bubble-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 14rpx;
  margin-bottom: 24rpx;
}
.bubble-row.is-me {
  flex-direction: row-reverse;
}

/* 搜索跳转后的高亮：1.5 秒后由 highlightKey 自动清掉。
   用背景色而不是边框，边框会让气泡位移、看起来像抖了一下。 */
.bubble-row--hl {
  background: var(--tf-primary-soft);
}

/* —— 撤回：居中灰字，不占头像位 —— */
.recall-row {
  display: flex;
  flex-direction: row;
  justify-content: center;
  margin-bottom: 24rpx;
}
.recall-text {
  font-size: 20rpx;
  color: var(--tf-text-2);
  background: var(--tf-line-soft);
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
}

/* —— 语音气泡 —— */
.bubble--voice {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10rpx;
  min-width: 120rpx;
}
.voice-icon {
  font-size: 24rpx;
  line-height: 1;
}
.bubble-row.is-me .voice-icon,
.bubble-row.is-me .voice-dur {
  color: #fff;
}
.voice-dur {
  font-size: 24rpx;
  color: var(--tf-text);
}

/* —— 已读回执 —— */
.bubble-read {
  font-size: 18rpx;
  color: var(--tf-text-2);
  padding-top: 4rpx;
}

/* —— 消息头像 —— */
.msg-avatar {
  width: 72rpx;
  height: 72rpx;
  flex: none;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 50%;
  background: var(--tf-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* 头像永远对齐气泡顶部，不随气泡高度居中 —— 长消息居中会显得很怪 */
  margin-top: 4rpx;
}
.msg-avatar--me {
  background: var(--tf-primary);
}
.msg-avatar-img {
  width: 100%;
  height: 100%;
}

/* 长按热区：只有气泡本体这一层能触发「删除/举报」（理由见模板注释）。
   宽度收缩到气泡本身，不铺满整行。 */
.bubble-hit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  max-width: 100%;
}
.bubble-col {
  max-width: 76%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.bubble-row.is-me .bubble-col {
  align-items: flex-end;
}
/* 气泡：非对称圆角是「谁在说话」的第二个线索（第一个是左右位置）。
   角收在**上**侧 —— 头像就在气泡上方那一侧，尖角朝上才指向说话的人；
   收在下侧会朝着气泡底部外扩，看着像被削掉一块。 */
/* ==========================================================================
   聊天页主色：晴空蓝
   --------------------------------------------------------------------------
   自己的气泡用蓝渐变 + 白字（#3B7ADB 白字 4.21、#2A5A94 白字 6.5，够读）。
   ========================================================================== */
.chat-wrap {
  /* 低饱和草绿：饱和度压下来，气泡才不刺眼 */
  --tf-primary:      #A0C476;
  --tf-primary-deep: #8FB86A;
  --tf-primary-soft: #E8F0D0;
}

.bubble {
  border: 2rpx solid var(--bub-line);
  /* 左上角小圆角 = 气泡的「小尖角」，指向发消息的人 */
  border-radius: 12rpx var(--tf-r-md) var(--tf-r-md) var(--tf-r-md);
  /* 对方气泡：暖白渐变（不是纯白）。
     第一套用的是「雾绿→白」的渐变，换成暖橙主色后，这里对应改成「白→极淡橙」，
     保留「有色彩倾向、能透出背景」的质感，而不是一块死白。
     浓度压到 .92→.72：再淡会被背后内容抢注意力，长文本读起来累。 */
  /* 对方气泡：白 → 极淡蓝，和本页的晴空蓝主色呼应 */
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.94) 0%, rgba(214, 228, 250, 0.74) 100%);
  /* 实心偏移：不加模糊，读得出厚度 */
  box-shadow: var(--bub-lift);
  padding: 18rpx 22rpx;
}
.bubble-row.is-me .bubble {
  /* 小尖角换到右上，指向自己 */
  border-radius: var(--tf-r-md) 12rpx var(--tf-r-md) var(--tf-r-md);
  /* 自己气泡：浅草绿渐变。末端用深一点的绿，让渐变有方向感。
     浅绿底上白字只有 2.2:1，文字必须用深绿黑。 */
  background: linear-gradient(140deg, #B6D28E 0%, #A6C87C 52%, #93BA68 100%);
  border-color: rgba(255, 255, 255, 0.55);
  box-shadow: var(--bub-lift), inset 0 2rpx 0 rgba(255, 255, 255, 0.45);
}
.bubble-text {
  font-size: 28rpx;
  line-height: 1.5;
  word-break: break-all;
}
.bubble-row.is-me .bubble-text {
  /* 深绿黑，比纯黑柔和，和草绿协调 */
  color: #2E3A1E;
}
/* 量尺寸用的探针：位置挪到屏幕外、透明，只为了拿到 @load 里的原始宽高比。
   它本身占 0 版面，用户在图片量好之前什么也看不到。 */
.bubble-probe {
  position: absolute;
  left: -9999rpx;
  top: 0;
  width: 380rpx;
  height: 8rpx;
  opacity: 0;
}
.bubble-img {
  /* ★ 宽高不在这里写死：由模板上的 :style="imgStyle(m)" 按图片原始比例给（见 setImgBox）。
     以前这里是 width:380rpx + min-height:380rpx + mode="widthFix"，
     结果长截图被拉成几屏高、方图又被 min-height 顶出上下空白 —— 都不算"自适应图片大小"。 */
  /* 尺寸只由 imgStyle 的内联样式给，且与图片原始比例完全一致。
     这里不能再写死 width/height —— 写死了就等于回到"先画一个 380×260 的盒子"，
     "图还没加载出来先冒出一个固定长宽的白框"就是这么来的。
     只留 flex:none 防止盒子被父级 column flex 压缩。 */
  flex: none;
  /* 暗色描边 + 实心偏移投影：图片像一张照片浮在页面上方。
     阴影不加模糊 —— 模糊会在浅底上散成灰晕，边缘反而变糊；
     实心偏移读得出「厚度」，这才是粗野主义那套立体感的来源。 */
  border: 2rpx solid var(--bub-line);
  border-radius: var(--tf-r-md);
  box-shadow: var(--bub-lift);
  /* aspectFit 留出的细边就是这个颜色，和气泡底色一致才看不出缝 */
  background: var(--tf-card);
  overflow: hidden;
}
/* 图片还没换到临时 URL（或换链接失败）时的占位，不能留一个纯白框 */
.bubble-img-ph {
  width: 380rpx;
  height: 260rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 与 .bubble-img 同款描边与投影，否则图片加载完成的一瞬间会"跳"一下 */
  border: 2rpx solid var(--bub-line);
  border-radius: var(--tf-r-md);
  box-shadow: var(--bub-lift);
  background: var(--tf-line-soft);
}
.bubble-img-ph-text {
  font-size: 24rpx;
  color: var(--tf-text-2);
}
/* ===== 好友申请卡片 =====
   宽度明显大于普通气泡（普通气泡最大 76%），因为里面要塞标题+正文+两个按钮。
   颜色沿用页面已有的 CSS 变量，不新造色值。 */
.fr-card {
  width: 460rpx;
  display: flex;
  flex-direction: column;
  padding: 20rpx 22rpx;
  border: 2rpx solid var(--bub-line);
  border-radius: var(--tf-r-md);
  box-shadow: var(--bub-lift);
  background: var(--tf-card);
}
.fr-card--accepted {
  background: #e9f9f1;
  border-color: var(--tf-success);
  box-shadow: 4rpx 4rpx 0 var(--tf-success);
}
.fr-title {
  font-size: 28rpx;
  font-weight: 800;
  color: var(--tf-text);
  line-height: 1.4;
}
.fr-card--accepted .fr-title {
  color: var(--tf-success);
}
.fr-body {
  font-size: 24rpx;
  color: var(--tf-text-2);
  line-height: 1.5;
  padding-top: 8rpx;
}
.fr-card--rejected .fr-title,
.fr-card--canceled .fr-title,
.fr-card--gone .fr-title {
  color: var(--tf-text-2);
}
.fr-actions {
  display: flex;
  flex-direction: row;
  gap: 14rpx;
  padding-top: 16rpx;
}
.fr-btn {
  flex: 1;
  height: 60rpx;
  line-height: 54rpx;
  font-size: 24rpx;
  font-weight: 700;
  text-align: center;
  border: 2rpx solid var(--tf-lift-line);
  border-radius: 999rpx;
  background: var(--tf-card-strong);
  box-shadow: var(--tf-lift-sm);
  padding: 0;
  margin: 0;
}
.fr-btn--main {
  background: var(--tf-primary);
  /* 浅草绿上白字看不清 */
  color: #2E3A1E;
}
/* pending 自己发出去的那张：没有按钮，给一条浅色状态条说明"在等" */
.fr-bar {
  margin-top: 14rpx;
  padding: 8rpx 14rpx;
  background: var(--tf-primary-soft);
  align-self: flex-start;
}
.fr-bar-text {
  font-size: 22rpx;
  color: var(--tf-primary);
}

.bubble-time {
  font-size: 18rpx;
  color: var(--tf-text-2);
  padding-top: 6rpx;
}
.bubble-retry {
  font-size: 20rpx;
  color: var(--tf-danger);
  padding-top: 6rpx;
  text-decoration: underline;
}

/* —— 输入区 —— */
.chat-input {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 18rpx 24rpx;
  background: var(--tf-card-strong);
  /* 原来这里有一条 2rpx 的 border-top（--tf-line-soft），和页面底色几乎一样、又没有分隔意义，
     用户点名要的「输入框上方那条无用横条」就是它之一，去掉。输入栏靠自身底色 + 模糊分层即可 */
  /* 消息从下面滚过，不模糊会跟输入栏文字糊在一起 */
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  flex: none;
}
.pic-btn {
  font-size: 40rpx;
  flex: none;
  padding: 0 6rpx;
}
/* 录音中：麦克风变成橙色，让「正在录」这件事有可见反馈 */
.mic-btn--on {
  color: var(--tf-primary);
}

/* —— 消息搜索弹层 —— */
/* 顶栏「…」更多菜单：底部弹出的操作表。
   ★ 这三条规则以前完全没写，菜单一打开就是三段没有样式的白字直接堆在输入栏下面
     （用 showMore 打开时节点确实会渲染，只是没有任何样式）—— 2026-11-02 补齐。
     遮罩 fixed 铺满、层级与 .search-mask 同一套。 */
.more-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 91;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.more-sheet {
  background: var(--tf-card-strong);
  border-top: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-md) var(--tf-r-md) 0 0;
  padding: 12rpx 24rpx 24rpx;
  /* 老 iOS 只认 constant，新的只认 env，必须先旧后新 */
  padding-bottom: calc(24rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
}
.more-item {
  height: 108rpx;
  line-height: 108rpx;
  text-align: center;
  font-size: 30rpx;
  color: var(--tf-text);
  border-bottom: 2rpx solid var(--tf-line-soft);
}
.more-item--danger {
  color: var(--tf-danger);
}
.more-item--cancel {
  margin-top: 12rpx;
  border-radius: var(--tf-r-md);
  border-bottom: 0;
  background: var(--tf-bg);
  color: var(--tf-text-2);
}
.search-mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 90;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}
.search-panel {
  background: var(--tf-card-strong);
  border-bottom: 2rpx solid var(--tf-line-soft);
  padding: 20rpx 24rpx;
  max-height: 70vh;
  backdrop-filter: var(--tf-glass-blur);
  -webkit-backdrop-filter: var(--tf-glass-blur);
  display: flex;
  flex-direction: column;
}
.search-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 14rpx;
}
.search-input {
  flex: 1;
  height: 68rpx;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-sm);
  background: rgba(255, 255, 255, 0.96);
  padding: 0 16rpx;
  font-size: 26rpx;
}
.search-cancel {
  flex: none;
  font-size: 24rpx;
  color: var(--tf-text-2);
}
.search-hint {
  text-align: center;
  color: var(--tf-text-2);
  font-size: 22rpx;
  padding: 36rpx 0;
}
.search-list {
  max-height: 56vh;
  padding-top: 12rpx;
}
.search-item {
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--tf-line-soft);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
}
.search-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.search-item-text {
  font-size: 26rpx;
  color: var(--tf-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.search-item-meta {
  font-size: 18rpx;
  color: var(--tf-text-2);
}
.input {
  flex: 1;
  height: 72rpx;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-sm);
  background: rgba(255, 255, 255, 0.96);
  padding: 0 18rpx;
  font-size: 28rpx;
}
.btn {
  border: 2rpx solid var(--tf-line-soft);
  border-radius: 999rpx;
  background: var(--tf-card-strong);
  box-shadow: var(--tf-lift-sm);
  font-weight: 700;
  flex: none;
}
.btn--orange {
  background: var(--tf-primary);
  border-color: rgba(255, 255, 255, 0.22);
  color: #fff;
}
.btn--sm {
  height: 72rpx;
  line-height: 66rpx;
  font-size: 28rpx;
  padding: 0 26rpx;
}

/* —— AI 免责声明：一直显示，不折叠 —— */
.ai-note {
  padding: 16rpx 24rpx 24rpx;
  background: var(--tf-card);
  flex: none;
}
.ai-note-text {
  font-size: 20rpx;
  color: var(--tf-text-2);
  line-height: 1.5;
}

/* —— 约局卡片 ——
   卡本体沿用 .bubble 的底/边/圆角，只收紧内边距：
   卡片是「键: 值」三行 + 一排按钮，用气泡那套 18rpx 上下内边距会显得很松。 */
.bubble--card {
  min-width: 420rpx;
  padding: 10rpx 20rpx 14rpx;
}

/* 一行「时间 / 地点 / 备注」：键给固定宽度，值吃掉余量，三行左边缘才对得齐 */
.sc-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 16rpx;
  padding: 8rpx 0;
}
.sc-k {
  flex: none;
  width: 64rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--tf-text-3);
}
.sc-v {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  line-height: 1.6;
  color: var(--tf-text);
  word-break: break-all;
}
/* 自己发的卡底是主色实色（见 .bubble-row.is-me .bubble），字要反过来 */
.bubble-row.is-me .sc-k {
  color: rgba(255, 255, 255, 0.72);
}
.bubble-row.is-me .sc-v {
  color: rgba(255, 255, 255, 0.98);
}

/* 按钮排：一条极细的分隔线把「内容」和「动作」分开，比纯留白清楚 */
.sc-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16rpx;
  margin-top: 6rpx;
  padding-top: 14rpx;
  border-top: 2rpx solid var(--tf-line-soft);
}
/* 主按钮：实心主色。触控高度给到 88rpx —— 两个按钮挨着放，
   小于这个值很容易点错 */
.sc-btn {
  min-height: 88rpx;
  padding: 0 34rpx;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2rpx solid transparent;
  border-radius: 999rpx;
  background: var(--tf-primary);
  color: rgba(255, 255, 255, 0.98);
  font-size: 26rpx;
  font-weight: 700;
}
/* 次按钮：只描边不填色，一眼看出「再说」是退路而不是主操作 */
.sc-btn--ghost {
  background: transparent;
  border-color: var(--tf-line-soft);
  color: var(--tf-text-2);
  font-weight: 600;
}
/* 请求进行中变灰：配合方法里的 _busy 守卫防连点 */
.sc-btn--off {
  opacity: 0.45;
}
/* 状态结论：比按钮轻一档，看起来像结论而不是可点的东西 */
.sc-status {
  font-size: 24rpx;
  color: var(--tf-text-2);
  padding: 20rpx 0;
}

/* —— 同频圈动态分享卡 ——
   和文本气泡同一个宽度约束（.bubble-col 的 76%），不撑满整行：
   它是一条"转发来的内容"，不该比正常聊天内容更抢位置。
   内边距归零 + overflow:hidden，封面才能顶到卡片边缘（看起来才像一张卡）。 */
.bubble--share {
  min-width: 420rpx;
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
/* 封面：固定 260rpx 高 + aspectFill。
   动态封面比例五花八门，让卡片高度随图变会一屏一个样，统一裁切更好扫读。 */
.share-cover-box {
  position: relative;
  width: 100%;
  height: 260rpx;
  flex: none;
}
.share-cover {
  display: block;
  width: 100%;
  height: 260rpx;
  background: var(--tf-line-soft);
}
.share-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6rpx;
  padding: 16rpx 20rpx 18rpx;
}
/* 角标：说明"这是什么"，但只用小一号字 + 主色软底，不抢正文注意力 */
.share-tag {
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background: var(--tf-primary-soft);
  color: var(--tf-primary-deep);
  font-size: 20rpx;
  line-height: 1.7;
}
/* 有封面时角标压在图的左上角：卡片顶部已经有图，再占一行就太挤 */
.share-tag--overlay {
  position: absolute;
  left: 12rpx;
  top: 12rpx;
  background: var(--tf-card);
}
.share-owner {
  font-size: 22rpx;
  line-height: 1.5;
  color: var(--tf-text-2);
}
/* 正文两行截断：转发的正文可能很长，卡片只负责"看得出在说什么" */
.share-text {
  font-size: 28rpx;
  line-height: 1.5;
  color: var(--tf-text);
  word-break: break-all;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
/* 自己转发的卡片底是主色渐变（见 .bubble-row.is-me .bubble），字要反过来 */
.bubble-row.is-me .share-text {
  color: rgba(255, 255, 255, 0.98);
}
.bubble-row.is-me .share-owner {
  color: rgba(255, 255, 255, 0.72);
}

/* —— AI 情绪提示条 ——
   它是「陪伴」不是「告警」：淡底 + 左侧一条主色细线，
   不用红黄、不做闪动，别让人以为出了错。 */
.ai-hint {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  border: 2rpx solid var(--tf-line-soft);
  border-radius: var(--tf-r-md);
  background: var(--tf-card);
  overflow: hidden;
}
.ah-bar {
  flex: none;
  width: 6rpx;
  background: var(--tf-primary);
}
.ah-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 14rpx 0 14rpx 18rpx;
}
.ah-text {
  font-size: 26rpx;
  line-height: 1.5;
  color: var(--tf-text);
  word-break: break-all;
}
.ah-hint {
  font-size: 20rpx;
  line-height: 1.5;
  color: var(--tf-text-2);
  padding-top: 4rpx;
}
/* × 的点击区给足 60rpx 以上：它太小用户点不掉，提示就一直杵在那儿 */
.ah-close {
  flex: none;
  width: 72rpx;
  min-height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  line-height: 1;
  color: var(--tf-text-3);
}
/* 头像淡入：初始不可见，解码完成（@load）后整体亮起。
   同一个节点切 class，不摘挂 —— 摘挂会让头像位塌一下再回来。 */
.ava-fade {
  opacity: 0;
  transition: opacity 160ms ease-out;
}
.ava-fade--in {
  opacity: 1;
}

</style>
