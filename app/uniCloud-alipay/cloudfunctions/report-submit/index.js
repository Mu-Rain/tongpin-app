'use strict'

/**
 * 提交举报 —— 用户主页「举报」/ 聊天页长按消息「举报」/ pages/report/report.vue
 *
 * 入参：{ token, target_type, target_id, reason, detail? }
 *   target_type ∈ user / card / message / material
 *   reason      ∈ harassment / fake / ad / other
 *   detail      补充说明，≤200 字，可空
 * 出参：{ code, msg, data: { report_id, created_at } }
 *
 * 错误码（全部 400，前端按 res.msg toast）：
 *   「不支持的举报类型」 / 「请选择举报原因」 / 「不能举报自己」
 *   「补充说明最多 200 字」 / 「你已经举报过了，我们会尽快处理」
 *
 * ★ 为什么 target_type 只做白名单而不校验「被举报对象是否存在」：
 *   举报是**事后**动作，对象随时可能被删/被撤回（撤回不清 content，
 *   但卡片可能下架）。这时候还要求对象存在，用户就永远举报不了，
 *   而运营恰恰最需要看到「我要举报一个已经消失的东西」。
 *   所以只挡非法类型，不挡不存在的 id。
 *
 * ★ 为什么写库前先查一次唯一键，而不是靠索引报错：
 *   (reporter_id, target_type, target_id) 的唯一索引线上还没建
 *   （见 docs/08-database-indexes.md），靠它兜底等于没兜底 ——
 *   索引缺失时同一个人能举报 100 次，运营后台被同一条刷屏。
 *   所以显式 get 一次再决定插不插；索引建好之后这里是双保险，
 *   两处都在不冲突（查到旧行就直接返回提示，根本走不到 add）。
 *
 * ★ 为什么长度按 Array.from().length 数：
 *   一个 emoji 在 String.length 里是 2（代理对），按 length 算会把
 *   「200 字」变成「100 个表情」，用户填到一半就被拦。
 *   与 user-remark 第 57 行 charLen 完全同一个语义。
 *
 * ★ 为什么「不能举报自己」只对 target_type === 'user' 判：
 *   举报消息/卡片的 target_id 是 message._id / card._id，本来就不可能
 *   等于我的 user id。无条件比对会在 id 恰好相同时误伤。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_REPORTS = 'reports'

// 举报对象类型白名单。本期只实际用到 user / message，另两个是契约预留。
const TARGET_TYPES = ['user', 'card', 'message', 'material']
// 举报原因白名单。前端单选项的 key，不能加中文 —— 中文只在前端显示。
// no_show / misconduct 是线下场景（被鸽、不当行为），由人工处置给分；
// 其余走内容筛查（report-screen）定级。
const REASONS = ['harassment', 'sexual', 'gambling', 'fraud', 'no_show', 'misconduct', 'other']
// 老客户端还在传 fake / ad，映射到 fraud —— 不能让旧版本的举报直接失败
const LEGACY_REASONS = { fake: 'fraud', ad: 'fraud' }
// 补充说明上限 200 字（按码点数，见文件头）
const DETAIL_MAX = 200
// 证据快照：最多 20 条、每条 300 字。再多对判定没帮助，只会撑大文档。
const EVIDENCE_MAX = 20
const EVIDENCE_CHARS = 300

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function charLen(s) {
  return Array.from(s).length
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection('uni-id-users').where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

/**
 * 举报证据快照。
 *
 * 为什么要在提交时存一份：被举报的消息可能被撤回、被删除，卡片可能下架。
 * 等到管理员点处置再回查，看到的往往已经是空的 —— 那就永远判不了。
 *
 * 只对 message 取证（聊天记录是唯一有上下文可看的类型）；user / card 留空数组，
 * 由人工看主页判断。条数与单条长度都与 report-screen 的上限一致。
 */
async function collectEvidence(targetType, targetId) {
  if (targetType !== 'message') return []
  let msg = null
  try {
    const r = await db.collection('messages').where({ _id: targetId }).limit(1).get()
    msg = r.data && r.data[0]
  } catch (e) {
    return []
  }
  if (!msg) return []
  let list = [msg]
  try {
    const around = await db
      .collection('messages')
      .where({ conversation_id: msg.conversation_id })
      .orderBy('created_at', 'desc')
      .limit(EVIDENCE_MAX)
      .get()
    if (around.data && around.data.length) list = around.data
  } catch (e) {
    list = [msg]
  }
  return list
    .slice(0, EVIDENCE_MAX)
    .reverse()
    .map(function (m) {
      const c = typeof m.content === 'string' ? m.content : ''
      return { who: typeof m.sender_id === 'string' ? m.sender_id : '', content: c.slice(0, EVIDENCE_CHARS) }
    })
}

/**
 * 被鸽（no_show）不能只靠一句"他没来"：约局记录里有双方签到时间与距离。
 * 这里把最近一局的状态拍下来存进举报里 —— 消息可能被删，签到记录不会。
 *
 * 这一查同时是「当事人限制」：只认「我和被举报人」之间的那一局。
 * 没约过就没有记录，举报直接被拒 —— 被鸽的处罚只对真约过的人成立，
 * 否则任何人对任何人都能用这个理由扣 1 分。
 */
async function findMeetupBetween(meId, otherId) {
  try {
    const r = await db
      .collection('meetups')
      .where(
        dbCmd.or([
          { inviter_id: meId, invitee_id: otherId },
          { inviter_id: otherId, invitee_id: meId }
        ])
      )
      .orderBy('created_at', 'desc')
      .limit(1)
      .get()
    const m = r.data && r.data[0]
    if (!m) return null
    return {
      meetup_id: str(m._id),
      time: str(m.time),
      place: str(m.place),
      time_at: Number(m.time_at) || 0,
      status: str(m.status),
      inviter_id: str(m.inviter_id),
      invitee_id: str(m.invitee_id),
      inviter_checkin: m.inviter_checkin || null,
      invitee_checkin: m.invitee_checkin || null
    }
  } catch (e) {
    return null
  }
}

/**
 * 举报成立时该扣谁的分。
 *
 * 为什么要现在就记下来：被举报的消息可能被撤回、卡片可能下架，
 * 等到处置时再顺着 target_id 找发送者，很可能已经找不到了。
 * 记一次 offender_id，处置时直接用，判责对象不会因为内容消失而丢失。
 *
 * user → 本人；message → 发送者；card → 卡片主人；material → 暂不追溯到人。
 */
async function resolveOffender(targetType, targetId) {
  if (targetType === 'user') return targetId
  try {
    if (targetType === 'message') {
      const r = await db.collection('messages').where({ _id: targetId }).limit(1).get()
      const m = r.data && r.data[0]
      return m ? str(m.sender_id) : ''
    }
    if (targetType === 'card') {
      const r = await db.collection('cards').where({ _id: targetId }).limit(1).get()
      const c = r.data && r.data[0]
      return c ? str(c.owner_id) : ''
    }
  } catch (e) {
    return ''
  }
  return ''
}

exports.main = async (event) => {
  try {
    event = event || {}
    const me = await getUserByToken(str(event.token))

    const targetType = str(event.target_type)
    const targetId = str(event.target_id)
    const reason = str(event.reason)
    const detail = str(event.detail)

    // —— 1) 入参校验（顺序：类型 → id → 原因 → 长度）——
    // 顺序有意义：先挡类型，前端传错类型时给出的是最有信息量的那条错误。
    if (TARGET_TYPES.indexOf(targetType) < 0) fail('不支持的举报类型', 400)
    if (!targetId) fail('缺少 target_id', 400)
    const mappedReason = LEGACY_REASONS[reason] || reason
    if (REASONS.indexOf(mappedReason) < 0) fail('请选择举报原因', 400)
    if (charLen(detail) > DETAIL_MAX) fail('补充说明最多 ' + DETAIL_MAX + ' 字', 400)
    if (targetType === 'user' && targetId === me._id) fail('不能举报自己', 400)

    // —— 2) 重复举报：写库前先查唯一键 ——
    // 整段 try/catch：reports 表还没建时查询会报错，
    // 第一次举报必须能成功（add 会自动建表），不能在这里先挂掉。
    let dupRows = []
    try {
      const dup = await db
        .collection(DB_REPORTS)
        .where({ reporter_id: me._id, target_type: targetType, target_id: targetId })
        .limit(1)
        .get()
      dupRows = dup.data || []
    } catch (e) {
      dupRows = []
    }
    if (dupRows.length) fail('你已经举报过了，我们会尽快处理', 400)

    // —— 3) 写库 ——
    // status / handled_by / handled_at 三个处理态字段这里就写全：
    // 运营后台按 status === 'pending' 拉待办，缺字段的文档永远不会出现。
    const now = Date.now()
    const evidence = await collectEvidence(targetType, targetId)
    const offenderId = await resolveOffender(targetType, targetId)
    // 只有「被鸽」才需要约局签到记录，别的理由白查一次库
    let meetup = null
    if (mappedReason === 'no_show') {
      if (!offenderId) {
        fail('找不到这条举报对应的责任人，「放鸽子」要对着约过的那个人报', 400)
      }
      if (offenderId === me._id) fail('不能举报自己', 400)
      meetup = await findMeetupBetween(me._id, offenderId)
      if (!meetup) {
        fail('你们之间没有约局记录，「放鸽子」只对真约过的人成立', 400)
      }
    }
    const addRes = await db.collection(DB_REPORTS).add({
      reporter_id: me._id,
      target_type: targetType,
      target_id: targetId,
      reason: mappedReason,
      detail: detail,
      evidence: evidence,
      offender_id: offenderId,
      meetup: meetup,
      status: 'pending',
      handled_by: '',
      handled_at: 0,
      created_at: now
    })

    const reportId = addRes.id
    // 送去做内容筛查：刻意不 await —— 举报落库就算成功，筛查慢不拖累用户点击，
    // 筛查挂了也不该让举报失败（后台打开时还能看到「未筛查」并补跑）。
    try {
      const job = uniCloud.callFunction({ name: 'report-screen', data: { report_id: reportId } })
      if (job && typeof job.catch === 'function') job.catch(function () {})
    } catch (e) {
      console.warn('[report-submit] screen skipped', e && e.message)
    }

    return { code: 0, msg: 'ok', data: { report_id: reportId, created_at: now } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '举报失败' }
  }
}
