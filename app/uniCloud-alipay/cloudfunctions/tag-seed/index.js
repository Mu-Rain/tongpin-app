'use strict';

/**
 * tag-seed —— 一次性把标签字典灌进 `tags` 集合（第 2 天）
 *
 * 为什么要有这个：标签是「字典驱动」的，前端不能自由造标签。
 * 字典必须先有数据，标签编辑器才有东西可选、匹配算法才有 weight 可算。
 *
 * 用法：部署后调一次即可。重复调用不会产生重复数据（按 name 查重）。
 * 想重新灌：传 { reset: true }，会先删掉旧的再插。
 *
 * 分类与 weight 规则（见 docs/03-database.md §2.1）：
 *   - 作息 / 强度 / 兴趣 / 偏好 / 科目：weight = 1
 *   - 性格：weight = 1.5（性格合拍比兴趣一致更重要，所以权重高）
 */

const DB_TAGS = 'tags';

// 标签字典：category 用英文 key 存库，中文名走 name
const SEED = [
  // ---- 作息 ----
  { name: '早起型', category: 'routine' },
  { name: '夜猫子', category: 'routine' },
  { name: '作息规律', category: 'routine' },
  { name: '周末补觉', category: 'routine' },

  // ---- 强度 ----
  { name: '卷王', category: 'intensity' },
  { name: '佛系', category: 'intensity' },
  { name: '高强度', category: 'intensity' },
  { name: '轻松就好', category: 'intensity' },
  { name: '循序渐进', category: 'intensity' },

  // ---- 性格（weight 1.5）----
  { name: '话痨', category: 'personality' },
  { name: '安静', category: 'personality' },
  { name: '行动派', category: 'personality' },
  { name: '计划控', category: 'personality' },
  { name: '随性派', category: 'personality' },
  { name: '慢热', category: 'personality' },
  { name: '外向', category: 'personality' },
  { name: '重度社恐', category: 'personality' },

  // ---- 兴趣 ----
  { name: '健身', category: 'interest' },
  { name: '跑步', category: 'interest' },
  { name: '篮球', category: 'interest' },
  { name: '羽毛球', category: 'interest' },
  { name: '游泳', category: 'interest' },
  { name: '摄影', category: 'interest' },
  { name: '音乐', category: 'interest' },
  { name: '看电影', category: 'interest' },
  { name: '打游戏', category: 'interest' },
  { name: '桌游', category: 'interest' },
  { name: '美食探店', category: 'interest' },
  { name: '旅行', category: 'interest' },
  { name: '读书', category: 'interest' },
  { name: '画画', category: 'interest' },

  // ---- 偏好 ----
  { name: '线上交流', category: 'preference' },
  { name: '线下见面', category: 'preference' },
  { name: '安静场所', category: 'preference' },
  { name: '热闹氛围', category: 'preference' },
  { name: '长期搭子', category: 'preference' },
  { name: '临时搭一次', category: 'preference' },
  { name: '拒绝拖延', category: 'preference' },
  { name: '互相监督', category: 'preference' },

  // ---- 科目 ----
  { name: '高数', category: 'subject' },
  { name: '英语', category: 'subject' },
  { name: '四六级', category: 'subject' },
  { name: '考研', category: 'subject' },
  { name: '考公', category: 'subject' },
  { name: '专业课', category: 'subject' },
  { name: '编程', category: 'subject' },
  { name: '金融', category: 'subject' },
  { name: '法学', category: 'subject' },
  { name: '医学', category: 'subject' },
  { name: '实验报告', category: 'subject' },
  { name: '论文写作', category: 'subject' }
];

// 分类 → weight
function weightOf(category) {
  return category === 'personality' ? 1.5 : 1;
}

function ok(data) {
  return { code: 0, msg: 'ok', data };
}
function fail(code, msg) {
  return { code, msg };
}

exports.main = async (event, context) => {
  const db = uniCloud.database();
  const tags = db.collection(DB_TAGS);

  // 可选重置
  if (event && event.reset === true) {
    // 云函数端一次最多删 1000 条，标签量级远小于这个数
    await tags.where({ _id: db.command.neq('') }).remove();
  }

  let inserted = 0;
  let skipped = 0;
  const now = Date.now();

  for (let i = 0; i < SEED.length; i++) {
    const item = SEED[i];

    // 按 name 查重：已存在就跳过，保证可重复调用
    const exist = await tags.where({ name: item.name }).limit(1).get();
    if (exist.data && exist.data.length > 0) {
      skipped++;
      continue;
    }

    await tags.add({
      name: item.name,
      category: item.category,
      weight: weightOf(item.category),
      sort: i, // 用灌入顺序当排序，前端按这个排
      active: true,
      createTime: now
    });
    inserted++;
  }

  // 返回一份分类统计，方便直接验证
  const all = await tags.where({ active: true }).limit(1000).get();
  const byCategory = {};
  (all.data || []).forEach((t) => {
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
  });

  return ok({
    total: (all.data || []).length,
    inserted,
    skipped,
    byCategory
  });
};
