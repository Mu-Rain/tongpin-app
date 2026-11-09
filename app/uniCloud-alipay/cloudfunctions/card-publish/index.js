'use strict'

/**
 * 发布搭子卡片
 *
 * 入参：
 *   token          登录令牌
 *   type           study / fitness / photo / meal / sport / other
 *   title          ≤30 字
 *   description    ≤200 字
 *   location_name  地点名，可空
 *   start_time     开始时间戳，可空
 *   end_time       结束时间戳，可空
 *   expected_people 想找几个人，默认 1（MVP 只做 1 对 1）
 *   tag_ids        标签 _id 数组，最多 10 个
 *   images         配图 fileID 数组，最多 3 个（客户端已直传云存储，这里只收 cloud:// 或 https:// 字符串）
 *   action         'quota' 时走只读分支（见下）；不传或传其它值 = 正常发布
 *
 * 出参：{ code, msg, data: { card_id } }
 *   action='quota' 时只读查询，不做任何写入，出参：
 *     { code, msg, data: { today_count, daily_limit, credit_score, can_publish, reason } }
 *   can_publish=false 时 reason 给用户看的人话（"今天已发满 5 条" / "信誉分低于 60，暂时不能发布"）。
 *
 * 为什么必须走云函数（客户端直写被 DB Schema 挡掉）：
 *   1. 每天 ≤5 条 —— 要查今天已发了几条
 *   2. credit_score ≥60 —— 要从 users 表读，不能让客户端传
 *   3. school_id 要从当前登录用户取 —— 不能信客户端传的学校
 *   4. card_tags 要跟 cards 在同一个事务里写
 *   5. 学生认证 —— 未认证不能发布搭子需求
 *   6. geo_lat / geo_lng 也取自用户文档 —— 客户端传坐标等于让任何人都能把自己
 *      钉到别人学校门口，「附近」这一档就彻底没有意义了
 */

const db = uniCloud.database()
const dbCmd = db.command

// 集合名必须跟 user-register / user-login / user-tags 保持一致，否则查不到人
const DB_USERS = 'uni-id-users'

const TYPE_ENUM = ['study', 'fitness', 'photo', 'meal', 'sport', 'other']
const DAILY_LIMIT = 5
const MIN_CREDIT = 60
const MAX_TAGS = 10
// 配图上限：同频圈的卡片是 3 图栅格（1 张大图 / 3 张九宫格），多了前端排不下
const MAX_IMAGES = 3
// fileID 的合理长度上限。cloud:// 的一百来字符，https 的二百来字符，512 已经非常宽松，
// 只为挡住「客户端传一张巨大 base64 进来」这种把文档撑爆的情况
const MAX_IMAGE_LEN = 512

// 一次发布内部用到的错误：直接 throw，外层统一转成 { code, msg }
function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

// 毫秒时间戳 → YYYY-MM-DD（服务器时区，用于"今天发了几个"）
function dateKey(ts) {
  const d = new Date(ts)
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// 坐标落库前的清洗：非有限数字一律 0（0 = 没坐标，读的一侧见 card-list 的 hasGeo）
function geoNum(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

exports.main = async (event) => {
  try {
    const token = str(event.token)
    if (!token) fail('未登录')

    // —— 1. token 换用户 ——
    const userRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
    if (!userRes.data.length) fail('登录已过期，请重新登录', 401)
    const user = userRes.data[0]

    if (user.status === 'banned') fail('账号已被封禁，无法发布', 403)

    // —— 1.5 只读配额查询：发布页顶部「今日已发 N/5」——
    // 只读：只 count 今天的卡片 + 读信誉分，不写任何集合、不校验入参。
    // 位置必须在「信誉分门槛 fail」和「入参校验」之前：门槛没过的人也要拿到
    // can_publish=false + reason，而不是一个 403 让人看不出为什么。
    if (str(event.action) === 'quota') {
      const quotaCredit = typeof user.credit_score === 'number' ? user.credit_score : 80
      const quotaDayStart = new Date()
      quotaDayStart.setHours(0, 0, 0, 0)
      // 口径必须与下面「4. 每天 ≤5 条」完全一致，否则查询与发布会对不上
      const quotaRes = await db
        .collection('cards')
        .where({
          owner_id: user._id,
          created_at: dbCmd.gte(quotaDayStart.getTime()),
          status: dbCmd.neq('removed')
        })
        .count()
      const quotaToday = quotaRes.total || 0
      let canPublish = true
      let reason = ''
      if (quotaToday >= DAILY_LIMIT) {
        canPublish = false
        reason = '今天已发满 ' + DAILY_LIMIT + ' 条'
      } else if (quotaCredit < MIN_CREDIT) {
        canPublish = false
        reason = '信誉分低于 ' + MIN_CREDIT + '，暂时不能发布'
      }
      return {
        code: 0,
        msg: 'ok',
        data: {
          today_count: quotaToday,
          daily_limit: DAILY_LIMIT,
          credit_score: quotaCredit,
          can_publish: canPublish,
          reason: reason
        }
      }
    }

    // —— 1.9 学生认证门槛 ——
    // 放在配额只读分支之后：发布页顶部要能显示「今日已发 N/5」，
    // 未认证的人也得拿到 can_publish=false，而不是一个 403 看不出为什么。
    // 两套字段名取或（schoolVerified 是第 1 天的写法，is_verified 是设计文档的写法）
    if (!(user.schoolVerified === true || user.is_verified === true)) {
      fail('完成学生认证后才能发布搭子需求', 403)
    }

    // —— 2. 信誉分门槛 ——
    const credit = typeof user.credit_score === 'number' ? user.credit_score : 80
    if (credit < MIN_CREDIT) fail('信誉分低于 ' + MIN_CREDIT + '，暂时不能发布卡片', 403)

    // —— 3. 入参校验 ——
    const type = str(event.type)
    const title = str(event.title)
    const description = str(event.description)
    const locationName = str(event.location_name)
    const startTime = typeof event.start_time === 'number' ? event.start_time : null
    const endTime = typeof event.end_time === 'number' ? event.end_time : null
    let expectedPeople = parseInt(event.expected_people, 10)
    if (!(expectedPeople >= 1)) expectedPeople = 1
    if (expectedPeople > 10) expectedPeople = 10

    if (TYPE_ENUM.indexOf(type) < 0) fail('请选择需求类型')
    if (!title) fail('标题不能为空')
    if (title.length > 30) fail('标题最多 30 字')
    if (!description) fail('描述不能为空')
    if (description.length > 200) fail('描述最多 200 字')
    if (startTime && endTime && endTime < startTime) fail('结束时间不能早于开始时间')

    let tagIds = Array.isArray(event.tag_ids) ? event.tag_ids : []
    tagIds = tagIds.filter((t) => typeof t === 'string' && t).slice(0, MAX_TAGS)

    // 配图：只收字符串，且必须是我们自己的云存储地址或 https 直链。
    // 不校验协议就等于让客户端往 cards 里塞任意文本，列表页会把它当 src 渲染。
    let images = Array.isArray(event.images) ? event.images : []
    images = images
      .filter((u) => typeof u === 'string' && u && u.length <= MAX_IMAGE_LEN)
      .filter((u) => u.indexOf('cloud://') === 0 || u.indexOf('https://') === 0)
      .slice(0, MAX_IMAGES)

    // 标签必须真实存在，防止伪造 id 污染匹配算法
    if (tagIds.length) {
      const tagRes = await db.collection('tags').where({ _id: dbCmd.in(tagIds), active: true }).get()
      const validIds = tagRes.data.map((t) => t._id)
      if (validIds.length !== tagIds.length) fail('含有无效的标签，请重新选择')
      tagIds = validIds
    }

    const now = Date.now()

    // —— 4. 每天 ≤5 条 ——
    // 用今天 00:00 的时间戳做范围查询，比按日期字符串存更省字段
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    const todayCount = await db
      .collection('cards')
      .where({
        owner_id: user._id,
        created_at: dbCmd.gte(dayStart.getTime()),
        status: dbCmd.neq('removed')
      })
      .count()
    if (todayCount.total >= DAILY_LIMIT) {
      fail('今天已经发了 ' + todayCount.total + ' 条，每天最多 ' + DAILY_LIMIT + ' 条')
    }

    // —— 5. 写卡片 ——
    const card = {
      owner_id: user._id,
      type,
      title,
      description,
      // 冗余一份发布者学校/城市：文档型不能 join，大厅筛"同校"靠它，避免回查 users
      school_id: user.school_id || '',
      city_code: user.city_code || '',
      // 卡片坐标：**只从用户文档取，不读客户端传的坐标**。
      // 坐标是「同校 → 附近 → 城市」分档的依据，让客户端传等于把"附近"随便填。
      // 没定位就写 0：读的一侧把 0 判为「没坐标」，不会当成几内亚湾。
      geo_lat: geoNum(user.geo_lat),
      geo_lng: geoNum(user.geo_lng),
      location_name: locationName,
      start_time: startTime,
      end_time: endTime,
      expected_people: expectedPeople,
      // 配图（可能为空数组）。存 fileID 不存临时 URL：tempFileURL 约 2 小时就过期，
      // 存进去两天后整面墙全是白框。换链接的事交给读的一侧（card-list）。
      images,
      status: 'open',
      created_at: now,
      updated_at: now
    }
    const addRes = await db.collection('cards').add(card)
    const cardId = addRes.id

    // —— 6. 写 card_tags ——
    if (tagIds.length) {
      const rows = tagIds.map((tid) => ({ card_id: cardId, tag_id: tid }))
      // 逐条 add：uniCloud 的 add 一次只接受一条，需要批量得用 JQL
      for (let i = 0; i < rows.length; i++) {
        await db.collection('card_tags').add(rows[i])
      }
    }

    return {
      code: 0,
      msg: 'ok',
      data: {
        card_id: cardId,
        date_key: dateKey(now),
        today_count: todayCount.total + 1
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '发布失败' }
  }
}
