'use strict'

/**
 * 首页数字卡聚合
 *
 * 入参：{ token }   token 可选（没登录三个数都算不出来）
 *
 * 出参：{ matched_total, people_total, my_open_cards, my_buddy_count, my_avatar_url }
 *
 * matched_total = 与我标签有重合的人数；people_total = 候选人里有多少个不同的人
 * （两者都在 card-list 按 owner_id 去重，这里只透传，不重新定义口径）。
 *
 * 前四个字段是 number 或 null，**算不出来一律给 null，绝不给 0**；
 * my_avatar_url 是 string（换不出来给 '' 而不是 null —— 前端直接当 src 用）：
 *   0   = 真的是零（确实没发过需求 / 确实没有搭子）
 *   null = 不知道（未登录、查询失败、算不出来）
 * 前端对这两者显示不同文案（null 不显示，0 显示 0），拿 0 凑数会让用户以为数据是真的。
 *
 * 为什么要合成一个接口：这三个数在首屏同一张卡上同时出现，拆成三个请求会多两次
 * 冷启动往返，还会出现「同频 8、我的需求加载中」的割裂状态。
 *
 * matched_total / people_total 的口径只有一处 —— card-list 的 countMatchedCards；
 * my_buddy_count 的口径也只有一处 —— buddy-list（count_only: true）。
 * 这里**不重写任何统计逻辑**：同一语义两处实现迟早对不上（docs/23 §2.3）。
 * 代价是首页会扫两遍候选（前端那次 + 这次），数据量小时无所谓；
 * 若将来嫌慢，正确做法是把统计抽成公共模块给两边共用，而不是在这里另写一遍。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_CARDS = 'cards'

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/** 只要结果是 number 就用它，其余（undefined / NaN / 字符串 / 抛错）一律 null */
async function numOrNull(promise) {
  try {
    const r = await promise
    if (!r) return null
    const n = r.total
    return typeof n === 'number' && isFinite(n) ? n : null
  } catch (e) {
    return null
  }
}

/** card-list 给的两个口径原样取值：不是 number 就当「不知道」，不拿 0 兜底 */
function pickMatchStats(d) {
  if (!d) return { matched: null, people: null }
  return {
    matched: typeof d.matched_total === 'number' ? d.matched_total : null,
    people: typeof d.people_total === 'number' ? d.people_total : null
  }
}

/**
 * 同频人数 + 候选人数：都问 card-list 要，不自己算。
 * card-list 未认证/没标签时会给 null（那是它的正确口径），这里原样透传。
 */
async function fetchMatchStats(token) {
  const unknown = { matched: null, people: null }
  try {
    const r = await uniCloud.callFunction({
      name: 'card-list',
      data: { token, type: 'all', scope: 'school', page_size: 1 }
    })
    const d = (r && r.result && r.result.data) || null
    if (!d) return unknown
    // 未认证的学生看不到同校频道（reason === 'no_school'），退回全站口径再问一次，
    // 否则这类账号的「与我同频」会永远空着 —— 首页卡片本身就做了同样的降级
    if (d.reason === 'no_school') {
      const r2 = await uniCloud.callFunction({
        name: 'card-list',
        data: { token, type: 'all', scope: 'all', page_size: 1 }
      })
      const d2 = (r2 && r2.result && r2.result.data) || null
      return pickMatchStats(d2)
    }
    return pickMatchStats(d)
  } catch (e) {
    return unknown
  }
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
    console.warn('[home-summary] 头像换链失败，avatar_url 留空', e && e.message);
    return '';
  }
}

/**
 * 我已有的搭子数 —— **直接问 buddy-list 要 total**，不在这里自己数。
 *
 * 为什么不再自己 .count() / 自己按人去重：
 *   1. 「我的搭子」的口径不止"按对方 id 去重"一条 —— buddy-list 还会剔除
 *      **已经是好友的人**（好友比搭子更强，成为好友后搭子要收起来，见
 *      docs/03-database.md §2.3）。本函数以前只做了去重，没做这个剔除，
 *      于是用户「一个搭子 + 一个好友」时首页显示 2、我的页显示 1（m03027）。
 *   2. buddy_relations 历史上还有过同一对关系的重复行，数行数会给出
 *      「只有一个搭子却显示 6」这种更离谱的数。
 *   一份口径只能有一处实现（docs/23 §2.3）。buddy-list 已经算好了，这里只透传
 *   它的 total，代价是多一次云函数调用 —— 换取"首页与我的页永远一致"。
 */
async function countMyBuddies(token) {
  try {
    const res = await uniCloud.callFunction({
      name: 'buddy-list',
      data: { token: token, count_only: true }
    })
    const r = (res && res.result) || {}
    if (r.code !== 0 || !r.data) return null
    return typeof r.data.total === 'number' ? r.data.total : null
  } catch (e) {
    // 查不出来是「不知道」而不是「没有」：给 null 让前端不显示 -，给 0 会让用户以为真没搭子
    console.warn('[home-summary] 搭子数取不到，给 null', e && e.message)
    return null
  }
}

exports.main = async (event) => {
  try {
    const token = str(event && event.token)

    // —— 0. 拿到「我」——
    let me = null
    if (token) {
      const meRes = await db.collection(DB_USERS).where({ token }).limit(1).get()
      if (meRes.data.length) me = meRes.data[0]
    }

    // 未登录：几个数全都「不知道」，头像也没得换
    if (!me) {
      return {
        code: 0,
        msg: 'ok',
        data: { matched_total: null, people_total: null, my_open_cards: null, my_buddy_count: null, my_avatar_url: '' }
      }
    }

    // —— 1. 各数并发算，任何一个挂了只影响它自己 ——
    const [matchStats, myOpenCards, myBuddyCount, myAvatarUrl] = await Promise.all([
      fetchMatchStats(token),
      // 我发布的、还在找搭子的需求（status 只有 open 的算「进行中」，完成了就不该再计数）
      numOrNull(db.collection(DB_CARDS).where({ owner_id: me._id, status: 'open' }).count()),
      // 已建立的搭子数（人数）。口径唯一来源是 buddy-list：
      // 按对方 id 去重 + 剔除「已经是好友的人」，所以这个数 == 我的页那个数。
      countMyBuddies(token),
      // 首页左上角要显示真实头像：库里可能是 avatar 或历史字段 avatar_url，两套都认
      toTempUrl(me.avatar || me.avatar_url || '')
    ])

    return {
      code: 0,
      msg: 'ok',
      data: {
        matched_total: matchStats.matched,
        people_total: matchStats.people,
        my_open_cards: myOpenCards,
        my_buddy_count: myBuddyCount,
        my_avatar_url: myAvatarUrl
      }
    }
  } catch (e) {
    return { code: 500, msg: (e && e.message) || '首页汇总失败', data: null }
  }
}
