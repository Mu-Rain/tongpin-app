'use strict';

/**
 * encyclopedia-daily —— 首页「每日百科」卡取「今天这一条」（契约 §2）
 *
 * 为什么入参为空：百科是首页未登录也要能看的内容，
 * 要了 token 等于逼人先登录才配看一眼。
 *
 * 为什么表缺失也返回 200：本函数是首页首屏的一环，encyclopedia 表在内容进来之前
 * 根本不存在，抛出去会把整张首页卡拖成错误态。查不到和没有就是同一件事。
 */

const DB_ENCYCLOPEDIA = 'encyclopedia';

// 服务器跑 UTC：北京时间 0:00-8:00 直接取 UTC 日期会得到昨天，
// 先加 8 小时再切日期，拿到的才是学生眼里的「今天」。
const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;

function bjToday() {
  return new Date(Date.now() + BJ_OFFSET_MS).toISOString().slice(0, 10);
}

// 老数据可能缺字段或类型不对，统一收敛成字符串，前端不用再判
function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// 只回契约 §2 列出的四个字段：_id / active / created_at 是内部字段，
// 多带出去只会和契约对不上，前端也用不着。
function toItem(row) {
  if (!row) return null;
  return {
    title: str(row.title),
    content: str(row.content),
    category: str(row.category),
    publish_date: str(row.publish_date)
  };
}

exports.main = async () => {
  const db = uniCloud.database();
  const col = db.collection(DB_ENCYCLOPEDIA);
  const today = bjToday();

  let item = null;
  let src = 'none';

  try {
    // 顺序不可颠倒：先今天精确命中，没有再回落最近一条
    const todayRes = await col.where({ publish_date: today, active: true }).limit(1).get();
    const todayRow = (todayRes.data && todayRes.data[0]) || null;

    if (todayRow) {
      item = toItem(todayRow);
      src = 'today';
    } else {
      // publish_date 按字符串倒序即按日期倒序；同一天/演示数据（空串）时
      // 用 created_at 兜底，保证每次调用给的是同一张卡，不会来回闪
      const latestRes = await col
        .where({ active: true })
        .orderBy('publish_date', 'desc')
        .orderBy('created_at', 'desc')
        .limit(1)
        .get();
      const latestRow = (latestRes.data && latestRes.data[0]) || null;
      if (latestRow) {
        item = toItem(latestRow);
        src = 'latest';
      }
    }
  } catch (e) {
    // 表不存在（第一次查询必抛）与「一条都没有」对前端是同一件事：空态
    console.warn('[encyclopedia-daily] encyclopedia 查询失败，按空态返回：', e && e.message);
    item = null;
    src = 'none';
  }

  return { code: 0, msg: 'ok', data: { item: item, src: src } };
};
