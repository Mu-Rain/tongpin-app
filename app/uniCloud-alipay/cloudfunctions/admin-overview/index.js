'use strict'

/**
 * admin-overview —— 后台首页的数字看板（仅管理员可用）
 *
 * 入参：{ token }
 * 出参：{ code: 0, data: {
 *   users: { total, today, week, banned },
 *   posts: { total, today },
 *   cards: { total, open, today },
 *   reports: { pending, today },
 *   verify: { pending },
 *   meetups: { total, today, confirmed },
 *   server_time
 * } }
 *
 * ★ 每个计数都是「读不出来就回 null」，不做整体失败：
 *   某个集合还没建、或正在迁移时，整页变成错误页是最糟的结果 ——
 *   少一个数字，运营还能看别的；整页打不开，他就什么也干不了。
 *   前端把 null 显示成「—」。
 *
 * ★ 只回数字，不回任何一条具体记录：
 *   看板没有看内容的必要，就不该拥有看内容的能力。
 *
 * ★ 只判定一次管理员身份，且在读任何业务数据之前（与 admin-users 同一纪律）。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_VERIFY = 'verify_requests'
const COLL_POSTS = 'posts'
const COLL_CARDS = 'cards'
const COLL_REPORTS = 'reports'
const COLL_MEETUPS = 'meetups'

const DAY_MS = 86400000
// 云函数时区按 UTC+8 切天：用户的「今天」是他的今天，不是服务器的 UTC 今天
const TZ_OFFSET = 8 * 3600 * 1000

function str(v) {
  return typeof v === 'string' ? v : ''
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 500
  throw e
}

async function getUserByToken(token) {
  if (!token) fail('登录后才能使用', 401)
  const r = await db
    .collection(DB_USERS)
    .where({ token: token })
    .field({ _id: true, role: true, is_admin: true })
    .limit(1)
    .get()
  const u = r.data && r.data[0]
  if (!u) fail('登录状态已失效，请重新登录', 401)
  return u
}

function isAdminUser(u) {
  if (!u) return false
  return str(u.role) === 'admin' || u.is_admin === true
}

/** 毫秒时间戳所在的那一天 0 点（按 UTC+8） */
function dayStart(ms) {
  const local = ms + TZ_OFFSET
  return local - (local % DAY_MS) - TZ_OFFSET
}

async function safeCount(coll, where) {
  try {
    const q = where ? db.collection(coll).where(where) : db.collection(coll)
    const r = await q.count()
    return typeof r.total === 'number' ? r.total : null
  } catch (e) {
    console.warn('[admin-overview] count 失败 ' + coll)
    return null
  }
}

exports.main = async (event) => {
  try {
    event = event || {}
    const me = await getUserByToken(str(event.token))
    if (!isAdminUser(me)) fail('没有权限：后台看板仅管理员可用', 403)

    const now = Date.now()
    const today = dayStart(now)
    const week = today - 6 * DAY_MS
    const notRemoved = dbCmd.neq('removed')

    const r = await Promise.all([
      safeCount(DB_USERS, null),
      safeCount(DB_USERS, { createTime: dbCmd.gte(today) }),
      safeCount(DB_USERS, { createTime: dbCmd.gte(week) }),
      safeCount(DB_USERS, { status: 'banned' }),
      safeCount(COLL_POSTS, { status: notRemoved }),
      safeCount(COLL_POSTS, { status: notRemoved, created_at: dbCmd.gte(today) }),
      safeCount(COLL_CARDS, { status: notRemoved }),
      safeCount(COLL_CARDS, { status: 'open' }),
      safeCount(COLL_CARDS, { status: notRemoved, created_at: dbCmd.gte(today) }),
      safeCount(COLL_REPORTS, { status: 'pending' }),
      safeCount(COLL_REPORTS, { created_at: dbCmd.gte(today) }),
      safeCount(DB_VERIFY, { status: 'pending' }),
      safeCount(COLL_MEETUPS, null),
      safeCount(COLL_MEETUPS, { created_at: dbCmd.gte(today) }),
      safeCount(COLL_MEETUPS, { status: 'both_confirmed' })
    ])

    return {
      code: 0,
      msg: 'ok',
      data: {
        users: { total: r[0], today: r[1], week: r[2], banned: r[3] },
        posts: { total: r[4], today: r[5] },
        cards: { total: r[6], open: r[7], today: r[8] },
        reports: { pending: r[9], today: r[10] },
        verify: { pending: r[11] },
        meetups: { total: r[12], today: r[13], confirmed: r[14] },
        server_time: now
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '看板加载失败' }
  }
}