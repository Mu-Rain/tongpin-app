'use strict'

/**
 * 记录一次浏览（观看历史）
 *
 * 入参：{ token, target_type: 'card' | 'post', target_id }
 *
 * 出参：{ code: 0, msg: 'ok', data: { recorded: boolean } }
 *   recorded: true  真的写进去了
 *   recorded: false 没写 —— 没带 token（未登录），或者 target_type / target_id 不合法
 *
 * ★ 为什么没 token 时返回 code:0 而不是 401：
 *   这个接口是页面 onLoad 顺手调的埋点。游客点开一条需求，浏览本身是合法的，
 *   历史记不下来只是"没这功能"，不该让前端弹一个登录失效的错。
 *   埋点类接口永远不该成为报错来源 —— 报错要留给用户真正想做的操作。
 *
 * ★ 为什么写之前先删同一 (owner_id, target_type, target_id) 的旧行：
 *   这张表没有唯一索引（本项目唯一索引在当前环境普遍未生效，见 post-like 注释），
 *   靠 upsert 兜不住。先删后写等于用"每次一条新行"换"一个人对一条内容只有一行"，
 *   表不会随反复打开详情页无限膨胀；代价是丢掉了"看过几次"这个信息 —— 现在不需要。
 *   删除整段 try/catch：集合还不存在时 remove 会抛错，但那正是"没有旧行"。
 *
 * ★ 集合不存在时 add 会自动建表，不写建表逻辑：
 *   多一段"先判断集合在不在"的探测，既慢又会在并发下出错。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_BROWSE = 'browse_history'
const TARGET_TYPES = ['card', 'post']

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

exports.main = async (event) => {
  try {
    const token = str(event.token)
    const targetType = str(event.target_type)
    const targetId = str(event.target_id)

    // 未登录：静默不记录，不报错
    if (!token) return { code: 0, msg: 'ok', data: { recorded: false } }

    // target_type 是白名单，不认识的类型直接 400：
    // 放过去会在表里堆一堆永远读不出来的行，还会让 browse-list 的两批回查白跑
    if (TARGET_TYPES.indexOf(targetType) < 0) fail('target_type 只能是 card 或 post', 400)
    if (!targetId) fail('缺少 target_id', 400)

    const uRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
    if (!uRes.data.length) {
      // token 失效也只当"没登录"，不打断用户的浏览
      return { code: 0, msg: 'ok', data: { recorded: false } }
    }
    const me = uRes.data[0]

    // 先清旧行，保证一个人对同一条内容只有一行
    try {
      await db
        .collection(DB_BROWSE)
        .where({ owner_id: me._id, target_type: targetType, target_id: targetId })
        .remove()
    } catch (e) {
      /* 集合还没建 = 本来就没有旧行，结果一样 */
    }

    await db.collection(DB_BROWSE).add({
      owner_id: me._id,
      target_type: targetType,
      target_id: targetId,
      created_at: Date.now()
    })

    return { code: 0, msg: 'ok', data: { recorded: true } }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '服务端错误', data: null }
  }
}
