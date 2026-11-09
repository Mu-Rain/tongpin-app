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
 *
 * 另外带出上次定位 geo_lat / geo_lng / geo_name / geo_at（由 user-locate 写入）：
 * 前端进页面就能显示「上次的位置」，不用等一次定位授权。
 * 出参：{ code:0, data:{ user: { ..., avatar, avatar_url } } }
 *       avatar 是库里的原值（fileID 或历史链接），avatar_url 是可直接当 src 的临时链接
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

/**
 * 头像换链：库里存的是 fileID（cloud://），前端 <image> 只认 http。
 * 为什么放服务端：客户端那端不保证换得动，换不动的表现就是「我的页没头像、
 * 别人看自己有头像」——同一份数据两条链路结出两种结果，最难查。
 * 整段 try/catch：换链失败只是少张图，绝不能把整个接口打成 500。
 */
async function toTempUrl(fileId) {
  const id = typeof fileId === 'string' ? fileId : '';
  if (!id) return '';
  // 已经是 http 直链（阿里云空间或历史数据）就直接当结果，不再多一次请求
  if (id.indexOf('cloud://') !== 0) return id;
  try {
    const res = await uniCloud.getTempFileURL({ fileList: [id] });
    const it = (res && res.fileList && res.fileList[0]) || {};
    return it.tempFileURL || '';
  } catch (e) {
    console.warn('[user-me] 头像换链失败，avatar_url 留空', e && e.message);
    return '';
  }
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

  // 库里可能只有 avatar（uni-id 标准字段）或只有 avatar_url（本项目历史字段）
  const avatarRaw = user.avatar || user.avatar_url || '';

  return ok({
    user: {
      _id: user._id,
      // 对外唯一身份号（8 位数字）。老账号由 user-login / user-auto-login 补，
      // 这里只读；没有就给空串，前端据此决定显不显示那一行。
      uid: user.uid || '',
      phone: user.phone,
      nickname: user.nickname,
      // avatar 保持原值不动：前端要靠它区分「有 fileID」和「真没头像」
      avatar: avatarRaw,
      // avatar_url 是能直接当 src 的临时链接；换不出来留空串，前端自会退回首字
      avatar_url: await toTempUrl(avatarRaw),
      school: user.school,
      // 学校 id：认证通过后才会有，同校频道靠它；两套字段名都带上
      school_id: user.school_id || '',
      city_code: user.city_code || '',
      // 上次定位（user-locate 落库）。缺失给 0 / 空串 —— 前端据此判断「有没有定位过」；
      // 不能给 null / undefined，坐标组件拿到脏值会直接抖到 (0,0)。
      geo_lat: typeof user.geo_lat === 'number' ? user.geo_lat : 0,
      geo_lng: typeof user.geo_lng === 'number' ? user.geo_lng : 0,
      geo_name: user.geo_name || '',
      geo_at: typeof user.geo_at === 'number' ? user.geo_at : 0,
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
