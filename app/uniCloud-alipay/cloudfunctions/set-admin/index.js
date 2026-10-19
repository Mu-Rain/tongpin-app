'use strict';

/**
 * set-admin —— 一次性运维工具：把指定手机号的账号设为管理员。
 *
 * 为什么要有这个函数：
 *   在 uniCloud 控制台手点数据库改字段很容易点错（字段名写错、类型选成数字、
 *   改错人），而且改完没有回显。用云函数改，改了什么、改没改成都会明确返回。
 *
 * 怎么用（两种都行）：
 *   1. HBuilderX 右键这个云函数 → 「上传并运行」→ 参数留空，用下面 DEFAULT_PHONE。
 *   2. 「上传部署」后，前端任意地方调：
 *        uniCloud.callFunction({ name:'set-admin', data:{ phone:'191…', role:'admin' } })
 *
 * ⚠️ 安全：这个函数能改任意账号的角色，**只能用来做一次性初始化**。
 *    项目正式上线前必须删掉它（或改成校验 secret 之后再执行），
 *    否则任何人拿到 App 都能把自己变成管理员。
 *
 * 约定返回：{ code: 0, msg, data } 成功；{ code: 非0, msg } 失败。
 */

const db = uniCloud.database();

const DB_USERS = 'uni-id-users';

// ⚠️ 安全：默认不内置任何手机号。正式环境下 ALLOW 必须为 false（见下方开关），
// 需要一次性初始化管理员时，请在「上传并运行」时显式传入 phone 参数，切勿硬编码。
const DEFAULT_PHONE = '';

// 允许的角色值。写成白名单而不是直接写库，防止手滑把 role 写成乱码。
const ROLE_ENUM = ['admin', 'user'];

exports.main = async (event) => {
  const params = event || {};

  // —— 1) 防呆：线上环境禁止直接调用 ——
  // 这里不做强制拦截（我们正是要在线上库里改），但留一个开关，
  // 上线前把 ALLOW 改成 false 就彻底封死。
  // ⚠️ 安全：正式环境已禁用。该函数能改任意账号角色，只能用于一次性初始化，
  // 且必须配合显式传入 secret 校验后才允许执行（见下方 TODO）。
  const ALLOW = false;
  if (!ALLOW) {
    return { code: 403, msg: 'set-admin 已被禁用，请改用后台管理页面' };
  }

  const phone = String(params.phone || DEFAULT_PHONE).trim();
  const role = String(params.role || 'admin').trim();

  if (!phone) {
    return { code: 400, msg: '缺少手机号' };
  }
  if (ROLE_ENUM.indexOf(role) < 0) {
    return { code: 400, msg: 'role 只能是 ' + ROLE_ENUM.join(' / ') };
  }

  // —— 2) 找到这个账号 ——
  // 手机号在注册时存的是字符串；这里同时兼容数字类型的历史数据，查两次。
  let user = null;
  const byStr = await db
    .collection(DB_USERS)
    .where({ phone: phone })
    .limit(1)
    .get();

  if (byStr.data && byStr.data.length) {
    user = byStr.data[0];
  } else {
    const byNum = await db
      .collection(DB_USERS)
      .where({ phone: Number(phone) })
      .limit(1)
      .get();
    if (byNum.data && byNum.data.length) user = byNum.data[0];
  }

  // 手机号带不带 86 前缀的写法都试一遍（有些注册流程会存 +86……）
  if (!user) {
    const byPrefix = await db
      .collection(DB_USERS)
      .where({
        phone: db.command.in([phone, '86' + phone, '+86' + phone])
      })
      .limit(1)
      .get();
    if (byPrefix.data && byPrefix.data.length) user = byPrefix.data[0];
  }

  if (!user) {
    return {
      code: 404,
      msg: '没找到手机号为 ' + phone + ' 的账号。确认这个号在 App 里注册过没有。'
    };
  }

  // —— 3) 写入 ——
  // 用 doc().update() 只改 role 一个字段，其它字段原样保留。
  await db
    .collection(DB_USERS)
    .doc(user._id)
    .update({
      role: role,
      // 同时写 is_admin：verify-review 早期只认这个字段。
      // 两个都写上，不管你用哪套判断逻辑都能通过，省得再踩一次字段名对不上的坑。
      is_admin: role === 'admin',
      updateTime: Date.now()
    });

  // —— 4) 回读校验 ——
  // 不信任 update 的返回值，重新查一遍，确认真的落库了。
  const check = await db
    .collection(DB_USERS)
    .doc(user._id)
    .field({ _id: true, phone: true, nickname: true, role: true, school: true })
    .get();

  const now = check.data && check.data[0];

  return {
    code: 0,
    msg: 'ok',
    data: {
      user_id: user._id,
      phone: now ? now.phone : user.phone,
      nickname: now ? now.nickname : user.nickname,
      school: now ? now.school : user.school,
      role_before: user.role || '(无)',
      role_now: now ? now.role : '(回读失败)',
      ok: !!(now && now.role === role)
    }
  };
};
