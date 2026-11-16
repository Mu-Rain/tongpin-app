/**
 * 智能助手的调用封装
 *
 * 为什么非要有这一层：智能助手有 7 个 action，页面里各写一遍 callFunction
 * 会把「token 从哪拿」「code!==0 怎么报」「超时怎么提示」重复七次，
 * 而且一旦改函数名就要全项目搜。这里收成一处。
 *
 * 约定：云函数一定回 { code, msg, data }。code !== 0 一律当异常抛，
 * 页面只用写 try/catch；错误对象上带 code，页面可以按 501/429 走不同引导。
 */

const FN = 'ai-assistant'

export function aiToken() {
  return uni.getStorageSync('token') || ''
}

/**
 * @param {string} action status | config-get | config-save | config-clear | config-test | card | match
 * @param {object} payload 除 action / token 之外的入参
 * @returns {Promise<object>} 云函数的 data
 */
export async function callAi(action, payload) {
  const data = Object.assign({ action: action, token: aiToken() }, payload || {})
  const res = await uniCloud.callFunction({ name: FN, data: data })
  const r = (res && res.result) || {}
  if (r.code !== 0) {
    const err = new Error(r.msg || '智能助手出错了')
    err.code = r.code
    throw err
  }
  return r.data || {}
}

/** 按错误码给一句能照着做的提示，而不是把云函数的原话丢给用户 */
export function aiErrorText(e) {
  const code = e && e.code
  const msg = (e && e.message) || ''
  if (code === 401) return '先登录再用智能助手'
  if (code === 501) return msg || '还没有可用的模型，去设置里填一个'
  if (code === 429) return msg || '今天的次数用完了'
  if (code === 400) return msg || '还差一点信息'
  if (code === 502) return msg || '模型这次没按格式回答，再点一次'
  if (msg.indexOf('timeout') > -1 || msg.indexOf('超时') > -1) return '模型响应有点慢，再试一次'
  if (msg.indexOf('cloud function') > -1 || msg.indexOf('not found') > -1) {
    return '云函数 ai-assistant 还没上传，先传一次'
  }
  return msg || '智能助手出错了'
}