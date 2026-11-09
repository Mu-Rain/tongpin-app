'use strict'

/**
 * admin-users —— M4 用户列表 / 封禁 / 解封（仅管理员可用，契约 §2.2）
 *
 * 入参：{ token, action: 'list' | 'ban' | 'unban', keyword?, school?, verify_status?,
 *         credit_band?, page?, page_size?, user_id? }
 * 出参 list：  { code:0, data: { list: [...], total, page } }
 * 出参 ban/unban：{ code:0, data: { user_id, status: 'banned' | 'normal' } }
 *
 * ★ 白名单是这个函数最重要的东西：uni-id-users 里有 phone / password / token。
 *   列表只要 _id、昵称、用户号、头像、学校、认证、信誉分、状态、注册时间，
 *   多带一个字段就是把整批账号的手机号泄给一个前端页面。
 *   所以出参不是「过滤掉敏感字段」，而是「从白名单正向拼装」——
 *   表里以后加了什么新字段都不会自动漏出去。
 *
 * ★ 为什么管理员判定要在查用户列表之前：
 *   契约 §1：非管理员一律 403，且必须在读任何业务数据之前判定。
 *   先查后判会让越权请求从 total 里读出全站用户规模。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

// 信誉段：契约 §2.2（low <60 / mid 60-79 / high ≥80），三选一
const CREDIT_BANDS = ['low', 'mid', 'high']
const VERIFY_FILTERS = ['verified', 'unverified']

/**
 * 转义正则元字符。
 * 用户输入的 "(  " 或 ".*" 直接拼进 RegExp 会语法报错或变成通配符，
 * 前者让整个接口 500，后者能让一个空关键字匹配到全库。
 * 与 message-search/index.js:63-65 逐字相同 —— 契约 §2.2 要求的正是这个写法，
 * 两处必须一致，别各自演化。
 */
function escapeReg(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

// 契约 §2 铁律 4：拿不到当前用户返 500（不是 403）——
// 登录态坏了和「你不是管理员」是两件事，混在一起排查会走错方向。
async function getUserByToken(token) {
  if (!token) fail('未登录，请重新登录', 500)
  let r = null
  try {
    r = await db
      .collection(DB_USERS)
      .where({ token: token })
      .field({ _id: true, nickname: true, is_admin: true, role: true })
      .limit(1)
      .get()
  } catch (e) {
    fail('登录状态读取失败，请稍后重试', 500)
  }
  if (!r.data || !r.data.length) fail('登录已过期，请重新登录', 500)
  return r.data[0]
}

/** 与 verify-review:250 / report-review:190 同一口径，只认这两个字段任一为真 */
function isAdminUser(u) {
  const d = u || {}
  return d.is_admin === true || d.role === 'admin'
}

/**
 * 信誉分双字段兼容：注册写 credit(=100)，信用核心写 credit_score。
 * 读的时候两套都认（与 credit-list:60 的 readScore 同一语义）。
 */
function readScore(u) {
  const d = u || {}
  return typeof d.credit_score === 'number' ? d.credit_score : typeof d.credit === 'number' ? d.credit : 80
}

/** 学校三字段任一写入即算（历史数据里 school / school_name / school_id 都有人写，见 title-list:183） */
function readSchool(u) {
  const d = u || {}
  return str(d.school_name) || str(d.school) || str(d.school_id)
}

/** 认证三字段任一为真即已认证（与 title-list:196 同口径） */
function readVerified(u) {
  const d = u || {}
  return d.is_verified === true || d.verify_status === 'approved' || d.schoolVerified === true
}

/**
 * 封禁判定：新口径写 status: 'banned'（string，card-publish:65 / match-cards:157 认这个），
 * 老注册数据写 status: 0（number，user-login:74 认这个）。两种都要认，
 * 否则老账号被封后后台还显示「正常」，管理员会重复点封禁。
 */
function readBanned(u) {
  const d = u || {}
  return d.status === 'banned' || d.status === 0
}

/**
 * 信誉段 → 查询条件。
 * ★ 两个字段都要覆盖：注册写 credit、信用核心写 credit_score，
 *   只按其中一个筛会把另一半老账号整批漏掉。
 * ★ 每个条件是「单字段一元比较」：uniCloud 也支持把 and 组合挂在单个字段上
 *   （{ credit_score: and([gte(60), lt(80)]) }），但那种写法串在 or 里可读性差、
 *   也不便逐个分支核对。这里改成「先按字段 or、再按上下界 and」的外层组合，
 *   语义等价而每一层都能单独读通。
 */
function bandCond(band) {
  const fieldOr = function (cmd) {
    // 一条文档里 credit 与 credit_score 只会有一个（注册写前者、信用核心写后者），
    // 所以两条 or 分支不会把同一个人算进两个段；万一两个都写了，值也必然相等。
    return dbCmd.or([{ credit_score: cmd }, { credit: cmd }])
  }
  if (band === 'low') return fieldOr(dbCmd.lt(60))
  if (band === 'high') return fieldOr(dbCmd.gte(80))
  // mid = 60-79：下界与上界分别 or 一次再 and，等价于 60 <= x < 80
  return dbCmd.and([fieldOr(dbCmd.gte(60)), fieldOr(dbCmd.lt(80))])
}

/**
 * 后台列表的头像换临时链接：库里存 cloud:// fileID，<image> 只认 http 链接。
 * 一页一次批量换；失败保留原值，后台不至于因为头像裂了渲染不出来。
 */
async function resolveAvatars(list) {
  const ids = []
  for (let i = 0; i < list.length; i++) {
    const u = list[i].avatar
    if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
  }
  if (!ids.length) return
  try {
    const res = await uniCloud.getTempFileURL({ fileList: ids })
    const fl = (res && res.fileList) || []
    const map = {}
    for (let i = 0; i < fl.length; i++) {
      if (fl[i] && fl[i].tempFileURL) map[fl[i].fileID] = fl[i].tempFileURL
    }
    for (let i = 0; i < list.length; i++) {
      if (map[list[i].avatar]) list[i].avatar = map[list[i].avatar]
    }
  } catch (e) {
    console.warn('[admin-users] 头像换链失败', e && e.message)
  }
}

exports.main = async (event) => {
  try {
    event = event || {}
    // ★ 顺序铁律：认人 → 判管理员 → 才碰业务表（契约 §1）
    const me = await getUserByToken(str(event.token))
    if (!isAdminUser(me)) fail('没有权限：用户管理仅管理员可用', 403)

    const action = str(event.action) || 'list'

    // ============ 列表 ============
    if (action === 'list') {
      const page = Math.max(1, parseInt(event.page, 10) || 1)
      const pageSize = Math.min(MAX_LIMIT, Math.max(1, parseInt(event.page_size, 10) || DEFAULT_LIMIT))

      // 多个条件是「且」，or 子条件必须包进 and 里：
      // 直接 .where(or(...)) 再串 .where(...) 会把 or 覆盖掉（fit-exercise:91 同一写法）。
      const conds = []

      const keyword = str(event.keyword)
      if (keyword) {
        const reg = new RegExp(escapeReg(keyword), 'i')
        // 昵称和 UID 都走转义后的正则：管理员常只记得 UID 的一部分。
        // ★ 不转义的话输入 ".*" 会变成通配符，一次把全表拉出来。
        // ★ 不再搜 user_no：那是早期遗留字段，真实注册链路从来没写过。
        conds.push(dbCmd.or([{ nickname: reg }, { uid: reg }]))
      }

      const school = str(event.school)
      if (school) {
        // 学校三个字段都可能是真相，只按其中一个筛会漏掉一半历史数据
        const sReg = new RegExp(escapeReg(school), 'i')
        conds.push(dbCmd.or([{ school: sReg }, { school_name: sReg }, { school_id: sReg }]))
      }

      const verifyStatus = str(event.verify_status)
      if (verifyStatus) {
        if (VERIFY_FILTERS.indexOf(verifyStatus) < 0) fail('不支持的认证状态：' + verifyStatus, 400)
        if (verifyStatus === 'verified') {
          conds.push(dbCmd.or([{ is_verified: true }, { verify_status: 'approved' }, { schoolVerified: true }]))
        } else {
          // neq 会把「字段不存在」也算进来 —— 老账号确实没这些字段，
          // 而他们就是未认证的那批人，正是要查的对象。
          conds.push(
            dbCmd.and([
              { is_verified: dbCmd.neq(true) },
              { verify_status: dbCmd.neq('approved') },
              { schoolVerified: dbCmd.neq(true) }
            ])
          )
        }
      }

      const creditBand = str(event.credit_band)
      if (creditBand) {
        if (CREDIT_BANDS.indexOf(creditBand) < 0) fail('不支持的信誉段：' + creditBand, 400)
        conds.push(bandCond(creditBand))
      }

      const where = conds.length ? dbCmd.and(conds) : {}

      let rows = []
      let total = 0
      try {
        const col = db.collection(DB_USERS)
        const countRes = await col.where(where).count()
        total = countRes.total || 0
        const listRes = await col
          .where(where)
          // ★ 正向白名单：只要这几个字段，phone / password / token 根本没被读到。
          //   多带 credit / school_name / createTime 是为了做双字段兼容读，出参里不会原样下发。
          .field({
            _id: true,
            nickname: true,
            uid: true,
            user_no: true,
            avatar: true,
            avatar_url: true,
            school: true,
            school_name: true,
            school_id: true,
            is_verified: true,
            verify_status: true,
            schoolVerified: true,
            credit: true,
            credit_score: true,
            status: true,
            ban_at: true,
            createTime: true,
            created_at: true
          })
          .orderBy('createTime', 'desc') // 新注册的排前面：后台先看新账号
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get()
        rows = listRes.data || []
      } catch (e) {
        // 表读不到按空列表返回（契约 §2 铁律 4）：后台空态比整页报错有用
        console.warn('[admin-users] 用户列表查询失败，按空态返回：', e && e.message)
        rows = []
        total = 0
      }

      const list = rows.map(function (u) {
        const banned = readBanned(u)
        return {
          user_id: u._id,
          nickname: str(u.nickname) || '同学',
          // UID 是对外唯一身份号；user_no 只是历史遗留，一起带着不主动展示
          uid: str(u.uid),
          user_no: str(u.user_no),
          avatar: str(u.avatar_url) || str(u.avatar),
          school: readSchool(u),
          is_verified: readVerified(u),
          credit_score: readScore(u),
          status: banned ? 'banned' : 'normal',
          ban_at: typeof u.ban_at === 'number' ? u.ban_at : 0,
          // 注册写 createTime、新数据写 created_at，出参统一成契约里的 created_at
          created_at: typeof u.createTime === 'number' ? u.createTime : typeof u.created_at === 'number' ? u.created_at : 0
        }
      })

      await resolveAvatars(list)

      return { code: 0, msg: 'ok', data: { list: list, total: total, page: page } }
    }

    // ============ 封禁 / 解封 ============
    if (action === 'ban' || action === 'unban') {
      const userId = str(event.user_id)
      if (!userId) fail('缺少 user_id', 400)

      // 不许封自己：封了自己就再也进不了后台，只能手改数据库救回来（契约 §2.2）
      if (action === 'ban' && userId === me._id) fail('不能封禁自己', 400)

      let target = null
      try {
        const res = await db
          .collection(DB_USERS)
          .doc(userId)
          .field({ _id: true, nickname: true, is_admin: true, role: true })
          .get()
        target = (res.data && res.data[0]) || null
      } catch (e) {
        target = null
      }
      if (!target) fail('这位用户不存在', 404)

      // 不许封另一个管理员：管理员之间的封禁等于一次无声的权限夺权，
      // 只能由人去数据库里改（契约 §2.2）。
      if (action === 'ban' && isAdminUser(target)) fail('不能封禁另一位管理员', 403)

      const now = Date.now()
      // ★ 这里只写契约 §2.2 规定的字符串口径 status = 'banned' / 'normal'。
      //   遗留问题（不在本函数能修的范围内，见交付报告）：user-login:74 判的是
      //   status === 0（数字），而 card-publish:65 / match-cards:157 判的是
      //   status === 'banned'（字符串）—— 两处口径不一致，只写字符串时发布和匹配
      //   已经拦住，登录拦不住。正确修法是把 user-login 那一行改成
      //   `user.status === 0 || user.status === 'banned'`，那属于另一个云函数目录，
      //   本任务边界内不许碰。不要在这里改用数字 0 去迁就登录，
      //   那会让发布 / 匹配两个已验收的拦截同时失效。
      const patch =
        action === 'ban'
          ? { status: 'banned', ban_at: now, updateTime: now }
          : { status: 'normal', ban_at: 0, updateTime: now }

      // ★ 必须验证「真的改到了行」：doc().update() 在记录不存在时可能静默成功，
      //   前端会显示封禁成功但账号完全没被改 —— 这是最难排查的一类假成功。
      let upOk = true
      let upRes = null
      try {
        upRes = await db.collection(DB_USERS).doc(userId).update(patch)
        const changed = pickInt(upRes && (upRes.updated || upRes.affectedDocs), -1)
        if (changed === 0) upOk = false
      } catch (e) {
        upOk = false
      }
      if (!upOk) {
        return {
          code: 500,
          msg: (action === 'ban' ? '封禁' : '解封') + '失败：没有改到任何记录（用户可能已不存在）'
        }
      }

      return {
        code: 0,
        msg: 'ok',
        data: { user_id: userId, status: action === 'ban' ? 'banned' : 'normal' }
      }
    }

    fail('不支持的操作：' + action)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '处理失败' }
  }
}
