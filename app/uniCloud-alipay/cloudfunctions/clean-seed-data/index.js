'use strict'

/**
 * clean-seed-data —— 一次性运维：清掉「灌进去的假数据」，保留真实账号与 3 个演示号。
 *
 * 两类假数据的标记：
 *   card-seed：它自己建的虚拟用户与卡片，行上带 seed: true；
 *   demo-seed：它建的卡片/关系/会话/消息/信誉流水/称号，行上带 seed: 'demo-seed'。
 * 演示号本身（13800000001~3）也是 seed: 'demo-seed'，但它们**要保留** —— 所以按「集合 + 标记」分别处理，
 * 不是见到标记就删。
 *
 * 安全性靠三件事：① 只认上述标记，真实用户与真实卡片没有这些标记，一条都不会被带走；
 * ② 默认 dryRun=true，只统计不删；③ 必须 confirm:'YES' 才动。
 *
 * 参数示例：
 *   { "confirm": "YES" }                          → 预览（不删）
 *   { "confirm": "YES", "dryRun": false }        → 真正删除
 *   { "confirm": "YES", "dryRun": false, "target": "card-seed" }  只清 card-seed
 *   { "confirm": "YES", "dryRun": false, "target": "demo-seed" }  只清 demo-seed 产出的内容
 */

const db = uniCloud.database()
const dbCmd = db.command

// 安全：一次性运维工具，正式环境默认关闭。需要清理时改成 true、重新部署、跑完立刻改回 false。
const ALLOW = false

// demo-seed 造内容用的集合（users 单独处理：演示号要留）
const DEMO_COLLECTIONS = [
  'cards',
  'card_tags',
  'buddy_relations',
  'conversations',
  'conversation_members',
  'messages',
  'credit_events',
  'user_titles'
]

function str(v) {
  return v === undefined || v === null ? '' : String(v)
}

async function countWhere(col, where) {
  try {
    const r = await db.collection(col).where(where).count()
    return (r && r.total) || 0
  } catch (e) {
    return -1
  }
}

async function idsWhere(col, where, field) {
  const out = []
  try {
    const r = await db.collection(col).where(where).field(field).limit(1000).get()
    ;(r.data || []).forEach(function (row) { if (row && row[field]) out.push(row[field]) })
  } catch (e) {}
  return out
}

exports.main = async (event) => {
  try {
    if (!ALLOW) return { code: 403, msg: 'clean-seed-data 已被禁用' }
    const e = event || {}
    if (str(e.confirm) !== 'YES') return { code: 400, msg: "缺少确认参数：请传 confirm: 'YES'" }
    // 默认只预览：先看清要删多少，再决定动不动手
    const dryRun = e.dryRun !== false
    const target = str(e.target) || 'all'

    const plan = []

    // ---- 1) card-seed 的虚拟用户（seed:true）----
    if (target === 'all' || target === 'card-seed') {
      const n = await countWhere('uni-id-users', { seed: true })
      plan.push({ what: 'card-seed 虚拟用户（uni-id-users.seed=true）', count: n })
    }

    // ---- 2) card-seed 的卡片（seed:true）+ 它们的 card_tags ----
    if (target === 'all' || target === 'card-seed') {
      const seedCards = await countWhere('cards', { seed: true })
      const cardIds = await idsWhere('cards', { seed: true }, '_id')
      let tagCount = 0
      if (cardIds.length) {
        for (const part of chunk(cardIds, 50)) {
          tagCount += await countWhere('card_tags', { card_id: dbCmd.in(part) })
        }
      }
      plan.push({ what: 'card-seed 卡片（cards.seed=true）', count: seedCards, ids: cardIds.length })
      plan.push({ what: '上述卡片的标签（card_tags.card_id ∈ 上面这批）', count: tagCount })
    }

    // ---- 3) demo-seed 留下的内容（seed:'demo-seed'），演示号保留 ----
    if (target === 'all' || target === 'demo-seed') {
      for (let i = 0; i < DEMO_COLLECTIONS.length; i++) {
        const col = DEMO_COLLECTIONS[i]
        // card_tags 在 demo-seed 里是按卡片 id 写的，没有 seed 字段：靠卡片 id 反查
        if (col === 'card_tags') continue
        const n = await countWhere(col, { seed: 'demo-seed' })
        plan.push({ what: 'demo-seed 的 ' + col, count: n })
      }
      const demoCardIds = await idsWhere('cards', { seed: 'demo-seed' }, '_id')
      let demoTagCount = 0
      if (demoCardIds.length) {
        for (const part of chunk(demoCardIds, 50)) {
          demoTagCount += await countWhere('card_tags', { card_id: dbCmd.in(part) })
        }
      }
      plan.push({ what: 'demo-seed 卡片的标签（card_tags.card_id ∈ 演示卡）', count: demoTagCount })
      plan.push({ what: '演示号（13800000001~3）—— 保留，不删', count: 3, note: 'keep' })
    }

    if (dryRun) {
      return { code: 0, msg: '预览模式：什么都没删（要真删请传 dryRun:false）', data: { dryRun: true, target: target, plan: plan } }
    }

    // ---- 真删 ----------------
    const done = []

    // card-seed：先删 card_tags（按卡片 id），再删卡片，最后删虚拟用户
    if (target === 'all' || target === 'card-seed') {
      const cardIds = await idsWhere('cards', { seed: true }, '_id')
      let tags = 0
      for (const part of chunk(cardIds, 50)) {
        const r = await db.collection('card_tags').where({ card_id: dbCmd.in(part) }).remove()
        tags += (r && r.deleted) || 0
      }
      const cr = await db.collection('cards').where({ seed: true }).remove()
      const ur = await db.collection('uni-id-users').where({ seed: true }).remove()
      done.push({ what: 'card_tags', deleted: tags })
      done.push({ what: 'cards', deleted: (cr && cr.deleted) || 0 })
      done.push({ what: 'uni-id-users', deleted: (ur && ur.deleted) || 0 })
    }

    // demo-seed：先删消息/成员/会话等，最后删卡片；users 不动
    if (target === 'all' || target === 'demo-seed') {
      /* 会话与会话成员/消息可能不是每一行都带 seed 标记（历史写法不一致），
         所以先记下要删的会话 id，再按 conversation_id 兜底清成员与消息 ——
         否则会留下「消息还在、会话没了」的孤儿数据，聊天接口读到会出怪。 */
      const convIds = await idsWhere('conversations', { seed: 'demo-seed' }, '_id')
      let orphanMembers = 0
      let orphanMsgs = 0
      for (const part of chunk(convIds, 50)) {
        const m1 = await db.collection('conversation_members').where({ conversation_id: dbCmd.in(part) }).remove()
        orphanMembers += (m1 && m1.deleted) || 0
        const m2 = await db.collection('messages').where({ conversation_id: dbCmd.in(part) }).remove()
        orphanMsgs += (m2 && m2.deleted) || 0
      }
      if (convIds.length) {
        done.push({ what: 'conversation_members(按会话 id 兜底)', deleted: orphanMembers })
        done.push({ what: 'messages(按会话 id 兜底)', deleted: orphanMsgs })
      }
      const demoCardIds = await idsWhere('cards', { seed: 'demo-seed' }, '_id')
      let tags = 0
      for (const part of chunk(demoCardIds, 50)) {
        const r = await db.collection('card_tags').where({ card_id: dbCmd.in(part) }).remove()
        tags += (r && r.deleted) || 0
      }
      done.push({ what: 'card_tags(demo)', deleted: tags })
      for (let i = 0; i < DEMO_COLLECTIONS.length; i++) {
        const col = DEMO_COLLECTIONS[i]
        if (col === 'card_tags') continue
        const r = await db.collection(col).where({ seed: 'demo-seed' }).remove()
        done.push({ what: col, deleted: (r && r.deleted) || 0 })
      }
    }

    return { code: 0, msg: '已清理（演示号保留）', data: { dryRun: false, target: target, deleted: done } }
  } catch (err) {
    return { code: 500, msg: (err && err.message) || '执行失败' }
  }
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
