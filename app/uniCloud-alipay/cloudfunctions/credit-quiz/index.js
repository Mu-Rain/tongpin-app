'use strict'

/**
 * credit-quiz —— 《文明搭档守则》做题（信誉分唯一的主动恢复通道）
 *
 * 入参：{ token, action }
 *   action = 'status'  看现在能不能做、能加多少
 *   action = 'paper'   领一张卷（10 题，不同类型）
 *   action = 'submit'  交卷（{ paper_id, answers: [0,2,1,...] }）
 *
 * 出参：
 *   status → { score, can_quiz, kind, delta, reason, first_done, today_done }
 *   paper  → { paper_id, kind, delta, questions: [{ id, category, stem, options }] }
 *   submit → { correct, total, passed, delta, score_after, reason, items: [{ id, answer, ok, explain }] }
 *
 * 两条加分路径（都在 DEFAULT_RULES 里，见 credit-list 母本）：
 *   rule_first  +5    新用户一次性特权，**不限分数**——它把 90 分的起点抬到 95
 *                     满分才拿满 5 分：答对 9 题 4 分、8 题 3 分、7 题及以下不给分
 *   quiz_pass   +1.5  只在分数 < 90 时可用，每天一次，爬到 90 就停
 *                     同样按对题数折算：9 题 1.2 分、8 题 0.9 分
 *
 * 为什么 rule_first 不检查分数：
 *   需求里「新用户初始 90 + 首次学守则 +5」等价于「起点 95，但那 5 分要先学」。
 *   如果也按「<90 才能做」卡住，新用户永远拿不到这 5 分——他是个 90 分的人。
 *
 * 为什么 quiz_pass 要检查分数而不是只看每天次数：
 *   「恢复到 90 分及以上就不能通过做题提升」是需求原话。检查放在**发卷时**，
 *   交卷时再查一次：这两步之间分数可能被别的路径改动（比如刚好被举报扣了分）。
 *
 * 为什么答案不下发：
 *   卷子只在服务端存答案，前端拿到的 options 是无序的四个字符串。
 *   发下去等于把「做题」变成「抄答案」，这个功能就白做了。
 *
 * 为什么不直接用客户端传的分数/身份：
 *   身份只从 token 换；分数只从库里读。客户端能传的只有 paper_id 和选中的下标。
 */

const db = uniCloud.database()

const DB_USERS = 'uni-id-users'
const DB_EVENTS = 'credit_events'
const DB_RULES = 'credit_rules'
const DB_QUIZ = 'credit_quiz'
const DB_PAPERS = 'credit_quiz_papers'

// 一张卷 10 题；超过 2 小时的卷作废（防止「领了卷慢慢查」）
const PAPER_SIZE = 10
const PAPER_TTL = 2 * 60 * 60 * 1000

// 答对几题才算通过：8 题以下不给分（可以重做，不占当天次数）。
const MIN_CORRECT = 8

// 通过之后的给分比例：只有 10 题全对才拿满额，9 题 80%，8 题 60%。
// 单独列一张表而不是按比例算，是为了让「差一题就少一大截」这件事一眼可见，
// 也方便以后微调（改这张表即可，判卷逻辑不动）。
const PASS_RATIO = { 10: 1, 9: 0.8, 8: 0.6 }

/** 答对 correct 题该拿多少比例的分；0 表示不及格 */
function ratioOf(correct) {
  const r = PASS_RATIO[correct]
  return typeof r === 'number' ? r : 0
}

const CREDIT_INIT = 90
const CREDIT_MAX = 100
const CREDIT_MIN = 0
// 90 分是「正常使用」的下限，与 credit-list 保持一致
const CREDIT_PUBLISH_MIN = 90

const RULE_FIRST = 'rule_first'
const RULE_DAILY = 'quiz_pass'

// ★ 与 credit-list 母本同步的一份（这是第 6 份）。改分值要六处一起改。
const DEFAULT_RULES = [
  // 旧加分项已停用（2026-11-14）：分数只从新规则来，旧机制整体下线。
  // 分数改成 0 而不是删掉这行 —— buddy-complete 还在按 code 调 applyCredit，
  // 删了会让那条链路直接抛错；0 分只是不加分，链路照常走完。
  { code: 'buddy_done', delta: 0, text: '完成一次搭子（已停用）' },
  { code: 'buddy_like', delta: 0.1, text: '搭子互赞' },
  { code: 'meetup_checkin', delta: 0.1, text: '搭子双方完成赴约' },
  { code: 'quiz_pass', delta: 1.5, text: '学完《文明搭档守则》' },
  { code: 'rule_first', delta: 5, text: '首次学习《文明搭档守则》' },
  { code: 'no_show', delta: -1, text: '爽约被核实' },
  { code: 'report_upheld', delta: -3, text: '被举报且核实' },
  { code: 'misconduct', delta: -12, text: '不当行为被核实' },
  { code: 'verify_pass', delta: 0, text: '通过学生认证（已停用）' },
  { code: 'admin_adjust', delta: 0, text: '管理员调整' }
]

/* ------------------------------------------------------------------ *
 * 题库：40 题，7 个类别。首次调用时自动灌进 credit_quiz 集合，
 * 不需要手工建表建数据（控制台手工活越少，上线越不容易漏）。
 * answer 是 options 的下标（0 起），只在服务端用。
 * ------------------------------------------------------------------ */
const QUESTIONS = [
  // —— 言行边界 ——
  { id: 'q01', category: '言行边界', stem: '对方在聊天里反复要你的微信，你已经说过不想给。最合适的做法是？',
    options: ['再明确说一次只在这个 App 里沟通，仍纠缠就结束对话', '给了算了，以后再说', '直接拉黑，一个字不多说', '骂对方一顿再拉黑'], answer: 0,
    explain: '拒绝要清楚，但不必升级成冲突。给了再反悔，比一开始说清楚更麻烦。' },
  { id: 'q02', category: '言行边界', stem: '第一次见面，对方想挽着你的手，你并不想。怎么说？',
    options: ['「先别这样，我还不习惯」', '忍着不说，回家再吐槽', '「你有病吧」', '一声不响转身就走'], answer: 0,
    explain: '一句话把自己的边界说清楚，比忍让和翻脸都有效。' },
  { id: 'q03', category: '言行边界', stem: '搭子开了个玩笑，你觉得被冒犯了，对方说「这么敏感」。',
    options: ['直接说「这个玩笑我不舒服，别再说了」，对方继续就结束这次见面', '假装没事，把气憋着', '用更难听的话怼回去', '事后在群里骂他'], answer: 0,
    explain: '「你敏感」是把你正当的感受说成问题。重复一次边界，然后决定要不要继续相处。' },
  { id: 'q04', category: '言行边界', stem: '你想结束这次见面，怎么说最合适？',
    options: ['「我先走了，今天谢谢你」，然后离开', '不打招呼直接消失', '编个假理由，回头再吐槽', '坐在那等对方先走'], answer: 0,
    explain: '干脆离开不等于没礼貌，编理由才容易留后患。' },
  { id: 'q05', category: '言行边界', stem: '对方一直打听你室友的名字和宿舍号。',
    options: ['不回答，并说明这是室友的隐私', '告诉他，反正不是什么秘密', '随便编一个糊弄过去', '反问他室友的信息'], answer: 0,
    explain: '别人的信息不该由你转述——这既是边界，也是保护室友。' },
  { id: 'q06', category: '言行边界', stem: '拒绝别人时，哪句话最合适？',
    options: ['「这次我不去了，你找别人吧」——明确，也不贬低对方', '「我有事」，含糊但留余地', '「看情况吧」，先拖着', '「你那边人太多，我不想去」'], answer: 0,
    explain: '含糊会让人反复追问，评价对方又会伤到人。直接说不去，最省事。' },

  // —— 隐私与安全 ——
  { id: 'q07', category: '隐私与安全', stem: '第一次见搭子，地点最好选在？',
    options: ['人多的公共场所，比如图书馆、商场、白天开放的公园', '对方宿舍', '偏僻但安静的地方，好聊天', '对方车里'], answer: 0,
    explain: '第一次见面把「随时能走开、随时能被看见」放在第一位。' },
  { id: 'q08', category: '隐私与安全', stem: '对方让你把身份证拍照发过去「登记一下」。',
    options: ['拒绝，说明身份证只用于学校或平台的认证', '发过去，反正只是登记', '遮住后三位再发', '发一张网图顶一下'], answer: 0,
    explain: '身份证照片能被拿去注册、贷款。真正的认证永远走平台，不走私聊。' },
  { id: 'q09', category: '隐私与安全', stem: '刚认识的搭子开口借 500 块。',
    options: ['不借，借钱超出搭子关系的范围', '借，反正数目不大', '借一半，算是给面子', '让他写欠条再借'], answer: 0,
    explain: '搭子关系里出现借钱，基本就是关系的终点。第一次就该拒绝。' },
  { id: 'q10', category: '隐私与安全', stem: '晚上活动结束，你要独自回宿舍。',
    options: ['走人多有路灯的路，把行程和预计到达时间告诉室友', '让对方骑车送你到楼下', '走小路，快一点到', '边走路边戴耳机听歌'], answer: 0,
    explain: '让人知道你在哪、什么时候到，是最便宜的安全措施。' },
  { id: 'q11', category: '隐私与安全', stem: '校门口有陌生人说「顺路带你一程」。',
    options: ['婉拒，不上一辆陌生人的车', '上车，反正顺路', '拍下车牌再上车', '先问价钱再决定'], answer: 0,
    explain: '上车之后你就失去了「随时能走开」这个前提。' },
  { id: 'q12', category: '隐私与安全', stem: '你的定位、课表、宿舍楼号该给谁？',
    options: ['只给需要的平台功能，不给刚认识的搭子具体楼号', '发在群里，方便约人', '都给，显得真诚', '只给搭子，不给平台'], answer: 0,
    explain: '精确到楼号的信息一旦扩散，收不回来。约到「一楼大厅门口」就够了。' },
  { id: 'q13', category: '隐私与安全', stem: '见面时对方要拍合照发朋友圈并 @ 你。',
    options: ['先问你是否愿意出镜，不愿意就不拍或只拍不露脸', '拍完再说，反正已经拍了', '当场翻脸，把手机抢过来', '拍完让他事后删掉'], answer: 0,
    explain: '你的脸和你的行程都在那张照片里。同意是前提，不是事后补救。' },

  // —— 费用与 AA ——
  { id: 'q14', category: '费用与AA', stem: '约饭前，钱该什么时候说清楚？',
    options: ['约的时候就说好是 AA 还是一方请', '吃完再算', '谁提议谁请', '谁吃得少谁少付'], answer: 0,
    explain: '钱在事前说是分工，在事后说是矛盾。' },
  { id: 'q15', category: '费用与AA', stem: '打车去场地，费用怎么处理最省事？',
    options: ['出发前说好平分，或者各走各的', '到了再商量', '默认对方付', '谁坐副驾谁付'], answer: 0,
    explain: '车费小，但最容易在结算时变得难看。' },
  { id: 'q16', category: '费用与AA', stem: '对方主动买了单，你不想欠人情。',
    options: ['当场说下次我请，并且真的约第二次', '装作没看见', '立刻微信转账，还多转一点', '以后不再联系'], answer: 0,
    explain: '「下次我请」是这句客套话里唯一能被兑现的版本。' },
  { id: 'q17', category: '费用与AA', stem: '门票要提前买，你还不确定能不能去。',
    options: ['先别买，确认能去再买，避免退票损失', '让对方先垫上', '先买了再说', '让对方买两张，好退'], answer: 0,
    explain: '不确定的行程不要变成别人的预付款。' },
  { id: 'q18', category: '费用与AA', stem: '对方说过「这次我请，下次你请」，结果下次没约成。',
    options: ['不必挂心，也不拿这件事去要求对方', '追着把上一顿的钱要回来', '在群里说对方小气', '记仇，以后再也不约'], answer: 0,
    explain: '口头的人情不是债务。它只在双方都记得的时候才成立。' },

  // —— 爽约与时间 ——
  { id: 'q19', category: '爽约与时间', stem: '明天约好，今晚发现自己有事去不了。',
    options: ['越早说越好，说明原因，并提出可以改到什么时候', '当天再说，省得现在尴尬', '干脆不去，反正他会知道', '等他来问'], answer: 0,
    explain: '提前一小时说，对方还能安排自己的时间；到了再说，就只是通知。' },
  { id: 'q20', category: '爽约与时间', stem: '你迟到了 15 分钟。',
    options: ['提前发消息说明，到了道歉，不找一堆理由', '到了当没发生', '怪路上太堵', '干脆不去了'], answer: 0,
    explain: '道歉一句就够。理由越多，越像在说「你不该生气」。' },
  { id: 'q21', category: '爽约与时间', stem: '你放了对方鸽子，之后最该做的是？',
    options: ['主动道歉并说清原因，必要时补偿（比如下次我请）', '装作忘了', '说对方也没提醒我', '从此不再联系'], answer: 0,
    explain: '被放鸽子的人损失的是时间和期待。一句主动的道歉，成本最低。' },
  { id: 'q22', category: '爽约与时间', stem: '一个月内你已经爽约三次。',
    options: ['先停下来把时间安排理清，暂时别再约', '继续约，反正没人管', '换个账号继续约', '只约不见，先占着'], answer: 0,
    explain: '爽约是习惯，不是意外。继续约只会把同一个问题重复给别人。' },
  { id: 'q23', category: '爽约与时间', stem: '约定地点，最好的描述方式是？',
    options: ['具体到一个能定位的点，比如「图书馆一楼大厅门口」', '「学校附近」', '「你到了给我发消息」', '「老地方」'], answer: 0,
    explain: '模糊的地点会让一个人在原地等你半小时，还不知道该往哪走。' },
  { id: 'q24', category: '爽约与时间', stem: '被放鸽子后，在平台里该怎么做？',
    options: ['在举报或评价里如实说明经过，不添油加醋', '在群里挂人，让大家都知道', '也去放他一次鸽子', '找人对峙'], answer: 0,
    explain: '如实描述会被核实，挂人只会把你自己也拖进纠纷。' },

  // —— 卫生与礼貌 ——
  { id: 'q25', category: '卫生与礼貌', stem: '刚打完球，约了见面。',
    options: ['先简单擦洗、换件干净衣服再过去', '直接去，反正是运动搭子', '喷很多香水盖住味道', '到了再说'], answer: 0,
    explain: '换件衣服两分钟，比任何补救都有效。' },
  { id: 'q26', category: '卫生与礼貌', stem: '吃饭时你有吧唧嘴的习惯，对方明显不太舒服。',
    options: ['注意一下，放慢速度', '让对方戴耳机', '觉得对方事多', '换个人一起吃'], answer: 0,
    explain: '同一个动作，你无感，别人可能很难受。改起来只要一点注意力。' },
  { id: 'q27', category: '卫生与礼貌', stem: '见面时你一直在刷手机。',
    options: ['放下手机，把这段时间留给对方', '边聊边刷，两不耽误', '告诉对方我在回消息', '戴上耳机边听边聊'], answer: 0,
    explain: '对方能感觉到你在不在。刷手机是最直接的「我不在这儿」。' },
  { id: 'q28', category: '卫生与礼貌', stem: '对方说的观点你不同意。',
    options: ['说「我看法不太一样」并讲理由，不评价人', '直接说「你这想法很幼稚」', '沉默，然后找借口走', '发到群里当谈资'], answer: 0,
    explain: '反驳观点和贬低人，中间只差一句话的说法。' },
  { id: 'q29', category: '卫生与礼貌', stem: '你身上烟味比较重，要去见不抽烟的搭子。',
    options: ['提前说明，尽量换衣服，或改约通风的地方', '到了再说', '抽完直接去', '让他习惯一下'], answer: 0,
    explain: '提前一句说明，比见面时的尴尬便宜得多。' },

  // —— 紧急与求助 ——
  { id: 'q30', category: '紧急与求助', stem: '见面时对方有不当肢体接触，你已明确拒绝但他继续。',
    options: ['立刻离开到人多的地方，保存聊天记录，在平台举报并告诉可信任的人', '忍到这次见面结束', '和他讲道理，希望他理解', '道歉，说自己太敏感'], answer: 0,
    explain: '先离开现场，再留证据，再举报。安全永远排在礼貌前面。' },
  { id: 'q31', category: '紧急与求助', stem: '你发现有人一路跟着你。',
    options: ['走向人多明亮的地方，进店或进校门，必要时打 110', '加快脚步直接回宿舍', '停下来质问他', '躲进没人的小巷'], answer: 0,
    explain: '往有人的地方走，是最有效的第一步。' },
  { id: 'q32', category: '紧急与求助', stem: '对方见面时突然身体不适、意识模糊。',
    options: ['立刻打 120，说清地点和症状，同时联系他室友或辅导员', '让他先躺一会儿看看', '先拍视频留证据', '直接送他回宿舍'], answer: 0,
    explain: '急救电话比自己判断病情可靠。地址和症状说清楚，救护车才找得到。' },
  { id: 'q33', category: '紧急与求助', stem: '对方喝多了，让你送他回住处。',
    options: ['联系他的室友或同学来接，或送到楼下交给认识的人，不进他的房间', '送进房间照顾到他睡着', '把他一个人留在路边', '自己先走，让他自己想办法'], answer: 0,
    explain: '帮到「有人接手」为止。进房间对双方都是新的风险。' },
  { id: 'q34', category: '紧急与求助', stem: '紧急情况该先打哪个电话？',
    options: ['110 报警、120 急救；校园内也可以先找保卫处', '先发朋友圈，看看谁在附近', '先在平台举报，等回复', '先在搭子群里问'], answer: 0,
    explain: '能立刻到现场的只有这三个号码。' },
  { id: 'q35', category: '紧急与求助', stem: '在平台里遇到问题，举报该怎么写？',
    options: ['走聊天页或对方主页的举报入口，选原因，写清时间、地点、经过', '只在群里说一遍', '私信客服（平台没有这个入口）', '等对方主动道歉'], answer: 0,
    explain: '后台只能处理它看得到的东西。时间地点经过，是核实的三要素。' },

  // —— 平台规则 ——
  { id: 'q36', category: '平台规则', stem: '一个人注册多个账号去刷好评、刷单。',
    options: ['违规，会被封号并影响信誉分', '没关系，只要不被发现', '平台鼓励，能提高活跃度', '只有管理员能这么做'], answer: 0,
    explain: '多账号刷量直接破坏「谁值得约」这件事的可信度。' },
  { id: 'q37', category: '平台规则', stem: '发布虚假需求，比如写着「约人学习」，见面却是推销。',
    options: ['违规，内容会被删除并扣信誉分', '只要见面说清楚就不算', '可以，发布是自由的', '只要不收费就不算'], answer: 0,
    explain: '虚假需求消耗的是别人对整条需求列表的信任。' },
  { id: 'q38', category: '平台规则', stem: '线下和搭子做买卖或代付（代买、代抢、代付）。',
    options: ['平台不担保，风险自担；尽量走正规渠道并保留凭证', '平台会全额赔付', '一律禁止，见一次封号', '只能现金交易'], answer: 0,
    explain: '平台能管内容，管不了你和别人之间的转账。凭证是你唯一的凭仗。' },
  { id: 'q39', category: '平台规则', stem: '举报之后，被举报人知道是谁举报的吗？',
    options: ['平台对举报人身份保密', '会显示举报人的昵称', '会显示举报人的头像', '会直接通知对方'], answer: 0,
    explain: '匿名是举报能被使用的前提。报复风险一旦存在，就没有人愿意举报。' },
  { id: 'q40', category: '平台规则', stem: '信誉分低于 90 之后，怎么恢复？',
    options: ['做《文明搭档守则》的题，按规则加分，同时不再违规', '等 30 天自动恢复', '找管理员直接改回来', '重新注册一个账号'], answer: 0,
    explain: '做题是唯一的主动恢复通道；到 90 分就停止加分。' }
]

/* ---------------------------- 工具 ---------------------------- */

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function pickInt(v, dft) {
  return typeof v === 'number' ? v : dft
}

function clampScore(n) {
  // 0.1 分一档：不按十分位收口会得到 90.30000000000001 这种脏值
  return Math.round(Math.max(CREDIT_MIN, Math.min(CREDIT_MAX, n)) * 10) / 10
}

/** 双字段兼容：历史数据里 credit 和 credit_score 都有人写 */
function readScore(user) {
  const u = user || {}
  return pickInt(u.credit_score, pickInt(u.credit, CREDIT_INIT))
}

function defaultRule(code) {
  for (let i = 0; i < DEFAULT_RULES.length; i++) {
    const r = DEFAULT_RULES[i]
    if (r.code === code) return { code: r.code, delta: r.delta, text: r.text }
  }
  return { code: code, delta: 0, text: code }
}

/** credit_rules 集合存在时以库为准（运营可以在后台改分值）；不存在就静默用默认值 */
async function loadRuleMap() {
  const map = {}
  DEFAULT_RULES.forEach(function (r) {
    map[r.code] = { code: r.code, delta: r.delta, text: r.text }
  })
  try {
    const res = await db.collection(DB_RULES).limit(100).get()
    ;(res.data || []).forEach(function (row) {
      const code = str(row.code)
      if (!code) return
      const base = map[code] || { code: code, delta: 0, text: code }
      map[code] = {
        code: code,
        delta: typeof row.delta === 'number' ? row.delta : base.delta,
        text: str(row.text) || base.text
      }
    })
  } catch (e) {
    // 集合还没建：用默认值，不报错
  }
  return map
}

async function resolveRule(code) {
  const map = await loadRuleMap()
  return map[code] || defaultRule(code)
}

/** 写流水 + 改分。与 credit-list 母本同构（第 6 份副本） */
async function applyCredit(userId, reasonCode, refId, ratio, amount) {
  const rule = await resolveRule(reasonCode)
  // ratio 缺省 1（全额）。不及格的情况根本不进这里，所以不用处理 0。
  const k = typeof ratio === 'number' && ratio > 0 && ratio < 1 ? ratio : 1
  // amount 只在「新手特权没拿满、重考补差额」时传：这次该给几分的最终决定权在外面
  const byRatio = k >= 1 ? rule.delta : Math.round(rule.delta * k * 10) / 10
  const delta =
    typeof amount === 'number' && amount > 0 ? Math.round(amount * 10) / 10 : byRatio
  const res = await db.collection(DB_USERS).where({ _id: userId }).limit(1).get()
  const before = readScore(res.data && res.data[0])
  // 已停用的旧加分项 delta 为 0：不写 0 分流水，分数原样返回
  if (!rule.delta) return { score: before, delta: 0 }
  const after = clampScore(before + delta)
  await db.collection(DB_EVENTS).add({
    user_id: userId,
    reason_code: rule.code,
    reason_text: k >= 1 ? rule.text : rule.text + '（答对 ' + Math.round(k * 10) + ' 题）',
    delta: delta,
    score_before: before,
    score_after: after,
    ref_id: str(refId),
    created_at: Date.now()
  })
  await db
    .collection(DB_USERS)
    .doc(userId)
    .update({ credit_score: after, credit: after })
  return { score: after, delta: delta }
}

async function getUserByToken(token) {
  if (!token) fail('未登录', 401)
  const r = await db.collection(DB_USERS).where({ token }).limit(1).get()
  if (!r.data.length) fail('登录已过期，请重新登录', 401)
  const me = r.data[0]
  if (me.status === 'banned') fail('账号已被封禁', 403)
  return me
}

function dayStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 这个用户在某个加分项上累计已经拿了多少分（新手特权靠它判断「拿满了没有」） */
async function sumEvents(userId, code) {
  try {
    const r = await db
      .collection(DB_EVENTS)
      .where({ user_id: userId, reason_code: code })
      .limit(100)
      .get()
    let sum = 0
    const rows = r.data || []
    for (let i = 0; i < rows.length; i++) sum += Number(rows[i].delta) || 0
    return Math.round(sum * 10) / 10
  } catch (e) {
    // 读不到就当没拿过：宁可多发一次，也不让用户白做
    return 0
  }
}

/** 这个用户有没有拿过某类加分（first 是终身一次，daily 只算今天） */
async function hasEvent(userId, code, since) {
  try {
    const where = { user_id: userId, reason_code: code }
    if (since) where.created_at = db.command.gte(since)
    const r = await db.collection(DB_EVENTS).where(where).limit(1).get()
    return r.data.length > 0
  } catch (e) {
    return false
  }
}

/**
 * 当前能做哪一类：first（新手 +5，不限分）/ daily（<90 时每天 +1.5）/ none
 * 三条分支的顺序有意义：first 优先，因为它是「一次性特权」，不该被分数挡住。
 */
async function decideKind(user) {
  const score = readScore(user)
  const firstRule = await resolveRule(RULE_FIRST)
  const firstGranted = await sumEvents(user._id, RULE_FIRST)
  // 「拿满才算用掉」：答对 9 题只给 4 分，还剩 1 分，用户重考就能补上
  const firstDone = firstGranted >= firstRule.delta
  if (!firstDone) {
    const remain = Math.round((firstRule.delta - firstGranted) * 10) / 10
    return {
      kind: 'first',
      delta: firstRule.delta,
      remain: remain,
      score: score,
      first_done: false,
      today_done: false,
      can: true,
      reason: ''
    }
  }
  const todayDone = await hasEvent(user._id, RULE_DAILY, dayStart())
  if (score < CREDIT_PUBLISH_MIN) {
    if (todayDone) {
      return { kind: 'none', delta: 0, score: score, first_done: true, today_done: true, can: false, reason: '今天已经做过了，明天再来' }
    }
    const r = await resolveRule(RULE_DAILY)
    return { kind: 'daily', delta: r.delta, score: score, first_done: true, today_done: false, can: true, reason: '' }
  }
  return {
    kind: 'none',
    delta: 0,
    score: score,
    first_done: true,
    today_done: todayDone,
    can: false,
    reason: '信誉分已经在 90 分及以上，做题不再加分'
  }
}

/* ---------------------------- 题库 ---------------------------- */

/** 第一次调用时把 40 题灌进库；库里有数据就跳过 */
async function ensureSeed() {
  let count = 0
  try {
    const r = await db.collection(DB_QUIZ).count()
    count = r.total || 0
  } catch (e) {
    count = 0
  }
  if (count >= QUESTIONS.length) return
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i]
    try {
      await db.collection(DB_QUIZ).add({
        _id: q.id,
        category: q.category,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        explain: q.explain,
        enabled: true
      })
    } catch (e) {
      // 已存在（_id 冲突）就跳过：重复灌库不该报错
    }
  }
}

/** 抽 10 题：按类别轮流取，保证一张卷里题型不单一 */
function drawFrom(list, n) {
  const byCat = {}
  const cats = []
  list.forEach(function (q) {
    if (!byCat[q.category]) {
      byCat[q.category] = []
      cats.push(q.category)
    }
    byCat[q.category].push(q)
  })
  cats.forEach(function (c) {
    byCat[c].sort(function () {
      return Math.random() - 0.5
    })
  })
  const picked = []
  let guard = 0
  while (picked.length < n && guard < 600) {
    guard++
    let moved = false
    for (let i = 0; i < cats.length && picked.length < n; i++) {
      const bucket = byCat[cats[i]]
      if (bucket.length) {
        picked.push(bucket.pop())
        moved = true
      }
    }
    if (!moved) break
  }
  return picked
}

async function loadQuestions() {
  try {
    const r = await db.collection(DB_QUIZ).limit(200).get()
    const rows = (r.data || []).filter(function (x) {
      return x && x.enabled !== false
    })
    if (rows.length >= PAPER_SIZE) return rows
  } catch (e) {
    // 集合读不到就走内存里的这份，功能不至于挂掉
  }
  return QUESTIONS.map(function (q) {
    return { _id: q.id, category: q.category, stem: q.stem, options: q.options, answer: q.answer, explain: q.explain }
  })
}

/* ---------------------------- 入口 ---------------------------- */

function actionStatus(user) {
  return decideKind(user).then(function (d) {
    return {
      score: d.score,
      can_quiz: d.can,
      kind: d.kind,
      delta: d.delta,
      remain: d.remain || 0,
      reason: d.reason,
      first_done: d.first_done,
      today_done: d.today_done
    }
  })
}

async function actionPaper(user) {
  const d = await decideKind(user)
  if (!d.can) fail(d.reason || '现在不能做题', 403)
  await ensureSeed()
  const pool = await loadQuestions()
  const picked = drawFrom(pool.slice(), PAPER_SIZE)
  if (picked.length < PAPER_SIZE) fail('题库还没准备好，稍后再试', 500)
  const addRes = await db.collection(DB_PAPERS).add({
    user_id: user._id,
    kind: d.kind,
    qids: picked.map(function (q) {
      return q._id
    }),
    answers: [],
    submitted: false,
    created_at: Date.now()
  })
  return {
    paper_id: addRes.id,
    kind: d.kind,
    delta: d.delta,
    remain: d.remain || 0,
    questions: picked.map(function (q) {
      return { id: q._id, category: q.category, stem: q.stem, options: q.options }
    })
  }
}

async function actionSubmit(user, event) {
  const paperId = str(event.paper_id)
  if (!paperId) fail('缺少 paper_id', 400)
  const answers = Array.isArray(event.answers) ? event.answers : []
  if (answers.length !== PAPER_SIZE) fail('一题都还没答完', 400)

  const res = await db.collection(DB_PAPERS).where({ _id: paperId, user_id: user._id }).limit(1).get()
  const paper = res.data && res.data[0]
  if (!paper) fail('这张卷子不存在', 404)
  if (paper.submitted) fail('这张卷子已经交过了', 400)
  if (Date.now() - pickInt(paper.created_at, 0) > PAPER_TTL) fail('这张卷子超时了，重新领一张', 400)

  const pool = await loadQuestions()
  const byId = {}
  pool.forEach(function (q) {
    byId[q._id] = q
  })

  let correct = 0
  const items = []
  for (let i = 0; i < paper.qids.length; i++) {
    const q = byId[paper.qids[i]]
    if (!q) continue
    const chosen = typeof answers[i] === 'number' ? answers[i] : -1
    const ok = chosen === q.answer
    if (ok) correct++
    items.push({ id: q._id, answer: q.answer, ok: ok, explain: q.explain })
  }

  // 交卷即锁，重放同一张卷子不会再给一次分
  await db.collection(DB_PAPERS).doc(paperId).update({ submitted: true, submitted_at: Date.now(), correct: correct })

  const ratio = ratioOf(correct)
  const passed = correct >= MIN_CORRECT && ratio > 0
  const d = await decideKind(user)
  let delta = 0
  let scoreAfter = d.score
  let reason = ''

  if (!passed) {
    // 不及格既不写流水也不记 first_done/today_done，所以可以直接重做，不算用掉今天那次
    reason = '答对 ' + MIN_CORRECT + ' 题才算通过，这次没到，可以再来一次'
  } else if (paper.kind === 'first' && !d.first_done) {
    // 这次按比例该给多少，但不能超过「还没拿满的部分」——重考只补差额，不会变成 4 分 + 5 分
    const full = Math.round(d.delta * ratio * 10) / 10
    const grant = Math.min(full, d.remain)
    if (grant > 0) {
      const r = await applyCredit(user._id, RULE_FIRST, paperId, ratio, grant)
      delta = r.delta
      scoreAfter = r.score
      if (grant < full) reason = '这次按比例该加 ' + full + ' 分，但这项只剩 ' + d.remain + ' 分，就只补差额'
    } else {
      reason = '这一项已经拿满了'
    }
  } else if (paper.kind === 'daily' && d.kind === 'daily') {
    const r = await applyCredit(user._id, RULE_DAILY, paperId, ratio)
    delta = r.delta
    scoreAfter = r.score
  } else {
    reason = d.reason || '这次不计分'
  }

  return {
    correct: correct,
    total: PAPER_SIZE,
    passed: passed,
    ratio: ratio,
    delta: delta,
    score_after: scoreAfter,
    reason: reason,
    items: items
  }
}

exports.main = async (event) => {
  const e = event || {}
  const user = await getUserByToken(str(e.token))
  const action = str(e.action) || 'status'
  if (action === 'status') return { code: 0, msg: 'ok', data: await actionStatus(user) }
  if (action === 'paper') return { code: 0, msg: 'ok', data: await actionPaper(user) }
  if (action === 'submit') return { code: 0, msg: 'ok', data: await actionSubmit(user, e) }
  fail('不支持的操作：' + action, 400)
}
