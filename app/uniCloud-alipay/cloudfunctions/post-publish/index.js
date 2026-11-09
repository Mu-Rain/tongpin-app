'use strict'

/**
 * 发布日常动态（同频圈）
 *
 * 和 card-publish 的区别（别混用）：
 *   card-publish 发的是「搭子需求」——有类型、时间、地点，进的是大厅和首页；
 *   post-publish 发的是「日常」——一段文字 + 最多 3 张图，进的是同频圈。
 *   两者是不同的集合（cards / posts），前端也是两个发布页。
 *
 * 入参：
 *   token       登录令牌
 *   content     ≤500 字
 *   images      配图 fileID 数组，≤3 个，只收 cloud:// 或 https:// 字符串
 *   images_dim  可选，与 images 同序同长的尺寸数组，每项 { w, h }（像素正整数，≤20000）
 *               或 null（客户端没量到）。非法项按 null 处理，绝不让发布失败。
 *               ★ 与 images 同序是这个契约的全部意义：错位等于把 A 的宽高配给 B，
 *                 列表页会按错的宽高比留位，比完全没有尺寸更难看。
 *
 * 出参：{ code, msg, data: { post_id, created_at, today_count } }
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const COLL_POSTS = 'posts'

const MAX_CONTENT = 500
const MAX_IMAGES = 3
// fileID 的合理长度上限；只为挡住「客户端传一张巨大 base64 进来」把文档撑爆
const MAX_IMAGE_LEN = 512
// 动态比搭子需求宽松：需求一天 5 条够用，日常刷屏才是常态
const DAILY_LIMIT = 20
// 单边像素上限：只挡明显是脏数据的值，正常手机照片远小于它
const MAX_IMAGE_DIM = 20000

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/** 单个宽/高值：必须是 1~MAX_IMAGE_DIM 的正整数，其余当没量到（返回 0） */
function imageDim(v) {
  const n = Number(v)
  if (!isFinite(n) || Math.floor(n) !== n) return 0
  if (n < 1 || n > MAX_IMAGE_DIM) return 0
  return n
}

/**
 * 一项尺寸收敛成 { w, h } 或 null。
 * ★ 宽高必须成对：只存一个的话前端没法算比例，等于没存，索性统一给 null。
 */
function normalizeDim(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const w = imageDim(item.w)
  const h = imageDim(item.h)
  if (!w || !h) return null
  return { w: w, h: h }
}

exports.main = async (event) => {
  try {
    const token = str(event.token)
    if (!token) fail('未登录', 401)

    const userRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
    if (!userRes.data.length) fail('登录已过期，请重新登录', 401)
    const user = userRes.data[0]
    if (user.status === 'banned' || user.status === 0) fail('账号已被封禁，无法发布', 403)

    const content = str(event.content)
    if (content.length > MAX_CONTENT) fail('文字最多 ' + MAX_CONTENT + ' 字')

    // 配图：只收字符串，且必须是我们自己的云存储地址或 https 直链。
    // 不校验协议就等于让客户端往文档里塞任意文本，列表页会把它当 src 渲染。
    // ★ 一次循环同时收 url 和它的尺寸（按下标配对），不再分别 filter 两个数组：
    //   图片和尺寸各过滤一遍，只要有一个过滤条件写歪，尺寸就会整体错位一格。
    const rawImages = Array.isArray(event.images) ? event.images : []
    const rawDims = Array.isArray(event.images_dim) ? event.images_dim : []
    const images = []
    const imagesDim = []
    for (let i = 0; i < rawImages.length && images.length < MAX_IMAGES; i++) {
      const u = rawImages[i]
      if (!(typeof u === 'string' && u && u.length <= MAX_IMAGE_LEN)) continue
      if (u.indexOf('cloud://') !== 0 && u.indexOf('https://') !== 0) continue
      images.push(u)
      // 尺寸项缺失/非法 → null 占位（不跳过），下标才能继续和 images 对齐
      imagesDim.push(normalizeDim(rawDims[i]))
    }

    // 空动态没有意义：既没字也没图，发出去就是一条空白卡片
    if (!content && !images.length) fail('写点什么，或者配一张图')

    const now = Date.now()

    // 每天 ≤20 条：和 card-publish 一样用「今天 00:00 的时间戳」做范围查询
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    const todayRes = await db
      .collection(COLL_POSTS)
      .where({
        owner_id: user._id,
        created_at: dbCmd.gte(dayStart.getTime()),
        status: dbCmd.neq('removed')
      })
      .count()
    const todayCount = todayRes.total || 0
    if (todayCount >= DAILY_LIMIT) {
      fail('今天已经发了 ' + todayCount + ' 条，每天最多 ' + DAILY_LIMIT + ' 条')
    }

    const post = {
      owner_id: user._id,
      content,
      // 存 fileID 不存临时 URL：tempFileURL 约 2 小时过期，
      // 存进去两天后整面墙全是白框，而且原始 fileID 已经丢了。
      images,
      media_type: images.length ? 'image' : 'text',
      // 冗余一份学校 / 城市：文档型不能 join，同校与地区两档靠它筛
      school_id: user.school_id || '',
      city_code: user.city_code || '',
      like_count: 0,
      comment_count: 0,
      status: 'normal',
      created_at: now,
      updated_at: now
    }
    // 只在真有图时写这个字段：纯文字动态的文档形态与改造前保持一致
    if (images.length) post.images_dim = imagesDim
    const addRes = await db.collection(COLL_POSTS).add(post)

    return {
      code: 0,
      msg: 'ok',
      data: { post_id: addRes.id, created_at: now, today_count: todayCount + 1 }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '发布失败' }
  }
}
