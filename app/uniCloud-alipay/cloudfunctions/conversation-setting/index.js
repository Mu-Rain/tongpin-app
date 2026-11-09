'use strict'

/**
 * 会话设置（置顶 / 免打扰）—— 消息页长按会话 → ActionSheet
 *
 * 入参：{ token, conversation_id, action: 'pin' | 'unpin' | 'mute' | 'unmute' }
 * 出参：{ code, msg, data: { conversation_id, pinned, muted, pin_locked } }
 * 错误码：403「你不在这个会话里」
 *
 * ★ 为什么 pinned / muted 存在 conversation_members 而不是 conversations：
 *   两个人都看同一个会话行，但「我要不要置顶」「我要不要免打扰」是各人各一份
 *   的私有偏好。放在 conversations 上，我置顶就等于给对方也置顶了。
 *   所以和 user_remarks 一样：一对人共享的文档装不下两份不同的私有状态。
 *
 * ★ pin_locked 是**推导值，不落库**：
 *   它等于「我和对方之间有没有 status === 'active' 的 buddy_relations」。
 *   落库会立刻不一致 —— 搭子关系随时会被 friend-request 的 accept 收成 ended
 *   （成为好友即收掉搭子），那一刻所有会话行的 pin_locked 都得跟着改，
 *   漏一个就是「明明不是搭子了还锁着置顶」。每次现算，永远对。
 *
 * ★ unpin 在 pin_locked 时不报错，只回 pinned:true：
 *   产品决定 D3 —— 搭子会话强制置顶且不可取消（用户原话「不能调成不置顶」）。
 *   报错会让前端弹一个「失败」的 toast，用户以为坏了；
 *   返回真实状态 + pin_locked，前端据此提示「有搭子关系的会话会一直置顶」，
 *   这是解释而不是报错。同时**存库也写 true**，
 *   否则库里躺着一个 pinned:false，前端某处没看 pin_locked 就会漏排。
 *
 * ★ 老数据没有这两个字段：读的时候按 typeof x === 'boolean' ? x : false 处理，
 *   不要写 !== false —— undefined !== false 是 true，会把老会话全当成已置顶。
 */

const db = uniCloud.database()

const DB_MEMBERS = 'conversation_members'
const DB_RELATIONS = 'buddy_relations'

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/** 老数据没有这个字段时一律当 false，不要用 !== false（见文件头） */
function pickBool(v) {
  return typeof v === 'boolean' ? v : false
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection('uni-id-users').where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

/**
 * 我和对方之间有没有 active 的搭子关系。
 *
 * ★ 两批查（我是 a 的 / 我是 b 的）而不是用 or：与 message-conversations
 *   第 141-151 行写法保持一致，条件写错时一眼能看出来。
 *
 * ★ 整段 try/catch：关系表挂了不能让「置顶」这个动作失败 ——
 *   降级成「没锁」即可，用户最多多出一次本不该出现的「取消置顶」按钮，
 *   比整个设置面板报错好得多。
 */
async function hasActiveBuddy(meId, otherId) {
  if (!otherId) return false
  try {
    const rAsA = await db
      .collection(DB_RELATIONS)
      .where({ user_a_id: meId, user_b_id: otherId, status: 'active' })
      .limit(1)
      .get()
    if (rAsA.data && rAsA.data.length) return true
    const rAsB = await db
      .collection(DB_RELATIONS)
      .where({ user_a_id: otherId, user_b_id: meId, status: 'active' })
      .limit(1)
      .get()
    return !!(rAsB.data && rAsB.data.length)
  } catch (e) {
    return false
  }
}

exports.main = async (event) => {
  try {
    event = event || {}
    const action = str(event.action)
    const me = await getUserByToken(str(event.token))

    const conversationId = str(event.conversation_id)
    if (!conversationId) fail('缺少 conversation_id', 400)

    const wantPin = action === 'pin'
    const wantUnpin = action === 'unpin'
    const wantMute = action === 'mute'
    const wantUnmute = action === 'unmute'
    if (!wantPin && !wantUnpin && !wantMute && !wantUnmute) {
      fail('不认识的动作：' + (action || '(空)'), 400)
    }

    // —— 1) 必须是我的成员行 ——
    // 置顶/免打扰是每人一份，条件必须带 user_id: me._id，
    // 否则会改到对方那一行（对方莫名其妙被置顶/被免打扰）。
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId, user_id: me._id })
      .limit(1)
      .get()
    if (!memberRes.data.length) fail('你不在这个会话里', 403)
    const myMember = memberRes.data[0]

    // —— 2) 找出会话里的另一个人（direct 会话就一个）——
    let otherId = ''
    try {
      const allRes = await db
        .collection(DB_MEMBERS)
        .where({ conversation_id: conversationId })
        .limit(10)
        .get()
      for (const m of allRes.data || []) {
        const uid = str(m.user_id)
        if (uid && uid !== me._id) {
          otherId = uid
          break
        }
      }
    } catch (e) {
      /* 成员表查不到：otherId 留空 → pin_locked 判 false */
    }

    // —— 3) 算 pin_locked（不落库，见文件头）——
    const pinLocked = await hasActiveBuddy(me._id, otherId)

    // —— 4) 算最终状态 ——
    let pinned = pickBool(myMember.pinned)
    let muted = pickBool(myMember.muted)

    if (wantPin) pinned = true
    if (wantUnpin) pinned = false
    if (wantMute) muted = true
    if (wantUnmute) muted = false

    // ★ D3：搭子会话强制置顶。unpin 不报错，但状态仍为 true，
    //   存库也写 true（见文件头「存库也写 true」的理由）。
    if (pinLocked) pinned = true

    // —— 5) 落库 ——
    // 只写这两个字段，不整行覆盖：这一行上还有 unread_count /
    // last_read_message_id / cleared_at，整行 update 会把它们冲掉。
    await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId, user_id: me._id })
      .update({ pinned: pinned, muted: muted, updated_at: Date.now() })

    return {
      code: 0,
      msg: 'ok',
      data: {
        conversation_id: conversationId,
        pinned: pinned,
        muted: muted,
        pin_locked: pinLocked
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '设置失败' }
  }
}
