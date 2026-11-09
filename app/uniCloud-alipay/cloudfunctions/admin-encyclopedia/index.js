'use strict'

/**
 * admin-encyclopedia —— M4 百科配置（列表 / 新增 / 修改 / 停用，仅管理员可用，契约 §2.3）
 *
 * 入参：{ token, action: 'list' | 'create' | 'update' | 'remove', id?, title?, content?,
 *         category?, publish_date?, active? }
 * 出参 list：{ code:0, data: { list: [...], total } }
 * 出参 create/update/remove：{ code:0, data: { _id } }
 *
 * ★ 为什么 publish_date 要显式查重，而不是靠唯一索引报错：
 *   契约 §2.3 明确「现在那条索引可能没建」。靠索引兜底等于没兜底 ——
 *   索引缺失时同一天能灌两条互相打架的百科，首页每次刷新看到的都不一样；
 *   而索引存在时返回的是数据库层的丑陋报错，前端也没法给出可读提示。
 *   所以写之前先 get 一次，占用了就 409，索引建好之后这里是双保险。
 *
 * ★ 为什么 remove 是软删：
 *   物理删会让已经看过的人下次打开报「不存在」。首页要的是「这条不推了」，
 *   不是「这条从历史上消失」，所以只置 active = false。
 *
 * ★ 为什么管理员判定在一切业务读取之前：
 *   契约 §1。先读百科再判权限，越权探测就能从 total 读出内容规模。
 */

const db = uniCloud.database()

const DB_ENCYCLOPEDIA = 'encyclopedia'

// 契约 §2.3 分类白名单（与 docs/03-database.md:198 一致）
const CATEGORIES = ['study', 'health', 'life', 'campus']

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

// 契约 §2 铁律 4：拿不到当前用户返 500
async function getUserByToken(token) {
  if (!token) fail('未登录，请重新登录', 500)
  let r = null
  try {
    r = await db
      .collection('uni-id-users')
      .where({ token: token })
      .field({ _id: true, nickname: true, is_admin: true, role: true })
      .limit(1)
      .get()
  } catch (e) {
    fail('登录状态读取失败，请稍后重试', 500)
  }
  if (!r.data || !r.data.length) fail('登录已过期，请重新登录', 500)
  return r.data[0]
}

/**
 * 日期校验：只接受 YYYY-MM-DD 或空串（空串 = 不指定日期，首页走「最近一条」回落，
 * 与 encyclopedia-daily:57-64 的回落逻辑配套）。
 * why 不用 new Date().toISOString 校验：'2026-2-3' 这种也能被 Date 收下并悄悄
 * 变成 2026-02-03，格式被"修正"过之后，字符串比较的排序就和用户的输入对不上了。
 */
function normDate(v) {
  const s = str(v)
  if (!s) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail('日期格式必须是 YYYY-MM-DD', 400)
  const y = parseInt(s.slice(0, 4), 10)
  const m = parseInt(s.slice(5, 7), 10)
  const d = parseInt(s.slice(8, 10), 10)
  // 逐月天数用 Date 校验会放过 2 月 30 日（Date 会滚到 3 月），所以自己判
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1]) fail('日期不存在：' + s, 400)
  return s
}

/**
 * 显式查重：这一天是否已经被**别的条目**占用。
 * excludeId 传自己是 update 的常态 —— 改标题不改日期时不能把自己判成冲突。
 * 表不存在时 get 会抛，这里按「没占用」放行：add 会自动建表，
 * 第一次配百科必须能成功（与 report-submit:92-102 同一个思路）。
 */
async function assertDateFree(date, excludeId) {
  if (!date) return
  let rows = []
  try {
    const res = await db.collection(DB_ENCYCLOPEDIA).where({ publish_date: date }).limit(2).get()
    rows = res.data || []
  } catch (e) {
    return
  }
  for (const row of rows) {
    if (excludeId && row._id === excludeId) continue
    fail('这一天已经有百科了', 409)
  }
}

/** 按 id 取一条；表不存在 / id 不存在都当「不存在」，由调用方决定报什么 */
async function getById(id) {
  try {
    const res = await db.collection(DB_ENCYCLOPEDIA).doc(id).get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    return null
  }
}

exports.main = async (event) => {
  try {
    event = event || {}
    // ★ 顺序铁律：认人 → 判管理员 → 才碰百科表（契约 §1）
    const me = await getUserByToken(str(event.token))
    const isAdmin = me.is_admin === true || me.role === 'admin'
    if (!isAdmin) fail('没有权限：百科配置仅管理员可用', 403)

    const action = str(event.action) || 'list'

    // ============ 列表 ============
    if (action === 'list') {
      const page = Math.max(1, parseInt(event.page, 10) || 1)
      const pageSize = Math.min(MAX_LIMIT, Math.max(1, parseInt(event.page_size, 10) || DEFAULT_LIMIT))

      let rows = []
      let total = 0
      try {
        const col = db.collection(DB_ENCYCLOPEDIA)
        const countRes = await col.count()
        total = countRes.total || 0
        const listRes = await col
          .field({ title: true, content: true, category: true, publish_date: true, active: true, created_at: true })
          // 日期倒序：管理员最常来配「最近这几天」，空串（演示/无日期）自然落到底部
          .orderBy('publish_date', 'desc')
          .orderBy('created_at', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get()
        rows = listRes.data || []
      } catch (e) {
        // 表还不存在 = 一条都没有，空态返回（契约 §2 铁律 4，与 encyclopedia-daily:71-76 同处理）
        console.warn('[admin-encyclopedia] 查询失败，按空态返回：', e && e.message)
        rows = []
        total = 0
      }

      const list = rows.map(function (row) {
        return {
          _id: row._id,
          title: str(row.title),
          content: str(row.content),
          category: str(row.category),
          publish_date: str(row.publish_date),
          // active 缺字段按「启用」算：老数据没写过这个字段，但它们是能被首页取到的，
          // 判成停用会让管理员看到一堆「停用」却仍在首页出现。
          active: row.active !== false,
          created_at: typeof row.created_at === 'number' ? row.created_at : 0
        }
      })

      return { code: 0, msg: 'ok', data: { list: list, total: total } }
    }

    // ============ 新增 ============
    if (action === 'create') {
      const title = str(event.title)
      const body = str(event.content)
      const category = str(event.category)
      if (!title) fail('标题不能为空', 400)
      if (!body) fail('正文不能为空', 400)
      if (CATEGORIES.indexOf(category) < 0) fail('不支持的分类：' + category, 400)
      const publishDate = normDate(event.publish_date)

      // ★ 先查重再写：唯一索引可能还没建（契约 §2.3）
      await assertDateFree(publishDate, '')

      const now = Date.now()
      const addRes = await db.collection(DB_ENCYCLOPEDIA).add({
        title: title,
        content: body,
        category: category,
        publish_date: publishDate,
        // 新建默认启用：管理员点「新增」就是想让这条出现在首页
        active: event.active === false ? false : true,
        created_at: now,
        updated_at: now
      })

      return { code: 0, msg: 'ok', data: { _id: addRes.id } }
    }

    // ============ 修改 ============
    if (action === 'update') {
      const id = str(event.id)
      if (!id) fail('缺少 id', 400)

      const old = await getById(id)
      if (!old) fail('这条百科不存在', 404)

      // 只改传了的字段：没传的保持原样，避免「改个标题把正文清空」这种事故
      const patch = { updated_at: Date.now() }

      if (event.title !== undefined) {
        const title = str(event.title)
        if (!title) fail('标题不能为空', 400)
        patch.title = title
      }
      if (event.content !== undefined) {
        const body = str(event.content)
        if (!body) fail('正文不能为空', 400)
        patch.content = body
      }
      if (event.category !== undefined) {
        const category = str(event.category)
        if (CATEGORIES.indexOf(category) < 0) fail('不支持的分类：' + category, 400)
        patch.category = category
      }
      if (event.publish_date !== undefined) {
        const publishDate = normDate(event.publish_date)
        // 非空日期必须显式查重，且排除自己（改正文不改日期时不能撞自己）
        await assertDateFree(publishDate, id)
        patch.publish_date = publishDate
      }
      if (event.active !== undefined) patch.active = event.active !== false

      await db.collection(DB_ENCYCLOPEDIA).doc(id).update(patch)
      return { code: 0, msg: 'ok', data: { _id: id } }
    }

    // ============ 停用（软删） ============
    if (action === 'remove') {
      const id = str(event.id)
      if (!id) fail('缺少 id', 400)

      const old = await getById(id)
      if (!old) fail('这条百科不存在', 404)

      // ★ 软删：只置 active = false，绝不物理删（契约 §2.3 的理由见文件头）
      await db.collection(DB_ENCYCLOPEDIA).doc(id).update({ active: false, updated_at: Date.now() })
      return { code: 0, msg: 'ok', data: { _id: id } }
    }

    fail('不支持的操作：' + action)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '处理失败' }
  }
}
