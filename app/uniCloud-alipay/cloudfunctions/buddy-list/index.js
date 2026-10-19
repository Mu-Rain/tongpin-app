'use strict'

/**
 * 我的搭子列表 —— pages/buddy/buddy.vue 用
 *
 * 入参：{ token, status? }   status 不传默认只查 'active'
 * 出参：{ code, msg, data: { list: [人…], total } }
 *
 * ★★ 一条 list 项 = **一个人**，不是一条关系。
 *   同一对人在不同 category 下可以有多段搭子关系（自习 + 夜跑 + 拍照），
 *   但界面上必须有且只有一张卡，卡里并排显示这段关系产生的**全部标签**。
 *   合并放在服务端做，前端不再自己判断 —— 否则每多一个读这份数据的页面
 *   就要重新实现一次"按人合并"，迟早漏一处（消息页、聊天页都栽过）。
 *
 * 每个人：
 *   other_user_id / name / avatar / school / credit / verified
 *   / conversation_id                ← 一对人全局唯一，点卡片进这一个
 *   / last_text / last_at            ← 会话摘要
 *   / since                          ← 最早一段关系的建立时间
 *   / tags: [{relation_id, label, color, category, category_label, since}]
 *                                    ← 我给他起的**全部**标签（每个都是一段关系）
 *   / tag_count
 *   —— 兼容字段：my_label / my_label_color / relation_id 取 tags[0]，
 *      老页面若只读单个标签也不会空。
 *
 * ★ 「搭子」两个字是固定后缀，由前端拼。这里存和返回的都是**前缀**。
 *
 * ★★ 搭子标签是**私有备注**：只返回我这一侧的 label_*，绝不下发对方的
 *   （不返回 his_label / his_label_color）。见 docs/03-database.md §2.3。
 *
 * ★ 关系表里 user_a_id / user_b_id 有约定 user_a_id < user_b_id（见 card-apply），
 *   所以"我是 a 还是 b"必须判断，不能假设。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_RELATIONS = 'buddy_relations'
const DB_CONVERSATIONS = 'conversations'

/** category → 中文名（与 card-publish 的 TYPE_ENUM 一致） */
const CATEGORY_LABEL = {
  study: '学习',
  fitness: '健身',
  photo: '拍照',
  meal: '吃饭',
  sport: '运动',
  competition: '竞赛',
  other: '其他'
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function pickInt(v, dft) {
  return typeof v === 'number' ? v : dft
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
    const status = str(event.status) || 'active'

    // —— 1) 我处于 a 侧或 b 侧的关系全部取出来 ——
    // 用 or 一次查完，不要查两次再拼（两次之间有竞态，还可能重复）
    const relRes = await db
      .collection(DB_RELATIONS)
      .where(
        dbCmd.and([
          { status: status },
          dbCmd.or([{ user_a_id: me._id }, { user_b_id: me._id }])
        ])
      )
      .limit(200)
      .get()

    const rels = relRes.data
    if (!rels.length) {
      return { code: 0, msg: 'ok', data: { list: [], total: 0 } }
    }

    // —— 2) 对方 id 一次性收集（按人去重；同一个人可能来自多条关系）——
    const otherIds = []
    rels.forEach(function (r) {
      const oid = r.user_a_id === me._id ? r.user_b_id : r.user_a_id
      if (oid && otherIds.indexOf(oid) < 0) otherIds.push(oid)
    })

    // —— 3) 批量取对方用户信息（白名单字段，不外发手机号/密码）——
    const userMap = {}
    const uRes = await db
      .collection(DB_USERS)
      .where({ _id: dbCmd.in(otherIds) })
      .field({
        _id: true,
        nickname: true,
        avatar: true,
        avatar_url: true,
        school: true,
        school_name: true,
        schoolVerified: true,
        is_verified: true,
        credit: true,
        credit_score: true
      })
      .get()
    for (const u of uRes.data) userMap[u._id] = u

    // —— 4) 会话：★ 按「一对人」找，不按关系找 ——
    // 一对人全局只有一条 direct 会话（丙方案），它同时服务于这个人名下的所有关系。
    //   路径 A：关系表里已经写了 conversation_id（第 6 天后新建的关系都有）
    //   路径 B：老关系没写 → 按 buddy_relation_id 反查 conversations 兜底
    //   路径 C：都拿不到 → 按 user_pair_key 查（会话认人，不认关系）
    const pairKey = function (u1, u2) {
      return [u1, u2].sort().join('|')
    }

    // 每条关系 → 会话 id（能查到就记下来，后面回填用）
    const convIdByRel = {}
    rels.forEach(function (r) {
      if (r.conversation_id) convIdByRel[r._id] = r.conversation_id
    })

    // 路径 B：按老字段反查
    const relIdsMissing = rels
      .filter(function (r) {
        return !r.conversation_id
      })
      .map(function (r) {
        return r._id
      })

    if (relIdsMissing.length) {
      const byRel = await db
        .collection(DB_CONVERSATIONS)
        .where({ buddy_relation_id: dbCmd.in(relIdsMissing), type: 'direct' })
        .field({ _id: true, buddy_relation_id: true })
        .limit(200)
        .get()
      for (const c of byRel.data) {
        if (!convIdByRel[c.buddy_relation_id]) {
          convIdByRel[c.buddy_relation_id] = c._id
        }
      }
    }

    // 路径 C：按人查。把每人对应的 pair key 一次查出来，
    //         这样即使一条关系都没写 conversation_id，也能拿到这只属于这两个人的会话。
    const pairKeyByOther = {}
    otherIds.forEach(function (oid) {
      pairKeyByOther[oid] = pairKey(me._id, oid)
    })
    const allKeys = Object.keys(pairKeyByOther).map(function (k) {
      return pairKeyByOther[k]
    })

    const convByUser = {} // otherId → convId
    if (allKeys.length) {
      const byPair = await db
        .collection(DB_CONVERSATIONS)
        .where({ user_pair_key: dbCmd.in(allKeys), type: 'direct' })
        .field({ _id: true, user_pair_key: true })
        .limit(200)
        .get()
      const keyToConv = {}
      for (const c of byPair.data) {
        if (c.user_pair_key && !keyToConv[c.user_pair_key]) {
          keyToConv[c.user_pair_key] = c._id
        }
      }
      otherIds.forEach(function (oid) {
        const cid = keyToConv[pairKeyByOther[oid]]
        if (cid) convByUser[oid] = cid
      })
    }

    // —— 5) 每个人的最终会话 id ——
    // 优先级：路径 C（按人，最权威）> 任一关系的 conversation_id / 反查结果。
    // 这样同一个人名下多条关系指向不同会话时，也能收敛到同一条。
    const convIdByOther = {}
    otherIds.forEach(function (oid) {
      if (convByUser[oid]) {
        convIdByOther[oid] = convByUser[oid]
        return
      }
      // 兜底：找这个人名下任一关系的会话
      for (const r of rels) {
        const o = r.user_a_id === me._id ? r.user_b_id : r.user_a_id
        if (o !== oid) continue
        if (convIdByRel[r._id]) {
          convIdByOther[oid] = convIdByRel[r._id]
          break
        }
      }
    })

    const convIds = []
    for (const k in convIdByOther) {
      const v = convIdByOther[k]
      if (v && convIds.indexOf(v) < 0) convIds.push(v)
    }

    const convMap = {}
    if (convIds.length) {
      const cRes = await db
        .collection(DB_CONVERSATIONS)
        .where({ _id: dbCmd.in(convIds) })
        .field({ _id: true, last_message_text: true, last_message_at: true, created_at: true })
        .get()
      for (const c of cRes.data) convMap[c._id] = c
    }

    // —— 6) ★ 按人合并 ——
    // 把 rels 按对方 id 分组，每组一条 list 项。
    const byOther = {}
    rels.forEach(function (r) {
      const iAmA = r.user_a_id === me._id
      const otherId = iAmA ? r.user_b_id : r.user_a_id
      if (!otherId) return
      if (!byOther[otherId]) byOther[otherId] = []
      byOther[otherId].push({ rel: r, iAmA: iAmA })
    })

    const list = otherIds.map(function (otherId) {
      const group = byOther[otherId] || []
      const other = userMap[otherId] || {}
      const convId = convIdByOther[otherId] || ''
      const conv = convMap[convId] || {}

      // 标签：每条关系一个。按建立时间升序，最早的排前面（眼熟的那个不会乱跳）。
      const sorted = group.slice().sort(function (x, y) {
        return (x.rel.created_at || 0) - (y.rel.created_at || 0)
      })

      const tags = []
      let since = 0
      sorted.forEach(function (g) {
        const r = g.rel
        const label = str(g.iAmA ? r.label_a : r.label_b)
        const color = str(g.iAmA ? r.label_a_color : r.label_b_color)
        const cat = str(r.category)
        const created = r.created_at || 0
        if (created && (!since || created < since)) since = created
        // 没起过名字的关系也留一条占位，用户才知道"这段关系还没起名"
        tags.push({
          relation_id: r._id,
          label: label,
          color: color,
          category: cat,
          category_label: CATEGORY_LABEL[cat] || '搭子',
          since: created
        })
      })

      const verified = !!(other.is_verified || other.schoolVerified)
      const credit = pickInt(other.credit_score, pickInt(other.credit, 80))

      const first = tags[0] || {}

      return {
        // —— 人的信息 ——
        other_user_id: otherId,
        name: other.nickname || '同学',
        avatar: other.avatar_url || other.avatar || '',
        school: other.school_name || other.school || '',
        credit: credit,
        verified: verified,
        since: since,
        // —— 会话（一对人唯一）——
        conversation_id: convId,
        last_text: conv.last_message_text || '还没有聊过，打个招呼吧',
        last_at: conv.last_message_at || conv.created_at || since || 0,
        // —— 标签：全部 ——
        tags: tags,
        tag_count: tags.length,
        // 兼容字段：老页面只读单个标签时取第一段关系
        relation_id: first.relation_id || '',
        my_label: first.label || '',
        my_label_color: first.color || ''
      }
    })

    // 最近聊过的排前面，没聊过的按最早建立关系时间
    list.sort(function (a, b) {
      return (b.last_at || 0) - (a.last_at || 0)
    })

    // —— 7) 顺手回填：关系表里 conversation_id 为空、但按人查到了会话的，补进去 ——
    //   card-apply / buddy-invite 新建关系时已经写；这里只修历史数据。
    //   失败不影响返回 —— 这只是数据修补，不能因为补不上就让列表打不开。
    try {
      for (const item of list) {
        if (!item.conversation_id) continue
        for (const t of item.tags) {
          const rel = rels.find(function (r) {
            return r._id === t.relation_id
          })
          if (rel && !rel.conversation_id) {
            await db
              .collection(DB_RELATIONS)
              .doc(t.relation_id)
              .update({ conversation_id: item.conversation_id })
          }
        }
      }
    } catch (e) {
      console.warn('[buddy-list] backfill conversation_id failed', e.message)
    }

    return { code: 0, msg: 'ok', data: { list: list, total: list.length } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '加载失败' }
  }
}
