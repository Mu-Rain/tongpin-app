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

const DB_REPORTS = 'reports'

// 举报对象类型白名单。本期只实际用到 user / message，另两个是契约预留。
const TARGET_TYPES = ['user', 'card', 'message', 'material']
// 举报原因白名单。前端单选项的四个 key，不能加中文 —— 中文只在前端显示。
const REASONS = ['harassment', 'fake', 'ad', 'other']
// 补充说明上限 200 字（按码点数，见文件头）
const DETAIL_MAX = 200

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
    if (REASONS.indexOf(reason) < 0) fail('请选择举报原因', 400)
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
    const addRes = await db.collection(DB_REPORTS).add({
      reporter_id: me._id,
      target_type: targetType,
      target_id: targetId,
      reason: reason,
      detail: detail,
      status: 'pending',
      handled_by: '',
      handled_at: 0,
      created_at: now
    })

    return { code: 0, msg: 'ok', data: { report_id: addRes.id, created_at: now } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '举报失败' }
  }
}
