'use strict'
/**
 * card-seed —— 灌「匹配测试」用的虚拟卡片（一次性工具，幂等）
 *
 * 为什么需要它：
 *   匹配算法会硬过滤掉「自己发的卡片」和「信誉分 < 60 的发布者」，
 *   所以想测匹配，卡片必须挂在「别的用户」名下，且这些用户要真实存在。
 *   这个函数同时建虚拟用户 + 卡片 + 卡片的标签，一次灌好即可开测。
 *
 * 怎么跑（★ 必须带参数，否则不知道自己是谁、也不知道该跟谁同校）：
 *   HBuilderX 里右键本函数 → 「上传并运行」时**填参数**。
 *   参数（都是可选，但强烈建议至少给 school_id）：
 *     {
 *       school_id: 'S123456',   // 你的学校 id。给了它，「同校优先」才能被验证到
 *       school: '我的大学',
 *       tag_ids: ['t1','t2',...], // 你自己的标签 id。给了它，百分比才是按你的标签算的
 *       reset: true              // 清空重灌
 *     }
 *
 *   school_id / tag_ids 从哪里拿？
 *     - school_id：登录后「我的」页看学校，或直接查云数据库 uni-id-users 里你那条的 school_id
 *     - tag_ids：登录后「我的标签」页选好标签，再查 user_tags 集合里 user_id = 你的那条
 *   不方便查也没关系：不传也能灌，只是「同校」与「百分比」这两项验不准。
 *
 * ★ 幂等：按固定 _id 判重，重复运行不会产生重复数据。
 *
 * 它灌的卡片覆盖了匹配算法的每一条分支（见 SEED_CARDS 的 note 字段）：
 *   满分 / 部分重合 / 少重合 / 零重合 / 外校 / 类型不符 / 低信誉 / 已匹配 / 已删除
 *   其中后四类**故意做成应该被筛掉**的，用来验证硬过滤真的生效。
 *
 * 安全：上线前把 ALLOW 改成 false 或删掉这个云函数。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_CARDS = 'cards'
const DB_CARD_TAGS = 'card_tags'
const DB_TAGS = 'tags'
const DB_USER_TAGS = 'user_tags'

// 安全：一次性灌数据工具，正式环境默认关闭（上线前需 ALLOW=false）。
const ALLOW = false
const OTHER_SCHOOL = '__seed_other_school__'

// 虚拟发布者。credit 决定能否被推荐（>= 60）；same 决定学校是否与测试者同校
const SEED_USERS = [
  { _id: 'seed_u_full', nickname: '林小满', credit: 95, same: true },
  { _id: 'seed_u_part', nickname: '周叙', credit: 90, same: true },
  { _id: 'seed_u_low', nickname: '信誉待恢复', credit: 40, same: true },
  { _id: 'seed_u_other', nickname: '外校的许同学', credit: 92, same: false }
]

// 卡片场景。note 写给测试者看：这条应该出现，还是应该被筛掉
const SEED_CARDS = [
  { _id: 'seed_card_full', owner: 'seed_u_full', type: 'study', tagMode: 'all',
    title: '考研自习搭子｜图书馆三楼',
    description: '每天下午两点到六点，互为监督，中途不玩手机。',
    note: '应出现，且贴合度 100%（与你的标签全重合）' },
  { _id: 'seed_card_most', owner: 'seed_u_part', type: 'study', tagMode: 'most',
    title: '早起背单词｜六点半操场',
    description: '想找同样早起的，一起背完再吃早饭。',
    note: '应出现，贴合度中等偏高（大部分重合）' },
  { _id: 'seed_card_one', owner: 'seed_u_part', type: 'study', tagMode: 'one',
    title: '周末刷题搭子',
    description: '周六日找个自习室刷题，互相讲不会的题。',
    note: '应出现，贴合度低（只有 1 个标签重合）' },
  { _id: 'seed_card_none', owner: 'seed_u_full', type: 'study', tagMode: 'none',
    title: '随便找个一起上自习的',
    description: '没有特别要求，安静就行。',
    note: '应出现，贴合度 0%（用它验证 0% 的卡片也会列出来）' },
  { _id: 'seed_card_outschool', owner: 'seed_u_other', type: 'study', tagMode: 'all',
    title: '外校同专业交流',
    description: '不同学校但同专业，可以线上交流。',
    note: '应出现，但不带「同校」标记；用来验证同校优先排序' },
  { _id: 'seed_card_othertype', owner: 'seed_u_full', type: 'fitness', tagMode: 'all',
    title: '夜跑搭子｜操场十圈',
    description: '每天晚上九点跑，配速随意。',
    note: '★ 筛选「学习」时应被筛掉；把类型放宽才会出现（验证类型过滤）' },
  { _id: 'seed_card_lowcredit', owner: 'seed_u_low', type: 'study', tagMode: 'all',
    title: '找人一起自习',
    description: '这条的发布者信誉分只有 40。',
    note: '★ 应被筛掉（验证信誉 >= 60 过滤）' },
  { _id: 'seed_card_matched', owner: 'seed_u_full', type: 'study', tagMode: 'all',
    title: '已找到搭子的卡片',
    description: '这张卡状态是 matched。',
    status: 'matched',
    note: '★ 应被筛掉（验证 status=open 过滤）' },
  { _id: 'seed_card_deleted', owner: 'seed_u_full', type: 'study', tagMode: 'all',
    title: '已删除的卡片',
    description: '这张卡带 deleted_at。',
    note: '★ 应被筛掉（验证软删除过滤）', deleted: true }
]

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function ok(data, msg) {
  return { code: 0, msg: msg || 'ok', data: data }
}

function fail(code, msg) {
  return { code: code, msg: msg }
}

// 按模式从「我的标签」里取子集：全给 / 给大部分 / 只给一个 / 一个不给
function tagsFor(mode, myTagIds) {
  if (mode === 'all') return myTagIds.slice()
  if (mode === 'most') return myTagIds.slice(0, Math.ceil((myTagIds.length * 2) / 3))
  if (mode === 'one') return myTagIds.slice(0, 1)
  return []
}

async function removeSeed() {
  const cardIds = SEED_CARDS.map((c) => c._id)
  const userIds = SEED_USERS.map((u) => u._id)
  await db.collection(DB_CARD_TAGS).where({ card_id: dbCmd.in(cardIds) }).remove()
  await db.collection(DB_CARDS).where({ _id: dbCmd.in(cardIds) }).remove()
  await db.collection(DB_USERS).where({ _id: dbCmd.in(userIds) }).remove()
}

exports.main = async (event) => {
  try {
    if (!ALLOW) return fail(403, 'card-seed 已关闭')

    const ev = event || {}
    // ★ 不强制要 token。
    //   原因：HBuilderX 的「上传并运行」默认不带任何参数，
    //   若这里硬要 token，用户点一次只会得到「未登录」，一张卡都灌不进去。
    //   这是本项目其它 seed 函数（tag-seed / fit-seed / school-seed）的一贯做法。
    //   有 token 就用 token 反查身份（最省事），没有就靠参数传进来。
    const token = str(ev.token)
    let me = null
    if (token) {
      const meRes = await db.collection(DB_USERS).where({ token: token }).limit(1).get()
      if (meRes.data.length) me = meRes.data[0]
    }
    // ★ 没有 token 时，退一步找「最近登录过的非 seed 用户」当作你。
    //   为什么：大厅默认按「同校」筛（scope='school'），虚拟卡片若挂在一个
    //   假的学校下，你在大厅里一张都看不到 —— 那这批卡片就白灌了。
    //   本 App 实际只有你一个真实账号，取最近登录的那个即可拿到真实学校。
    if (!me) {
      const recent = await db.collection(DB_USERS)
        .where({ tokenExpire: dbCmd.gt(Date.now() - 30 * 24 * 3600 * 1000) })
        .orderBy('tokenExpire', 'desc')
        .limit(5)
        .get()
      const list = (recent.data || []).filter(function (u) { return !u.seed })
      if (list.length) me = list[0]
    }
    // 再退一步：不限条件，取任意一个非 seed 用户（新库/无 tokenExpire 场景）
    if (!me) {
      const any = await db.collection(DB_USERS).limit(20).get()
      const list = (any.data || []).filter(function (u) { return !u.seed })
      if (list.length) me = list[0]
    }

    const reset = ev.reset === true || ev.reset === '1'
    if (reset) await removeSeed()

    // —— 1. 标签（匹配的分母）。来源优先级：参数 → token 用户的 user_tags → 标签字典兜底 ——
    let myTagIds = Array.isArray(ev.tag_ids)
      ? ev.tag_ids.filter((x) => typeof x === 'string' && x)
      : []
    let tagSource = myTagIds.length ? 'args' : ''
    if (!myTagIds.length && me) {
      const utRes = await db.collection(DB_USER_TAGS).where({ user_id: me._id }).get()
      myTagIds = (utRes.data || []).map((r) => r.tag_id).filter(Boolean)
      if (myTagIds.length) tagSource = 'token-user'
    }
    const usedFallback = !myTagIds.length

    // 没选标签就借用标签字典的前几个，让匹配测试仍能跑起来
    // （但这时贴合度的分母不是你自己的标签，只适合验证流程，不能验证百分比）
    const tagRes = await db.collection(DB_TAGS).limit(30).get()
    const allTagIds = (tagRes.data || []).map((t) => t._id).filter(Boolean)
    if (usedFallback) {
      myTagIds = allTagIds.slice(0, 6)
      tagSource = 'dictionary-fallback'
    }

    if (!myTagIds.length) {
      return fail(400, '标签字典里没有标签。请先部署并运行 tag-seed')
    }

    // —— 2. 学校：同校优先这条规则要靠它。参数优先，其次 token 用户 ——
    const mySchool = str(ev.school_id) || (me ? str(me.school_id) : '')

    // —— 3. 建虚拟用户（只插缺失的）——
    const userIds = SEED_USERS.map((u) => u._id)
    const existUserRes = await db.collection(DB_USERS).where({ _id: dbCmd.in(userIds) }).field({ _id: true }).get()
    const existUser = {}
    ;(existUserRes.data || []).forEach((d) => { existUser[d._id] = true })

    let usersInserted = 0
    for (const u of SEED_USERS) {
      if (existUser[u._id]) continue
      await db.collection(DB_USERS).add({
        _id: u._id,
        nickname: u.nickname,
        avatar: '',
        // 同校的跟测试者同校，外校的给一个不存在的学校 id
        school: u.same ? ((me && me.school) || '同校测试') : '外校测试',
        school_id: u.same ? (mySchool || '__seed_same_school__') : OTHER_SCHOOL,
        schoolVerified: true,
        is_verified: true,
        credit: u.credit,
        status: 'normal',
        // 这些账号不用于登录，只作为卡片发布者
        seed: true,
        created_at: Date.now()
      })
      usersInserted++
    }

    // —— 4. 建卡片 ——
    const cardIds = SEED_CARDS.map((c) => c._id)
    const existCardRes = await db.collection(DB_CARDS).where({ _id: dbCmd.in(cardIds) }).field({ _id: true }).get()
    const existCard = {}
    ;(existCardRes.data || []).forEach((d) => { existCard[d._id] = true })

    const now = Date.now()
    let cardsInserted = 0
    let tagsInserted = 0
    const summary = []

    for (let i = 0; i < SEED_CARDS.length; i++) {
      const c = SEED_CARDS[i]
      const owner = SEED_USERS.find((u) => u._id === c.owner)
      // 没传 school_id 时用占位串：同校那批统一挂在占位学校下，
      // 这样「同校优先」这条排序规则依然能被观察到，只是不等于你真实的学校。
      const sameSchoolId = mySchool || '__seed_same_school__'
      const schoolId = owner && owner.same ? sameSchoolId : OTHER_SCHOOL

      if (!existCard[c._id]) {
        await db.collection(DB_CARDS).add({
          _id: c._id,
          owner_id: c.owner,
          type: c.type,
          title: c.title,
          description: c.description || '',
          school_id: schoolId,
          city_code: '',
          location_name: '',
          start_time: 0,
          end_time: 0,
          expected_people: 1,
          // ★ 用卡片自己声明的状态：默认 open，matched 那张要写成 matched,
          //   否则它就不构成「已匹配」场景，筛选规则无从验证。
          status: c.status || 'open',
          deleted_at: c.deleted ? now : null,
          seed: true,
          // 时间错开，方便验证 created_at 降序
          created_at: now - i * 1000,
          updated_at: now - i * 1000
        })
        cardsInserted++
      }

      // 卡片的标签：先清掉这张卡的旧标签再写，保证重复运行后数据一致
      await db.collection(DB_CARD_TAGS).where({ card_id: c._id }).remove()
      const tagIds = tagsFor(c.tagMode, myTagIds)
      for (let k = 0; k < tagIds.length; k++) {
        await db.collection(DB_CARD_TAGS).add({ card_id: c._id, tag_id: tagIds[k] })
        tagsInserted++
      }

      summary.push({
        card_id: c._id,
        title: c.title,
        status: c.status || 'open',
        tags: tagIds.length,
        note: c.note
      })
    }

    return ok({
      users: { inserted: usersInserted, total: SEED_USERS.length },
      cards: { inserted: cardsInserted, total: SEED_CARDS.length },
      card_tags: { inserted: tagsInserted },
      tag_source: tagSource,
      my_tags_used: myTagIds.length,
      used_fallback_tags: usedFallback,
      school_matched: !!mySchool,
      // 灌进去了但可能验不准，给一句明确提示
      hint: usedFallback || !mySchool
        ? '已灌好，但没拿到你的标签或学校，所以「贴合度百分比」和「同校」两项验不准。下次运行时把 school_id 和 tag_ids 传上即可。'
        : '已按你的标签与学校灌好，「同校优先」和百分比都能验。',
      summary: summary
    }, reset ? '已清空重灌' : '灌数据完成（重复运行安全）')
  } catch (e) {
    return fail(500, '灌数据失败：' + (e.message || '未知错误'))
  }
}
