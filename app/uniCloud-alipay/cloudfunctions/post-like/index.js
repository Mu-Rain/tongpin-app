'use strict'

/**
 * 动态点赞 —— 点赞 / 取消点赞
 *
 * 入参：{ token, card_id, like }
 *   like 为真  -> 点赞（幂等：已经点过就当成功）
 *   like 为假  -> 取消（幂等：本来没点过也算成功）
 * 支持两种目标（同一个点赞表，靠 id 不撞来区分）：
 *   card_id 是搭子卡片 id -> 大厅/详情页的点赞
 *   card_id 是动态 id     -> 同频圈的点赞
 *   先查 cards 再查 posts，都没有才算 404。字段名叫 card_id 是历史包袱，
 *   实际语义是「被点赞对象的 id」，换表不改字段名是为了不迁移已有的点赞数据。
 *
 * 出参：{ code: 0, msg: 'ok', data: { like_count } }
 *   like_count 是本次操作后该卡的真实总数，前端用它覆盖本地乐观值 ——
 *   乐观 +1 在弱网重试下会飘，只有服务端重算的数字能对齐。
 *
 * 为什么判重要写在应用层：
 *   唯一索引 idx_card_user 才是并发下的最后一道防线，但本项目当前环境
 *   唯一索引并没有真正生效，光靠 add 会插出重复行。所以插入前先查一次，
 *   唯一索引只当兜底（并发窗口内两个请求都判定"没点过"时才会撞上）。
 *
 * 为什么删不到也返回成功：
 *   取消点赞是幂等操作，用户连点两下不该看到一个 500。
 */

const db = uniCloud.database()

// 集合名必须跟 user-login / card-favorite 保持一致，否则查不到人
const DB_USERS = 'uni-id-users'
const DB_CARDS = 'cards'
const DB_POSTS = 'posts'
const DB_LIKES = 'card_likes'

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// like 可能来自 JSON 的布尔、也可能是 0/1 或 'true' 字符串，统一收成布尔
function toBool(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = str(v).toLowerCase()
  return s === 'true' || s === '1' || s === 'yes'
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

/**
 * 定位被点赞的对象：先 cards 再 posts。
 * 返回集合名，null 表示两边都查不到。
 */
async function findTarget(cardId) {
  if (!cardId) fail('缺少内容 id', 400)

  const cRes = await db.collection(DB_CARDS).where({ _id: cardId }).limit(1).get()
  if (cRes.data.length) {
    const card = cRes.data[0]
    // status === 'deleted' 是契约里的删除标记；deleted_at 是本项目既有的软删写法，
    // 两个都读，避免软删过的卡片还能被点赞
    if (card.status === 'deleted' || card.deleted_at) fail('内容不存在或已被删除', 404)
    return DB_CARDS
  }

  const pRes = await db.collection(DB_POSTS).where({ _id: cardId }).limit(1).get()
  if (pRes.data.length) {
    const post = pRes.data[0]
    if (post.status === 'removed' || post.deleted_at) fail('内容不存在或已被删除', 404)
    return DB_POSTS
  }

  fail('内容不存在或已被删除', 404)
}

async function countLikes(cardId) {
  const r = await db.collection(DB_LIKES).where({ card_id: cardId }).count()
  return r.total || 0
}

/**
 * 点赞。返回是否真的新增了一条（false = 之前就点过）。
 * 需要这个布尔值是因为 posts 上的 like_count 是冗余字段，
 * 只有真实发生变化时才该去改它，否则重复请求会把数字越加越大。
 */
async function like(me, cardId) {
  const exist = await db
    .collection(DB_LIKES)
    .where({ card_id: cardId, user_id: me._id })
    .limit(1)
    .get()

  // 首道判重：唯一索引在本项目当前环境未生效，这一步才是真正拦住重复插入的地方
  if (exist.data.length) return false

  try {
    await db.collection(DB_LIKES).add({
      card_id: cardId,
      user_id: me._id,
      created_at: Date.now()
    })
    return true
  } catch (e) {
    // 唯一索引 idx_card_user 拦下了重复插入：说明并发下另一个请求刚插进来。
    // 点赞是幂等的，这不是错误，直接当成功。
    return false
  }
}

/** 取消点赞。返回是否真的删掉了一条。 */
async function unlike(me, cardId) {
  // 删不到也算成功：remove 对有 0 条命中的情况本就不抛错
  const r = await db
    .collection(DB_LIKES)
    .where({ card_id: cardId, user_id: me._id })
    .remove()
  return (r && r.deleted ? r.deleted : 0) > 0
}

exports.main = async (event) => {
  try {
    const token = str(event.token)
    const me = await getUserByToken(token)

    const cardId = str(event.card_id)
    const target = await findTarget(cardId)

    let changed
    if (toBool(event.like)) {
      changed = await like(me, cardId)
    } else {
      changed = await unlike(me, cardId)
    }

    // 不论点赞还是取消，返回前都重算真实总数，前端拿它覆盖本地乐观值
    const likeCount = await countLikes(cardId)

    // posts 上存了一份冗余计数（动态列表直接读字段，不为每条动态做一次聚合）。
    // 以 card_likes 的真实条数为准覆盖它，不做 inc：
    // inc 在「上面那道判重判错」时会永久漂移，覆盖写每次都自愈。
    // 只在真的发生变化时写，省一次更新。
    if (target === DB_POSTS && changed) {
      try {
        await db.collection(DB_POSTS).doc(cardId).update({ like_count: likeCount })
      } catch (e) {
        console.warn('[post-like] 同步 posts.like_count 失败', e && e.message)
      }
    }

    return { code: 0, msg: 'ok', data: { like_count: likeCount } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '服务端错误' }
  }
}
