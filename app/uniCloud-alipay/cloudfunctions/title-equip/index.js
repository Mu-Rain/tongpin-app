'use strict'

/**
 * 佩戴 / 摘下称号 —— pages/title/title 用（契约 §3.2）
 *
 * 入参：{ token, code }   code === '' 表示摘掉当前佩戴
 * 出参：{ code, msg, data: { equipped: { code, name } | null } }
 *
 * ★ 顺序：先把这个用户所有 is_equipped:true 置 false，再把目标那条置 true。
 *   反过来的话中间那一瞬会有两条「佩戴中」，前端连着读两次就会看到称号来回跳。
 *
 * ★ 佩戴状态有两处冗余，必须同写：user_titles.is_equipped 是称号墙的高亮，
 *   uni-id-users.current_title_id 是资料卡/对方主页唯一读得到的地方（user-profile 只查用户表）。
 *   只改一边就会出现「墙上说戴着、资料卡上没有」。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_TITLES = 'titles'
const DB_USER_TITLES = 'user_titles'

// 与 title-list 那份是同一内容：云函数目录自包含，不许 require 目录外的东西，只能各存一份
// 与 title-list 的 DEFAULT_TITLES 同源：titles 表里没有这条时靠它把 code 翻成名字。
// ★ 加称号时三处一起改：title-list（定义+条件）、title-equip、user-profile（名字兜底）。
const TITLE_NAMES = {
  profile_complete: '资料完整',
  verify_pass: '学生已认证',
  first_buddy: '第一次搭成',
  tag_3: '标签新手',
  tag_8: 'コレクター',
  tag_10: 'DECATHLON',
  card_1: '首发选手',
  card_5: '大厅常客',
  card_10: 'HEADLINER',
  friend_1: 'はじまり',
  friend_5: 'SQUAD',
  post_1: '第一次冒泡',
  post_10: 'CHATTERBOX',
  credit_110: '信誉良好',
  credit_130: 'GOLD STANDARD',
  buddy_3: '搭子收割机',
  buddy_10: 'LEGEND'
}

function pickInt(v, dft) {
  return typeof v === 'number' ? v : dft
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

// 契约 §5.4：拿不到当前用户必须 500
async function getUserByToken(token) {
  if (!token) fail('未登录，请重新登录', 500)
  let r = null
  try {
    r = await db.collection(DB_USERS).where({ token: token }).limit(1).get()
  } catch (e) {
    fail('登录状态读取失败，请稍后重试', 500)
  }
  if (!r.data || !r.data.length) fail('登录已过期，请重新登录', 500)
  return r.data[0]
}

/** 把该用户所有佩戴位清掉；返回清掉的条数，调用方只关心是否抛错 */
async function clearEquipped(userId) {
  const res = await db
    .collection(DB_USER_TITLES)
    .where({ user_id: userId, is_equipped: true })
    .update({ is_equipped: false })
  return pickInt(res.updated, 0)
}

/**
 * 名称解析顺序与契约 §3.3 一致：titles 表 → 内置 3 条 → code 兜底。
 * 最后那个兜底是为了不把空字符串丢给前端（称号在表里被删、又不是内置的老记录）。
 */
async function resolveName(code) {
  try {
    const r = await db.collection(DB_TITLES).where({ code: code }).limit(1).get()
    const row = (r.data && r.data[0]) || null
    if (row && row.active !== false) {
      const name = str(row.name)
      if (name) return name
    }
  } catch (e) {
    // titles 表还没建：直接走内置
  }
  return TITLE_NAMES[code] || code
}

exports.main = async (event) => {
  try {
    event = event || {}
    const me = await getUserByToken(str(event.token))

    // 不传 code 和传 '' 语义不同：不传是前端漏参数，传 '' 才是要摘下来，
    // 所以这里必须区分，不能都用 str() 兜成 ''。
    if (typeof event.code !== 'string') fail('缺少 code', 400)
    const code = str(event.code)

    if (code) {
      // 必须先确认拿到过：没获得的 code 不许佩戴，否则墙上会出现「没有却显示佩戴中」
      let row = null
      try {
        const r = await db
          .collection(DB_USER_TITLES)
          .where({ user_id: me._id, title_id: code })
          .limit(1)
          .get()
        row = (r.data && r.data[0]) || null
      } catch (e) {
        // 表还没建 = 一条都没获得过，落到下面的 404
        row = null
      }
      if (!row) fail('还没获得这个称号', 404)

      await clearEquipped(me._id)
      // 只动佩戴位，obtained_at 与记录本身都不改（契约 §3.2）
      await db
        .collection(DB_USER_TITLES)
        .where({ user_id: me._id, title_id: code })
        .update({ is_equipped: true })
    } else {
      try {
        await clearEquipped(me._id)
      } catch (e) {
        // user_titles 还没建 = 本来就没有佩戴，摘掉是个空操作，不该报错
      }
    }

    // 两处状态同写：资料卡 / 对方主页读的是用户表这一列
    await db.collection(DB_USERS).doc(me._id).update({ current_title_id: code })

    const equipped = code ? { code: code, name: await resolveName(code) } : null
    return { code: 0, msg: 'ok', data: { equipped: equipped } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '操作失败' }
  }
}
