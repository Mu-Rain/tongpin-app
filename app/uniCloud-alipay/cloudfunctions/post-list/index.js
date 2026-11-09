'use strict'

/**
 * 同频圈动态列表
 *
 * 入参：
 *   token     可选。登录了才能拿到 liked（未登录一律 false）；
 *             scope='mine' 时必传 —— 没有 token 就认不出「我」
 *   scope     可选。school / city / all / mine，默认 all
 *             mine = 只拉自己发的动态，按 created_at 倒序分页
 *   page      可选，默认 1
 *   page_size 可选，默认 10，上限 30
 *
 * 出参：{ code, msg, data: { list, has_more, page, degraded, reason } }
 *
 * 认证门槛（与 card-list 对齐）：
 *   scope='school' 且用户未认证 → 直接空列表 + degraded='need_verify'。
 *   其余 scope（all / city）不受影响 —— 动态是日常内容，没认证也该刷得到东西。
 *
 * 未登录门槛：
 *   scope='mine' 且没有 token（或 token 已失效）→ **不报错**，返回 code:0 +
 *   空列表 + has_more:false + reason='need_login'。前端据此显示「去登录」，
 *   而不是把空列表当成「你确实没发过动态」。
 *
 * 每条形状（前端直接渲染）：
 *   {
 *     _id, content, images: [可直接渲染的 url], image_ids: [换链前的 cloud:// 原值],
 *     sizes: [{ w, h } | null]（与 images 同序同长；该动态没存 images_dim 时整列 null）, media_type,
 *     like_count, liked, comment_count, created_at, is_mine,
 *     owner: { _id, nickname, avatar_url, school, is_verified }
 *   }
 */

const db = uniCloud.database()
const dbCmd = db.command

// 单边像素上限：与 post-publish 的写入校验对齐，读的时候越界值一律当没有
const MAX_IMAGE_DIM = 20000

const DB_USERS = 'uni-id-users'
const COLL_POSTS = 'posts'
const COLL_LIKES = 'card_likes'
const COLL_FRIENDS = 'friendships'

const MAX_PAGE_SIZE = 30
const DEFAULT_PAGE_SIZE = 10

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v, def) {
  const n = parseInt(v, 10)
  return n > 0 ? n : def
}

/**
 * cloud:// fileID 换成可直接渲染的临时链接。
 * 放在服务端换：一页图一次批量搞定，前端不用为列表单独维护「换链接 + 过期缓存」。
 * 换失败保留原值：白框只是少一张图，抛出去会让整页 500。
 */
async function resolveImageUrls(list) {
  const ids = []
  const push = (u) => {
    if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
  }
  for (let i = 0; i < list.length; i++) {
    const arr = list[i].images || []
    for (let j = 0; j < arr.length; j++) push(arr[j])
    // 作者头像也是 cloud:// fileID，<image> 只认 http 链接。
    // 和动态图放同一批换，省一次往返；不换的话头像永远只显示昵称首字。
    if (list[i].owner) push(list[i].owner.avatar_url)
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
      const arr = list[i].images || []
      for (let j = 0; j < arr.length; j++) {
        if (map[arr[j]]) arr[j] = map[arr[j]]
      }
      const o = list[i].owner
      if (o && map[o.avatar_url]) o.avatar_url = map[o.avatar_url]
    }
  } catch (e) {
    console.warn('[post-list] getTempFileURL 失败，图片按原值返回', e && e.message)
  }
}

/** 单个宽/高值：只认 1~MAX_IMAGE_DIM 的正整数，其余当没存（返回 0） */
function imageDim(v) {
  const n = Number(v)
  if (!isFinite(n) || Math.floor(n) !== n) return 0
  if (n < 1 || n > MAX_IMAGE_DIM) return 0
  return n
}

/**
 * 尺寸数组：与 images 同序同长，元素是 { w, h } 或 null。
 *
 * ★ 为什么老数据也要返回等长的 null 数组：前端可以无条件按下标取用，
 *   不必为「没有 images_dim」再写一条分支，也就不会出现两种渲染路径。
 * ★ 为什么读的时候还要再收敛一遍：库里可能存在手改/历史写入的脏值，
 *   一个 NaN 宽高会让前端算出 NaN 高度，比没有尺寸更糟。
 */
function buildSizes(images, dims) {
  const list = Array.isArray(images) ? images : []
  const raw = Array.isArray(dims) ? dims : []
  const out = []
  for (let i = 0; i < list.length; i++) {
    const d = raw[i]
    const ok = d && typeof d === 'object' && !Array.isArray(d)
    const w = ok ? imageDim(d.w) : 0
    const h = ok ? imageDim(d.h) : 0
    out.push(w && h ? { w: w, h: h } : null)
  }
  return out
}

/* 挑「最该用的那个头像标识」：cloud:// fileID（永久） > 包内静态路径 > http（可能是过期临时链接）。
 * 写成 owner.avatar_url || owner.avatar 是错的：库里 avatar 是 cloud://，有些历史账号的
 * avatar_url 是当年换出来的临时链接，过期后优先取它就是给前端一条死链 ——
 * 有本地缓存的设备还看得见，换账号/换设备就是空圆。 */
function pickAvatar(u) {
  const cands = [u && u.avatar, u && u.avatar_url]
  let best = ''
  let bestRank = 0
  for (let i = 0; i < cands.length; i++) {
    const v = typeof cands[i] === 'string' ? cands[i] : ''
    let rank = 0
    if (v.indexOf('cloud://') === 0) rank = 3
    else if (v.charAt(0) === '/') rank = 2
    else if (v.indexOf('http') === 0) rank = 1
    if (rank > bestRank) {
      bestRank = rank
      best = v
    }
  }
  return best
}
exports.main = async (event) => {
  try {
    const token = str(event.token)
    const scope = str(event.scope) || 'all'
    const page = num(event.page, 1)
    const pageSize = Math.min(num(event.page_size, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)

    let me = null
    if (token) {
      const uRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
      if (uRes.data.length) me = uRes.data[0]
    }

    let degraded = ''
    const where = { status: dbCmd.neq('removed') }

    // 学生认证：两套字段名取或（schoolVerified 是第 1 天的写法，is_verified 是设计文档的写法）
    const verified = !!(me && (me.schoolVerified === true || me.is_verified === true))

    // scope='mine'：「我的动态」页专用，只拉自己发的动态。
    // 放在 school/city 之前：mine 不带任何地理/学校条件，走进去就返回了，
    // 不会被下面的降级分支改成「全站动态」——那等于把别人的动态当成我的。
    if (scope === 'mine') {
      if (!me) {
        // 未登录不算失败：这一页只是「看看自己发过什么」。
        // 回 500 会让前端分不清「网络挂了」和「没登录」，也就给不出「去登录」入口。
        return {
          code: 0,
          msg: 'ok',
          data: {
            list: [],
            total: 0,
            has_more: false,
            page,
            degraded: '',
            reason: 'need_login',
            visibility_filtered: 0
          }
        }
      }
      // owner_id 精确匹配即可。自己发的动态一定能过下面那道可见性闸
      // （可见性过滤里已有 if (p.owner_id === me._id) return true），不需要额外放行。
      where.owner_id = me._id
    }

    if (scope === 'school' && !verified) {
      // 同校动态只对已认证用户开放。这里**不降级到全站**：动态是内容流，
      // 降级会让用户以为看到的就是自己学校的动态，其实混着全站的人 —— 比空列表更容易误解。
      // 出参形状与正常路径一致（list / has_more / page / degraded / visibility_filtered），
      // 只多给一个 total:0 明确「确实零条」，不是"没加载出来"。
      return {
        code: 0,
        msg: 'ok',
        data: {
          list: [],
          total: 0,
          has_more: false,
          page,
          degraded: 'need_verify',
          visibility_filtered: 0
        }
      }
    }

    if (scope === 'school') {
      if (me && me.school_id) {
        where.school_id = me.school_id
      } else {
        // 没登录或没学校：降到全站而不是给一片空白
        degraded = 'no_school'
      }
    } else if (scope === 'city') {
      if (me && me.city_code) {
        where.city_code = me.city_code
      } else {
        degraded = 'no_city'
      }
    }

    const res = await db
      .collection(COLL_POSTS)
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = res.data || []

    // 作者：一次批量查，不做 N+1
    const ownerIds = []
    rows.forEach((p) => {
      if (p.owner_id && ownerIds.indexOf(p.owner_id) < 0) ownerIds.push(p.owner_id)
    })
    const ownerMap = {}
    const loadOwners = async () => {
      if (!ownerIds.length) return
      // ★ 故意不 try/catch：作者资料挂了整页本来就没意义，保持既有「整页 500」口径。
      //   所以它 reject 时 Promise.all 也 reject —— 行为与串行时代一致。
      const uRes = await db
        .collection(DB_USERS)
        .where({ _id: dbCmd.in(ownerIds) })
        .field({
          nickname: true,
          avatar_url: true,
          avatar: true,
          school: true,
          is_verified: true,
          schoolVerified: true
        })
        .get()
      ;(uRes.data || []).forEach((u) => {
        ownerMap[u._id] = u
      })
    }

    // ============================================================
    // 动态可见性过滤（uni-id-users.moments_visibility：all / friends / self）
    // ============================================================
    // 同频圈的读路径只有这一处，所以这道闸必须落在这里：
    // 用户在设置页选了「仅好友 / 仅自己」之后，别人在动态流里就不该再看到他。
    //
    // 三档口径：
    //   'all'（缺省）  全放行 —— 历史用户根本没有这个字段，缺省必须是全放行，
    //                  否则一次功能上线就让全站老用户互相看不见。
    //   'friends'      是我、或在我好友集合里，才放行
    //   'self'         只有 owner_id === me._id 才放行
    //
    // ★ 任何一次附属查询失败都**放行**并 console.warn：宁可漏拦几条，
    //   也不能让整页动态因为一次附属查询变成空白。
    // ★ 分页语义不变：has_more 仍按过滤前的 rows 算，过滤只影响本页展示条数。
    //   若拿过滤后的数组算 has_more，被过滤几条就会提前判定"没有下一页"，
    //   后面的内容永远刷不出来。
    let visibleRows = rows
    let visibilityFiltered = 0
    const loadVisibility = async () => {
      if (!(me && me._id && rows.length)) return
      try {
        // 可见性单独查一次 users（只取 _id + moments_visibility）。
        // ★ 不挂在上面那次作者查询上，就是为了让它的失败**只影响自己**：
        //   挂在一起的话，它一挂整页就 500 —— 那正是"整页消失"。
        const visIds = []
        rows.forEach((p) => {
          if (p.owner_id && visIds.indexOf(p.owner_id) < 0) visIds.push(p.owner_id)
        })
        const visRes = await db
          .collection(DB_USERS)
          .where({ _id: dbCmd.in(visIds) })
          .field({ _id: true, moments_visibility: true })
          .get()

        const visMap = {}
        let needFriends = false
        ;(visRes.data || []).forEach((u) => {
          const raw = u.moments_visibility
          // 白名单外的脏数据一律当 'all'（放行），绝不当成更严格的那档
          visMap[u._id] = raw === 'friends' || raw === 'self' ? raw : 'all'
        })
        rows.forEach((p) => {
          if (visMap[p.owner_id] === 'friends') needFriends = true
        })

        // 好友集合只在真的有人设成 'friends' 时才查，省一次往返
        const friendSet = {}
        if (needFriends) {
          // friendships 的行是 { user_a_id, user_b_id, created_at }，**没有** status 字段
          // （解除好友时整行被 remove，见 friend-unlink）。所以只按两个方向取。
          // 这里若照 buddy_relations 的习惯加 status:'active'，会一条都查不到，
          // 结果变成「仅好友」的动态对谁都不可见 —— 那是把用户的内容全藏了。
          const frRes = await db
            .collection(COLL_FRIENDS)
            .where(dbCmd.or([{ user_a_id: me._id }, { user_b_id: me._id }]))
            .limit(200)
            .get()
          ;(frRes.data || []).forEach((f) => {
            const other = f.user_a_id === me._id ? f.user_b_id : f.user_a_id
            if (other) friendSet[other] = true
          })
        }

        visibleRows = rows.filter((p) => {
          const v = visMap[p.owner_id] || 'all'
          if (v === 'all') return true
          if (p.owner_id === me._id) return true
          if (v === 'friends') return !!friendSet[p.owner_id]
          return false
        })
        visibilityFiltered = rows.length - visibleRows.length
      } catch (e) {
        // 可见性数据算不出来 → 整段放行。漏拦几条是可接受的，白屏不可接受。
        console.warn('[post-list] 可见性过滤失败，本页按全放行处理', e && e.message)
        visibleRows = rows
        visibilityFiltered = 0
      }
    }

    // 我点过赞的动态：一次批量查，不做 N+1
    const likedMap = {}
    const loadLikes = async () => {
      if (!me) return
      // 用过滤前的 rows 取 id：likedMap 只会被 visibleRows 里的条目消费，
      // 多查几条本页不展示的没有副作用 —— 换来的是不必等可见性先算完。
      const ids = rows.map((p) => p._id)
      if (!ids.length) return
      try {
        const lRes = await db
          .collection(COLL_LIKES)
          .where({ user_id: me._id, card_id: dbCmd.in(ids) })
          .field({ card_id: true })
          .get()
        ;(lRes.data || []).forEach((x) => {
          likedMap[x.card_id] = true
        })
      } catch (e) {
        console.warn('[post-list] 点赞状态查询失败', e && e.message)
      }
    }

    // ★ 作者资料 / 可见性（内含好友集合）/ 我的点赞状态三者互不依赖，一次并发发出。
    //   串行要付三次网络往返，并发只付一次。resolveImageUrls 仍然留在最后 ——
    //   它吃的是最终的 list，且必须等 likedMap/ownerMap 都填好。
    //   任一带 try/catch 的分支失败都只影响自己（内部已放行），不会变成整页 500。
    await Promise.all([loadOwners(), loadVisibility(), loadLikes()])

    const list = visibleRows.map((p) => {
      const owner = ownerMap[p.owner_id] || {}
      return {
        _id: p._id,
        content: p.content || '',
        images: Array.isArray(p.images) ? p.images.slice(0, 3) : [],
        // 换链前的原始 fileID（cloud:// 永久有效）。分享到聊天时用它当封面：
        // 临时链接 2 小时就失效，存进消息 meta 就成了死图。
        image_ids: Array.isArray(p.images)
          ? p.images.filter((v) => typeof v === 'string' && v.indexOf('cloud://') === 0).slice(0, 3)
          : [],
        // 尺寸必须和上面 images 用同一份切片算出，否则两列长度不同、下标就错位了
        sizes: buildSizes(
          Array.isArray(p.images) ? p.images.slice(0, 3) : [],
          p.images_dim
        ),
        media_type: p.media_type || (Array.isArray(p.images) && p.images.length ? 'image' : 'text'),
        like_count: typeof p.like_count === 'number' ? p.like_count : 0,
        liked: !!likedMap[p._id],
        comment_count: typeof p.comment_count === 'number' ? p.comment_count : 0,
        created_at: p.created_at || 0,
        is_mine: !!(me && p.owner_id === me._id),
        owner: {
          _id: owner._id || '',
          nickname: owner.nickname || '同学',
          avatar_url: pickAvatar(owner),
          school: owner.school || '',
          // 兼容两套字段名（注册时写的 schoolVerified / 设计文档里的 is_verified）
          is_verified: !!(owner.is_verified || owner.schoolVerified)
        }
      }
    })

    await resolveImageUrls(list)

    return {
      code: 0,
      msg: 'ok',
      data: {
        list,
        // 分页仍按过滤前的 rows 算，过滤不改变"还有没有下一页"
        has_more: rows.length >= pageSize,
        page,
        degraded,
        // 本页被可见性挡掉的条数（number）。只在排查时用，前端不展示
        visibility_filtered: visibilityFiltered
      }
    }
  } catch (e) {
    return { code: 500, msg: e.message || '加载失败' }
  }
}
