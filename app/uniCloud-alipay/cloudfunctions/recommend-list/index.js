'use strict'

/**
 * 推荐内容（同校热门 + 兜底全站）
 *
 * 入参：{ token 可选, scope = 'school' | 'city' | 'all', page = 1, page_size = 10（上限 30） }
 *   token 可选：没登录也能看推荐（只是排除不了"自己"），这一点和 card-list 一致。
 *
 * 出参：{ code, msg, data: { list, total, has_more, degraded, page } }
 *   list 每条：
 *   { kind, target_id, title, summary, cover, like_count, created_at, owner: { _id, nickname, avatar_url } }
 *     kind          'card' | 'post'
 *     title         cards 取 title；posts 无标题字段，固定 ''
 *     summary       cards 取 description；posts 取 content
 *     cover         images[0] 换成 https 临时链接；没有图 / 换不出来都是 ''
 *     like_count    number
 *     created_at    number，内容创建时间
 *     owner.avatar_url  服务端换链；换不出来 ''
 *   degraded:
 *     ''             正常按 scope 过滤
 *     'no_school'    没登录 / 没 school_id，退回全站
 *     'empty_school' 同校候选为空，退回全站
 *     'no_city'      没登录 / 没 city_code，退回全站
 *     'empty_city'   同城候选为空，退回全站
 *   total  当前生效口径下的候选条数（两张表相加，已排除自己的内容）
 *
 * ★ 为什么必须"各取 N 条 → 内存合并 → 再切片"：
 *   cards 和 posts 是两张表，uniCloud 没有跨表 UNION，也没法给两张表同一个
 *   orderBy + skip。若各自 skip/limit 再拼起来，第一页看到的永远是
 *   "所有卡片 + 所有动态"的两段，而不是真正的第三热门。
 *   代价是单表可能多取一些行（page*page_size），换来的是**排序正确**。
 *
 * ★ 为什么 cards 的 like_count 要现算：
 *   cards 表里根本没有 like_count 字段（见 card-publish 的写库字段），
 *   它是 card-list 在读取时用 card_likes 聚合出来的。排序键必须是真的点赞数，
 *   否则"按热门排"会退化成"按时间排"，还挂着一个恒为 0 的字段骗前端。
 */

const db = uniCloud.database()
const dbCmd = db.command
const $ = db.command.aggregate

const DB_USERS = 'uni-id-users'
const DB_CARDS = 'cards'
const DB_POSTS = 'posts'
const DB_LIKES = 'card_likes'

const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 30
// 单表最多扫 200 行：再深的分页对推荐流没有意义，但会让内存排序变贵
const MAX_SCAN = 200

const CARD_FIELDS = {
  _id: true,
  owner_id: true,
  title: true,
  description: true,
  images: true,
  like_count: true,
  created_at: true
}

const POST_FIELDS = {
  _id: true,
  owner_id: true,
  content: true,
  images: true,
  like_count: true,
  created_at: true
}

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

async function getMe(token) {
  if (!token) return null
  try {
    const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
    return r.data.length ? r.data[0] : null
  } catch (e) {
    // 未登录态的一种：token 查不动就当游客，推荐照常给
    console.warn('[recommend-list] token 解析失败，按游客处理', e && e.message)
    return null
  }
}

/**
 * 封面 + 头像一次批量换临时链接。
 * 换失败保留原值，绝不抛出去：图裂了只是少一张图，抛出去整页 500。
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
    console.warn('[recommend-list] getTempFileURL 失败，图片按原值返回', e && e.message)
  }
}

/** 卡片点赞数：card_likes 的真实条数（cards 表没有冗余 like_count） */
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
    console.warn('[recommend-list] 点赞数统计失败，降级为 0', e && e.message)
  }
  return out
}

function buildWhere(base, extraKey, extraVal, me) {
  const w = Object.assign({}, base)
  if (extraKey && extraVal) w[extraKey] = extraVal
  // 自己的内容不叫推荐
  if (me && me._id) w.owner_id = dbCmd.neq(me._id)
  return w
}

/** 单表取候选；查询失败当作没有候选（一张表挂了不该让整个推荐流空白） */
async function fetchSide(coll, where, limit, fields, tag) {
  try {
    const r = await db.collection(coll).where(where).field(fields).limit(limit).get()
    return r.data || []
  } catch (e) {
    console.warn('[recommend-list] ' + tag + ' 查询失败，按空候选处理', e && e.message)
    return []
  }
}

async function countOf(coll, where) {
  try {
    const r = await db.collection(coll).where(where).count()
    return typeof r.total === 'number' ? r.total : 0
  } catch (e) {
    return 0
  }
}

exports.main = async (event) => {
  try {
    const me = await getMe(str(event.token))
    const page = num(event.page, 1)
    const pageSize = Math.min(num(event.page_size, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)

    const rawScope = str(event.scope)
    const scope = rawScope === 'city' || rawScope === 'all' ? rawScope : 'school'

    // —— 1) 定生效口径 + 降级口径 ——
    let effective = scope
    let degraded = ''
    if (scope === 'school') {
      if (!(me && me.school_id)) {
        effective = 'all'
        degraded = 'no_school'
      }
    } else if (scope === 'city') {
      if (!(me && me.city_code)) {
        effective = 'all'
        degraded = 'no_city'
      }
    }

    const need = page * pageSize
    const limit = Math.min(need, MAX_SCAN)

    const load = async function (eff) {
      const extraKey = eff === 'school' ? 'school_id' : eff === 'city' ? 'city_code' : ''
      const extraVal = eff === 'school' ? (me && me.school_id) || '' : eff === 'city' ? (me && me.city_code) || '' : ''
      const cardWhere = buildWhere({ status: 'open' }, extraKey, extraVal, me)
      const postWhere = buildWhere({ status: 'normal' }, extraKey, extraVal, me)
      const cards = await fetchSide(DB_CARDS, cardWhere, limit, CARD_FIELDS, 'cards')
      const posts = await fetchSide(DB_POSTS, postWhere, limit, POST_FIELDS, 'posts')
      return { cards, posts, cardWhere, postWhere }
    }

    let bundle = await load(effective)

    // —— 2) 同校/同城候选为空 → 退回全站，并在 degraded 里说明 ——
    // 这个分支必须存在：新学校第一批用户点进来，同校内容真的是 0 条，
    // 直接给一屏空白等于告诉用户"这个 App 没人用"。
    if (!bundle.cards.length && !bundle.posts.length && effective !== 'all') {
      const emptyTag = effective === 'school' ? 'empty_school' : 'empty_city'
      degraded = emptyTag
      effective = 'all'
      bundle = await load('all')
    }

    const cards = bundle.cards
    const posts = bundle.posts

    // —— 3) cards / posts 各自成条，同时算出真实的 like_count ——
    const cardIds = []
    for (let i = 0; i < cards.length; i++) cardIds.push(cards[i]._id)
    const cardLikes = await loadCardLikeCounts(cardIds)

    const merged = []
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i]
      const imgs = Array.isArray(c.images) ? c.images : []
      merged.push({
        kind: 'card',
        target_id: c._id,
        title: str(c.title),
        summary: str(c.description),
        cover: typeof imgs[0] === 'string' ? imgs[0] : '',
        like_count: typeof cardLikes[c._id] === 'number' ? cardLikes[c._id] : 0,
        created_at: intOr0(c.created_at),
        owner_id: str(c.owner_id)
      })
    }
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i]
      const imgs = Array.isArray(p.images) ? p.images : []
      merged.push({
        kind: 'post',
        target_id: p._id,
        title: '',
        summary: str(p.content),
        cover: typeof imgs[0] === 'string' ? imgs[0] : '',
        like_count: intOr0(p.like_count),
        created_at: intOr0(p.created_at),
        owner_id: str(p.owner_id)
      })
    }

    // —— 4) 跨表统一排序：like_count desc，同分按 created_at desc ——
    merged.sort(function (a, b) {
      if (b.like_count !== a.like_count) return b.like_count - a.like_count
      return b.created_at - a.created_at
    })

    // 每张表都还有更多 → 还有下一页（单表行数没被 MAX_SCAN 截断时才算数）
    const hasMoreByCards = cards.length >= limit && limit < MAX_SCAN
    const hasMoreByPosts = posts.length >= limit && limit < MAX_SCAN
    const hasMore = merged.length > need || hasMoreByCards || hasMoreByPosts

    const start = (page - 1) * pageSize
    const pageItems = start >= merged.length ? [] : merged.slice(start, start + pageSize)

    // —— 5) 作者信息一次批量取（不做 N+1）——
    const ownerIds = []
    for (let i = 0; i < pageItems.length; i++) {
      const oid = pageItems[i].owner_id
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
        console.warn('[recommend-list] 作者信息查询失败，降级为默认头像', e && e.message)
      }
    }

    const list = pageItems.map(function (it) {
      const o = ownerMap[it.owner_id] || {}
      return {
        kind: it.kind,
        target_id: it.target_id,
        title: it.title,
        summary: it.summary,
        cover: it.cover,
        like_count: it.like_count,
        created_at: it.created_at,
        owner: {
          _id: o._id || '',
          nickname: o.nickname || '同学',
          avatar_url: o.avatar_url || o.avatar || ''
        }
      }
    })

    await resolveMediaUrls(list)

    // total 用"生效口径下的真实条数"，不是本页条数：前端要靠它判到底还有多少
    const total =
      (await countOf(DB_CARDS, bundle.cardWhere)) + (await countOf(DB_POSTS, bundle.postWhere))

    return {
      code: 0,
      msg: 'ok',
      data: {
        list,
        total,
        has_more: hasMore,
        degraded,
        page
      }
    }
  } catch (e) {
    return { code: 500, msg: e.message || '加载失败', data: null }
  }
}
