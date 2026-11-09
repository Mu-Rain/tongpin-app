'use strict'

/**
 * 编辑 / 关闭自己发布的搭子卡片
 *
 * 入参：{
 *   token            登录令牌
 *   action           'edit' | 'close'
 *   card_id          要操作的卡片 _id
 *   —— 以下仅 action='edit' 需要，字段口径与 card-publish 逐条对齐 ——
 *   type             study / fitness / photo / meal / sport / other
 *   title            ≤30 字
 *   description      ≤200 字
 *   location_name    可空
 *   start_time       毫秒时间戳，可空
 *   end_time         毫秒时间戳，可空（end < start 直接拒绝）
 *   expected_people  1~10，越界按边界收敛
 *   tag_ids          标签 _id 数组，≤10 个，必须 active:true
 *   images           可选：**不传 = 不动原有配图**；传了就整组替换
 * }
 *
 * 出参：
 *   close 成功   { code: 0, msg: 'ok', data: { card_id, status: 'closed' } }
 *   edit  成功   { code: 0, msg: 'ok', data: { card_id, status: 'open' } }
 *   失败         { code, msg }（msg 一律是能直接给用户看的人话）
 *
 * 错误码：
 *   400  action / 入参校验不过（类型、字数、时间关系、标签非法）
 *   401  token 查不到人 → '登录已过期'
 *   403  owner_id 对不上 → '这不是你发布的需求'
 *   404  缺 card_id / 卡片不存在
 *   409  当前状态不允许（matched / closed / removed，msg 说明原因）
 *   500  数据库或事务异常
 *
 * 为什么单开一个云函数、而不在 card-publish 上加分支：
 *   1. 发布有「每天 5 条」和「信誉分 ≥60」两道门槛；编辑一条都不该有 ——
 *      改一个错字被每日配额挡住是荒谬的，而把门槛抽成公共逻辑又会牵动发布链路。
 *   2. 发布要写 created_at / school_id / city_code / geo_lat / geo_lng 这些**快照**字段，
 *      编辑一个都不能改：改了 school/geo 等于把卡从 A 校挪到 B 校，
 *      「同校 → 附近 → 城市」三档筛选立刻失真。
 *   3. 编辑必须「cards 更新 + card_tags 全量换行」原子完成。半途失败会留下
 *      「标题是新的、标签还是旧的」这种状态 —— 标签是匹配算法的输入，
 *      新旧混杂算出来的重合度是错的，用户却看不出来。
 *
 * 为什么不透出 owner_id / token：客户端拿到 owner_id 也没有用处（它自己就是 owner），
 * 多给一个字段只会诱使前端拿它做权限判断，把本该在云端的判断散布到客户端去。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_USERS = 'uni-id-users'
const COLL_CARDS = 'cards'
const COLL_CARD_TAGS = 'card_tags'
const COLL_TAGS = 'tags'

// 以下常量与 card-publish 完全同值：校验口径不一致 = 同一张卡「能发不能改」或者相反
const TYPE_ENUM = ['study', 'fitness', 'photo', 'meal', 'sport', 'other']
const MAX_TAGS = 10
const MAX_IMAGES = 3
const MAX_IMAGE_LEN = 512

// 业务错误：带 bizCode 抛出，外层统一转成 { code, msg }
function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// 状态 → 人话。不能只说「操作失败」：用户要知道这张卡到底卡在哪个状态上
function statusMsg(action, status) {
  const verb = action === 'close' ? '关闭' : '修改'
  if (status === 'matched') return '这条需求已经找到搭子了，不能再' + verb
  if (status === 'closed') return '这条需求已经关闭了，不能再' + verb
  if (status === 'removed') return '这条需求已被运营下架，不能再' + verb
  return '这条需求当前状态（' + (status || '未知') + '）不支持' + verb
}

function ok(cardId, status) {
  return { code: 0, msg: 'ok', data: { card_id: cardId, status } }
}

exports.main = async (event) => {
  try {
    const token = str(event.token)
    // 401 而不是 400：客户端见到 401 会统一跳登录，见 my-cards 的处理
    if (!token) fail('登录已过期', 401)

    const action = str(event.action)
    if (action !== 'edit' && action !== 'close') fail('缺少或非法的 action', 400)

    const cardId = str(event.card_id)
    if (!cardId) fail('缺少 card_id', 404)

    // —— 1. token 换用户 ——
    const userRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
    if (!userRes.data.length) fail('登录已过期', 401)
    const me = userRes.data[0]

    // —— 2. 卡片必须存在，且必须是自己发的 ——
    // doc().get() 遇到畸形 id 会抛错，这里收敛成 404，不让客户端看到数据库原文
    let card = null
    try {
      const cardRes = await db.collection(COLL_CARDS).doc(cardId).get()
      card = (cardRes.data && cardRes.data[0]) || null
    } catch (e) {
      card = null
    }
    if (!card) fail('这条需求不存在或已被删除', 404)
    if (card.owner_id !== me._id) fail('这不是你发布的需求', 403)

    // ================= action = 'close' =================
    if (action === 'close') {
      // 幂等：已经关闭的再点一次，按成功返回 —— 网络重试或连点两下不该弹红字
      if (card.status === 'closed') return ok(cardId, 'closed')
      // matched / removed 一律不许关：matched 说明搭子已经找到了，
      // 这时把卡关掉会让对方的「我的搭子」指向一张查不到卡，属于数据自相矛盾
      if (card.status !== 'open') fail(statusMsg('close', card.status), 409)

      const now = Date.now()
      await db.collection(COLL_CARDS).doc(cardId).update({
        status: 'closed',
        // closed_at 单独留一个字段：以后要算「发布到关闭花了多久」不用靠猜
        closed_at: now,
        updated_at: now
      })
      return ok(cardId, 'closed')
    }

    // ================= action = 'edit' =================
    if (card.status !== 'open') fail(statusMsg('edit', card.status), 409)

    // —— 3. 入参校验：与 card-publish「3. 入参校验」逐条对齐 ——
    const type = str(event.type)
    const title = str(event.title)
    const description = str(event.description)
    const locationName = str(event.location_name)
    const startTime = typeof event.start_time === 'number' ? event.start_time : null
    const endTime = typeof event.end_time === 'number' ? event.end_time : null
    let expectedPeople = parseInt(event.expected_people, 10)
    if (!(expectedPeople >= 1)) expectedPeople = 1
    if (expectedPeople > 10) expectedPeople = 10

    if (TYPE_ENUM.indexOf(type) < 0) fail('请选择需求类型')
    if (!title) fail('标题不能为空')
    if (title.length > 30) fail('标题最多 30 字')
    if (!description) fail('描述不能为空')
    if (description.length > 200) fail('描述最多 200 字')
    if (startTime && endTime && endTime < startTime) fail('结束时间不能早于开始时间')

    let tagIds = Array.isArray(event.tag_ids) ? event.tag_ids : []
    tagIds = tagIds.filter((t) => typeof t === 'string' && t).slice(0, MAX_TAGS)

    // 配图口径同 card-publish：只收自家云存储或 https 直链，超长的（base64 之类）直接丢
    let images = Array.isArray(event.images) ? event.images : []
    images = images
      .filter((u) => typeof u === 'string' && u && u.length <= MAX_IMAGE_LEN)
      .filter((u) => u.indexOf('cloud://') === 0 || u.indexOf('https://') === 0)
      .slice(0, MAX_IMAGES)

    // 标签必须真实存在且 active：伪造的 tag_id 会让匹配算法按不存在的标签算重合度
    if (tagIds.length) {
      const tagRes = await db.collection(COLL_TAGS).where({ _id: dbCmd.in(tagIds), active: true }).get()
      const validIds = tagRes.data.map((t) => t._id)
      if (validIds.length !== tagIds.length) fail('含有无效的标签，请重新选择')
      tagIds = validIds
    }

    // —— 4. 先读出旧标签行 ——
    // 事务里只用 doc 级操作（各云厂商都支持）；where 级 update/remove 在事务里
    // 并非所有平台都可用，而「标签删了新的没写上」的后果是匹配全错，不值得赌兼容性
    const oldRes = await db.collection(COLL_CARD_TAGS).where({ card_id: cardId }).get()
    const oldRows = oldRes.data || []

    const now = Date.now()
    const updates = {
      type,
      title,
      description,
      location_name: locationName,
      start_time: startTime,
      end_time: endTime,
      expected_people: expectedPeople,
      updated_at: now
    }
    // images 只有客户端明确传了数组才动：不传 = 保持原样。
    // 这一条是必须的 —— card-detail 回填的 images 是 getTempFileURL 换出来的临时链接，
    // 两小时就过期，原样存回去等于把卡片配图换成将来必然白框的地址
    if (Array.isArray(event.images)) updates.images = images

    /* —— 5. 写库：cards 与 card_tags 尽量同一个事务 ——
       写这段的目的只有一条：不能出现「标题是新的、标签还是旧的」——
       标签是匹配算法的输入，新旧混杂算出来的重合度是错的，而用户看不出来。

       但事务不是所有云厂商 / 所有版本都给（支付宝云早期版本
       `db.startTransaction` 可能不存在，或开事务直接抛错）。那种情况下的取舍：
       宁可退化成「顺序写 + 打日志」，也不能让「编辑需求」这个功能整体用不了。
       退化只在「事务根本没开起来」时发生 —— 事务开起来了才失败的，一定是真实的
       写失败或业务错误，必须原样抛出，不能偷偷改成非原子写把问题盖掉。 */
    const writeAll = async (col) => {
      // 影响 0 行说明卡片在「读」与「写」之间被删或被改了状态
      const up = await col.collection(COLL_CARDS).doc(cardId).update(updates)
      if (up && typeof up.updated === 'number' && up.updated === 0) {
        fail('这条需求刚刚有变化，请刷新后再试', 409)
      }

      // 标签全量替换：先删旧行再写新行
      for (let i = 0; i < oldRows.length; i++) {
        await col.collection(COLL_CARD_TAGS).doc(oldRows[i]._id).remove()
      }
      for (let i = 0; i < tagIds.length; i++) {
        await col.collection(COLL_CARD_TAGS).add({ card_id: cardId, tag_id: tagIds[i] })
      }
    }

    let transaction = null
    let started = false
    let done = false
    try {
      if (typeof db.startTransaction === 'function') {
        transaction = await db.startTransaction()
        started = true
        await writeAll(transaction)
        await transaction.commit()
        transaction = null
        done = true
      }
    } catch (e) {
      // 回滚失败不覆盖原始错误：用户要看到的是「为什么没改成」，不是回滚的报错
      if (transaction) {
        try {
          await transaction.rollback()
        } catch (e2) {
          console.warn('[card-update] rollback failed', e2 && e2.message)
        }
        transaction = null
      }
      if (started) throw e
      console.warn('[card-update] 事务不可用，退化为顺序写', e && e.message)
    }
    if (!done) await writeAll(db)

    return ok(cardId, 'open')
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '保存失败' }
  }
}
