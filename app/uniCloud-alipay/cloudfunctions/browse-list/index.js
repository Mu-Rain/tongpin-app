'use strict'

/**
 * 我的观看历史
 *
 * 入参：{ token, page = 1, page_size = 20（上限 50） }
 *
 * 出参：{ code, msg, data: { list, total, has_more } }
 *   list 每条：
 *   {
 *     kind: 'card' | 'post',
 *     target_id,
 *     title,           cards 取 title；posts 没有标题字段，固定 ''
 *     summary,         cards 取 description；posts 取 content（原样给，前端负责截断）
 *     cover,           images[0] 换成 https 临时链接；没有图 / 换不出来都是 ''
 *     like_count,      number，卡片的按 card_likes 真实条数算，动态的读冗余字段
 *     created_at,      number，**内容**的创建时间
 *     viewed_at,       number，**我浏览那一刻**的时间
 *     alive,           bool，false = 内容已被删除/下架，前端置灰仍可点击
 *     owner: { _id, nickname, avatar_url }
 *   }
 *
 * ★ 为什么把已删除的内容也返回（alive: false）：
 *   观看历史是"我做过的事"的记录，直接删掉会让 total 与翻页数字忽大忽小。
 *   保留占位、前端显示「内容已删除」，口径才稳定（与 my-liked 同一取向）。
 *
 * ★ 为什么要按 (target_type, target_id) 再去一次重：
 *   browse-record 每次浏览前都会删旧行，正常情况下不会重复。但旧版本数据、
 *   并发写入、或手工插的数据都可能留重复行。去重放在读的一侧，一次搞定，
 *   不用写迁移脚本去洗库。
 */

const db = uniCloud.database()
const dbCmd = db.command
const $ = db.command.aggregate

const DB_USERS = 'uni-id-users'
const DB_CARDS = 'cards'
const DB_POSTS = 'posts'
const DB_BROWSE = 'browse_history'
const DB_LIKES = 'card_likes'

// 一次最多回看 200 条浏览记录。更早的历史对用户没有检索价值，
// 却要付出一次大 in 查询的代价。
const BROWSE_SCAN_MAX = 200
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
  like_count: true,
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

function intOr0(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
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
 * 封面 + 头像一次批量换临时链接（同 my-liked 的写法）。
 * 换失败保留原值，绝不抛出去。
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
    console.warn('[browse-list] getTempFileURL 失败，图片按原值返回', e && e.message)
  }
}

/** 卡片点赞数：card_likes 的真实条数（cards 表里没有冗余 like_count 字段） */
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
    console.warn('[browse-list] 点赞数统计失败，降级为 0', e && e.message)
  }
  return out
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))
    const page = num(event.page, 1)
    const pageSize = Math.min(num(event.page_size, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)

    // —— 1) 我的浏览记录，按浏览时间倒序 ——
    let rows = []
    try {
      const r = await db
        .collection(DB_BROWSE)
        .where({ owner_id: me._id })
        .orderBy('created_at', 'desc')
        .limit(BROWSE_SCAN_MAX)
        .get()
      rows = r.data || []
    } catch (e) {
      // 表还没建 = 一次都没浏览过，空列表不是错误
      console.warn('[browse-list] browse_history 查询失败，按空列表返回', e && e.message)
      rows = []
    }

    // —— 2) 按 (target_type, target_id) 去重，保留最新那条 ——
    const seen = {}
    const pairs = []
    for (let i = 0; i < rows.length; i++) {
      const tt = str(rows[i].target_type)
      const tid = str(rows[i].target_id)
      if (tt !== 'card' && tt !== 'post') continue
      if (!tid) continue
      const key = tt + '|' + tid
      if (seen[key]) continue
      seen[key] = true
      pairs.push({ target_type: tt, target_id: tid, viewed_at: intOr0(rows[i].created_at) })
    }

    const total = pairs.length
    const start = (page - 1) * pageSize
    const pagePairs = start >= total ? [] : pairs.slice(start, start + pageSize)

    // —— 3) 分两批按 id 回查（只查自己那一类，不做无用的 in）——
    const cardIds = []
    const postIds = []
    for (let i = 0; i < pagePairs.length; i++) {
      if (pagePairs[i].target_type === 'card') cardIds.push(pagePairs[i].target_id)
      else postIds.push(pagePairs[i].target_id)
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
        console.warn('[browse-list] cards 查询失败', e && e.message)
      }
    }
    if (postIds.length) {
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
        console.warn('[browse-list] posts 查询失败', e && e.message)
      }
    }

    // —— 4) 拼装 ——
    const items = []
    const hitCardIds = []
    for (let i = 0; i < pagePairs.length; i++) {
      const tt = pagePairs[i].target_type
      const tid = pagePairs[i].target_id
      const viewedAt = pagePairs[i].viewed_at

      if (tt === 'card' && cardMap[tid]) {
        const c = cardMap[tid]
        const imgs = Array.isArray(c.images) ? c.images : []
        items.push({
          kind: 'card',
          target_id: tid,
          title: str(c.title),
          summary: str(c.description),
          cover: typeof imgs[0] === 'string' ? imgs[0] : '',
          like_count: 0,
          created_at: intOr0(c.created_at),
          viewed_at: viewedAt,
          alive: !(c.status === 'deleted' || c.deleted_at),
          owner_id: str(c.owner_id)
        })
        hitCardIds.push(tid)
      } else if (tt === 'post' && postMap[tid]) {
        const p = postMap[tid]
        const imgs = Array.isArray(p.images) ? p.images : []
        items.push({
          kind: 'post',
          target_id: tid,
          // posts 表没有标题字段，前端用 summary 显示
          title: '',
          summary: str(p.content),
          cover: typeof imgs[0] === 'string' ? imgs[0] : '',
          like_count: intOr0(p.like_count),
          created_at: intOr0(p.created_at),
          viewed_at: viewedAt,
          alive: !(p.status === 'removed' || p.deleted_at),
          owner_id: str(p.owner_id)
        })
      } else {
        // 内容已被硬删：仍然占位，否则 total / 翻页会跳
        items.push({
          kind: tt,
          target_id: tid,
          title: '',
          summary: '',
          cover: '',
          like_count: 0,
          created_at: 0,
          viewed_at: viewedAt,
          alive: false,
          owner_id: ''
        })
      }
    }

    // —— 5) 卡片的点赞数按真实条数补上（一次聚合，不逐条 count）——
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
        console.warn('[browse-list] 作者信息查询失败，降级为默认头像', e && e.message)
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
        viewed_at: it.viewed_at,
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
