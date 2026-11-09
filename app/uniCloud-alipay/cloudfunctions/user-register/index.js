'use strict';

/**
 * user-register —— 注册（第 1 天）
 *
 * 入参：{ phone, password, nickname? }
 *   ★ 不再收 school：学校统一在学生认证里填，注册时不碰
 *   ★ 昵称**不做唯一约束**，允许重名：
 *     重名在社交产品里是常态，强行唯一会逼用户在「林小满」后面加一串数字，
 *     反而更难认。
 *   ★ 对外唯一身份号是 uid（8 位数字，idx_uid 唯一索引），
 *     手机号退成「登录凭据」，只在登录/找回时用，不再是对外的搜索索引。
 *   ★ 昵称留空 → 服务端兜底成「同学 + 4 位随机数」（如 同学3721）。
 *     刻意**不用手机号后 4 位**：那等于把手机尾号印在昵称上给所有人看，
 *     而且尾号相同的两个人默认昵称必然一样。昵称允许重名，随机后缀不承载任何隐私。
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

/**
 * ================= UID（对外唯一身份号）=================
 * 8 位纯数字，首位非 0：10000000 ~ 99999999，约 9000 万个。
 *
 * 为什么纯数字：加好友要念、要手输，数字键盘最快，
 *   也不会出现 0/O、1/l 这种看着一样打出来不一样的歧义。
 * 为什么 8 位：6 位只有 90 万个，用户到几万就开始频繁撞号；8 位够撑很久。
 * 为什么不自增：自增号能被顺序枚举，等于把全站用户爬一遍；随机号不行。
 * 随机只是「极大概率不撞」，真正的裁决者是库上的 idx_uid 唯一索引 ——
 *   撞了就在写入时换一个重试（见 main 里的 add 循环），最多 5 次。
 * ★ UID 一旦生成就不再变：它是唯一能被别人拿来搜你的东西，改了等于换个人。
 */
const UID_MIN = 10000000;
const UID_SPAN = 90000000;

function genUid() {
  // 用 crypto 而不是 Math.random：后者在同一毫秒的并发请求里更容易给出相同序列
  return String(UID_MIN + (crypto.randomBytes(4).readUInt32BE(0) % UID_SPAN));
}

/** 唯一索引冲突。不同驱动的报错文案不同，统一按 duplicate 关键字判 */
function isDupErr(e) {
  return String((e && e.message) || '').toLowerCase().indexOf('duplicate') > -1;
}

/**
 * 默认昵称的后缀：4 位随机数（1000~9999）。
 * 为什么不用手机号后 4 位：昵称是公开的，尾号一旦印在上面，
 * 相当于把手机号的一部分发给所有看过你资料的人；而且同尾号的两个人默认昵称必然重名。
 * 随机后缀不承载任何隐私，重名了也无所谓（昵称本来就不唯一）。
 */
function genNickSuffix() {
  return String(1000 + (crypto.randomBytes(2).readUInt16BE(0) % 9000));
}

/**
 * 自带头像（7 张，按搭子类型分）。
 *
 * ★ 存本地静态路径而不是云存储 fileID：
 *   ① 注册时不用先上传一次，少一个失败点（上传失败会退化成默认头像）；
 *   ② 不消耗云存储和流量，离线也能显示；
 *   ③ 这些图是包内资源，路径永远有效，不存在临时链接过期。
 * ★ 顺序必须和 app/static/avatars/ 下的文件一一对应，改名要两边一起改。
 * ★ 随机发一个：新用户不该顶着一个灰色默认头像进首页，
 *   有个具体形象才像「一个人」，也更容易被搭子记住。
 */
const PRESET_AVATARS = [
  '/static/avatars/av-study.png', // 学习
  '/static/avatars/av-fitness.png', // 健身
  '/static/avatars/av-photo.png', // 拍照
  '/static/avatars/av-meal.png', // 吃饭
  '/static/avatars/av-sport.png', // 运动
  '/static/avatars/av-competition.png', // 竞赛
  '/static/avatars/av-other.png' // 其他
];

function pickPresetAvatar() {
  return PRESET_AVATARS[crypto.randomBytes(1)[0] % PRESET_AVATARS.length];
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
    console.warn('[user-register] 头像换链失败，avatar_url 留空', e && e.message);
    return '';
  }
}

exports.main = async (event, context) => {
  const db = uniCloud.database();
  const users = db.collection(DB_USERS);

  const phone = (event.phone || '').trim();
  const password = event.password || '';
  const nickname = (event.nickname || '').trim();

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
  // 昵称：前端 maxlength=12，这里再挡一道（绕过前端直接调接口时生效）。
  // ★ 只校验长度，**不校验重复** —— 昵称允许重名，对外唯一身份号是 uid。
  //   按字符数算，不用 length：emoji 在 UTF-16 里占 2，用 length 会把 6 个 emoji 判成超长。
  if (Array.from(nickname).length > 12) {
    return fail(1006, '昵称最多 12 个字');
  }

  // ---- 查重 ----
  const existed = await users.where({ phone }).limit(1).get();
  if (existed.data && existed.data.length > 0) {
    return fail(1004, '该手机号已注册，请直接登录');
  }

  // ---- 组装并写库：uid 撞号就换一个重试 ----
  // 为什么不先查一遍 uid 再写：查完再写仍然有并发窗口，唯一索引才是真正的裁决者。
  // 直接写、撞了再换，比「先查后写」更可靠，也少一次往返。
  const now = Date.now();
  const token = makeToken();
  const passwordHash = hashPassword(password);
  // 没填昵称就给个默认的「同学 + 4 位随机数」。
  // ★ 不用手机号后 4 位：昵称是公开字段，尾号印在上面等于泄露手机号的一部分。
  // ★ 不做重名检查：昵称允许重名，对外唯一身份号是 uid。
  const nick = nickname || `同学${genNickSuffix()}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const record = {
      // 对外唯一身份号：搜人、加好友、报给别人的都是它
      uid: genUid(),

      phone,
      password: passwordHash,
      nickname: nick,
      // avatar 留空：它表示「用户自己上传的 fileID」，注册时还没有
      avatar: '',
      // 自带头像走 avatar_url：包内静态路径，前端直接当 src 用
      avatar_url: pickPresetAvatar(),

      // 学校不在注册时填 —— 统一由「学生认证」写入，这里只留认证状态位
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

    try {
      const res = await users.add(record);
      const userId = res.id;

      // 返回给前端时把密码和 token 之外的敏感字段去掉
      return ok({
        token,
        user: {
          _id: userId,
          uid: record.uid,
          phone,
          nickname: record.nickname,
          // avatar 保持原值（注册时是空串），前端靠它判断「有没有 fileID」
          avatar: record.avatar,
          // 换不出来给空串，不给 null：前端直接当 src 用
          avatar_url: await toTempUrl(record.avatar || record.avatar_url || ''),
          school: record.school,
          schoolVerified: record.schoolVerified,
          credit: record.credit,
          titles: record.titles,
          tags: record.tags,
          createTime: record.createTime
        }
      });
    } catch (e) {
      if (!isDupErr(e)) {
        return fail(1005, '注册失败：' + (e.message || '未知错误'));
      }
      // 撞了唯一索引，但撞的是哪一条？再查一次手机号：
      //   命中 → 并发注册了同一个号（两个人同时点注册）
      //   没命中 → 就是 uid 撞了，下一轮换一个号重试
      const again = await users.where({ phone }).limit(1).get();
      if (again.data && again.data.length) {
        return fail(1004, '该手机号已注册，请直接登录');
      }
    }
  }

  return fail(1007, 'UID 生成冲突，请重试');
};

// 导出给测试用（云函数运行时用不到）
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
