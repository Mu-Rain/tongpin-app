'use strict'

/**
 * 解除好友 —— 好友页 / 对方主页的"解除好友"用
 *
 * 入参：{ token, friend_user_id }
 * 出参：{ code, msg, data: { friend_user_id } }
 *
 * ★ friendships 表**没有 status 字段**，设计如此：是好友就有一行，不是好友就没有。
 *   所以"解除"= 删掉那一行，不是把某个字段改成 ended。
 *   （对照 buddy_relations 才是有 status 的：搭子关系可结束、可重开，
 *     好友是二元的，删了就是删了。）
 *
 * ★ 只删好友关系，**不动 friend_requests 的历史**：
 *   谁什么时候加过谁，是行为记录，不是关系状态；将来要查"你们怎么认识的"
 *   或者做风控（频繁加好友又删）还得靠它。
 *
 * ★ 也不动会话和消息：解除好友不等于拉黑，聊天记录留着，
 *   只是消息页那一行不再显示"好友"徽标（message-conversations 现查 friendships）。
 *
 * ★ friendships 约定 user_a_id < user_b_id（字符串比较），
 *   否则同一对会存出两条镜像，好友列表就出现两个同一个人。
 *   这里用与 friend-request 第 65 行 orderPair 完全相同的语义。
 *
 * ★ 删完之后补一条 friend_unlinks 记录：friendships 行没了，「这对人当过好友」
 *   就再没有痕迹，is_friend:false 无法区分「从来不是好友的搭子」和「当过好友又
 *   解除的」。新集合只补这一层判断（三态 friend / unfriended / none），
 *   既有集合一行不动，判错删掉 friend_unlinks 即可回滚。
 *   一对人一行，user_a_id < user_b_id 沿用上面的约定；重复解除只刷新
 *   removed_at / removed_by，不会堆出第二行。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_FRIENDS = 'friendships'
const DB_UNLINKS = 'friend_unlinks'

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

/** 两个人的固定键：字符串小的在前。与 friend-request 的 orderPair 同语义 */
function orderPair(x, y) {
  return x < y ? [x, y] : [y, x]
}

/**
 * 写一条「解除过好友」记录（一对人一行，重复解除只刷新时间和操作者）
 * ★ 与 user-block 里同名函数同语义。
 *   改成「读全部行、保留最早一行、删掉多出来的」：唯一索引可能还没建
 *   （见 08-database-indexes，索引标为可选兜底），缺索引时并发解除会插出重复行，
 *   这里顺手收敛成一行，正确性不依赖索引是否存在。
 */
async function saveUnlink(ua, ub, byId) {
  const cond = { user_a_id: ua, user_b_id: ub }
  const now = Date.now()
  const found = await db.collection(DB_UNLINKS).where(cond).get()
  const rows = (found.data || []).slice()
  if (!rows.length) {
    await db.collection(DB_UNLINKS).add({
      user_a_id: ua,
      user_b_id: ub,
      removed_at: now,
      removed_by: byId
    })
    return
  }
  rows.sort((x, y) => (x.removed_at || 0) - (y.removed_at || 0))
  const keep = rows[0]
  await db
    .collection(DB_UNLINKS)
    .doc(keep._id)
    .update({ removed_at: now, removed_by: byId })
  for (let i = 1; i < rows.length; i++) {
    await db.collection(DB_UNLINKS).doc(rows[i]._id).remove()
  }
}

exports.main = async (event) => {
  try {
    event = event || {}
    const me = await getUserByToken(str(event.token))

    const otherId = str(event.friend_user_id)
    if (!otherId) fail('缺少 friend_user_id', 400)

    const pair = orderPair(me._id, otherId)
    const ua = pair[0]
    const ub = pair[1]
    const cond = { user_a_id: ua, user_b_id: ub }

    // 先确认真的是好友再删：直接 remove 的话，对陌生人调用也会返回 ok，
    // 前端会以为"解除成功"，其实是两个人从来就不是好友。
    const found = await db.collection(DB_FRIENDS).where(cond).limit(1).get()
    if (!found.data.length) fail('你们还不是好友', 400)

    await db.collection(DB_FRIENDS).where(cond).remove()

    // 删除已经生效，再补历史：写在**独立 try/catch** 里 —— friend_unlinks 是新集合，
    // 它写失败不能让「解除好友」这个用户真正点了的动作回头报错。
    try {
      await saveUnlink(ua, ub, me._id)
    } catch (e) {
      /* friend_unlinks 表不存在 / 写失败：解除好友本身已经成功 */
    }

    return { code: 0, msg: 'ok', data: { friend_user_id: otherId } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '解除失败' }
  }
}
