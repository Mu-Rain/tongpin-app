'use strict';

/**
 * user-me —— 读「我」的最新资料（token 换用户，不校验密码）
 *
 * 为什么需要它：
 *   登录时 user-login 会把一份用户信息写进本地缓存 userInfo，页面全读这份。
 *   所以在后台改了 role / credit / school_id 之后，App 里看到的还是旧的，
 *   必须退出再登录才刷新 —— 开发期改个权限要重登一次，太折腾。
 *   这个函数只读不写，前端拿到后覆盖本地缓存，就能「改完立刻生效」。
 *
 * 入参：{ token }
 * 出参：{ code:0, data:{ user: {...} } }
 *
 * 注意：返回字段要和 user-login 的 user 对象保持一致，
 *      否则两边刷新出来的人会对不上（本项目已经被"两套字段名"坑过两次了）。
 */

const db = uniCloud.database();

const DB_USERS = 'uni-id-users';

function ok(data) {
  return { code: 0, msg: 'ok', data };
}

function fail(code, msg) {
  return { code, msg };
}

exports.main = async (event) => {
  const token = String((event && event.token) || '');

  if (!token) return fail(401, '未登录');

  const res = await db
    .collection(DB_USERS)
    .where({ token })
    .limit(1)
    .get();

  const user = res.data && res.data[0];

  if (!user) return fail(401, '登录已过期，请重新登录');

  // token 过期保护：登录时写了 tokenExpire，这里要真校验，不然 token 永不过期
  if (user.tokenExpire && Date.now() > user.tokenExpire) {
    return fail(401, '登录已过期，请重新登录');
  }

  return ok({
    user: {
      _id: user._id,
      phone: user.phone,
      nickname: user.nickname,
      avatar: user.avatar,
      school: user.school,
      // 学校 id：认证通过后才会有，同校频道靠它；两套字段名都带上
      school_id: user.school_id || '',
      city_code: user.city_code || '',
      // 认证状态：两套字段名都带上（schoolVerified 是第 1 天的写法，
      // is_verified 是 03 文档设计的写法）
      schoolVerified: !!(user.schoolVerified || user.is_verified),
      is_verified: !!(user.is_verified || user.schoolVerified),
      // ★ 角色：前端靠它决定显不显示管理员入口
      role: user.role || '',
      is_admin: user.is_admin === true,
      // 信誉分：两套字段名
      credit: typeof user.credit === 'number' ? user.credit : typeof user.credit_score === 'number' ? user.credit_score : 80,
      credit_score: typeof user.credit_score === 'number' ? user.credit_score : typeof user.credit === 'number' ? user.credit : 80,
      titles: user.titles || [],
      tags: user.tags || [],
      createTime: user.createTime
    }
  });
};
