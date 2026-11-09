'use strict'
/**
 * verify-review —— 学生认证审核（仅管理员可调）
 *
 * 为什么要有 admin 权限位：
 *   审核是这一整套认证的最后一道闸。如果谁都能调这个函数，认证就形同虚设，
 *   非学生群体照样能进来 —— 而那正是这个功能存在的唯一理由。
 *
 * action:
 *   'list'   { token, status?='pending', page?, page_size? }  审核队列
 *   'detail' { token, request_id }                            看单条（含证件图临时链接）
 *   'pass'   { token, request_id }                            通过 → 发徽章 + 写 school_id
 *   'reject' { token, request_id, reason }                    拒绝 → 必填理由
 *
 * 【通过时做了什么】（顺序重要，注释写清楚为什么）
 *   1. verify_requests → approved
 *   2. 用户表写：verify_status='approved'、is_verified=true、schoolVerified=true、
 *      ★ school_id / school / city_code —— 这一条是关键：
 *        注册时用户只填了中文校名，school_id 一直是空的，
 *        导致 card-publish 写卡片时 school_id 也是空，
 *        于是 card-list 的同校频道永远返回空列表（"同校"这个核心卖点一直是死的）。
 *        认证通过时把学校定下来，同校频道才真正能用。
 *   3. 信誉分 +5（需求文档 §4.7：认证奖励）
 *   4. 给用户发通知
 *
 * 【为什么不删证件图】
 *   原型里写着"通过后 30 天删除"，但云存储定时清理要用定时触发器，
 *   而且删了一会儿重审就没证据了。当前阶段量小，先保留；
 *   真要清理时做一个定时云函数扫 verify_requests 里 approved 且超 30 天的记录。
 *   这里注释留痕，不算忘记。
 */

const db = uniCloud.database()
const dbCmd = db.command

// DB_USERS 由下面的 credit 核心段声明（四份副本里名字必须一致），这里不再重复
const DB_VERIFY = 'verify_requests'
const DB_NOTIFICATIONS = 'notifications'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const res = await db
    .collection(DB_USERS)
    .where({ token: token })
    .field({ _id: true, nickname: true, is_admin: true, role: true, credit: true, credit_score: true })
    .limit(1)
    .get()
  if (!res.data.length) fail('登录已过期，请重新登录', 401)
  return res.data[0]
}

/** 证件图存的是 fileID，要换成临时链接才能给前端 <image> 显示 */
async function toTempUrl(fileId) {
  if (!fileId) return ''
  // 支付宝云的 fileID 是 cloud:// 形式，必须换临时 URL 才能展示；
  // 阿里云返回的本身就是链接，直接返回。
  if (String(fileId).indexOf('cloud://') !== 0) return fileId
  try {
    const res = await uniCloud.getTempFileURL({ fileList: [fileId] })
    const f = res.fileList && res.fileList[0]
    return (f && f.tempFileURL) || ''
  } catch (e) {
    console.warn('[verify-review] getTempFileURL failed', e.message)
    return ''
  }
}

// ===================== credit 核心（唯一副本，其余云函数照抄这一段） =====================
// 为什么不抽公共模块：本仓库每个云函数目录上传时只打包自己，require 目录外的东西必挂，
// 所以这段在每个用得上的云函数里各内联一份，改动时四处同步（credit-list 是母本）。

const DB_USERS = 'uni-id-users'
const DB_CREDIT_EVENTS = 'credit_events'
const DB_CREDIT_RULES = 'credit_rules'

// 契约 §1 的内置默认表：credit_rules 表不存在 / 查不到 / active=false 时用它。
// 逐字照抄契约 —— 改这里等于改契约，前端「怎么算的」直接展示这些文案。
const DEFAULT_RULES = [
  { code: 'buddy_done', delta: 2, text: '完成一次搭子' },
  { code: 'no_show', delta: -5, text: '放鸽子' },
  { code: 'report_upheld', delta: -10, text: '举报被核实' },
  { code: 'verify_pass', delta: 5, text: '通过学生认证' },
  { code: 'admin_adjust', delta: 0, text: '管理员调整' }
]

const CREDIT_INIT = 80
const CREDIT_MAX = 100
const CREDIT_MIN = 0
// admin_adjust 不是用户可见事件（契约 §3.1），规则列表里剔掉
const RULE_HIDDEN = ['admin_adjust']
// 契约 §4.4：低于 60 不能发卡片
const CREDIT_PUBLISH_MIN = 60

function pickInt(v, dft) {
  return typeof v === 'number' ? v : dft
}

function clampScore(n) {
  return Math.max(CREDIT_MIN, Math.min(CREDIT_MAX, n))
}

/** 双字段兼容：历史数据里 credit 和 credit_score 都有人写，读的时候两套都要认 */
function readScore(user) {
  const u = user || {}
  return pickInt(u.credit_score, pickInt(u.credit, CREDIT_INIT))
}

function defaultRule(code) {
  for (let i = 0; i < DEFAULT_RULES.length; i++) {
    const r = DEFAULT_RULES[i]
    if (r.code === code) return { code: r.code, delta: r.delta, text: r.text }
  }
  // 未知 code 也给完整结构，调用方不用到处判空（分值未知按 0 处理，绝不误加分）
  return { code: code, delta: 0, text: code }
}

/**
 * 取当前生效规则（含隐藏项）。
 * 规则与执行分离（契约 §1）：表里有这条就用表里的 delta/text；没有、active=false、
 * 或表根本不存在 → 用内置默认。表里新增的 code 也会被带出来，
 * 这样将来加事件类型只改数据不改代码。
 */
async function loadRuleMap() {
  const map = {}
  DEFAULT_RULES.forEach(function (r) {
    map[r.code] = { code: r.code, delta: r.delta, text: r.text }
  })
  let rows = []
  try {
    const res = await db.collection(DB_CREDIT_RULES).orderBy('created_at', 'asc').limit(200).get()
    rows = res.data || []
  } catch (e) {
    // credit_rules 第一次写入前集合不存在，查询会抛；规则表只是覆盖层，
    // 抛出去会让整个信誉页打不开，所以静默回落到内置表。
    rows = []
  }
  rows.forEach(function (row) {
    const code = str(row.code)
    if (!code) return
    if (row.active === false) {
      map[code] = defaultRule(code)
      return
    }
    const dft = defaultRule(code)
    map[code] = {
      code: code,
      delta: pickInt(row.delta, dft.delta),
      text: str(row.text) || dft.text
    }
  })
  return map
}

/** 用户可见规则列表：顺序与契约 §1 表一致，表里多出来的 code 排在后面 */
async function loadVisibleRules() {
  const map = await loadRuleMap()
  const codes = DEFAULT_RULES.map(function (r) {
    return r.code
  })
  Object.keys(map).forEach(function (c) {
    if (codes.indexOf(c) < 0) codes.push(c)
  })
  const list = []
  codes.forEach(function (c) {
    if (RULE_HIDDEN.indexOf(c) >= 0) return
    const r = map[c]
    list.push({ code: r.code, delta: r.delta, text: r.text })
  })
  return list
}

async function resolveRule(code) {
  const map = await loadRuleMap()
  return map[code] || defaultRule(code)
}

/**
 * 写一行流水再改分。
 * 顺序不能反：流水是分数的唯一真相（docs/03-database.md），先改分再写流水
 * 会出现"分变了但明细里没有这一条"，信誉页和真实分数就永久对不上。
 * 失败处理留给调用方 —— 给分失败不该把主业务（确认搭子 / 认证通过）一起回滚。
 */
async function applyCredit(userId, reasonCode, refId) {
  if (!userId) throw new Error('缺少 user_id')
  const rule = await resolveRule(reasonCode)
  const uRes = await db
    .collection(DB_USERS)
    .doc(userId)
    .field({ credit: true, credit_score: true })
    .get()
  const before = readScore((uRes.data && uRes.data[0]) || {})
  const after = clampScore(before + rule.delta)
  const now = Date.now()
  await db.collection(DB_CREDIT_EVENTS).add({
    user_id: userId,
    delta: rule.delta,
    reason_code: rule.code,
    reason_text: rule.text, // 文案快照：后台以后改文案不影响历史记录
    score_after: after,
    ref_id: refId || '',
    created_at: now
  })
  await db.collection(DB_USERS).doc(userId).update({
    credit_score: after,
    credit: after
  })
  return { score: after, delta: rule.delta }
}
// ===================== credit 核心结束 =====================

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 幂等查询：这个人有没有拿过 verify_pass 的分。
 * 整段 try/catch —— credit_events 是本轮新加的集合，还没建时查询会抛，
 * 抛出去等于认证永远审不过；没建就是"没拿过"，照常给分（首次 add 会自动建表）。
 */
async function hasVerifyPass(userId) {
  try {
    const res = await db
      .collection(DB_CREDIT_EVENTS)
      .where({ user_id: userId, reason_code: 'verify_pass' })
      .limit(1)
      .get()
    return !!(res.data && res.data.length)
  } catch (e) {
    return false
  }
}

exports.main = async (event, context) => {
  try {
    const action = String(event.action || 'list')
    const me = await getUserByToken(event.token)

    // 管理员判断兼容两套字段名：
    //   is_admin=true（早期设计） / role='admin'（set-admin 写的）
    // 只认一个会让另一种写法静默失效，排查起来非常费时间。
    const isAdmin = me.is_admin === true || me.role === 'admin'
    if (!isAdmin) fail('没有权限：这项操作仅管理员可用', 403)

    // ============ 审核队列 ============
    if (action === 'list') {
      const status = String(event.status || 'pending')
      const page = Math.max(1, parseInt(event.page, 10) || 1)
      const pageSize = Math.min(MAX_LIMIT, Math.max(1, parseInt(event.page_size, 10) || DEFAULT_LIMIT))

      const where = {}
      if (status !== 'all') where.status = status

      const col = db.collection(DB_VERIFY)
      const countRes = await col.where(where).count()
      const listRes = await col
        .where(where)
        .field({
          user_id: true,
          nickname: true,
          mode: true,
          // 换校申请必须能在后台被认出来，否则审核员会拿新材料当首次认证去比对新学校。
          // kind 缺失的是历史数据（首次认证时代没有这个字段），前端一律按普通申请渲染。
          kind: true,
          from_school_id: true,
          school_name: true,
          real_name: true,
          student_no: true,
          grade: true,
          status: true,
          reject_reason: true,
          created_at: true,
          reviewed_at: true
        })
        .orderBy('created_at', 'asc')   // 先到先审，别让早交的人一直排队
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()

      return {
        code: 0,
        msg: 'ok',
        data: {
          list: listRes.data,
          total: countRes.total,
          page: page,
          page_size: pageSize,
          has_more: page * pageSize < countRes.total
        }
      }
    }

    // ============ 单条详情 ============
    if (action === 'detail') {
      const requestId = String(event.request_id || '')
      if (!requestId) fail('缺少申请 id')

      const res = await db.collection(DB_VERIFY).doc(requestId).get()
      const req = res.data && res.data[0]
      if (!req) fail('这条认证申请不存在', 404)

      // 证件图给临时链接（私有存储，只有人工审核时看得到）
      const photoUrl = await toTempUrl(req.photo_file_id)
      const chsiUrl = await toTempUrl(req.chsi_file_id)

      // 顺带把用户当前资料带出来，方便人工比对（姓名/学校能不能对上）
      const userRes = await db
        .collection(DB_USERS)
        .doc(req.user_id)
        .field({ nickname: true, school: true, school_id: true, verify_status: true })
        .get()
      const user = (userRes.data && userRes.data[0]) || {}

      // 换校申请要把原学校中文名也带出来，审核员才看得懂"旧校 → 新校"。
      // from_school_id 为空（历史数据/首次认证）或学校被删时给空串，绝不阻断审核。
      let fromSchoolName = ''
      if (req.from_school_id) {
        try {
          const fromRes = await db
            .collection('schools')
            .doc(req.from_school_id)
            .field({ name: true })
            .get()
          const from = fromRes.data && fromRes.data[0]
          if (from && from.name) fromSchoolName = from.name
        } catch (e) {
          console.warn('[verify-review] from school lookup failed', e.message)
        }
      }

      return {
        code: 0,
        msg: 'ok',
        data: {
          request: Object.assign({}, req, {
            photo_url: photoUrl,
            chsi_url: chsiUrl,
            from_school_name: fromSchoolName
          }),
          user: user
        }
      }
    }

    // ============ 通过 ============
    if (action === 'pass') {
      const requestId = String(event.request_id || '')
      if (!requestId) fail('缺少申请 id')

      const res = await db.collection(DB_VERIFY).doc(requestId).get()
      const req = res.data && res.data[0]
      if (!req) fail('这条认证申请不存在', 404)
      if (req.status !== 'pending') fail('这条申请已经处理过了，不能重复操作')

      const now = Date.now()

      // 1) 申请记录置为通过
      await db.collection(DB_VERIFY).doc(requestId).update({
        status: 'approved',
        reviewer_id: me._id,
        reviewed_at: now,
        updated_at: now
      })

      // 2) 用户表：发徽章 + ★ 落学校
      //    school_id 必须在这里写，不然同校频道永远是空的（见文件头注释）
      const userRes = await db
        .collection(DB_USERS)
        .doc(req.user_id)
        .field({ credit: true, credit_score: true })
        .get()
      const target = (userRes.data && userRes.data[0]) || {}

      // 3) 信誉分 +5 改走 credit 核心（契约 §3.4）：分只能由 credit_events 推导，
      //    所以先写流水再由核心改分，下面那个 patch 不再手写 credit_score。
      //    幂等：认证被拒后可以重提交，但同一个人的 verify_pass 只能拿一次分。
      let newCredit = readScore(target)
      let creditGain = 0
      if (await hasVerifyPass(req.user_id)) {
        console.log('[verify-review] verify_pass already granted, skip', req.user_id)
      } else {
        try {
          const applied = await applyCredit(req.user_id, 'verify_pass', requestId)
          newCredit = applied.score
          creditGain = applied.delta
        } catch (e) {
          // 给分失败不能把"认证通过"一起否掉 —— 用户确实审过了，分可以后台用
          // admin_adjust 补；这里如实返回没加过的分，出参结构本身不变。
          console.warn('[verify-review] credit grant failed', e.message)
        }
      }

      const patch = {
        verify_status: 'approved',
        is_verified: true,
        schoolVerified: true,
        verify_at: now,
        verify_updated_at: now,
        school_id: req.school_id || '',
        school: req.school_name || '',
        real_name: req.real_name || '',
        student_no: req.student_no || '',
        update_time: now
      }

      // 学校所在城市也带上，方便"城市"筛选
      try {
        const sRes = await db
          .collection('schools')
          .doc(req.school_id)
          .field({ city_code: true })
          .get()
        const s = sRes.data && sRes.data[0]
        if (s && s.city_code) patch.city_code = s.city_code
      } catch (e) {
        // 学校查不到不影响认证，只是城市筛选少一个维度
        console.warn('[verify-review] school city lookup failed', e.message)
      }

      await db.collection(DB_USERS).doc(req.user_id).update(patch)

      // 3) 通知用户
      try {
        await db.collection(DB_NOTIFICATIONS).add({
          user_id: req.user_id,
          type: 'verify_approved',
          title: '学生认证已通过',
          content: '你已认证为「' + (req.school_name || '本校') + '」学生，现在可以进入同校频道了。' + (creditGain > 0 ? '信誉分 +' + creditGain + '。' : ''),
          read: false,
          created_at: now
        })
      } catch (e) {
        console.warn('[verify-review] notify failed', e.message)
      }

      return {
        code: 0,
        msg: 'ok',
        data: {
          status: 'approved',
          credit: newCredit,
          school_id: patch.school_id
        }
      }
    }

    // ============ 拒绝 ============
    if (action === 'reject') {
      const requestId = String(event.request_id || '')
      const reason = String(event.reason || '').trim()
      if (!requestId) fail('缺少申请 id')
      // 拒绝必须写理由：不写理由用户不知道错在哪，只会反复提交同一张图
      if (!reason) fail('请填写拒绝理由，用户需要知道哪里不合格')
      if (reason.length > 100) fail('理由请控制在 100 字以内')

      const res = await db.collection(DB_VERIFY).doc(requestId).get()
      const req = res.data && res.data[0]
      if (!req) fail('这条认证申请不存在', 404)
      if (req.status !== 'pending') fail('这条申请已经处理过了，不能重复操作')

      const now = Date.now()

      await db.collection(DB_VERIFY).doc(requestId).update({
        status: 'rejected',
        reject_reason: reason,
        reviewer_id: me._id,
        reviewed_at: now,
        updated_at: now
      })

      // 换校被拒 ≠ 认证被拒：这类用户本来就是已认证的，退回 'rejected' 会让前端
      // 把他显示成"上次没通过"、can_submit 也跟着乱，所以把状态还原成 approved，
      // 徽章（is_verified / schoolVerified）本来就没动过，学校也还是原学校。
      // 普通认证（kind 缺失或为 'first'）保持退回 'rejected'，让他能改材料重交。
      const isChangeSchool = req.kind === 'change_school'
      await db.collection(DB_USERS).doc(req.user_id).update({
        verify_status: isChangeSchool ? 'approved' : 'rejected',
        verify_updated_at: now
      })

      try {
        await db.collection(DB_NOTIFICATIONS).add({
          user_id: req.user_id,
          type: 'verify_rejected',
          // 换校被拒时别吓人：认证本身没丢，只是这次没批
          title: isChangeSchool ? '更换学校申请未通过' : '学生认证未通过',
          content: isChangeSchool
            ? '原因：' + reason + '。你的原有认证仍然有效，可以修改后重新申请更换学校。'
            : '原因：' + reason + '。你可以修改后重新提交。',
          read: false,
          created_at: now
        })
      } catch (e) {
        console.warn('[verify-review] notify failed', e.message)
      }

      return { code: 0, msg: 'ok', data: { status: 'rejected' } }
    }

    fail('不支持的操作：' + action)
  } catch (e) {
    if (e.bizCode) return { code: e.bizCode, msg: e.message }
    console.error('[verify-review] unexpected', e)
    return { code: 500, msg: e.message || '服务器开小差了，请稍后再试' }
  }
}