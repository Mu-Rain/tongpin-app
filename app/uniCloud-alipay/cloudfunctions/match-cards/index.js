'use strict'

/**
 * match-cards —— 「一键匹配」（US-16 / US-17 / US-18）
 *
 * 只有一个动作：
 *   action='list'
 *   入参：token（必填）、type（可选，空 = 不限类型）、
 *        exclude_ids（可选 string[]，「换一批」时传已展示过的 card_id）、
 *        limit（可选，默认 10，最大 10）
 *   出参：{ code, msg, data: { list, need_tags, hint } }
 *
 * 算法照 docs/03-database.md §5 实现，走 §5.3 的「方案 A」：
 * 云函数里拉候选集 + JS 打分，不用聚合管道。
 *   score = Σ(共同标签的 weight) ÷ Σ(请求方标签的 weight) × 100 → 0-100 整数
 *   硬过滤：type 相同 / status='open' / owner_id != 我 /
 *          发布者 credit_score >= 60 / deleted_at 为空
 *   排序：score 降序 → 同校优先 → created_at 降序 → 取前 limit
 *
 * 为什么必须走云函数（客户端直读被 DB Schema 挡掉）：
 *   1. 分母是「我」的标签权重，客户端算不了、也不能信客户端传来的分数
 *   2. 发布者信誉分在 users 表里，且用户信息必须白名单逐字段下发
 *   3. matches 记录要服务端写，客户端不该有这个写权限
 */

const db = uniCloud.database()
const dbCmd = db.command

// 集合名必须跟 user-register / user-login / user-tags / card-list 保持一致，否则查不到人
const DB_USERS = 'uni-id-users'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 10
// 候选集每批条数：照 §5.3 第 2 步「同校 / 非本校各取前 N 条」
const CANDIDATE_PER_BATCH = 50
const MIN_CREDIT = 60
// exclude_ids 上限：一次最多展示 10 条，换几批就够，传太多只会拖慢查询
const MAX_EXCLUDE = 200
// in 查询一次最多塞多少个 id
const IN_CHUNK = 50

// cards 只取打分与展示要用的字段
const CARD_FIELDS = {
  _id: true,
  owner_id: true,
  type: true,
  title: true,
  description: true,
  school_id: true,
  status: true,
  deleted_at: true,
  created_at: true
}

// 用户字段白名单（读），返回给前端时还要再手工挑一遍
const USER_FIELDS = {
  _id: true,
  nickname: true,
  avatar_url: true,
  avatar: true,
  school: true,
  school_id: true,
  schoolVerified: true,
  is_verified: true,
  credit: true,
  credit_score: true
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function ok(data) {
  return { code: 0, msg: 'ok', data: data }
}

// 业务错误一律走 code 返回，不 throw —— 这是正常返回，客户端自己判 code !== 0
function fail(code, msg) {
  return { code: code, msg: msg }
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function uniq(arr) {
  const seen = {}
  const out = []
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (!v || seen[v]) continue
    seen[v] = true
    out.push(v)
  }
  return out
}

// 信誉分兼容两套字段名：第 1 天注册写的是 credit，03 文档设计的是 credit_score。
// 两个都没有（用户文档不存在）时返回 0 → 会被 >= 60 的硬过滤挡掉，宁可不推也不能瞎推。
function creditOf(u) {
  if (!u) return 0
  if (typeof u.credit_score === 'number') return u.credit_score
  if (typeof u.credit === 'number') return u.credit
  return 80
}

/**
 * §5.1 公式：score = Σ(共同标签的 weight) ÷ Σ(请求方标签的 weight) × 100
 * 分子用「我」的权重 —— 语义是「我关心的标签里，有几成对方也满足」，
 * 所以结果天然 ≤ 100，分母不是两者之和（见 03 文档 §5.1 的说明）。
 *
 * @param {Object} myTagWeight   { tag_id: weight }，我选的标签
 * @param {Object} cardTagIdSet  { tag_id: true }，这张卡片带的标签
 * @return {Object} { score, hit_weight, total_weight, common_tag_count }
 */
function calcScore(myTagWeight, cardTagIdSet) {
  let totalWeight = 0
  let hitWeight = 0
  let commonCount = 0
  Object.keys(myTagWeight).forEach(function (tid) {
    const w = myTagWeight[tid]
    totalWeight += w
    if (cardTagIdSet[tid]) {
      hitWeight += w
      commonCount++
    }
  })
  let score = 0
  if (totalWeight > 0) score = Math.round((hitWeight / totalWeight) * 100)
  if (score > 100) score = 100
  if (score < 0) score = 0
  return { score: score, hit_weight: hitWeight, total_weight: totalWeight, common_tag_count: commonCount }
}

// §5.2 排序：score 降序 → 同校优先 → created_at 降序
function compareMatches(a, b) {
  if (b.score !== a.score) return b.score - a.score
  if (a.same_school !== b.same_school) return b.same_school ? 1 : -1
  return (b.created_at || 0) - (a.created_at || 0)
}

exports.main = async (event) => {
  try {
    const action = str(event.action) || 'list'
    if (action !== 'list') return fail(400, '未知操作：' + action)

    const token = str(event.token)
    if (!token) return fail(401, '未登录')

    // —— 1. token 换用户 ——
    const meRes = await db.collection(DB_USERS).where({ token: token }).limit(1).get()
    if (!meRes.data.length) return fail(401, '登录已过期，请重新登录')
    const me = meRes.data[0]
    if (me.tokenExpire && me.tokenExpire < Date.now()) return fail(401, '登录已过期，请重新登录')
    if (me.status === 'banned') return fail(403, '账号已被封禁')

    const type = str(event.type)
    let limit = parseInt(event.limit, 10)
    if (!(limit >= 1)) limit = DEFAULT_LIMIT
    if (limit > MAX_LIMIT) limit = MAX_LIMIT

    let excludeIds = Array.isArray(event.exclude_ids) ? event.exclude_ids.filter((x) => typeof x === 'string' && x) : []
    excludeIds = uniq(excludeIds).slice(0, MAX_EXCLUDE)

    // —— 2. 我的标签（分母）。一次查询拿齐 ——
    const utRes = await db.collection('user_tags').where({ user_id: me._id }).get()
    const myTagWeight = {}
    ;(utRes.data || []).forEach((r) => {
      myTagWeight[r.tag_id] = typeof r.weight === 'number' && r.weight > 0 ? r.weight : 1
    })
    if (!Object.keys(myTagWeight).length) {
      // 一个标签都没选 → 分母是 0，算不出贴合度。
      // 这种"算不出来"必须如实告诉用户并在前端给出路（US-17），不能假装返回一堆 0 分结果。
      return ok({
        list: [],
        need_tags: true,
        hint: '你还没有选择标签，先到「我的标签」选 8 - 10 个你在意的标签，才能算贴合度'
      })
    }

    // —— 3. 候选集：status=open、type（传了才筛）、不是我的卡、排除已展示过的 ——
    const where = { status: 'open' }
    if (type) where.type = type
    where.owner_id = dbCmd.neq(me._id)
    if (excludeIds.length) where._id = dbCmd.nin(excludeIds)

    const mySchool = me.school_id || ''
    let cards = []
    if (mySchool) {
      // 同校 / 非本校分两批各取前 N 条：否则"别校的卡片"会按时间把同校的挤出去，
      // 同校优先这条排序规则就没机会生效
      const sameRes = await db
        .collection('cards')
        .where(Object.assign({}, where, { school_id: mySchool }))
        .field(CARD_FIELDS)
        .orderBy('created_at', 'desc')
        .limit(CANDIDATE_PER_BATCH)
        .get()
      const otherRes = await db
        .collection('cards')
        .where(Object.assign({}, where, { school_id: dbCmd.neq(mySchool) }))
        .field(CARD_FIELDS)
        .orderBy('created_at', 'desc')
        .limit(CANDIDATE_PER_BATCH)
        .get()
      cards = (sameRes.data || []).concat(otherRes.data || [])
    } else {
      // 没填学校：不能按同校分池，退化成一批全站候选
      const allRes = await db
        .collection('cards')
        .where(where)
        .field(CARD_FIELDS)
        .orderBy('created_at', 'desc')
        .limit(CANDIDATE_PER_BATCH * 2)
        .get()
      cards = allRes.data || []
    }

    // 硬过滤：deleted_at 为空（软删除的不要）。
    // 这一条放在 JS 里判、不写进 where —— deleted_at 很可能是 null（字段在、值为空），
    // dbCmd.exists(false) 会把这类正常卡片一起排除掉，误伤数据。
    cards = cards.filter((c) => !c.deleted_at)

    if (!cards.length) return ok({ list: [], need_tags: false, hint: '' })

    // —— 4. 发布者一次拉齐（分批 in，不要 N+1）——
    const ownerIds = uniq(cards.map((c) => c.owner_id))
    const ownerMap = {}
    for (const part of chunk(ownerIds, IN_CHUNK)) {
      const r = await db.collection(DB_USERS).where({ _id: dbCmd.in(part) }).field(USER_FIELDS).get()
      ;(r.data || []).forEach((u) => {
        ownerMap[u._id] = u
      })
    }

    // 硬过滤：发布者 credit_score >= 60（低信誉用户不能被推荐）
    cards = cards.filter((c) => creditOf(ownerMap[c.owner_id]) >= MIN_CREDIT)
    if (!cards.length) return ok({ list: [], need_tags: false, hint: '' })

    // —— 5. 卡片的标签（分批 in）——
    const cardIds = cards.map((c) => c._id)
    const tagIdsByCard = {}
    for (const part of chunk(cardIds, IN_CHUNK)) {
      const r = await db.collection('card_tags').where({ card_id: dbCmd.in(part) }).get()
      ;(r.data || []).forEach((ct) => {
        if (!tagIdsByCard[ct.card_id]) tagIdsByCard[ct.card_id] = []
        tagIdsByCard[ct.card_id].push(ct.tag_id)
      })
    }

    // 共同标签要显示名字，拉一次 tags 字典
    const needTagIds = uniq([].concat.apply([], Object.keys(tagIdsByCard).map((k) => tagIdsByCard[k])))
    const tagMap = {}
    for (const part of chunk(needTagIds, IN_CHUNK)) {
      if (!part.length) continue
      const r = await db.collection('tags').where({ _id: dbCmd.in(part) }).get()
      ;(r.data || []).forEach((t) => {
        tagMap[t._id] = t
      })
    }

    // —— 6. JS 打分（§5.3 第 4 步：几十条数据一次循环，毫秒级）——
    const list = cards.map((c) => {
      const ids = tagIdsByCard[c._id] || []
      const idSet = {}
      ids.forEach((tid) => {
        idSet[tid] = true
      })
      const scored = calcScore(myTagWeight, idSet)
      const o = ownerMap[c.owner_id] || {}
      const commonIds = ids.filter((tid) => myTagWeight[tid] !== undefined)
      return {
        card_id: c._id,
        title: c.title || '',
        description: c.description || '',
        type: c.type || '',
        owner_id: c.owner_id,
        score: scored.score,
        common_tag_count: commonIds.length,
        common_tags: commonIds.map((tid) => ({
          tag_id: tid,
          name: (tagMap[tid] && tagMap[tid].name) || ''
        })),
        // 同校 = 我的 school_id 与卡片冗余的 school_id 相等（没填学校时为 false）
        same_school: !!(mySchool && c.school_id === mySchool),
        created_at: c.created_at || 0,
        // 用户信息手写白名单逐字段挑，绝不把整条用户文档下发
        owner: {
          nickname: o.nickname || '同学',
          avatar: o.avatar_url || o.avatar || '',
          school_id: o.school_id || c.school_id || '',
          is_verified: !!(o.is_verified || o.schoolVerified),
          credit_score: creditOf(o)
        }
      }
    })

    // —— 7. 排序 + 截前 limit ——
    list.sort(compareMatches)
    const top = list.slice(0, limit)

    // —— 8. 写 matches 记录（§5.3 第 6 步）——
    // 返回几条就记几条：matches 是 (user_id, card_id) 粒度的匹配流水，
    // 记 1 条看不出"算法真的在跑"，记全部才经得起答辩追问。
    // 记录失败不影响本次匹配结果，所以单独兜一层 catch。
    const now = Date.now()
    for (let i = 0; i < top.length; i++) {
      try {
        await db.collection('matches').add({
          user_id: me._id,
          card_id: top[i].card_id,
          score: top[i].score,
          common_tag_count: top[i].common_tag_count,
          created_at: now
        })
      } catch (e) {
        // 静默：匹配结果是主线，流水记录是副产物
      }
    }

    return ok({ list: top, need_tags: false, hint: '' })
  } catch (e) {
    return fail(500, e.message || '匹配失败')
  }
}

// 下面两个纯函数额外导出，只为让本地单测能直接 require 本文件验证公式与排序，
// 线上调用只认 exports.main，多导出不影响 uniCloud 运行。
exports.calcScore = calcScore
exports.compareMatches = compareMatches
