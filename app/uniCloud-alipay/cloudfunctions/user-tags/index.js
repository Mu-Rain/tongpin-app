'use strict';

/**
 * user-tags —— 读写「我选的标签」（第 2 天）
 *
 * 两个动作，用 event.action 区分：
 *   action='get'  → 返回我选的标签（带 name/category/weight，前端好直接渲染）
 *   action='save' → 全量覆盖保存我选的标签
 *
 * 为什么是全量覆盖而不是增删单条：
 *   标签编辑器是「选完点保存」的交互，前端手上就是完整的一份列表，
 *   全量覆盖逻辑最简单，也不会出现漏删导致的脏数据。
 *
 * 身份怎么认：客户端传 token，云函数拿 token 反查用户。
 *   注意——这是最简实现。token 直接存在 users 表里，
 *   没有签名、没有防篡改。第 3 天要换成 JWT 并校验签名。
 */

const DB_USERS = 'uni-id-users';
const DB_TAGS = 'tags';
const DB_USER_TAGS = 'user_tags';

// 规则（来自 docs/01-requirements.md US-02）：至少 1 个，最多 10 个
const MIN_TAGS = 1;
const MAX_TAGS = 10;

function ok(data) {
  return { code: 0, msg: 'ok', data };
}
function fail(code, msg) {
  return { code, msg };
}

// 用 token 换用户。token 过期也判掉。
async function getUserByToken(db, token) {
  if (!token || typeof token !== 'string') return null;
  const res = await db
    .collection(DB_USERS)
    .where({ token })
    .limit(1)
    .get();
  const user = res.data && res.data[0];
  if (!user) return null;
  if (user.tokenExpire && user.tokenExpire < Date.now()) return null;
  if (user.status === 0) return null;
  return user;
}

exports.main = async (event, context) => {
  const db = uniCloud.database();
  const dbCmd = db.command;

  const action = event.action || 'get';
  const token = event.token;

  const user = await getUserByToken(db, token);
  if (!user) {
    return fail(3001, '登录已过期，请重新登录');
  }

  const userTags = db.collection(DB_USER_TAGS);

  // ---------- 读取 ----------
  if (action === 'get') {
    const mine = await userTags.where({ user_id: user._id }).get();
    const rows = mine.data || [];
    if (rows.length === 0) {
      return ok({ list: [], count: 0 });
    }

    // 把标签详情补上：user_tags 只存 tag_id，前端要显示名字得再查一次 tags
    const tagIds = rows.map((r) => r.tag_id);
    const tagRes = await db
      .collection(DB_TAGS)
      .where({ _id: dbCmd.in(tagIds) })
      .field({ _id: true, name: true, category: true, weight: true, sort: true })
      .get();

    // 按 user_tags 的顺序拼回去，并带上 weight（以 user_tags 里存的为准，
    // 因为以后可能允许用户单独调某个标签的权重）
    const tagMap = {};
    (tagRes.data || []).forEach((t) => {
      tagMap[t._id] = t;
    });

    const list = rows
      .map((r) => {
        const t = tagMap[r.tag_id];
        if (!t) return null; // 标签被下架了就跳过
        return {
          tag_id: r.tag_id,
          name: t.name,
          category: t.category,
          weight: r.weight || t.weight || 1,
          sort: t.sort
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));

    return ok({ list, count: list.length });
  }

  // ---------- 保存 ----------
  if (action === 'save') {
    const tagIds = Array.isArray(event.tagIds) ? event.tagIds : [];

    // 去重（用户可能手抖传重复的）
    const unique = [];
    const seen = {};
    tagIds.forEach((id) => {
      if (typeof id !== 'string' || !id) return;
      if (seen[id]) return;
      seen[id] = true;
      unique.push(id);
    });

    if (unique.length < MIN_TAGS) {
      return fail(3002, `至少选 ${MIN_TAGS} 个标签`);
    }
    if (unique.length > MAX_TAGS) {
      return fail(3003, `最多选 ${MAX_TAGS} 个标签`);
    }

    // 校验每个 tag_id 真实存在且 active，防止客户端伪造
    const validRes = await db
      .collection(DB_TAGS)
      .where({ _id: dbCmd.in(unique), active: true })
      .field({ _id: true, weight: true })
      .get();
    const validRows = validRes.data || [];
    if (validRows.length !== unique.length) {
      return fail(3004, '包含无效标签，请刷新后重试');
    }

    const weightMap = {};
    validRows.forEach((t) => {
      weightMap[t._id] = t.weight || 1;
    });

    // 全量覆盖：先删旧的，再插新的。
    // 顺序很重要——先删后插，避免中途失败留下重复数据。
    await userTags.where({ user_id: user._id }).remove();

    const now = Date.now();
    let inserted = 0;
    for (let i = 0; i < unique.length; i++) {
      await userTags.add({
        user_id: user._id,
        tag_id: unique[i],
        // 用标签字典的 weight（性格类 1.5），保证算法口径统一
        weight: weightMap[unique[i]],
        sort: i,
        createTime: now
      });
      inserted++;
    }

    // 顺手把用户表的更新时间戳刷一下，方便后台看活跃度
    await db.collection(DB_USERS).doc(user._id).update({
      updateTime: now
    });

    return ok({ saved: inserted, count: inserted });
  }

  return fail(3005, '未知操作：' + action);
};
