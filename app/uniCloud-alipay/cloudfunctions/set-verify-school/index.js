'use strict'

/**
 * set-verify-school —— 一次性运维工具：把指定手机号的**学生认证学校**改成指定学校。
 *
 * 为什么要有它：改这种字段要同时动 users 的 school / school_name / school_id / city_code /
 * 认证徽章，还要保证 school_id 与 schools 表一致；在控制台手点六七个字段必然漏。用云函数改，
 * 改了什么、哪几个号没找到，都会明确返回。
 *
 * 怎么用（HBuilderX 右键这个云函数 →「上传并部署」→「运行」，参数填）：
 *   { "phones": ["13800000001", "13800000002"], "school": "某某大学", "confirm": "YES" }
 *
 * ⚠️ 安全：这个函数能改任意账号的认证学校。它只接受 confirm:'YES' 才执行；
 *    用完把 ALLOW 改成 false（或直接删掉这个云函数），别长期留在服务空间里。
 */

const db = uniCloud.database()
const dbCmd = db.command
const DB_USERS = 'uni-id-users'
const DB_SCHOOLS = 'schools'

// 用完改 false，或直接删函数
const ALLOW = false

function str(v) {
  return v === undefined || v === null ? '' : String(v)
}

/* 手机号的历史存法有三种（字符串 / 数字 / 带 86 前缀），三种都试一遍 */
async function findUser(phone) {
  const variants = [phone, '86' + phone, '+86' + phone]
  let r = await db.collection(DB_USERS).where({ phone: dbCmd.in(variants) }).limit(1).get()
  if (r.data && r.data.length) return r.data[0]
  r = await db.collection(DB_USERS).where({ phone: Number(phone) }).limit(1).get()
  if (r.data && r.data.length) return r.data[0]
  return null
}

/* 找学校：先按现名精确，再按 aliases，最后按名字包含 —— 三条都命中不了就报错，
   绝不猜一个近似值写进去（写错 school_id 会让同校频道整个错位）。 */
async function findSchool(name) {
  const all = await db.collection(DB_SCHOOLS).field({ name: true, aliases: true, city_code: true, province: true }).limit(500).get()
  const list = (all && all.data) || []
  let hit = list.filter(function (s) { return str(s.name) === name })[0]
  if (!hit) {
    hit = list.filter(function (s) {
      const as = Array.isArray(s.aliases) ? s.aliases : []
      return as.indexOf(name) >= 0
    })[0]
  }
  if (!hit) {
    hit = list.filter(function (s) { return str(s.name).indexOf(name) >= 0 })[0]
  }
  return hit || null
}

exports.main = async (event) => {
  try {
    if (!ALLOW) return { code: 403, msg: 'set-verify-school 已被禁用' }
    const e = event || {}
    if (str(e.confirm) !== 'YES') return { code: 400, msg: "缺少确认参数：请传 confirm: 'YES'" }

    const phones = Array.isArray(e.phones) ? e.phones.map(str).filter(Boolean) : []
    const schoolName = str(e.school).trim()
    if (!phones.length) return { code: 400, msg: '缺少 phones（手机号数组）' }
    if (!schoolName) return { code: 400, msg: '缺少 school（学校名）' }
    if (phones.length > 20) return { code: 400, msg: '一次最多改 20 个号' }

    const school = await findSchool(schoolName)
    if (!school) return { code: 404, msg: 'schools 表里找不到这所学校：' + schoolName }

    const now = Date.now()
    const updated = []
    const skipped = []
    for (let i = 0; i < phones.length; i++) {
      const phone = phones[i]
      const user = await findUser(phone)
      if (!user) {
        skipped.push({ phone: phone, reason: '账号不存在' })
        continue
      }
      const patch = {
        school: school.name,
        school_name: school.name,
        school_id: school._id,
        // 认证徽章与状态一起写：只改学校不写徽章，同校频道仍然锁着
        schoolVerified: true,
        is_verified: true,
        verify_status: 'approved',
        verify_updated_at: now,
        updateTime: now,
        updated_at: now
      }
      if (school.city_code) patch.city_code = school.city_code
      await db.collection(DB_USERS).doc(user._id).update(patch)
      updated.push({
        phone: phone,
        uid: str(user.uid),
        nickname: str(user.nickname),
        from_school: str(user.school || user.school_name),
        to_school: school.name,
        school_id: school._id
      })
    }

    return {
      code: 0,
      msg: '改完 ' + updated.length + ' 个，跳过 ' + skipped.length + ' 个',
      data: { school: { _id: school._id, name: school.name }, updated: updated, skipped: skipped }
    }
  } catch (err) {
    return { code: 500, msg: (err && err.message) || '执行失败' }
  }
}
