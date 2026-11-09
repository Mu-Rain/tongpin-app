'use strict'

/**
 * 发消息 —— 落库 + 按 clientMsgId 去重 + 更新未读数 + 推进会话摘要
 *
 * 入参：{ token, conversationId, type: 'text'|'image'|'voice'|'structured'|'share', content, clientMsgId, duration?, meta? }
 *   type=text       → content 是文字（1~500 字）
 *   type=image      → content 是云存储 fileID（上传在客户端做，见 05 文档）；
 *                     可选 meta { w, h }：发送方量到的像素宽高（正整数、≤20000），
 *                     供对端首帧就按真实比例画气泡。非法/缺失的两个键一起丢掉，消息照样发。
 *   type=voice      → content 是语音 fileID，duration 是秒数（整数 1~60）
 *   type=structured → 约局卡片，content 可为空，内容全在 meta（30 文档 §2.1）
 *   type=share      → 动态分享卡片，content 是动态 _id（只为满足「非空」），卡片内容全在 meta：
 *                     { post_id, text, cover, owner_name, owner_id }
 * 出参：{ code, msg, data: 消息对象 }
 *
 * 设计要点（对应 dazi-app/docs/06-chat-transport.md §3.5 / §3.8）：
 *   1. clientMsgId 判重：同一个 id 已存在就直接返回老那条，不重复写入。
 *      → 这样"发送失败可以放心重发"，服务端不会存两条。
 *   2. 未读数放在 conversation_members 上自增，不去 count messages
 *      （几十个会话每次都遍历消息表会卡）。
 *   3. 超过 30 天没说话就自动关会话 —— MVP 不做，这里只加注释。
 *   4. uni-push 离线推送见 §3.7，M3 再接；现在只写站内通知表。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'
const DB_NOTIFICATIONS = 'notifications'
const DB_BLOCKS = 'user_blocks'

const MAX_TEXT = 500
const TYPE_ENUM = ['text', 'image', 'voice', 'structured', 'share']
const MAX_VOICE_SEC = 60
// 图片像素宽高的上限：比任何手机能拍出来的尺寸都大一截，
// 只用来挡住明显是脏数据/构造出来的离谱值（超大值会让前端算出一个撑爆屏幕的气泡）
const MAX_IMAGE_DIM = 20000

// —— AI 情绪提示（30 文档 §P0-4）——
// 只在发消息成功后判断，不在 message-list 里现算：列表是高频只读接口，
// 每次读都跑一遍规则既慢，又没法做「24 小时最多一条」的频控（读不该有副作用）。
const HINT_SHORT_MAX = 12 // 短句阈值：≤12 字算「话不多」
const HINT_GAP_MS = 24 * 60 * 60 * 1000
const HINT_QUIET = '今天话不多，还好吗？'
const HINT_LATE = '这么晚还没睡？'

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

/**
 * 把约局卡片的 meta 收敛成 JSON 字符串。
 * 入参可能是对象，也可能是 JSON 字符串（前端两处都可能传）。
 * time / place 缺一个就返回 ''，由调用方统一抛「约局卡片要有时间和地点」。
 */
function normalizeMeta(raw) {
  let obj = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch (e) {
      return ''
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ''
  const time = str(obj.time)
  const place = str(obj.place)
  if (!time || !place) return ''
  const out = { time, place }
  const note = str(obj.note)
  if (note) out.note = note
  const cardId = str(obj.card_id)
  if (cardId) out.card_id = cardId
  const venueId = str(obj.venue_id)
  if (venueId) out.venue_id = venueId
  return JSON.stringify(out)
}

/**
 * 把「分享动态」卡片的 meta 收敛成 JSON 字符串。
 * 入参可能是对象，也可能是 JSON 字符串（跟 normalizeMeta 一样两种都吃）。
 * post_id 是硬门槛：缺了返回 ''，由调用方抛「分享内容不存在」。
 * 其余四个字段只收敛 + 截断，不报错 —— 动态可能已被删除/隐藏，卡片本身还要能落地。
 * 五个键恒定下发（空值给空串），前端不用判 undefined。
 */
function normalizeShareMeta(raw) {
  let obj = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch (e) {
      return ''
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ''
  const postId = str(obj.post_id)
  if (!postId) return ''
  const out = { post_id: postId }
  out.text = str(obj.text).slice(0, 200)
  // cover 只收云存储/HTTPS 地址：http、相对路径、data: 一律丢掉，避免前端拿到脏 URL
  const cover = str(obj.cover)
  out.cover = cover.indexOf('cloud://') === 0 || cover.indexOf('https://') === 0 ? cover.slice(0, 512) : ''
  out.owner_name = str(obj.owner_name).slice(0, 30)
  out.owner_id = str(obj.owner_id).slice(0, 64)
  return JSON.stringify(out)
}

/**
 * 把图片消息的 meta 收敛成 JSON 字符串 { w, h }。
 *
 * ★ 为什么不用 normalizeMeta：那套是约局卡片的字段（time/place 缺一个就整条作废），
 *   图片尺寸与卡片字段没有任何关系，混在一起改会牵动卡片的校验语义。
 * ★ 为什么非法就返回空串、而不是报错：尺寸只是让首帧更好看，
 *   一个量错的宽高绝不该让用户发不出图。丢空之后前端自然退回"等图量完"的老路径。
 * ★ 为什么 w/h 必须成对：只有一个键的话前端两条来源（meta / 实量）会算出两种高度，
 *   反而比完全没有更容易看出跳动。
 */
function normalizeImageMeta(raw) {
  let obj = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch (e) {
      return ''
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ''
  const w = imageDim(obj.w)
  const h = imageDim(obj.h)
  if (!w || !h) return ''
  return JSON.stringify({ w: w, h: h })
}

/** 单个宽/高值：必须是 1~MAX_IMAGE_DIM 的正整数，其余一律当没传（返回 0） */
function imageDim(v) {
  const n = Number(v)
  if (!isFinite(n) || Math.floor(n) !== n) return 0
  if (n < 1 || n > MAX_IMAGE_DIM) return 0
  return n
}

/** 粗判表情：代理对（U+1F000 以上基本都是表情）+ 常见符号区。
 *  不追求 Unicode 全覆盖 —— 这里只用来判断「这句还想不想聊」，判错了顶多少推一条提示。 */
function hasEmoji(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) return true
    if (c >= 0x2600 && c <= 0x27bf) return true
  }
  return false
}

/** 北京时间的小时数。
 *  云函数所在机器的 TZ 不一定稳定（换地域/换运行时就会变），
 *  所以显式加 8 小时再用 UTC 取值，别依赖 process.env.TZ。 */
function beijingHour() {
  return new Date(Date.now() + 8 * 3600 * 1000).getUTCHours()
}

/** 规则①：我在这个会话里连续发出的最近 3 条都是短句（≤12 字）且不含表情。
 *  取最近 3 条「我发的」而不是「会话最近 3 条」：对方回没回与「话不多」无关。 */
async function myShortStreak(conversationId, meId) {
  const res = await db
    .collection(DB_MESSAGES)
    .where({ conversation_id: conversationId, sender_id: meId })
    .orderBy('created_at', 'desc')
    .limit(3)
    .get()
  if (res.data.length < 3) return false
  for (const m of res.data) {
    if (m.type !== 'text') return false
    const t = str(m.content)
    if (!t || t.length > HINT_SHORT_MAX) return false
    if (hasEmoji(t)) return false
  }
  return true
}

/**
 * 可能下发一条 AI 情绪提示。
 * 频控闸门放 conversations 上（ai_hint_at / ai_hint_text）：一个会话一行，
 * 不用再建表，也不用每次扫历史提示消息。
 * ★ 只更新这两个字段，绝不碰 last_message_* —— 会话列表的预览必须还是最后一条真人消息，
 *   否则用户会看到「这么晚还没睡？」顶掉了朋友最后说的话。
 * ★ 不碰 conversation_members.unread_count，sender_id 给空串（message-list 里 is_me 恒为 false）。
 */
async function maybePushAiHint(conversationId, meId) {
  const convRes = await db.collection(DB_CONVERSATIONS).doc(conversationId).get()
  const conv = (convRes.data && convRes.data[0]) || {}
  const now = Date.now()

  const lastAt = typeof conv.ai_hint_at === 'number' ? conv.ai_hint_at : 0
  if (lastAt && now - lastAt < HINT_GAP_MS) return

  // 规则①优先（更具体的事实），①不成立再看规则②
  let text = ''
  if (await myShortStreak(conversationId, meId)) {
    text = HINT_QUIET
  } else {
    const h = beijingHour()
    if (h >= 23 || h < 4) text = HINT_LATE
  }
  if (!text) return
  if (str(conv.ai_hint_text) === text) return

  await db.collection(DB_MESSAGES).add({
    conversation_id: conversationId,
    sender_id: '',
    type: 'ai-hint',
    content: text,
    client_msg_id: '',
    dismissed: false,
    created_at: now
  })

  await db.collection(DB_CONVERSATIONS).doc(conversationId).update({
    ai_hint_at: now,
    ai_hint_text: text
  })
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))

    const conversationId = str(event.conversationId)
    if (!conversationId) fail('缺少 conversationId')

    const type = str(event.type) || 'text'
    if (TYPE_ENUM.indexOf(type) < 0) fail('不支持的消息类型：' + type)

    // structured（约局卡片）的内容全在 meta 里，content 允许为空串。
    // 老三种类型的校验一个字没动：那个 type !== 'structured' 守卫对 text/image/voice 恒为真。
    const content = str(event.content)
    if (!content && type !== 'structured') {
      fail(type === 'image' ? '图片没传上来' : type === 'voice' ? '语音没传上来' : '消息不能为空')
    }
    if (type === 'text' && content.length > MAX_TEXT) {
      fail('消息最多 ' + MAX_TEXT + ' 字')
    }

    // 约局卡片的 meta：前端可能传对象，也可能传 JSON 字符串（chat.vue 的 scOf() 两种都吃）。
    // 这里统一收敛成字符串入库 —— 库里只存一种形态，读的时候不用再猜类型。
    let metaStr = ''
    if (type === 'structured') {
      metaStr = normalizeMeta(event.meta)
      if (!metaStr) fail('约局卡片要有时间和地点')
    }
    // 动态分享卡片同理：独立一支，绝不经过 normalizeMeta（两套字段互不相干）
    if (type === 'share') {
      metaStr = normalizeShareMeta(event.meta)
      if (!metaStr) fail('分享内容不存在')
    }
    // 图片：meta 只有可选的宽高，收不到就是 ''，不 fail —— 尺寸缺失不是发送失败的理由
    if (type === 'image') {
      metaStr = normalizeImageMeta(event.meta)
    }

    // 语音时长（秒，整数 1~60）。非语音不带 duration，老数据形态不变
    let duration = 0
    if (type === 'voice') {
      duration = parseInt(event.duration, 10)
      if (!duration || duration < 1 || duration > MAX_VOICE_SEC) {
        fail('语音时长不合法')
      }
    }

    const clientMsgId = str(event.clientMsgId)

    // —— 必须是会话成员才能发 ——
    // 注意：members 里找 "我" 这一行，找不到就说明不是成员
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId, user_id: me._id })
      .limit(1)
      .get()
    if (!memberRes.data.length) fail('你不在这个会话里', 403)
    const myMember = memberRes.data[0]

    // —— 黑名单拦截（D2：单向彻底静默）——
    // 双向都拦：他拉黑了我 → 我发不出去；我拉黑了他 → 我也发不出去。
    // ★ 整段 try/catch：user_blocks 是新集合，第一次写入才自动创建，
    //   表还没建时查询会报错 —— 当作没拉黑，绝不能让发消息因为附属表挂掉。
    // ★ 但 fail() 抛的业务拦截必须原样冒出去，不能被这段 catch 吞掉。
    try {
      const allRes = await db
        .collection(DB_MEMBERS)
        .where({ conversation_id: conversationId })
        .get()
      for (const om of allRes.data) {
        if (om.user_id === me._id) continue
        const byHim = await db
          .collection(DB_BLOCKS)
          .where({ owner_id: om.user_id, target_id: me._id })
          .limit(1)
          .get()
        if (byHim.data.length) fail('对方已拒收你的消息', 403)
        const byMe = await db
          .collection(DB_BLOCKS)
          .where({ owner_id: me._id, target_id: om.user_id })
          .limit(1)
          .get()
        if (byMe.data.length) fail('你把对方加入了黑名单，无法发送', 403)
      }
    } catch (e) {
      if (e && e.bizCode) throw e
      /* 表不存在 / 查询失败：当作没拉黑 */
    }

    // —— clientMsgId 判重：已存在就返回老那条（重发不产生两条）——
    if (clientMsgId) {
      const dup = await db
        .collection(DB_MESSAGES)
        .where({ conversation_id: conversationId, client_msg_id: clientMsgId })
        .limit(1)
        .get()
      if (dup.data.length) {
        return { code: 0, msg: 'ok（已存在，未重复写入）', data: dup.data[0] }
      }
    }

    const now = Date.now()

    // —— 1) 写入消息 ——
    // created_at 用服务端时间，绝不用客户端时间（用户手机时间可能不准）
    const msgDoc = {
      conversation_id: conversationId,
      sender_id: me._id,
      type,
      content,
      client_msg_id: clientMsgId,
      created_at: now
    }
    // duration 只写在语音消息上：文字/图片消息的文档形态与改造前完全一致
    if (type === 'voice') msgDoc.duration = duration
    // meta 只写在 structured（约局）、share（动态）和 image（带尺寸）上，
    // 其余类型不多一个字段：老消息的文档形态必须保持原样
    if (type === 'structured') msgDoc.meta = metaStr
    if (type === 'share') msgDoc.meta = metaStr
    if (type === 'image' && metaStr) msgDoc.meta = metaStr
    const addRes = await db.collection(DB_MESSAGES).add(msgDoc)
    const messageId = addRes.id

    // —— 2) 给"对方"的所有成员未读 +1 ——
    // 自己那一行不 +1（自己在看），并且顺手把 last_read 推到这条，
    // 免得到时候自己给自己冒红点。
    const allMembers = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId })
      .get()

    for (const m of allMembers.data) {
      if (m.user_id === me._id) {
        await db.collection(DB_MEMBERS).doc(m._id).update({
          unread_count: 0,
          last_read_message_id: messageId
        })
      } else {
        const cur = typeof m.unread_count === 'number' ? m.unread_count : 0
        await db.collection(DB_MEMBERS).doc(m._id).update({
          unread_count: cur + 1
        })
        // 站内通知（uni-push 离线推送 M3 再接，见 06 文档 §3.7）
        // 通知只做提醒，不带聊天内容（隐私）
        try {
          await db.collection(DB_NOTIFICATIONS).add({
            user_id: m.user_id,
            type: 'message',
            title: '你有一条新消息',
            content: '',
            ref_id: conversationId,
            is_read: false,
            created_at: now
          })
        } catch (e) {
          /* 通知失败不该让消息发送失败 */
        }
      }
    }

    // —— 3) 推进会话摘要（消息页列表要显示"最后一条说了啥"）——
    // 存摘要而不是每次去 messages 查最后一条：列表页几十个会话，
    // 每个都查一次 messages 就是 N+1。
    // 预览：图片/语音/约局卡片/动态分享都走方括号占位，只有文字才截前 60 字
    let preview = content.slice(0, 60)
    if (type === 'image') preview = '[图片]'
    else if (type === 'voice') preview = '[语音]'
    else if (type === 'structured') preview = '[约局]'
    else if (type === 'share') preview = '[动态]'
    await db.collection(DB_CONVERSATIONS).doc(conversationId).update({
      last_message_id: messageId,
      last_message_text: preview,
      last_message_sender_id: me._id,
      last_message_at: now,
      updated_at: now
    })

    // —— 3.5) 离线推送（fire-and-forget，绝不 await）——
    // 为什么不 await：推送要走 uni-push 的 HTTP 接口，几百毫秒起步，发消息的人不该等它。
    // 失败也只 console.warn —— 推送挂了绝不能让"消息已发出"变成报错。
    // 标题用发送者昵称，内容按类型收敛（和上面的 preview 同一套占位符，只是文字截 40 字）。
    let pushText = content.slice(0, 40)
    if (type === 'image') pushText = '[图片]'
    else if (type === 'voice') pushText = '[语音]'
    else if (type === 'structured') pushText = '[约局]'
    else if (type === 'share') pushText = '[动态]'
    const pushTitle = str(me.nickname).slice(0, 30) || '同频'
    try {
      for (const m of allMembers.data) {
        if (m.user_id === me._id) continue
        // token 只在服务端内部传，不下发给其它任何地方；payload 带 conversation_id 供客户端点击跳转
        uniCloud
          .callFunction({
            name: 'push-send',
            data: {
              token: str(event.token),
              to_user_id: m.user_id,
              title: pushTitle,
              content: pushText,
              // 带上发送者，客户端点通知时能直接渲染出对方昵称/头像，不用先拉一次会话
              payload: {
                conversation_id: conversationId,
                from_user_id: me._id,
                from_name: pushTitle
              }
            }
          })
          .catch((err) => {
            console.warn('[message-send] 推送失败', m.user_id, err && err.message)
          })
      }
    } catch (e) {
      console.warn('[message-send] 推送调用异常', e && e.message)
    }

    // —— 4) AI 情绪提示（顺序很重要：必须在本条真人消息全部落完再做）——
    // 整段 try/catch：提示只是附加价值，绝不能因为它挂掉让消息发不出去。
    try {
      await maybePushAiHint(conversationId, me._id)
    } catch (e) {
      /* 提示失败不影响发送 */
    }

    const dataOut = {
      _id: messageId,
      conversation_id: conversationId,
      sender_id: me._id,
      type,
      content,
      client_msg_id: clientMsgId,
      created_at: now
    }
    if (type === 'voice') dataOut.duration = duration
    if (type === 'structured') dataOut.meta = metaStr
    if (type === 'share') dataOut.meta = metaStr
    // 图片只有真收到尺寸才多这一个键：没有尺寸的图片消息出参与改造前完全一致
    if (type === 'image' && metaStr) dataOut.meta = metaStr

    return { code: 0, msg: 'ok', data: dataOut }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '发送失败' }
  }
}
