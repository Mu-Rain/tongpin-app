'use strict'

/**
 * 改搭子标签 —— pages/buddy/buddy.vue 的"改标签"弹层用
 *
 * 入参：{ token, relation_id, label, color }
 * 出参：{ code, msg, data: { relation_id, label, label_color, display } }
 *
 * label 是**前缀**（"考研"），不是完整标签（"考研搭子"）。
 * "搭子"两个字固定，由前端拼在 label 后面显示。
 *
 * ★ 只能改"我给对方起的"，不能改"对方给我起的"。
 *   关系表里 a/b 两侧各存一份 label，正是因为两个人各叫各的：
 *   A 叫 B「考研搭子」，B 叫 A「饭搭子」，互不影响。
 *
 * ★ 颜色只允许 8 个预设值。不开放任意 hex，理由：
 *   用户随手填个 #FFFFFF 白底标签在白卡片上就消失了，配色失控。
 *   预设色都在原型里调过对比度。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_RELATIONS = 'buddy_relations'

/** 前缀长度上限：完整标签上限 8 字，"搭子"占 2 字，所以前缀最多 6 字 */
const MAX_LABEL_LEN = 6

/** 8 个预设闪亮色（与原型 app.js TAG_COLORS 一致，与 chat.vue TAG_COLORS 一致） */
const COLORS = [
  'shine-yellow',
  'shine-orange',
  'shine-rose',
  'shine-violet',
  'shine-cyan',
  'shine-mint',
  'shine-blue',
  'shine-gold'
]

/** 固定后缀，仅用于返回给前端的 display 字段，不入库 */
const SUFFIX = '搭子'

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

    // 标签允许清空（清空 = 不显示标签），但传了就校验
    const rawLabel = str(event.label)
    const color = str(event.color) || COLORS[0]

    if (COLORS.indexOf(color) < 0) fail('颜色不在可选范围内', 400)

    let label = rawLabel
    if (label) {
      // 用户可能直接输入"考研搭子"，把后缀给他剥掉，避免出现"考研搭子搭子"
      if (label.length > 2 && label.slice(-2) === SUFFIX) {
        label = label.slice(0, -2).trim()
      }
      if (label.length > MAX_LABEL_LEN) {
        fail('标签最多 ' + MAX_LABEL_LEN + ' 个字（加上「搭子」共 8 字）', 400)
      }
      // 防注入：标签会显示在卡片上，不允许控制字符和换行
      if (/[\r\n\t]/.test(label)) fail('标签不能包含换行', 400)
    }

    // —— 校验关系存在且我在这段关系里 ——
    const relRes = await db.collection(DB_RELATIONS).where({ _id: relationId }).limit(1).get()
    if (!relRes.data.length) fail('这条搭子关系不存在', 404)
    const rel = relRes.data[0]

    const iAmA = rel.user_a_id === me._id
    const iAmB = rel.user_b_id === me._id
    if (!iAmA && !iAmB) fail('你不能修改别人的搭子标签', 403)

    if (rel.status !== 'active') {
      fail('这段搭子关系已解除，不能再改标签', 400)
    }

    // —— 只写我这一侧 ——
    const patch = {}
    if (iAmA) {
      patch.label_a = label
      patch.label_a_color = label ? color : ''
    } else {
      patch.label_b = label
      patch.label_b_color = label ? color : ''
    }
    patch.update_time = Date.now()

    await db.collection(DB_RELATIONS).doc(relationId).update(patch)

    return {
      code: 0,
      msg: 'ok',
      data: {
        relation_id: relationId,
        label: label,
        label_color: label ? color : '',
        // 前端拿这个直接显示，不用自己拼
        display: label ? label + SUFFIX : ''
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '保存失败' }
  }
}
