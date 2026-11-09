'use strict';

/**
 * encyclopedia-list —— 百科列表分页（交接 §2.1）
 *
 * 为什么不要 token：百科是未登录也该能读的内容，口径与 encyclopedia-daily 一致。
 * 为什么列表不下发全文：20 条 × 150 字 ≈ 3000 字，小程序一次全收会明显卡顿，
 * 所以这里只给 summary，全文留给 encyclopedia-detail。
 */

const DB_ENCYCLOPEDIA = 'encyclopedia';
const SUMMARY_LEN = 60;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

// 老数据可能缺字段或类型不对，统一收敛成字符串，前端不用再判
function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// 分页参数从 query/前端来的是字符串，统一收敛成整数；越界夹到边界，非法就落回默认值，
// 否则 skip 会算出 NaN 让整页查空
function intInRange(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!isFinite(n) || n < min) return def;
  return n > max ? max : n;
}

// 不足 60 字时原样返回、不加省略号，免得 10 个字的内容后面挂个「…」显得被截断了
function toSummary(content) {
  const s = str(content);
  return s.length > SUMMARY_LEN ? s.slice(0, SUMMARY_LEN) + '…' : s;
}

// 只回契约 §2.1 列出的六个字段：active 是内部筛选条件，content 全文不发
function toCard(row) {
  return {
    _id: str(row._id),
    title: str(row.title),
    category: str(row.category),
    publish_date: str(row.publish_date),
    summary: toSummary(row.content),
    created_at: typeof row.created_at === 'number' ? row.created_at : 0
  };
}

// 表还没建时，对前端「一条都没有」和「查询失败」是同一件事：空列表，不报错
function emptyData() {
  return { list: [], total: 0, page: 1, page_size: 20, has_more: false };
}

exports.main = async (event) => {
  const e = event || {};
  const page = intInRange(e.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = intInRange(e.page_size, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  const db = uniCloud.database();
  const col = db.collection(DB_ENCYCLOPEDIA);
  // 软删（active:false）的条目不该出现在列表里
  const cond = { active: true };

  try {
    const countRes = await col.where(cond).count();
    const total = countRes && typeof countRes.total === 'number' ? countRes.total : 0;

    // 顺序不可颠倒：publish_date 倒序为主，created_at 兜底让演示数据（publish_date 空串）也有稳定次序
    const res = await col
      .where(cond)
      .orderBy('publish_date', 'desc')
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();
    const rows = (res && res.data) || [];

    return {
      code: 0,
      msg: 'ok',
      data: {
        list: rows.map(toCard),
        total: total,
        page: page,
        page_size: pageSize,
        // 与 total 同口径判断，避免出现 total 说没有下一页却还能再翻一页
        has_more: page * pageSize < total
      }
    };
  } catch (err) {
    console.warn('[encyclopedia-list] encyclopedia 查询失败，按空列表返回：', err && err.message);
    return { code: 0, msg: 'ok', data: emptyData() };
  }
};
