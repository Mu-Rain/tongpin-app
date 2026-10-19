'use strict'

/**
 * 数据迁移：把老数据补齐"多搭子"体系需要的新字段
 *
 * 为什么必须做：
 *   card-apply 的会话判重从 buddy_relation_id 改成了 user_pair_key。
 *   老会话没有 user_pair_key 这个字段，新代码查不到它，
 *   就会给同一对人再建一个聊天室 —— 消息列表里出现两条一模一样的会话。
 *   同理，老关系没有 category，新代码按 category 判重时会认不出来。
 *
 * 做什么：
 *   1) conversations：凡有 user_a_id/user_b_id 但缺 user_pair_key 的，补上 pair key。
 *      没有 user_a_id/user_b_id 的（更老的），按 conversation_members 反推两个人。
 *   2) buddy_relations：凡是缺 category 的，用关联卡片(来源卡)的 type 回填；
 *      没有卡可查（direct 邀请来的），填 'other'。
 *
 * 幂等：已经有值的字段不覆盖，跑几次都一样。
 *
 * 入参：{ token, dry_run? }
 *   token 必须是管理员。dry_run=true 时只统计不改库。
 *
 * ★ 上线前可以把 ALLOW 改 false 或者直接删掉这个云函数。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_RELATIONS = 'buddy_relations'
const DB_CARDS = 'cards'

// ★ 一次性运维工具。正式环境请改成 false 或删除本云函数。
const ALLOW = true

/**
 * ★★ 免参数自跑配置（HBuilderX 的「上传并运行」不带参数框，只能用这里的默认值）。
 *
 * 用法：
 *   1) 把 ADMIN_PHONE 改成你的管理员账号手机号
 *   2) 想先看统计就把 MODE 设成 'dry'，想看结果并真改库就设成 'run'
 *   3) 右键「上传并运行」，看返回的 data.dedupe 和 data.conversations
 *   4) 全部做完后把 ALLOW 改成 false 或直接删掉这个云函数
 *
 * 请求里显式传了参数时，以请求为准（控制台网页版仍可覆盖这里）。
 */
const ADMIN_PHONE = '19122926171'      // ← 改成你的手机号，例如 '19122926171'
const MODE = 'dry'          // 'dry' 只统计不改库；'run' 真执行

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 把 URL query 传来的各种写法统一成布尔。
 * URL 化时 ?inspect=1 到这里是数字 1，"true" 是字符串，
 * 而业务代码里写的是 === true，不归一化就永远不成立。
 * 规则：1 / "1" / true / "true" / "yes" / "on" 都算开启；undefined / null / "" / 0 / "false" 算关闭。
 */
function isTruthy(v) {
  if (v === true) return true
  if (v === false || v === undefined || v === null) return false
  if (typeof v === 'number') return v !== 0
  const s = String(v).trim().toLowerCase()
  if (!s) return false
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

/**
 * ★ URL 化调用的参数解包。
 *
 * 云函数被调用有两种来源：
 *   A) 客户端 uniCloud.callFunction({ name, data }) —— event 就是 data 本身
 *   B) HTTP 直接访问（URL 化）—— event 是 { path, httpMethod, headers,
 *      queryStringParameters, body, isBase64Encoded }，业务参数在别处
 *
 * 这个函数把两种来源统一成"业务参数对象"，之后代码只认返回的这个对象。
 */
function parseInput(raw) {
  const ev = raw && typeof raw === 'object' ? raw : {}

  // 不是 URL 化请求（没有 httpMethod），原样返回
  if (!ev.httpMethod && !ev.queryStringParameters && !ev.body) return ev

  // ★ 云对象 / 云函数通过客户端调用时，参数在 ev.data 里
  if (ev.data && typeof ev.data === 'object' && !Array.isArray(ev.data)) {
    return Object.assign({}, ev.data)
  }

  const out = {}

  // 1) query 参数（GET 用这个）
  const q = ev.queryStringParameters
  if (q && typeof q === 'object') {
    for (const k of Object.keys(q)) out[k] = q[k]
  }

  // 2) body（POST 用这个，可能是 base64）
  let text = ''
  if (typeof ev.body === 'string') {
    text = ev.body
    if (ev.isBase64Encoded === true) {
      try {
        text = Buffer.from(ev.body, 'base64').toString('utf8')
      } catch (e) {
        text = ''
      }
    }
  }

  if (text) {
    const t = text.trim()
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      try {
        const parsed = JSON.parse(t)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const k of Object.keys(parsed)) out[k] = parsed[k]
        }
      } catch (e) {
        // 不是 JSON，忽略
      }
    } else {
      // a=1&b=2 这种表单
      for (const seg of t.split('&')) {
        const i = seg.indexOf('=')
        if (i > 0) {
          const k = decodeURIComponent(seg.slice(0, i))
          const v = decodeURIComponent(seg.slice(i + 1).replace(/\+/g, ' '))
          out[k] = v
        }
      }
    }
  }

  // 3) 兜底：把 query 里的字符串 "true"/"false" 转成布尔，
  //    否则 event.inspect === true 这种判断永远不成立
  for (const k of Object.keys(out)) {
    if (out[k] === 'true') out[k] = true
    else if (out[k] === 'false') out[k] = false
    else if (typeof out[k] === 'string' && /^-?\d+$/.test(out[k]) && k !== 'phone' && k !== 'token') {
      out[k] = Number(out[k])
    }
  }

  return out
}

function pairKey(a, b) {
  return a < b ? a + '|' + b : b + '|' + a
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

exports.main = async (rawEvent) => {
  // ★ URL 化调用时 rawEvent 是 HTTP 描述对象，必须先解包成业务参数。
  //   客户端 callFunction 调用时 parseInput 原样返回，行为不变。
  let event = parseInput(rawEvent)
  const httpMethod = str(rawEvent && rawEvent.httpMethod).toUpperCase()

  // ★★ 诊断探针：请求里带 __debug=1 时，把函数实际收到的东西原样返回（只读，不碰业务）。
  //    用途：确认云端跑的到底是不是当前这份代码，以及 URL 化的 event 长什么样。
  //    这个分支在文件里排在所有业务逻辑之前，能证明代码版本已更新。
  if (rawEvent && (rawEvent.__debug === 1 || rawEvent.__debug === '1' ||
      (rawEvent.queryStringParameters && rawEvent.queryStringParameters.__debug))) {
    const safe = {}
    try {
      for (const k of Object.keys(rawEvent)) {
        const v = rawEvent[k]
        if (typeof v === 'string') {
          safe[k] = v.length > 400 ? v.slice(0, 400) + '…(共' + v.length + '字符)' : v
        } else if (v === null || typeof v !== 'object') {
          safe[k] = v
        } else {
          safe[k] = JSON.parse(JSON.stringify(v))
        }
      }
    } catch (e) {
      safe.__err = e.message
    }
    return {
      code: 0,
      msg: '诊断探针：这是函数实际收到的 rawEvent，以及解包后的 event',
      data: {
        code_version: 'v2-2026-10-18-debug-probe',
        rawEventKeys: Object.keys(rawEvent || {}),
        rawEvent: safe,
        parsedEvent: event,
        parsedKeys: Object.keys(event),
        httpMethod: httpMethod
      }
    }
  }

  try {
    if (!ALLOW) fail('这个迁移工具已经关闭了', 403)

    // ★ GET 请求没有业务参数时，默认开启体检（只读）。
    //   这样浏览器直接打开 URL 就能看库里真实数据，不用拼参数。
    if (httpMethod === 'GET' && Object.keys(event).length === 0) {
      event = { inspect: true }
    }

    // ★ URL 化时 query 参数都是字符串，parseInput 已把 "1"/"true" 转成 1/true，
    //   但业务代码里写的是 === true，所以这里统一归一化。
    //   任何"存在且不是否"的值都算开启。
    event.inspect = isTruthy(event.inspect)
    if (event.inspect && Object.keys(event).length === 1) {
      // 只传了 inspect，补默认值
    }

    // 凭据：优先 token；没传 token 时用手机号定位。
    // 请求里没有 phone 时退回代码顶部的 ADMIN_PHONE ——
    // HBuilderX「上传并运行」不带参数框，只能靠这个常量。
    let me = null
    const rawToken = str(event.token)
    const rawPhone = str(event.phone) || str(ADMIN_PHONE)

    if (!rawPhone) {
      fail('还没有配置管理员手机号：请打开 migrate-pairkey/index.js，把 ADMIN_PHONE 改成你的手机号', 400)
    }

    if (rawToken) {
      me = await getUserByToken(rawToken)
    } else {
      const pr = await db
        .collection(DB_USERS)
        .where({ phone: rawPhone })
        .limit(1)
        .get()
      if (!pr.data.length) {
        // 兼容带 +86 / 86 前缀
        const alt = await db
          .collection(DB_USERS)
          .where({ phone: dbCmd.in([rawPhone, '+86' + rawPhone, '86' + rawPhone]) })
          .limit(1)
          .get()
        if (!alt.data.length) fail('没找到这个手机号对应的账号', 404)
        me = alt.data[0]
      } else {
        me = pr.data[0]
      }
    }

    const isAdmin = me.is_admin === true || me.role === 'admin'
    if (!isAdmin) fail('没有权限：只有管理员能跑迁移', 403)

    // dry_run 的判断：请求里显式给了就用请求的，否则用顶部 MODE
    // ★ URL 化时 query 参数是字符串，用 isTruthy 归一化；没传就用顶部 MODE
    const dryRun = event.dry_run === undefined ? MODE !== 'run' : isTruthy(event.dry_run)

    const report = {
      dry_run: dryRun,
      conversations: {
        total: 0,
        fixed: 0,
        skipped_no_members: 0,
        skipped_already_has_key: 0
      },
      relations: {
        total: 0,
        fixed: 0,
        defaulted_other: 0
      }
    }

    // ============ 0) 体检：把库里所有会话和关系原样列出来 ============
    // 用途：dedupe 报 groups:0 但界面上确实看到两条会话时，靠这个看清真实字段。
    // 只读，不写库。
    if (event.inspect === true || MODE === 'inspect') {
      const INSPECT = { conversations: [], relations: [], members: [] }

      const cs = await db.collection(DB_CONVERSATIONS).limit(200).get()
      for (const c of cs.data) {
        let msgCount = 0
        try {
          const r = await db.collection('messages').where({ conversation_id: c._id }).count()
          msgCount = (r && r.total) || 0
        } catch (e) {
          msgCount = -1
        }
        INSPECT.conversations.push({
          _id: c._id,
          type: str(c.type),
          user_a_id: str(c.user_a_id),
          user_b_id: str(c.user_b_id),
          user_pair_key: str(c.user_pair_key),
          buddy_relation_id: str(c.buddy_relation_id),
          last_message_text: str(c.last_message_text),
          last_message_at: c.last_message_at || 0,
          created_at: c.created_at || 0,
          msg_count: msgCount,
          all_keys: Object.keys(c)
        })
      }

      const rs = await db.collection(DB_RELATIONS).limit(200).get()
      for (const r of rs.data) {
        INSPECT.relations.push({
          _id: r._id,
          user_a_id: str(r.user_a_id),
          user_b_id: str(r.user_b_id),
          category: str(r.category),
          label_a: str(r.label_a),
          label_b: str(r.label_b),
          label_a_color: str(r.label_a_color),
          label_b_color: str(r.label_b_color),
          status: str(r.status),
          conversation_id: str(r.conversation_id),
          source_type: str(r.source_type),
          all_keys: Object.keys(r)
        })
      }

      const ms = await db.collection(DB_MEMBERS).limit(300).get()
      for (const m of ms.data) {
        INSPECT.members.push({
          _id: m._id,
          conversation_id: str(m.conversation_id),
          user_id: str(m.user_id),
          unread_count: m.unread_count || 0
        })
      }

      return { code: 0, msg: '体检完成（只读）', data: INSPECT }
    }

    // ============ 1) conversations 补 user_pair_key ============
    // 分页拉，每次 100 条，避免一次拉爆内存
    let convSkip = 0
    const CONV_PAGE = 100
    // 只处理"缺 user_pair_key"的。用 exists 判断
    while (true) {
      const page = await db
        .collection(DB_CONVERSATIONS)
        .where({ user_pair_key: dbCmd.exists(false) })
        .limit(CONV_PAGE)
        .skip(convSkip)
        .get()

      if (!page.data.length) break

      for (const conv of page.data) {
        report.conversations.total++

        let a = str(conv.user_a_id)
        let b = str(conv.user_b_id)

        // 更老的会话连 user_a_id/user_b_id 都没有，按成员表反推
        if (!a || !b) {
          const mem = await db
            .collection(DB_MEMBERS)
            .where({ conversation_id: conv._id })
            .limit(5)
            .get()
          const ids = mem.data.map((m) => str(m.user_id)).filter(Boolean)
          if (ids.length < 2) {
            report.conversations.skipped_no_members++
            continue
          }
          a = ids[0]
          b = ids[1]
        }

        const key = pairKey(a, b)
        const ua = a < b ? a : b
        const ub = a < b ? b : a

        if (!dryRun) {
          await db.collection(DB_CONVERSATIONS).doc(conv._id).update({
            user_pair_key: key,
            user_a_id: ua,
            user_b_id: ub
          })
        }
        report.conversations.fixed++
      }

      // 改了之后这些文档就不满足条件了，不能 skip 递增，
      // 否则会跳过数据。保持 skip=0 一直取到空。
      if (dryRun) {
        convSkip += CONV_PAGE
        if (convSkip > 5000) break
      }
    }

    // ============ 2) buddy_relations 补 category ============
    let relSkip = 0
    const REL_PAGE = 100
    while (true) {
      const page = await db
        .collection(DB_RELATIONS)
        .where({ category: dbCmd.exists(false) })
        .limit(REL_PAGE)
        .skip(relSkip)
        .get()

      if (!page.data.length) break

      // 批量取来源卡片类型
      const cardIds = page.data.map((r) => str(r.source_card_id)).filter(Boolean)
      const cardTypeMap = {}
      if (cardIds.length) {
        try {
          const cards = await db
            .collection(DB_CARDS)
            .where({ _id: dbCmd.in(cardIds) })
            .field({ _id: true, type: true })
            .limit(200)
            .get()
          for (const c of cards.data) {
            cardTypeMap[c._id] = str(c.type) || 'other'
          }
        } catch (e) {
          /* 查不到就用默认值 */
        }
      }

      for (const rel of page.data) {
        report.relations.total++
        const cid = str(rel.source_card_id)
        let cat = cardTypeMap[cid] || ''
        if (!cat) {
          cat = 'other'
          report.relations.defaulted_other++
        }

        if (!dryRun) {
          await db.collection(DB_RELATIONS).doc(rel._id).update({
            category: cat,
            source_type: str(rel.source_type) || (cid ? 'card' : 'other'),
            source_invite_id: str(rel.source_invite_id) || ''
          })
        }
        report.relations.fixed++
      }

      if (dryRun) {
        relSkip += REL_PAGE
        if (relSkip > 5000) break
      }
    }

    // ============ 3) 合并同一对人的重复会话 ============
    // 背景：buddy-invite 早期只按 user_pair_key 查重，老会话没有这个字段，
    // 于是给同一对人又建了一条 —— 消息列表里出现两条一模一样的会话。
    // 光补 key 不够（补完两条都带同一个 key），必须真的合并。
    //
    // 策略：同一 pair 只留一条（消息最多的那条），其余会话的消息改挂过去、
    //       成员的 conversation_id 改过去，然后删掉空壳会话。
    //       消息一条不丢。
    // 默认开启（HBuilderX「上传并运行」不带参数，靠这里跑）；
    // 显式传 dedupe:false 可以关掉。
    if (event.dedupe === undefined || isTruthy(event.dedupe)) {
      const DEDUP = {
        groups: 0,
        merged: 0,
        moved_messages: 0,
        deleted: 0,
        relations_filled: 0,
        relations_removed: 0,
        kept: []
      }

      // 把全部会话按 pair 分组
      const all = await db.collection(DB_CONVERSATIONS).where({ type: 'direct' }).limit(1000).get()
      const groups = {}
      for (const c of all.data) {
        let a = str(c.user_a_id)
        let b = str(c.user_b_id)
        if (!a || !b) continue
        const k = pairKey(a, b)
        if (!groups[k]) groups[k] = []
        groups[k].push(c)
      }

      // 诊断：先把分组结果原样记下来，方便核查为什么没合并
      DEDUP.all_conversations = all.data.length
      DEDUP.group_keys = Object.keys(groups).map(function (k) {
        return k + ' => ' + groups[k].length + ' 条'
      })

      for (const k of Object.keys(groups)) {
        const list = groups[k]
        if (list.length < 2) continue
        DEDUP.groups++

        // 选保留哪条：先比消息数，再比 last_message_at，最后比 _id 稳定
        const scored = []
        for (const c of list) {
          let cnt = 0
          try {
            const r = await db.collection('messages').where({ conversation_id: c._id }).count()
            cnt = (r && r.total) || 0
          } catch (e) {
            cnt = 0
          }
          scored.push({ conv: c, count: cnt })
        }
        scored.sort(function (x, y) {
          if (y.count !== x.count) return y.count - x.count
          return (y.conv.last_message_at || 0) - (x.conv.last_message_at || 0)
        })

        const keep = scored[0].conv
        DEDUP.kept.push({ pair: k, keep_id: keep._id, keep_messages: scored[0].count, dropped: list.length - 1 })

        for (let i = 1; i < scored.length; i++) {
          const drop = scored[i].conv
          if (dryRun) {
            DEDUP.merged++
            DEDUP.moved_messages += scored[i].count
            continue
          }
          try {
            // ① 消息改挂到保留的会话
            const mv = await db
              .collection('messages')
              .where({ conversation_id: drop._id })
              .update({ conversation_id: keep._id })
            DEDUP.moved_messages += (mv && mv.updated) || scored[i].count

            // ② 成员改挂（去重：已经在保留会话里的成员不能再加一条）
            const mems = await db
              .collection(DB_MEMBERS)
              .where({ conversation_id: drop._id })
              .get()
            for (const m of mems.data) {
              const dup = await db
                .collection(DB_MEMBERS)
                .where({ conversation_id: keep._id, user_id: m.user_id })
                .limit(1)
                .get()
              if (dup.data.length) {
                // 已存在：把未读数加过去，再删掉这条重复成员
                const old = dup.data[0]
                await db.collection(DB_MEMBERS).doc(old._id).update({
                  unread_count: (Number(old.unread_count) || 0) + (Number(m.unread_count) || 0)
                })
                await db.collection(DB_MEMBERS).doc(m._id).remove()
              } else {
                await db.collection(DB_MEMBERS).doc(m._id).update({ conversation_id: keep._id })
              }
            }

            // ③ 关系表的 conversation_id 改指向保留的会话
            await db
              .collection(DB_RELATIONS)
              .where({ conversation_id: drop._id })
              .update({ conversation_id: keep._id })

            // ③.5 合并同一对人的"半残"关系
            //   实例：老关系 f2be51 有 啊哈哈/夜跑 两个标签但 category 空；
            //        新关系 a2bdbf 有 category=fitness、label_a=增肌 但 label_b 空。
            //   两条并存会让"我的搭子"页显示两段搭子。
            //   做法：按 (user_a_id,user_b_id,category) 找同类的多条 active 关系，
            //        留一条（标签最全的），把另一条里非空的标签补进去再删掉。
            const samePair = await db
              .collection(DB_RELATIONS)
              .where({
                user_a_id: str(drop.user_a_id) < str(drop.user_b_id) ? str(drop.user_a_id) : str(drop.user_b_id),
                user_b_id: str(drop.user_a_id) < str(drop.user_b_id) ? str(drop.user_b_id) : str(drop.user_a_id),
                status: 'active'
              })
              .limit(20)
              .get()

            if (samePair.data.length > 1) {
              // 选"标签非空数量"最多的当主关系
              const score = function (r) {
                return (str(r.label_a) ? 1 : 0) + (str(r.label_b) ? 1 : 0) + (str(r.category) ? 1 : 0)
              }
              const sorted = samePair.data.slice().sort(function (x, y) {
                return score(y) - score(x)
              })
              const mainRel = sorted[0]

              for (let j = 1; j < sorted.length; j++) {
                const sub = sorted[j]
                const fill = {}
                // 主关系缺什么就从次关系里补什么（不覆盖已有的）
                if (!str(mainRel.label_a) && str(sub.label_a)) {
                  fill.label_a = sub.label_a
                  fill.label_a_color = str(sub.label_a_color)
                }
                if (!str(mainRel.label_b) && str(sub.label_b)) {
                  fill.label_b = sub.label_b
                  fill.label_b_color = str(sub.label_b_color)
                }
                if (!str(mainRel.category) && str(sub.category)) fill.category = sub.category
                if (!str(mainRel.conversation_id)) fill.conversation_id = keep._id
                if (!str(mainRel.source_type) && str(sub.source_type)) fill.source_type = sub.source_type

                if (Object.keys(fill).length) {
                  await db.collection(DB_RELATIONS).doc(mainRel._id).update(fill)
                  Object.assign(mainRel, fill)
                  DEDUP.relations_filled++
                }
                // 次关系上的 conversation_id 先清掉再删，避免残留指向
                await db.collection(DB_RELATIONS).doc(sub._id).remove()
                DEDUP.relations_removed++
              }
            }

            // ④ 删空壳会话
            await db.collection(DB_CONVERSATIONS).doc(drop._id).remove()
            DEDUP.deleted++
            DEDUP.merged++
          } catch (e) {
            console.warn('[migrate-pairkey] dedupe failed for ' + drop._id + ': ' + e.message)
          }
        }
      }

      report.dedupe = DEDUP
    }

    return {
      code: 0,
      msg: dryRun ? '演练完成，没有改库' : '迁移完成',
      data: report
    }
  } catch (e) {
    return {
      code: e.bizCode || 500,
      msg: e.message || '服务异常'
    }
  }
}
