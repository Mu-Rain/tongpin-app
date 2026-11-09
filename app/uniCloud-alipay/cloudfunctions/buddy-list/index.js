'use strict'

/**
 * 我的搭子列表 —— pages/buddy/buddy.vue 用
 *
 * 入参：{ token, status?, count_only? }
 *   status     不传默认只查 'active'
 *   count_only true 时只算个数（list 恒为空数组，total 是人数），首页数字卡用。
 *              ★ 存在的意义：首页那个「我的搭子」必须和本列表的 total 同一个口径，
 *              否则「已是好友不算搭子」这条规则就得在 home-summary 里再实现一遍，
 *              两份实现迟早对不上（2026-11-02 首页显示 2、这里显示 1 就是这么来的）。
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
 *   / tags: [{relation_id, label, color, category, category_label, since,
 *             my_done, peer_done, done_count}]   ← 后三个是搭子完成态（按我的身份取）
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
const DB_REMARKS = 'user_remarks'
const DB_FRIENDS = 'friendships'

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

/**
 * 头像换临时链接：库里存 cloud:// fileID，<image> 只认 http。
 * 一页一次批量换；失败保留原值，头像裂了不该让整页列表报错。
 */
async function resolveListAvatars(list) {
  const ids = []
  for (let i = 0; i < list.length; i++) {
    const u = list[i].avatar
    if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
  }
  if (!ids.length) return
  try {
    const res = await uniCloud.getTempFileURL({ fileList: ids })
    const fl = (res && res.fileList) || []
    const map = {}
    for (let i = 0; i < fl.length; i++) {
      if (fl[i] && fl[i].tempFileURL) map[fl[i].fileID] = fl[i].tempFileURL
    }
    for (let i = 0; i < list.length; i++) {
      if (map[list[i].avatar]) list[i].avatar = map[list[i].avatar]
    }
  } catch (err) {
    console.warn('[buddy-list] 头像换链失败', err && err.message)
  }
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

    let rels = relRes.data
    if (!rels.length) {
      return { code: 0, msg: 'ok', data: { list: [], total: 0 } }
    }

    // —— 1.5) ★ 已是好友的，搭子不再列出（设计规则，见 docs/03-database.md §2.3）——
    // 好友关系比搭子更强，成为好友时搭子应当被收起来。
    // friend-request 的 accept 分支会在成为好友那一刻把 active 搭子改成 ended，
    // 但有两种顺序它会漏掉：① 先成为好友、之后才冒出搭子（老版本允许好友点邀请）；
    // ② 搭子由别的路径在好友建立之后写进来。
    // 数据层由 buddy-invite 的 repair 兜底清理，但那是要手动跑的运维动作；
    // 这个列表必须**立刻正确**，所以在读的时候就剔掉。只剔返回值，不改数据库。
    // 整段 try/catch：friendships 表还没建时当作"都不是好友"，列表照常返回。
    try {
      const frRes = await db
        .collection(DB_FRIENDS)
        .where(dbCmd.or([{ user_a_id: me._id }, { user_b_id: me._id }]))
        .limit(200)
        .get()
      const friendSet = {}
      ;(frRes.data || []).forEach(function (f) {
        const o = f.user_a_id === me._id ? f.user_b_id : f.user_a_id
        if (o) friendSet[o] = true
      })
      if (Object.keys(friendSet).length) {
        rels = rels.filter(function (r) {
          const o = r.user_a_id === me._id ? r.user_b_id : r.user_a_id
          return !friendSet[o]
        })
        if (!rels.length) {
          return { code: 0, msg: 'ok', data: { list: [], total: 0 } }
        }
      }
    } catch (e) {
      /* friendships 表不存在 / 查询失败：当作都不是好友，照常返回 */
    }

    // —— 1.6) 只要个数（首页数字卡）——
    // 走的是和下面完全同一批 rels（已经剔掉"已是好友"的人），只是不取用户资料、
    // 不查会话与备注。所以 首页那个数 === 这个列表的 total，不会再有第二种口径。
    if (event && event.count_only === true) {
      const seenPeer = {}
      let n = 0
      rels.forEach(function (r) {
        const oid = r.user_a_id === me._id ? r.user_b_id : r.user_a_id
        if (!oid) return
        // 用 hasOwnProperty 而不是 if (seenPeer[oid])：id 撞上 Object 原型键名会被误跳过
        if (Object.prototype.hasOwnProperty.call(seenPeer, oid)) return
        seenPeer[oid] = 1
        n++
      })
      return { code: 0, msg: 'ok', data: { list: [], total: n } }
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

    // —— 3.5) 用户备注：我给这些人各起过什么名字 ——
    // ★ 与 my_label 是两回事：my_label 是"这段搭子关系叫什么"（一段关系一个），
    //   remark 是"这个人叫什么"（一个人一个）。两个都要下发，前端各显示各的。
    // ★ 整段 try/catch：user_remarks 是新集合，可能还没建（第一次写入才自动创建）。
    //   查询失败绝不能把搭子列表打挂 —— 降级成"全部没有备注"即可。
    const remarkMap = {}
    try {
      const rRes = await db
        .collection(DB_REMARKS)
        .where({ owner_id: me._id, target_user_id: dbCmd.in(otherIds) })
        .limit(200)
        .get()
      for (const row of rRes.data) {
        const t = str(row.target_user_id)
        const text = str(row.remark)
        if (t && text) remarkMap[t] = text
      }
    } catch (e) {
      // 表不存在 / 查询报错：静默降级，一行都不影响
    }

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
        // 完成态必须按身份取：user_a_id < user_b_id 是入库约定，我可能是 a 也可能是 b，
        // 写死 done_a 会让 b 侧用户永远看不到自己那一半（buddy-complete 各写自己那一位）。
        tags.push({
          relation_id: r._id,
          label: label,
          color: color,
          category: cat,
          category_label: CATEGORY_LABEL[cat] || '搭子',
          since: created,
          my_done: !!(g.iAmA ? r.done_a : r.done_b),
          peer_done: !!(g.iAmA ? r.done_b : r.done_a),
          done_count: pickInt(r.done_count, 0)
        })
      })

      const verified = !!(other.is_verified || other.schoolVerified)
      const credit = pickInt(other.credit_score, pickInt(other.credit, 80))

      const first = tags[0] || {}

      return {
        // —— 人的信息 ——
        other_user_id: otherId,
        name: other.nickname || '同学',
        // 我给这个人起的备注（不是搭子标签，没有就是空串）
        remark: remarkMap[otherId] || '',
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

    await resolveListAvatars(list)

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
