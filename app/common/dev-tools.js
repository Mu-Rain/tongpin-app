/* 调试块开关（首页「云函数连通性自检」、我的页「权限自检」）

   目的：开发看得到，打包后的发行包一定看不到。

   判断依据是 plus.runtime.appid：
     · HBuilderX 标准基座「真机运行」  → 'HBuilder'
     · 云打包 / 自定义基座出来的正式包 → manifest.json 里的 __UNI__20CB151
   所以打包后这个函数返回 false，调试块整块不渲染，不需要手工改任何代码。
   再加一层构建期判断兜底：发行包编译时 process.env.NODE_ENV 是 'production'。 */

export function isDebugRuntime() {
  try {
    if (typeof plus === 'undefined' || !plus.runtime) return false
    return plus.runtime.appid === 'HBuilder'
  } catch (e) {
    return false
  }
}

export function devToolsOn() {
  if (process.env.NODE_ENV === 'production') return false
  return isDebugRuntime()
}

export default devToolsOn
