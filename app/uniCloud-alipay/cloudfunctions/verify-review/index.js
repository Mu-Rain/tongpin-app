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

const DB_USERS = 'uni-id-users'
const DB_VERIFY = 'verify_requests'
const DB_NOTIFICATIONS = 'notifications'

const VERIFY_REWARD = 5         // 认证通过加多少信誉分
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

/** 读信誉分，两套字段名都要兼容 */
function readCredit(user) {
  if (typeof user.credit_score === 'number') return user.credit_score
  if (typeof user.credit === 'number') return user.credit
  return 80
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

      return {
        code: 0,
        msg: 'ok',
        data: {
          request: Object.assign({}, req, {
            photo_url: photoUrl,
            chsi_url: chsiUrl
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
      const newCredit = Math.min(100, readCredit(target) + VERIFY_REWARD)

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
        credit_score: newCredit,
        credit: newCredit,
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
          content: '你已认证为「' + (req.school_name || '本校') + '」学生，现在可以进入同校频道了。信誉分 +' + VERIFY_REWARD + '。',
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

      // 用户的 verify_status 退回 rejected，让他能重新提交
      await db.collection(DB_USERS).doc(req.user_id).update({
        verify_status: 'rejected',
        verify_updated_at: now
      })

      try {
        await db.collection(DB_NOTIFICATIONS).add({
          user_id: req.user_id,
          type: 'verify_rejected',
          title: '学生认证未通过',
          content: '原因：' + reason + '。你可以修改后重新提交。',
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
