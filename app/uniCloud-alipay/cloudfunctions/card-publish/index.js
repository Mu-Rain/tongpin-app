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
 *
 * 出参：{ code, msg, data: { card_id } }
 *
 * 为什么必须走云函数（客户端直写被 DB Schema 挡掉）：
 *   1. 每天 ≤5 条 —— 要查今天已发了几条
 *   2. credit_score ≥60 —— 要从 users 表读，不能让客户端传
 *   3. school_id 要从当前登录用户取 —— 不能信客户端传的学校
 *   4. card_tags 要跟 cards 在同一个事务里写
 */

const db = uniCloud.database()
const dbCmd = db.command

// 集合名必须跟 user-register / user-login / user-tags 保持一致，否则查不到人
const DB_USERS = 'uni-id-users'

const TYPE_ENUM = ['study', 'fitness', 'photo', 'meal', 'sport', 'other']
const DAILY_LIMIT = 5
const MIN_CREDIT = 60
const MAX_TAGS = 10

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

exports.main = async (event) => {
  try {
    const token = str(event.token)
    if (!token) fail('未登录')

    // —— 1. token 换用户 ——
    const userRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
    if (!userRes.data.length) fail('登录已过期，请重新登录', 401)
    const user = userRes.data[0]

    if (user.status === 'banned') fail('账号已被封禁，无法发布', 403)

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
      location_name: locationName,
      start_time: startTime,
      end_time: endTime,
      expected_people: expectedPeople,
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
