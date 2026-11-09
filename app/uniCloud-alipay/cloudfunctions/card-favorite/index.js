'use strict'

/**
 * 收藏卡片 —— 收藏 / 取消 / 查状态 / 我的收藏列表
 *
 * 一个函数四个 action，因为它们改的都是 card_favorites 这张表，
 * 而且共享同一套「token 怎么校验、卡片能不能收藏」的判断。
 *
 * 入参：
 *   action = 'toggle' { token, card_id, target_type? }  已收藏则取消，未收藏则收藏
 *   action = 'check'  { token, card_id, target_type? }  只读状态，给详情页回显
 *   action = 'list'   { token, page?, page_size? }      我的收藏列表
 *
 * target_type：'card'（搭子卡，也是缺省）/ 'post'（同频圈动态），白名单外直接 400。
 *   历史收藏行没有这个字段，读侧一律当 'card'，不做数据迁移。
 *
 * 出参统一 { code, msg, data }
 *   toggle → data: { favorited: bool, count: number }   count = 我当前收藏总数
 *   check  → data: { favorited: bool }
 *   list   → data: { list, has_more, total }
 *
 * 幂等与并发：
 *   - 重复 toggle 不报错，只是状态翻转（先查再改，查不到就插）。
 *   - 并发同一张卡可能两个请求都判定「没收藏」，然后都去插，
 *     所以 card_favorites 上必须有 idx_user_card(user_id + card_id) 唯一索引兜底；
 *     插入失败时按「已收藏」处理，返回的状态与库里真实状态一致，不抛错。
 *
 * 卡片已被删除（deleted_at 非空）或 status 不是 open 的收藏记录不隐藏：
 *   仍然返回，并带上 status 字段，让前端自己决定怎么显示（灰掉 / 标注已关闭）。
 *   悄悄消失会让用户以为收藏丢了。
 */

const db = uniCloud.database()
const dbCmd = db.command

// 集合名必须跟 user-register / user-login / user-tags 保持一致，否则查不到人
const DB_USERS = 'uni-id-users'
const DB_CARDS = 'cards'
const DB_POSTS = 'posts'
const DB_FAVORITES = 'card_favorites'

// 收藏对象类型。老数据没有 target_type 字段，读侧一律当 'card'。
const TARGET_CARD = 'card'
const TARGET_POST = 'post'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// 把数组切成每片 n 个，用于分批 in 查询（in 的数组太长会拖慢查询）
function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  const u = r.data[0]
  // token 过期保护：登录时写了 tokenExpire，这里要真校验，不然 token 永不过期
  if (u.tokenExpire && Date.now() > u.tokenExpire) fail('登录已过期，请重新登录', 401)
  if (u.status === 'banned' || u.status === 0) fail('账号已被封禁', 403)
  return u
}

async function getCard(cardId) {
  if (!cardId) fail('缺少卡片 id', 400)
  const r = await db.collection(DB_CARDS).where({ _id: cardId }).limit(1).get()
  if (!r.data.length) fail('卡片不存在或已被删除', 400)
  return r.data[0]
}

async function getPost(postId) {
  if (!postId) fail('缺少动态 id', 400)
  const r = await db.collection(DB_POSTS).where({ _id: postId }).limit(1).get()
  if (!r.data.length) fail('内容不存在或已被删除', 404)
  const p = r.data[0]
  // status==='removed' 是逻辑删除，deleted_at 是硬删标记：两种都不让再收藏
  if (p.status === 'removed' || p.deleted_at) fail('内容不存在或已被删除', 404)
  return p
}

// 入参 target_type 白名单：缺省 'card'
function pickTargetType(v) {
  const t = str(v) || TARGET_CARD
  if (t !== TARGET_CARD && t !== TARGET_POST) fail('不支持的收藏类型：' + t, 400)
  return t
}

/**
 * 判重/查状态统一的 where。
 * 去重口径仍然是 user_id + card_id（_id 全局唯一，同一个 id 不会既是卡又是帖），
 * 加 target_type 只是防止同一收藏表里卡与帖的 id 空间在将来靠前缀重叠时互相串。
 * ★ 卡片一侧必须用 neq('post') 而不是 eq('card')：历史行根本没有这个字段，
 *   而「字段不存在」不等于 'card'，用 eq 会让所有老收藏查不到 ——
 *   表现为重复插入撞唯一索引 idx_user_card，最后报「收藏失败」。
 */
function favoriteWhere(userId, targetId, targetType) {
  return {
    user_id: userId,
    card_id: targetId,
    target_type: targetType === TARGET_POST ? TARGET_POST : dbCmd.neq(TARGET_POST)
  }
}

// posts 没有标题字段：正文截断当标题/摘要用
function truncate(s, n) {
  const t = typeof s === 'string' ? s.trim() : ''
  return t.length > n ? t.slice(0, n) + '…' : t
}

async function countMine(userId) {
  const r = await db.collection(DB_FAVORITES).where({ user_id: userId }).count()
  return r.total || 0
}

/**
 * 收藏 / 取消收藏。
 * 返回 { favorited, count } —— favorited 一定是操作后的真实状态。
 */
async function toggle(me, cardId, targetType) {
  if (targetType === TARGET_POST) {
    // 动态只需要「存在且没被删」；自己的动态允许收藏（对齐 post-like 的口径）
    await getPost(cardId)
  } else {
    const card = await getCard(cardId)
    if (card.owner_id === me._id) fail('不能收藏自己发的卡片', 400)
  }

  const existRes = await db
    .collection(DB_FAVORITES)
    .where(favoriteWhere(me._id, cardId, targetType))
    .limit(1)
    .get()

  let favorited
  if (existRes.data.length) {
    await db.collection(DB_FAVORITES).where({ _id: existRes.data[0]._id }).remove()
    favorited = false
  } else {
    let inserted = false
    try {
      await db.collection(DB_FAVORITES).add({
        user_id: me._id,
        card_id: cardId,
        target_type: targetType,
        created_at: Date.now()
      })
      inserted = true
    } catch (e) {
      // 唯一索引 idx_user_card 拦下了重复插入：说明并发下另一个请求刚插进来。
      // 这不是错误，按「已收藏」处理；下面再查一次确认，查不到才是真的写失败。
      inserted = false
    }
    if (inserted) {
      favorited = true
    } else {
      const again = await db
        .collection(DB_FAVORITES)
        .where(favoriteWhere(me._id, cardId, targetType))
        .limit(1)
        .get()
      if (!again.data.length) fail('收藏失败，请稍后重试', 500)
      favorited = true
    }
  }

  return { favorited, count: await countMine(me._id) }
}

async function check(me, cardId, targetType) {
  if (!cardId) fail(targetType === TARGET_POST ? '缺少动态 id' : '缺少卡片 id', 400)
  const r = await db
    .collection(DB_FAVORITES)
    .where(favoriteWhere(me._id, cardId, targetType))
    .limit(1)
    .get()
  return { favorited: r.data.length > 0 }
}

const CARD_FIELDS = {
  _id: true,
  owner_id: true,
  type: true,
  title: true,
  description: true,
  location_name: true,
  start_time: true,
  end_time: true,
  expected_people: true,
  status: true,
  deleted_at: true,
  created_at: true
}

const POST_FIELDS = {
  _id: true,
  owner_id: true,
  content: true,
  images: true,
  like_count: true,
  comment_count: true,
  status: true,
  deleted_at: true,
  created_at: true
}

const USER_FIELDS = {
  _id: true,
  nickname: true,
  avatar_url: true,
  avatar: true,
  school: true,
  schoolVerified: true,
  is_verified: true,
  credit: true,
  credit_score: true,
  user_no: true
}

// 作者 → item.owner：卡片与动态共用这一个函数，避免两套字段口径走偏
function buildOwner(owner) {
  const o = owner || {}
  return {
    _id: o._id || '',
    nickname: o.nickname || '同学',
    avatar_url: o.avatar_url || o.avatar || '',
    school: o.school || '',
    // 兼容两套字段名：第 1 天注册写的是 schoolVerified/credit，
    // 03 文档设计的是 is_verified/credit_score。两处都读，避免与大厅显示不一致。
    is_verified: !!(o.is_verified || o.schoolVerified),
    credit_score:
      typeof o.credit_score === 'number'
        ? o.credit_score
        : typeof o.credit === 'number'
          ? o.credit
          : 80,
    user_no: o.user_no || ''
  }
}

/**
 * 动态收藏 → 与卡片收藏**同一套 item 结构**，前端只多认一个 kind。
 * posts 没有标题字段：title 取正文前 30 字，description/summary 取正文前 60 字。
 */
function buildPostItem(base, p, ownerMap, me) {
  // 动态被硬删：跟卡片一样占位、不隐藏，否则用户会以为收藏自己丢了
  if (!p) {
    return Object.assign(base, {
      kind: 'post',
      _id: base.card_id,
      target_id: base.card_id,
      type: 'post',
      title: '这条动态已不存在',
      description: '',
      summary: '',
      cover: '',
      like_count: 0,
      comment_count: 0,
      status: 'removed',
      created_at: 0,
      deleted: true,
      owner: buildOwner({}),
      tags: [],
      common_tags: [],
      common_tag_count: 0,
      is_mine: false
    })
  }

  const imgs = Array.isArray(p.images) ? p.images : []
  const text = typeof p.content === 'string' ? p.content.replace(/\s+/g, ' ').trim() : ''
  const owner = ownerMap[p.owner_id] || {}
  const deleted = !!(p.status === 'removed' || p.deleted_at)

  return Object.assign(base, {
    kind: 'post',
    _id: p._id,
    // 前端跳 /pages/post-detail/post-detail?id=<target_id>，与 card_id 同值
    target_id: p._id,
    type: 'post',
    title: truncate(text, 30) || '分享了一条动态',
    description: truncate(text, 60),
    summary: truncate(text, 60),
    cover: typeof imgs[0] === 'string' ? imgs[0] : '',
    like_count: typeof p.like_count === 'number' ? p.like_count : 0,
    comment_count: typeof p.comment_count === 'number' ? p.comment_count : 0,
    // 保留卡片那套 status 语义，前端 isOpen()/closedLabel() 不用改
    status: deleted ? 'removed' : 'open',
    created_at: p.created_at || 0,
    deleted,
    owner: buildOwner(owner),
    tags: [],
    common_tags: [],
    common_tag_count: 0,
    is_mine: !!(owner._id && owner._id === me._id)
  })
}

/**
 * 我的收藏列表。
 * 排序按「收藏时间」而不是卡片发布时间 —— 用户来这里是翻自己存过的东西，
 * 最近存的应该在最上面。
 */
async function list(me, page, pageSize) {
  const countRes = await db.collection(DB_FAVORITES).where({ user_id: me._id }).count()
  const total = countRes.total || 0

  const favRes = await db
    .collection(DB_FAVORITES)
    .where({ user_id: me._id })
    .orderBy('created_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  const favs = favRes.data
  if (!favs.length) {
    return { list: [], has_more: false, total }
  }

  // —— 按 target_type 分两组，各用一次批量 in 查询：不做 N+1 ——
  // 历史行没有 target_type → 划进 'card' 组（与 favoriteWhere 的读侧口径一致）
  const cardIds = []
  const postIds = []
  favs.forEach((f) => {
    if (!f.card_id) return
    if (f.target_type === TARGET_POST) {
      if (postIds.indexOf(f.card_id) < 0) postIds.push(f.card_id)
    } else if (cardIds.indexOf(f.card_id) < 0) {
      cardIds.push(f.card_id)
    }
  })

  const cardMap = {}
  for (const part of chunk(cardIds, 50)) {
    if (!part.length) continue
    const r = await db.collection(DB_CARDS).where({ _id: dbCmd.in(part) }).field(CARD_FIELDS).get()
    r.data.forEach((c) => {
      cardMap[c._id] = c
    })
  }

  const postMap = {}
  for (const part of chunk(postIds, 50)) {
    if (!part.length) continue
    const r = await db.collection(DB_POSTS).where({ _id: dbCmd.in(part) }).field(POST_FIELDS).get()
    r.data.forEach((p) => {
      postMap[p._id] = p
    })
  }

  const ownerIds = []
  const pushOwnerId = (oid) => {
    if (oid && ownerIds.indexOf(oid) < 0) ownerIds.push(oid)
  }
  Object.keys(cardMap).forEach((cid) => pushOwnerId(cardMap[cid].owner_id))
  Object.keys(postMap).forEach((pid) => pushOwnerId(postMap[pid].owner_id))
  const ownerMap = {}
  for (const part of chunk(ownerIds, 50)) {
    if (!part.length) continue
    const r = await db.collection(DB_USERS).where({ _id: dbCmd.in(part) }).field(USER_FIELDS).get()
    r.data.forEach((u) => {
      ownerMap[u._id] = u
    })
  }

  // 卡片标签（跟大厅卡片的视觉语言对齐：头像 / 昵称 / 类型 / 标题 / 描述 / 标签 / 地点 / 时间）
  // 这一页可能全是动态收藏，cardIds 为空时不做 in([]) 查询
  const ctRes = cardIds.length
    ? await db.collection('card_tags').where({ card_id: dbCmd.in(cardIds) }).get()
    : { data: [] }
  const tagIdsByCard = {}
  const allTagIds = []
  ctRes.data.forEach((ct) => {
    if (!tagIdsByCard[ct.card_id]) tagIdsByCard[ct.card_id] = []
    tagIdsByCard[ct.card_id].push(ct.tag_id)
    if (allTagIds.indexOf(ct.tag_id) < 0) allTagIds.push(ct.tag_id)
  })
  const tagMap = {}
  for (const part of chunk(allTagIds, 50)) {
    if (!part.length) continue
    const r = await db.collection('tags').where({ _id: dbCmd.in(part) }).get()
    r.data.forEach((t) => {
      tagMap[t._id] = t
    })
  }

  // 我的标签：给「同频 N 个」高亮用，没登录也算不出来（这里必然已登录）
  const myTagIds = []
  const myRes = await db.collection('user_tags').where({ user_id: me._id }).get()
  myRes.data.forEach((ut) => myTagIds.push(ut.tag_id))

  const out = favs.map((f) => {
    const base = {
      card_id: f.card_id,
      favorited_at: f.created_at || 0
    }

    // 动态收藏走同一套 item 结构，多一个 kind 标记 + 动态专用字段
    if (f.target_type === TARGET_POST) {
      return buildPostItem(base, postMap[f.card_id], ownerMap, me)
    }

    const c = cardMap[f.card_id]

    // 卡片文档没了（被硬删除）：不隐藏这条收藏，否则用户会以为收藏自己丢了
    if (!c) {
      return Object.assign(base, {
        kind: 'card',
        _id: f.card_id,
        type: 'other',
        title: '这张卡片已不存在',
        description: '',
        location_name: '',
        start_time: 0,
        expected_people: 0,
        status: 'removed',
        created_at: 0,
        deleted: true,
        owner: { _id: '', nickname: '同学', avatar_url: '', school: '', is_verified: false, credit_score: 80, user_no: '' },
        tags: [],
        common_tags: [],
        common_tag_count: 0,
        is_mine: false
      })
    }

    const tagIds = tagIdsByCard[c._id] || []
    const tags = tagIds
      .map((tid) => tagMap[tid])
      .filter(Boolean)
      .map((t) => ({ _id: t._id, name: t.name, category: t.category }))
    const common = tagIds.filter((tid) => myTagIds.indexOf(tid) >= 0)
    const owner = ownerMap[c.owner_id] || {}

    const card = Object.assign({}, c)
    delete card.owner_id

    return Object.assign(base, card, {
      kind: 'card',
      deleted: !!c.deleted_at,
      owner: buildOwner(owner),
      tags,
      common_tags: common,
      common_tag_count: common.length,
      is_mine: !!(owner._id && owner._id === me._id)
    })
  })

  await resolveAvatarUrls(out)

  return { list: out, has_more: page * pageSize < total, total }
}

/**
 * owner 头像 cloud:// fileID 换成可直接渲染的临时链接（口径同 post-list 的 resolveImageUrls）。
 * 换失败保留原值：头像白框不影响列表其余内容，抛出去会让整页 500。
 */
async function resolveAvatarUrls(list) {
  const ids = []
  const push = (u) => {
    if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
  }
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].owner) push(list[i].owner.avatar_url)
    // 动态封面同样是 cloud:// fileID，跟头像一批换，省一次往返
    if (list[i]) push(list[i].cover)
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
      const o = list[i] && list[i].owner
      if (o && map[o.avatar_url]) o.avatar_url = map[o.avatar_url]
      if (list[i] && map[list[i].cover]) list[i].cover = map[list[i].cover]
    }
  } catch (e) {
    console.warn('[card-favorite] getTempFileURL 失败，头像按原值返回', e && e.message)
  }
}

exports.main = async (event) => {
  try {
    const action = str(event.action)
    const token = str(event.token)

    if (action !== 'toggle' && action !== 'check' && action !== 'list') {
      return { code: 400, msg: '未知的 action：' + (action || '(空)') }
    }

    const me = await getUserByToken(token)
    const cardId = str(event.card_id)

    if (action === 'toggle') {
      const data = await toggle(me, cardId, pickTargetType(event.target_type))
      return { code: 0, msg: 'ok', data }
    }

    if (action === 'check') {
      const data = await check(me, cardId, pickTargetType(event.target_type))
      return { code: 0, msg: 'ok', data }
    }

    const page = Math.max(1, parseInt(event.page, 10) || 1)
    let pageSize = parseInt(event.page_size, 10) || DEFAULT_PAGE_SIZE
    if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE
    if (pageSize < 1) pageSize = DEFAULT_PAGE_SIZE

    const data = await list(me, page, pageSize)
    return { code: 0, msg: 'ok', data }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '服务端错误' }
  }
}
