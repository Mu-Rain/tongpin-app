'use strict'

/**
 * uid-backfill —— 给老账号补 8 位 UID（一次性运维工具）
 *
 * ============================ 为什么必须先跑它 ============================
 * 唯一索引把「字段不存在」当成 null。库里只要有两个以上没有 uid 的账号，
 * 建 idx_uid 会直接失败（duplicate key: null）——不是代码错，是索引建不起来。
 * 所以上线顺序必须是：
 *   ① 本函数 ALLOW 改 true → 上传并运行（先 dry_run 看数量）
 *   ② 确认 filled 覆盖了所有人、failed = 0
 *   ③ 再去 uniCloud 控制台给 uni-id-users 建 uid 唯一索引（idx_uid）
 *   ④ 把 ALLOW 改回 false（或直接删掉这个云函数）
 * 顺序反了就会卡在「索引建不上」，而且报错信息很难看懂。
 * =======================================================================
 *
 * 入参：{ token, dry_run? }
 *   token 必须是管理员；dry_run 默认 true（只统计，不改库）。
 * 出参：{ code, data: { scanned, filled, failed, dry_run } }
 *
 * ★ 幂等：已经有合法 uid 的账号一律跳过，跑几次结果都一样。
 * ★ 新注册的账号在 user-register 里就已经有 uid，不需要这个函数；
 *   活跃老账号也会在 user-login / user-auto-login 里自动补号。
 *   本函数只负责「从来没再登录过」的那批人。
 */

const crypto = require('crypto')

const db = uniCloud.database()
const DB_USERS = 'uni-id-users'

// ★ 一次性运维工具：正式环境默认关闭（项目安全规范：上线前 ALLOW 改 false）。
const ALLOW = false

// 与 user-register / user-login 完全一致的生成规则
const UID_MIN = 10000000
const UID_SPAN = 90000000

function genUid() {
  return String(UID_MIN + (crypto.randomBytes(4).readUInt32BE(0) % UID_SPAN))
}

function isDupErr(e) {
  return String((e && e.message) || '').toLowerCase().indexOf('duplicate') > -1
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

exports.main = async (event) => {
  event = event || {}

  if (!ALLOW) {
    return {
      code: 403,
      msg: '一次性运维函数已关闭：把 index.js 里的 ALLOW 改成 true 再上传运行，跑完记得改回来'
    }
  }

  const token = str(event.token)
  if (!token) return { code: 401, msg: '缺少 token' }

  const meRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
  const me = (meRes.data || [])[0]
  if (!me) return { code: 401, msg: '登录已过期，请重新登录' }
  if (!(me.is_admin === true || me.role === 'admin')) {
    return { code: 403, msg: '仅管理员可用' }
  }

  // 默认 dry_run：先看数字，确认无误再传 dry_run:false 真改
  const dry = event.dry_run !== false

  const PAGE = 100
  const MAX_PAGES = 100 // 上限 1 万账号，够这个项目用；超了分批跑

  let scanned = 0
  let filled = 0
  let failed = 0
  let skip = 0

  for (let p = 0; p < MAX_PAGES; p++) {
    // 按 _id 分页：更新不会改变条数，skip 不会漏人也不会重复
    const res = await db
      .collection(DB_USERS)
      .field({ _id: true, uid: true })
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(PAGE)
      .get()

    const rows = res.data || []
    if (!rows.length) break
    scanned += rows.length

    for (let i = 0; i < rows.length; i++) {
      const u = rows[i]
      // 已经有合法 uid：跳过。UID 一旦生成永不改动。
      if (/^[1-9]\d{7}$/.test(str(u.uid))) continue

      if (dry) {
        filled++
        continue
      }

      let done = false
      // 撞唯一索引就换一个号重试；还没建索引时永远不会撞
      for (let k = 0; k < 6 && !done; k++) {
        try {
          await db.collection(DB_USERS).doc(u._id).update({
            uid: genUid(),
            updateTime: Date.now()
          })
          done = true
        } catch (e) {
          if (!isDupErr(e)) {
            console.warn('[uid-backfill] 写失败', u._id, e && e.message)
            break
          }
        }
      }
      if (done) filled++
      else failed++
    }

    skip += rows.length
    if (rows.length < PAGE) break
  }

  return {
    code: 0,
    msg: dry ? 'ok（dry_run，未改库）' : 'ok',
    data: { scanned, filled, failed, dry_run: dry }
  }
}
