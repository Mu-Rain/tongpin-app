'use strict';

/**
 * ai-assistant —— 同频的智能助手（A 帮我写需求卡 / B 帮我找搭子）
 *
 * 为什么单独一个云函数：模型 key 只能待在服务端。前端一次也拿不到它，
 * 所有请求都由这里出站，出站前后各做一次校验（入参 / 模型返回的 JSON）。
 *
 * 模型来源两种，按优先级：
 *   1) 用户自己接的接口（ai_user_config，一用户一条）—— 支持任何 OpenAI 兼容地址
 *   2) 作者提供的默认模型（ai_config 里的 _id='default'，读不到再读环境变量）
 * 两种都读不到就返回 501「还没配置模型」，前端引导去设置页，不假装能用。
 *
 * 入参统一形态：{ action, token, ... }
 * 出参统一形态：{ code, msg, data }
 */

const https = require('https');
const http = require('http');

const DB_USERS = 'uni-id-users';
const DB_CARDS = 'cards';
const DB_TAGS = 'tags';
const DB_CARD_TAGS = 'card_tags';
const DB_USER_CFG = 'ai_user_config';
const DB_GLOBAL_CFG = 'ai_config';
const DB_USAGE = 'ai_usage';

// 默认模型：作者这一侧接的任意 OpenAI 兼容接口。地址/模型名都能被 ai_config 或环境变量覆盖，改配置不用重新部署。
const ENV_BASE_URL = 'AI_BASE_URL';
const ENV_MODEL = 'AI_MODEL';
const ENV_KEY = 'AI_API_KEY';


// 每日次数：默认模型是作者的额度，卡紧一点；自带 key 的只防误刷
const DEFAULT_DAILY = 30;
const SELF_DAILY = 300;

const TIMEOUT_MS = 25000;
const MATCH_SCAN = 200;
const MATCH_RETURN = 6;
const TAG_PROMPT_LIMIT = 96;

const TYPES = ['study', 'fitness', 'photo', 'meal', 'sport', 'other'];
const TYPES_CN = {
  study: '学习',
  fitness: '健身',
  photo: '拍照',
  meal: '吃饭',
  sport: '运动',
  other: '其他'
};
const TYPE_HINTS = [
  { key: 'study', words: ['自习', '学习', '复习', '考研', '背单词', '图书馆', '刷题', '作业'] },
  { key: 'fitness', words: ['健身', '撸铁', '减脂', '增肌', '瑜伽', '锻炼'] },
  { key: 'meal', words: ['吃饭', '食堂', '火锅', '探店', '夜宵', '干饭', '奶茶'] },
  { key: 'sport', words: ['跑步', '夜跑', '羽毛球', '篮球', '足球', '网球', '游泳', '骑行', '爬山'] },
  { key: 'photo', words: ['拍照', '摄影', '出片', '写真', '街拍', '扫街'] }
];
const CATEGORY_ORDER = ['routine', 'intensity', 'personality', 'interest', 'preference', 'subject'];
const CATEGORY_LABEL = {
  routine: '作息',
  intensity: '强度',
  personality: '性格',
  interest: '兴趣',
  preference: '偏好',
  subject: '科目'
};

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

function ok(data) {
  return { code: 0, msg: 'ok', data: data || {} };
}

function fail(code, msg) {
  return { code, msg };
}

function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

// 按“字”截断：非 BMP 字符（emoji）不能被切一半，否则前端会显示乱码方块
function clamp(s, min, max) {
  let out = str(s).replace(/\s+/g, ' ').trim();
  const chars = Array.from ? Array.from(out) : out.split('');
  if (chars.length > max) out = chars.slice(0, max).join('');
  if (min > 0 && chars.length < min) return '';
  return out;
}

function dayKey(ts) {
  const d = new Date(ts);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

function maskKey(k) {
  const s = str(k);
  if (s.length <= 8) return s ? '****' : '';
  return s.slice(0, 3) + '****' + s.slice(-4);
}

// base_url 允许写成 https://host/v1、https://host/v1/、https://host/v1/chat/completions
function joinUrl(base) {
  let b = str(base).trim();
  while (b.length && b.charAt(b.length - 1) === '/') b = b.slice(0, b.length - 1);
  if (b.indexOf('/chat/completions') > -1) return b;
  return b + '/chat/completions';
}

// 内网地址不放行：用户填的地址是服务端去请求的，localhost / 内网段会被用来打内网
function isPrivateHost(host) {
  const h = str(host).toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function parseUrl(u) {
  try {
    const o = new URL(str(u));
    return { ok: true, protocol: o.protocol, hostname: o.hostname, port: o.port, path: o.pathname + o.search };
  } catch (e) {
    return { ok: false };
  }
}

function checkBaseUrl(u) {
  const p = parseUrl(u);
  if (!p.ok) return '接口地址不是合法的 URL（要带 http:// 或 https://）';
  if (p.protocol !== 'http:' && p.protocol !== 'https:') return '接口地址只支持 http / https';
  if (isPrivateHost(p.hostname)) return '接口地址不能填本机或内网地址';
  return '';
}

/* ------------------------------------------------------------------ *
 * HTTP：只用 Node 自带模块，不依赖额外依赖
 * ------------------------------------------------------------------ */

function requestOnce(urlStr, bodyStr, headers) {
  return new Promise((resolve, reject) => {
    const p = parseUrl(urlStr);
    if (!p.ok) {
      reject(new Error('接口地址不是合法的 URL'));
      return;
    }
    const lib = p.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        method: 'POST',
        hostname: p.hostname,
        port: p.port || (p.protocol === 'http:' ? 80 : 443),
        path: p.path,
        headers,
        timeout: TIMEOUT_MS
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          // 模型返回再长也不该超过 2MB，超了直接掐断，别把内存吃满
          if (buf.length < 2 * 1024 * 1024) buf += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, body: buf }));
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('模型响应超时'));
    });
    req.on('error', (e) => reject(e));
    req.write(bodyStr);
    req.end();
  });
}

function httpErrText(status, body) {
  const tail = clamp(body, 0, 160);
  // 网关的原话比我们的猜测有用：404 既可能是地址漏了路径，也可能是它不认识这个模型名
  const more = tail ? '：' + tail : '';
  if (status === 401 || status === 403) return '接口 Key 无效或没有权限（' + status + '）' + more;
  if (status === 404) return '接口地址或模型名不对（404）：' + (tail ? tail : '看上面填的地址和模型名');
  if (status === 429) return '请求太频繁，或这个 Key 的额度用完了（429）' + more;
  if (status >= 500) return '模型服务端出错（' + status + '），稍后再试' + more;
  return '模型接口返回 ' + status + more;
}

function pickText(data) {
  const d = data || {};
  const list = Array.isArray(d.choices) ? d.choices : [];
  if (!list.length) return '';
  const c = list[0] || {};
  const msg = c.message || {};
  const content = msg.content;
  if (typeof content === 'string') return content;
  // 少数网关把 content 返回成分段数组
  if (Array.isArray(content)) {
    return content
      .map((x) => (x && typeof x.text === 'string' ? x.text : ''))
      .join('')
      .trim();
  }
  if (typeof c.text === 'string') return c.text;
  return '';
}

async function chat(provider, messages, opts) {
  const o = opts || {};
  const payload = {
    model: provider.model,
    messages,
    temperature: typeof o.temperature === 'number' ? o.temperature : 0.4,
    max_tokens: o.max_tokens || 800,
    stream: false
  };
  const bodyStr = JSON.stringify(payload);
  const t0 = Date.now();
  let res;
  try {
    res = await requestOnce(joinUrl(provider.base_url), bodyStr, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      Authorization: 'Bearer ' + provider.api_key
    });
  } catch (e) {
    const m = str(e && e.message ? e.message : e);
    if (m.indexOf('超时') > -1) throw new Error('模型响应超时，稍后再试一次');
    throw new Error('连不上模型接口：' + (m || '网络错误'));
  }
  const latency = Date.now() - t0;
  if (res.status !== 200) throw new Error(httpErrText(res.status, res.body));
  let data;
  try {
    data = JSON.parse(res.body);
  } catch (e) {
    throw new Error('模型接口返回的不是 JSON，检查地址是不是 OpenAI 兼容的 /v1 接口');
  }
  const text = pickText(data);
  if (!text) throw new Error('模型没有返回内容');
  return {
    text,
    latency_ms: latency,
    model: data.model || provider.model,
    usage: data.usage || null
  };
}

// 模型偶尔会套 ```json 代码块或前后加一句解释，这里只取第一个 { 到最后一个 }
function extractJson(text) {
  const s = str(text).trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let body = s.slice(a, b + 1);
  try {
    return JSON.parse(body);
  } catch (e) {
    // 尾随逗号是模型最常见的语法错误，删一次再试
    body = body.replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(body);
    } catch (e2) {
      return null;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 模型来源 / 配额
 * ------------------------------------------------------------------ */

// 用户配置读取：集合还没建时当作「没配」，不把用户挡在门外
async function readUserConfig(db, uid) {
  if (!uid) return null;
  try {
    const r = await db.collection(DB_USER_CFG).where({ user_id: uid }).limit(1).get();
    return (r.data && r.data[0]) || null;
  } catch (e) {
    return null;
  }
}

async function resolveProvider(db, uid) {
  // 1) 用户自己接的接口
  if (uid) {
    const cfg = await readUserConfig(db, uid);
    if (cfg && cfg.enabled !== false && cfg.api_key && cfg.base_url && cfg.model) {
      return {
        mode: 'self',
        base_url: cfg.base_url,
        model: cfg.model,
        api_key: cfg.api_key,
        daily_limit: SELF_DAILY
      };
    }
  }
  // 2) 作者默认：先读库（改配置不用重新部署），读不到再读环境变量
  let gd = {};
  try {
    const g = await db.collection(DB_GLOBAL_CFG).where({ _id: 'default' }).limit(1).get();
    gd = (g.data && g.data[0]) || {};
  } catch (e) {
    gd = {};
  }
  const key = str(process.env[ENV_KEY] || gd.api_key);
  if (!key) return null;
  const baseUrl = str(gd.base_url || process.env[ENV_BASE_URL] || '');
  const model = str(gd.model || process.env[ENV_MODEL] || '');
  if (!baseUrl || !model) {
    // 不猜：地址猜错等于把这一侧的 Key 发到别家去，模型名猜错只会让人以为是地址错
    return {
      mode: 'default',
      missing: !baseUrl ? 'base_url' : 'model',
      base_url: baseUrl,
      model: model,
      api_key: '',
      daily_limit: DEFAULT_DAILY
    };
  }
  return {
    mode: 'default',
    base_url: baseUrl,
    model: model,
    api_key: key,
    daily_limit: typeof gd.daily_limit === 'number' && gd.daily_limit > 0 ? gd.daily_limit : DEFAULT_DAILY
  };
}

async function readUsage(db, uid, day) {
  if (!uid) return 0;
  try {
    const r = await db.collection(DB_USAGE).where({ user_id: uid, day }).limit(1).get();
    const row = r.data && r.data[0];
    return row && typeof row.count === 'number' ? row.count : 0;
  } catch (e) {
    // 用量表还没建：当作 0，不因为统计不出来就把人挡在门外
    return 0;
  }
}

async function bumpUsage(db, uid, day) {
  if (!uid) return;
  const col = db.collection(DB_USAGE);
  try {
    const r = await col.where({ user_id: uid, day }).limit(1).get();
    const row = r.data && r.data[0];
    if (row) {
      await col.doc(row._id).update({ count: (row.count || 0) + 1, update_at: Date.now() });
    } else {
      await col.add({ user_id: uid, day, count: 1, create_at: Date.now(), update_at: Date.now() });
    }
  } catch (e) {
    // 写失败不影响这次回答，只是这一次不计入
  }
}

/* ------------------------------------------------------------------ *
 * 标签字典
 * ------------------------------------------------------------------ */

async function loadTagDict(db) {
  const r = await db
    .collection(DB_TAGS)
    .where({ active: true })
    .field({ _id: true, name: true, category: true, weight: true, sort: true })
    .limit(500)
    .get();
  const list = (r.data || []).filter((t) => t && t.name);
  list.sort((x, y) => (y.weight || 0) - (x.weight || 0));
  const byId = {};
  const byName = {};
  list.forEach((t) => {
    byId[t._id] = t;
    if (!byName[t.name]) byName[t.name] = t;
  });
  return { list, byId, byName };
}

// 塞进 prompt 的标签表：按类别分组，总量封顶，避免 prompt 太长既贵又容易跑偏
function tagPromptText(dict) {
  const groups = {};
  dict.list.forEach((t) => {
    const k = t.category || 'other';
    if (!groups[k]) groups[k] = [];
    if (groups[k].length < 18) groups[k].push(t.name);
  });
  const keys = CATEGORY_ORDER.concat(
    Object.keys(groups).filter((k) => CATEGORY_ORDER.indexOf(k) < 0)
  );
  const lines = [];
  let total = 0;
  keys.forEach((k) => {
    if (!groups[k] || !groups[k].length) return;
    if (total >= TAG_PROMPT_LIMIT) return;
    const take = groups[k].slice(0, TAG_PROMPT_LIMIT - total);
    total += take.length;
    lines.push((CATEGORY_LABEL[k] || k) + '：' + take.join('、'));
  });
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * A · 帮我写需求卡
 * ------------------------------------------------------------------ */

function guessType(text, tagNames, dict) {
  const s = str(text) + ' ' + (Array.isArray(tagNames) ? tagNames.join(' ') : '');
  for (let i = 0; i < TYPE_HINTS.length; i++) {
    const h = TYPE_HINTS[i];
    for (let j = 0; j < h.words.length; j++) {
      if (s.indexOf(h.words[j]) > -1) return h.key;
    }
  }
  return '';
}

function normalizeCard(j, dict, rawText) {
  const o = j || {};
  const rawTags = Array.isArray(o.tags) ? o.tags : [];
  const tagNames = rawTags.map((x) => clamp(x, 0, 12)).filter(Boolean);
  let type = str(o.type).trim();
  if (TYPES.indexOf(type) < 0) type = guessType(rawText, tagNames, dict);
  if (TYPES.indexOf(type) < 0) type = 'other';

  const tagIds = [];
  const names = [];
  tagNames.forEach((n) => {
    const t = dict.byName[n];
    if (t && tagIds.indexOf(t._id) < 0 && tagIds.length < 10) {
      tagIds.push(t._id);
      names.push(t.name);
    }
  });

  let title = clamp(o.title, 1, 30);
  if (!title) title = clamp(rawText, 1, 30);
  let description = clamp(o.description, 1, 200);
  if (!description) description = clamp(rawText, 1, 200);

  return {
    type: type,
    type_label: TYPES_CN[type] || '其他',
    title: title,
    description: description,
    tag_ids: tagIds,
    tag_names: names,
    // 模型给了但字典里没有的标签，回给前端说明“这几个没认”，而不是悄悄吞掉
    tags_unknown: tagNames.filter((n) => !dict.byName[n]).slice(0, 8),
    location: clamp(o.location, 0, 20),
    start_hint: clamp(o.start_hint, 0, 20)
  };
}

function cardSystemPrompt(dict) {
  return [
    '你是「同频」校园搭子 App 的需求卡写作助手。用户会用一句话说他想找什么样的搭子，你要把它写成一张可以直接发布的卡片。',
    '',
    '只输出一个 JSON 对象，不要解释，不要 markdown 代码块。字段：',
    '{"type":"","title":"","description":"","tags":[""],"location":"","start_hint":""}',
    '',
    '规则：',
    '1. type 只能取：study（学习）、fitness（健身）、photo（拍照）、meal（吃饭）、sport（运动）、other（其他）之一。',
    '2. title 不超过 30 个字。像大学生在群里说话，不要「招募」「诚邀」「寻找志同道合」这种公告腔。',
    '3. description 60~140 字，用第一人称，写清三件事：大概什么时候、想一起做什么、对搭子的一点小要求（比如「不鸽」「能安静两小时」）。',
    '4. tags 选 3~6 个，只能从下面的标签表里原样选，一个都不能自己造：',
    tagPromptText(dict),
    '5. start_hint 只在能看出时间时填（例：今晚 19:00、明天下午、这周末），看不出就填空字符串。',
    '6. location 只在用户提到地点时填（例：图书馆 3 楼），没提就填空字符串。',
    '7. 用户没说的信息不要编：不写具体门牌号、不写电话号码、不写「必须是女生」这类用户没说过的限制。'
  ].join('\n');
}

async function actionCard(db, provider, event, dict) {
  const text = clamp(event.text, 1, 500);
  const draft = event.draft && typeof event.draft === 'object' ? event.draft : null;
  if (!text && !draft) return fail(400, '先说一句你想找什么样的搭子');
  if (!_hasDict(dict)) return fail(500, '标签字典是空的，先跑一次 tag-seed');

  const userLines = [];
  if (text) userLines.push('用户原话：' + text);
  if (draft) {
    const dt = clamp(draft.title, 0, 60);
    const dd = clamp(draft.description, 0, 300);
    if (dt) userLines.push('已有标题：' + dt);
    if (dd) userLines.push('已有说明：' + dd);
    if (dt || dd) userLines.push('请在保留原意的前提下把它改写得更清楚，并把标签补齐。');
  }

  const res = await chat(
    provider,
    [
      { role: 'system', content: cardSystemPrompt(dict) },
      { role: 'user', content: userLines.join('\n') }
    ],
    { temperature: 0.5, max_tokens: 700 }
  );

  const j = extractJson(res.text);
  if (!j) return fail(502, '模型这次没按格式回答，再点一次生成');
  const card = normalizeCard(j, dict, text || (draft && draft.description) || '');
  if (!card.title) return fail(502, '模型这次没给出标题，再点一次生成');
  card.raw = clamp(res.text, 0, 400);
  card.meta = { model: res.model, latency_ms: res.latency_ms, usage: res.usage };
  return ok({ card });
}

function _hasDict(dict) {
  return !!(dict && dict.list && dict.list.length);
}

/* ------------------------------------------------------------------ *
 * B · 帮我找搭子
 * ------------------------------------------------------------------ */

function matchSystemPrompt(dict) {
  return [
    '你是「同频」校园搭子 App 的检索助手。用户会用一句话说他现在想找什么样的搭子，你要把它变成检索条件。',
    '只输出一个 JSON 对象，不要解释，不要 markdown：',
    '{"types":[],"tags":[],"keywords":[],"time":"","note":""}',
    '规则：',
    '1. types 从 study/fitness/photo/meal/sport/other 里选，最多 3 个，选不到就给空数组。',
    '2. tags 只能从下面的标签表里原样选，最多 6 个，选不到就给空数组：',
    tagPromptText(dict),
    '3. keywords 是能直接在别人的卡片标题/说明里搜到的短词，2~4 个字，给 2~6 个。不要给「搭子」「一起」这种满屏都是的词。',
    '4. time 是能看出的时间词（今晚、明早、周末、这周），看不出就空字符串。',
    '5. note 用一句不超过 20 字的话说明你怎么理解他的需求（例：想找个安静的人一起自习）。'
  ].join('\n');
}

async function loadTagIdsByCard(db, cardIds) {
  const map = {};
  if (!cardIds.length) return map;
  // 分批查：in 里的元素太多有的端会直接报错
  for (let i = 0; i < cardIds.length; i += 50) {
    const part = cardIds.slice(i, i + 50);
    const r = await db
      .collection(DB_CARD_TAGS)
      .where({ card_id: db.command.in(part) })
      .field({ card_id: true, tag_id: true })
      .limit(1000)
      .get();
    (r.data || []).forEach((row) => {
      if (!map[row.card_id]) map[row.card_id] = [];
      map[row.card_id].push(row.tag_id);
    });
  }
  return map;
}

function scoreCard(card, tagIds, keywords, types, tagIdsOfCard, now) {
  const hits = [];
  let score = 0;

  const mine = Array.isArray(tagIdsOfCard) ? tagIdsOfCard : [];
  const overlap = mine.filter((id) => tagIds.indexOf(id) > -1);
  if (overlap.length) {
    score += overlap.length * 4;
    hits.push({ kind: 'tag', ids: overlap });
  }

  const text = str(card.title) + ' ' + str(card.description);
  const kwHit = [];
  keywords.forEach((k) => {
    if (k.length >= 2 && text.indexOf(k) > -1 && kwHit.indexOf(k) < 0) {
      score += 3;
      kwHit.push(k);
    }
  });
  if (kwHit.length) {
    score += 1;
    hits.push({ kind: 'keyword', words: kwHit });
  }

  if (types.indexOf(card.type) > -1) score += 2;

  // 新鲜度只做小幅加成：一条很合适的旧卡不该被一条刚发的不相关卡片压过去
  const created = typeof card.created_at === 'number' ? card.created_at : 0;
  if (created) {
    const hours = (now - created) / 3600000;
    if (hours >= 0 && hours < 24) score += 1.5;
    else if (hours >= 24 && hours < 72) score += 0.5;
  }
  return { score, hits, kwHit, overlap };
}

function reasonText(item, tagNamesById) {
  const parts = [];
  if (item.overlap && item.overlap.length) {
    const names = item.overlap
      .map((id) => tagNamesById[id])
      .filter(Boolean)
      .slice(0, 3);
    if (names.length) parts.push('你们都选了「' + names.join('、') + '」');
  }
  if (item.kwHit && item.kwHit.length) {
    parts.push('TA 的说明里提到了「' + item.kwHit.slice(0, 2).join('、') + '」');
  }
  if (!parts.length) parts.push('类型对得上，时间也合适');
  return parts.join('；');
}

async function actionMatch(db, provider, event, dict) {
  const text = clamp(event.text, 1, 300);
  if (!text) return fail(400, '先说一句你想找什么样的搭子');

  const res = await chat(
    provider,
    [
      { role: 'system', content: matchSystemPrompt(dict) },
      { role: 'user', content: '用户原话：' + text }
    ],
    { temperature: 0.2, max_tokens: 400 }
  );
  const j = extractJson(res.text) || {};
  const types = (Array.isArray(j.types) ? j.types : []).filter((t) => TYPES.indexOf(t) > -1).slice(0, 3);
  const tagNames = (Array.isArray(j.tags) ? j.tags : []).map((x) => clamp(x, 0, 12)).filter(Boolean);
  const tagIds = [];
  const tagNamesById = {};
  tagNames.forEach((n) => {
    const t = dict.byName ? dict.byName[n] : null;
    if (t && tagIds.indexOf(t._id) < 0) {
      tagIds.push(t._id);
      tagNamesById[t._id] = t.name;
    }
  });
  const keywords = (Array.isArray(j.keywords) ? j.keywords : [])
    .map((x) => clamp(x, 2, 8))
    .filter(Boolean)
    .slice(0, 6);
  const note = clamp(j.note, 0, 24);
  const timeHint = clamp(j.time, 0, 12);

  // 召回：只取 open 的卡，按时间倒序扫一屏。真正的排序在内存里做，
  // 因为「共同标签数 + 关键词命中」这种打分没法用一次 where 表达。
  const r = await db
    .collection(DB_CARDS)
    .where({ status: 'open' })
    .field({
      _id: true,
      owner_id: true,
      type: true,
      title: true,
      description: true,
      location_name: true,
      start_time: true,
      created_at: true,
      school_id: true,
      city_code: true
    })
    .orderBy('created_at', 'desc')
    .limit(MATCH_SCAN)
    .get();
  let cards = (r.data || []).filter((c) => c && c._id);

  const uid = str(event._uid);
  if (uid) cards = cards.filter((c) => str(c.owner_id) !== uid);

  const tagMap = await loadTagIdsByCard(db, cards.map((c) => c._id));
  const now = Date.now();
  const scored = cards.map((c) => {
    const one = scoreCard(c, tagIds, keywords, types, tagMap[c._id], now);
    return { card: c, score: one.score, hits: one.hits, kwHit: one.kwHit, overlap: one.overlap };
  });

  const positive = scored.filter((x) => x.score > 0);
  positive.sort((a, b) => b.score - a.score);

  // 一条都没命中：别给一句「没找到」就完事，给最新几条并说明「没按条件挑，只是最近发的」
  let picked = positive.slice(0, MATCH_RETURN);
  let fallback = false;
  if (!picked.length) {
    fallback = true;
    picked = scored.slice(0, MATCH_RETURN);
  }

  const items = picked.map((x) => {
    const c = x.card;
    return {
      card_id: c._id,
      type: c.type,
      type_label: TYPES_CN[c.type] || '其他',
      title: c.title,
      description: clamp(c.description, 0, 80),
      location_name: c.location_name || '',
      start_time: c.start_time || null,
      created_at: c.created_at || null,
      score: Math.round(x.score * 10) / 10,
      reason: fallback ? '最近发的，条件上没完全对上' : reasonText(x, tagNamesById)
    };
  });

  return ok({
    items,
    fallback: fallback,
    intent: { types, tags: tagNames, keywords, time: timeHint, note: note },
    meta: { model: res.model, latency_ms: res.latency_ms, usage: res.usage, scanned: cards.length }
  });
}

/* ------------------------------------------------------------------ *
 * 配置 / 状态
 * ------------------------------------------------------------------ */

async function actionStatus(db, event) {
  const uid = str(event._uid);
  const provider = await resolveProvider(db, uid);
  const day = dayKey(Date.now());
  const used = await readUsage(db, uid, day);
  const usable = !!provider && !provider.missing;
  const data = {
    ready: usable,
    mode: provider ? provider.mode : 'none',
    model: provider ? provider.model : '',
    base_url: provider ? provider.base_url : '',
    missing: provider && provider.missing ? provider.missing : '',
    // 作者默认模型的 key 连尾号都不回，避免被拿来验证字典
    key_masked: provider && provider.mode === 'self' ? '' : '',
    today_count: used,
    daily_limit: provider ? provider.daily_limit : 0
  };
  if (provider && provider.mode === 'self' && uid) {
    const cfg = await readUserConfig(db, uid);
    data.key_masked = cfg ? maskKey(cfg.api_key) : '';
  }
  return ok(data);
}

async function actionConfigGet(db, event) {
  const uid = str(event._uid);
  if (!uid) return fail(401, '先登录再配置');
  const cfg = await readUserConfig(db, uid);
  const def = await resolveProvider(db, '');
  return ok({
    mode: cfg && cfg.api_key ? 'self' : 'default',
    base_url: cfg ? str(cfg.base_url) : '',
    model: cfg ? str(cfg.model) : '',
    key_masked: cfg ? maskKey(cfg.api_key) : '',
    has_key: !!(cfg && cfg.api_key),
    default: {
      available: !!def && !def.missing,
      model: def ? def.model : '',
      base_url: def ? str(def.base_url) : '',
      missing: def && def.missing ? def.missing : '',
      daily_limit: def ? def.daily_limit : 0
    }
  });
}

async function actionConfigSave(db, event) {
  const uid = str(event._uid);
  if (!uid) return fail(401, '先登录再配置');
  const baseUrl = clamp(event.base_url, 1, 200);
  const model = clamp(event.model, 1, 60);
  const key = str(event.api_key).trim();
  if (!baseUrl) return fail(400, '填一下接口地址，例：https://api.deepseek.com/v1');
  const bad = checkBaseUrl(baseUrl);
  if (bad) return fail(400, bad);
  if (!model) return fail(400, '填一下模型名，例：qwen-plus');
  if (!key) return fail(400, '填一下 API Key');
  if (key.length < 8) return fail(400, 'API Key 太短，检查是不是复制漏了');
  if (key.length > 300) return fail(400, 'API Key 太长，检查是不是粘错了');

  const col = db.collection(DB_USER_CFG);
  const now = Date.now();
  const row = await readUserConfig(db, uid);
  const doc = {
    user_id: uid,
    base_url: baseUrl,
    model: model,
    api_key: key,
    enabled: true,
    update_at: now
  };
  try {
    if (row) await col.doc(row._id).update(doc);
    else {
      doc.create_at = now;
      await col.add(doc);
    }
  } catch (e) {
    return fail(500, '保存失败：先在云数据库里建 ai_user_config 集合（见 docs/30 第五十一章）');
  }
  return ok({ mode: 'self', key_masked: maskKey(key), base_url: baseUrl, model: model });
}

async function actionConfigClear(db, event) {
  const uid = str(event._uid);
  if (!uid) return fail(401, '先登录再配置');
  const col = db.collection(DB_USER_CFG);
  const row = await readUserConfig(db, uid);
  if (row) {
    try {
      await col.doc(row._id).remove();
    } catch (e) {
      // 集合不在，等于本来就没配置
    }
  }
  return ok({ mode: 'default' });
}

async function actionConfigTest(db, event) {
  const uid = str(event._uid);
  const baseUrl = clamp(event.base_url, 0, 200);
  const model = clamp(event.model, 0, 60);
  const key = str(event.api_key).trim();

  let provider;
  if (baseUrl && model && key) {
    const bad = checkBaseUrl(baseUrl);
    if (bad) return fail(400, bad);
    provider = { mode: 'self', base_url: baseUrl, model: model, api_key: key };
  } else {
    provider = await resolveProvider(db, uid);
    if (!provider) return fail(501, '还没配置模型');
  }

  const res = await chat(
    provider,
    [
      { role: 'system', content: '你是一个连通性测试。只回复两个字母：OK' },
      { role: 'user', content: 'ping' }
    ],
    { temperature: 0, max_tokens: 8 }
  );
  return ok({
    ok: true,
    reply: clamp(res.text, 0, 40),
    model: res.model,
    latency_ms: res.latency_ms
  });
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

async function findUser(db, token) {
  const t = str(token).trim();
  if (!t) return null;
  try {
    const r = await db.collection(DB_USERS).where({ token: t }).limit(1).get();
    return (r.data && r.data[0]) || null;
  } catch (e) {
    return null;
  }
}

exports.main = async (event, context) => {
  const db = uniCloud.database();
  const e = event || {};
  const action = str(e.action || 'status');

  try {
    const me = await findUser(db, e.token);
    const uid = me ? str(me._id) : '';
    e._uid = uid;

    if (action === 'status') return await actionStatus(db, e);
    if (action === 'config-get') return await actionConfigGet(db, e);
    if (action === 'config-save') return await actionConfigSave(db, e);
    if (action === 'config-clear') return await actionConfigClear(db, e);
    if (action === 'config-test') return await actionConfigTest(db, e);

    if (action === 'card' || action === 'match') {
      if (!uid) return fail(401, '先登录再用智能助手');
      const provider = await resolveProvider(db, uid);
      if (!provider) {
        return fail(501, '还没有可用的模型：去「我的 · 智能助手」里填自己的接口，或让管理员配置默认模型');
      }
      if (provider.missing === 'base_url') {
        return fail(501, '默认模型缺接口地址：在控制台配 AI_BASE_URL，或在 ai_config 里写 base_url');
      }
      if (provider.missing === 'model') {
        return fail(501, '默认模型缺模型名：在控制台配 AI_MODEL，或在 ai_config 里写 model，例 qwen-plus');
      }
      const day = dayKey(Date.now());
      const used = await readUsage(db, uid, day);
      if (used >= provider.daily_limit) {
        return fail(
          429,
          (provider.mode === 'default' ? '默认模型今天 ' : '今天 ') +
            provider.daily_limit +
            ' 次用完了，明天再来，或在设置里填自己的接口'
        );
      }
      const dict = await loadTagDict(db);
      const out = action === 'card' ? await actionCard(db, provider, e, dict) : await actionMatch(db, provider, e, dict);
      // 只有真的走通了模型才计数：报错不计，否则用户被自己的重试耗光额度
      if (out && out.code === 0) await bumpUsage(db, uid, day);
      if (out && out.code === 0 && out.data) {
        out.data.quota = { used: used + 1, limit: provider.daily_limit, mode: provider.mode };
      }
      return out;
    }

    return fail(400, '不认识的 action：' + action);
  } catch (err) {
    const msg = str(err && err.message ? err.message : err);
    console.error('[ai-assistant]', action, msg);
    return fail(500, msg || '智能助手出错了');
  }
};