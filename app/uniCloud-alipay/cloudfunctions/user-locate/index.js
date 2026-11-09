'use strict'

/**
 * user-locate —— 落库「我」的定位（用户主动授权后调用一次）
 *
 * 入参：
 *   token  必填，登录令牌
 *   lat    number，纬度，-90..90
 *   lng    number，经度，-180..180
 *   name   可选，地点名（如「图书馆」），截 40 字
 *
 * 出参：{ code: 0, msg: 'ok', data: { geo_lat, geo_lng, geo_name, geo_at } }
 *   geo_at 是毫秒时间戳：表示「这个坐标是什么时候的」，前端据此判断要不要重新定位
 *
 * 契约（本轮只写这些字段，不改名、不新建集合）：
 *   - 只写 uni-id-users 的 geo_lat / geo_lng / geo_name / geo_at
 *   - 未登录 / token 失效 → fail(401)
 *   - lat / lng 必须是有穷数字且在范围内 → 否则 fail(400)，绝不落库脏坐标
 *     脏坐标的代价不是这一行难看，而是这个人的卡全被算到几千公里外、附近档永远空
 *   - name 截 40 字：再长前端的地点标签就折行了
 *
 * 为什么不接受客户端传 user_id：
 *   身份只从 token 换。让客户端指定「写谁」，等于把全站用户的定位交给前端。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const MAX_NAME_LEN = 40

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
  return r.data[0]
}

/**
 * 坐标校验：必须是有限数字且在范围内。
 * 为什么不用 parseFloat 兜底：'12abc' 会被 parseFloat 成 12，
 * 客户端传错就静默写入一个错坐标，比直接报错难查得多。
 */
function coord(v, min, max, label) {
  if (typeof v !== 'number') fail(label + '必须是数字')
  if (!isFinite(v)) fail(label + '不合法')
  if (v < min || v > max) fail(label + '超出范围')
  return v
}

exports.main = async (event) => {
  try {
    const user = await getUserByToken(str(event.token))
    // 封禁账号不改任何资料：定位字段会被列表侧当成「活人信号」用
    if (user.status === 'banned') fail('账号已被封禁', 403)

    const lat = coord(event.lat, -90, 90, '纬度')
    const lng = coord(event.lng, -180, 180, '经度')
    const name = str(event.name).slice(0, MAX_NAME_LEN)
    // 服务端取时间：客户端时钟不可信，geo_at 会被用来判断「这次定位还算不算新鲜」
    const geoAt = Date.now()

    await db
      .collection(DB_USERS)
      .doc(user._id)
      .update({
        geo_lat: lat,
        geo_lng: lng,
        geo_name: name,
        geo_at: geoAt
      })

    return {
      code: 0,
      msg: 'ok',
      data: {
        geo_lat: lat,
        geo_lng: lng,
        geo_name: name,
        geo_at: geoAt
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '定位保存失败' }
  }
}
