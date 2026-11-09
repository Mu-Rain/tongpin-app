'use strict'

/**
 * 解除搭子 —— pages/buddy/buddy.vue 的"解除"用
 *
 * 入参：{ token, relation_id }
 * 出参：{ code, msg, data: { relation_id, ended_at } }
 *
 * ★ 只解除**一段**关系，不是"跟这个人断交"。
 *   一张卡 = 一个人，这个人身上可能挂着多段关系（自习 + 夜跑 + 拍照）。
 *   解除哪一段由前端把该段的 relation_id 传进来。
 *
 * ★ 解除后为什么不需要动其它云函数：
 *   - pages/buddy 的列表（buddy-list）只查 status:'active' → 这段自动消失
 *   - 消息列表（message-conversations）拼标签时只收 active 的关系 → 聊天还在，标签自动没了
 *   - 他人主页（user-profile）的"你们之间的搭子"也只查 active → 自动清空、可以重新邀请同一类型
 *   这正是需求 US-25 要的"双方列表里消失、聊天保留但标签消失"。
 *
 * ★ 双方都能解除（不用对方同意）。搭子不是契约，一方想退出就退出。
 *   记下 ended_by，将来要展示"由对方解除"时用得上。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_RELATIONS = 'buddy_relations'

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

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))
    const relationId = str(event.relation_id)
    if (!relationId) fail('缺少 relation_id', 400)

    const relRes = await db.collection(DB_RELATIONS).where({ _id: relationId }).limit(1).get()
    if (!relRes.data.length) fail('这条搭子关系不存在', 404)
    const rel = relRes.data[0]

    // 只有关系里的两方能解除，别人连这条记录的存在都不该知道
    const iAmA = rel.user_a_id === me._id
    const iAmB = rel.user_b_id === me._id
    if (!iAmA && !iAmB) fail('你不能解除别人的搭子关系', 403)

    // 幂等：已经解除过就直接告诉他，不重复写库
    if (rel.status !== 'active') {
      fail('这段搭子关系已经解除了', 400)
    }

    const now = Date.now()
    await db.collection(DB_RELATIONS).doc(relationId).update({
      status: 'ended',
      ended_by: me._id,
      ended_at: now,
      update_time: now
    })

    return {
      code: 0,
      msg: 'ok',
      data: {
        relation_id: relationId,
        ended_at: now
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '解除失败' }
  }
}
