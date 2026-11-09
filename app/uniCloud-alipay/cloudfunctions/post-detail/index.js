'use strict'

/**
 * 动态详情（同频圈）
 *
 * 入参：{ token?, post_id }
 *   token 可选。没登录也能看详情，只是 liked / is_mine 一律 false ——
 *   详情页是从分享卡片也能进来的落地页，强制登录会把它变成死链。
 *
 * 出参：{ code:0, msg:'ok', data:{ post:{...} } }
 *   post 的字段与 post-list 的列表项一字不差：详情页和列表页共用一套渲染，
 *   少一个字段前端就得写两份兜底。其中 sizes 与 images 同序同长，
 *   元素是 { w, h } 或 null（老动态没 images_dim 时整列 null）。
 *
 * 为什么已删除也报 404 且文案与「不存在」相同：
 *   删除只改 posts.status 留标记，对客户端来说「不存在」和「已删除」
 *   没有任何区别，没必要泄露某个 id 曾经存在过。
 */

const db = uniCloud.database()
const dbCmd = db.command

// 单边像素上限：与 post-publish 的写入校验对齐，读的时候越界值一律当没有
const MAX_IMAGE_DIM = 20000

const DB_USERS = 'uni-id-users'
const COLL_POSTS = 'posts'
const COLL_LIKES = 'card_likes'

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * cloud:// fileID 换临时链接。
 * 换失败保留原值：白框只是少一张图，抛出去会让整个详情页 500。
 */
async function resolveImageUrls(images) {
  const list = Array.isArray(images) ? images.slice() : []
  const ids = []
  for (let i = 0; i < list.length; i++) {
    const u = list[i]
    if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
  }
  if (!ids.length) return list
  try {
    const res = await uniCloud.getTempFileURL({ fileList: ids })
    const fl = (res && res.fileList) || []
    const map = {}
    for (let i = 0; i < fl.length; i++) {
      if (fl[i] && fl[i].tempFileURL) map[fl[i].fileID] = fl[i].tempFileURL
    }
    for (let i = 0; i < list.length; i++) {
      if (map[list[i]]) list[i] = map[list[i]]
    }
  } catch (e) {
    console.warn('[post-detail] getTempFileURL 失败，图片按原值返回', e && e.message)
  }
  return list
}

/** 单个宽/高值：只认 1~MAX_IMAGE_DIM 的正整数，其余当没存（返回 0） */
function imageDim(v) {
  const n = Number(v)
  if (!isFinite(n) || Math.floor(n) !== n) return 0
  if (n < 1 || n > MAX_IMAGE_DIM) return 0
  return n
}

/**
 * 尺寸数组：与 images 同序同长，元素是 { w, h } 或 null。
 *
 * ★ 为什么老数据也要返回等长的 null 数组：前端可以无条件按下标取用，
 *   不必为「没有 images_dim」再写一条分支，也就不会出现两种渲染路径。
 * ★ 为什么读的时候还要再收敛一遍：库里可能存在手改/历史写入的脏值，
 *   一个 NaN 宽高会让前端算出 NaN 高度，比没有尺寸更糟。
 */
function buildSizes(images, dims) {
  const list = Array.isArray(images) ? images : []
  const raw = Array.isArray(dims) ? dims : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const d = raw[i]
    const ok = d && typeof d === 'object' && !Array.isArray(d)
    const w = ok ? imageDim(d.w) : 0
    const h = ok ? imageDim(d.h) : 0
    out.push(w && h ? { w: w, h: h } : null)
  }
  return out
}

/**
 * 单个 fileID 换临时链接（作者头像用）。
 * 换失败返回原值：头像裂了只是少张图，不值得让整个详情页报错。
 */
async function toTempUrl(fileId) {
  const id = typeof fileId === 'string' ? fileId : ''
  if (id.indexOf('cloud://') !== 0) return id
  try {
    const res = await uniCloud.getTempFileURL({ fileList: [id] })
    const it = (res && res.fileList && res.fileList[0]) || {}
    return it.tempFileURL || id
  } catch (e) {
    console.warn('[post-detail] 头像换链失败', e && e.message)
    return id
  }
}

exports.main = async (event) => {
  try {
    const postId = str(event.post_id)
    if (!postId) fail('缺少动态 id', 400)

    // 这些查询彼此独立，以前是一路串行 await（冷启动下点开一条动态要等 6~7 次往返，
    // 用户看到的就是"点了半天转圈"）。现在压成三步并发：
    //   ① 正文 + 当前用户  ② 作者 + 点赞 + 图片换链  ③ 作者头像换链（依赖 ② 的作者文档）
    const token = str(event.token)
    const [pRes, uRes] = await Promise.all([
      db.collection(COLL_POSTS).where({ _id: postId }).limit(1).get(),
      token
        ? db.collection(DB_USERS).where({ token }).limit(1).get()
        : Promise.resolve({ data: [] })
    ])
    if (!pRes.data.length) fail('动态不存在或已被删除', 404)
    const post = pRes.data[0]
    // deleted_at 是本项目既有的软删写法，两处都读，避免绕过 status 的旧数据还能被打开
    if (post.status === 'removed' || post.deleted_at) fail('动态不存在或已被删除', 404)
    const me = (uRes.data && uRes.data[0]) || null

    // 作者与 post-list 同样走一次 in 查询，保持返回体字段来源一致；
    // 点赞状态查失败不影响详情本身，降级成「未点赞」而不是整页报错。
    const [oRes, lRes, images] = await Promise.all([
      post.owner_id
        ? db
            .collection(DB_USERS)
            .where({ _id: dbCmd.in([post.owner_id]) })
            .field({
              nickname: true,
              avatar_url: true,
              avatar: true,
              school: true,
              is_verified: true,
              schoolVerified: true
            })
            .get()
        : Promise.resolve({ data: [] }),
      me
        ? db
            .collection(COLL_LIKES)
            .where({ card_id: postId, user_id: me._id })
            .limit(1)
            .get()
            .catch((e) => {
              console.warn('[post-detail] 点赞状态查询失败', e && e.message)
              return { data: [] }
            })
        : Promise.resolve({ data: [] }),
      resolveImageUrls(post.images)
    ])

    const ownerMap = {}
    ;(oRes.data || []).forEach((u) => {
      ownerMap[u._id] = u
    })
    const owner = ownerMap[post.owner_id] || {}
    const liked = !!(lRes.data && lRes.data.length)
    const ownerAvatar = await toTempUrl(owner.avatar_url || owner.avatar || '')

    return {
      code: 0,
      msg: 'ok',
      data: {
        post: {
          _id: post._id,
          content: post.content || '',
          images,
          // 与 images 同序同长：老动态没有 images_dim 时是等长的 null 数组
          sizes: buildSizes(images, post.images_dim),
          media_type: post.media_type || (images.length ? 'image' : 'text'),
          like_count: typeof post.like_count === 'number' ? post.like_count : 0,
          liked,
          comment_count: typeof post.comment_count === 'number' ? post.comment_count : 0,
          created_at: post.created_at || 0,
          is_mine: !!(me && post.owner_id === me._id),
          owner: {
            _id: owner._id || '',
            nickname: owner.nickname || '同学',
            avatar_url: ownerAvatar,
            school: owner.school || '',
            // 兼容两套字段名（注册时写的 schoolVerified / 设计文档里的 is_verified）
            is_verified: !!(owner.is_verified || owner.schoolVerified)
          }
        }
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '加载失败' }
  }
}
