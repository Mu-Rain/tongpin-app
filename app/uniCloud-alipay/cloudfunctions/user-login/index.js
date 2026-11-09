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

/**
 * ================= UID（对外唯一身份号）=================
 * 8 位纯数字，首位非 0：10000000 ~ 99999999，约 9000 万个。
 * 规则与 user-register 完全一致（云函数目录自包含，只能各存一份）。
 * 这里的存在意义是**给老账号补号**：上线前注册的用户没有 uid，
 * 登录时顺手补一个并写回库，免得他们永远搜不到 / 永远没有身份号。
 */
const UID_MIN = 10000000;
const UID_SPAN = 90000000;

function genUid() {
  return String(UID_MIN + (crypto.randomBytes(4).readUInt32BE(0) % UID_SPAN));
}

function isDupErr(e) {
  return String((e && e.message) || '').toLowerCase().indexOf('duplicate') > -1;
}

/**
 * ================= 自带头像 =================
 * 与 user-register 的 PRESET_AVATARS 完全一致（云函数目录自包含，只能各存一份）。
 * 这里的存在意义是给**老账号**补头像：上线前注册的用户 avatar_url 是空串，
 * 不补的话他们永远顶着灰色默认头像，新功能等于只对新用户生效。
 */
const PRESET_AVATARS = [
  '/static/avatars/av-study.png',
  '/static/avatars/av-fitness.png',
  '/static/avatars/av-photo.png',
  '/static/avatars/av-meal.png',
  '/static/avatars/av-sport.png',
  '/static/avatars/av-competition.png',
  '/static/avatars/av-other.png'
];

function pickPresetAvatar() {
  return PRESET_AVATARS[crypto.randomBytes(1)[0] % PRESET_AVATARS.length];
}

/**
 * 补自带头像：只有 avatar 和 avatar_url 都为空时才补。
 * ★ 已经有头像的一律不动 —— 用户自己上传的 fileID、历史 http 直链、
 *   或者上一次随机发的自带头像，都不该被登录流程覆盖。
 */
async function ensurePresetAvatar(users, user, now) {
  if (String(user.avatar || '') || String(user.avatar_url || '')) return String(user.avatar_url || '');
  const preset = pickPresetAvatar();
  try {
    await users.doc(user._id).update({ avatar_url: preset, updateTime: now });
    return preset;
  } catch (e) {
    console.warn('[user-login] 补自带头像失败，本次留空', e && e.message);
    return '';
  }
}

/**
 * 老账号补 uid。已经有的原样返回，不改（UID 一旦生成永不变化）。
 * 撞唯一索引就换一个重试，最多 6 次；全撞光就返回 ''，
 * 绝不能因为一个展示号让用户登不进来。
 */
async function ensureUid(users, user, now) {
  const cur = String((user && user.uid) || '');
  if (/^\d{8}$/.test(cur)) return cur;
  for (let i = 0; i < 6; i++) {
    const cand = genUid();
    try {
      await users.doc(user._id).update({ uid: cand, updateTime: now });
      return cand;
    } catch (e) {
      if (!isDupErr(e)) {
        console.warn('[user-login] 补 uid 失败，本次留空', e && e.message);
        return '';
      }
      // 撞号了，换一个继续
    }
  }
  return '';
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

/**
 * 头像换链：库里存的是 fileID（cloud://），前端 <image> 只认 http。
 * 为什么放服务端：客户端那段换链不保证成功，一失败页面就退化成昵称首字，
 * 而别处看到的是真实头像 —— 同一份数据两条链路结出两种结果，最难查。
 * 整段 try/catch：换链失败只是少张图，绝不能把整个接口打成 500。
 */
async function toTempUrl(fileId) {
  const id = typeof fileId === 'string' ? fileId : '';
  if (!id) return '';
  // 已经是 http 直链（历史数据）就直接当结果，不再多一次请求
  if (id.indexOf('cloud://') !== 0) return id;
  try {
    const res = await uniCloud.getTempFileURL({ fileList: [id] });
    const it = (res && res.fileList && res.fileList[0]) || {};
    return it.tempFileURL || '';
  } catch (e) {
    console.warn('[user-login] 头像换链失败，avatar_url 留空', e && e.message);
    return '';
  }
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
  // ★ 两种历史口径都要认：早期数据用数字 0，M4 后台封禁写的是字符串 'banned'。
  //   只认一种的话，管理员在后台封了人，那账号照样能登录 —— 封禁等于没生效。
  if (user.status === 0 || user.status === 'banned') {
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

  // ---- 老账号补 UID（上线前注册的用户没有这个字段）----
  // 放在 token 更新之后：补号失败也不能影响登录。
  const uid = await ensureUid(users, user, now);

  // ---- 老账号补自带头像 ----
  const presetAvatar = await ensurePresetAvatar(users, user, now);

  return ok({
    token,
    user: {
      _id: user._id,
      // 对外唯一身份号：老账号这次登录时刚补上，直接回给前端
      uid,
      phone: user.phone,
      nickname: user.nickname,
      // avatar 保持库里的原值：前端靠它区分「有 fileID」和「真没头像」
      avatar: user.avatar,
      // avatar_url 是能直接当 src 的链接；换不出来留空串，前端自会退回首字
      avatar_url: await toTempUrl(presetAvatar || user.avatar || user.avatar_url || ''),
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
