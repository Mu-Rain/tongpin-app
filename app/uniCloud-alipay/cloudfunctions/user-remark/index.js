'use strict'

/**
 * 用户备注 —— 给某个人起一个只有自己看得见的备注
 *
 * 入参：{ token, action }
 *   action = 'set'   { token, action:'set',   target_user_id, remark }
 *   action = 'clear' { token, action:'clear', target_user_id }
 *   action = 'map'   { token, action:'map',   user_ids: [...] }   最多 50 个
 * 出参统一 { code, msg, data }
 *   set   → { target_user_id, remark }
 *   clear → { target_user_id, remark: '' }
 *   map   → { map: { '<userId>': '<remark>' } }   只含有备注的项
 *
 * ★ 备注按「人」存一份，不按搭子关系段存。
 *   一个人身上可能挂着多段搭子关系（自习 + 夜跑 + 拍照），
 *   但"我管他叫什么"只有一句话，改一次就该处处生效。
 *
 * ★★ 这和 buddy_relations 里的 label_a / label_b 是**两回事**，千万别合并：
 *   那个是"这段搭子关系叫什么"（考研战友 / 夜跑搭子），一段关系一个；
 *   这个是"这个人叫什么"，一个人一个。
 *   见 user-profile 第 187-190 行的注释。
 *
 * ★ 唯一性：(owner_id, target_user_id) 一对只有一条。
 *   remark 最长 12 个字符，空串表示没有备注 —— 此时整行删掉，不留空壳。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_REMARKS = 'user_remarks'

// 备注最长 12 个字。按真实字符数算（Array.from 的码点数），
// 一个 emoji 算 1 个字，而不是 String.length 的 2 个。
const REMARK_MAX = 12
// map 一次最多查 50 个人，避免客户端一次把全站都问一遍
const MAP_MAX = 50

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

function charLen(s) {
  return Array.from(s).length
}

/** 一次 in 查完，返回 { targetId: remark }，只收 remark 非空的项 */
async function loadRemarkMap(ownerId, ids) {
  const map = {}
  if (!ids.length) return map
  const r = await db
    .collection(DB_REMARKS)
    .where({ owner_id: ownerId, target_user_id: dbCmd.in(ids) })
    .limit(MAP_MAX)
    .get()
  for (const row of r.data) {
    const t = str(row.target_user_id)
    const text = str(row.remark)
    if (t && text) map[t] = text
  }
  return map
}

exports.main = async (event) => {
  try {
    event = event || {}
    const action = str(event.action)
    const me = await getUserByToken(str(event.token))

    // ============================================================
    // 起备注 / 改备注
    // ============================================================
    if (action === 'set') {
      const targetId = str(event.target_user_id)
      if (!targetId) fail('缺少 target_user_id', 400)
      if (targetId === me._id) fail('不能给自己起备注', 400)

      const remark = str(event.remark)
      if (charLen(remark) > REMARK_MAX) fail('备注最多 ' + REMARK_MAX + ' 个字', 400)

      const now = Date.now()
      const col = db.collection(DB_REMARKS)
      const cond = { owner_id: me._id, target_user_id: targetId }

      // 存空串 = 没有备注：整行删掉，不留空壳。
      // 唯一性是靠"只有一条"保证的，留一堆 remark:'' 的行会让 map 白跑。
      if (!remark) {
        await col.where(cond).remove()
        return { code: 0, msg: 'ok', data: { target_user_id: targetId, remark: '' } }
      }

      // upsert：先查有没有旧行，再决定改还是插。
      //
      // ★ 这里**不能**靠 update 的返回条数判断「有没有旧行」：
      //   MongoDB 的 updated 是"实际改动的条数"，把备注从"老王"改成"老王"
      //   modifiedCount 是 0，会被误判成"没有旧行" → 再 add 一条 →
      //   (owner_id,target_user_id) 长出两行，map 动作随机取到其中一条。
      //   所以必须先 get 一次，按行数分支。
      const exist = await col.where(cond).limit(1).get()
      if (exist.data.length) {
        await col.where(cond).update({ remark: remark, updated_at: now })
      } else {
        await col.add({
          owner_id: me._id,
          target_user_id: targetId,
          remark: remark,
          created_at: now,
          updated_at: now
        })
      }
      return { code: 0, msg: 'ok', data: { target_user_id: targetId, remark: remark } }
    }

    // ============================================================
    // 删备注
    // ============================================================
    if (action === 'clear') {
      const targetId = str(event.target_user_id)
      if (!targetId) fail('缺少 target_user_id', 400)
      if (targetId === me._id) fail('不能给自己起备注', 400)

      // 幂等：本来就没备注也返回 ok，前端不用区分"删过"和"没得删"
      await db.collection(DB_REMARKS).where({ owner_id: me._id, target_user_id: targetId }).remove()
      return { code: 0, msg: 'ok', data: { target_user_id: targetId, remark: '' } }
    }

    // ============================================================
    // 批量取（列表页用：拿到一批 user_id 后一次问完）
    // ============================================================
    if (action === 'map') {
      if (!Array.isArray(event.user_ids)) fail('user_ids 必须是数组', 400)

      // 过滤非字符串 / 空串 → 去重 → 截断到 50 个
      const ids = []
      for (const raw of event.user_ids) {
        const id = str(raw)
        if (!id) continue
        if (ids.indexOf(id) >= 0) continue
        ids.push(id)
        if (ids.length >= MAP_MAX) break
      }

      const map = await loadRemarkMap(me._id, ids)
      return { code: 0, msg: 'ok', data: { map: map } }
    }

    fail('不认识的动作：' + (action || '(空)'), 400)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '操作失败' }
  }
}
