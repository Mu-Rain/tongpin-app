'use strict'

/**
 * 举报内容筛查 —— 后台处置前的第一道判定
 *
 * 入参：{ report_id }
 * 出参：{ code, msg, data: { hit, severity, category, reason, by, texts } }
 *
 * severity 0~5，对应扣分 0~5 分（见 DEDUCT）。by 说明结论从哪来：
 *   'wordlist' 词表直接定级（未命中，或模型不可用时兜底）
 *   'ai'       词表命中后交给模型判级
 *
 * ★ 为什么先词表、再模型：
 *   一次模型调用要一秒多、几分钱。校园场景里绝大多数举报是「没有违规」
 *   或者「一眼能看出违规」，词表能当场给出这两类答案，只有词表命中但
 *   分不清轻重（辱骂 vs 威胁）时才值得花钱让模型看一眼。
 *
 * ★ 为什么不需要调用方是管理员：
 *   处置链路 云函数 → 云函数 没有可传的用户凭证。改成「谁都能调但结果
 *   写回报告、6 分钟内复用」：一条待处理举报最多产生一次模型调用，
 *   刷接口刷不出成本，而管理员点处置时又不用额外配置任何密钥。
 *
 * ★ 为什么不在这里扣分：
 *   扣分要写 credit_events 并改信用分，属于处置动作，留在
 *   report-review / admin-reports 里做，这里只产出结论。
 */

const https = require('https')

const db = uniCloud.database()

const DB_REPORTS = 'reports'
const DB_MESSAGES = 'messages'
const DB_GLOBAL_CFG = 'ai_config'

const ENV_BASE_URL = 'AI_BASE_URL'
const ENV_MODEL = 'AI_MODEL'
const ENV_KEY = 'AI_API_KEY'

const AI_TIMEOUT = 12000
const CACHE_MS = 6 * 60 * 1000
const EVIDENCE_MAX = 20
const EVIDENCE_CHARS = 300
// 词表命中后送给模型的正文上限，太长没用还费钱
const PROMPT_CHARS = 2400

// 严重度 → 扣分。与 credit-list 的 report_upheld 规则区间保持一致。
const DEDUCT = [0, 1, 2, 3, 4, 5]

// 词表：分类 + 该分类的起步严重度。命中多条取最高。
const WORDS = [
  {
    category: '赌博或毒品',
    severity: 4,
    words: ['赌博', '博彩', '下注', '买码', '冰毒', '大麻', '吸毒', '摇头丸', 'K粉']
  },
  {
    category: '人身威胁',
    severity: 4,
    words: ['打死你', '杀了你', '弄死你', '砍你', '弄死', '威胁你', '等着瞧', '找人收拾']
  },
  {
    category: '色情或性骚扰',
    severity: 3,
    words: ['约炮', '开房', '包养', '裸聊', '色情', '黄片', '一夜情', '睡你', '发裸照']
  },
  {
    category: '诈骗或营销',
    severity: 2,
    words: ['刷单', '返利', '日结', '贷款', '投资群', '加微信领', '兼职招聘', '扫码领']
  },
  {
    category: '辱骂攻击',
    severity: 1,
    words: ['傻逼', '智障', '废物', '去死', '滚开', '操你', '妈的', '有病吧']
  }
]

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function pickInt(v, dft) {
  const n = parseInt(v, 10)
  return isNaN(n) ? dft : n
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function cut(s, max) {
  const t = str(s)
  return t.length > max ? t.slice(0, max) : t
}

function joinUrl(base) {
  let b = str(base).replace(/\/+$/, '')
  if (b.slice(-18) === '/chat/completions') return b
  return b + '/chat/completions'
}

function postJson(urlStr, bodyStr, headers) {
  return new Promise(function (resolve, reject) {
    let u
    try {
      u = new URL(urlStr)
    } catch (e) {
      reject(new Error('接口地址不合法'))
      return
    }
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: headers,
        timeout: AI_TIMEOUT
      },
      function (res) {
        let raw = ''
        res.setEncoding('utf8')
        res.on('data', function (c) {
          raw += c
        })
        res.on('end', function () {
          resolve({ status: res.statusCode, body: raw })
        })
      }
    )
    req.on('timeout', function () {
      req.destroy(new Error('模型响应超时'))
    })
    req.on('error', reject)
    req.end(bodyStr)
  })
}

// 与 ai-assistant 的 resolveProvider 同口径：库优先、环境变量兜底，缺一项就算没配
async function resolveProvider() {
  let gd = {}
  try {
    const r = await db.collection(DB_GLOBAL_CFG).where({ _id: 'default' }).limit(1).get()
    gd = (r.data && r.data[0]) || {}
  } catch (e) {
    gd = {}
  }
  const baseUrl = str(gd.base_url || process.env[ENV_BASE_URL] || '')
  const model = str(gd.model || process.env[ENV_MODEL] || '')
  const key = str(process.env[ENV_KEY] || gd.api_key || '')
  if (!baseUrl || !model || !key) return null
  return { base_url: baseUrl, model: model, api_key: key }
}

function scanWords(text) {
  const s = str(text)
  if (!s) return { hit: false, severity: 0, category: '', matched: [] }
  let best = 0
  let category = ''
  const matched = []
  WORDS.forEach(function (group) {
    group.words.forEach(function (w) {
      if (s.indexOf(w) < 0) return
      matched.push(w)
      if (group.severity > best) {
        best = group.severity
        category = group.category
      }
    })
  })
  return { hit: matched.length > 0, severity: best, category: category, matched: matched }
}

function buildPrompt(texts) {
  const body = texts
    .map(function (t) {
      return (t.who ? t.who + '：' : '') + cut(t.content, EVIDENCE_CHARS)
    })
    .join('\n')
  return [
    '你是校园社区的内容审核员。下面是用户举报的一段聊天记录。',
    '判断其中是否存在违反社区规范的内容：色情或性骚扰、赌博或毒品、人身威胁、辱骂攻击、诈骗或营销。',
    '只回一个 JSON 对象，不要解释、不要代码块：',
    '{"hit":true 或 false,"severity":1到5的整数,"category":"分类中文名","reason":"不超过40字的中文说明"}',
    '严重度：1 轻微辱骂；2 冒犯或营销；3 性骚扰或色情暗示；4 赌博毒品或诈骗；5 人身威胁或极端内容。',
    '没有违规就回 {"hit":false,"severity":0,"category":"","reason":"未发现明显违规"}。',
    '',
    '聊天记录：',
    cut(body, PROMPT_CHARS)
  ].join('\n')
}

function extractJson(text) {
  const s = str(text)
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    return JSON.parse(s.slice(a, b + 1))
  } catch (e) {
    return null
  }
}

async function judgeByModel(texts) {
  const provider = await resolveProvider()
  if (!provider) return null
  const payload = {
    model: provider.model,
    messages: [{ role: 'user', content: buildPrompt(texts) }],
    temperature: 0.1,
    max_tokens: 300,
    stream: false
  }
  const bodyStr = JSON.stringify(payload)
  const res = await postJson(joinUrl(provider.base_url), bodyStr, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr),
    Authorization: 'Bearer ' + provider.api_key
  })
  if (res.status !== 200) return null
  let data
  try {
    data = JSON.parse(res.body)
  } catch (e) {
    return null
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : ''
  const j = extractJson(content)
  if (!j) return null
  return {
    hit: j.hit === true,
    severity: clamp(pickInt(j.severity, 0), 0, 5),
    category: cut(j.category, 20),
    reason: cut(j.reason, 80)
  }
}

// 举报里存了证据就用存的；没存（老数据）就按 message 现查一遍
async function collectTexts(report) {
  const stored = Array.isArray(report.evidence) ? report.evidence : []
  if (stored.length) {
    return stored.slice(0, EVIDENCE_MAX).map(function (it) {
      return { who: str(it.who), content: cut(it.content, EVIDENCE_CHARS) }
    })
  }
  if (str(report.target_type) !== 'message') return []
  let msg = null
  try {
    const r = await db.collection(DB_MESSAGES).where({ _id: str(report.target_id) }).limit(1).get()
    msg = r.data && r.data[0]
  } catch (e) {
    return []
  }
  if (!msg) return []
  let list = [msg]
  try {
    const around = await db
      .collection(DB_MESSAGES)
      .where({ conversation_id: msg.conversation_id })
      .orderBy('created_at', 'desc')
      .limit(EVIDENCE_MAX)
      .get()
    if (around.data && around.data.length) list = around.data
  } catch (e) {
    list = [msg]
  }
  return list
    .slice(0, EVIDENCE_MAX)
    .reverse()
    .map(function (m) {
      return { who: str(m.sender_id), content: cut(m.content, EVIDENCE_CHARS) }
    })
}

function textsJoined(texts) {
  return texts
    .map(function (t) {
      return t.content
    })
    .join('\n')
}

exports.main = async (event) => {
  try {
    event = event || {}
    const reportId = str(event.report_id)
    if (!reportId) fail('缺少 report_id', 400)

    let report = null
    try {
      const r = await db.collection(DB_REPORTS).where({ _id: reportId }).limit(1).get()
      report = r.data && r.data[0]
    } catch (e) {
      report = null
    }
    if (!report) fail('这条举报不存在', 404)

    // 结论缓存：一条举报 6 分钟内只算一次，避免重复刷模型
    const cached = report.ai
    if (cached && Date.now() - pickInt(cached.at, 0) < CACHE_MS) {
      return {
        code: 0,
        msg: 'ok',
        data: {
          hit: cached.hit === true,
          severity: pickInt(cached.severity, 0),
          category: str(cached.category),
          reason: str(cached.reason),
          by: str(cached.by) || 'cache',
          deduct: DEDUCT[clamp(pickInt(cached.severity, 0), 0, 5)],
          texts: []
        }
      }
    }

    const texts = await collectTexts(report)
    const word = scanWords(textsJoined(texts))

    let out = {
      hit: word.hit,
      severity: word.severity,
      category: word.category,
      reason: word.hit ? '命中敏感词：' + word.matched.slice(0, 3).join('、') : '未发现明显违规',
      by: 'wordlist'
    }

    // 词表命中才值得花一次模型调用；没命中的直接放行，人工仍可自行判断
    if (word.hit && texts.length) {
      try {
        const judged = await judgeByModel(texts)
        if (judged) {
          out = {
            hit: judged.hit,
            severity: judged.hit ? clamp(judged.severity, 1, 5) : 0,
            category: judged.category || word.category,
            reason: judged.reason || out.reason,
            by: 'ai'
          }
        }
      } catch (e) {
        console.error('[report-screen] model', e && e.message ? e.message : e)
      }
    }

    const at = Date.now()
    const patch = {
      ai: {
        hit: out.hit,
        severity: out.severity,
        category: out.category,
        reason: out.reason,
        by: out.by,
        at: at
      }
    }
    try {
      await db.collection(DB_REPORTS).doc(reportId).update(patch)
    } catch (e) {
      // 写不进去也要把结论返回给调用方，处置不受影响
      console.error('[report-screen] write', e && e.message ? e.message : e)
    }

    return {
      code: 0,
      msg: 'ok',
      data: {
        hit: out.hit,
        severity: out.severity,
        category: out.category,
        reason: out.reason,
        by: out.by,
        deduct: DEDUCT[clamp(out.severity, 0, 5)],
        texts: texts.map(function (t) {
          return { who: t.who, content: cut(t.content, 80) }
        })
      }
    }
  } catch (e) {
    return { code: e.bizCode || 500, msg: e.message || '筛查失败' }
  }
}
