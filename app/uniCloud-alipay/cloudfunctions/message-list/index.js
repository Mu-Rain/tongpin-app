'use strict'

/**
 * 拉消息 —— 聊天记录 + 断线补拉（transport.js 里 fetchSince 调的就是它）
 *
 * 入参：{ token, conversationId, lastMessageId?, beforeMessageId?, limit? }
 *   lastMessageId 为空 → 首次加载，取最近 N 条（倒序查再反转成升序）
 *   lastMessageId 有值 → 增量：只取比它新的，用于轮询 / 断线重连补拉
 *   beforeMessageId 有值 → 历史：往前翻一页更早的消息（见下方 ★ 历史模式）。
 *     与 lastMessageId 同时传时，beforeMessageId 优先。
 * 出参：{ code, msg, data: [消息…], peer_last_read_message_id, has_more_before }
 *   一律按 created_at 升序（历史模式同样升序，与首次加载的输出顺序完全一致）
 *   has_more_before：还有没有更早的消息（多取一条判断，不为此再发一次 count）。
 *     只有历史模式才有意义，首次 / 增量路径恒为 false。
 *   历史模式下 beforeMessageId 查不到 / 不属于本会话 → data 为 []、has_more_before 为 false，
 *   绝不退化成首次加载，否则用户点一下「加载更多」就跳回最新一屏。
 *   每条消息带 type / meta（约局卡片）/ duration；已关闭的 ai-hint 不再下发
 *   peer_last_read_message_id 是**外层字段**，不是 data 数组里的一项 ——
 *   塞进 data 会破坏现有前端（data 一直是纯数组）。
 *
 * ★ 为什么不能写成 `_id > lastMessageId`
 *   云数据库的 _id 是随机字符串，**不保证严格递增**（06 文档 §3.6 专门写了）。
 *   所以正确做法是：先用 lastMessageId 查出那条的 created_at，再按
 *   created_at 过滤。_id 只用来在结果里排除"起点那条自己"。
 *
 * ★ 历史模式（beforeMessageId）同理，不能按 _id 排序翻页 ——
 *   先查出起点那条的 created_at = t，再取 created_at <= t 且 _id != beforeMessageId。
 *   用 <= 而不是 <：同一毫秒可能有多条消息，用 < 会在翻页边界上把它们的最后一条漏掉。
 *
 * ★ 权限：messages 集合的 client 权限全 false，只能通过云函数读。
 *   所以这里必须校验"我是这个会话的成员"，否则谁都能看别人聊天。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'
const DB_REQUESTS = 'friend_requests'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 取用户头像的「可换链原值」。
 * 库里头像有 avatar（uni-id 标准）和 avatar_url（本项目历史字段）两个，
 * 早期账号可能只写了后者。之前这里只读 avatar，导致这些账号的消息气泡永远显示默认头像。
 * 优先挑 cloud://：只有它换得出临时链接，历史 http 直链可能已过期。
 */
function pickAvatar(u) {
  const a = str(u && u.avatar)
  const b = str(u && u.avatar_url)
  if (a.indexOf('cloud://') === 0) return a
  if (b.indexOf('cloud://') === 0) return b
  return a || b
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

/**
 * 每条消息补三个新字段：
 *   recalled / recalled_at —— 撤回不物理删除，下发时把 content 换成空串（留证据给举报/审核）
 *   duration —— 语音时长秒数，非语音恒为 0
 * 老数据没有这些字段时一律按默认值处理（契约 §2.2）。
 */
function pickRecalled(m) {
  return m.recalled === true
}

/** 与会话里其他成员的昵称头像（聊天页顶栏要显示对方名字） */
async function fillSenders(list, meId) {
  const ids = []
  for (const m of list) {
    if (m.sender_id && ids.indexOf(m.sender_id) < 0) ids.push(m.sender_id)
  }
  if (!ids.length) return {}

  const res = await db
    .collection(DB_USERS)
    .where({ _id: dbCmd.in(ids) })
    .field({ _id: true, nickname: true, avatar: true, avatar_url: true })
    .get()

  const map = {}
  for (const u of res.data) map[u._id] = u
  return map
}

/**
 * 给 type === 'friend_request' 的消息补上最新申请状态。
 *
 * 卡片 content 是 {"request_id":"..."}，状态不落进消息里 ——
 * 消息是不可变的聊天记录，状态是会变的事实，混在一起就得改历史消息。
 *
 * ★ 一次 in 查完，不做 N+1；整段 try/catch：
 *   申请表查不到/挂了，卡片降级成 gone 就够，绝不能让整份聊天记录加载失败。
 */
async function fillFriendRequestState(out) {
  const cards = []
  for (const m of out) {
    if (m.type !== 'friend_request') continue
    let requestId = ''
    try {
      const parsed = JSON.parse(m.content || '{}')
      requestId = str(parsed && parsed.request_id)
    } catch (e) {
      // 坏数据（content 不是 JSON / 被截断）：当作已失效，卡片显示「已失效」
      requestId = ''
    }
    m.fr_request_id = requestId
    m.fr_status = 'gone'
    m.fr_from_id = ''
    m.fr_to_id = ''
    if (requestId) cards.push(m)
  }
  if (!cards.length) return

  const ids = cards.map(function (m) {
    return m.fr_request_id
  })

  let reqMap = {}
  try {
    const res = await db
      .collection(DB_REQUESTS)
      .where({ _id: dbCmd.in(ids) })
      .limit(ids.length)
      .get()
    for (const r of res.data) reqMap[r._id] = r
  } catch (e) {
    // 查询失败：全部降级 gone（上面已经写好默认值），直接返回
    return
  }

  for (const m of cards) {
    const r = reqMap[m.fr_request_id]
    if (!r) continue
    const st = str(r.status)
    m.fr_status =
      st === 'pending' || st === 'accepted' || st === 'rejected' || st === 'canceled'
        ? st
        : 'gone'
    m.fr_from_id = str(r.from_user_id)
    m.fr_to_id = str(r.to_user_id)
  }
}

/**
 * 发送者头像换临时链接：库里存 cloud:// fileID，<image> 只认 http。
 * 一页一次批量换；失败保留原值，头像裂了不该让整页消息报错。
 */
async function resolveSenderAvatars(list) {
  const ids = []
  for (let i = 0; i < list.length; i++) {
    const u = list[i].sender_avatar
    if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
  }
  if (!ids.length) return
  try {
    const res = await uniCloud.getTempFileURL({ fileList: ids })
    const fl = (res && res.fileList) || []
    const map = {}
    for (let i = 0; i < fl.length; i++) {
      if (fl[i] && fl[i].tempFileURL) map[fl[i].fileID] = fl[i].tempFileURL
    }
    for (let i = 0; i < list.length; i++) {
      if (map[list[i].sender_avatar]) list[i].sender_avatar = map[list[i].sender_avatar]
    }
  } catch (err) {
    console.warn('[message-list] 头像换链失败', err && err.message)
  }
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))

    const conversationId = str(event.conversationId)
    if (!conversationId) fail('缺少 conversationId')

    let limit = parseInt(event.limit, 10)
    if (!limit || limit <= 0) limit = DEFAULT_LIMIT
    if (limit > MAX_LIMIT) limit = MAX_LIMIT

    // —— 必须是成员 ——
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId, user_id: me._id })
      .limit(1)
      .get()
    if (!memberRes.data.length) fail('你不在这个会话里', 403)
    const myMember = memberRes.data[0]

    // 我这一侧清空聊天记录的时间点。老数据没有这个字段 → 0 → 不过滤（行为与改造前一致）
    const clearedAt = typeof myMember.cleared_at === 'number' ? myMember.cleared_at : 0

    const lastMessageId = str(event.lastMessageId)
    const beforeMessageId = str(event.beforeMessageId)
    const isHistory = beforeMessageId !== ''

    // —— 确定"从哪一刻开始取" ——
    let sinceTime = 0
    if (lastMessageId && !isHistory) {
      const anchor = await db.collection(DB_MESSAGES).doc(lastMessageId).get()
      if (anchor.data && anchor.data.length) {
        sinceTime = anchor.data[0].created_at || 0
      }
      // 起点查不到（被删了/传错）：退化成首次加载，取最近 limit 条，
      // 总比返回空列表让用户以为聊天记录没了强
    }

    let list = []
    let hasMoreBefore = false

    if (isHistory) {
      // 历史：以 beforeMessageId 那条为界，往前翻一页
      // ★ 必须校验它属于本会话：_id 是随机字符串，光有别人的消息 id 就能翻别人的记录
      let anchorFound = false
      let anchorTime = 0
      try {
        const anchor = await db.collection(DB_MESSAGES).doc(beforeMessageId).get()
        if (anchor.data && anchor.data.length) {
          const a = anchor.data[0]
          if (a.conversation_id === conversationId) {
            anchorFound = true
            anchorTime = typeof a.created_at === 'number' ? a.created_at : 0
          }
        }
      } catch (e) {
        // 起点查不到：按已到顶处理，不退化成首次加载
        anchorFound = false
      }

      if (anchorFound) {
        // 清空会话的过滤同样生效：created_at 必须同时 > cleared_at 且 <= 起点时刻。
        // 两个条件落在同一字段上，只能用 and 组合（首次/增量两条路径不受影响）。
        const whereBefore = {
          conversation_id: conversationId,
          created_at:
            clearedAt > 0
              ? dbCmd.gt(clearedAt).and(dbCmd.lte(anchorTime))
              : dbCmd.lte(anchorTime),
          // _id 不保证递增，它在这里只用来排除起点那条自己
          _id: dbCmd.neq(beforeMessageId)
        }
        // 多取一条判断还有没有更早的，别为此再发一次 count
        const res = await db
          .collection(DB_MESSAGES)
          .where(whereBefore)
          .orderBy('created_at', 'desc')
          .limit(limit + 1)
          .get()
        hasMoreBefore = res.data.length > limit
        const page = hasMoreBefore ? res.data.slice(0, limit) : res.data
        // 反转成升序，与首次加载的输出顺序完全一致
        list = page.reverse()
      }
    } else if (sinceTime > 0) {
      // 增量：比起点新（含同一毫秒的）
      // 清空过滤合并进起点：created_at >= sinceTime 且 created_at > clearedAt
      // 等价于 created_at >= max(sinceTime, clearedAt + 1)（时间戳是整数毫秒）。
      // 这样只用一个 gte，不必引入 and 组合命令。
      // cleared_at 为 0（老数据）时 from === sinceTime，查询条件与改造前完全一致。
      const from = clearedAt >= sinceTime ? clearedAt + 1 : sinceTime
      const res = await db
        .collection(DB_MESSAGES)
        .where({
          conversation_id: conversationId,
          created_at: dbCmd.gte(from)
        })
        .orderBy('created_at', 'asc')
        .limit(limit)
        .get()
      // ★ 不要把起点那条自己排除掉。
      //   客户端存的起点是"上次看到的最后一条"，如果这里把它过滤掉，
      //   而它又恰好是最后一条，第二次进聊天页就会拿到空数组 →
      //   页面显示「还没有消息」，但列表页还能看到最新消息（那边走别的查询）。
      //   重复的那条由页面按 _id / client_msg_id 去重，不会变成两条气泡。
      list = res.data
    } else {
      // 首次：倒序取最近 limit 条，再反转成升序给页面渲染
      const whereFirst = { conversation_id: conversationId }
      // cleared_at > 0 才加条件：老数据（没有该字段）走的 SQL 与改造前完全一致
      if (clearedAt > 0) whereFirst.created_at = dbCmd.gt(clearedAt)
      const res = await db
        .collection(DB_MESSAGES)
        .where(whereFirst)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .get()
      list = res.data.reverse()
    }

    // —— 剔除已被用户关掉的 AI 提示 ——
    // 放在查询之后过滤而不是写进 where：ai-hint 是否关闭是逐条的字段，
    // 拼成「type != 'ai-hint' 或 dismissed != true」的条件在云数据库里既难读又走不了索引。
    // 代价是偶尔少回一条（limit 里算上了被滤掉的），下一轮轮询会补上，不影响使用。
    list = list.filter(function (m) {
      return !(m.type === 'ai-hint' && m.dismissed === true)
    })

    // —— 补发送者信息（一次批量查，不做 N+1）——
    const senderMap = await fillSenders(list, me._id)
    const out = list.map(function (m) {
      const u = senderMap[m.sender_id] || {}
      const recalled = pickRecalled(m)
      return {
        _id: m._id,
        conversation_id: m.conversation_id,
        sender_id: m.sender_id,
        sender_name: u.nickname || '同学',
        sender_avatar: pickAvatar(u),
        type: m.type || 'text',
        // 撤回后 content 一律下发空串（原文仍留在库里，举报/审核要用）
        content: recalled ? '' : m.content,
        client_msg_id: m.client_msg_id || '',
        created_at: m.created_at,
        is_me: m.sender_id === me._id,
        recalled: recalled,
        recalled_at: typeof m.recalled_at === 'number' ? m.recalled_at : 0,
        duration: typeof m.duration === 'number' ? m.duration : 0,
        // 约局卡片的 meta 原样透传（库里存的是 JSON 字符串）。
        // 没有这一律给空串而不是 null：前端 scOf() 先判 typeof，
        // 拿到 null 会走 JSON.parse(null) 那个分支，容易踩坑。
        meta: typeof m.meta === 'string' ? m.meta : ''
      }
    })

    await resolveSenderAvatars(out)

    // —— 好友申请卡片：把最新状态补上 ——
    // 卡片里只存 request_id，状态必须现查，否则同意之后卡片还写着「等对方同意」。
    await fillFriendRequestState(out)

    // —— 顺手把"我"的未读清掉（进了聊天页就已经在看了）——
    // 放在这里而不是单独一个云函数：进页面必然先拉消息，一次请求搞定。
    // 历史模式跳过：这一页全是老消息，把 last_read_message_id 改成更早的 _id 会让已读游标倒退
    if (!isHistory && myMember.unread_count) {
      await db.collection(DB_MEMBERS).doc(myMember._id).update({
        unread_count: 0,
        last_read_message_id: out.length ? out[out.length - 1]._id : myMember.last_read_message_id
      })
    } else if (!isHistory && out.length) {
      await db.collection(DB_MEMBERS).doc(myMember._id).update({
        last_read_message_id: out[out.length - 1]._id
      })
    }

    // —— 对方的已读游标（外层字段，不进 data）——
    // ★ 整段 try/catch：读不到就当空串，已读回执降级成「未读」，不能影响聊天记录本身
    let peerLastRead = ''
    try {
      const peerRes = await db
        .collection(DB_MEMBERS)
        .where({ conversation_id: conversationId })
        .limit(20)
        .get()
      for (const pm of peerRes.data) {
        if (pm.user_id === me._id) continue
        peerLastRead = str(pm.last_read_message_id)
        break
      }
    } catch (e) {
      /* 查询失败：留空串 */
    }

    return {
      code: 0,
      msg: 'ok',
      data: out,
      peer_last_read_message_id: peerLastRead,
      has_more_before: hasMoreBefore
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '加载失败' }
  }
}
