'use strict'
/**
 * school-list —— 学校查询（注册选校、认证选校、后台筛选用）
 *
 * 入参：
 *   { keyword?: string, city_code?: string, level?: string, page?, page_size? }
 *
 * 为什么要有这个函数：
 *   学校必须是"选"出来的，不能用户手打。手打会产生
 *   "北京大学"/"北大"/"北京大学 " 三种写法，同校频道就筛不出同一批人。
 *
 * 搜索逻辑：
 *   keyword 同时在 name 和 aliases 里匹配。
 *   所以搜"北大"能出"北京大学"（because aliases 里存了'北大'）。
 *   文档型数据库没有全文索引，这里用正则模糊匹配，数据量小（几百条）性能没问题。
 */

const db = uniCloud.database()
const DB_SCHOOLS = 'schools'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

exports.main = async (event, context) => {
  const keyword = String(event.keyword || '').trim()
  const cityCode = String(event.city_code || '').trim()
  const level = String(event.level || '').trim()
  const page = Math.max(1, parseInt(event.page, 10) || 1)
  const pageSize = Math.min(MAX_LIMIT, Math.max(1, parseInt(event.page_size, 10) || DEFAULT_LIMIT))

  const where = { active: true }

  if (cityCode) where.city_code = cityCode
  if (level) where.level = level

  // 关键词：匹配全称或任一个别名。
  // 用 dbCmd.or 组合；keyword 里的正则特殊字符要转义，否则用户输入 "(" 会报错。
  if (keyword) {
    const safe = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const reg = new RegExp(safe, 'i')
    where.$or = [{ name: reg }, { aliases: reg }]
  }

  const col = db.collection(DB_SCHOOLS)

  const countRes = await col.where(where).count()
  const listRes = await col
    .where(where)
    .field({ _id: true, name: true, aliases: true, city_code: true, province: true, level: true })
    .orderBy('name', 'asc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get()

  const list = listRes.data.map((s) => ({
    school_id: s._id,
    name: s.name,
    aliases: s.aliases || [],
    city_code: s.city_code || '',
    province: s.province || '',
    level: s.level || 'university'
  }))

  return {
    code: 0,
    msg: 'ok',
    data: {
      list: list,
      total: countRes.total,
      page: page,
      page_size: pageSize,
      has_more: page * pageSize < countRes.total
    }
  }
}
