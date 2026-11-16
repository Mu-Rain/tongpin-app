'use strict'

/**
 * 约局确认 / 婉拒 —— 推进 meetups 的状态机
 *
 * 入参：{ token, message_id, action: 'accept' | 'decline' | 'checkin' | 'status', lat?, lng?, acc? }
 * 出参：{ code, msg, data: { status, both } }
 *   status ∈ pending | one_confirmed | both_confirmed | declined
 *   both = status === 'both_confirmed'（前端拿来弹一句「约成了」）
 *
 * 状态机（30 文档 §P0-3）：
 *   pending → one_confirmed → both_confirmed
 *            ↘ declined（任一方婉拒即终止）
 *
 * 三个容易踩的点：
 *   1. 幂等：同一个人重复点「确认」不报错、不重复推进 —— 客户端重试是常态。
 *   2. 兜底建记录：前端也可能直接 message-send 发一张 structured 卡片（P0-2 允许），
 *      那种情况下没有 meetups 行，这里按消息内容补建，否则卡片永远点不动。
 *   3. 第三方不许操作：只有 invitee/inviter 两个人才有确认权。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_MEMBERS = 'conversation_members'
const DB_MESSAGES = 'messages'
const DB_MEETUPS = 'meetups'
const DB_EVENTS = 'credit_events'
const DB_RULES = 'credit_rules'

/** 签到只在约定时间前后这个窗口内有效（毫秒）。约的是周六 19:00，
    周一跑来点一下也算到场，那签到就失去意义了。 */
const CHECKIN_WINDOW_MS = 2 * 60 * 60 * 1000

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// ===================== credit 核心（第 8 份副本）=====================
// 与 credit-list 母本同构。分数只从这一份新规则来；旧的 buddy_done / verify_pass
// 已停用为 0，所以这里不会因为「完成一次搭子」而加分。
const DEFAULT_RULES = [
  { code: 'buddy_done', delta: 0, text: '完成一次搭子（已停用）' },
  { code: 'buddy_like', delta: 0.1, text: '搭子互赞' },
  { code: 'meetup_checkin', delta: 0.1, text: '搭子双方完成赴约' },
  { code: 'quiz_pass', delta: 1.5, text: '学完《文明搭档守则》' },
  { code: 'rule_first', delta: 5, text: '首次学习《文明搭档守则》' },
  { code: 'no_show', delta: -1, text: '爽约被核实' },
  { code: 'report_upheld', delta: -3, text: '被举报且核实' },
  { code: 'misconduct', delta: -12, text: '不当行为被核实' },
  { code: 'verify_pass', delta: 0, text: '通过学生认证（已停用）' },
  { code: 'admin_adjust', delta: 0, text: '管理员调整' }
]

const RULE_CHECKIN = 'meetup_checkin'
const CREDIT_MAX = 100
const CREDIT_MIN = 0

function clampScore(n) {
  return Math.round(Math.max(CREDIT_MIN, Math.min(CREDIT_MAX, n)) * 10) / 10
}

function defaultRule(code) {
  for (let i = 0; i < DEFAULT_RULES.length; i++) {
    if (DEFAULT_RULES[i].code === code) return DEFAULT_RULES[i]
  }
  return { code: code, delta: 0, text: code }
}

function readScore(u) {
  if (!u) return 90
  if (typeof u.credit_score === 'number') return clampScore(u.credit_score)
  if (typeof u.credit === 'number') return clampScore(u.credit)
  return 90
}

/** credit_rules 里的覆盖值优先（后台可以调分值）；表不存在就静默回落内置表 */
async function resolveRule(code) {
  try {
    const r = await db.collection(DB_RULES).where({ code: code, active: true }).limit(1).get()
    const row = r.data && r.data[0]
    if (row && typeof row.delta === 'number') {
      return { code: code, delta: row.delta, text: str(row.text) || defaultRule(code).text }
    }
  } catch (e) {
    /* 表没建过：用内置默认值 */
  }
  return defaultRule(code)
}

/** 这一局是否已经给某人发过赴约分（ref_id = meetup_id），防止反复签到刷分 */
async function hasCheckinEvent(userId, meetupId) {
  try {
    const r = await db
      .collection(DB_EVENTS)
      .where({ user_id: userId, reason_code: RULE_CHECKIN, ref_id: meetupId })
      .limit(1)
      .get()
    return !!(r.data && r.data.length)
  } catch (e) {
    return false
  }
}

async function applyCredit(userId, reasonCode, refId) {
  if (!userId) return { score: 0, delta: 0 }
  const rule = await resolveRule(reasonCode)
  const uRes = await db
    .collection(DB_USERS)
    .where({ _id: userId })
    .limit(1)
    .get()
  const before = readScore(uRes.data && uRes.data[0])
  if (!rule.delta) return { score: before, delta: 0 }
  const after = clampScore(before + rule.delta)
  await db.collection(DB_EVENTS).add({
    user_id: userId,
    reason_code: rule.code,
    reason_text: rule.text,
    delta: rule.delta,
    score_before: before,
    score_after: after,
    ref_id: str(refId),
    created_at: Date.now()
  })
  await db
    .collection(DB_USERS)
    .doc(userId)
    .update({ credit_score: after, credit: after })
  return { score: after, delta: rule.delta }
}

/** 双方都签到了 → 各加一次赴约分。只在「这一局从没给过」时才发。 */
async function awardCheckin(meetup) {
  const ids = [str(meetup.inviter_id), str(meetup.invitee_id)]
  const out = []
  for (let i = 0; i < ids.length; i++) {
    const uid = ids[i]
    if (!uid) continue
    try {
      if (await hasCheckinEvent(uid, str(meetup._id))) {
        out.push({ user_id: uid, delta: 0, skipped: true })
        continue
      }
      const r = await applyCredit(uid, RULE_CHECKIN, str(meetup._id))
      out.push({ user_id: uid, delta: r.delta })
    } catch (e) {
      // 加分失败不能把签到结果一起回滚：位置已经记下了，分可以补
      out.push({ user_id: uid, delta: 0, error: true })
    }
  }
  return out
}
// ===================== credit 核心结束 =====================

/** 签到判定半径（米）。10 米在室内根本做不到（GPS 误差常见 20~50 米），
    所以按 50 米判，并把手机自己上报的精度一并算进容差。 */
const RADIUS_M = 50

/** 精度容差上限：再差的位置也只放宽 100 米 —— 否则伪造一个巨大的 acc 就等于远程签到。 */
const ACC_MAX = 100

function numOr(v, dft) {
  const n = Number(v)
  return isFinite(n) ? n : dft
}

/** 两点球面距离（米）。几百米量级用 haversine 足够。 */
function meters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** 只认有范围的真实坐标，缺一个就当作没传 */
function pickCoord(event) {
  const lat = numOr(event.lat, NaN)
  const lng = numOr(event.lng, NaN)
  if (!isFinite(lat) || !isFinite(lng)) fail('没拿到定位，请允许定位权限后再试')
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) fail('定位数据不合法')
  return { lat: lat, lng: lng }
}

/** 给前端看的视图：只回「到没到」和距离，不回对方坐标（坐标是隐私，前端也不需要） */
function viewOf(m, meId) {
  const inviterId = str(m.inviter_id)
  const inviteeId = str(m.invitee_id)
  const mine = meId === inviterId ? 'inviter' : meId === inviteeId ? 'invitee' : ''
  const inv = m.inviter_checkin && typeof m.inviter_checkin === 'object' ? m.inviter_checkin : null
  const ini = m.invitee_checkin && typeof m.invitee_checkin === 'object' ? m.invitee_checkin : null
  const my = mine === 'inviter' ? inv : mine === 'invitee' ? ini : null
  const peer = mine === 'inviter' ? ini : mine === 'invitee' ? inv : null
  const st = str(m.status) || 'pending'
  return {
    status: st,
    both: st === 'both_confirmed',
    arrived: !!(my && my.arrived === true),
    peer_arrived: !!(peer && peer.arrived === true),
    my_dist: my && typeof my.dist === 'number' ? my.dist : -1,
    peer_dist: peer && typeof peer.dist === 'number' ? peer.dist : -1,
    limit: RADIUS_M
  }
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  const me = r.data[0]
  if (me.status === 'banned') fail('账号已被封禁', 403)
  return me
}

/** 从卡片消息里读 meta（库里存的是 JSON 字符串），坏数据一律当空对象 */
function metaOf(m) {
  try {
    const o = JSON.parse((m && m.meta) || '{}')
    return o && typeof o === 'object' ? o : {}
  } catch (e) {
    return {}
  }
}

/** 按会话 + 消息找约局记录。集合可能还没建（首次使用时），报错当作没有。 */
async function findMeetup(conversationId, messageId) {
  try {
    const r = await db
      .collection(DB_MEETUPS)
      .where({ conversation_id: conversationId, message_id: messageId })
      .limit(1)
      .get()
    return r.data.length ? r.data[0] : null
  } catch (e) {
    return null
  }
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))

    const messageId = str(event.message_id) || str(event.messageId)
    if (!messageId) fail('缺少消息 id')

    const action = str(event.action)
    const ACTIONS = ['accept', 'decline', 'checkin', 'status']
    if (ACTIONS.indexOf(action) < 0) fail('只能确认、婉拒或签到')

    // —— 1) 定位卡片消息 ——
    const msgRes = await db.collection(DB_MESSAGES).doc(messageId).get()
    const msg = (msgRes.data && msgRes.data[0]) || null
    if (!msg) fail('这张约局卡片找不到了')
    if (str(msg.type) !== 'structured') fail('这条消息不是约局卡片')
    const conversationId = str(msg.conversation_id)

    // —— 2) 权限：必须是这个会话的成员 ——
    const memberRes = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: conversationId })
      .limit(20)
      .get()
    const meMember = memberRes.data.filter(function (m) {
      return m.user_id === me._id
    })[0]
    if (!meMember) fail('你不在这个会话里', 403)
    const other = memberRes.data.filter(function (m) {
      return m.user_id !== me._id
    })[0]

    // —— 3) 找记录，没有就补建 ——
    let meetup = await findMeetup(conversationId, messageId)
    if (!meetup) {
      const meta = metaOf(msg)
      const inviterId = str(msg.sender_id)
      const inviteeId = other ? str(other.user_id) : ''
      if (!inviteeId) fail('这个会话里没有可以约的人')
      const now = Date.now()
      const addRes = await db.collection(DB_MEETUPS).add({
        conversation_id: conversationId,
        card_id: str(meta.card_id),
        message_id: messageId,
        inviter_id: inviterId,
        invitee_id: inviteeId,
        time: str(meta.time),
        place: str(meta.place),
        note: str(meta.note),
        status: 'pending',
        inviter_confirmed: false,
        invitee_confirmed: false,
        created_at: typeof msg.created_at === 'number' ? msg.created_at : now,
        updated_at: now
      })
      meetup = {
        _id: addRes.id,
        conversation_id: conversationId,
        inviter_id: inviterId,
        invitee_id: inviteeId,
        status: 'pending',
        inviter_confirmed: false,
        invitee_confirmed: false
      }
    }

    // —— 4) 我是这局的哪一方 ——
    const isInviter = str(meetup.inviter_id) === me._id
    const isInvitee = str(meetup.invitee_id) === me._id
    if (!isInviter && !isInvitee) fail('这一局不是你发起的', 403)

    const status = str(meetup.status) || 'pending'
    const now = Date.now()

    // —— 4.5) 到达签到 / 查状态 ——
    // 签到的意义：双方都到了才算这局成立；只有一方签到，另一方事后被举报「放鸽子」时，
    // 这条记录就是后台判断的依据（谁到了、几点到、离约定点多远）。
    if (action === 'status') {
      return { code: 0, msg: 'ok', data: viewOf(meetup, me._id) }
    }

    if (action === 'checkin') {
      if (status === 'declined') fail('这一局已经婉拒了')

      // 时间窗：约的几点，就只能在那个点前后 2 小时内签到。
      // time_at 是发约局时存下的毫秒时间戳；老卡片（只有「周六 19:00」这种文本）
      // 没有它，这时不拦 —— 老数据不该被新规则卡死。
      const timeAt = Number(meetup.time_at) || 0
      if (timeAt > 0) {
        const off = Math.abs(now - timeAt)
        if (off > CHECKIN_WINDOW_MS) {
          const h = Math.round(CHECKIN_WINDOW_MS / 3600000)
          fail('不在签到时间内：约的时间前后 ' + h + ' 小时内才能签到', 403)
        }
      }
      const meField = isInviter ? 'inviter_checkin' : 'invitee_checkin'
      const peerField = isInviter ? 'invitee_checkin' : 'inviter_checkin'
      const oldMine = meetup[meField]
      if (oldMine && oldMine.arrived === true) {
        return { code: 0, msg: 'ok（你已经签到过了）', data: viewOf(meetup, me._id) }
      }

      const coord = pickCoord(event)
      const acc = Math.min(numOr(event.acc, 0), ACC_MAX)

      // 参照点优先用发约局时选的定位点；没有就拿对方已签到的位置比；
      // 两者都没有就判不了 —— 这种情况不扣任何人分，只让用户等对方先到。
      let refLat = NaN
      let refLng = NaN
      let via = ''
      if (isFinite(numOr(meetup.place_lat, NaN)) && isFinite(numOr(meetup.place_lng, NaN))) {
        refLat = Number(meetup.place_lat)
        refLng = Number(meetup.place_lng)
        via = 'place'
      } else {
        const peerRec = meetup[peerField]
        if (peerRec && isFinite(numOr(peerRec.lat, NaN)) && isFinite(numOr(peerRec.lng, NaN))) {
          refLat = Number(peerRec.lat)
          refLng = Number(peerRec.lng)
          via = 'peer'
        }
      }

      const rec = {
        arrived: false,
        at: now,
        lat: coord.lat,
        lng: coord.lng,
        acc: acc,
        dist: -1,
        via: via
      }
      if (via) {
        const d = meters(coord.lat, coord.lng, refLat, refLng)
        rec.dist = Math.round(d)
        rec.arrived = d <= RADIUS_M + acc
      }

      const patch2 = {}
      patch2[meField] = rec
      patch2.updated_at = now
      await db.collection(DB_MEETUPS).doc(meetup._id).update(patch2)

      const merged = Object.assign({}, meetup, patch2)
      const view = viewOf(merged, me._id)

      // 两边都到齐了才给分：一个人到场不算赴约。分数按人各发一次，
      // ref_id 记这一局，所以反复签到也不会重复加。
      const invOk = !!(merged.inviter_checkin && merged.inviter_checkin.arrived)
      const iniOk = !!(merged.invitee_checkin && merged.invitee_checkin.arrived)
      if (invOk && iniOk) {
        view.reward = await awardCheckin(merged)
      }

      return { code: 0, msg: rec.arrived ? 'ok' : 'not_yet', data: view }
    }

    // —— 5) 幂等：同一个人重复操作直接回当前状态，不重复推进 ——
    if (action === 'accept' && (isInviter ? meetup.inviter_confirmed === true : meetup.invitee_confirmed === true)) {
      return {
        code: 0,
        msg: 'ok（你已经确认过了）',
        data: viewOf(meetup, me._id)
      }
    }
    if (action === 'decline' && status === 'declined') {
      return { code: 0, msg: 'ok（已经婉拒过了）', data: viewOf(meetup, me._id) }
    }

    // —— 6) 推进状态 ——
    let nextStatus = status
    const patch = { updated_at: now }

    if (action === 'decline') {
      // 双方都确认了再婉拒：语义上是「反悔」，这不是本接口能处理的（要不要退掉已定的场地？）
      if (status === 'both_confirmed') fail('双方都确认了，改主意得在聊天里说一声')
      nextStatus = 'declined'
      patch.status = nextStatus
      patch.declined_by = me._id
    } else {
      // 任一方一旦婉拒，这局就结束了，后面再点确认不复活
      if (status === 'declined') fail('这一局已经婉拒了')
      const inviterConfirmed = isInviter ? true : meetup.inviter_confirmed === true
      const inviteeConfirmed = isInvitee ? true : meetup.invitee_confirmed === true
      patch.inviter_confirmed = inviterConfirmed
      patch.invitee_confirmed = inviteeConfirmed
      nextStatus = inviterConfirmed && inviteeConfirmed ? 'both_confirmed' : 'one_confirmed'
      patch.status = nextStatus
      if (nextStatus === 'both_confirmed' && !meetup.both_confirmed_at) {
        patch.both_confirmed_at = now
      }
    }

    await db.collection(DB_MEETUPS).doc(meetup._id).update(patch)

    return {
      code: 0,
      msg: 'ok',
      data: viewOf(Object.assign({}, meetup, patch, { status: nextStatus }), me._id)
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '操作失败' }
  }
}
