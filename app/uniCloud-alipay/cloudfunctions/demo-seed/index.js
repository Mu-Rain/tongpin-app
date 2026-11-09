'use strict'

/**
 * demo-seed —— 答辩演示数据一次性灌入（幂等，可反复跑）
 *
 * 这个函数造什么（演示动线：找搭子 → 聊天 → 信誉加分 → 称号墙）：
 *   1) 3 个能真正登录的账号：13800000001 / 13800000002 / 13800000003，密码统一 Aa123456
 *   2) 5 张搭子卡片（账号 2、3 各 2 张，账号 1 一张），正文都长过首页「展开」阈值
 *   3) 账号 1 与账号 2 之间一条 status='active' 的搭子关系，完成过一次用 done_count 表达
 *   4) 两人一个 direct 会话 + 7 条双方交替的真人语气消息
 *   5) 账号 1 的 8 条信誉流水（7 加分 + 1 扣分），末条 score_after 与 users.credit_score 对齐
 *   6) 账号 1 的 2 个已获得称号（first_buddy 佩戴中、verify_pass）
 *   另外：titles 表为空时，连 3 条称号定义一起灌；schools 表有数据时借用其学校，让「同校」筛选真的能筛到。
 *
 * 怎么跑：HBuilderX 里右键本函数 → 上传并运行，参数留空即可。
 * 怎么复位：参数填 { "reset": true }，先删本函数自己造的行再重灌。
 * 怎么判重（幂等口径）：
 *   users 按 phone；其余集合一律按固定 _id。
 *   已存在的行只原地刷新关键字段（见每处 mutables 列表），字段没变才算 skipped，
 *   所以连跑两次第二次 inserted 恒为 0。
 *
 * 为什么全部给固定 _id / 打 seed 标记而不是靠模糊条件删：
 *   reset 只能删自己造的东西。固定 _id 与 seed: 'demo-seed' 标记让删除目标可枚举，
 *   别人真实注册的账号、真实发布的卡片（没有这个标记）一条都不会被带走。
 */

const crypto = require('crypto')

const DB_USERS = 'uni-id-users'
const DB_CARDS = 'cards'
const DB_CARD_TAGS = 'card_tags'
const DB_TAGS = 'tags'
const DB_SCHOOLS = 'schools'
const DB_RELATIONS = 'buddy_relations'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'
const DB_CREDIT_EVENTS = 'credit_events'
const DB_TITLES = 'titles'
const DB_USER_TITLES = 'user_titles'

// 安全开关：正式环境默认关闭（见 exports.main 处的说明）
const ALLOW = false

// 本函数造的所有行都带这个标记，reset 靠它定位（不是靠整表删）
const SEED_TAG = 'demo-seed'
const DEMO_PASSWORD = 'Aa123456'

// ===================== 口令（与 user-register / user-login 逐字同口径） =====================
// 口径：salt:hex(scrypt(password, salt, 32))，salt = 16 字节随机 hex。
// 这里必须抄一份而不能 require 邻居目录 —— 云函数上传只打包自己那个目录。
function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, useSalt, 32).toString('hex')
  return useSalt + ':' + hash
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || stored.indexOf(':') === -1) return false
  const salt = stored.split(':')[0]
  const expect = hashPassword(password, salt)
  if (expect.length !== stored.length) return false
  return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(stored))
}

// ===================== 数据清单 =====================
const USERS = [
  { phone: '13800000001', nickname: '林小满', credit: 92, uid: '10000001', userNo: 'SN0001', equipped: 'first_buddy', avatar: '/static/avatars/av-study.png' },
  { phone: '13800000002', nickname: '周叙', credit: 88, uid: '10000002', userNo: 'SN0002', equipped: '', avatar: '/static/avatars/av-fitness.png' },
  { phone: '13800000003', nickname: '陈默', credit: 76, uid: '10000003', userNo: 'SN0003', equipped: '', avatar: '/static/avatars/av-sport.png' }
]

// 正文长度刻意都超过 pages/index/index.vue:147 的 ENC_FOLD_LEN = 72，
// 否则大厅/首页卡片上的「展开全文」点了没变化，演示时像坏了。
const CARDS = [
  {
    id: 'demo_card_01',
    ownerIndex: 1,
    type: 'study',
    title: '考研自习搭子｜图书馆三楼靠窗',
    description:
      '图书馆三楼靠窗那排，下午两点到六点，手机放包里静音，中途只在整点起来接水。想找个能互相盯住的人：谁先摸鱼谁请奶茶，晚上一起对一遍当天的进度。考研和期末都适用，人少的时候可以小声讨论。',
    location: '图书馆三楼靠窗',
    startInHours: 20,
    expected: 1
  },
  {
    id: 'demo_card_02',
    ownerIndex: 1,
    type: 'fitness',
    title: '夜跑搭子｜东操场十圈',
    description:
      '东操场晚上九点半，配速六分半，十圈收工，风雨无阻。想找个人一起跑，主要是互相提醒别躺平；跑完顺路去小卖部买水，边拉伸边聊两句。刚开始跑也没关系，慢点等我。',
    location: '东操场',
    startInHours: 32,
    expected: 1
  },
  {
    id: 'demo_card_03',
    ownerIndex: 2,
    type: 'meal',
    title: '食堂约饭｜一餐厅二楼',
    description:
      '一餐厅二楼，工作日中午十一点四十，人多的时候一个人先占座。想找个饭搭子边吃边吐槽，吃完在校园里走十分钟消食。口味不挑，麻辣香锅、砂锅、拌面都能接受，AA 不纠结。',
    location: '一餐厅二楼',
    startInHours: 26,
    expected: 2
  },
  {
    id: 'demo_card_04',
    ownerIndex: 2,
    type: 'study',
    title: '六级听力精听搭档',
    description:
      '六级听力精听，用真题一段一段抠：先裸听两遍再对答案，最后把生词抄到本子上。每周二、四晚上七点到八点半，图书馆四楼小组讨论区，两个人分摊每天的准备量，谁空了谁先发材料。',
    location: '图书馆四楼讨论区',
    startInHours: 44,
    expected: 1
  },
  {
    id: 'demo_card_05',
    ownerIndex: 0,
    type: 'sport',
    title: '羽毛球搭子｜体育馆周三晚',
    description:
      '体育馆周三晚上七点到九点，羽毛球双打算一组，缺一个能跑动的。水平大概在会发球会推后场的程度，不追求赢，主要想把坐了一周的身体活动开。球拍自己带，球我买，打完顺路吃夜宵。',
    location: '体育馆三号场',
    startInHours: 50,
    expected: 1
  }
]

// 七条消息，两人交替；说话内容按「自习搭子」这条真实动线写，不用「消息1」这种占位词
const MESSAGES = [
  { id: 'demo_msg_01', fromIndex: 1, content: '你好呀，看到你发的图书馆自习那条了，我最近也在准备考研，能一起吗？' },
  { id: 'demo_msg_02', fromIndex: 0, content: '可以啊，我基本每天下午都在三楼靠窗那排，你一般几点到？' },
  { id: 'demo_msg_03', fromIndex: 1, content: '我两点半左右能到，上午有课。中间要不要定个休息的点？我坐太久会犯困。' },
  { id: 'demo_msg_04', fromIndex: 0, content: '那就整点起来走两分钟，我一般三点和四点各歇一次，顺便把水杯灌满。' },
  { id: 'demo_msg_05', fromIndex: 1, content: '行，我从明天开始。要不约定个暗号：桌上水杯朝外就表示我先到了？' },
  { id: 'demo_msg_06', fromIndex: 0, content: '哈哈这个可以，我明天两点二十就到，先把靠窗那个位置占住。' },
  { id: 'demo_msg_07', fromIndex: 1, content: '好，明天见！你要是先到，帮我看一下隔壁有没有人一直讲话。' }
]

// 8 条流水，从 80 分起算，末条正好落在账号 1 的 credit_score = 92。
// reason_code 只用契约内置的 5 个 code（credit-list:33-39 / buddy-complete:39-45），
// 不自己编 —— credit_rules 表为空时内置表就是唯一真相。
const CREDIT_EVENTS = [
  { id: 'demo_ce_01', code: 'verify_pass', delta: 5, text: '通过学生认证', score: 85 },
  { id: 'demo_ce_02', code: 'buddy_done', delta: 2, text: '完成一次搭子', score: 87 },
  { id: 'demo_ce_03', code: 'buddy_done', delta: 2, text: '完成一次搭子', score: 89 },
  { id: 'demo_ce_04', code: 'no_show', delta: -5, text: '放鸽子', score: 84 },
  { id: 'demo_ce_05', code: 'buddy_done', delta: 2, text: '完成一次搭子', score: 86 },
  { id: 'demo_ce_06', code: 'buddy_done', delta: 2, text: '完成一次搭子', score: 88 },
  { id: 'demo_ce_07', code: 'buddy_done', delta: 2, text: '完成一次搭子', score: 90 },
  { id: 'demo_ce_08', code: 'buddy_done', delta: 2, text: '完成一次搭子', score: 92 }
]

// 内置三条称号定义（title-list:30-58 逐字同源）。只在 titles 表为空时兜底灌入
const DEFAULT_TITLES = [
  {
    code: 'profile_complete',
    name: '资料完整',
    rarity: 'common',
    condition_type: 'profile',
    condition_text: '填了昵称、头像、学校，并选了至少 1 个标签',
    sort: 10
  },
  {
    code: 'verify_pass',
    name: '学生已认证',
    rarity: 'common',
    condition_type: 'verify',
    condition_text: '通过一次学生认证',
    sort: 20
  },
  {
    code: 'first_buddy',
    name: '第一次搭成',
    rarity: 'common',
    condition_type: 'buddy',
    condition_text: '和同学完整搭成一次（双方都确认）',
    sort: 30
  }
]

// 账号 1 挂两个称号：first_buddy 佩戴中（资料卡上能看见），verify_pass 已获得未佩戴
const USER_TITLES = [
  { id: 'demo_ut_01_first_buddy', code: 'first_buddy', equipped: true, daysAgo: 3 },
  { id: 'demo_ut_02_verify_pass', code: 'verify_pass', equipped: false, daysAgo: 6 }
]

// ===================== 工具 =====================
function same(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

exports.main = async (event) => {
  event = event || {}
  // 安全：一次性灌数据工具，正式环境默认关闭。
  // 这个函数会造出密码已知（Aa123456）的演示账号，公开部署等于给陌生人开门；
  // 只在本地/演示前改成 true 跑一次，跑完立刻改回 false 并重新部署。
  if (!ALLOW) return { code: 403, msg: 'demo-seed 已关闭（ALLOW=false）' }
  const db = uniCloud.database()
  const dbCmd = db.command

  const stat = { inserted: 0, updated: 0, skipped: 0, failed: 0 }
  const byColl = {}

  function bump(coll, key) {
    stat[key] = stat[key] + 1
    if (!byColl[coll]) byColl[coll] = { inserted: 0, updated: 0, skipped: 0, failed: 0 }
    byColl[coll][key] = byColl[coll][key] + 1
  }

  function warn(msg) {
    console.warn('[demo-seed] ' + msg)
  }

  async function findOne(coll, where) {
    try {
      const res = await db.collection(coll).where(where).limit(1).get()
      return (res.data && res.data[0]) || null
    } catch (e) {
      // 集合还没建时查询会抛，按「不存在」处理，交给后面的 add 建表
      return null
    }
  }

  /**
   * 按固定 _id 判重的通用写入：
   *   不存在 → 插入（带上 seed 标记，reset 才找得到）
   *   存在   → 只比较 mutables 里那几个字段，真的变了才 update
   */
  async function ensureById(coll, id, doc, mutables) {
    const exist = await findOne(coll, { _id: id })
    if (!exist) {
      try {
        const row = Object.assign({}, doc, { _id: id, seed: SEED_TAG })
        await db.collection(coll).add(row)
        bump(coll, 'inserted')
        return { _id: id, action: 'inserted' }
      } catch (e) {
        warn(coll + ' 插入失败 ' + id + '：' + ((e && e.message) || e))
        bump(coll, 'failed')
        return null
      }
    }
    const patch = {}
    mutables.forEach(function (k) {
      if (!same(exist[k], doc[k])) patch[k] = doc[k]
    })
    if (!Object.keys(patch).length) {
      bump(coll, 'skipped')
      return { _id: exist._id, action: 'skipped' }
    }
    try {
      await db.collection(coll).doc(exist._id).update(patch)
      bump(coll, 'updated')
      return { _id: exist._id, action: 'updated' }
    } catch (e) {
      warn(coll + ' 刷新失败 ' + id + '：' + ((e && e.message) || e))
      bump(coll, 'failed')
      return null
    }
  }

  try {
    const now = Date.now()

    // ============ 0. 复位：只删本函数自己造的行 ============
    if (event.reset === true) {
      const ownCollections = [
        DB_CARDS,
        DB_CARD_TAGS,
        DB_RELATIONS,
        DB_CONVERSATIONS,
        DB_MEMBERS,
        DB_MESSAGES,
        DB_CREDIT_EVENTS,
        DB_TITLES,
        DB_USER_TITLES
      ]
      for (let i = 0; i < ownCollections.length; i++) {
        try {
          await db.collection(ownCollections[i]).where({ seed: SEED_TAG }).remove()
        } catch (e) {
          // 表还没建时删不掉，不是错误
          warn('复位跳过 ' + ownCollections[i] + '（表可能还没建）：' + ((e && e.message) || e))
        }
      }
      try {
        const phones = USERS.map(function (u) {
          return u.phone
        })
        await db.collection(DB_USERS).where({ phone: dbCmd.in(phones), seed: SEED_TAG }).remove()
      } catch (e) {
        warn('复位跳过账号：' + ((e && e.message) || e))
      }
    }

    // ============ 1. 学校：借用 schools 里的真实学校，同校频道才筛得到 ============
    // 大厅默认 scope='school'（card-list:95-103），卡片和看卡的人 school_id 必须一致
    let schoolId = 'pku'
    let schoolName = '北京大学'
    let schoolCity = '110000'
    try {
      let row = (await db.collection(DB_SCHOOLS).where({ _id: 'pku' }).limit(1).get()).data[0]
      if (!row) {
        row = (await db.collection(DB_SCHOOLS).where({ active: true }).limit(1).get()).data[0]
      }
      if (row) {
        schoolId = row._id
        schoolName = str(row.name) || schoolName
        schoolCity = str(row.city_code) || schoolCity
      }
    } catch (e) {
      // schools 表还没建：用固定值。三个账号用同一个 school_id，同校筛选依然成立
    }

    // ============ 2. 三个账号 ============
    const userIds = []
    for (let i = 0; i < USERS.length; i++) {
      const u = USERS[i]
      const doc = {
        phone: u.phone,
        password: hashPassword(DEMO_PASSWORD),
        nickname: u.nickname,
        avatar: '',
        // 演示账号用自带头像，答辩时列表里不是一片灰
        avatar_url: u.avatar,
        school: schoolName,
        school_name: schoolName,
        school_id: schoolId,
        city_code: schoolCity,
        schoolVerified: true,
        is_verified: true,
        credit: u.credit,
        credit_score: u.credit,
        titles: [],
        tags: [],
        // 演示账号给固定 UID，答辩时可以直接报号搜人（10000001 ~ 10000003）
        uid: u.uid,
        user_no: u.userNo,
        current_title_id: u.equipped,
        // 账号状态写契约 §2.2 的字符串口径（admin-users:278-289 封禁写 'banned'、解封写 'normal'）。
        // user-login:76 与 match-cards:157 只拦 0 / 'banned'，所以 'normal' 能登录也能发布。
        status: 'normal',
        ban_at: 0,
        role: 'user',
        token: '',
        tokenExpire: 0,
        createTime: now,
        updateTime: now,
        lastLoginTime: 0
      }
      // status / role 故意不在刷新列表里：管理员封过或提过权的账号，演示脚本不该一键改回去
      const mutables = [
        'nickname',
        'avatar',
        'avatar_url',
        'school',
        'school_name',
        'school_id',
        'city_code',
        'schoolVerified',
        'is_verified',
        'credit',
        'credit_score',
        'uid',
        'user_no',
        'current_title_id'
      ]
      const exist = await findOne(DB_USERS, { phone: u.phone })
      if (!exist) {
        try {
          const res = await db.collection(DB_USERS).add(Object.assign({}, doc, { seed: SEED_TAG }))
          userIds.push(res.id)
          bump(DB_USERS, 'inserted')
        } catch (e) {
          warn('账号插入失败 ' + u.phone + '：' + ((e && e.message) || e))
          bump(DB_USERS, 'failed')
          userIds.push('')
        }
        continue
      }
      const patch = {}
      mutables.forEach(function (k) {
        if (!same(exist[k], doc[k])) patch[k] = doc[k]
      })
      // 口令单独处理：哈希带随机盐，每次算出来都不同，不能进字段比对。
      // 只有「存的口令验不过 Aa123456」时才重写 —— 否则每跑一次都会白写一次。
      if (!verifyPassword(DEMO_PASSWORD, exist.password)) {
        patch.password = doc.password
      }
      if (!Object.keys(patch).length) {
        bump(DB_USERS, 'skipped')
      } else {
        try {
          await db.collection(DB_USERS).doc(exist._id).update(patch)
          bump(DB_USERS, 'updated')
        } catch (e) {
          warn('账号刷新失败 ' + u.phone + '：' + ((e && e.message) || e))
          bump(DB_USERS, 'failed')
        }
      }
      userIds.push(exist._id)
    }

    const idOf = function (index) {
      return userIds[index] || ''
    }

    // ============ 3. 卡片 + 卡片标签 ============
    // 标签是匹配的分母（match-cards），但 tags 表可能是空的：有就挂，没有就只灌卡片。
    // 只用 active: true 的标签 —— card-publish:94 校验的就是这个条件。
    let tagPool = []
    try {
      const tRes = await db.collection(DB_TAGS).where({ active: true }).limit(6).get()
      tagPool = (tRes.data || []).map(function (t) {
        return t._id
      })
    } catch (e) {
      tagPool = []
    }

    for (let i = 0; i < CARDS.length; i++) {
      const c = CARDS[i]
      const ownerId = idOf(c.ownerIndex)
      if (!ownerId) {
        warn('卡片 ' + c.id + ' 跳过：发布者账号没落库')
        bump(DB_CARDS, 'failed')
        continue
      }
      const startAt = now + c.startInHours * 3600 * 1000
      const doc = {
        owner_id: ownerId,
        type: c.type,
        title: c.title,
        description: c.description,
        school_id: schoolId,
        city_code: schoolCity,
        location_name: c.location,
        start_time: startAt,
        end_time: startAt + 2 * 3600 * 1000,
        expected_people: c.expected,
        status: 'open',
        created_at: now - (CARDS.length - i) * 60000,
        updated_at: now - (CARDS.length - i) * 60000
      }
      // 时间类字段不进刷新列表：它们随运行时刻漂移，每次重算会造成「永远在更新」
      const mutables = [
        'owner_id',
        'type',
        'title',
        'description',
        'school_id',
        'city_code',
        'location_name',
        'expected_people',
        'status'
      ]
      await ensureById(DB_CARDS, c.id, doc, mutables)

      // 每张卡挂两个标签（够算重合度，又不至于让列表全是标签）
      const picked = tagPool.slice(i % Math.max(1, tagPool.length), (i % Math.max(1, tagPool.length)) + 2)
      for (let k = 0; k < picked.length; k++) {
        const ctId = 'demo_ct_' + c.id.slice(-2) + '_' + k
        await ensureById(DB_CARD_TAGS, ctId, { card_id: c.id, tag_id: picked[k] }, ['card_id', 'tag_id'])
      }
    }

    // ============ 4. 搭子关系（账号 1 ↔ 账号 2） ============
    // 约定 user_a_id < user_b_id（card-apply:218-222），否则同一对会出现两条镜像。
    // 完成过一次用 done_count 计数表达，status 保持 active（buddy-complete:10-13）。
    const u1 = idOf(0)
    const u2 = idOf(1)
    const u3 = idOf(2)
    const pairA = u1 < u2 ? u1 : u2
    const pairB = u1 < u2 ? u2 : u1
    const relationId = 'demo_rel_1_2'
    const convId = 'demo_conv_1_2'
    const doneAt = now - 26 * 3600 * 1000

    await ensureById(
      DB_RELATIONS,
      relationId,
      {
        user_a_id: pairA,
        user_b_id: pairB,
        category: 'study',
        source_type: 'card',
        source_card_id: 'demo_card_01',
        source_invite_id: '',
        label_a: '',
        label_b: '',
        label_a_color: '',
        label_b_color: '',
        conversation_id: convId,
        status: 'active',
        ended_by: '',
        ended_at: 0,
        done_a: false,
        done_b: false,
        done_count: 1,
        last_done_at: doneAt,
        created_at: doneAt
      },
      [
        'user_a_id',
        'user_b_id',
        'category',
        'source_type',
        'source_card_id',
        'conversation_id',
        'status',
        'done_count'
      ]
    )

    // ============ 5. 会话 + 成员 + 消息 ============
    // user_pair_key = 两个 id 排序后拼接（card-apply:263），会话认人不认关系
    const pairKey = pairA + '|' + pairB
    const lastMsg = MESSAGES[MESSAGES.length - 1]
    const lastMsgAt = now - 4 * 60 * 1000

    await ensureById(
      DB_CONVERSATIONS,
      convId,
      {
        type: 'direct',
        user_pair_key: pairKey,
        user_a_id: pairA,
        user_b_id: pairB,
        buddy_relation_id: '',
        last_message_id: lastMsg.id,
        last_message_text: lastMsg.content,
        last_message_sender_id: idOf(lastMsg.fromIndex),
        last_message_at: lastMsgAt,
        created_at: doneAt,
        updated_at: lastMsgAt
      },
      [
        'type',
        'user_pair_key',
        'user_a_id',
        'user_b_id',
        'last_message_id',
        'last_message_text',
        'last_message_sender_id'
      ]
    )

    for (let i = 0; i < MESSAGES.length; i++) {
      const m = MESSAGES[i]
      const senderId = idOf(m.fromIndex)
      if (!senderId) {
        warn('消息 ' + m.id + ' 跳过：发送者没落库')
        bump(DB_MESSAGES, 'failed')
        continue
      }
      await ensureById(
        DB_MESSAGES,
        m.id,
        {
          conversation_id: convId,
          sender_id: senderId,
          type: 'text',
          content: m.content,
          client_msg_id: m.id,
          created_at: lastMsgAt - (MESSAGES.length - 1 - i) * 4 * 60 * 1000
        },
        ['conversation_id', 'sender_id', 'type', 'content']
      )
    }

    // 成员行：unread_count 归零、last_read 指到最后一条，演示进来就是「都读过了」
    await ensureById(
      DB_MEMBERS,
      'demo_cm_1_2_a',
      {
        conversation_id: convId,
        user_id: pairA,
        unread_count: 0,
        last_read_message_id: lastMsg.id
      },
      ['conversation_id', 'user_id', 'unread_count', 'last_read_message_id']
    )
    await ensureById(
      DB_MEMBERS,
      'demo_cm_1_2_b',
      {
        conversation_id: convId,
        user_id: pairB,
        unread_count: 0,
        last_read_message_id: lastMsg.id
      },
      ['conversation_id', 'user_id', 'unread_count', 'last_read_message_id']
    )

    // ============ 6. 账号 1 的信誉流水 ============
    for (let i = 0; i < CREDIT_EVENTS.length; i++) {
      const ev = CREDIT_EVENTS[i]
      if (!u1) break
      await ensureById(
        DB_CREDIT_EVENTS,
        ev.id,
        {
          user_id: u1,
          delta: ev.delta,
          reason_code: ev.code,
          // 文案快照：后台以后改文案不影响历史记录（credit-list:153）
          reason_text: ev.text,
          score_after: ev.score,
          ref_id: ev.code === 'buddy_done' ? relationId : '',
          created_at: now - (CREDIT_EVENTS.length - i) * 6 * 3600 * 1000
        },
        ['user_id', 'delta', 'reason_code', 'reason_text', 'score_after', 'ref_id']
      )
    }

    // ============ 7. 称号定义（表为空才灌）+ 账号 1 的已获得称号 ============
    let titleCount = 0
    try {
      const tRes = await db.collection(DB_TITLES).limit(1).get()
      titleCount = (tRes.data || []).length
    } catch (e) {
      titleCount = 0
    }
    let titlesSeeded = false
    if (titleCount === 0) {
      titlesSeeded = true
      for (let i = 0; i < DEFAULT_TITLES.length; i++) {
        const d = DEFAULT_TITLES[i]
        await ensureById(
          DB_TITLES,
          d.code,
          {
            code: d.code,
            name: d.name,
            desc: '',
            rarity: d.rarity,
            condition_type: d.condition_type,
            condition_text: d.condition_text,
            sort: d.sort,
            active: true,
            created_at: now
          },
          ['code', 'name', 'desc', 'rarity', 'condition_type', 'condition_text', 'sort', 'active']
        )
      }
    }

    // 铁律：user_titles.title_id 存的是 titles.code 字符串，不是 titles._id（title-list:14-15）
    for (let i = 0; i < USER_TITLES.length; i++) {
      const ut = USER_TITLES[i]
      if (!u1) break
      // 只给账号 1 挂：user_titles 是「已获得」的档案，不是定义表，title_id 按 code 存
      await ensureById(
        DB_USER_TITLES,
        ut.id,
        {
          user_id: u1,
          title_id: ut.code,
          obtained_at: now - ut.daysAgo * 24 * 3600 * 1000,
          is_equipped: ut.equipped
        },
        ['user_id', 'title_id', 'is_equipped']
      )
    }

    return {
      code: 0,
      msg: 'ok',
      data: {
        inserted: stat.inserted,
        updated: stat.updated,
        skipped: stat.skipped,
        failed: stat.failed,
        reset: event.reset === true,
        titles_seeded: titlesSeeded,
        school: { school_id: schoolId, name: schoolName, city_code: schoolCity },
        tags_used: tagPool.length,
        ids: {
          users: { user_1: u1, user_2: u2, user_3: u3 },
          cards: CARDS.map(function (c) {
            return c.id
          }),
          relation_id: relationId,
          conversation_id: convId,
          messages: MESSAGES.map(function (m) {
            return m.id
          }),
          credit_events: CREDIT_EVENTS.map(function (e) {
            return e.id
          }),
          user_titles: USER_TITLES.map(function (t) {
            return t.id
          })
        },
        by_collection: byColl
      }
    }
  } catch (e) {
    // 绝不 throw：云函数抛出去前端只能拿到一句笼统的 e，这里把已完成的统计带回去
    warn('整体异常：' + ((e && e.stack) || e))
    return {
      code: 500,
      msg: '灌数据中断：' + ((e && e.message) || '未知错误'),
      data: {
        inserted: stat.inserted,
        updated: stat.updated,
        skipped: stat.skipped,
        failed: stat.failed,
        by_collection: byColl
      }
    }
  }
}
