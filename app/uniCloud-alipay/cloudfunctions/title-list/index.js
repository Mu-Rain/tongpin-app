'use strict'

/**
 * 称号墙 —— pages/title/title 用（契约 §3.1）
 *
 * 入参：{ token, user_id? }（user_id 不传或等于自己 = 看自己的墙；是别人 = 只读，契约 §4.1）
 * 出参：{ code, msg, data: { list[], equipped|null, newly[], total } }（结构不随身份变化）
 *
 * ★ 顺序不能反：先评估补发、再拼全量墙。反过来时「刚满足条件」那条这一趟
 *   不会带 obtained，用户得再进一次页面才看得到，newly 弹窗也落在错的时机。
 *
 * ★ titles 是数据表，本文件里的三条只是兜底默认值：表不存在 / 该 code 不存在 /
 *   active=false 三种情况一律回落内置（契约 §1）。
 *   user_titles.title_id 存的是 code 而不是 titles._id，所以表可以是空的，
 *   已获得记录也不会因为后台改名字/文案而失效。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_TITLES = 'titles'
const DB_USER_TITLES = 'user_titles'
const DB_USER_TAGS = 'user_tags'
const DB_CREDIT_EVENTS = 'credit_events'
const DB_RELATIONS = 'buddy_relations'
const DB_CARDS = 'cards'
const DB_POSTS = 'posts'
const DB_FRIENDS = 'friendships'

// 内置称号表：titles 集合为空 / 缺某条 / active=false 时都回落这里。
// 每条 = { code, name, condition_type, condition_value, condition_text, rarity, sort }
// ★ code 必须和 app/common/title/skins.js 里的皮肤键一一对应，否则会掉到默认皮肤。
// ★ 名字刻意混了中文 / 英文 / 日文 —— 用户要的是"不同语言"，不是全站一套措辞。
const DEFAULT_TITLES = [
  {
    code: 'profile_complete',
    name: '资料完整',
    desc: '',
    rarity: 'common',
    condition_type: 'profile',
    condition_text: '填了昵称、头像、学校，并选了至少 1 个标签',
    sort: 10
  },
  {
    code: 'verify_pass',
    name: '学生已认证',
    desc: '',
    rarity: 'common',
    condition_type: 'verify',
    condition_text: '通过一次学生认证',
    sort: 20
  },
  {
    code: 'first_buddy',
    name: '第一次搭成',
    desc: '',
    rarity: 'common',
    condition_type: 'buddy',
    condition_text: '和同学完整搭成一次（双方都确认）',
    sort: 30
  },

  // —— 标签 ——
  {
    code: 'tag_3',
    name: '标签新手',
    desc: '',
    rarity: 'common',
    condition_type: 'tags',
    condition_value: 3,
    condition_text: '选满 3 个标签',
    sort: 40
  },
  {
    code: 'tag_8',
    name: 'コレクター',
    desc: '',
    rarity: 'rare',
    condition_type: 'tags',
    condition_value: 8,
    condition_text: '选满 8 个标签（收集癖认证）',
    sort: 90
  },
  {
    code: 'tag_10',
    name: 'DECATHLON',
    desc: '',
    rarity: 'epic',
    condition_type: 'tags',
    condition_value: 10,
    condition_text: '标签选满 10 个（十项全能）',
    sort: 150
  },

  // —— 发布需求 ——
  {
    code: 'card_1',
    name: '首发选手',
    desc: '',
    rarity: 'common',
    condition_type: 'cards',
    condition_value: 1,
    condition_text: '发布过 1 条搭子需求',
    sort: 50
  },
  {
    code: 'card_5',
    name: '大厅常客',
    desc: '',
    rarity: 'rare',
    condition_type: 'cards',
    condition_value: 5,
    condition_text: '累计发布 5 条搭子需求',
    sort: 100
  },
  {
    code: 'card_10',
    name: 'HEADLINER',
    desc: '',
    rarity: 'epic',
    condition_type: 'cards',
    condition_value: 10,
    condition_text: '累计发布 10 条搭子需求（大厅霸屏）',
    sort: 160
  },

  // —— 好友 ——
  {
    code: 'friend_1',
    name: 'はじまり',
    desc: '',
    rarity: 'common',
    condition_type: 'friends',
    condition_value: 1,
    condition_text: '加上第 1 个好友',
    sort: 60
  },
  {
    code: 'friend_5',
    name: 'SQUAD',
    desc: '',
    rarity: 'rare',
    condition_type: 'friends',
    condition_value: 5,
    condition_text: '好友满 5 个人',
    sort: 110
  },

  // —— 动态 ——
  {
    code: 'post_1',
    name: '第一次冒泡',
    desc: '',
    rarity: 'common',
    condition_type: 'posts',
    condition_value: 1,
    condition_text: '在同频圈发过 1 条动态',
    sort: 70
  },
  {
    code: 'post_10',
    name: 'CHATTERBOX',
    desc: '',
    rarity: 'rare',
    condition_type: 'posts',
    condition_value: 10,
    condition_text: '累计发 10 条动态',
    sort: 120
  },

  // —— 信誉 ——
  {
    code: 'credit_110',
    name: '信誉良好',
    desc: '',
    rarity: 'rare',
    condition_type: 'credit',
    condition_value: 110,
    condition_text: '信誉分达到 110',
    sort: 80
  },
  {
    code: 'credit_130',
    name: 'GOLD STANDARD',
    desc: '',
    rarity: 'epic',
    condition_type: 'credit',
    condition_value: 130,
    condition_text: '信誉分达到 130',
    sort: 140
  },

  // —— 搭子 ——
  {
    code: 'buddy_3',
    name: '搭子收割机',
    desc: '',
    rarity: 'rare',
    condition_type: 'buddy_count',
    condition_value: 3,
    condition_text: '完整搭成 3 次',
    sort: 130
  },
  {
    code: 'buddy_10',
    name: 'LEGEND',
    desc: '',
    rarity: 'epic',
    condition_type: 'buddy_count',
    condition_value: 10,
    condition_text: '完整搭成 10 次',
    sort: 170
  }
]

// 能判定的条件类型。表里写了别的类型一律当「不满足」，绝不误发成已获得。
// 布尔类：profile / verify / buddy；计数类：tags / cards / friends / posts / credit / buddy_count
const JUDGEABLE = ['profile', 'verify', 'buddy', 'tags', 'cards', 'friends', 'posts', 'credit', 'buddy_count']

// 计数类条件 → facts 里的字段
const COUNT_FACTS = {
  tags: 'tags',
  cards: 'cards',
  friends: 'friends',
  posts: 'posts',
  credit: 'credit',
  buddy_count: 'buddy_count'
}


function pickInt(v, dft) {
  return typeof v === 'number' ? v : dft
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

// 契约 §5.4：拿不到当前用户必须 500（token 无效不能当成游客放过去，
// 否则下面的判定全用空资料跑，会把「资料完整」判成不满足还回 200）
async function getUserByToken(token) {
  if (!token) fail('未登录，请重新登录', 500)
  let r = null
  try {
    r = await db.collection(DB_USERS).where({ token: token }).limit(1).get()
  } catch (e) {
    fail('登录状态读取失败，请稍后重试', 500)
  }
  if (!r.data || !r.data.length) fail('登录已过期，请重新登录', 500)
  return r.data[0]
}

/**
 * 决定这一趟看谁的墙：默认自己，传了别人的 user_id 就只读地看别人。
 * 为什么对方的 user_id 也要验：不验就返回一张全是「未获得」的空墙，
 * 前端会显示成「TA 一个称号都没拿到」，比直接报错更误导人。
 */
async function resolveViewerId(myId, raw) {
  const target = str(raw)
  if (!target || target === myId) return myId
  let r = null
  try {
    r = await db.collection(DB_USERS).where({ _id: target }).limit(1).get()
  } catch (e) {
    fail('对方资料读取失败，请稍后重试', 404)
  }
  if (!r.data || !r.data.length) fail('找不到这位同学', 404)
  return target
}

/**
 * 取全量称号定义：内置 3 条打底，titles 表里有数据就覆盖 / 追加。
 * 表里 active=false 的内置项回落内置定义（后台误关不会让墙少一条），
 * 非内置项直接不上墙 —— 停用的称号不该出现在称号墙上。
 */
async function loadDefs() {
  const defs = {}
  DEFAULT_TITLES.forEach(function (d) {
    defs[d.code] = {
      code: d.code,
      name: d.name,
      desc: d.desc,
      rarity: d.rarity,
      condition_type: d.condition_type,
      condition_value: typeof d.condition_value === 'number' ? d.condition_value : 0,
      condition_text: d.condition_text,
      sort: d.sort
    }
  })

  let rows = []
  try {
    const res = await db.collection(DB_TITLES).orderBy('sort', 'asc').limit(200).get()
    rows = res.data || []
  } catch (e) {
    // titles 第一次写入前集合不存在，查询会抛。称号表只是覆盖层，
    // 抛出去会让整个称号墙打不开，所以静默回落到内置 3 条。
    rows = []
  }

  rows.forEach(function (row) {
    const code = str(row.code)
    if (!code) return
    const dft = defs[code] || null
    if (row.active === false) return
    defs[code] = {
      code: code,
      name: str(row.name) || (dft ? dft.name : code),
      desc: str(row.desc) || (dft ? dft.desc : ''),
      rarity: str(row.rarity) || (dft ? dft.rarity : 'common'),
      condition_type: str(row.condition_type) || (dft ? dft.condition_type : ''),
      // 阈值也允许后台覆盖：表里没写就沿用内置那条
      condition_value:
        typeof row.condition_value === 'number'
          ? row.condition_value
          : dft && typeof dft.condition_value === 'number'
            ? dft.condition_value
            : 0,
      condition_text: str(row.condition_text) || (dft ? dft.condition_text : ''),
      sort: pickInt(row.sort, dft ? dft.sort : 100)
    }
  })
  return defs
}

/** sort 升序；sort 相同时按 code 排，保证两次调用顺序一致，墙上不会闪来闪去 */
function defList(defs) {
  const arr = Object.keys(defs).map(function (c) {
    return defs[c]
  })
  arr.sort(function (a, b) {
    if (a.sort !== b.sort) return a.sort - b.sort
    if (a.code === b.code) return 0
    return a.code < b.code ? -1 : 1
  })
  return arr
}

/**
 * 一次性把三条判定要读的原始事实算出来。
 * 逐条称号各查一遍会打出重复查询（表里将来加称号时成倍增长），所以按类型缓存。
 * 任何一处读不到都只当「不满足」，绝不往外抛（契约 §3.1「拿不到当不满足」）。
 */
async function loadFacts(user) {
  // 布尔类 + 计数类一起放这儿：计数默认 0，读失败就是 0（等价于"不满足"）
  const facts = {
    profile: false,
    verify: false,
    buddy: false,
    tags: 0,
    cards: 0,
    friends: 0,
    posts: 0,
    credit: 0,
    buddy_count: 0
  }

  // profile：昵称、头像、学校、至少 1 个标签，四项缺一不给
  try {
    const hasName = !!str(user.nickname)
    const hasAvatar = !!str(user.avatar_url) || !!str(user.avatar)
    // 学校三个字段任一个都算（历史数据里 school / school_name / school_id 都有人写）
    const hasSchool = !!str(user.school_name) || !!str(user.school) || !!str(user.school_id)
    let hasTag = false
    // 前四项不齐时标签查询没意义，省一次读
    if (hasName && hasAvatar && hasSchool) {
      const tagRes = await db.collection(DB_USER_TAGS).where({ user_id: user._id }).limit(1).get()
      hasTag = !!(tagRes.data && tagRes.data.length)
    }
    facts.profile = hasName && hasAvatar && hasSchool && hasTag
  } catch (e) {
    facts.profile = false
  }

  // verify：三个字段是历史上不同版本写的，任一为真就算通过
  facts.verify = user.is_verified === true || user.verify_status === 'approved' || user.schoolVerified === true

  // buddy：有 buddy_done 流水，或有完成计数，任一成立就算搭过（并集，不是二选一）。
  // 只认流水会漏两种真搭成过的人：给分时 applyCredit 抛错、done_count 已 +1 但流水没写；
  // 以及流水表被清理过的老用户。所以流水查不到（抛错或空结果）一律继续走计数兜底。
  try {
    const evRes = await db
      .collection(DB_CREDIT_EVENTS)
      .where({ user_id: user._id, reason_code: 'buddy_done' })
      .limit(1)
      .get()
    facts.buddy = !!(evRes.data && evRes.data.length)
  } catch (e) {
    // credit_events 还没建时查询会抛，按「没流水」处理，交给下面的计数兜底
    facts.buddy = false
  }
  if (!facts.buddy) {
    // 两个方向都要查：同一个用户在关系里可能当 A 也可能当 B
    try {
      const aRes = await db
        .collection(DB_RELATIONS)
        .where({ user_a_id: user._id, done_count: dbCmd.gte(1) })
        .limit(1)
        .get()
      if (aRes.data && aRes.data.length) {
        facts.buddy = true
      } else {
        const bRes = await db
          .collection(DB_RELATIONS)
          .where({ user_b_id: user._id, done_count: dbCmd.gte(1) })
          .limit(1)
          .get()
        facts.buddy = !!(bRes.data && bRes.data.length)
      }
    } catch (e2) {
      facts.buddy = false
    }
  }

  // —— 计数类：7 个 count 并发跑 ——
  // 串行 await 的话，每进一次「我的」页要连打 7 次库，切 tab 会明显发顿。
  // 好友与搭子都是两个方向，约定 a<b 但历史数据不一定守规矩，所以两侧都数。
  const [tags, cards, posts, fa, fb, ra, rb] = await Promise.all([
    countOf(DB_USER_TAGS, { user_id: user._id }),
    countOf(DB_CARDS, { owner_id: user._id }),
    countOf(DB_POSTS, { owner_id: user._id }),
    countOf(DB_FRIENDS, { user_a_id: user._id }),
    countOf(DB_FRIENDS, { user_b_id: user._id }),
    countOf(DB_RELATIONS, { user_a_id: user._id, done_count: dbCmd.gte(1) }),
    countOf(DB_RELATIONS, { user_b_id: user._id, done_count: dbCmd.gte(1) })
  ])
  facts.tags = tags
  facts.cards = cards
  facts.posts = posts
  facts.friends = fa + fb
  facts.buddy_count = ra + rb
  // 信誉分：两套字段名都认（credit 是第 1 天写法，credit_score 是 03 文档写法）
  facts.credit = pickInt(user.credit_score, pickInt(user.credit, 80))

  return facts
}

function judge(def, facts) {
  const type = def.condition_type
  if (JUDGEABLE.indexOf(type) < 0) return false
  // 布尔类
  if (type === 'profile' || type === 'verify' || type === 'buddy') {
    return facts[type] === true
  }
  // 计数类：facts 里对应的数字 >= 阈值（没写阈值就按 1 算）
  const key = COUNT_FACTS[type]
  if (!key) return false
  const need = typeof def.condition_value === 'number' && def.condition_value > 0 ? def.condition_value : 1
  return (facts[key] || 0) >= need
}

/**
 * 数一条（collection.where(...).count()）。表还没建 / 查询失败一律 0。
 * 单独包一层是为了让 loadFacts 里六个数各占一行，读起来是"六个数字"而不是六段 try。
 */
async function countOf(collection, where) {
  try {
    const r = await db.collection(collection).where(where).count()
    return r.total || 0
  } catch (e) {
    return 0
  }
}

exports.main = async (event) => {
  try {
    event = event || {}
    const me = await getUserByToken(str(event.token))

    // 契约 §4.1：user_id 不传或等于自己 → 自己的墙（评估 + 补发，行为不变）；
    // 是别人 → 只读，newly 恒 []。补发是写操作，看别人的墙却给别人发称号等于越权改他人数据。
    const viewerId = await resolveViewerId(me._id, event.user_id)
    const isSelf = viewerId === me._id

    const defs = await loadDefs()
    // 看别人时一条判定都不用跑：既不该判、更不许补发，白读四张表没意义
    const facts = isSelf ? await loadFacts(me) : { profile: false, verify: false, buddy: false }

    // ============ 1. 先评估补发（只对自己） ============
    let owned = {}
    // user_titles 读不到（表还没建）时没有任何地方能记「已获得」，
    // 这时连补发都不做：插不进去，newly 也不该假装发了。
    let canRecord = true
    try {
      // 读谁的记录就用谁的 id：只读模式下这是对方的实际已获得
      const res = await db.collection(DB_USER_TITLES).where({ user_id: viewerId }).limit(200).get()
      ;(res.data || []).forEach(function (row) {
        const code = str(row.title_id)
        if (code) owned[code] = row
      })
    } catch (e) {
      canRecord = false
    }

    const newly = []
    // 两道闸：表读不到不写（写了也没人认），看别人的墙一律不写
    if (canRecord && isSelf) {
      const arr = defList(defs)
      for (let i = 0; i < arr.length; i++) {
        const def = arr[i]
        if (!judge(def, facts)) continue
        // 幂等：已有记录直接跳过，不重复插、也不覆盖 obtained_at
        if (owned[def.code]) continue
        const now = Date.now()
        try {
          await db.collection(DB_USER_TITLES).add({
            user_id: me._id,
            title_id: def.code,
            obtained_at: now,
            is_equipped: false
          })
          owned[def.code] = { title_id: def.code, obtained_at: now, is_equipped: false }
          newly.push({ code: def.code, name: def.name })
        } catch (e) {
          // 同一用户并发进页面时，(user_id,title_id) 唯一索引会挡下后到的那次。
          // 挡下说明别人已经发过，这一趟不记 newly，下次进来就能看到。
        }
      }
    }

    // ============ 2. 再拼全量墙 ============
    const list = defList(defs).map(function (def) {
      const row = owned[def.code]
      return {
        code: def.code,
        name: def.name,
        desc: def.desc,
        rarity: def.rarity,
        obtained: !!row,
        is_equipped: !!(row && row.is_equipped === true),
        obtained_at: row ? pickInt(row.obtained_at, 0) : 0,
        condition_text: def.condition_text,
        sort: def.sort
      }
    })

    // ============ 3. 当前佩戴 ============
    let equipped = null
    for (let i = 0; i < list.length; i++) {
      if (list[i].is_equipped) {
        equipped = { code: list[i].code, name: list[i].name }
        break
      }
    }
    if (!equipped) {
      // 称号被后台停用（非内置）后不再进 list，但用户可能还戴着它。
      // 这里如实回一个，否则资料卡戴着、称号墙说没有，两边对不上。
      const codes = Object.keys(owned)
      for (let i = 0; i < codes.length; i++) {
        if (owned[codes[i]].is_equipped === true) {
          equipped = { code: codes[i], name: codes[i] }
          break
        }
      }
    }

    return {
      code: 0,
      msg: 'ok',
      data: {
        list: list,
        equipped: equipped,
        newly: newly,
        total: list.length
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '加载失败' }
  }
}
