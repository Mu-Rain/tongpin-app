'use strict';

/**
 * encyclopedia-detail —— 百科详情全文（交接 §2.2）
 *
 * 为什么不要 token：与列表同口径，未登录也能读全文。
 * 为什么「没有这一条」走 404 而不抛异常：id 缺失、已软删、表还没建，
 * 对学生都是同一件事——这篇下线了。抛出去只会让前端把空态画成错误态。
 */

const DB_ENCYCLOPEDIA = 'encyclopedia';
const MSG_OFFLINE = '这篇百科已经下线了';

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function offline() {
  return { code: 404, msg: MSG_OFFLINE, data: { item: null } };
}

// content 是全文，不 trim 掉内部换行；其余字段仍按字符串收敛，
// 前端拿到就能直接渲染，不用为老数据写兜底
function toItem(row) {
  return {
    _id: str(row._id),
    title: str(row.title),
    content: typeof row.content === 'string' ? row.content : '',
    category: str(row.category),
    publish_date: str(row.publish_date),
    created_at: typeof row.created_at === 'number' ? row.created_at : 0
  };
}

exports.main = async (event) => {
  const id = str((event || {}).id);
  // id 缺失是「打不开这一篇」，不是服务器出错
  if (!id) return offline();

  const db = uniCloud.database();
  const col = db.collection(DB_ENCYCLOPEDIA);

  try {
    // 把 active 写进 where 而不是查回来再判：软删的条目对调用方等于不存在
    const res = await col.where({ _id: id, active: true }).limit(1).get();
    const row = res && res.data && res.data[0];
    if (!row) return offline();
    return { code: 0, msg: 'ok', data: { item: toItem(row) } };
  } catch (err) {
    // 表不存在也只是「没有这一条」，所以降级成 404 而不是 500
    console.warn('[encyclopedia-detail] encyclopedia 查询失败，按下线返回：', err && err.message);
    return offline();
  }
};
