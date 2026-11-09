'use strict'

/**
 * 我点赞过的需求与动态
 *
 * 入参：{ token, page = 1, page_size = 20（上限 50） }
 *
 * 出参：{ code, msg, data: { list, total, has_more } }
 *   list 每条：
 *   {
 *     kind: 'card' | 'post',
 *     target_id,                被点赞内容的 id
 *     title,                    cards 取 title；posts 没有标题字段，固定 ''
 *     summary,                  cards 取 description；posts 取 content（原样给，前端负责截断）
 *     cover,                    images[0] 换成 https 临时链接；没有图 / 换不出来都是 ''
 *     like_count,               number，卡片的按 card_likes 真实条数算，动态的读冗余字段
 *     created_at,               number，**内容**的创建时间
 *     liked_at,                 number，**我点赞那一刻**的时间（不是内容时间）
 *     alive,                    bool，false = 内容已被删除/下架，前端置灰仍可点击
 *     owner: { _id, nickname, avatar_url }
 *   }
 *
 * ★ card_likes 一个表同时装「卡片赞」和「动态赞」，被赞对象一律写在 card_id 上
 *   （见 post-like/index.js 文件头：字段名是历史包袱，语义是「被赞对象 id」）。
 *   所以这里无法靠集合区分类型，只能按 id 分别回查 cards / posts。
 *
 * ★ 为什么删除的内容仍然返回（alive: false）而不直接从列表里剔掉：
 *   剔掉会让"我赞过 20 条"变成"列表里 18 条"，用户翻页时数字一直在变，
 *   total 与 has_more 也跟着飘。保留占位、由前端显示「内容已删除」才是稳定口径。
 *
 * ★ 为什么按 liked_at 排序、而不是内容时间：
 *   这是"我的点赞记录"，用户找的是"我昨天赞的那条"，不是"最近发的内容"。
 *   排序键与展示键必须是同一个，否则列表看起来是乱的。
 */

const db = uniCloud.database()
const dbCmd = db.command
const $ = db.command.aggregate

const DB_USERS = 'uni-id-users'
const DB_CARDS = 'cards'
const DB_POSTS = 'posts'
const DB_LIKES = 'card_likes'

// 一次最多回看 200 条点赞。再多的历史对"我的点赞"页面没有价值，
// 却要付出一次大 in 查询的代价。
const LIKE_SCAN_MAX = 200
const MAX_PAGE_SIZE = 50
const DEFAULT_PAGE_SIZE = 20

const CARD_FIELDS = {
  _id: true,
  owner_id: true,
  title: true,
  description: true,
  images: true,
  created_at: true,
  status: true,
  deleted_at: true
}

const POST_FIELDS = {
  _id: true,
  owner_id: true,
  content: true,
  images: true,
  created_at: true,
  status: true,
  deleted_at: true
}

// 用户表白名单：uni-id-users 里有 token / mobile / password，绝不整条下发
const OWNER_FIELDS = {
  _id: true,
  nickname: true,
  avatar_url: true,
  avatar: true
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v, def) {
  const n = parseInt(v, 10)
  return n > 0 ? n : def
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function intOr0(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  const u = r.data[0]
  if (u.tokenExpire && Date.now() > u.tokenExpire) fail('登录已过期，请重新登录', 401)
  if (u.status === 'banned' || u.status === 0) fail('账号已被封禁', 403)
  return u
}

/**
 * 封面 + 头像换临时链接：库里存 cloud:// fileID，<image> 只认 http。
 * 整个列表一次批量换完（封面和头像是同一批文件，不拆两次往返）。
 * 换失败保留原值（封面留空串由调用方兜），绝不抛出去 —— 头像是装饰，不该让整页 500。
 */
async function resolveMediaUrls(list) {
  const ids = []
  const push = function (u) {
    if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
  }
  for (let i = 0; i < list.length; i++) {
    push(list[i].cover)
    if (list[i].owner) push(list[i].owner.avatar_url)
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
      if (map[list[i].cover]) list[i].cover = map[list[i].cover]
      const o = list[i].owner
      if (o && map[o.avatar_url]) o.avatar_url = map[o.avatar_url]
    }
  } catch (e) {
    console.warn('[my-liked] getTempFileURL 失败，图片按原值返回', e && e.message)
  }
}

/** 卡片点赞数是 card_likes 的真实条数（cards 表里没有冗余 like_count 字段） */
async function loadCardLikeCounts(cardIds) {
  const out = {}
  if (!cardIds.length) return out
  try {
    const res = await db
      .collection(DB_LIKES)
      .aggregate()
      .match({ card_id: dbCmd.in(cardIds) })
      .group({ _id: '$card_id', n: $.sum(1) })
      .end()
    const rows = (res && res.data) || []
    for (let i = 0; i < rows.length; i++) out[rows[i]._id] = rows[i].n || 0
  } catch (e) {
    // 统计挂了只降级成 0，不影响列表本身
    console.warn('[my-liked] 点赞数统计失败', e && e.message)
  }
  return out
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))
    const page = num(event.page, 1)
    const pageSize = Math.min(num(event.page_size, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)

    // —— 1) 我点过的赞，按点赞时间倒序 ——
    // 表可能还没建（从没人点过赞）：查不到就是空列表，不是错误。
    let likeRows = []
    try {
      const lRes = await db
        .collection(DB_LIKES)
        .where({ user_id: me._id })
        .orderBy('created_at', 'desc')
        .limit(LIKE_SCAN_MAX)
        .get()
      likeRows = lRes.data || []
    } catch (e) {
      console.warn('[my-liked] card_likes 查询失败，按空列表返回', e && e.message)
      likeRows = []
    }

    // —— 2) 按 card_id 去重（保留最新那次点赞）——
    // 理论上唯一索引会拦住重复，但本项目唯一索引未真正生效（见 post-like 注释），
    // 历史数据里可能真有多条，这里兜住。
    const seen = {}
    const pairs = []
    for (let i = 0; i < likeRows.length; i++) {
      const tid = str(likeRows[i].card_id)
      if (!tid || seen[tid]) continue
      seen[tid] = true
      pairs.push({ target_id: tid, liked_at: intOr0(likeRows[i].created_at) })
    }

    const total = pairs.length
    const start = (page - 1) * pageSize
    const pagePairs = start >= total ? [] : pairs.slice(start, start + pageSize)

    // —— 3) 分两批按 id 回查内容（field 白名单，不带无关字段）——
    const cardIds = []
    const postIds = []
    for (let i = 0; i < pagePairs.length; i++) {
      cardIds.push(pagePairs[i].target_id)
      postIds.push(pagePairs[i].target_id)
    }

    const cardMap = {}
    const postMap = {}
    if (cardIds.length) {
      try {
        const cRes = await db
          .collection(DB_CARDS)
          .where({ _id: dbCmd.in(cardIds) })
          .field(CARD_FIELDS)
          .get()
        ;(cRes.data || []).forEach(function (c) {
          cardMap[c._id] = c
        })
      } catch (e) {
        console.warn('[my-liked] cards 查询失败', e && e.message)
      }
      try {
        const pRes = await db
          .collection(DB_POSTS)
          .where({ _id: dbCmd.in(postIds) })
          .field(POST_FIELDS)
          .get()
        ;(pRes.data || []).forEach(function (p) {
          postMap[p._id] = p
        })
      } catch (e) {
        console.warn('[my-liked] posts 查询失败', e && e.message)
      }
    }

    // —— 4) 拼装（kind 靠"在哪张表里找到"判定，不靠 id 前缀猜）——
    const items = []
    const hitCardIds = []
    for (let i = 0; i < pagePairs.length; i++) {
      const pid = pagePairs[i].target_id
      const c = cardMap[pid]
      const p = postMap[pid]
      if (c) {
        const imgs = Array.isArray(c.images) ? c.images : []
        items.push({
          kind: 'card',
          target_id: pid,
          title: str(c.title),
          summary: str(c.description),
          cover: typeof imgs[0] === 'string' ? imgs[0] : '',
          like_count: 0,
          created_at: intOr0(c.created_at),
          liked_at: pagePairs[i].liked_at,
          alive: !(c.status === 'deleted' || c.deleted_at),
          owner_id: str(c.owner_id)
        })
        hitCardIds.push(pid)
      } else if (p) {
        const imgs = Array.isArray(p.images) ? p.images : []
        items.push({
          kind: 'post',
          target_id: pid,
          // posts 表没有标题字段，前端用 summary 显示
          title: '',
          summary: str(p.content),
          cover: typeof imgs[0] === 'string' ? imgs[0] : '',
          like_count: intOr0(p.like_count),
          created_at: intOr0(p.created_at),
          liked_at: pagePairs[i].liked_at,
          alive: !(p.status === 'removed' || p.deleted_at),
          owner_id: str(p.owner_id)
        })
      } else {
        // 两边都查不到（内容被硬删了）：仍然占位，否则 total / 翻页会跳
        items.push({
          kind: 'card',
          target_id: pid,
          title: '',
          summary: '',
          cover: '',
          like_count: 0,
          created_at: 0,
          liked_at: pagePairs[i].liked_at,
          alive: false,
          owner_id: ''
        })
      }
    }

    // —— 5) 点赞数：卡片的按真实条数补上（一次聚合，不逐条 count）——
    if (hitCardIds.length) {
      const cnt = await loadCardLikeCounts(hitCardIds)
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'card' && typeof cnt[items[i].target_id] === 'number') {
          items[i].like_count = cnt[items[i].target_id]
        }
      }
    }

    // —— 6) 作者信息一次批量取（不做 N+1）——
    const ownerIds = []
    for (let i = 0; i < items.length; i++) {
      const oid = items[i].owner_id
      if (oid && ownerIds.indexOf(oid) < 0) ownerIds.push(oid)
    }
    const ownerMap = {}
    if (ownerIds.length) {
      try {
        const uRes = await db
          .collection(DB_USERS)
          .where({ _id: dbCmd.in(ownerIds) })
          .field(OWNER_FIELDS)
          .get()
        ;(uRes.data || []).forEach(function (u) {
          ownerMap[u._id] = u
        })
      } catch (e) {
        console.warn('[my-liked] 作者信息查询失败，降级为默认头像', e && e.message)
      }
    }

    const list = items.map(function (it) {
      const o = ownerMap[it.owner_id] || {}
      return {
        kind: it.kind,
        target_id: it.target_id,
        title: it.title,
        summary: it.summary,
        cover: it.cover,
        like_count: it.like_count,
        created_at: it.created_at,
        liked_at: it.liked_at,
        alive: it.alive,
        owner: {
          _id: o._id || '',
          nickname: o.nickname || '同学',
          avatar_url: o.avatar_url || o.avatar || ''
        }
      }
    })

    await resolveMediaUrls(list)

    return {
      code: 0,
      msg: 'ok',
      data: {
        list,
        total,
        has_more: page * pageSize < total
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '加载失败', data: null }
  }
}
