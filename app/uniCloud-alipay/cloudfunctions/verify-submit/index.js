'use strict'
/**
 * verify-submit —— 学生认证：提交申请 + 查询自己的认证状态
 *
 * 为什么要有学生认证（用户原话，是所有取舍的依据）：
 *   "防止不良用户乱发一些不好的东西，沦为所谓的交友软件，将非学生群体隔绝"
 *   → 所以认证的核心是"证明你确实是在校学生"，不是做社交门槛。
 *   → 所以认证材料必须能体现"在读"这个事实。
 *
 * 两种材料模式（用户指定，可切换）：
 *   mode = 'card'    学校 + 姓名 + 学号 + 学生证/校园卡照片
 *                    人工审核证件上的姓名、学号、学校是否与表单一致，且证件有效期/注册章能看出在读。
 *   mode = 'chsi'    学校 + 学信网《教育部学籍在线验证报告》截图
 *                    防伪最强（报告带二维码可扫码核验），但很多学生不会弄，转化率低。
 *   两种都覆盖大学/专科；中学生没有学信网，只能走 'card'，所以 card 模式对中学生必开。
 *
 * 字段设计上给 AI 留了位置：
 *   review_mode: 'manual' | 'ai_assisted'
 *   现在只写 'manual'。以后接 AI 初审时，AI 把结论写进 ai_suggest / ai_reason，
 *   人还是那个人（点确认），review_mode 标成 'ai_assisted' 方便统计"AI 帮你省了多少活"。
 *   审核页不用重写，只是多显示一段 AI 建议。
 *
 * action:
 *   'submit'  提交认证申请 { token, mode, school_id, real_name, student_no, grade?, photo_file_id, chsi_file_id? }
 *   'status'  查自己的认证状态 { token }
 *
 * 状态机（verify_status）：
 *   'none'     没提交过
 *   'pending'  审核中（此时不能再提交）
 *   'approved' 已通过
 *   'rejected' 被拒（可以重新提交，最多 MAX_ATTEMPTS 次）
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_VERIFY = 'verify_requests'
const DB_SCHOOLS = 'schools'

const MODE_ENUM = ['card', 'chsi']
const MAX_ATTEMPTS = 3          // 最多提交 3 次，防止拿认证入口反复试假图
const MAX_NAME = 20
const MAX_STUDENT_NO = 30

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
    .field({
      _id: true,
      nickname: true,
      school: true,
      school_id: true,
      credit: true,
      credit_score: true,
      verify_status: true,
      schoolVerified: true,
      is_verified: true,
      is_admin: true
    })
    .limit(1)
    .get()
  if (!res.data.length) fail('登录已过期，请重新登录', 401)
  return res.data[0]
}

/** 兼容两套字段名：第 1 天注册写的 schoolVerified / 03 文档设计的 is_verified */
function isVerified(user) {
  return !!(
    user.is_verified ||
    user.schoolVerified ||
    user.verify_status === 'approved'
  )
}

exports.main = async (event, context) => {
  try {
    const action = String(event.action || 'status')
    const me = await getUserByToken(event.token)

    // ============ 查询状态 ============
    if (action === 'status') {
      const verified = isVerified(me)

      // 取最近一次申请（不管什么状态），用于展示"被拒理由"和"剩余次数"
      const lastRes = await db
        .collection(DB_VERIFY)
        .where({ user_id: me._id })
        .orderBy('created_at', 'desc')
        .limit(1)
        .get()
      const last = lastRes.data[0] || null

      const attemptRes = await db
        .collection(DB_VERIFY)
        .where({ user_id: me._id })
        .count()

      let status = 'none'
      if (verified) status = 'approved'
      else if (last && last.status === 'pending') status = 'pending'
      else if (last && last.status === 'rejected') status = 'rejected'

      return {
        code: 0,
        msg: 'ok',
        data: {
          status: status,
          verified: verified,
          school: me.school || '',
          school_id: me.school_id || '',
          attempts: attemptRes.total,
          max_attempts: MAX_ATTEMPTS,
          can_submit: !verified && status !== 'pending' && attemptRes.total < MAX_ATTEMPTS,
          last: last
            ? {
                _id: last._id,
                mode: last.mode,
                status: last.status,
                reject_reason: last.reject_reason || '',
                created_at: last.created_at,
                reviewed_at: last.reviewed_at || 0
              }
            : null
        }
      }
    }

    // ============ 提交申请 ============
    if (action === 'submit') {
      if (isVerified(me)) fail('你已经通过认证了，不需要重复提交')

      const mode = String(event.mode || '')
      if (MODE_ENUM.indexOf(mode) < 0) fail('请选择认证方式')

      const schoolId = String(event.school_id || '').trim()
      const realName = String(event.real_name || '').trim()
      const studentNo = String(event.student_no || '').trim()
      const grade = String(event.grade || '').trim()
      const photoFileId = String(event.photo_file_id || '').trim()
      const chsiFileId = String(event.chsi_file_id || '').trim()

      if (!schoolId) fail('请选择你的学校')
      if (!realName) fail('请填写真实姓名')
      if (realName.length > MAX_NAME) fail('姓名太长了')
      if (!studentNo) fail('请填写学号')
      if (studentNo.length > MAX_STUDENT_NO) fail('学号太长了')

      // 学校必须真实存在于学校表，否则同校频道又会被脏数据搞坏
      const schoolRes = await db
        .collection(DB_SCHOOLS)
        .doc(schoolId)
        .field({ name: true, city_code: true, level: true, active: true })
        .get()
      const school = schoolRes.data && schoolRes.data[0]
      if (!school) fail('这所学校不在列表里，请从列表中选择')
      if (school.active === false) fail('这所学校暂不支持认证')

      // 材料：card 模式必须传学生证照片；chsi 模式必须传学信网报告截图
      if (mode === 'card' && !photoFileId) fail('请上传学生证或校园卡照片')
      if (mode === 'chsi') {
        if (!chsiFileId) fail('请上传学信网在线验证报告截图')
      }

      // 审核中的不能重复提交（重复提交会让后台出现一堆重复任务）
      const pendingRes = await db
        .collection(DB_VERIFY)
        .where({ user_id: me._id, status: 'pending' })
        .count()
      if (pendingRes.total > 0) fail('你有一份认证申请正在审核中，请等待结果')

      // 次数上限
      const attemptRes = await db.collection(DB_VERIFY).where({ user_id: me._id }).count()
      if (attemptRes.total >= MAX_ATTEMPTS) {
        fail('认证提交次数已用完（最多 ' + MAX_ATTEMPTS + ' 次），如有疑问请联系管理员')
      }

      const now = Date.now()
      const addRes = await db.collection(DB_VERIFY).add({
        user_id: me._id,
        nickname: me.nickname || '',
        mode: mode,
        school_id: schoolId,
        school_name: school.name || '',
        real_name: realName,
        student_no: studentNo,
        grade: grade,
        // 存 fileID 不存临时链接：临时链接会过期，fileID 才是长期可用的引用
        photo_file_id: mode === 'card' ? photoFileId : '',
        chsi_file_id: mode === 'chsi' ? chsiFileId : '',
        status: 'pending',
        reject_reason: '',
        review_mode: 'manual',   // ★ AI 审核的预留位：现在是人工，以后写 'ai_assisted'
        ai_suggest: '',          // AI 初审结论（以后用）
        ai_reason: '',           // AI 判断理由（以后用）
        reviewer_id: '',
        reviewed_at: 0,
        created_at: now,
        updated_at: now
      })

      // 用户表同步状态，方便列表页/卡片页直接读，不用联查 verify_requests
      await db.collection(DB_USERS).doc(me._id).update({
        verify_status: 'pending',
        verify_updated_at: now
      })

      return {
        code: 0,
        msg: 'ok',
        data: {
          request_id: addRes.id || addRes._id,
          status: 'pending',
          // 提示语如实告知审核周期，别让用户干等
          tip: '已提交，1–2 个工作日内出结果'
        }
      }
    }

    fail('不支持的操作：' + action)
  } catch (e) {
    if (e.bizCode) return { code: e.bizCode, msg: e.message }
    console.error('[verify-submit] unexpected', e)
    return { code: 500, msg: e.message || '服务器开小差了，请稍后再试' }
  }
}
