'use strict';

/**
 * hello —— 第一个云函数
 *
 * 作用：只用来验证「App 能不能调到云函数」。不接数据库、不接 AI。
 *
 * 怎么测：在 HBuilderX 里右键这个云函数 → 「上传部署」，
 * 然后在前端调 uniCloud.callFunction({ name: 'hello' }) 看能不能拿到返回值。
 *
 * 约定：本项目所有云函数都返回同一个形状，前端好统一处理。
 *   { code: 0, msg: 'ok', data: ... }   成功
 *   { code: 非0, msg: '原因' }            失败
 */
exports.main = async (event, context) => {
  // event 是前端传进来的参数（这里没用到，先留个样子）
  return {
    code: 0,
    msg: 'ok',
    data: {
      text: 'hello from uniCloud',
      // 服务端时间：以后写库的时间都用它，别信手机本地时间
      serverTime: Date.now(),
      // 云函数所在环境，方便确认到底连的是哪个服务空间
      spaceId: context.SPACEINFO && context.SPACEINFO.spaceId,
      provider: context.SPACEINFO && context.SPACEINFO.provider
    }
  };
};
