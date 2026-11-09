'use strict'

/**
 * 用户主页 —— 点对方头像进来看到的那一页
 *
 * 为什么需要这个页面：
 *   一对人只对应一个聊天室（合成一张卡），消息列表里只占一行。
 *   但他们之间可能有**多段搭子关系**（考研搭子 + 夜跑搭子），
 *   这些额外的关系在消息列表里是看不见的 —— 只能在这一页汇总展示。
 *   这也仿微信/QQ/抖音：点进对方名片，能看到你们之间所有往来。
 *
 * 入参：{ token 可选, user_id }
 * 出参：{ code, msg, data: { user, relations, apply_state, common } }
 *
 *   user         对方公开资料（白名单，不外泄手机号/密码/token）
 *   relations    我和他之间的全部 active 关系，每条带双方标签
 *   apply_state  我和他之间能不能再建一段新关系
 *   common       我们共同的标签，用来解释"为什么推荐你俩"
 *
 *   ★ 另有两个**顶层**字段（故意不塞进 apply_state，扁平好取）：
 *     is_friend            布尔，我和对方是不是好友（语义与位置都不动）
 *     friend_request_state "friend" | "out_pending" | "in_pending" | "none"
 *     my_remark            我给对方起的备注，没有就是 ''
 *     ★ relation_state     'friend' | 'unfriended' | 'none' —— is_friend 是二态，
 *       分不出「从来不是好友」和「当过好友又解除」，这一项补第三态。
 *       判定优先级：friendships 有行 → friend；否则 friend_unlinks 有行 →
 *       unfriended；否则 none。查 friend_unlinks 失败（表还没建）一律降级 none。
 *     看自己的主页时三者恒为 false / 'none' / ''。
 *
 *   ★ 黑名单两个**顶层**字段（契约 §4.4）：
 *     is_blocked  我拉黑了他
 *     blocked_me  他拉黑了我
 *     查不到 user_blocks（表还没建）时都当 false。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_RELATIONS = 'buddy_relations'
const DB_CONVERSATIONS = 'conversations'
const DB_INVITES = 'buddy_invites'
const DB_CARDS = 'cards'
const DB_APPLICATIONS = 'applications'
const DB_USER_TAGS = 'user_tags'
const DB_TAGS = 'tags'
const DB_FRIENDS = 'friendships'
const DB_UNLINKS = 'friend_unlinks'
const DB_REQUESTS = 'friend_requests'
const DB_REMARKS = 'user_remarks'
const DB_BLOCKS = 'user_blocks'
const DB_TITLES = 'titles'

// ★ 公开资料白名单。加字段记得加在这里，
//   同时要同步 user-login / user-me / card-detail / card-list 的返回。
//   （踩过坑：手写白名单必漏字段，见 05 文档踩坑记录第 8 条）
const PUBLIC_FIELDS = {
  _id: true,
  nickname: true,
  avatar: true,
  avatar_url: true,
  school: true,
  school_name: true,
  school_id: true,
  bio: true,
  grade: true,
  user_no: true,
  schoolVerified: true,
  is_verified: true,
  verify_status: true,
  credit: true,
  credit_score: true,
  // ★ 契约 §3.3：白名单漏字段是本项目踩过的坑（05 文档踩坑记录第 8 条），
  //   漏了这个，下面的 current_title 永远解析成 null。
  current_title_id: true,
  titles: true,
  createTime: true
}

// 一对人多类型下再邀请，最多个类型数
const CATEGORY_LABEL = {
  study: '学习',
  fitness: '健身',
  photo: '拍照',
  meal: '吃饭',
  sport: '运动',
  other: '其他'
}

// 称号名解析的内置兜底（契约 §3.3）：titles 表查不到时用它，两边都没有才给 null。
// 与 title-list 里那份内容相同 —— 云函数目录自包含，只能各存一份。
// 与 title-list 的 DEFAULT_TITLES 同源：titles 表里没有这条时靠它把 code 翻成名字。
// ★ 加称号时三处一起改：title-list（定义+条件）、title-equip、user-profile（名字兜底）。
const TITLE_NAMES = {
  profile_complete: '资料完整',
  verify_pass: '学生已认证',
  first_buddy: '第一次搭成',
  tag_3: '标签新手',
  tag_8: 'コレクター',
  tag_10: 'DECATHLON',
  card_1: '首发选手',
  card_5: '大厅常客',
  card_10: 'HEADLINER',
  friend_1: 'はじまり',
  friend_5: 'SQUAD',
  post_1: '第一次冒泡',
  post_10: 'CHATTERBOX',
  credit_110: '信誉良好',
  credit_130: 'GOLD STANDARD',
  buddy_3: '搭子收割机',
  buddy_10: 'LEGEND'
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function pickInt(v, dft) {
  return typeof v === 'number' ? v : dft
}

async function getUserByToken(token) {
  if (!token) return null
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  return r.data.length ? r.data[0] : null
}

/**
 * 按 code 解析佩戴中的称号：titles 表 → 内置 3 条 → null（契约 §3.3）。
 * 查表失败（表还没建）只当查不到，绝不让整页主页报错。
 */
async function resolveCurrentTitle(code) {
  const c = str(code)
  if (!c) return null
  try {
    const r = await db.collection(DB_TITLES).where({ code: c }).limit(1).get()
    const row = (r.data && r.data[0]) || null
    if (row && row.active !== false) {
      const name = str(row.name)
      if (name) return { code: c, name: name }
    }
  } catch (e) {
    /* titles 表还没建：落到内置 */
  }
  const name = TITLE_NAMES[c]
  return name ? { code: c, name: name } : null
}

/** 别人的信誉分只给区间，不给精确值，避免"信誉分歧视" */
function creditBand(c) {
  if (c >= 95) return '极好'
  if (c >= 85) return '很好'
  if (c >= 70) return '良好'
  if (c >= 60) return '一般'
  return '较低'
}

/**
 * 单个 fileID 换临时链接（头像用）。
 * 换失败返回原值：头像裂了只是少张图，不值得让整个主页报错。
 */
async function toTempUrl(fileId) {
  const id = str(fileId)
  if (id.indexOf('cloud://') !== 0) return id
  try {
    const res = await uniCloud.getTempFileURL({ fileList: [id] })
    const it = (res && res.fileList && res.fileList[0]) || {}
    return it.tempFileURL || id
  } catch (e) {
    console.warn('[user-profile] 头像换链失败', e && e.message)
    return id
  }
}

exports.main = async (event) => {
  try {
    const targetId = str(event.user_id)
    if (!targetId) fail('缺少 user_id', 400)

    // token 可选：没登录也能看主页，只是不能操作
    const me = await getUserByToken(str(event.token))

    const uRes = await db
      .collection(DB_USERS)
      .doc(targetId)
      .field(PUBLIC_FIELDS)
      .get()

    if (!uRes.data || !uRes.data.length) fail('这个人不存在或已注销', 404)
    const u = uRes.data[0]

    const credit = pickInt(u.credit_score, pickInt(u.credit, 80))
    const verified = !!(u.is_verified || u.schoolVerified || u.verify_status === 'approved')

    // 库里存 fileID，<image> 只认 http 链接，这里换一次
    const avatarUrl = await toTempUrl(str(u.avatar_url) || str(u.avatar))

    const user = {
      user_id: u._id,
      nickname: str(u.nickname) || '同学',
      avatar: avatarUrl,
      school: str(u.school_name) || str(u.school),
      school_id: str(u.school_id),
      bio: str(u.bio),
      grade: str(u.grade),
      verified: verified,
      credit: credit,
      credit_label: creditBand(credit),
      titles: Array.isArray(u.titles) ? u.titles : [],
      joined_at: u.createTime || 0
    }

    // 佩戴中的称号（契约 §3.3）：只新增这一项，其余出参结构零改动。
    // 看自己 / 看别人都是同一套逻辑 —— 读的都是被查看者的 current_title_id。
    const currentTitle = await resolveCurrentTitle(u.current_title_id)

    // ============ 我和他之间的关系 ============
    const isMe = !!me && me._id === targetId
    let relations = []
    let conversationId = ''
    let applyState = { can_invite: false, reason: '', pending_invite_id: '' }

    // 三个新增顶层字段的默认值：没登录 / 看自己主页 / 查询失败都落到这里。
    // 前端拿到的一定是"确定的值"，不用再判 undefined。
    let isFriend = false
    // 三态：'friend' | 'unfriended' | 'none'。默认 none，查询失败也落这里
    let relationState = 'none'
    let friendRequestState = 'none'
    let myRemark = ''
    // 黑名单两个方向的默认值：没登录 / 看自己主页 / 查询失败都落到 false
    let isBlocked = false
    let blockedMe = false

    if (me && !isMe) {
      const ua = me._id < targetId ? me._id : targetId
      const ub = me._id < targetId ? targetId : me._id

      const relRes = await db
        .collection(DB_RELATIONS)
        .where({ user_a_id: ua, user_b_id: ub, status: 'active' })
        .orderBy('created_at', 'asc')
        .limit(50)
        .get()

      // 会话：一对人只有一个，按 user_pair_key 查
      const pairKey = ua + '|' + ub
      const convRes = await db
        .collection(DB_CONVERSATIONS)
        .where({ user_pair_key: pairKey, type: 'direct' })
        .limit(1)
        .get()
      if (convRes.data.length) {
        conversationId = convRes.data[0]._id
      } else {
        // 老会话没有 user_pair_key。退回按成员表反查，避免老用户这一页显示"还没聊天"
        try {
          const mine = await db
            .collection('conversation_members')
            .where({ user_id: me._id })
            .field({ conversation_id: true })
            .limit(200)
            .get()
          const ids = mine.data.map((m) => m.conversation_id)
          if (ids.length) {
            const theirs = await db
              .collection('conversation_members')
              .where({ user_id: targetId, conversation_id: dbCmd.in(ids) })
              .limit(1)
              .get()
            if (theirs.data.length) conversationId = theirs.data[0].conversation_id
          }
        } catch (e) {
          /* 兜不住就留空，不影响主页其他内容 */
        }
      }

      relations = relRes.data.map((r) => {
        const iAmA = r.user_a_id === me._id
        return {
          relation_id: r._id,
          category: str(r.category) || 'other',
          category_label: CATEGORY_LABEL[str(r.category) || 'other'] || '其他',
          // 我给他起的
          //
          // ★ 搭子标签是**私有备注**：我起的只我能看见，对方起的只对方能看见。
          //   所以这里**只返回我这一侧**，对方的 label 一律不下发 ——
          //   哪怕对方给你起了个名字，你也看不到，反之亦然。
          //   这与「用户备注」是两回事，别混到一个字段里。
          my_label: str(iAmA ? r.label_a : r.label_b),
          my_label_color: str(iAmA ? r.label_a_color : r.label_b_color),
          since: r.created_at || 0
        }
      })

      // ============ 好友状态 / 备注 ============
      // ★ 三段各自 try/catch：friendships / friend_requests / user_remarks
      //   对新代码是既有表，但 user_remarks 是这次新建的集合 ——
      //   表还没建（第一次写入才自动创建）时查询会报错，
      //   绝不能因为一个备注把整页主页打挂。降级成默认值即可。
      try {
        const fRes = await db
          .collection(DB_FRIENDS)
          .where({ user_a_id: ua, user_b_id: ub })
          .limit(1)
          .get()
        if (fRes.data.length) {
          isFriend = true
          relationState = 'friend'
          friendRequestState = 'friend'
        }
      } catch (e) {
        /* 表不存在 / 查询失败：当作不是好友，主页其余内容照常 */
      }

      // ★ 不是好友时才查 friend_unlinks：确认是「当过好友又解除」（三态的第三态）。
      //   friendships 行被删掉之后就只剩这张表有痕迹，is_friend:false 说明不了什么。
      // ★ 独立 try/catch：friend_unlinks 是这次新建的集合，表还没建时查询会报错，
      //   降级为 'none'（当作从来不是好友），主页其余内容照常。
      if (!isFriend) {
        try {
          const uRes = await db
            .collection(DB_UNLINKS)
            .where({ user_a_id: ua, user_b_id: ub })
            .limit(1)
            .get()
          if (uRes.data.length) relationState = 'unfriended'
        } catch (e) {
          /* friend_unlinks 表不存在 / 查询失败：降级 none */
        }
      }

      // ★ 已经是好友 → 把搭子关系从这页清空（设计规则：好友关系比搭子更强，
      //   成为好友时搭子应当被收起来，见 docs/03-database.md §2.3）。
      //   friend-request 的 accept 分支会在「成为好友」那一刻把 active 搭子改成 ended，
      //   但有两种顺序它会漏掉：
      //     ① 先成为好友，之后才冒出搭子关系（老版本允许好友之间点邀请，正是这个顺序）；
      //     ② 搭子关系是在好友建立之后被别的路径写进来的。
      //   数据层由 buddy-invite 的 repair 兜底清理，但那是要手动跑的运维动作；
      //   这一页必须**立刻正确**，所以这里做展示层拦截 —— 不管库里还有没有脏关系，
      //   好友之间这一页都不显示搭子。清的是返回值，不改数据库。
      if (isFriend) {
        relations = []
      }

      // 已经是好友就不用再查申请了；不是好友才需要分辨"谁在等谁"
      if (!isFriend) {
        try {
          const outRes = await db
            .collection(DB_REQUESTS)
            .where({ from_user_id: me._id, to_user_id: targetId, status: 'pending' })
            .limit(1)
            .get()
          if (outRes.data.length) {
            friendRequestState = 'out_pending'
          } else {
            const inRes = await db
              .collection(DB_REQUESTS)
              .where({ from_user_id: targetId, to_user_id: me._id, status: 'pending' })
              .limit(1)
              .get()
            if (inRes.data.length) friendRequestState = 'in_pending'
          }
        } catch (e) {
          /* 同上：降级成 none，不影响主页 */
        }
      }

      try {
        const rRes = await db
          .collection(DB_REMARKS)
          .where({ owner_id: me._id, target_user_id: targetId })
          .limit(1)
          .get()
        if (rRes.data.length) myRemark = str(rRes.data[0].remark)
      } catch (e) {
        /* user_remarks 是新集合，表还没建时留空串 */
      }

      // ============ 黑名单（单向，两个方向都要看）============
      // ★ 整段 try/catch：user_blocks 是新集合，第一次写入才自动创建，
      //   表还没建时查询会报错 —— 都当 false，主页其余内容照常显示。
      try {
        const blkMe = await db
          .collection(DB_BLOCKS)
          .where({ owner_id: me._id, target_id: targetId })
          .limit(1)
          .get()
        if (blkMe.data.length) isBlocked = true

        const blkHim = await db
          .collection(DB_BLOCKS)
          .where({ owner_id: targetId, target_id: me._id })
          .limit(1)
          .get()
        if (blkHim.data.length) blockedMe = true
      } catch (e) {
        /* 表不存在 / 查询失败：两个方向都当没拉黑 */
      }

      // ============ 还能不能再建一段 ============
      const myCredit = pickInt(me.credit_score, pickInt(me.credit, 80))
      const hisCredit = credit

      const pendingInv = await db
        .collection(DB_INVITES)
        .where({
          from_user_id: me._id,
          to_user_id: targetId,
          status: 'pending'
        })
        .limit(1)
        .get()

      // ★ 判定顺序（契约 §4.4-4）：is_self → is_blocked → blocked_me
      //   → isFriend → 信誉 → pendingInv → can_invite = true。
      //   黑名单排在最前：拉黑了就不该再出现任何「邀请」入口，
      //   否则用户点了按钮才被 buddy-invite 挡回来。
      //
      // ★ 好友优先判：已经是好友了就不该再邀请搭子。
      //   好友关系比搭子更强，允许再挂一条只会在两个页面重复显示同一个人；
      //   buddy-invite 的 invite 分支也有同样的拦截，两处都要有 ——
      //   前端按钮听这个 can_invite，云函数还得能挡住直接构造的请求。
      if (isBlocked) {
        applyState.reason = '你已把对方加入黑名单'
      } else if (blockedMe) {
        applyState.reason = '对方不接收你的邀请'
      } else if (isFriend) {
        applyState.reason = '你们已经是好友了，不用再邀请搭子'
      } else if (myCredit < 60) {
        applyState.reason = '你的信誉分低于 60，暂时不能邀请搭子'
      } else if (hisCredit < 60) {
        applyState.reason = '对方信誉分过低，暂不支持邀请'
      } else if (pendingInv.data.length) {
        applyState.pending_invite_id = pendingInv.data[0]._id
        applyState.reason = '你已经发过邀请，等他回应'
      } else {
        applyState.can_invite = true
        applyState.reason = ''
      }

      // ★ 只收"我这一侧已经起过名"的类型。
      //   原来是把所有关系的 category 都塞进来（relations.map(r => r.category)），
      //   于是分类被迁移默认成 'other' 的老关系会让「其他」永远显示"已有"；
      //   而且我还没起名的那侧也算"已用"，语义不对。
      //
      // ★★ 这里原来写的是 r.user_a_id / r.label_a —— 那是**数据库原始字段**。
      //     但 relations 是上面第 179 行 map 出来的投影，字段已经变成
      //     my_label（我给他起的）/ his_label（他给我起的），根本没有 user_a_id。
      //     ★ 注：his_label 已按产品规则从投影里删除（标签是私有备注，不下发对方那一侧），
      //       此处注释保留是为了说明当时的字段来源，别再照着 his_label 写代码。
      //     于是 `r.user_a_id === me._id` 恒为 false，读 r.label_b 恒为 undefined，
      //     filter 永远返回空 → existing_categories 永远是 [] →
      //     「发起新搭子」时已经建过的类型不会被标成"已有"，同一类型能被反复邀请，
      //     冒出多条重复关系，标签又只写进了一侧。
      //     现在直接判断投影后的 my_label 即可。
      // ★★ 判重必须看「关系是否存在」，不能看「我有没有起名」。
      //   原来的 filter 是 !!r.my_label —— 等于「没起名 = 没建过这层关系」，
      //   于是同一个类型可以被反复邀请，每邀请一次就多一条 buddy_relations，
      //   与「同一对人在同一类型下只能有一条」的约定直接冲突。
      //   用户反馈的「多标签问题」正是这条造成的：
      //   第一段关系（卡片配对）双方都没起名 → 不算已用 → B 又能发同类型邀请 →
      //   accept 时 ensureRelation 按 (ua,ub,category) 找到了旧那条并复用，
      //   把新标签写进同一条关系里，看起来就像「旧关系不见了、只剩新标签」。
      //   现在只要关系存在就计入已用类型，与后端判重键完全对齐。
      applyState.existing_categories = relations.map(function (r) {
        return str(r.category) || 'other'
      })
      applyState.is_self = false
    } else if (isMe) {
      applyState.reason = '这是你自己的主页'
      applyState.is_self = true
    } else {
      applyState.reason = '登录后才能邀请搭子'
      applyState.is_self = false
    }

    // ============ 共同标签 ============
    let common = { count: 0, tags: [] }
    if (me && !isMe) {
      try {
        const mineRes = await db
          .collection(DB_USER_TAGS)
          .where({ user_id: me._id })
          .field({ tag_id: true })
          .limit(50)
          .get()
        const hisRes = await db
          .collection(DB_USER_TAGS)
          .where({ user_id: targetId })
          .field({ tag_id: true })
          .limit(50)
          .get()

        const mineSet = {}
        for (const t of mineRes.data) mineSet[t.tag_id] = true
        const hitIds = []
        for (const t of hisRes.data) {
          if (mineSet[t.tag_id]) hitIds.push(t.tag_id)
        }

        if (hitIds.length) {
          const tagRes = await db
            .collection(DB_TAGS)
            .where({ _id: dbCmd.in(hitIds) })
            .field({ _id: true, name: true, category: true })
            .limit(50)
            .get()
          common = {
            count: hitIds.length,
            tags: tagRes.data.map((t) => ({
              tag_id: t._id,
              name: str(t.name),
              category: str(t.category)
            }))
          }
        }
      } catch (e) {
        /* 共同标签算不出来不影响主页 */
      }
    }

    // ============ 他最近发的卡片 ============
    // 只给还在招募中的，避免别人点进来看一堆过期卡片
    let cards = []
    try {
      const cRes = await db
        .collection(DB_CARDS)
        .where({ owner_id: targetId, status: 'open' })
        .orderBy('created_at', 'desc')
        .limit(5)
        .get()
      cards = cRes.data.map((c) => ({
        card_id: c._id,
        title: str(c.title),
        type: str(c.type),
        type_label: CATEGORY_LABEL[str(c.type) || 'other'] || '其他',
        created_at: c.created_at || 0
      }))
    } catch (e) {
      /* 卡片列表失败不影响主页 */
    }

    return {
      code: 0,
      msg: 'ok',
      data: {
        user: user,
        relations: relations,
        relation_count: relations.length,
        conversation_id: conversationId,
        apply_state: applyState,
        common: common,
        cards: cards,
        // ★ 三个**顶层**字段：故意不塞进 apply_state。
        //   apply_state 是"能不能再建一段搭子关系"的开关集合，
        //   而好友状态是整页的标题区要用的，扁平放更好取。
        //   ★ my_remark 与 relations[].my_label 是两回事，别混：
        //     my_label 是"这段搭子关系叫什么"，my_remark 是"这个人叫什么"。
        is_friend: isFriend,
        friend_request_state: friendRequestState,
        my_remark: myRemark,
        // ★ 黑名单两个方向（契约 §4.4-1）。看自己主页 / 没登录恒为 false
        is_blocked: isBlocked,
        blocked_me: blockedMe,
        // ★ 契约 §3.3 唯一新增的顶层字段，追加在最后，既有字段顺序不动
        current_title: currentTitle,
        // ★ 三态好友关系，同样追加在最后：既有字段名/顺序/语义零改动
        relation_state: relationState
      }
    }
  } catch (e) {
    return {
      code: e.bizCode || 500,
      msg: e.message || '服务异常'
    }
  }
}
