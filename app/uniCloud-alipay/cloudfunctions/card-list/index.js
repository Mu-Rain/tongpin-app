'use strict'

/**
 * 搭子大厅列表
 *
 * 入参：
 *   token    可选。登录了才能看到"共同标签"高亮与申请状态
 *   type     可选。study / fitness / photo / meal / sport / other；不传 = 全部
 *   scope    可选。smart（首页智能档：同校 → 附近 → 城市）/ all（全站：所有 open 需求，
 *            不按城市 / 学校圈地，大厅「推荐」档就是它）/ school（同校）/
 *            nearby（附近）/ city（城市）/ mine（只看我自己发的，含已关闭），默认 school
 *   page     可选，默认 1
 *   page_size 可选，默认 20，上限 50
 *
 * 出参：{ code, msg, data: { list: [...], has_more, total, people_total, matched_total } }
 *
 * 每条卡片多两个字段（前端标签与「几公里」都用它们，本轮契约）：
 *   tier        'school' | 'nearby' | 'city' | 'remote'
 *               （school 同校 / nearby 附近 / city 我的城市 / remote 全站：
 *                 补位卡，以及不在我城市的卡 —— 它不属于大厅「城市」那一档）
 *   distance_km 与我的直线距离（km，一位小数）；任一方没坐标给 -1
 *
 * scope='school' 且未认证：直接空列表 + degraded='need_verify'，不报错也不降级到全站。
 *
 * 三个计数的口径各不相同，不能互相替换：
 *   total         卡片条数（当前筛选条件、不含分页）。has_more 分页靠它算，
 *                 换成人数会让翻页错乱 —— 这一条谁都不许改语义。
 *   people_total  候选里有几个不同的人（同一人发 3 条需求只算 1 个）。
 *   matched_total 与我标签有重合的人有几个 —— 同样按人去重，不是卡片数。
 * 后两个都是 0 或 null：
 *   0    是真空 —— 全量候选都扫过，确实是零；
 *   null 是不知道 —— 未登录、我没标签（只影响 matched_total）、候选多到扫不完
 *        （> MATCH_SCAN_MAX）、或者查询失败。
 * 前端把 0 当"真没人"、null 当"不知道"，所以宁可给 null 也绝不拿 0 凑数。
 *
 * 每条卡片的形状（前端直接渲染，不用再查）：
 *   {
 *     _id, type, title, description,
 *     location_name, start_time, expected_people, created_at,
 *     owner: { _id, nickname, avatar_url, school, is_verified, credit_score, user_no },
 *     tags: [{ _id, name, category }],
 *     common_tags: [tag_id],     // 与我的标签重合的，前端高亮
 *     is_mine: bool,
 *     tier: 'school' | 'nearby' | 'city' | 'remote' | 'mine',  // 档位（mine = 自己的卡，remote = 全站补位）
 *     distance_km: number                  // 没坐标 -1
 *   }
 */

const db = uniCloud.database()
const dbCmd = db.command
const $ = db.command.aggregate

// 集合名必须跟 user-register / user-login / user-tags 保持一致，否则查不到人
const DB_USERS = 'uni-id-users'

const TEASER_FIELDS = {
  _id: true,
  owner_id: true,
  type: true,
  title: true,
  description: true,
  school_id: true,
  city_code: true,
  // 坐标：分档和距离都要用，必须一起取出来（漏了它 tier 永远只剩 city）
  geo_lat: true,
  geo_lng: true,
  location_name: true,
  start_time: true,
  expected_people: true,
  status: true,
  created_at: true,
  images: true,
  media: true,
  image_urls: true
}

const USER_FIELDS = {
  _id: true,
  nickname: true,
  avatar_url: true,
  avatar: true,
  school: true,
  schoolVerified: true,
  is_verified: true,
  credit: true,
  credit_score: true,
  user_no: true
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// 附近档的半径（km）。10 公里约等于「一个校区圈 + 隔壁一小片」：
// 再大整座城市都算附近，标签就不带信息量了；再小新校区周边常常一个人都没有。
const NEARBY_KM = 10

// 分档候选的扫描上限（smart 与 nearby 各管各的，别合并成一个数）。
// smart 档排完序只返回 page_size 条（首页 10 条、大厅 20 条）：扫 300 张只为
// 排 10 条，首屏最贵的一次就耗在这。压到 120 仍然够排 6 屏 20 条。
const SMART_SCAN_MAX = 120
// nearby 档不能跟着降：附近要按真距离滤掉大半，候选池小了分档就不准。
const NEARBY_SCAN_MAX = 300

// 既有三个 scope 的 tier 就是它自己
const TIER_BY_SCOPE = { school: 'school', nearby: 'nearby', city: 'city', mine: 'mine' }

/**
 * 有没有可用坐标。
 * 缺失 / 0 / NaN / 越界 / 字符串一律当「没有」：
 * 卡片缺坐标时写 0，所以 0 必须判成没有，否则 (0,0) 会被算成非洲西海岸，
 * 「附近 10 公里」里就会冒出几千公里外的卡。
 */
function hasGeo(o) {
  if (!o) return false
  const lat = o.geo_lat
  const lng = o.geo_lng
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (!isFinite(lat) || !isFinite(lng)) return false
  if (lat === 0 && lng === 0) return false
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false
  return true
}

/**
 * 两点球面距离（km）。自己写，不引依赖（npm 包会涨部署包、拖慢冷启动）。
 * 用 haversine 而不是平面勾股：跨纬度时经度差的实际长度会缩水，
 * 斜角方向尤其明显，判「附近」会误杀。
 */
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 保留一位小数：前端就显示「1.2km」，多余精度没意义，还会让同距离的两条顺序抖动
function roundKm(km) {
  return Math.round(km * 10) / 10
}

// 「我」到这张卡的距离；任一方没坐标给 -1（前端据此不显示距离）
function distanceTo(me, c) {
  if (!hasGeo(me) || !hasGeo(c)) return -1
  return roundKm(distanceKm(me.geo_lat, me.geo_lng, c.geo_lat, c.geo_lng))
}

// 取一批候选卡片（列表要渲染的字段）。数量上限由调用方给，0 直接不发请求。
async function fetchCandidates(where, max) {
  const n = max > 0 ? max : 0
  if (!n) return []
  const res = await db
    .collection('cards')
    .where(where)
    .field(TEASER_FIELDS)
    .orderBy('created_at', 'desc')
    .limit(n)
    .get()
  return res.data || []
}

/**
 * 给候选打档位并按「同校 → 附近 → 城市」排序。
 * 排序口径：
 *   tier 优先级 school(0) → nearby(1) → city(2)
 *   附近档内按距离升序（近的才叫「附近」）
 *   其余档内按 created_at 降序（新的先看）
 * 未认证的用户完全不参与 school 档：认证是这一档的前提，
 * 否则任何人在资料里填个别的 school_id 就能看遍那所学校。
 */
function rankCards(cards, me, verified, remoteFill) {
  const mySchool = me && me.school_id ? me.school_id : ''
  const rows = cards.map((c) => {
    const dist = distanceTo(me, c)
    // geo 档位只用来排序，tier 才是给用户看的标签 —— 两者对补位卡不同：
    // 补位卡可能刚好就在我的学校 / 附近范围内（只是当时没进候选池），
    // 但它其实是「为了凑满一屏从全站补进来的」，标成同校 / 城市会让用户
    // 去大厅对应档里找不到它（大厅那三档按 city_code / school_id 真筛）。
    // 所以补位卡一律标 remote（前端显示「全站」），排序仍按 geo：
    // 同校 → 附近 → 城市，补位卡本来就被下面的 remote 规则排在同档末尾。
    let geo = 'city'
    if (verified && mySchool && c.school_id === mySchool) geo = 'school'
    else if (dist >= 0 && dist <= NEARBY_KM) geo = 'nearby'
    // remote 标记：这一条是为了「凑满一屏」才从全站补进来的（本地城市/同校都没有人）
    const remote = !!(remoteFill && remoteFill[c._id])
    // 城市档的定义是「我的城市里、但不同校也不近」，不是「离得远就是城市」：
    // 别的城市的卡不属于这一档。大厅「城市」档按我的 city_code 真筛，
    // 把外地的卡标成城市，用户点进那一档就找不到它 —— 这正是要消掉的矛盾。
    // （smart 档的候选池本来就按同城取，这条判断在那条路径上恒不成立，行为不变。）
    const myCity = me && me.city_code ? me.city_code : ''
    const outOfCity = !!(geo === 'city' && myCity && c.city_code !== myCity)
    return {
      card: c,
      tier: remote || outOfCity ? 'remote' : geo,
      geo: geo,
      distance_km: dist,
      remote: remote
    }
  })
  const priority = { school: 0, nearby: 1, city: 2 }
  rows.sort((a, b) => {
    if (priority[a.geo] !== priority[b.geo]) return priority[a.geo] - priority[b.geo]
    if (a.geo === 'nearby') return a.distance_km - b.distance_km
    // 同档里本地的一定排在补进来的前面：补进来的只是「别让首页空着」，
    // 不能把本地真实的新卡挤到第二屏去
    if (a.remote !== b.remote) return a.remote ? 1 : -1
    return (b.card.created_at || 0) - (a.card.created_at || 0)
  })
  return rows
}

// 把数组切成每片 n 个，用于分批 in 查询（in 的数组太长会拖慢查询）
// 卡片图片：前端 imgsOf() 兼容 images / media / image_urls 三个字段名，依次兜。
// 值是 JSON 字符串时只 parse 一次，失败返回 []（前端要 .length，绝不能给 null）
function pickImages(c) {
  const raw = c.images || c.media || c.image_urls
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      return []
    }
  }
  return Array.isArray(raw) ? raw : []
}

/**
 * 把卡片里的 cloud:// fileID 换成可直接渲染的临时链接。
 *
 * 为什么必须在服务端换：
 *   支付宝云的 <image> 不认 cloud://，必须先 getTempFileURL；放在这里一页图片
 *   一次批量换完，前端不用为列表页单独维护一套「换链接 + 过期缓存」的逻辑。
 * 为什么换失败保留原值：
 *   白框只是少一张图，抛出去会让整页 500 —— 图片不是列表的主干。
 */
async function resolveImageUrls(list) {
  const ids = []
  for (let i = 0; i < list.length; i++) {
    const arr = list[i].images || []
    for (let j = 0; j < arr.length; j++) {
      const u = arr[j]
      if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
    }
  }
  if (!ids.length) return
  try {
    /* 换链偶发失败时前台会拿到 cloud://，<image> 渲染不出来 —— 表现就是「同样一张卡，
       这个账号看得见、那个账号看不见」。换链失败的再试一次，比让前端去猜更可靠。 */
    const askOnce = async function (fileIds) {
      if (!fileIds.length) return {}
      const res = await uniCloud.getTempFileURL({ fileList: fileIds })
      const fl = (res && res.fileList) || []
      const out = {}
      for (let i = 0; i < fl.length; i++) {
        if (fl[i] && fl[i].tempFileURL) out[fl[i].fileID] = fl[i].tempFileURL
      }
      return out
    }
    const map = {}
    const first = await askOnce(ids)
    Object.keys(first).forEach(function (k) { map[k] = first[k] })
    const leftIds = ids.filter(function (id) { return !map[id] })
    if (leftIds.length) {
      const second = await askOnce(leftIds)
      Object.keys(second).forEach(function (k) { map[k] = second[k] })
      if (leftIds.length) console.warn('[card-list] 有头像没换出链接', leftIds.length)
    }
    for (let i = 0; i < list.length; i++) {
      const arr = list[i].images || []
      for (let j = 0; j < arr.length; j++) {
        if (map[arr[j]]) arr[j] = map[arr[j]]
      }
    }
  } catch (e) {
    console.warn('[card-list] getTempFileURL 失败，图片按原值返回', e && e.message)
  }
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// 候选卡片的扫描上限：超过这个数就不算了，直接给 null（不知道），
// 免得一次大厅请求把数据库扫穿
const MATCH_SCAN_MAX = 2000

/**
 * 一趟扫描同时数两个口径（候选只扫一遍，不多发一次请求）：
 *   matched —— 与我标签有重合的人有几个（按 owner_id 去重）
 *   people  —— 候选里有几个不同的人（按 owner_id 去重）
 * 任一算不出来给 null，不给 0：0 的意思是「全量候选都扫过，确实是零」。
 *
 * 为什么要扫全量候选：只按当前页算，结果恒等于 page_size（page_size=3 时永远是 3），毫无意义。
 * 为什么 matched 要按人去重：同一个人发 3 条需求是「1 个人同频」，按条数算成 3 会让用户
 * 以为大厅里站着三个同频的人，其实只有一个。
 * 为什么不能拿 total 顶替：total 是卡片条数，是分页的口径，换成人会翻页错乱。
 */
async function countMatchedCards(where, total, myTagIds, meId, candidates) {
  const unknown = { matched: null, people: null }
  // ★ 候选已经在内存里（附近档 / 智能档自己取过一轮 pool）时，必须用这份 pool 数人。
  //   早前这里一律拿 where + total 回库里重新扫一遍：智能档的 where 是「同城 + 未关闭」，
  //   total 却是 rankCards 之后的条数，两者不是一回事 —— 按 _id 顺序扫到的前 N 条
  //   很可能既不是同校那批、也不是当前页那批，于是「大厅卡片有同频徽章、首页同频人数却是 0」。
  //   用同一份候选算，两张卡片的数、页面上的数才是一个口径。
  const fromMemory = Array.isArray(candidates)
  if (fromMemory) {
    // pool 上限就是 SMART_SCAN_MAX / NEARBY_SCAN_MAX，不存在「扫不完」；空 pool 就是真没人
    if (!candidates.length) return { matched: myTagIds.length ? 0 : null, people: 0 }
  } else {
    if (total > MATCH_SCAN_MAX) return unknown
    // 候选就是 0 张：确实没人，这是真空，不是不知道
    if (!total) return { matched: myTagIds.length ? 0 : null, people: 0 }
  }

  // 第一趟取 _id + owner_id 扫一遍候选：多带一个字段不增加请求次数，
  // 但足以在本地按 owner_id 去重。按 _id 排序是为了 skip 分页稳定：
  // created_at 会同秒重复，按它翻页会漏卡或重复计数
  const candidateIds = []
  const ownerSeen = {}
  const cardOwner = {}
  const SCAN_PAGE = 200
  if (fromMemory) {
    candidates.forEach((c) => {
      if (!c || !c._id) return
      candidateIds.push(c._id)
      cardOwner[c._id] = c.owner_id || ''
      if (c.owner_id) ownerSeen[c.owner_id] = true
    })
  } else {
    for (let skip = 0; skip < total; skip += SCAN_PAGE) {
      const r = await db
        .collection('cards')
        .where(where)
        .field({ _id: true, owner_id: true })
        .orderBy('_id', 'asc')
        .skip(skip)
        .limit(SCAN_PAGE)
        .get()
      r.data.forEach((c) => {
        candidateIds.push(c._id)
        cardOwner[c._id] = c.owner_id || ''
        if (c.owner_id) ownerSeen[c.owner_id] = true
      })
      if (r.data.length < SCAN_PAGE) break
    }
  }

  const peopleTotal = Object.keys(ownerSeen).length

  // 我没有标签：谈不上「重合」，但候选人数已经算出来了，不该跟着一起变 null
  if (!myTagIds.length) return { matched: null, people: peopleTotal }

  const mine = {}
  myTagIds.forEach((t) => {
    mine[t] = true
  })

  // 第二趟按这批 card_id 反查 card_tags，与我的标签求交 —— 命中的先记在卡片上
  const hitCard = {}
  for (const part of chunk(candidateIds, 50)) {
    const r = await db
      .collection('card_tags')
      .where({ card_id: dbCmd.in(part) })
      .field({ card_id: true, tag_id: true })
      .limit(500)
      .get()
    // 一批顶到返回上限说明没取全：宁给 null，也不给一个偏小的数（人数仍然可信，原样给出）
    if (r.data.length >= 500) return { matched: null, people: peopleTotal }
    r.data.forEach((ct) => {
      if (mine[ct.tag_id]) hitCard[ct.card_id] = true
    })
  }

  // card_tags 里只有 card_id，没有 owner_id：借第一趟的 card→owner 映射折回人数，
  // 命中同一人的多张卡只留一个 owner_id
  const hitOwner = {}
  Object.keys(hitCard).forEach((cid) => {
    const oid = cardOwner[cid]
    // 自己不算「与我同频」：自己的卡标签必然重合，算进去就是自己跟自己同频。
    // 注意：走内存候选时（nearby / smart），自己的卡在更早的「自己的卡不进首页」那步
    // 就已经被滤掉了，所以这里的 meId 判断只对纯数据库分页路径（area / school）兜底，
    // 两条路径最终口径一致：peopleTotal 与 matchedTotal 都不含自己。
    if (meId && oid === meId) return
    // 脏数据没有 owner_id 时退回用卡片 id 占位：宁可多算一个人，也不把两个不同的人并成一个
    hitOwner[oid || cid] = true
  })
  return { matched: Object.keys(hitOwner).length, people: peopleTotal }
}

/**
 * 列表里的头像换临时链接：库里存 cloud:// fileID，<image> 只认 http 链接。
 * 一页一次批量换；失败保留原值，头像裂了不该让整页报错。
 */
/* 挑「最该用的那个头像标识」：cloud:// fileID（永久） > 包内静态路径 > http（可能是过期临时链接）。
 *
 * 为什么不能写 owner.avatar_url || owner.avatar：
 *   库里 avatar 存的是 cloud:// fileID，avatar_url 有些历史账号存的是**当年换出来的临时链接**。
 *   临时链接过期后，优先取它 = 每次都给前端一条死链 —— 有本地缓存的那台设备还能显示，
 *   换一个账号 / 换一台设备就是空圆。这正是「A 号看得见、C 号看不见」的成因。
 */
function pickOwnerAvatar(owner) {
  const cands = [owner && owner.avatar, owner && owner.avatar_url]
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

async function resolveListAvatars(list) {
  const ids = []
  for (let i = 0; i < list.length; i++) {
    const u = list[i].owner && list[i].owner.avatar_url
    if (typeof u === 'string' && u.indexOf('cloud://') === 0 && ids.indexOf(u) < 0) ids.push(u)
  }
  if (!ids.length) return
  try {
    /* 换链失败的 fileID 必须重试一次：失败时前端拿到的是 cloud://，<image> 直接渲染不出来
       —— 用户看到的现象就是「同一张卡，这个账号登录看得见头像，那个账号登录看不见」。
       一次失败通常是云厂商限流或瞬时网络，重试一遍基本就过。 */
    const askOnce = async function (fileIds) {
      if (!fileIds.length) return {}
      const res = await uniCloud.getTempFileURL({ fileList: fileIds })
      const fl = (res && res.fileList) || []
      const out = {}
      for (let i = 0; i < fl.length; i++) {
        if (fl[i] && fl[i].tempFileURL) out[fl[i].fileID] = fl[i].tempFileURL
      }
      return out
    }
    const map = {}
    const first = await askOnce(ids)
    Object.keys(first).forEach(function (k) { map[k] = first[k] })
    const leftIds = ids.filter(function (id) { return !map[id] })
    if (leftIds.length) {
      const second = await askOnce(leftIds)
      Object.keys(second).forEach(function (k) { map[k] = second[k] })
      const still = leftIds.filter(function (id) { return !map[id] })
      if (still.length) console.warn('[card-list] 头像没换出链接', still.length)
    }
    for (let i = 0; i < list.length; i++) {
      const o = list[i].owner
      if (o && map[o.avatar_url]) o.avatar_url = map[o.avatar_url]
    }
  } catch (e) {
    console.warn('[card-list] 头像换链失败', e && e.message)
  }
}

exports.main = async (event) => {
  try {
    const token = str(event.token)
    const type = str(event.type)
    const scope = str(event.scope) || 'school'
    const page = Math.max(1, parseInt(event.page, 10) || 1)
    let pageSize = parseInt(event.page_size, 10) || 20
    if (pageSize > 50) pageSize = 50
    if (pageSize < 1) pageSize = 20

    // —— 0. 拿到"我"（没登录也能逛大厅，只是没有共同标签）——
    let me = null
    if (token) {
      const meRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
      if (meRes.data.length) me = meRes.data[0]
    }

    // —— 1. 组装查询条件 ——
    // 注意 school_id 为空时不能按同校筛，否则未填学校的用户在大厅里什么都看不到
    let where = { status: 'open' }
    // 首页传 type:'all' 是"不限类型"，不是要去筛 type==='all' 的卡片 ——
    // 卡片的 type 只有 study/fitness/… 这几个值，照字面筛会让首页永远空列表、同频人数永远 0
    if (type && type !== 'all') where.type = type
    // 筛选被降级时的说明（空 = 正常筛选）
    let degraded = ''

    // 学生认证：两套字段名取或（schoolVerified 是第 1 天的写法，is_verified 是设计文档的写法）
    const verified = !!(me && (me.schoolVerified === true || me.is_verified === true))

    // 分档 / 距离路径要先把候选拿到内存里算（数据库里没有 tier 这个字段），
    // 其余路径仍然是「数据库分页」。null 就表示走分页路径。
    let candidates = null
    // smart 档「全站补位」进来的卡片 id 表（用来把它们排在本地之后）
    let remoteFill = null

    if (scope === 'mine') {
      /* 只看我自己发的卡（首页数字卡「我的需求」的入口）。
         不参与同校 / 附近 / 城市分档，也不参与同频人数统计：自己的卡跟自己
         「同频」是假的（标签必然重合），那是本轮之前首页自己的卡永远置顶的根因。
         状态包含 open / matched / closed 三种（自己得能看见已经找到搭子的和已关闭的），
         只排除 removed（运营删掉的）。 */
      if (!me) {
        return {
          code: 0,
          msg: 'ok',
          data: {
            list: [],
            has_more: false,
            total: 0,
            matched_total: null,
            people_total: null,
            reason: 'need_login',
            hint: '登录后才能看自己发的需求',
            degraded: ''
          }
        }
      }
      where = { owner_id: me._id, status: dbCmd.neq('removed') }
      if (type && type !== 'all') where.type = type
    } else if (scope === 'school') {
      // 同校档只对已认证用户开放。未认证给空列表 + degraded='need_verify'：
      // 不报错（前端不用为它写错误分支），也不降级到全站 —— 降级会让用户以为
      // 「同校里就这些人」，其实混着全站，比空列表更容易误解。
      if (!verified) {
        return {
          code: 0,
          msg: 'ok',
          // matched_total / people_total 都是 null —— 连候选都没扫过，不能报 0（0 是"真没人"）
          data: {
            list: [],
            has_more: false,
            total: 0,
            matched_total: null,
            people_total: null,
            // 未登录沿用历史的 no_school，登录了但没认证给 need_verify
            reason: me ? 'need_verify' : 'no_school',
            hint: '完成学生认证后才能看同校频道',
            degraded: 'need_verify'
          }
        }
      }
      // 认证了但没落 school_id：同样不能装作筛过了
      if (!me.school_id) {
        return {
          code: 0,
          msg: 'ok',
          data: {
            list: [],
            has_more: false,
            total: 0,
            matched_total: null,
            people_total: null,
            reason: 'no_school',
            hint: '完成学生认证后才能看同校频道'
          }
        }
      }
      where.school_id = me.school_id
    } else if (scope === 'all') {
      /* 全站档（大厅「推荐」）：数据库里所有 open 需求，一条都不少。
         上面默认的 where 就是 { status: 'open' }（type 有值且非 'all' 时才加 type），
         这里刻意什么都不加 —— 加了 city_code / school_id 就成了别的档，
         「首页看得到、大厅推荐档找不到」正是这么来的。
         candidates 保持 null：走数据库分页（count + skip + limit），
         total / has_more / 出参结构与 school / city 完全一致。
         档位等这一页的卡片取回来再逐张算（tier 依赖「我」的坐标 / 学校 /
         认证状态，库里没有这个字段，不能在 where 里筛）。 */
    } else if (scope === 'city') {
      // 城市：本城市优先。没填城市码时退化成「全部」，但不能假装筛过了 ——
      // 带上 reason 让前端说明，否则用户以为筛完只剩这些，其实根本没筛。
      if (me && me.city_code) {
        where.city_code = me.city_code
      } else {
        degraded = 'no_city'
      }
    } else if (scope === 'nearby') {
      // 附近：有坐标就按真距离筛 NEARBY_KM；没坐标才退回同城 / 同校近似
      // （旧版没有定位权限，一直走下面的近似分支，那几段 degraded 文案前端已经在用了，别动）
      if (me && hasGeo(me)) {
        const geoWhere = { status: 'open' }
        if (type && type !== 'all') geoWhere.type = type
        // 候选先按同城圈取：跨城不会小于 10 公里，这样能省掉一圈无用的距离计算。
        // 没城市码时不加城市条件 —— 距离本身会把远处的滤掉。
        if (me.city_code) geoWhere.city_code = me.city_code
        where = geoWhere
        const pool = await fetchCandidates(geoWhere, NEARBY_SCAN_MAX)
        candidates = pool.filter((c) => {
          // 没坐标的卡片进不了「附近」：算不出距离，就不能假装它在附近
          if (!hasGeo(c)) return false
          return distanceKm(me.geo_lat, me.geo_lng, c.geo_lat, c.geo_lng) <= NEARBY_KM
        })
      } else if (me && me.city_code) {
        where.city_code = me.city_code
      } else if (me && me.school_id) {
        // 连城市都没有时，退一级用同校，仍然比全国更有意义
        where.school_id = me.school_id
        degraded = 'nearby_as_school'
      } else {
        degraded = 'no_location'
      }
    } else if (scope === 'smart') {
      // 首页智能档：同城候选一次取（最多 SMART_SCAN_MAX 条），分档排序在内存里做完。
      // 为什么不交给数据库：tier 依赖「我」的坐标 / 学校 / 认证状态，库里没有这个字段。
      const smartWhere = { status: 'open' }
      if (type && type !== 'all') smartWhere.type = type
      if (me && me.city_code) smartWhere.city_code = me.city_code
      where = smartWhere
      candidates = await fetchCandidates(smartWhere, SMART_SCAN_MAX)
      // 同城候选凑不满（新城市 / 冷启动）时用同校补：同校是唯一「必须让用户看见」
      // 的一档，够不到 120 条也不该让首页只剩零星几张。
      if (me && verified && me.school_id && candidates.length < SMART_SCAN_MAX) {
        const have = {}
        candidates.forEach((c) => {
          have[c._id] = true
        })
        const schoolWhere = { status: 'open', school_id: me.school_id }
        if (type && type !== 'all') schoolWhere.type = type
        const extra = await fetchCandidates(schoolWhere, SMART_SCAN_MAX - candidates.length)
        extra.forEach((c) => {
          if (have[c._id]) return
          have[c._id] = true
          candidates.push(c)
        })
      }
      // 城市 + 同校都凑不满一屏（新城市 / 校园冷启动 / 只有自己发过需求）时，
      // 再用全站 open 卡补到三屏左右。不补的话首页只剩自己那一条 —— 老前端
      // 「同校不够就回落全站」正是为了这件事，合并逻辑删了，兜底必须搬到这里。
      if (candidates.length < pageSize) {
        const have = {}
        candidates.forEach((c) => {
          have[c._id] = true
        })
        const globalWhere = { status: 'open' }
        if (type && type !== 'all') globalWhere.type = type
        const extra = await fetchCandidates(globalWhere, SMART_SCAN_MAX)
        remoteFill = {}
        const fillTo = Math.max(pageSize * 3, 30)
        extra.forEach((c) => {
          if (candidates.length >= fillTo) return
          if (have[c._id]) return
          have[c._id] = true
          remoteFill[c._id] = true
          candidates.push(c)
        })
      }
    }

    /* 自己的卡不进「首页 / 大厅」：对自己而言同校 / 附近 / 城市这几档没有筛选意义
       （自己的卡永远和自己同校，会被排到最前面），而且它和自己「同频」是假的 ——
       标签必然重合，共同标签那一栏全是噪声。自己的卡只在 scope='mine' 里看。
       两个入口都要挡：数据库分页路径挡在 where 上（total 也跟着对），
       内存候选路径（附近 / 智能档）挡在数组上。 */
    if (me && me._id && scope !== 'mine') {
      where.owner_id = dbCmd.neq(me._id)
      if (candidates) candidates = candidates.filter((c) => c.owner_id !== me._id)
    }

    // —— 2. 取候选 ——
    // cards / total 两条路径都要给出，后面的补数据段完全复用
    let cards
    let total
    // 每张卡的档位与距离单独存表：TEASER_FIELDS 的结果是库里的原始行，
    // 把 tier 混进去会和"卡片字段"混为一谈，拼返回时再合并更清楚
    const tierOf = {}
    const distOf = {}

    if (candidates) {
      if (scope === 'nearby') {
        // 附近：上面已经按真距离筛过，这里只按由近到远排，再按 page 切片
        candidates.sort((a, b) => distanceTo(me, a) - distanceTo(me, b))
        total = candidates.length
        const from = (page - 1) * pageSize
        cards = candidates.slice(from, from + pageSize)
        cards.forEach((c) => {
          tierOf[c._id] = 'nearby'
          distOf[c._id] = distanceTo(me, c)
        })
      } else {
        // smart：分档（同校 → 附近 → 城市）+ 排序，再按 page 切片。
        // 切片的起点跟着 page 走，否则第 2 页会把第 1 页重发一遍；
        // 一页仍然是 page_size 条（上限不变）。
        const ranked = rankCards(candidates, me, verified, remoteFill)
        total = ranked.length
        const from = (page - 1) * pageSize
        const pageRows = ranked.slice(from, from + pageSize)
        cards = pageRows.map((r) => r.card)
        pageRows.forEach((r) => {
          tierOf[r.card._id] = r.tier
          distOf[r.card._id] = r.distance_km
        })
      }
    } else {
      const countRes = await db.collection('cards').where(where).count()
      total = countRes.total

      const cardRes = await db
        .collection('cards')
        .where(where)
        .field(TEASER_FIELDS)
        .orderBy('created_at', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()

      cards = cardRes.data
      if (scope === 'all') {
        // 全站档没有「档位就是 scope 本身」这回事：这一页里可能混着我自己学校的、
        // 附近的、和别的城市的卡，每张都要单独算档位。复用 rankCards（同一套
        // 学校 / 距离判断，不写第二份算法），但**不要它的排序**：
        // 这一档的排序是数据库的 created_at desc，拿来重排会把翻页打乱。
        // remoteFill 传 null：全站档没有补位卡，谁都不是「补进来的」。
        const ranked = rankCards(cards, me, verified, null)
        ranked.forEach((r) => {
          tierOf[r.card._id] = r.tier
          distOf[r.card._id] = r.distance_km
        })
      } else {
        // 既有 scope 的 tier 就是 scope 本身，前端统一按 tier 渲染标签
        const fixedTier = TIER_BY_SCOPE[scope] || 'city'
        cards.forEach((c) => {
          tierOf[c._id] = fixedTier
          distOf[c._id] = distanceTo(me, c)
        })
      }
    }

    // 3.3 我的标签（共同标签和 matched_total 都要用）。
    // 放在「本页为空」提前返回之前算，否则翻页翻过头时返回体里会缺 matched_total
    const myTagIds = []
    if (me) {
      const myRes = await db.collection('user_tags').where({ user_id: me._id }).get()
      myRes.data.forEach((ut) => myTagIds.push(ut.tag_id))
    }

    // 同频人数 / 候选人数另算，单独兜一层异常：统计挂了不能把整个大厅拖挂（列表本身还能用）
    let matchedTotal = null
    let peopleTotal = null
    if (scope === 'mine') {
      // 自己发的卡不算「同频候选」，这两个数在 mine 档恒为 null（null = 不适用）
    } else if (scope === 'all') {
      /* ★ 全站档不做这两个统计：它要扫全库 open 卡（每 200 条一次查询）再按 card_tags
         分批求交（每 50 个 card_id 一次），卡一多就是几十次串行查询，云函数直接超时 ——
         前端看到的是「card-list 调用失败」，而首页（smart 档，候选在内存里）却正常。
         口径上这两个数在这里也没有意义：大厅「推荐」只展示总条数 total，
         「与我同频」是首页那格的事，由 smart 档按内存候选算。
         null = 不知道，契约本来就这样定义，前端不会把它当 0 展示。 */
      matchedTotal = null
      peopleTotal = null
    } else try {
      // 把 candidates 一并传下去：内存里已有 pool 的档位（nearby / smart）必须用它数人，
      // 否则就是拿一张不符的口径去库里重扫（见 countMatchedCards 注释）。
      // 还要再剔掉 remoteFill 那批：它们只是为了「别让首页只剩自己一条」从全站补进来的，
      // 地理上不在我的同校 / 附近范围内，把它们算成「与我同频的人」会让数字虚高。
      const matchPool = candidates
        ? candidates.filter((c) => c && !(remoteFill && remoteFill[c._id]))
        : undefined
      const counted = await countMatchedCards(where, total, myTagIds, me ? me._id : '', matchPool)
      matchedTotal = counted.matched
      peopleTotal = counted.people
    } catch (e2) {
      matchedTotal = null
      peopleTotal = null
    }

    if (!cards.length) {
      return {
        code: 0,
        msg: 'ok',
        data: {
          list: [],
          has_more: false,
          total,
          matched_total: matchedTotal,
          people_total: peopleTotal,
          degraded
        }
      }
    }

    // —— 3. 批量补数据（三次查询搞定，不要 N+1）——
    const cardIds = cards.map((c) => c._id)
    const ownerIds = []
    cards.forEach((c) => {
      if (c.owner_id && ownerIds.indexOf(c.owner_id) < 0) ownerIds.push(c.owner_id)
    })

    // 3.1 发布者
    const ownerMap = {}
    for (const part of chunk(ownerIds, 50)) {
      const r = await db.collection(DB_USERS).where({ _id: dbCmd.in(part) }).field(USER_FIELDS).get()
      r.data.forEach((u) => {
        ownerMap[u._id] = u
      })
    }

    // 3.2 卡片标签
    const ctRes = await db.collection('card_tags').where({ card_id: dbCmd.in(cardIds) }).get()
    const tagIdsByCard = {}
    const allTagIds = []
    ctRes.data.forEach((ct) => {
      if (!tagIdsByCard[ct.card_id]) tagIdsByCard[ct.card_id] = []
      tagIdsByCard[ct.card_id].push(ct.tag_id)
      if (allTagIds.indexOf(ct.tag_id) < 0) allTagIds.push(ct.tag_id)
    })

    const tagMap = {}
    for (const part of chunk(allTagIds, 50)) {
      if (!part.length) continue
      const r = await db.collection('tags').where({ _id: dbCmd.in(part) }).get()
      r.data.forEach((t) => {
        tagMap[t._id] = t
      })
    }

    // 3.3 本页点赞数：一次聚合拿到全部卡的计数（不逐卡 count），挂了只降级成 0
    const likeCountMap = {}
    try {
      const aggRes = await db
        .collection('card_likes')
        .aggregate()
        .match({ card_id: dbCmd.in(cardIds) })
        .group({ _id: '$card_id', n: $.sum(1) })
        .end()
      const aggRows = (aggRes && aggRes.data) || []
      aggRows.forEach((row) => {
        likeCountMap[row._id] = row.n || 0
      })
    } catch (e3) {
      // 点赞数统计挂了不影响列表：没有记录的卡下面统一给 0
    }

    // 3.4 我赞过的卡：一次 in 查询拿集合；未登录直接跳过，挂了就当没赞过
    const likedMap = {}
    if (me && me._id) {
      try {
        const myLikeRes = await db
          .collection('card_likes')
          .where({ card_id: dbCmd.in(cardIds), user_id: me._id })
          .field({ card_id: true })
          .limit(cardIds.length)
          .get()
        ;(myLikeRes.data || []).forEach((row) => {
          likedMap[row.card_id] = true
        })
      } catch (e4) {
        // 查不出来就全 false，不影响列表本身
      }
    }

    // —— 4. 拼装返回 ——
    const list = cards.map((c) => {
      const tagIds = tagIdsByCard[c._id] || []
      const tags = tagIds
        .map((tid) => tagMap[tid])
        .filter(Boolean)
        .map((t) => ({ _id: t._id, name: t.name, category: t.category }))
      // 自己发的卡不跟自己「同频」：标签必然重合，显示出来只是噪声。
      // 必须在这里判断 —— 下面几步会 delete c.owner_id
      const isMineCard = !!(me && me._id && c.owner_id === me._id)
      const common = isMineCard ? [] : tagIds.filter((tid) => myTagIds.indexOf(tid) >= 0)

      const owner = ownerMap[c.owner_id] || {}
      delete c.owner_id
      delete c.school_id
      delete c.city_code

      return Object.assign(c, {
        owner: {
          _id: owner._id || '',
          nickname: owner.nickname || '同学',
          avatar_url: pickOwnerAvatar(owner),
          school: owner.school || '',
          // 兼容两套字段名：第 1 天注册写的是 schoolVerified/credit，
          // 03 文档设计的是 is_verified/credit_score。两处都读，避免列表与详情页显示不一致。
          is_verified: !!(owner.is_verified || owner.schoolVerified),
          credit_score:
            typeof owner.credit_score === 'number'
              ? owner.credit_score
              : typeof owner.credit === 'number'
                ? owner.credit
                : 80,
          user_no: owner.user_no || ''
        },
        tags,
        common_tags: common,
        common_tag_count: common.length,
        // 不再要求 created_at：mine 档里刚发布、时间字段还没回填的卡也要认成自己的
      is_mine: !!(me && me._id && owner._id === me._id),
        images: pickImages(c),
        like_count: likeCountMap[c._id] || 0,
        liked: !!likedMap[c._id],
        // 档位与距离（本轮契约）：前端标签用 tier，卡片上「1.2km」用 distance_km
        tier: tierOf[c._id] || 'city',
        distance_km: typeof distOf[c._id] === 'number' ? distOf[c._id] : -1,
        // 项目还没有评论表，null 让前端不显示评论数
        comment_count: null
      })
    })

    await resolveListAvatars(list)

    // 排序：共同标签多的排前面（这是"同频"的直观体现），其次按时间。
    // 分档路径（smart / 有坐标的 nearby）上面已按档位和距离排好并切了页，
    // 这里再按标签重排会把「同校 → 附近 → 城市」打散 —— 档位就白分了。
    // ★ all 档（大厅「推荐」）例外：它是「所有需求」的时间线，用户翻页时应当看到
    //   严格按发布时间的顺序；页内再按共同标签重排，既打乱时间线，也让「第 N 页
    //   第一条」在两次请求之间漂移。所以 all 档不做这一步，保持 created_at desc。
    if (!candidates && scope !== 'all') {
      list.sort((a, b) => {
        if (b.common_tag_count !== a.common_tag_count) return b.common_tag_count - a.common_tag_count
        return b.created_at - a.created_at
      })
    }

    // 排序完再换图（换链接不影响排序，但少遍历一遍就少一遍）
    await resolveImageUrls(list)

    return {
      code: 0,
      msg: 'ok',
      data: {
        list,
        has_more: page * pageSize < total,
        page,
        total,
        // 候选人数（按 owner_id 去重）。活人信号用它，total 是条数、不是人
        people_total: peopleTotal,
        // 0 是真空（扫过全量候选，确实没人重合）；null 是不知道（未登录 / 没标签 / 算不出来）
        matched_total: matchedTotal,
        // '' 正常；'no_city' 没城市码退回全国；'nearby_as_school' 没城市码用同校近似；
        // 'no_location' 什么都没有退回全国。前端据此显示一行说明，避免用户误以为筛过了。
        degraded
      }
    }
  } catch (e) {
    return { code: 500, msg: e.message || '加载失败' }
  }
}
