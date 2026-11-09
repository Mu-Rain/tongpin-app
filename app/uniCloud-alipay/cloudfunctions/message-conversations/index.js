'use strict'

/**
 * 会话列表 —— 消息页（pages/messages/messages.vue）用
 *
 * 入参：{ token }
 * 出参：{ code, msg, data: { list: [会话…], total_unread } }
 *
 * 每个会话项包含（对应原型 renderConvos 的字段）：
 *   conversation_id / name / avatar / last_text / last_at / unread
 *   / buddy_tag / buddy_tag_color / school / is_friend / remark
 *
 *   remark：我给对方起的私有备注（user_remarks），没有就是空串。
 *   ★ 与 buddy_tag 是两回事：buddy_tag 是"这段搭子关系叫什么"，
 *     成为好友后会被收掉；remark 是"这个人叫什么"，一直都在。
 *
 *   is_friend：我和对方是不是好友（布尔）。★ 必须单独给这个标识，因为
 *   「成为好友即收掉搭子」——accept 好友申请时会把双方全部 active 搭子置 ended，
 *   于是下面按 status=active 拼出来的 buddy_tags 会整行消失。若不补这个标识，
 *   用户会以为关系断了。搭子标签和好友标识是两种关系，互斥但都要能显示。
 *
 *   relation_state：'friend' | 'unfriended' | 'none'。is_friend 是二态，分不出
 *   「从来不是好友的搭子」和「当过好友又解除的」—— 后者 friendships 行已被删，
 *   只剩 friend_unlinks 里的一行。判定优先级：friendships 有行 → friend；
 *   否则 friend_unlinks 有行 → unfriended；否则 none。
 *   ★ 只要不是 none 就把搭子标签收掉（buddy_tag 置 ''、buddy_tags 置 []）：
 *   好友之间收，**解除好友之后也要收**，否则会话行上还挂着一段
 *   「我们已经不是好友了」的标签，而标签本身是导航参数里的静态快照，不会自己刷新。
 *
 * ★ 为什么不直接读表：conversations 和 conversation_members 的 client
 *   权限都是 false（只有云函数能读），而且列表需要"对方是谁、搭子标签叫啥"
 *   这些跨表信息，客户端拼不出来。所以在一处批量拼好返回。
 *
 * ★ 为什么 unread 不从 messages 数：见 06 文档 §3.8 —— 几十个会话每个都
 *   count 一次消息表会卡。unread_count 是写消息时维护在 members 上的。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_CONVERSATIONS = 'conversations'
const DB_MEMBERS = 'conversation_members'
const DB_RELATIONS = 'buddy_relations'
const DB_FRIENDSHIPS = 'friendships'
const DB_UNLINKS = 'friend_unlinks'
const DB_REMARKS = 'user_remarks'
const DB_BLOCKS = 'user_blocks'

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 取用户头像的「可换链原值」。
 *
 * 库里头像有两个字段：
 *   avatar      uni-id 标准字段
 *   avatar_url  本项目历史字段（早期版本只写这个）
 * 两个都可能为空 —— user-me 里就明确写了「可能只有 avatar 或只有 avatar_url」。
 *
 * ★ 之前这里只读 avatar，导致「头像只存在 avatar_url 里的老账号」
 *   在消息列表里永远显示默认头像（别人能看见他，他看不见别人，反之亦然）。
 *   优先挑 cloud:// 的值：只有它换得出临时链接；历史 http 直链可能已经过期。
 */
function pickAvatar(u) {
  const a = str(u && u.avatar)
  const b = str(u && u.avatar_url)
  if (a.indexOf('cloud://') === 0) return a
  if (b.indexOf('cloud://') === 0) return b
  return a || b
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  return r.data[0]
}

/**
 * 列表里的头像换临时链接：库里存 cloud:// fileID，<image> 只认 http 链接。
 * 一页一次批量换；失败保留原值，头像裂了不该让整页报错。
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
  } catch (e) {
    console.warn('[message-conversations] 头像换链失败', e && e.message)
  }
}

exports.main = async (event) => {
  try {
    const me = await getUserByToken(str(event.token))

    // —— 1) 我参与的所有会话（按我这一行的更新时间倒序）——
    const myMembers = await db
      .collection(DB_MEMBERS)
      .where({ user_id: me._id })
      .limit(200)
      .get()

    if (!myMembers.data.length) {
      return { code: 0, msg: 'ok', data: { list: [], total_unread: 0 } }
    }

    const convIds = myMembers.data.map(function (m) {
      return m.conversation_id
    })

    // —— 2) 批量取会话本体（一次查，不做 N+1）——
    const convRes = await db
      .collection(DB_CONVERSATIONS)
      .where({ _id: dbCmd.in(convIds) })
      .get()
    const convMap = {}
    for (const c of convRes.data) convMap[c._id] = c

    // —— 3) 取每个会话的"其他成员"（direct 会话就一个人）——
    const allMembers = await db
      .collection(DB_MEMBERS)
      .where({ conversation_id: dbCmd.in(convIds) })
      .get()

    const othersByConv = {}
    for (const m of allMembers.data) {
      if (m.user_id === me._id) continue
      if (!othersByConv[m.conversation_id]) othersByConv[m.conversation_id] = []
      othersByConv[m.conversation_id].push(m.user_id)
    }

    // —— 4) 批量取对方用户信息 ——
    const otherIds = []
    for (const cid in othersByConv) {
      for (const uid of othersByConv[cid]) {
        if (otherIds.indexOf(uid) < 0) otherIds.push(uid)
      }
    }
    const userMap = {}
    if (otherIds.length) {
      const uRes = await db
        .collection(DB_USERS)
        .where({ _id: dbCmd.in(otherIds) })
        .field({ _id: true, nickname: true, avatar: true, avatar_url: true, school: true, school_name: true })
        .get()
      for (const u of uRes.data) userMap[u._id] = u
    }

    // —— 5) 批量取搭子关系（要显示"考研战友"这种自定义标签和颜色）——
    // ★ 改法：从"按会话的 buddy_relation_id"改成"按一对人"。
    //   一对人现在可以有多条 active 关系（考研搭子 + 夜跑搭子），
    //   但只有一个会话。会话是聊天室，关系是"我们因为什么成了搭子"。
    //   所以这里按 (user_a_id, user_b_id) 一次性把两个人的全部关系捞出来。
    //
    //   为什么要按人查而不是按会话查：老会话的 buddy_relation_id 有值，
    //   新会话（card-apply / buddy-invite 建的）该字段是空字符串，
    //   只按会话查会让新会话的标签全丢。
    const relMap = {}   // key = "aId|bId"，value = 关系数组
    const relIds = []
    for (const c of convRes.data) {
      let a = c.user_a_id || ''
      let b = c.user_b_id || ''
      // 极老的会话没有 user_a_id/user_b_id，退回用成员表反推
      if (!a || !b) {
        const others = othersByConv[c._id] || []
        const myId = me._id
        a = myId
        b = others[0] || ''
      }
      if (!a || !b) continue
      const key = a < b ? a + '|' + b : b + '|' + a
      if (relIds.indexOf(key) < 0) relIds.push(key)
    }

    if (relIds.length) {
      // 两批查：我是 a 的和我是 b 的。不用 or，避免条件写错
      const rAsA = await db
        .collection(DB_RELATIONS)
        .where({ user_a_id: me._id, status: 'active' })
        .limit(200)
        .get()
      const rAsB = await db
        .collection(DB_RELATIONS)
        .where({ user_b_id: me._id, status: 'active' })
        .limit(200)
        .get()

      const myRels = rAsA.data.concat(rAsB.data)
      for (const r of myRels) {
        // ★ key 必须和下面拼装时用的 pairKeyStr 用同一套归一化（小 id 在前）。
        //   关系表里 a/b 的顺序是写入方决定的，不归一化的话，当我的 _id 比对方大时
        //   key 会是 "我|他"，而查的时候算出来是 "他|我" —— 对不上，
        //   buddy_tags 整行丢失，pin_locked 也就永远 false（搭子被清空后本该置顶却掉队）。
        const ra = str(r.user_a_id)
        const rb = str(r.user_b_id)
        if (!ra || !rb) continue
        const key = ra < rb ? ra + '|' + rb : rb + '|' + ra
        if (!relMap[key]) relMap[key] = []
        // 同一关系可能两边都命中（自己跟自己？不可能，但防一下）
        if (relMap[key].indexOf(r) < 0) relMap[key].push(r)
      }
    }

    // —— 5.5) 批量取好友关系（只为打一个"好友"标识）——
    // ★ 为什么要有这一步：产品决策是「成为好友即收掉搭子」——好友申请的
    //   accept 分支会把双方所有 active 的 buddy_relations 置成 ended
    //   （ended_by = 'friend'）。所以上面第 5 步按 status=active 拼出来的
    //   buddy_tags 会在成为好友的那一刻整行消失，用户会以为关系断了。
    //   搭子没了，好友还在，会话行上必须留一个"好友"标识。
    //
    // ★ 为什么整段 try/catch：friendships 是新表，可能还没建（第一次写入才
    //   自动创建）。查询失败绝不能把整个消息列表打挂——降级成"全部不是好友"
    //   即可，用户少一个小徽标，但会话、未读、标签全都照常显示。
    const friendSet = {}   // key = 对方 user_id，value = true
    try {
      // 两批查：我是 a 的和我是 b 的。不用 or，与第 5 步写法保持一致
      const fAsA = await db
        .collection(DB_FRIENDSHIPS)
        .where({ user_a_id: me._id })
        .limit(200)
        .get()
      const fAsB = await db
        .collection(DB_FRIENDSHIPS)
        .where({ user_b_id: me._id })
        .limit(200)
        .get()
      const myFriends = fAsA.data.concat(fAsB.data)
      for (const fr of myFriends) {
        // 好友关系存双向一条，a/b 谁是我不一定
        const other = fr.user_a_id === me._id ? fr.user_b_id : fr.user_a_id
        if (other) friendSet[other] = true
      }
    } catch (e) {
      // 表不存在 / 查询报错：静默降级，一行都不影响
    }

    // —— 5.58) 批量取"解除过好友"的人（三态的第二态）——
    // ★ friendships 行删掉之后就没有「当过好友」的痕迹了，只有这张表有。
    //   优先级低于 5.5：有好友行就是好友，两个集合都有行时按好友算（重新加回好友）。
    // ★ 与 5.5 同样的理由整段 try/catch：friend_unlinks 是新集合，可能还没建，
    //   查询失败降级成「一个都没有」，会话行照常显示成 none。
    const unlinkSet = {}   // key = 对方 user_id，value = true
    try {
      const uAsA = await db
        .collection(DB_UNLINKS)
        .where({ user_a_id: me._id })
        .limit(200)
        .get()
      const uAsB = await db
        .collection(DB_UNLINKS)
        .where({ user_b_id: me._id })
        .limit(200)
        .get()
      const myUnlinks = uAsA.data.concat(uAsB.data)
      for (const ur of myUnlinks) {
        // 解除记录存双向一条，谁是 a 谁是 b 不一定
        const other = ur.user_a_id === me._id ? ur.user_b_id : ur.user_a_id
        if (other) unlinkSet[other] = true
      }
    } catch (e) {
      // 表不存在 / 查询报错：静默降级，一行都不影响
    }

    // —— 5.55) 我拉黑了谁（D2：会话从我的消息页消失）——
    // ★ 整段 try/catch：user_blocks 是新集合，第一次写入才自动创建，
    //   表还没建时查询会报错 —— 降级成「一个都没拉黑」，会话列表照常显示。
    const blockSet = {}   // key = 被我拉黑的 user_id，value = true
    try {
      const blkRes = await db
        .collection(DB_BLOCKS)
        .where({ owner_id: me._id })
        .limit(200)
        .get()
      for (const row of blkRes.data) {
        const t = str(row.target_id)
        if (t) blockSet[t] = true
      }
    } catch (e) {
      // 表不存在 / 查询报错：静默降级，一行都不影响
    }

    // —— 5.6) 批量取用户备注（我给对方起的名字）——
    // ★ 与上面第 5 步的 buddy_tags 是两回事：
    //   buddy_tags 是"我们因为什么成了搭子"（可以有多段，成为好友后会被收掉）；
    //   remark 是"我管他叫什么"（一个人一个，跟关系存亡无关）。
    //   所以好友标识旁边还要有备注 —— 否则成为好友、搭子标签被收掉之后，
    //   会话行就只剩对方注册时的昵称了。
    //
    // ★ 与 5.5 同样的理由整段 try/catch：user_remarks 是新集合，可能还没建。
    //   查不到就降级成"全部没有备注"，会话、未读、标签全都照常显示。
    const remarkMap = {}   // key = 对方 user_id，value = 备注
    try {
      if (otherIds.length) {
        const rmRes = await db
          .collection(DB_REMARKS)
          .where({ owner_id: me._id, target_user_id: dbCmd.in(otherIds) })
          .limit(200)
          .get()
        for (const row of rmRes.data) {
          const t = str(row.target_user_id)
          const text = str(row.remark)
          if (t && text) remarkMap[t] = text
        }
      }
    } catch (e) {
      // 表不存在 / 查询报错：静默降级，一行都不影响
    }

    // —— 6) 拼装 ——
    // 先把我拉黑了的会话整行剔掉（对方在我的 blockSet 里就不显示）
    const visibleMembers = myMembers.data.filter(function (m) {
      const oid = (othersByConv[m.conversation_id] || [])[0] || ''
      return !blockSet[oid]
    })

    let totalUnread = 0
    const list = visibleMembers.map(function (m) {
      const conv = convMap[m.conversation_id] || {}
      const otherId = (othersByConv[m.conversation_id] || [])[0] || ''
      const other = userMap[otherId] || {}

      // 搭子标签：关系表里 a/b 两侧各存一份，谁是 a 谁是 b 不一定。
      //
      // ★ "合成一张卡"：一对人可能有多条关系，但消息列表只显示一条会话。
      //   所以把多段关系的标签**合成一张卡**摆在会话行上：
      //     - tags[]     完整的标签数组，每个带自己的颜色，前端可以平铺展示
      //     - buddy_tag  取第一条有标签的，作为主标签（兼容老前端只读一个的地方）
      //   这样"考研搭子 + 夜跑搭子"两个标签都会出现在同一行，
      //   而不是像之前那样只显示一条、另一条凭空消失。
      const pairA = str(conv.user_a_id) || me._id
      const pairB = str(conv.user_b_id) || otherId
      const pairKeyStr = pairA < pairB ? pairA + '|' + pairB : pairB + '|' + pairA
      const myRels = relMap[pairKeyStr] || []

      const tags = []
      for (const rel of myRels) {
        let t = ''
        let c = ''
        if (rel.user_a_id === me._id) {
          t = str(rel.label_a)
          c = str(rel.label_a_color)
        } else if (rel.user_b_id === me._id) {
          t = str(rel.label_b)
          c = str(rel.label_b_color)
        }
        // 只收有标签的关系；用户还没起名的关系不占位置
        if (t) tags.push({ label: t, color: c, category: str(rel.category) || 'other' })
      }

      let tag = ''
      let tagColor = ''
      if (tags.length) {
        tag = tags[0].label
        tagColor = tags[0].color
      }

      // 三态（见文件头）：好友行优先，其次解除记录，都没有才是 never。
      // ★ 非 none 一律把标签收掉：好友之间收（老逻辑），**解除好友之后也收** ——
      //   解好友只删 friendships 行，库里的 active 搭子可能还在，不收就会显示
      //   一段"我们已经不是好友了"的标签。
      const relationState = friendSet[otherId]
        ? 'friend'
        : unlinkSet[otherId]
          ? 'unfriended'
          : 'none'
      if (relationState !== 'none') {
        tags.length = 0
        tag = ''
        tagColor = ''
      }

      const unread = typeof m.unread_count === 'number' ? m.unread_count : 0

      // 每人一份的会话设置。老数据没有这些字段 → 一律当默认值（契约 §2.1）
      const pinnedRaw = typeof m.pinned === 'boolean' ? m.pinned : false
      const muted = typeof m.muted === 'boolean' ? m.muted : false
      const clearedAt = typeof m.cleared_at === 'number' ? m.cleared_at : 0

      // pin_locked：我和对方之间有 active 搭子关系就强制置顶（D3）。
      // ★ 直接复用上面第 5 步已经查好的 relMap，不重复查库
      const pinLocked = myRels.length > 0
      const pinned = pinLocked ? true : pinnedRaw

      // last_at 必须先算好 —— 下面的「清空过滤」要用它判断有没有新消息
      const lastText = conv.last_message_text || '还没有聊过，打个招呼吧'
      const lastAt = conv.last_message_at || conv.created_at || 0

      // —— 清空过的会话整行不返回（契约 §4.3-6）——
      // ★ 语义：清空 = 这段会话从我的消息页消失（messages.vue 的确认文案就是这么
      //   向用户承诺的）。只把 last_text 改成「（无消息）」会变成「删了又回来」。
      // ★ 清空之后对方又发来新消息 → last_at > cleared_at → 会话自动重新出现
      //   （微信/QQ 同款行为）；搭子强制置顶的会话同理，有新消息时照旧回到最前。
      // ★ cleared_at 为 0（老数据 / 从没清空过）时 clearedAt > 0 不成立，一行都不影响。
      // ★ 早退发生在累计未读之前 —— 被剔除的行一定不计入 total_unread。
      if (clearedAt > 0 && lastAt <= clearedAt) return null

      // 免打扰不计入角标（契约 §4.3-7）
      if (!muted) totalUnread += unread

      return {
        conversation_id: m.conversation_id,
        other_user_id: otherId,
        name: other.nickname || '同学',
        // 我给这个人起的备注（没有就是空串）。前端优先显示它，回退到 name
        remark: remarkMap[otherId] || '',
        avatar: pickAvatar(other),
        school: other.school_name || other.school || '',
        last_text: lastText,
        last_at: lastAt,
        unread: unread,
        // 我这一侧的会话设置（契约 §4.3-1）
        pinned: pinned,
        muted: muted,
        pin_locked: pinLocked,
        buddy_tag: tag,
        buddy_tag_color: tagColor,
        // 多搭子：这一对人在你这边显示的全部标签（合成一张卡）
        buddy_tags: tags,
        buddy_tag_count: tags.length,
        // 好友标识。成为好友时搭子标签会被收掉，靠这个字段让会话行不至于
        // 变成"什么关系都没有"的样子。查不到表时恒为 false。
        is_friend: !!friendSet[otherId],
        // ★ 三态好友关系，追加在最后：既有字段名/顺序/语义零改动
        relation_state: relationState
      }
    }).filter(Boolean)   // 上面 return null 的行（已清空且无新消息）在这里被摘掉

    await resolveListAvatars(list)

    // 三段排序（契约 §4.3-5，服务端排好，前端不再排）：
    //   ① pin_locked 最前 → ② 其次 pinned → ③ 其余，各自内部按 last_at 降序
    list.sort(function (a, b) {
      const ra = a.pin_locked ? 0 : a.pinned ? 1 : 2
      const rb = b.pin_locked ? 0 : b.pinned ? 1 : 2
      if (ra !== rb) return ra - rb
      return (b.last_at || 0) - (a.last_at || 0)
    })

    return { code: 0, msg: 'ok', data: { list: list, total_unread: totalUnread } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '加载失败' }
  }
}
