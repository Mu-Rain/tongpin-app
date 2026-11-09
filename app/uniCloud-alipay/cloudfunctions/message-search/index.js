'use strict'

/**
 * 搜索聊天记录 —— 聊天页顶部放大镜 → 搜索弹层
 *
 * 入参：{ token, conversation_id, keyword, limit? }
 * 出参：{ code, msg, data: { list: [...], total } }
 *   list 项：{ _id, sender_id, sender_name, type, content, created_at, is_me }
 * 错误码：
 *   400「请输入搜索关键词」 / 400「缺少 conversation_id」
 *   403「你不在这个会话里」
 *
 * ★ 正则必须转义。用户搜 "(" 直接拼进 RegExp 会抛 SyntaxError，
 *   整个接口 500；搜 ".*" 更糟 —— 变成通配符，一次把整段历史全捞出来。
 *   escapeReg 与 friend-search 第 82-84 行、school-list 完全同一个实现。
 *
 * ★ 三个过滤条件一个都不能省：
 *   ① type === 'text' —— 图片/语音消息的 content 是 fileID 或空串，
 *      对它们做包含匹配要么匹配不到，要么把 cloud:// 前缀当文本搜出来；
 *   ② recalled !== true —— 撤回的消息 message-list 下发空串，
 *      搜索却能命中原文，等于把「撤回」这件承诺直接破了；
 *   ③ created_at > cleared_at —— 我清空过的历史不该能被搜回来，
 *      否则「清空聊天记录」是假的。
 *   ★ ③ 必须先取到 cleared_at 才能过滤，所以成员行一定在查消息之前读。
 *
 * ★ 为什么 total 就是本次返回条数：
 *   云数据库没有便宜的 count + 截断组合（count 要单独跑一次全表扫描）。
 *   搜索是「最近 N 条里找」，前端只需要知道这次给了几条、要不要继续加载。
 *   真要做「共 137 条」得用聚合，为一个搜索弹层不值得。
 *
 * ★ 为什么发送者昵称要单独补一次而不是存进消息：
 *   消息是不可变的聊天记录，昵称会改（用户改头像改名字）。
 *   存进去就会出现「三年前的聊天里还是旧名字」。和 message-list 第 190 行
 *   一样，一次 in 查完，不做 N+1。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 转义正则元字符。
 * 用户输入的 "(  " 或 ".*" 直接拼进 RegExp 会语法报错或变成通配符，
 * 前者让整个接口 500，后者能让一个空关键字匹配到全库。
 * 与 friend-search 第 82-84 行逐字相同 —— 两处必须一致，别各自演化。
 */
function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

/**
 * 头像 cloud:// fileID 换成可直接渲染的临时链接（口径同 post-list 的 resolveImageUrls）。
 * 换失败保留原值：头像白框不影响列表其余内容，抛出去会让整页 500。
 */
async function resolveAvatarUrls(list) {
  const ids = []
  const push = (u) => {
    if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
  }
  for (let i = 0; i < list.length; i++) {
    if (list[i]) push(list[i].avatar_url)
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
      const it = list[i]
      if (it && map[it.avatar_url]) it.avatar_url = map[it.avatar_url]
    }
  } catch (e) {
    console.warn('[message-search] getTempFileURL 失败，头像按原值返回', e && e.message)
  }
}


exports.main = async (event) => {
  try {
    event = event || {}
    const me = await getUserByToken(str(event.token))

    const conversationId = str(event.conversation_id)
    if (!conversationId) fail('缺少 conversation_id', 400)

    // 空关键字 → 400（与 friend-search 不同：那边空关键字是合法的「清空输入框」，
    // 这里前端只在真的按了搜索才调，空着调说明是 bug，直接告诉它）
    const keyword = str(event.keyword)
    if (!keyword) fail('请输入搜索关键词', 400)

    let limit = parseInt(event.limit, 10)
    if (!limit || limit <= 0) limit = DEFAULT_LIMIT
    if (limit > MAX_LIMIT) limit = MAX_LIMIT

    // —— 1) 先取成员行：既要校验权限，也要拿 cleared_at ——
    // ★ 顺序不能颠倒：cleared_at 是过滤条件的一部分，
    //   没拿到它就去查消息，等于把「我清空过的历史」全搜回来。
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId, user_id: me._id })
      .limit(1)
      .get()
    if (!memberRes.data.length) fail('你不在这个会话里', 403)
    const myMember = memberRes.data[0]
    const clearedAt = typeof myMember.cleared_at === 'number' ? myMember.cleared_at : 0

    // —— 2) 查消息 ——
    const reg = new RegExp(escapeReg(keyword), 'i')
    const where = {
      conversation_id: conversationId,
      type: 'text',
      content: reg,
      recalled: dbCmd.neq(true)
    }
    // cleared_at 为 0 时不加范围条件：gt(0) 会把 created_at === 0 的脏数据漏掉，
    // 而没清空过的人本来就不需要过滤。
    if (clearedAt > 0) where.created_at = dbCmd.gt(clearedAt)

    const res = await db
      .collection(DB_MESSAGES)
      .where(where)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get()
    const rows = res.data || []

    // —— 3) 补发送者昵称（一次批量查，不做 N+1）——
    // ★ 字段白名单：uni-id-users 里有 token / mobile / password，
    //   这里只要昵称和头像，绝不整条下发。
    const ids = []
    for (const m of rows) {
      const sid = str(m.sender_id)
      if (sid && ids.indexOf(sid) < 0) ids.push(sid)
    }
    const userMap = {}
    try {
      if (ids.length) {
        const uRes = await db
          .collection(DB_USERS)
          .where({ _id: dbCmd.in(ids) })
          .field({ _id: true, nickname: true, avatar: true })
          .get()
        for (const u of uRes.data || []) userMap[u._id] = u
      }
    } catch (e) {
      /* 用户表查不到：昵称降级成「同学」，搜索结果照常返回 */
    }

    // —— 4) 拼装 ——
    // ★ 这里再兜一次 recalled / cleared_at 的底：
    //   线上老文档可能没有 recalled 字段（$ne true 能过），
    //   也可能有 created_at 是字符串的脏数据（$gt 比较会意外通过）。
    //   云函数是最后一道关，宁可多一次 filter。
    const list = []
    for (const m of rows) {
      if (m.recalled === true) continue
      const createdAt = typeof m.created_at === 'number' ? m.created_at : 0
      if (createdAt <= clearedAt) continue
      const sid = str(m.sender_id)
      const u = userMap[sid] || {}
      list.push({
        _id: m._id,
        sender_id: sid,
        sender_name: str(u.nickname) || '同学',
        // avatar 或 avatar_url 都可能为空（老账号只写了后者），两个都要兜
        avatar_url: str(u.avatar_url) || str(u.avatar),
        type: str(m.type) || 'text',
        content: str(m.content),
        created_at: createdAt,
        is_me: sid === me._id
      })
    }

    await resolveAvatarUrls(list)

    return { code: 0, msg: 'ok', data: { list: list, total: list.length } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '搜索失败' }
  }
}
