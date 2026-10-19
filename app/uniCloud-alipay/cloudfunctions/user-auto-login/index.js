'use strict';

/**
 * user-auto-login —— 用本地 token 换回登录态（第 4 天补）
 *
 * 为什么要有它：
 *   原来 App 每次冷启动都停在登录页，因为 token 虽然存在手机本地，
 *   但没有任何一处代码在启动时拿它去验证。结果是"HBuilderX 每次运行
 *   都要重新登录一次"。
 *
 * 入参：{ token }
 * 出参：
 *   成功 { code: 0, data: { token, user } }
 *   失败 { code: 3001, msg: '登录已过期，请重新登录' }
 *
 * ⚠️ 安全说明（答辩可能被问）：
 *   token 明文存在 users 集合里，这是**开发期的简化做法**。
 *   真上线应该存哈希（token_hash），并且 token 要绑定设备、
 *   支持主动吊销。**这一条不要忘了改**，否则任何一个拿到数据库
 *   快照的人都能冒充所有用户。
 */

const DB_USERS = 'uni-id-users';

function ok(data) {
  return { code: 0, msg: 'ok', data };
}
function fail(code, msg) {
  return { code, msg };
}

exports.main = async (event) => {
  const db = uniCloud.database();
  const users = db.collection(DB_USERS);

  const token = (event.token || '').trim();
  if (!token) {
    return fail(3001, '没有本地登录信息');
  }

  // ---- 按 token 找人 ----
  const res = await users.where({ token }).limit(1).get();
  const user = res.data && res.data[0];
  if (!user) {
    return fail(3001, '登录已过期，请重新登录');
  }

  // ---- 到期检查 ----
  const now = Date.now();
  if (user.tokenExpire && now > user.tokenExpire) {
    // 顺手清掉过期 token，避免下次又白查一次
    await users.doc(user._id).update({ token: '', tokenExpire: 0 });
    return fail(3001, '登录已过期，请重新登录');
  }

  // ---- 封禁检查：被封的账号不该因为 token 还没过期就进得来 ----
  if (user.status === 0) {
    return fail(2003, '账号已被封禁，如有疑问请联系管理员');
  }

  // ---- 续期：每次启动都往后延 7 天，活跃用户就不会被踢 ----
  const tokenExpire = now + 7 * 24 * 3600 * 1000;
  await users.doc(user._id).update({
    tokenExpire,
    lastLoginTime: now,
    updateTime: now
  });

  return ok({
    token,
    user: {
      _id: user._id,
      phone: user.phone,
      nickname: user.nickname,
      avatar: user.avatar,
      school: user.school,
      schoolVerified: user.schoolVerified,
      credit: user.credit,
      titles: user.titles || [],
      tags: user.tags || [],
      createTime: user.createTime
    }
  });
};
