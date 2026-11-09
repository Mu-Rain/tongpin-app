'use strict'

/**
 * 黑名单 —— 用户主页三点菜单 / 聊天页顶部提示条 / 会话列表过滤 用
 *
 * 入参：{ token, action, target_user_id?, target_user_ids? }
 *   action = 'add'    { token, action:'add',    target_user_id }
 *   action = 'remove' { token, action:'remove', target_user_id }
 *   action = 'list'   { token, action:'list' }
 *   action = 'status' { token, action:'status', target_user_ids: [...] }   最多 50 个
 * 出参统一 { code, msg, data }
 *   add    → { blocked: true }
 *   remove → { blocked: false }
 *   list   → { list: [{ user_id, nickname, avatar, avatar_url, created_at }], total }   上限 100
 *              avatar 是库里的原值（可能是 cloud:// fileID），avatar_url 是能直接塞进
 *              <image src> 的临时链接，换不出来是空串 —— 两个都给，前端才有得兜。
 *   status → { map: { '<targetId>': true } }   只放「我拉黑过的人」
 *
 * ★ 为什么黑名单是**单向**的：A 拉黑 B 不等于 B 拉黑 A。
 *   所以 message-send 要分别查两个方向：
 *     (owner_id=对方, target_id=我) → 「对方已拒收你的消息」
 *     (owner_id=我,   target_id=对方) → 「你把对方加入了黑名单」
 *   一个 (owner_id,target_id) 唯一键同时装下两个方向，不需要 status 字段。
 *
 * ★ 为什么单独一张表，而不是在 friendships / conversations 上加个 blocked 字段：
 *   ① 我要拉黑的人可能**还不是好友、还没有会话**（搜索结果、卡片详情里直接拉黑），
 *      挂在关系表上就没地方存；
 *   ② 关系表是「两个人的」一行，黑名单是「我一个人的」一行 —— 和 user_remarks
 *      同样的道理：一对人共享的行装不下两份不同的私有状态。
 *
 * ★ add 之后顺手做两件事（删好友、取消 pending 申请）：
 *   产品决策 D2「黑名单是单向彻底静默：他也加不了我好友」——
 *   只拦 message-send 不够，加好友这条路也必须堵死，否则他还能把申请塞给我。
 *   ★ 这两步**各自 try/catch**：friendships / friend_requests 是别的模块的表，
 *     它们写失败不能让「拉黑」这个用户真正点了的动作失败。
 *   ★ 删好友之前还要补一条 friend_unlinks（三态用：friendships 删掉之后
 *     is_friend:false 就无法区分「从来不是好友」和「当过好友又解除」），
 *     同样独立 try/catch；且只在**确实有好友行**时才写。
 *
 * ★ status 查询失败降级 { map: {} }：它是给列表页打「已拉黑」标记的附属查询，
 *   user_blocks 表还没建（第一次写入才自动创建）时不该让聊天页白屏。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const DB_BLOCKS = 'user_blocks'
const DB_FRIENDSHIPS = 'friendships'
const DB_REQUESTS = 'friend_requests'
const DB_UNLINKS = 'friend_unlinks'

// list 一次最多 100 条：黑名单是低频功能，超过 100 说明该分页了
const LIST_MAX = 100
// status 一次最多问 50 个人，避免客户端一次把全站都问一遍
const STATUS_MAX = 50

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

/** 两个人的固定键：字符串小的在前。与 friend-request 的 orderPair 同语义 */
function orderPair(x, y) {
  return x < y ? [x, y] : [y, x]
}

/**
 * 头像换临时链接（黑名单列表用）。
 * 库里 avatar 存的是 cloud:// fileID，<image> 只认 http：
 * 不换的话黑名单页上一排头像全是裂图。
 * 整页一次批量 getTempFileURL；换不出来留空串，前端自然落到默认头像。
 * 与 buddy-list 的 resolveListAvatars 同一写法，只是不改写 avatar 原值。
 */
async function resolveListAvatarUrls(list) {
  const ids = []
  for (let i = 0; i < list.length; i++) {
    const u = str(list[i].avatar)
    list[i].avatar_url = ''
    if (u.indexOf('cloud://') === 0) {
      if (ids.indexOf(u) < 0) ids.push(u)
    } else if (u.indexOf('http') === 0) {
      // 已经是外链（老数据 / 第三方头像），不用换
      list[i].avatar_url = u
    }
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
      if (map[list[i].avatar]) list[i].avatar_url = map[list[i].avatar]
    }
  } catch (err) {
    // 换链失败保留空串：前端显示默认头像，列表本身照常返回
    console.warn('[user-block] 头像换链失败', err && err.message)
  }
}

/**
 * 写一条「解除过好友」记录（一对人一行，重复解除只刷新时间和操作者）
 * ★ 与 friend-unlink 里同名函数同语义。
 *   改成「读全部行、保留最早一行、删掉多出来的」：唯一索引可能还没建
 *   （见 08-database-indexes，索引标为可选兜底），缺索引时并发解除会插出重复行，
 *   这里顺手收敛成一行，正确性不依赖索引是否存在。
 */
async function saveUnlink(ua, ub, byId) {
  const cond = { user_a_id: ua, user_b_id: ub }
  const now = Date.now()
  const found = await db.collection(DB_UNLINKS).where(cond).get()
  const rows = (found.data || []).slice()
  if (!rows.length) {
    await db.collection(DB_UNLINKS).add({
      user_a_id: ua,
      user_b_id: ub,
      removed_at: now,
      removed_by: byId
    })
    return
  }
  rows.sort((x, y) => (x.removed_at || 0) - (y.removed_at || 0))
  const keep = rows[0]
  await db
    .collection(DB_UNLINKS)
    .doc(keep._id)
    .update({ removed_at: now, removed_by: byId })
  for (let i = 1; i < rows.length; i++) {
    await db.collection(DB_UNLINKS).doc(rows[i]._id).remove()
  }
}

exports.main = async (event) => {
  try {
    event = event || {}
    const action = str(event.action)
    const me = await getUserByToken(str(event.token))

    // ============================================================
    // 拉黑（幂等）
    // ============================================================
    if (action === 'add') {
      const targetId = str(event.target_user_id)
      if (!targetId) fail('缺少 target_user_id', 400)
      if (targetId === me._id) fail('不能拉黑自己', 400)

      const cond = { owner_id: me._id, target_id: targetId }

      // 先查有没有旧行再决定插不插：靠唯一索引报错来判断「已存在」的话，
      // 线上索引还没建（见 08-database-indexes）时就会插出两行，
      // list 里同一个人出现两次。所以显式查一次，按行数分支。
      // ★ 整段 try/catch：user_blocks 表还没建时查询会报错，
      //   第一次拉黑必须能成功（add 本身会自动建表），不能在这里先挂掉。
      let existRows = []
      try {
        const exist = await db.collection(DB_BLOCKS).where(cond).limit(1).get()
        existRows = exist.data || []
      } catch (e) {
        existRows = []
      }

      if (!existRows.length) {
        await db.collection(DB_BLOCKS).add({
          owner_id: me._id,
          target_id: targetId,
          created_at: Date.now()
        })
      }

      // —— 顺手 1/2：删掉我和他之间的好友关系 ——
      // friendships 约定 user_a_id < user_b_id（见 friend-unlink 第 21-23 行），
      // 否则同一对会存出两条镜像。这里用同一个 orderPair。
      const pair = orderPair(me._id, targetId)
      const friendCond = { user_a_id: pair[0], user_b_id: pair[1] }

      // 删之前先补一条 friend_unlinks：删完 friendships 行就再没有「当过好友」的痕迹。
      // ★ 只在**确实有好友行**时才写：从来不是好友的人被记成「解除过」的话，
      //   三态就退化回二态，别人的会话行会被无端收掉搭子标签。
      // ★ 独立 try/catch：friend_unlinks 是新集合，写失败不能让「拉黑」失败。
      try {
        const fRes = await db.collection(DB_FRIENDSHIPS).where(friendCond).limit(1).get()
        if (fRes.data && fRes.data.length) {
          await saveUnlink(pair[0], pair[1], me._id)
        }
      } catch (e) {
        /* friendships / friend_unlinks 表不存在或写失败：拉黑已经生效 */
      }

      try {
        await db.collection(DB_FRIENDSHIPS).where(friendCond).remove()
      } catch (e) {
        /* friendships 表不存在 / 写失败：拉黑已经生效，好友行留着也只是脏数据 */
      }

      // —— 顺手 2/2：把双方之间还挂着的 pending 申请置 canceled ——
      // 两个方向都要处理：他发给我的（我拉黑后不该再看到他的申请）、
      // 我发给他的（他不接收了，我不该还停在「等待对方同意」）。
      // 状态名沿用 friend-request 第 455 行的取值 'canceled'（一个 l），
      // 不要写成 'cancelled' —— 前端 message-list 第 119 行只认这四个状态。
      try {
        const now = Date.now()
        await db
          .collection(DB_REQUESTS)
          .where({ from_user_id: me._id, to_user_id: targetId, status: 'pending' })
          .update({ status: 'canceled', handled_at: now })
        await db
          .collection(DB_REQUESTS)
          .where({ from_user_id: targetId, to_user_id: me._id, status: 'pending' })
          .update({ status: 'canceled', handled_at: now })
      } catch (e) {
        /* friend_requests 表不存在 / 写失败：拉黑已经生效 */
      }

      return { code: 0, msg: 'ok', data: { blocked: true } }
    }

    // ============================================================
    // 解除拉黑（幂等：本来没拉黑也返回 ok）
    // ============================================================
    if (action === 'remove') {
      const targetId = str(event.target_user_id)
      if (!targetId) fail('缺少 target_user_id', 400)

      try {
        await db.collection(DB_BLOCKS).where({ owner_id: me._id, target_id: targetId }).remove()
      } catch (e) {
        /* 表不存在 = 本来就没拉黑过，结果一样是「不拉黑」 */
      }

      return { code: 0, msg: 'ok', data: { blocked: false } }
    }

    // ============================================================
    // 黑名单列表（黑名单管理页）
    // ============================================================
    if (action === 'list') {
      let rows = []
      try {
        const r = await db
          .collection(DB_BLOCKS)
          .where({ owner_id: me._id })
          .orderBy('created_at', 'desc')
          .limit(LIST_MAX)
          .get()
        rows = r.data || []
      } catch (e) {
        /* 表还没建 = 一条黑名单都没有 */
        rows = []
      }

      const ids = []
      for (const row of rows) {
        const t = str(row.target_id)
        if (t && ids.indexOf(t) < 0) ids.push(t)
      }

      // ★ 用户信息是**手写字段白名单**：uni-id-users 里有 token / mobile /
      //   password，绝不能整条下发。这里只取列表要显示的三样。
      const userMap = {}
      try {
        if (ids.length) {
          const uRes = await db
            .collection(DB_USERS)
            .where({ _id: dbCmd.in(ids) })
            .field({ _id: true, nickname: true, avatar: true })
            .get()
          for (const u of uRes.data || []) userMap[u._id] = u
        }
      } catch (e) {
        /* 用户表查不到：名字降级成「同学」，黑名单条目照常列出 */
      }

      const list = rows.map(function (row) {
        const t = str(row.target_id)
        const u = userMap[t] || {}
        return {
          user_id: t,
          nickname: str(u.nickname) || '同学',
          // avatar 原值保留（可能有别处依赖 fileID），avatar_url 给可渲染的临时链接
          // 取「能换链的那个」：老账号可能只写了 avatar_url
          avatar: str(u.avatar_url) || str(u.avatar),
          avatar_url: '',
          created_at: typeof row.created_at === 'number' ? row.created_at : 0
        }
      })

      // 一次批量换链。失败只让头像落空，绝不让黑名单列表本身报错
      await resolveListAvatarUrls(list)

      return { code: 0, msg: 'ok', data: { list: list, total: list.length } }
    }

    // ============================================================
    // 批量查「我拉黑过谁」（列表页 / 主页打标记用）
    // ============================================================
    if (action === 'status') {
      const raw = event.target_user_ids
      if (!Array.isArray(raw)) fail('target_user_ids 必须是数组', 400)

      // 过滤非字符串 / 空串 → 去重 → 截断到 50
      const ids = []
      for (const item of raw) {
        const id = str(item)
        if (!id) continue
        if (ids.indexOf(id) >= 0) continue
        ids.push(id)
        if (ids.length >= STATUS_MAX) break
      }

      const map = {}
      if (ids.length) {
        // ★ 查不到就返回空 map，不报错：这是附属查询，
        //   表没建时最坏的结果是「谁都没被拉黑」的标记不显示，
        //   绝不能因为它把整页主页 / 会话列表打挂。
        try {
          const r = await db
            .collection(DB_BLOCKS)
            .where({ owner_id: me._id, target_id: dbCmd.in(ids) })
            .limit(STATUS_MAX)
            .get()
          for (const row of r.data || []) {
            const t = str(row.target_id)
            if (t) map[t] = true
          }
        } catch (e) {
          /* 静默降级：map 保持空对象 */
        }
      }

      return { code: 0, msg: 'ok', data: { map: map } }
    }

    fail('不认识的动作：' + (action || '(空)'), 400)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '操作失败' }
  }
}
