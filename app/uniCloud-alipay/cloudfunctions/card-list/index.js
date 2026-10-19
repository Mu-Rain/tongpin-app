'use strict'

/**
 * 搭子大厅列表
 *
 * 入参：
 *   token    可选。登录了才能看到"共同标签"高亮与申请状态
 *   type     可选。study / fitness / photo / meal / sport / other；不传 = 全部
 *   scope    可选。school（同校）/ nearby（附近）/ city（城市），默认 school
 *   page     可选，默认 1
 *   page_size 可选，默认 20，上限 50
 *
 * 出参：{ code, msg, data: { list: [...], has_more, total } }
 *
 * 每条卡片的形状（前端直接渲染，不用再查）：
 *   {
 *     _id, type, title, description,
 *     location_name, start_time, expected_people, created_at,
 *     owner: { _id, nickname, avatar_url, school, is_verified, credit_score, user_no },
 *     tags: [{ _id, name, category }],
 *     common_tags: [tag_id],     // 与我的标签重合的，前端高亮
 *     is_mine: bool
 *   }
 */

const db = uniCloud.database()
const dbCmd = db.command

// 集合名必须跟 user-register / user-login / user-tags 保持一致，否则查不到人
const DB_USERS = 'uni-id-users'

const TEASER_FIELDS = {
  _id: true,
  owner_id: true,
  type: true,
  title: true,
  description: true,
  school_id: true,
  city_code: true,
  location_name: true,
  start_time: true,
  expected_people: true,
  status: true,
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

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// 把数组切成每片 n 个，用于分批 in 查询（in 的数组太长会拖慢查询）
function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

exports.main = async (event) => {
  try {
    const token = str(event.token)
    const type = str(event.type)
    const scope = str(event.scope) || 'school'
    const page = Math.max(1, parseInt(event.page, 10) || 1)
    let pageSize = parseInt(event.page_size, 10) || 20
    if (pageSize > 50) pageSize = 50
    if (pageSize < 1) pageSize = 20

    // —— 0. 拿到"我"（没登录也能逛大厅，只是没有共同标签）——
    let me = null
    if (token) {
      const meRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
      if (meRes.data.length) me = meRes.data[0]
    }

    // —— 1. 组装查询条件 ——
    // 注意 school_id 为空时不能按同校筛，否则未填学校的用户在大厅里什么都看不到
    const where = { status: 'open' }
    if (type) where.type = type
    // 筛选被降级时的说明（空 = 正常筛选）
    let degraded = ''

    if (scope === 'school') {
      if (!me || !me.school_id) {
        return {
          code: 0,
          msg: 'ok',
          data: { list: [], has_more: false, total: 0, reason: 'no_school', hint: '完成学生认证后才能看同校频道' }
        }
      }
      where.school_id = me.school_id
    } else if (scope === 'city') {
      // 城市：本城市优先。没填城市码时退化成「全部」，但不能假装筛过了 ——
      // 带上 reason 让前端说明，否则用户以为筛完只剩这些，其实根本没筛。
      if (me && me.city_code) {
        where.city_code = me.city_code
      } else {
        degraded = 'no_city'
      }
    } else if (scope === 'nearby') {
      // 附近：本期没有定位权限（manifest 里已删掉定位权限），无法算真实距离。
      // 折中做法：按「同城」近似，并在返回里明确告诉前端这是近似值。
      // 这样比直接退化成「全部」诚实 —— 用户点「附近」看到的是同城而不是全国。
      if (me && me.city_code) {
        where.city_code = me.city_code
      } else if (me && me.school_id) {
        // 连城市都没有时，退一级用同校，仍然比全国更有意义
        where.school_id = me.school_id
        degraded = 'nearby_as_school'
      } else {
        degraded = 'no_location'
      }
    }

    // —— 2. 查卡片 ——
    const query = db.collection('cards').where(where)
    const countRes = await query.count()
    const total = countRes.total

    const cardRes = await db
      .collection('cards')
      .where(where)
      .field(TEASER_FIELDS)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    const cards = cardRes.data
    if (!cards.length) {
      return { code: 0, msg: 'ok', data: { list: [], has_more: false, total, degraded } }
    }

    // —— 3. 批量补数据（三次查询搞定，不要 N+1）——
    const cardIds = cards.map((c) => c._id)
    const ownerIds = []
    cards.forEach((c) => {
      if (c.owner_id && ownerIds.indexOf(c.owner_id) < 0) ownerIds.push(c.owner_id)
    })

    // 3.1 发布者
    const ownerMap = {}
    for (const part of chunk(ownerIds, 50)) {
      const r = await db.collection(DB_USERS).where({ _id: dbCmd.in(part) }).field(USER_FIELDS).get()
      r.data.forEach((u) => {
        ownerMap[u._id] = u
      })
    }

    // 3.2 卡片标签
    const ctRes = await db.collection('card_tags').where({ card_id: dbCmd.in(cardIds) }).get()
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

    // 3.3 我的标签（算共同标签）
    const myTagIds = []
    if (me) {
      const myRes = await db.collection('user_tags').where({ user_id: me._id }).get()
      myRes.data.forEach((ut) => myTagIds.push(ut.tag_id))
    }

    // —— 4. 拼装返回 ——
    const list = cards.map((c) => {
      const tagIds = tagIdsByCard[c._id] || []
      const tags = tagIds
        .map((tid) => tagMap[tid])
        .filter(Boolean)
        .map((t) => ({ _id: t._id, name: t.name, category: t.category }))
      const common = tagIds.filter((tid) => myTagIds.indexOf(tid) >= 0)

      const owner = ownerMap[c.owner_id] || {}
      delete c.owner_id
      delete c.school_id
      delete c.city_code

      return Object.assign(c, {
        owner: {
          _id: owner._id || '',
          nickname: owner.nickname || '同学',
          avatar_url: owner.avatar_url || owner.avatar || '',
          school: owner.school || '',
          // 兼容两套字段名：第 1 天注册写的是 schoolVerified/credit，
          // 03 文档设计的是 is_verified/credit_score。两处都读，避免列表与详情页显示不一致。
          is_verified: !!(owner.is_verified || owner.schoolVerified),
          credit_score:
            typeof owner.credit_score === 'number'
              ? owner.credit_score
              : typeof owner.credit === 'number'
                ? owner.credit
                : 80,
          user_no: owner.user_no || ''
        },
        tags,
        common_tags: common,
        common_tag_count: common.length,
        is_mine: !!(me && c.created_at && owner._id === me._id)
      })
    })

    // 排序：共同标签多的排前面（这是"同频"的直观体现），其次按时间
    list.sort((a, b) => {
      if (b.common_tag_count !== a.common_tag_count) return b.common_tag_count - a.common_tag_count
      return b.created_at - a.created_at
    })

    return {
      code: 0,
      msg: 'ok',
      data: {
        list,
        has_more: page * pageSize < total,
        page,
        total,
        // '' 正常；'no_city' 没城市码退回全国；'nearby_as_school' 没城市码用同校近似；
        // 'no_location' 什么都没有退回全国。前端据此显示一行说明，避免用户误以为筛过了。
        degraded
      }
    }
  } catch (e) {
    return { code: 500, msg: e.message || '加载失败' }
  }
}
