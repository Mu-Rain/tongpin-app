/* ==========================================================================
   同频 · HTML 原型交互
   - 屏幕切换（方向感知，平滑过渡 + 子元素逐个进场）
   - 底部标签栏 / 分段控件的黑色滑块滑动
   - 芯片筛选、抽屉、聊天发送、轻提示
   无构建、无依赖，直接双击 index.html 即可运行。
   ========================================================================== */

(function () {
  'use strict';

  /* ---------------------------------------------------------------- 数据 */

  var BUDDIES = [
    {
      id: 'b1',
      type: '学习',
      title: '今晚 7 点图书馆刷题搭子',
      desc: '目标：高数期末。想找能坐得住、不聊天的同学，一起到 22:00。',
      name: '陈亦航',
      avatar: '陈',
      school: '示例大学',
      distance: 0,
      verified: true,
      credit: 88,
      tags: ['考研', '早起', '安静型'],
      time: '今天 19:00',
      place: '三教 402',
      hit: 92
    },
    {
      id: 'b2',
      type: '健身',
      title: '晚上 8 点健身房练背',
      desc: '新手，想把动作练标准。有引体向上辅助带，可以一起练。',
      name: '苏航',
      avatar: '苏',
      school: '示例大学',
      distance: 0,
      verified: true,
      credit: 81,
      tags: ['健身新手', '夜猫', '增肌'],
      time: '今天 20:00',
      place: '西区健身房',
      hit: 84
    },
    {
      id: 'b3',
      type: '拍照',
      title: '周日下午拍银杏，找一个模特',
      desc: '我有相机和灯，想出片。地点在南门银杏道，拍 1 小时。',
      name: '周乐',
      avatar: '周',
      school: '示例大学',
      distance: 0,
      verified: false,
      credit: 74,
      tags: ['拍照', '周末', '社恐友好'],
      time: '周日 15:00',
      place: '南门银杏道',
      hit: 71
    },
    {
      id: 'b4',
      type: '吃饭',
      title: '食堂三楼拼饭搭子',
      desc: '一个人吃有点闷，想找饭友，聊专业和实习都行。',
      name: '吴一诺',
      avatar: '吴',
      school: '江城理工大学',
      distance: 1.2,
      verified: true,
      credit: 90,
      tags: ['探店', '话多', '夜宵'],
      time: '今天 12:10',
      place: '食堂三楼',
      hit: 66
    },
    {
      id: 'b5',
      type: '运动',
      title: '周末打羽毛球（业余水平）',
      desc: '场地已订，缺一人。水平一般，主要为了出汗。',
      name: '黄铭',
      avatar: '黄',
      school: '江城理工大学',
      distance: 3.5,
      verified: true,
      credit: 83,
      tags: ['羽毛球', '周末', '出汗党'],
      time: '周六 10:00',
      place: '体育馆 2 号场',
      hit: 58
    },
    {
      id: 'b6',
      type: '学习',
      title: '雅思口语对练，每天 30 分钟',
      desc: '目标 6.5，想找固定搭子，晚上线上对练。',
      name: '林可',
      avatar: '林',
      school: '南方师范大学',
      distance: 12,
      verified: true,
      credit: 95,
      tags: ['雅思', '早起', '线上'],
      time: '每天 21:00',
      place: '线上',
      hit: 63
    },
    {
      id: 'b7',
      type: '竞赛',
      title: '挑战杯组队，缺一个会做 PPT 的',
      desc: '已有 3 人（产品 / 代码 / 文档），想找一位做视觉和 PPT 的同学，本周内定人。',
      name: '沈川',
      avatar: '沈',
      school: '江城理工大学',
      distance: 0.8,
      verified: true,
      credit: 92,
      tags: ['挑战杯', 'PPT', '本周开干'],
      time: '今天 20:00',
      place: '图书馆研讨间',
      hit: 74
    },
    {
      id: 'b8',
      type: '竞赛',
      title: '数学建模找搭子（缺写作手）',
      desc: '两个工科生，建模和编程都能顶，缺一位写作 + 排版稳的同学，先线上碰一次。',
      name: '郑一凡',
      avatar: '郑',
      school: '南方师范大学',
      distance: 18,
      verified: false,
      credit: 78,
      tags: ['数学建模', '写作', '线上'],
      time: '周五前定人',
      place: '线上',
      hit: 69
    }
  ];

  /* 同频圈：占位内容流（同校 / 全国两栏，图文 / 视频 / 吐槽三种形态） */

  // 同频圈三栏：同校（本校）/ 地区（同城·周边）/ 发现（全国）
  var FEED = [
    {
      id: 'f1',
      range: '同校',
      kind: '图文',
      title: '图书馆五楼靠窗那排，今天光线绝了',
      text: '顺手拍了三张。谁在附近想一起自习可以说一声，我占两个位置。',
      user: '陈亦航 · 江城理工',
      tags: ['自习', '随手拍'],
      likes: 42
    },
    {
      id: 'f2',
      range: '同校',
      kind: '视频',
      title: '食堂三楼新窗口测评（43 秒）',
      text: '糖醋里脊偏甜，但 12 块的套餐是真能吃饱。',
      user: '吴一诺 · 江城理工',
      tags: ['探店', '干饭'],
      likes: 118
    },
    {
      id: 'f5',
      range: '同校',
      kind: '图文',
      title: '挑战杯组队进度 3/4',
      text: '还缺一位做视觉的，评论或私信都行。',
      user: '沈川 · 江城理工',
      tags: ['挑战杯', '组队'],
      likes: 27
    },
    {
      id: 'f7',
      range: '地区',
      kind: '图文',
      title: '江城三家自习咖啡店对比（含插座数量）',
      text: '一杯美式坐一下午，实测最安静的是江湾路那家。',
      user: '许知野 · 江城大学',
      tags: ['同城', '自习地图'],
      likes: 164
    },
    {
      id: 'f8',
      range: '地区',
      kind: '视频',
      title: '校门口夜市 20 块吃遍攻略',
      text: '七点后出摊最全，烤冷面那家排队但值。',
      user: '唐果 · 江城理工',
      tags: ['同城', '夜市'],
      likes: 271
    },
    {
      id: 'f9',
      range: '地区',
      kind: '吐槽',
      title: '周六去市图书馆，座位全靠抢',
      text: '八点半到就已经没空位了，同城的朋友有推荐吗。',
      user: '安禾 · 江城师范',
      tags: ['同城', '图书馆'],
      likes: 96
    },
    {
      id: 'f3',
      range: '发现',
      kind: '吐槽',
      title: '四六级报名又崩了，是不是只有我们学校这样',
      text: '刷了半小时才挤进去，报上就行，别的不敢要求。',
      user: '林可 · 南方师范',
      tags: ['吐槽', '四六级'],
      likes: 236
    },
    {
      id: 'f4',
      range: '发现',
      kind: '图文',
      title: '宿舍改造：60 块把这张桌子救回来了',
      text: '灯带 + 理线盒 + 一块洞洞板，前后对比都拍了。',
      user: '黄铭 · 江城理工',
      tags: ['宿舍', '改造'],
      likes: 305
    },
    {
      id: 'f6',
      range: '发现',
      kind: '视频',
      title: '操场夜跑 5 公里打卡（延时）',
      text: '坚持第 21 天，配速还是慢，但一天没停。',
      user: '郑一凡 · 南方师范',
      tags: ['夜跑', '打卡'],
      likes: 88
    }
  ];

  var CONVOS = [
    {
      id: 'c1',
      name: '陈亦航',
      avatar: '陈',
      last: '成，我带了两支黑笔，你不用买',
      time: '18:42',
      unread: 2,
      tag: '考研战友',
      color: 'shine-yellow',
      school: '示例大学'
    },
    {
      id: 'c2',
      name: '苏航',
      avatar: '苏',
      last: '你今天练腿还是背？',
      time: '17:05',
      unread: 1,
      tag: '增肌搭子',
      color: 'shine-orange',
      school: '示例大学'
    },
    {
      id: 'c3',
      name: '周乐',
      avatar: '周',
      last: '周日见，记得穿浅色衣服',
      time: '昨天',
      unread: 0,
      tag: '拍照搭子',
      color: 'shine-violet',
      school: '示例大学'
    }
  ];

  var CHAT = {
    c1: [
      { me: false, text: '同学你好，我看了你的需求，今晚我也去 402 刷高数 👍', time: '18:31' },
      { me: true, text: '好呀，我 18:40 到，帮你占靠墙的位置', time: '18:33' },
      { me: false, text: '成，我带了两支黑笔，你不用买', time: '18:42' }
    ],
    c2: [{ me: false, text: '你今天练腿还是背？', time: '17:05' }],
    c3: [{ me: false, text: '周日见，记得穿浅色衣服', time: '昨天' }],
    ai: [
      { me: false, text: '你好，我是同频的情绪引导助手。今天感觉怎么样？', time: '16:20' },
      { me: true, text: '有点焦虑，下周两门考试挤在一起', time: '16:22' },
      {
        me: false,
        text: '听起来你在为两门考试紧张。要不要先只挑一门、只定今晚一小时？把范围缩小的那一刻，焦虑通常会降一点。',
        time: '16:22'
      }
    ]
  };

  var TITLES = [
    { ico: '🪪', name: '已认证', rarity: 'common', cond: '学生认证通过', owned: true },
    { ico: '🤝', name: '首搭完成', rarity: 'common', cond: '完成第一次搭子', owned: true },
    { ico: '🔥', name: '连续 7 天', rarity: 'common', cond: '连续 7 天有互动', owned: true },
    { ico: '💪', name: '力量新手', rarity: 'rare', cond: '完成 10 次健身打卡', owned: false },
    { ico: '🌙', name: '深夜自习室', rarity: 'rare', cond: '连续 5 天 23 点后打卡', owned: false },
    { ico: '📚', name: '资料贡献者', rarity: 'rare', cond: '上传 3 份审核通过的资料', owned: false },
    { ico: '🍅', name: '番茄达人', rarity: 'rare', cond: '累计完成 25 个番茄', owned: false },
    { ico: '🏆', name: '十次靠谱', rarity: 'rare', cond: '完成 10 次搭子且无举报', owned: false },
    { ico: '🧭', name: '校园活地图', rarity: 'rare', cond: '同校频道发布 5 次卡片', owned: false },
    { ico: '⭐', name: '五星搭子', rarity: 'legend', cond: '被对方点赞 20 次', owned: false },
    { ico: '🛡️', name: '信誉守护者', rarity: 'legend', cond: '信誉分保持 95 以上满 30 天', owned: false },
    { ico: '🎓', name: '学长学姐', rarity: 'legend', cond: '帮助 10 位低年级同学', owned: false }
  ];

  var RARITY_TEXT = { common: '普通', rare: '稀有', legend: '传说' };

  /* -------------------------------------------------------- 搭子标签预设色
     全部是「带反光质感的闪亮色」：亮饱和底 + 一道白色高光斜扫（见 .tag--buddy）
     用户可从这 8 个里挑，也可给标签自定义文字。 */

  var TAG_COLORS = [
    { key: 'shine-yellow', name: '闪耀黄', hex: '#ffde00' },
    { key: 'shine-orange', name: '熔岩橙', hex: '#ff4d00' },
    { key: 'shine-rose', name: '荧光粉', hex: '#ff5fa2' },
    { key: 'shine-violet', name: '霓虹紫', hex: '#a855f7' },
    { key: 'shine-cyan', name: '电光青', hex: '#22d3ee' },
    { key: 'shine-mint', name: '薄荷绿', hex: '#34d399' },
    { key: 'shine-blue', name: '宝石蓝', hex: '#3b82f6' },
    { key: 'shine-gold', name: '香槟金', hex: '#e9c46a' }
  ];

  /* 我的搭子：每段关系 = 一个自定义标签 + 一个颜色 */
  var BUDDY_RELATIONS = [
    { id: 'r1', name: '陈亦航', avatar: '陈', label: '考研战友', color: 'shine-yellow', note: '每天 19:00 图书馆，一起到 22:00', days: 12 },
    { id: 'r2', name: '苏航', avatar: '苏', label: '增肌搭子', color: 'shine-orange', note: '周一三五练背 / 腿，互相补动作', days: 8 },
    { id: 'r3', name: '周乐', avatar: '周', label: '拍照搭子', color: 'shine-violet', note: '周末出片，还没定固定时间', days: 3 }
  ];

  /* 标签框里的推荐词：点一下就填进去，也能自己打 */
  var TAG_SUGGESTIONS = ['考研战友', '增肌搭子', '自习搭子', '拍照搭子', '饭搭子', '竞赛队友', '夜跑搭子', '雅思同桌'];

  /* ------------------------------------------------------------ 屏幕元信息 */

  var SCREENS = {
    login: { title: '登录', tabbar: false, topbar: false, fab: false },
    home: { title: '首页', tab: 'home', tabbar: true, topbar: true, fab: false },
    hall: { title: '搭子大厅', parent: 'home', tab: 'home', tabbar: false, topbar: true, fab: false },
    feed: { title: '同频圈', tab: 'feed', tabbar: true, topbar: true, fab: false },
    detail: { title: '需求详情', parent: 'hall', tab: 'home', tabbar: false, topbar: true, fab: false },
    match: { title: '匹配结果', parent: 'hall', tab: 'home', tabbar: false, topbar: true, fab: false },
    messages: { title: '消息', tab: 'messages', tabbar: true, topbar: true, fab: false },
    chat: { title: '聊天', parent: 'messages', tab: 'messages', tabbar: false, topbar: true, fab: false },
    me: { title: '我的', tab: 'me', tabbar: true, topbar: true, fab: false },
    verify: { title: '学生认证', parent: 'me', tab: 'me', tabbar: false, topbar: true, fab: false },
    titles: { title: '称号库', parent: 'me', tab: 'me', tabbar: false, topbar: true, fab: false },
    fitness: { title: '健身与打卡', parent: 'home', tab: 'home', tabbar: false, topbar: true, fab: false },
    study: { title: '学习 & 番茄钟', parent: 'home', tab: 'home', tabbar: false, topbar: true, fab: false },
    post: { title: '发一条日常', parent: 'feed', tab: 'feed', tabbar: false, topbar: true, fab: false },
    buddy: { title: '我的搭子', parent: 'messages', tab: 'messages', tabbar: false, topbar: true, fab: false }
  };

  // 一级页顺序（不包含中间的「＋」，它不是页面）
  var TAB_ORDER = ['home', 'feed', 'messages', 'me'];

  // 底栏是 5 列，中间第 2 列（下标 2）被凸起的「＋」占掉，所以滑动块的落点要单独映射
  var TAB_SLOT = { home: 0, feed: 1, messages: 3, me: 4 };

  var current = null;
  var currentConvo = 'c1';

  /* ---------------------------------------------------------------- 元素 */

  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var phone = $('#phone');
  var screens = $$('.screen');
  var topbar = $('#topbar');
  var topbarTitle = $('#topbarTitle');
  var backBtn = $('#backBtn');
  var tabbar = $('#tabbar');
  var tabIndicator = $('#tabIndicator');
  var scrim = $('#scrim');
  var tabs = $$('.tab');            // 只含 4 个真 tab（不含中间的「＋」，它的类是 .tab-plus）
  var tabPlus = $('#tabPlus');

  /* ---------------------------------------------------------------- 轻提示 */

  var toastEl = document.createElement('div');
  toastEl.className = 'toast';
  phone.appendChild(toastEl);
  var toastTimer = null;

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-on');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-on');
    }, 1800);
  }

  /* -------------------------------------------------------------- 渲染列表 */

  function escapeText(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  /** 从调色板取颜色；找不到就给黄 */
  function tagColorHex(key) {
    var c = TAG_COLORS.filter(function (x) {
      return x.key === key;
    })[0];
    return c ? c.hex : TAG_COLORS[0].hex;
  }

  /** 闪亮自定义标签：底色由内联 background-color 给，反光高光由 .tag--buddy 的 background-image 叠在上面 */
  function shinyTag(label, colorKey) {
    return (
      '<span class="tag tag--buddy" style="background-color:' + tagColorHex(colorKey) + '">' +
      escapeText(label) + '</span>'
    );
  }

  function buddyCard(b, showHit) {
    var hit = showHit
      ? '<span class="hit">重合度 ' + b.hit + '%</span>'
      : '';
    var verify = b.verified
      ? '<span class="badge badge--yellow mono">已认证</span>'
      : '<span class="badge mono">未认证</span>';
    var tags = b.tags
      .map(function (t) {
        return '<span class="tag">' + escapeText(t) + '</span>';
      })
      .join('');
    return (
      '<article class="card" data-open="' + b.id + '">' +
      '<div class="card-top">' +
      '<div class="avatar">' + escapeText(b.avatar) + '</div>' +
      '<div class="card-title">' + escapeText(b.title) + '</div>' +
      hit +
      '</div>' +
      '<p class="card-desc">' + escapeText(b.desc) + '</p>' +
      '<div class="card-meta">' + verify + tags +
      '<span class="tag tag--fill">' + escapeText(b.type) + '</span>' +
      '</div>' +
      '<div class="card-meta">' +
      '<span class="mono">' + escapeText(b.time) + ' · ' + escapeText(b.place) + '</span>' +
      '<span class="mono muted">' + escapeText(b.name) + ' · ' + escapeText(b.school) +
      ' · 信誉 ' + b.credit + '</span>' +
      '</div>' +
      '</article>'
    );
  }

  function renderHall() {
    var type = state.type;
    var range = state.range;
    var list = BUDDIES.filter(function (b) {
      var typeOk = type === '全部' || b.type === type;
      var rangeOk =
        range === '同校' ? b.distance === 0 : range === '附近' ? b.distance <= 5 : true;
      return typeOk && rangeOk;
    });

    var host = $('#hallList');
    if (list.length === 0) {
      host.innerHTML =
        '<div class="block-black"><span class="mono">NO RESULT</span>' +
        '<strong>这个筛选下还没有需求</strong>' +
        '<span class="mono">试试换类型，或用「一键匹配」放宽标签</span></div>';
    } else {
      host.innerHTML = list
        .map(function (b, i) {
          return buddyCard(b, false).replace(
            'class="card"',
            'class="card stagger" style="--i:' + i + '"'
          );
        })
        .join('');
    }
    $('#hallCount').textContent = list.length + ' 条需求';

    var notice = $('#rangeNotice');
    var text =
      range === '同校'
        ? '同校频道需要学生认证，你已认证'
        : range === '附近'
        ? '附近 5 公里内，共 ' + list.length + ' 条'
        : '全城范围，注意约在公共场所';
    notice.querySelector('span:last-child').textContent = text;
  }

  function renderHomeBuddies() {
    $('#homeBuddies').innerHTML = CONVOS.slice(0, 3)
      .map(function (c, i) {
        return (
          '<article class="card stagger" style="--i:' + i + '" data-go="chat" data-convo="' + c.id + '">' +
          '<div class="card-top">' +
          '<div class="avatar">' + escapeText(c.avatar) + '</div>' +
          '<div class="card-title">' + escapeText(c.name) + '</div>' +
          shinyTag(c.tag, c.color) +
          '</div>' +
          '<p class="card-desc">' + escapeText(c.last) + '</p>' +
          '</article>'
        );
      })
      .join('');
  }

  /* ------------------------------------------- 我的搭子：自定义标签编辑器 */

  var draftLabel = '';
  var draftColor = TAG_COLORS[0].key;

  function renderBuddy() {
    var host = $('#buddyList');
    if (!host) return;

    host.innerHTML = BUDDY_RELATIONS.map(function (r, i) {
      return (
        '<div class="card stagger" style="--i:' + i + ';cursor:default">' +
        '<div class="card-top">' +
        '<div class="avatar">' + escapeText(r.avatar) + '</div>' +
        '<div class="card-title">' + escapeText(r.name) + '</div>' +
        '<span class="mono muted">第 ' + r.days + ' 天</span>' +
        '</div>' +
        '<div class="tag-preview">' +
        '<span class="buddy-tag--big" style="background-color:' + tagColorHex(r.color) + '">' +
        escapeText(r.label) + '</span>' +
        '<button class="btn btn--sm" data-tag-edit="' + r.id + '">改标签</button>' +
        '</div>' +
        '<p class="card-desc">' + escapeText(r.note) + '</p>' +
        '</div>'
      );
    }).join('');

    var prev = $('#tagPreview');
    if (prev) {
      prev.innerHTML =
        '<span class="buddy-tag--big" style="background-color:' + tagColorHex(draftColor) + '">' +
        escapeText(draftLabel || '（还没填标签）') +
        '</span>';
    }

    $$('#tagSwatches .color-dot').forEach(function (d) {
      d.classList.toggle('is-on', d.getAttribute('data-color') === draftColor);
    });
  }

  function renderTagPalette() {
    var box = $('#tagSwatches');
    if (!box) return;
    box.innerHTML = TAG_COLORS.map(function (c) {
      return (
        '<button class="color-dot" data-color="' + c.key + '" title="' + c.name + '" ' +
        'style="background-color:' + c.hex + '"></button>'
      );
    }).join('');
  }

  function renderTagSuggest() {
    var box = $('#tagSuggest');
    if (!box) return;
    box.innerHTML = TAG_SUGGESTIONS.map(function (s) {
      return '<button class="chip chip--mini" data-tag-suggest="' + s + '">' + s + '</button>';
    }).join('');
  }

  function renderConvos() {
    $('#convoList').innerHTML = CONVOS.map(function (c, i) {
      var unread = c.unread ? '<span class="unread">' + c.unread + '</span>' : '';
      return (
        '<article class="convo stagger" style="--i:' + (i + 1) + '" data-go="chat" data-convo="' + c.id + '">' +
        '<div class="avatar">' + escapeText(c.avatar) + '</div>' +
        '<div class="convo-main">' +
        '<div class="convo-top">' +
        '<span class="convo-name">' + escapeText(c.name) + '</span>' +
        '<span class="mono muted">' + escapeText(c.time) + '</span>' +
        '</div>' +
        '<div class="convo-last">' + escapeText(c.last) + '</div>' +
        '<div class="card-meta" style="border:0;padding:4px 0 0">' +
        shinyTag(c.tag, c.color) +
        '<span class="tag">' + escapeText(c.school) + '</span>' +
        '</div>' +
        '</div>' + unread +
        '</article>'
      );
    }).join('');
  }

  function renderMatch() {
    var list = BUDDIES.slice().sort(function (a, b) {
      return b.hit - a.hit;
    }).slice(0, 4);
    $('#matchList').innerHTML = list
      .map(function (b, i) {
        return buddyCard(b, true).replace(
          'class="card"',
          'class="card stagger" style="--i:' + i + '"'
        );
      })
      .join('');
  }

  function renderTitles() {
    var wall = $('#titleWall');
    if (wall) {
      wall.innerHTML = TITLES.map(function (t) {
        return (
          '<div class="title-cell ' + (t.owned ? 'is-owned' : 'is-locked') + '">' +
          '<span class="t-ico">' + t.ico + '</span>' +
          '<span>' + escapeText(t.name) + '</span>' +
          '<span class="mono muted">' + (t.owned ? '已获得' : '未解锁') + '</span>' +
          '</div>'
        );
      }).join('');
    }

    var grid = $('#titleLibrary');
    if (grid) {
      grid.innerHTML = TITLES.map(function (t) {
        return (
          '<div class="title-cell ' + (t.owned ? 'is-owned' : 'is-locked') + '">' +
          '<span class="t-ico">' + t.ico + '</span>' +
          '<span>' + escapeText(t.name) + '</span>' +
          '<span class="rarity rarity--' + t.rarity + '">' + RARITY_TEXT[t.rarity] + '</span>' +
          '<span class="mono muted title-cond">' + escapeText(t.cond) + '</span>' +
          '</div>'
        );
      }).join('');
    }
  }

  function renderDetail(id) {
    var b = BUDDIES.filter(function (x) {
      return x.id === id;
    })[0] || BUDDIES[0];
    var tags = b.tags
      .map(function (t) {
        return '<span class="tag">' + escapeText(t) + '</span>';
      })
      .join('');
    $('#detailBody').innerHTML =
      '<div class="detail-head stagger" style="--i:0">' +
      '<div class="detail-title">' + escapeText(b.title) + '</div>' +
      '<p class="card-desc" style="color:#d8d8d8">' + escapeText(b.desc) + '</p>' +
      '</div>' +
      '<div class="detail-grid stagger" style="--i:1">' +
      '<div class="detail-cell"><span class="k">发布者</span><span class="v">' + escapeText(b.name) + '</span></div>' +
      '<div class="detail-cell"><span class="k">认证</span><span class="v">' + (b.verified ? '已认证' : '未认证') + '</span></div>' +
      '<div class="detail-cell"><span class="k">学校</span><span class="v">' + escapeText(b.school) + '</span></div>' +
      '<div class="detail-cell"><span class="k">信誉分</span><span class="v">' + b.credit + '</span></div>' +
      '<div class="detail-cell"><span class="k">时间</span><span class="v">' + escapeText(b.time) + '</span></div>' +
      '<div class="detail-cell"><span class="k">地点</span><span class="v">' + escapeText(b.place) + '</span></div>' +
      '</div>' +
      '<div class="card stagger" style="--i:2;cursor:default">' +
      '<div class="card-top"><span class="card-title">标签重合</span><span class="hit">' + b.hit + '%</span></div>' +
      '<div class="card-meta" style="border:0;padding-top:0">' + tags + '</div>' +
      '</div>' +
      '<button class="btn btn--orange btn--block stagger" style="--i:3" data-toast="已发出申请，对方同意后建立搭子关系">我想搭 →</button>' +
      '<button class="btn btn--block stagger" style="--i:4" data-toast="已提交举报，后台会在 24 小时内处理">举报这张卡片</button>';
  }

  function renderChat() {
    var isAi = currentConvo === 'ai';
    var convo = CONVOS.filter(function (c) {
      return c.id === currentConvo;
    })[0];

    var bar = $('#chatBar');
    if (isAi) {
      bar.innerHTML =
        '<div class="avatar avatar--orange">AI</div>' +
        '<div><div class="convo-name">情绪引导机器人</div>' +
        '<span class="mono muted">非医疗建议 · 紧急情况请联系校心理中心</span></div>';
    } else {
      bar.innerHTML =
        '<div class="avatar">' + escapeText(convo.avatar) + '</div>' +
        '<div><div class="convo-name">' + escapeText(convo.name) + '</div>' +
        '<span class="mono muted">' + escapeText(convo.school) + '</span></div>' +
        '<span class="chat-buddy-tag" style="background-color:' + tagColorHex(convo.color) + '">' +
        escapeText(convo.tag) + '</span>';
    }

    var msgs = CHAT[currentConvo] || [];
    $('#chatScroll').innerHTML = msgs
      .map(function (m) {
        return (
          '<div class="bubble-row ' + (m.me ? 'is-me' : '') + '">' +
          '<div class="bubble">' + escapeText(m.text) + '</div>' +
          '<span class="bubble-time">' + escapeText(m.time) + '</span>' +
          '</div>'
        );
      })
      .join('');
    scrollChatToEnd();
  }

  function scrollChatToEnd() {
    var box = $('#chatScroll');
    box.scrollTop = box.scrollHeight;
  }

  /* ------------------------------------------------------------------ 状态 */

  var state = { type: '全部', range: '同校' };

  /* -------------------------------------------------------------- 屏幕切换 */

  function activeScreen() {
    return $('.screen.is-active');
  }

  function go(id, dir) {
    if (!SCREENS[id] || (current === id && dir !== 'back')) return;
    var meta = SCREENS[id];
    var next = $('.screen[data-screen="' + id + '"]');
    var prev = activeScreen();
    var back = dir === 'back';

    // 方向决定进出场位移，保证"返回"是反向的
    next.style.setProperty('--enter-x', back ? '-28px' : '28px');
    if (prev) prev.style.setProperty('--leave-x', back ? '20px' : '-20px');

    if (prev && prev !== next) {
      prev.classList.remove('is-active');
      prev.classList.add('is-leaving');
      setTimeout(function () {
        prev.classList.remove('is-leaving');
      }, 340);
    }

    // 移除再强制重排再加，视觉上让入场与子元素逐个进场重新播放
    next.classList.remove('is-active');
    void next.offsetWidth;
    next.classList.add('is-active');
    next.scrollTop = 0;

    current = id;
    // file:// 下部分浏览器禁止 replaceState，忽略即可（原型不依赖它）
    try {
      if (history.replaceState) history.replaceState(null, '', '#/' + id);
    } catch (err) {}

    // 顶部直达按钮：当前屏反色高亮
    $$('.jump').forEach(function (j) {
      j.classList.toggle('is-on', j.getAttribute('data-go') === id);
    });

    // 顶栏 / 底栏 / 悬浮按钮
    if (meta.topbar === false) {
      topbar.classList.add('is-hidden');
    } else {
      topbar.classList.remove('is-hidden');
      topbarTitle.textContent = meta.title;
      backBtn.classList.toggle('is-hidden', !meta.parent);
    }

    tabbar.classList.toggle('is-hidden', !meta.tabbar);

    if (meta.tab) {
      var slot = TAB_SLOT[meta.tab];
      if (typeof slot === 'number') {
        tabIndicator.style.transform = 'translateX(' + slot * 100 + '%)';
      }
      // 高亮只看 4 个真 tab，别把中间的「＋」点亮
      tabs.forEach(function (t) {
        t.classList.toggle('is-on', t.getAttribute('data-tab-go') === meta.tab);
      });
    }

    if (id === 'hall') renderHall();
    if (id === 'feed') {
      syncFeedControls();
      renderFeed();
    }
    if (id === 'match') renderMatch();
    if (id === 'titles') renderTitles();
    if (id === 'fitness') renderFitness();
    if (id === 'study') renderStudy();
    if (id === 'buddy') renderBuddy();
  }

  /* -------------------------------------------------------------- 事件绑定 */

  document.addEventListener('click', function (e) {
    var target = e.target;
    if (!target || !target.closest) return;
    var el = target.closest(
      '[data-go], [data-sheet], [data-sheet-close], [data-toast], [data-tab-go], [data-open], [data-view], ' +
      '[data-tag-suggest], [data-tag-edit], [data-color]'
    );
    if (!el) return;

    // 视图切换：可点击原型 / 效果图总览
    if (el.hasAttribute('data-view')) {
      setView(el.getAttribute('data-view'));
      return;
    }

    // 标签推荐词：点一下填进标签框
    if (el.hasAttribute('data-tag-suggest')) {
      draftLabel = el.getAttribute('data-tag-suggest');
      var f = $('#tagField');
      if (f) f.value = draftLabel;
      renderBuddy();
      return;
    }

    // 预设闪亮颜色
    if (el.hasAttribute('data-color')) {
      draftColor = el.getAttribute('data-color');
      renderBuddy();
      return;
    }

    // 改某段搭子关系的标签
    if (el.hasAttribute('data-tag-edit')) {
      var rid = el.getAttribute('data-tag-edit');
      var rel = BUDDY_RELATIONS.filter(function (r) {
        return r.id === rid;
      })[0];
      if (rel) {
        draftLabel = rel.label;
        draftColor = rel.color;
        var field = $('#tagField');
        if (field) field.value = rel.label;
        renderBuddy();
        toast('已载入「' + rel.name + '」的标签，改完点保存');
        var ed = $('#tagEditor');
        if (ed && ed.scrollIntoView) ed.scrollIntoView({ block: 'center' });
      }
      return;
    }

    // 抽屉关闭
    if (el.hasAttribute('data-sheet-close')) {
      closeSheet();
      if (el.hasAttribute('data-toast') && el.getAttribute('data-toast')) {
        toast(el.getAttribute('data-toast'));
      }
      return;
    }

    // 打开抽屉
    if (el.hasAttribute('data-sheet')) {
      openSheet(el.getAttribute('data-sheet'));
      return;
    }

    // 底部标签
    if (el.hasAttribute('data-tab-go')) {
      go(el.getAttribute('data-tab-go'));
      return;
    }

    // 打开卡片详情
    if (el.hasAttribute('data-open')) {
      renderDetail(el.getAttribute('data-open'));
      go('detail');
      return;
    }

    // 跳转
    if (el.hasAttribute('data-go')) {
      var target = el.getAttribute('data-go');
      // 在「效果图总览」里点缩略图：先切回可点击原型，再进那一屏
      if (document.body.classList.contains('view-gallery')) setView('proto');
      if (target === 'chat') {
        currentConvo = el.getAttribute('data-convo') || 'c1';
        renderChat();
      }
      if (target === 'hall' && el.hasAttribute('data-filter')) {
        state.type = { study: '学习', fitness: '健身', photo: '拍照' }[el.getAttribute('data-filter')] || '全部';
        state.range = '同校';
        syncHallControls();
      }
      go(target);
      return;
    }

    // 只弹提示
    if (el.hasAttribute('data-toast')) {
      var msg = el.getAttribute('data-toast');
      if (msg) toast(msg);
      return;
    }
  });

  // 登录按钮：先提示，再进入首页
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest('.screen[data-screen="login"] .btn--orange');
    if (!btn) return;
    setTimeout(function () {
      go('home');
    }, 260);
  });

  backBtn.addEventListener('click', function () {
    var meta = SCREENS[current];
    if (meta && meta.parent) go(meta.parent, 'back');
  });

  // 中间的「＋」= 发同频圈内容（走的是 data-go="post"，已被委派点击处理）
  if (tabPlus) {
    tabPlus.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go('post');
      }
    });
  }

  scrim.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSheet();
  });

  // 芯片筛选
  $$('#typeChips .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $$('#typeChips .chip').forEach(function (c) {
        c.classList.remove('is-on');
      });
      chip.classList.add('is-on');
      state.type = chip.getAttribute('data-type');
      renderHall();
    });
  });

  // 范围分段控件
  var segThumb = $('#segThumb');
  $$('#rangeSeg .seg').forEach(function (seg, i) {
    seg.addEventListener('click', function () {
      $$('#rangeSeg .seg').forEach(function (s) {
        s.classList.remove('is-on');
      });
      seg.classList.add('is-on');
      segThumb.style.transform = 'translateX(' + i * 100 + '%)';
      state.range = seg.getAttribute('data-range');
      renderHall();
    });
  });

  // 同频圈：同校 / 全国
  $$('#feedSeg .seg').forEach(function (seg) {
    seg.addEventListener('click', function () {
      feedState.range = seg.getAttribute('data-feed');
      syncFeedControls();
      renderFeed();
    });
  });

  // 同频圈：图文 / 视频 / 吐槽
  $$('#postChips .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      feedState.kind = chip.getAttribute('data-post');
      syncFeedControls();
      renderFeed();
    });
  });

  // 发布类型芯片
  $$('#publishChips .chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $$('#publishChips .chip').forEach(function (c) {
        c.classList.remove('is-on');
      });
      chip.classList.add('is-on');
    });
  });

  // 聊天发送
  function sendChat() {
    var field = $('#chatField');
    var text = field.value.trim();
    if (!text) {
      toast('说点什么再发');
      return;
    }
    CHAT[currentConvo].push({ me: true, text: text, time: nowTime() });
    field.value = '';
    renderChat();

    // 原型演示：对方自动回一句
    setTimeout(function () {
      var isAi = currentConvo === 'ai';
      var reply = isAi
        ? '我听到了。要不要把它拆成今晚能做的一件小事？做完就算赢。（非医疗建议）'
        : '收到，我看看时间再回你 👍';
      CHAT[currentConvo].push({ me: false, text: reply, time: nowTime() });
      renderChat();
    }, 900);
  }

  $('#chatSend').addEventListener('click', sendChat);
  $('#chatField').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendChat();
  });

  function nowTime() {
    var d = new Date();
    return (
      ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
    );
  }

  function syncHallControls() {
    $$('#typeChips .chip').forEach(function (c) {
      c.classList.toggle('is-on', c.getAttribute('data-type') === state.type);
    });
    var idx = $$('#rangeSeg .seg').findIndex
      ? $$('#rangeSeg .seg').findIndex(function (s) {
          return s.getAttribute('data-range') === state.range;
        })
      : 0;
    segThumb.style.transform = 'translateX(' + Math.max(idx, 0) * 100 + '%)';
    $$('#rangeSeg .seg').forEach(function (s) {
      s.classList.toggle('is-on', s.getAttribute('data-range') === state.range);
    });
  }

  /* -------------------------------------------------------------- 同频圈 */

  var feedState = { range: '同校', kind: '全部' };

  function renderFeed() {
    var list = $('#feedList');
    if (!list) return;
    var items = FEED.filter(function (p) {
      return p.range === feedState.range && (feedState.kind === '全部' || p.kind === feedState.kind);
    });
    if (!items.length) {
      list.innerHTML =
        '<div class="placeholder-note">这一栏还没有内容。同频圈现在只有占位数据，真实内容排在后续迭代。</div>';
      return;
    }
    list.innerHTML = items
      .map(function (p) {
        var mediaCls =
          p.kind === '视频'
            ? 'post-media post-media--video'
            : p.kind === '吐槽'
            ? 'post-media post-media--text'
            : 'post-media';
        var mediaTxt = p.kind === '视频' ? '▶ 视频占位' : p.kind === '图文' ? '［图片占位］' : '［纯文字］';
        return (
          '<article class="post-card">' +
          '<div class="' + mediaCls + '">' + mediaTxt + '</div>' +
          '<div class="post-body">' +
          '<span class="post-title">' + p.title + '</span>' +
          '<span class="post-text">' + p.text + '</span>' +
          '</div>' +
          '<div class="post-foot">' +
          '<span class="post-user">' + p.user + ' · ' + p.kind + ' · ' + p.likes + ' 赞</span>' +
          '<span class="post-tags">' +
          p.tags
            .map(function (t) {
              return '<em class="post-tag">' + t + '</em>';
            })
            .join('') +
          '</span>' +
          '</div>' +
          '</article>'
        );
      })
      .join('');
  }

  function syncFeedControls() {
    $$('#postChips .chip').forEach(function (c) {
      c.classList.toggle('is-on', c.getAttribute('data-post') === feedState.kind);
    });
    var idx = 0;
    $$('#feedSeg .seg').forEach(function (s, i) {
      var on = s.getAttribute('data-feed') === feedState.range;
      s.classList.toggle('is-on', on);
      if (on) idx = i;
    });
    var thumb = $('#feedThumb');
    if (thumb) thumb.style.transform = 'translateX(' + idx * 100 + '%)';
  }

  /* ------------------------------------------------------------------ 抽屉 */

  function openSheet(id) {
    var sheet = $('.sheet[data-sheet-id="' + id + '"]');
    if (!sheet) return;
    scrim.classList.add('is-on');
    sheet.classList.add('is-on');
    // 抽屉打开时让底栏与悬浮按钮整体让位（避免穿模）
    document.body.classList.add('sheet-open');
  }

  function closeSheet() {
    scrim.classList.remove('is-on');
    $$('.sheet').forEach(function (s) {
      s.classList.remove('is-on');
    });
    document.body.classList.remove('sheet-open');
  }

  /* ------------------------------------------------------------ 健身打卡 */

  var WEEK = ['一', '二', '三', '四', '五', '六', '日'];
  var weekState = [true, false, true, true, false, false, false];
  var todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;

  var FITNESS_PLANS = [
    { name: '推 · 胸肩三头', gear: '自由重量', time: '45 分钟', moves: '卧推 4×8 · 肩上推举 3×10 · 绳索下压 3×12' },
    { name: '拉 · 背二头', gear: '固定器械', time: '50 分钟', moves: '高位下拉 4×10 · 坐姿划船 3×10 · 弯举 3×12' },
    { name: '腿 · 下肢', gear: '自由重量', time: '55 分钟', moves: '深蹲 4×6 · 罗马尼亚硬拉 3×8 · 提踵 4×15' },
    { name: '有氧 + 拉伸', gear: '有氧', time: '30 分钟', moves: '慢跑 20 分钟 · 全身拉伸 10 分钟' }
  ];

  function renderFitness() {
    var dots = $('#weekDots');
    if (dots) {
      dots.innerHTML = WEEK.map(function (d, i) {
        return (
          '<button class="day-dot' + (weekState[i] ? ' is-on' : '') + (i === todayIdx ? ' is-today' : '') +
          '" data-day="' + i + '"><span>' + d + '</span><span>' + (weekState[i] ? '✓' : '·') + '</span></button>'
        );
      }).join('');
    }

    var count = $('#weekCount');
    if (count) count.textContent = weekState.filter(Boolean).length + ' / 7';

    var plans = $('#fitnessPlans');
    if (plans) {
      plans.innerHTML = FITNESS_PLANS.map(function (p, i) {
        return (
          '<div class="plan-card stagger" style="--i:' + i + '" data-toast="' +
          escapeText(p.name) + ' · 可自定义组数与休息时间">' +
          '<div class="row-between"><strong>' + escapeText(p.name) + '</strong>' +
          '<span class="mono">' + escapeText(p.time) + '</span></div>' +
          '<span class="mono muted">' + escapeText(p.gear) + ' · ' + escapeText(p.moves) + '</span>' +
          '</div>'
        );
      }).join('');
    }
  }

  var weekBox = $('#weekDots');
  if (weekBox) {
    weekBox.addEventListener('click', function (e) {
      var dot = e.target && e.target.closest ? e.target.closest('.day-dot') : null;
      if (!dot) return;
      var i = parseInt(dot.getAttribute('data-day'), 10);
      weekState[i] = !weekState[i];
      renderFitness();
      if (weekState[i]) toast('已打卡 · 周' + WEEK[i] + ' +1 学习积分');
    });
  }

  /* ---------------------------------------------------------- 学习 / 番茄钟 */

  var STUDY_BUDDIES = [
    { name: '图书馆四楼常驻', tags: ['期末复习', '安静', '22:00 前'], hit: 82 },
    { name: '高数互助小组', tags: ['高数', '讲题', '每周二'], hit: 74 },
    { name: '六级单词搭子', tags: ['英语六级', '背单词', '打卡'], hit: 68 }
  ];

  function renderStudy() {
    var box = $('#studyBuddies');
    if (!box) return;
    box.innerHTML = STUDY_BUDDIES.map(function (b, i) {
      return (
        '<div class="plan-card stagger" style="--i:' + i + '" data-toast="已发出申请：' + escapeText(b.name) + '">' +
        '<div class="row-between"><strong>' + escapeText(b.name) + '</strong>' +
        '<span class="hit">' + b.hit + '%</span></div>' +
        '<div class="chips stagger" style="--i:' + i + ';margin:0;padding:0;border:0">' +
        b.tags
          .map(function (t) {
            return '<span class="tag">' + escapeText(t) + '</span>';
          })
          .join('') +
        '</div>' +
        '</div>'
      );
    }).join('');
  }

  var POMO_TOTAL = 25 * 60;
  var pomoLeft = POMO_TOTAL;
  var pomoTimer = null;

  function paintTimer() {
    var text = $('#timerText');
    if (!text) return;
    var m = Math.floor(pomoLeft / 60);
    var s = pomoLeft % 60;
    text.textContent = ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
    var fill = $('#timerFill');
    if (fill) fill.style.width = ((POMO_TOTAL - pomoLeft) / POMO_TOTAL) * 100 + '%';
    var hint = $('#timerHint');
    if (hint) {
      hint.textContent = pomoTimer
        ? '专注中 · 完成 1 个番茄 +1 学习积分'
        : (pomoLeft === POMO_TOTAL ? '完成 1 个番茄 +1 学习积分' : '已暂停，点继续接着来');
    }
  }

  var timerToggleBtn = $('#timerToggle');
  var timerResetBtn = $('#timerReset');

  function toggleTimer() {
    if (pomoTimer) {
      clearInterval(pomoTimer);
      pomoTimer = null;
      if (timerToggleBtn) timerToggleBtn.textContent = '继续';
      paintTimer();
      return;
    }
    if (pomoLeft <= 0) return;
    if (timerToggleBtn) timerToggleBtn.textContent = '暂停';
    pomoTimer = setInterval(function () {
      pomoLeft -= 1;
      if (pomoLeft <= 0) {
        pomoLeft = 0;
        clearInterval(pomoTimer);
        pomoTimer = null;
        if (timerToggleBtn) timerToggleBtn.textContent = '开始';
        toast('🍅 番茄完成，学习积分 +1');
      }
      paintTimer();
    }, 1000);
    paintTimer();
  }

  if (timerToggleBtn) timerToggleBtn.addEventListener('click', toggleTimer);
  if (timerResetBtn) {
    timerResetBtn.addEventListener('click', function () {
      if (pomoTimer) clearInterval(pomoTimer);
      pomoTimer = null;
      pomoLeft = POMO_TOTAL;
      if (timerToggleBtn) timerToggleBtn.textContent = '开始';
      paintTimer();
    });
  }

  /* 开关：只在本地切换状态，不弹提示 */
  document.addEventListener(
    'click',
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var sw = t.closest('.switch');
      if (!sw) return;
      e.stopPropagation();
      e.preventDefault();
      sw.classList.toggle('is-on');
    },
    true
  );

  /* -------------------------------------------------------- 发日常：可见范围 */

  (function () {
    var seg = $('#postScopeSeg');
    var thumb = $('#postScopeThumb');
    if (!seg || !thumb) return;
    seg.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.seg') : null;
      if (!b || !seg.contains(b)) return;
      var list = $$('.seg', seg);
      var idx = list.indexOf(b);
      if (idx < 0) return;
      list.forEach(function (s, i) {
        s.classList.toggle('is-on', i === idx);
      });
      thumb.style.transform = 'translateX(' + idx * 100 + '%)';
    });
  })();

  /* -------------------------------------------------- ＋搭子：保存自定义标签 */

  (function () {
    function saveTag() {
      var field = $('#tagField');
      var text = field ? field.value.trim() : '';
      if (!text) {
        toast('先给这段关系起个名字');
        return;
      }
      if (text.length > 8) {
        toast('标签最多 8 个字');
        return;
      }
      draftLabel = text;
      // 原型：把当前第一段关系的标签改成新填的，模拟"保存成功"
      if (BUDDY_RELATIONS.length) {
        BUDDY_RELATIONS[0].label = text;
        BUDDY_RELATIONS[0].color = draftColor;
      }
      renderBuddy();
      toast('已保存「' + text + '」（原型演示，不落库）');
    }

    var addBtn = $('#tagAdd');
    if (addBtn) addBtn.addEventListener('click', saveTag);

    var input = $('#tagField');
    if (input) {
      input.addEventListener('input', function () {
        draftLabel = input.value;
        renderBuddy();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') saveTag();
      });
    }
  })();

  /* ------------------------------------------------------------ 效果图总览 */

  // 顺序 = 缩略图顺序（按真实使用路径排，不按 DOM 顺序）
  var GALLERY_ORDER = [
    'login', 'home', 'hall', 'feed', 'post', 'detail', 'match',
    'messages', 'buddy', 'chat', 'me', 'verify', 'titles', 'fitness', 'study'
  ];

  var STRIP_ATTRS = [
    'data-go', 'data-open', 'data-sheet', 'data-sheet-close', 'data-toast', 'data-tab-go', 'data-view',
    'data-tag-suggest', 'data-tag-edit', 'data-color'
  ];

  function buildGallery() {
    var grid = $('#galleryGrid');
    if (!grid) return;

    renderDetail('b1'); // 详情页平时是点卡片才渲染的，缩略图得先有内容

    grid.innerHTML = '';
    GALLERY_ORDER.forEach(function (id, i) {
      var sc = $('.screen[data-screen="' + id + '"]');
      if (!sc) return;
      var meta = SCREENS[id] || {};
      var title = meta.title || id;

      var item = document.createElement('div');
      item.className = 'gallery-item';
      item.setAttribute('data-go', id);
      item.setAttribute('title', '进「' + title + '」');

      var shot = document.createElement('div');
      shot.className = 'shot';

      var scale = document.createElement('div');
      scale.className = 'shot-scale';

      var bar = document.createElement('div');
      bar.className = 'shot-bar';
      bar.innerHTML = '<span>9:41</span><span>▮▮▮ 100%</span>';

      var tb = document.createElement('div');
      tb.className = 'shot-topbar';
      tb.innerHTML =
        '<span class="shot-back">' +
        (meta.parent ? '‹' : '') +
        '</span><span class="shot-title">' +
        title +
        '</span>';

      var vp = document.createElement('div');
      vp.className = 'shot-viewport';

      var clone = sc.cloneNode(true);
      clone.removeAttribute('id');
      clone.removeAttribute('data-screen');
      clone.className = 'screen is-active';
      clone.style.opacity = '1';
      clone.style.transform = 'none';
      clone.style.overflow = 'hidden';
      clone.style.pointerEvents = 'none';
      // 缩略图是死的：去掉重复 id 与全部交互属性，免得点到克隆体里的按钮
      $$('[id]', clone).forEach(function (el) {
        el.removeAttribute('id');
      });
      $$(
        '[data-go], [data-open], [data-sheet], [data-sheet-close], [data-toast], [data-tab-go], [data-view]',
        clone
      ).forEach(function (el) {
        STRIP_ATTRS.forEach(function (a) {
          el.removeAttribute(a);
        });
      });
      vp.appendChild(clone);

      scale.appendChild(bar);
      scale.appendChild(tb);
      scale.appendChild(vp);
      shot.appendChild(scale);

      var label = document.createElement('div');
      label.className = 'shot-label';
      label.innerHTML =
        '<span class="shot-name">' +
        title +
        '</span><span class="shot-no">' +
        ('0' + (i + 1)).slice(-2) +
        '</span>';

      item.appendChild(shot);
      item.appendChild(label);
      grid.appendChild(item);
    });

    var n = String(GALLERY_ORDER.length);
    if ($('#galleryCount')) $('#galleryCount').textContent = n;
    if ($('#galleryCount2')) $('#galleryCount2').textContent = n;
  }

  function setView(v) {
    var gallery = v === 'gallery';
    document.body.classList.toggle('view-gallery', gallery);
    $$('.vbtn').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-view') === v);
    });
    var g = $('#gallery');
    if (g) g.hidden = !gallery;
    if (gallery) buildGallery();
    window.scrollTo(0, 0);
  }

  /* -------------------------------------------------------------- 初始化 */

  function initStagger() {
    screens.forEach(function (sc) {
      $$('.stagger', sc).forEach(function (el, i) {
        if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', i);
      });
    });
  }

  function init() {
    renderHomeBuddies();
    renderConvos();
    renderTitles();
    renderMatch();
    renderChat();
    renderFitness();
    renderStudy();
    paintTimer();
    renderTagPalette();
    renderTagSuggest();
    renderBuddy();
    initStagger();
    syncHallControls();
    syncFeedControls();
    renderFeed();

    // 效果图总览的缩略图先建好（切过去就能看）；失败就写在页面上，别静默
    try {
      buildGallery();
    } catch (err) {
      var gbox = $('#galleryGrid');
      if (gbox) {
        gbox.innerHTML = '<div class="placeholder-note">缩略图生成失败：' + err.message + '</div>';
      }
    }

    var hash = (location.hash || '').replace('#/', '');
    go(SCREENS[hash] ? hash : 'login');
  }

  window.addEventListener('hashchange', function () {
    var id = (location.hash || '').replace('#/', '');
    if (SCREENS[id] && id !== current) {
      go(id, SCREENS[id].parent ? 'back' : 'forward');
    }
  });

  init();
})();
