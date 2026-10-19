'use strict';

/**
 * tag-list —— 读标签字典（第 2 天）
 *
 * 入参：无（或 { category } 只取某一类）
 * 出参：{ code, msg, data: { list: [{ _id, name, category, weight, sort }] } }
 *
 * 前端标签编辑器靠它渲染所有可选标签，按 category 分组显示。
 */

const DB_TAGS = 'tags';

function ok(data) {
  return { code: 0, msg: 'ok', data };
}

exports.main = async (event, context) => {
  const db = uniCloud.database();
  const tags = db.collection(DB_TAGS);

  const where = { active: true };
  if (event && event.category) {
    where.category = event.category;
  }

  // 只取需要的字段，别把整条文档丢给前端
  const res = await tags
    .where(where)
    .field({ _id: true, name: true, category: true, weight: true, sort: true })
    .orderBy('sort', 'asc')
    .limit(1000)
    .get();

  // 顺手按分类分好组，前端直接用
  const grouped = {};
  (res.data || []).forEach((t) => {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  });

  return ok({
    list: res.data || [],
    grouped,
    total: (res.data || []).length
  });
};
