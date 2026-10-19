'use strict';

/**
 * user-login —— 登录（第 1 天）
 *
 * 入参：{ phone, password }
 * 出参：{ code, msg, data: { token, user } }
 *
 * 跟 user-register 共用同一套哈希规则，所以两边的 salt:hash 能对得上。
 * 这里刻意把「用户不存在」和「密码错误」分开返回，
 * 方便开发期排查；真上线要合并成「手机号或密码错误」防撞库枚举。
 */

const crypto = require('crypto');

const DB_USERS = 'uni-id-users';

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, 32).toString('hex');
  return `${useSalt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || stored.indexOf(':') === -1) return false;
  const salt = stored.split(':')[0];
  const expect = hashPassword(password, salt);
  if (expect.length !== stored.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(stored));
}

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function ok(data) {
  return { code: 0, msg: 'ok', data };
}
function fail(code, msg) {
  return { code, msg };
}

function isValidPhone(phone) {
  return typeof phone === 'string' && /^1[3-9]\d{9}$/.test(phone);
}

exports.main = async (event, context) => {
  const db = uniCloud.database();
  const users = db.collection(DB_USERS);

  const phone = (event.phone || '').trim();
  const password = event.password || '';

  if (!isValidPhone(phone)) {
    return fail(1001, '手机号格式不正确');
  }
  if (!password) {
    return fail(1002, '请输入密码');
  }

  // ---- 查用户 ----
  const res = await users.where({ phone }).limit(1).get();
  const user = res.data && res.data[0];
  if (!user) {
    return fail(2001, '该手机号未注册');
  }

  // ---- 验密码 ----
  if (!verifyPassword(password, user.password)) {
    return fail(2002, '密码错误');
  }

  // ---- 查封禁 ----
  if (user.status === 0) {
    return fail(2003, '账号已被封禁，如有疑问请联系管理员');
  }

  // ---- 换新 token（真上线应该保留旧 token 一段时间，避免多设备互踢）----
  const now = Date.now();
  const token = makeToken();
  await users.doc(user._id).update({
    token,
    tokenExpire: now + 7 * 24 * 3600 * 1000,
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
      // ★ 角色字段必须回传：前端靠它决定显不显示管理员入口。
      //   之前漏了这两个字段，导致库里改完角色 App 永远看不见（踩过的坑）。
      role: user.role || '',
      is_admin: user.is_admin === true,
      credit: user.credit,
      titles: user.titles || [],
      tags: user.tags || [],
      createTime: user.createTime
    }
  });
};
