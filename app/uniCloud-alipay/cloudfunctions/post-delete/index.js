'use strict'

/**
 * 删除自己的动态（同频圈）
 *
 * 入参：{ token, post_id }
 * 出参：{ code:0, msg:'ok', data:{ ok:true } }
 *
 * 为什么是软删（status = 'removed'）而不是 remove()：
 *   删动态要连带处理点赞、评论、举报记录这些还指着这条 id 的数据；
 *   物理删之后它们全变成悬空引用，举报复核时就再也还原不出原文。
 *   软删后所有读取入口都按 status 过滤，对外等价于不存在。
 *
 * 视频/图片文件不在这里删：同一份 fileID 可能被举报快照或别处引用，
 * 清理由后台任务按「无人引用」统一回收。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const COLL_POSTS = 'posts'

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
  const u = r.data[0]
  // token 过期保护：登录时写了 tokenExpire，这里要真校验，不然 token 永不过期
  if (u.tokenExpire && Date.now() > u.tokenExpire) fail('登录已过期，请重新登录', 401)
  if (u.status === 'banned' || u.status === 0) fail('账号已被封禁', 403)
  return u
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))

    const postId = str(event.post_id)
    // 缺 id 按「找不到」处理：这是客户端 bug，不该在前端多开一个分支
    if (!postId) fail('动态不存在', 404)

    const pRes = await db.collection(COLL_POSTS).where({ _id: postId }).limit(1).get()
    if (!pRes.data.length) fail('动态不存在', 404)
    const post = pRes.data[0]

    // 已删的按不存在处理，且先于归属判断：不然重复删除会先暴露「这条动态存在过」
    if (post.status === 'removed' || post.deleted_at) fail('动态不存在', 404)

    if (post.owner_id !== me._id) fail('只能删除自己发的动态', 403)

    const now = Date.now()
    await db.collection(COLL_POSTS).doc(postId).update({ status: 'removed', updated_at: now })

    return { code: 0, msg: 'ok', data: { ok: true } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '删除失败' }
  }
}
