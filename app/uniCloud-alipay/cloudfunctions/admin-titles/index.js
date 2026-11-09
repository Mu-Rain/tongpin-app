'use strict'

/**
 * admin-titles —— M4 称号配置（列表 / upsert，仅管理员可用，契约 §2.4）
 *
 * 入参：{ token, action: 'list' | 'update', code?, name?, desc?, rarity?,
 *         condition_text?, active?, sort? }
 * 出参 list：  { code:0, data: { list: [...], total } }
 * 出参 update：{ code:0, data: { code } }
 *
 * ★ 为什么列表要把代码内置的 3 条也列出来：
 *   契约 §2.4 的理由是「管理员要能改内置 3 条的文案，而不是面对一个空列表」。
 *   titles 表在内容进来之前是空的（docs/03-database.md:184「表可以是空的」），
 *   只列表里那几行的话，管理员第一次进来看到的是一片空，根本不知道有哪 3 条。
 *   所以内置 3 条打底，表里的行覆盖 / 追加 —— 与 title-list:115-155 的 loadDefs 同一套合并。
 *
 * ★ source 怎么算：表里有这个 code 的行 → 'table'，否则 'builtin'。
 *   契约 §2.4 明写「upsert 时表里没有这个 code 就 add 一条（source 变 table）」，
 *   所以来源跟「定义当前落在哪里」走，不跟 code 是不是内置走。
 *   反过来按 code 判会让「内置称号被改过」这件事在列表里看不出来。
 *
 * ★ 为什么只做 list / update、不做删除：
 *   内置 3 条删不掉（代码里就有），删表行会让它退回内置文案，管理员以为自己删了其实没删。
 *   要停用就 active=false，title-list:143 对非内置项会直接不上墙，对内建项回落内置定义。
 *
 * ★ 为什么 code 不可改：
 *   它是 user_titles.title_id 存的那个键（docs/03-database.md:185），
 *   改 code 等于把已经拿到这个称号的所有人的记录变成孤儿（称号墙上直接消失）。
 */

const db = uniCloud.database()

const DB_TITLES = 'titles'

// 契约 §2.4 稀有度白名单
const RARITIES = ['common', 'rare', 'epic']

// 内置 3 条：逐字照抄 title-list:30-58（契约 §1）。
// 这里是「打底 + 兜底」的副本 —— 改这里必须同步 title-list，否则后台看到的文案
// 和称号墙上真正显示的文案会不一样。
const DEFAULT_TITLES = [
  {
    code: 'profile_complete',
    name: '资料完整',
    desc: '',
    rarity: 'common',
    condition_type: 'profile',
    condition_text: '填了昵称、头像、学校，并选了至少 1 个标签',
    sort: 10
  },
  {
    code: 'verify_pass',
    name: '学生已认证',
    desc: '',
    rarity: 'common',
    condition_type: 'verify',
    condition_text: '通过一次学生认证',
    sort: 20
  },
  {
    code: 'first_buddy',
    name: '第一次搭成',
    desc: '',
    rarity: 'common',
    condition_type: 'buddy',
    condition_text: '和同学完整搭成一次（双方都确认）',
    sort: 30
  }
]

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function pickInt(v, dft) {
  return typeof v === 'number' ? v : dft
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

function defaultTitle(code) {
  for (let i = 0; i < DEFAULT_TITLES.length; i++) {
    if (DEFAULT_TITLES[i].code === code) return DEFAULT_TITLES[i]
  }
  return null
}

/**
 * 读 titles 表全量。
 * 表不存在时 get 会抛 —— 契约 §2 铁律 4 要求静默降级：
 * 表空就等于「只有内置 3 条」，这也是管理员第一次进来最该看到的样子。
 * 返回 code → row 的映射，方便按 code 合并，不用每次线性找。
 */
async function loadTableRows() {
  const map = {}
  try {
    const res = await db.collection(DB_TITLES).limit(200).get()
    for (const row of res.data || []) {
      const code = str(row.code)
      if (code) map[code] = row
    }
  } catch (e) {
    console.warn('[admin-titles] titles 查询失败，只返回内置 3 条：', e && e.message)
  }
  return map
}

/** sort 升序，同 sort 按 code 排：两次调用顺序一致，列表不会闪来闪去 */
function sortList(arr) {
  arr.sort(function (a, b) {
    if (a.sort !== b.sort) return a.sort - b.sort
    if (a.code === b.code) return 0
    return a.code < b.code ? -1 : 1
  })
  return arr
}

exports.main = async (event) => {
  try {
    event = event || {}
    // ★ 顺序铁律：认人 → 判管理员 → 才碰 titles 表（契约 §1）
    const me = await getUserByToken(str(event.token))
    const isAdmin = me.is_admin === true || me.role === 'admin'
    if (!isAdmin) fail('没有权限：称号配置仅管理员可用', 403)

    const action = str(event.action) || 'list'

    // ============ 列表 ============
    if (action === 'list') {
      const tableMap = await loadTableRows()
      const list = []
      const seen = {}

      // 1) 内置 3 条打底，表里有同 code 的行就用表里的值覆盖
      DEFAULT_TITLES.forEach(function (d) {
        const row = tableMap[d.code]
        seen[d.code] = true
        list.push({
          code: d.code,
          name: row ? str(row.name) || d.name : d.name,
          desc: row ? str(row.desc) || d.desc : d.desc,
          rarity: row ? str(row.rarity) || d.rarity : d.rarity,
          condition_text: row ? str(row.condition_text) || d.condition_text : d.condition_text,
          // 表行存在时以表为准；active 缺字段按启用算（老数据没写过这个字段）
          active: row ? row.active !== false : true,
          sort: row ? pickInt(row.sort, d.sort) : d.sort,
          source: row ? 'table' : 'builtin'
        })
      })

      // 2) 表里自定义的 code 追加在后面（内置那 3 个已经盖过了，跳过避免重复）
      Object.keys(tableMap).forEach(function (code) {
        if (seen[code]) return
        const row = tableMap[code]
        list.push({
          code: code,
          name: str(row.name) || code,
          desc: str(row.desc),
          rarity: str(row.rarity) || 'common',
          condition_text: str(row.condition_text),
          active: row.active !== false,
          sort: pickInt(row.sort, 100),
          source: 'table'
        })
      })

      return { code: 0, msg: 'ok', data: { list: sortList(list), total: list.length } }
    }

    // ============ upsert ============
    if (action === 'update') {
      // code 只作为键读入，patch 里永远不写它 —— 契约 §2.4「code 不可改」
      const code = str(event.code)
      if (!code) fail('缺少 code', 400)

      const dft = defaultTitle(code)
      let existing = null
      try {
        const res = await db.collection(DB_TITLES).where({ code: code }).limit(1).get()
        existing = (res.data && res.data[0]) || null
      } catch (e) {
        // 表不存在 = 这个 code 还没有行，接着按「新建」走（add 会自动建表）
        existing = null
      }

      // ★ why 按「传了才改」而不是整体覆盖：
      //   后台页面可能只改一个条件文案就保存，其余字段没带上。
      //   整体覆盖会把名字/稀有度清成 undefined，称号墙上直接露出空名字。
      const patch = {}

      if (event.name !== undefined) {
        const name = str(event.name)
        if (!name) fail('称号名称不能为空', 400)
        patch.name = name
      }
      if (event.desc !== undefined) patch.desc = str(event.desc)
      if (event.rarity !== undefined) {
        const rarity = str(event.rarity)
        if (RARITIES.indexOf(rarity) < 0) fail('不支持的稀有度：' + rarity, 400)
        patch.rarity = rarity
      }
      if (event.condition_text !== undefined) patch.condition_text = str(event.condition_text)
      if (event.sort !== undefined) {
        const sort = parseInt(event.sort, 10)
        if (!isFinite(sort)) fail('排序必须是数字', 400)
        patch.sort = sort
      }
      if (event.active !== undefined) patch.active = event.active !== false

      const now = Date.now()

      if (existing) {
        patch.updated_at = now
        await db.collection(DB_TITLES).doc(existing._id).update(patch)
        return { code: 0, msg: 'ok', data: { code: code } }
      }

      // ---- 新建：缺的字段用内置默认兜底，自定义 code 则给中性默认 ----
      // 名称是必填：没有名字的称号在称号墙上就是一行空白，管理员会以为是 bug。
      const name = patch.name || (dft ? dft.name : '')
      if (!str(name)) fail('请填写称号名称', 400)

      const record = {
        code: code,
        name: name,
        desc: patch.desc !== undefined ? patch.desc : dft ? dft.desc : '',
        rarity: patch.rarity || (dft ? dft.rarity : 'common'),
        // condition_type 不对外开放修改，但要落库：judge 靠它决定怎么判（title-list:239）。
        // 新行没写这个字段的话，title-list 会回落内置默认，行为一致但表行不自洽，
        // 所以内置 code 直接把默认类型写上；自定义 code 留空 = 永远判不满足（绝不误发）。
        condition_type: dft ? dft.condition_type : '',
        condition_text: patch.condition_text !== undefined ? patch.condition_text : dft ? dft.condition_text : '',
        // 没指定排序时：内置 code 用它原来的位置，自定义 code 排到最后
        sort: patch.sort !== undefined ? patch.sort : dft ? dft.sort : 100,
        active: patch.active !== undefined ? patch.active : true,
        created_at: now,
        updated_at: now
      }

      await db.collection(DB_TITLES).add(record)
      return { code: 0, msg: 'ok', data: { code: code } }
    }

    fail('不支持的操作：' + action)
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '处理失败' }
  }
}
