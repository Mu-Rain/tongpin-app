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

const crypto = require('crypto');

const DB_USERS = 'uni-id-users';

/**
 * ================= UID（对外唯一身份号）=================
 * 8 位纯数字，首位非 0，约 9000 万个。规则与 user-register 一致。
 * 启动时的自动登录是绝大多数用户唯一的"进门"路径，
 * 所以老账号补号放在这里，比要求用户重新登录一次现实得多。
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
 * 与 user-register 的 PRESET_AVATARS 一致（云函数目录自包含）。
 * 冷启动是绝大多数用户唯一的"进门"路径，老账号补头像放这里最省事。
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
 * 只有 avatar / avatar_url 都为空才补；已有头像（上传的 fileID、历史直链、
 * 上次发的自带头像）一律不动。
 */
async function ensurePresetAvatar(users, user, now) {
  if (String(user.avatar || '') || String(user.avatar_url || '')) return String(user.avatar_url || '');
  const preset = pickPresetAvatar();
  try {
    await users.doc(user._id).update({ avatar_url: preset, updateTime: now });
    return preset;
  } catch (e) {
    console.warn('[user-auto-login] 补自带头像失败', e && e.message);
    return '';
  }
}

/**
 * 老账号补 uid：已有就原样返回（UID 永不改），撞号换一个重试。
 * 补不上返回 ''，绝不阻断登录。
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
        console.warn('[user-auto-login] 补 uid 失败，本次留空', e && e.message);
        return '';
      }
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
  // ★ 两种历史口径都认：数字 0 是早期数据，'banned' 是 M4 后台写的（见 user-login:74）
  if (user.status === 0 || user.status === 'banned') {
    return fail(2003, '账号已被封禁，如有疑问请联系管理员');
  }

  // ---- 续期：每次启动都往后延 7 天，活跃用户就不会被踢 ----
  const tokenExpire = now + 7 * 24 * 3600 * 1000;
  await users.doc(user._id).update({
    tokenExpire,
    lastLoginTime: now,
    updateTime: now
  });

  // ---- 老账号补 UID ----
  const uid = await ensureUid(users, user, now);

  // ---- 老账号补自带头像 ----
  const presetAvatar = await ensurePresetAvatar(users, user, now);

  return ok({
    token,
    user: {
      _id: user._id,
      uid,
      phone: user.phone,
      nickname: user.nickname,
      avatar: user.avatar,
      // ★ 之前这里漏了 avatar_url：冷启动后 storage 里的 userInfo 就丢了头像，
      //   要等 mine.vue 再调一次 user-me 才补回来。自带头像更是完全显示不出来。
      avatar_url: presetAvatar || user.avatar_url || '',
      school: user.school,
      schoolVerified: user.schoolVerified,
      credit: user.credit,
      titles: user.titles || [],
      tags: user.tags || [],
      createTime: user.createTime
    }
  });
};
