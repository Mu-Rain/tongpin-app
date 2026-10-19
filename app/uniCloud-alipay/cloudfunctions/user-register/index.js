'use strict';

/**
 * user-register —— 注册（第 1 天）
 *
 * 入参：{ phone, password, nickname?, school? }
 * 出参：{ code, msg, data: { token, user } }
 *
 * 密码绝不明文存库：用 node 自带 crypto 做 scrypt 加盐哈希。
 * 不用 bcrypt 是因为云函数要额外装依赖，scrypt 是 node 内置的，够用。
 *
 * 表：uni-id-users 是我们自己起的名字，见 docs/03-database.md。
 * 注意：这里用的是 uniCloud 的 JQL / 原生 db，不是 uni-id 官方插件。
 */

const crypto = require('crypto');

const DB_USERS = 'uni-id-users';

// 生成盐 + scrypt 哈希，返回 "salt:hash" 这种可存库的字符串
function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, useSalt, 32).toString('hex');
  return `${useSalt}:${hash}`;
}

// 校验：用同样的盐算一遍，跟存的比
function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || stored.indexOf(':') === -1) return false;
  const salt = stored.split(':')[0];
  const expect = hashPassword(password, salt);
  // 长度不等直接 false，等长用 timingSafeEqual 防时序攻击
  if (expect.length !== stored.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(stored));
}

// 简单 token：随机 32 字节。真上线要换成 JWT 并设过期，第 3 天再换。
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 统一返回
function ok(data) {
  return { code: 0, msg: 'ok', data };
}
function fail(code, msg) {
  return { code, msg };
}

// 校验手机号：只做中国大陆 11 位
function isValidPhone(phone) {
  return typeof phone === 'string' && /^1[3-9]\d{9}$/.test(phone);
}

exports.main = async (event, context) => {
  const db = uniCloud.database();
  const users = db.collection(DB_USERS);

  const phone = (event.phone || '').trim();
  const password = event.password || '';
  const nickname = (event.nickname || '').trim();
  const school = (event.school || '').trim();

  // ---- 入参校验 ----
  if (!isValidPhone(phone)) {
    return fail(1001, '手机号格式不正确');
  }
  if (password.length < 6) {
    return fail(1002, '密码至少 6 位');
  }
  if (password.length > 32) {
    return fail(1003, '密码最多 32 位');
  }

  // ---- 查重 ----
  const existed = await users.where({ phone }).limit(1).get();
  if (existed.data && existed.data.length > 0) {
    return fail(1004, '该手机号已注册，请直接登录');
  }

  // ---- 组装用户记录 ----
  const now = Date.now();
  const token = makeToken();
  const record = {
    phone,
    password: hashPassword(password),
    nickname: nickname || `同学${phone.slice(-4)}`, // 没填昵称就给个默认的
    avatar: '',

    // 学校信息：注册时选，用于进同校频道（不做真伪校验，认证另算）
    school,
    schoolVerified: false, // 是否已通过学生认证

    // 信誉系统（需求里的第 8 条）：从 100 分起，违规扣分
    credit: 100,

    // 称号：从称号库里领取，不是默认送。空数组表示还没有
    titles: [],

    // 标签：8-10 个，用于算重合度。注册时为空，引导页填
    tags: [],

    // 账号状态
    status: 1, // 1 正常 / 0 封禁
    role: 'user', // user / admin

    // 登录态
    token,
    tokenExpire: now + 7 * 24 * 3600 * 1000, // 7 天

    createTime: now,
    updateTime: now,
    lastLoginTime: now
  };

  // ---- 写库 ----
  try {
    const res = await users.add(record);
    const userId = res.id;

    // 返回给前端时把密码和 token 之外的敏感字段去掉
    return ok({
      token,
      user: {
        _id: userId,
        phone,
        nickname: record.nickname,
        avatar: record.avatar,
        school: record.school,
        schoolVerified: record.schoolVerified,
        credit: record.credit,
        titles: record.titles,
        tags: record.tags,
        createTime: record.createTime
      }
    });
  } catch (e) {
    // 唯一索引冲突也算「已注册」（并发注册时兜底）
    if (String(e.message || '').indexOf('duplicate') > -1) {
      return fail(1004, '该手机号已注册，请直接登录');
    }
    return fail(1005, '注册失败：' + (e.message || '未知错误'));
  }
};

// 导出给测试用（云函数运行时用不到）
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
