'use strict'

/**
 * 动态评论 —— 列表 / 发表
 *
 * 入参：{ token?, post_id, action:'list'|'add', content?, page?, page_size? }
 *   token 在 list 时可选（没登录也能看评论，只是 is_mine 全为 false）
 *   token 在 add  时必填
 *
 * 出参：
 *   list -> { code:0, msg:'ok', data:{ list, has_more, total, page } }
 *   add  -> { code:0, msg:'ok', data:{ comment_id, comment_count } }
 *
 * comment_count 为什么要覆盖写而不是 inc：
 *   add 与删评、管理员清理并行时 inc 会永久漂移，而列表上的数字是读
 *   posts.comment_count 的，一漂就是错一个数量级。覆盖写每次都自愈，
 *   代价只是多一次 count。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const COLL_POSTS = 'posts'
const COLL_COMMENTS = 'comments'

const MAX_CONTENT = 200
const MAX_PAGE_SIZE = 30
const DEFAULT_PAGE_SIZE = 10

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v, def) {
  const n = parseInt(v, 10)
  return n > 0 ? n : def
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

/** 被评论的动态必须还在，否则评论会挂在一个客户端打不开的 id 上 */
async function getPost(postId) {
  const r = await db.collection(COLL_POSTS).where({ _id: postId }).limit(1).get()
  if (!r.data.length) fail('动态不存在或已被删除', 404)
  const post = r.data[0]
  if (post.status === 'removed' || post.deleted_at) fail('动态不存在或已被删除', 404)
  return post
}

// 评论作者：一次批量查，不做 N+1
async function loadOwners(ids) {
  const map = {}
  if (!ids.length) return map
  const r = await db
    .collection(DB_USERS)
    .where({ _id: dbCmd.in(ids) })
    .field({
      nickname: true,
      avatar_url: true,
      avatar: true,
      school: true,
      is_verified: true,
      schoolVerified: true
    })
    .get()
  ;(r.data || []).forEach((u) => {
    map[u._id] = u
  })
  return map
}

async function listComments(postId, me, page, pageSize) {
  await getPost(postId)

  // status 为 removed 的评论要过滤掉，但同时要让 total 与列表口径一致，
  // 所以 where 复用同一份条件，不分叉
  const where = { post_id: postId, status: dbCmd.neq('removed') }

  const cRes = await db.collection(COLL_COMMENTS).where(where).count()
  const total = cRes.total || 0

  const rRes = await db
    .collection(COLL_COMMENTS)
    .where(where)
    .orderBy('created_at', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()
  const rows = rRes.data || []

  const ownerIds = []
  rows.forEach((c) => {
    if (c.owner_id && ownerIds.indexOf(c.owner_id) < 0) ownerIds.push(c.owner_id)
  })
  const ownerMap = await loadOwners(ownerIds)

  const list = rows.map((c) => {
    const owner = ownerMap[c.owner_id] || {}
    return {
      _id: c._id,
      content: c.content || '',
      created_at: c.created_at || 0,
      is_mine: !!(me && c.owner_id === me._id),
      owner: {
        _id: owner._id || '',
        nickname: owner.nickname || '同学',
        avatar_url: owner.avatar_url || owner.avatar || '',
        school: owner.school || '',
        // 兼容两套字段名（注册时写的 schoolVerified / 设计文档里的 is_verified）
        is_verified: !!(owner.is_verified || owner.schoolVerified)
      }
    }
  })

  await resolveListAvatars(list)

  return {
    code: 0,
    msg: 'ok',
    data: {
      list,
      has_more: (page - 1) * pageSize + rows.length < total,
      total,
      page
    }
  }
}

async function addComment(postId, me, content) {
  if (!content) fail('说点什么')
  if (content.length > MAX_CONTENT) fail('评论最多 ' + MAX_CONTENT + ' 字')

  await getPost(postId)

  const now = Date.now()
  const addRes = await db.collection(COLL_COMMENTS).add({
    post_id: postId,
    owner_id: me._id,
    content,
    status: 'normal',
    created_at: now
  })

  // 插完再数：真实条数含刚才这条，覆盖写让 posts 上的冗余计数自愈
  const cRes = await db
    .collection(COLL_COMMENTS)
    .where({ post_id: postId, status: dbCmd.neq('removed') })
    .count()
  const commentCount = cRes.total || 0

  try {
    await db.collection(COLL_POSTS).doc(postId).update({ comment_count: commentCount, updated_at: now })
  } catch (e) {
    // 计数只是给人看的冗余字段，写失败不该让用户以为评论没发出去
    console.warn('[post-comment] 同步 posts.comment_count 失败', e && e.message)
  }

  return { code: 0, msg: 'ok', data: { comment_id: addRes.id, comment_count: commentCount } }
}

/**
 * 列表里的头像换临时链接：库里存 cloud:// fileID，<image> 只认 http 链接。
 * 一页一次批量换；失败保留原值，头像裂了不该让整页报错。
 */
async function resolveListAvatars(list) {
  const ids = []
  for (let i = 0; i < list.length; i++) {
    const u = list[i].owner && list[i].owner.avatar_url
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
      const o = list[i].owner
      if (o && map[o.avatar_url]) o.avatar_url = map[o.avatar_url]
    }
  } catch (e) {
    console.warn('[post-comment] 头像换链失败', e && e.message)
  }
}

exports.main = async (event) => {
  try {
    const postId = str(event.post_id)
    if (!postId) fail('缺少动态 id', 400)

    const action = str(event.action) || 'list'
    if (action !== 'list' && action !== 'add') fail('未知操作', 400)

    if (action === 'add') {
      const me = await getUserByToken(str(event.token))
      return await addComment(postId, me, str(event.content))
    }

    // list 不强制登录：评论是人人都该看到的内容，登录只影响 is_mine
    let me = null
    const token = str(event.token)
    if (token) {
      const uRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
      if (uRes.data.length) me = uRes.data[0]
    }
    const page = num(event.page, 1)
    const pageSize = Math.min(num(event.page_size, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
    return await listComments(postId, me, page, pageSize)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '服务端错误' }
  }
}
