'use strict'

/**
 * seed-demo-content —— 一次性工具：给三个演示号（13800000001~3）铺搭子需求 + 同频圈动态。
 *
 * 为什么要它：demo-seed 只管「账号 + 关系 + 会话 + 信誉 + 称号」，卡片与动态是它早期顺带写的；
 * 清完假数据之后，演示号要重新有内容可看（首页推荐、大厅分档、同频圈三档都靠这些行）。
 *
 * 幂等口径：卡片与动态都有固定 _id（seed_card_01…、seed_post_01…），每次运行先按这批 _id 删干净再写，
 * 所以连跑两次结果一样，不会堆重复。所有行带 seed: 'demo-seed' 标记，clean-seed-data 能一键清掉它们。
 *
 * 参数：{ "confirm": "YES" }           预览（只报要写多少条，不写）
 *       { "confirm": "YES", "write": true }  真正写入
 *       { "confirm": "YES", "write": true, "reset": true }  先删后写（默认就是先删后写，这个参数只是显式声明）
 */

const db = uniCloud.database()
const dbCmd = db.command

// 安全：一次性灌数据工具，正式环境默认关闭。需要补演示内容时改成 true、重新部署、跑完改回 false。
const ALLOW = false
const SEED_TAG = 'demo-seed'
const DB_USERS = 'uni-id-users'
const DB_CARDS = 'cards'
const DB_CARD_TAGS = 'card_tags'
const DB_POSTS = 'posts'
const DB_TAGS = 'tags'
const DB_USER_TAGS = 'user_tags'

const PHONES = ['13800000001', '13800000002', '13800000003']

// 每个演示号 2 条需求：类型、标签名都挑 tag-seed 里真实存在的
const CARD_SEEDS = [
  { id: 'seed_card_01', who: 0, type: 'study', title: '图书馆四楼自习｜周内下午两点到六点', desc: '想找个能一起坐到闭馆的人。我在四楼靠窗那排，手机静音放包里，中途只在整点起来接水。谁先摸鱼谁请奶茶，晚上对一遍当天进度。考研和期末都适用。', place: '图书馆四楼靠窗', startIn: 6, people: 1, tags: ['考研', '互相监督', '安静场所'] },
  { id: 'seed_card_02', who: 0, type: 'play', title: '周末拍照搭子｜老校区那排梧桐', desc: '周末想拍一组秋天的人像，缺个愿意被拍或者一起拍的人。我带相机，出片免费给你，拍完顺路去喝杯东西。不会摆姿势也没关系，边走边拍就行。', place: '老校区梧桐道', startIn: 30, people: 1, tags: ['摄影', '线下见面', '临时搭一次'] },
  { id: 'seed_card_03', who: 1, type: 'fitness', title: '东操场夜跑｜九点半十圈', desc: '配速六分半，十圈收工，风雨无阻。主要是互相提醒别躺平。跑完顺路买水，边拉伸边聊两句。刚开始跑也没关系，慢点等我。', place: '东操场', startIn: 10, people: 2, tags: ['跑步', '健身', '拒绝拖延'] },
  { id: 'seed_card_04', who: 1, type: 'meal', title: '周三中午一起去吃新开的那家米线', desc: '三食堂二楼新开了一家，一个人去不太划算（要凑份量）。想吃辣的点辣，不辣的也有清汤。十二点下课直接过去，吃完各回各的课。', place: '三食堂', startIn: 20, people: 1, tags: ['美食探店', '线下见面'] },
  { id: 'seed_card_05', who: 2, type: 'study', title: '英语四级互练｜每周三次口语', desc: '四级刚过线，想冲一次六级。找个人每周固定三次、每次半小时练口语，腾讯会议也行，面对面也行。我这人话不多但不会放鸽子。', place: '图书馆研讨间', startIn: 12, people: 1, tags: ['英语', '四六级', '计划控'] },
  { id: 'seed_card_06', who: 2, type: 'play', title: '这周末桌游｜缺两个人凑局', desc: '约了四五个人，还差两个。三国杀、狼人、阿瓦隆都行，桌游社那边能借。不吃辣也没关系，饮料我准备。纯粹想玩得开心，不玩到半夜。', place: '桌游社活动室', startIn: 26, people: 2, tags: ['桌游', '热闹氛围', '临时搭一次'] }
]

// 每个演示号 2 条动态：纯文字（库里没有现成的图片 fileID，硬塞会变成空白图）
const POST_SEEDS = [
  { id: 'seed_post_01', who: 0, text: '图书馆四楼靠窗那排今天空的座位特别多，下午的阳光刚好落在桌角。带了新的耳机，安静得有点上头。', agoH: 2 },
  { id: 'seed_post_02', who: 0, text: '东操场的跑道翻新了，晚上灯比以前亮。跑完十圈坐在看台上吹风，比在宿舍刷手机舒服多了。', agoH: 20 },
  { id: 'seed_post_03', who: 1, text: '三食堂二楼那家新开的米线真的可以，汤底是熬出来的不是勾的。就是一个人去不太划算，下次想找人拼份量。', agoH: 4 },
  { id: 'seed_post_04', who: 1, text: '今天在教学楼碰到一只很黏人的橘猫，蹲下就自己蹭过来了。手机里存了七张，谁要原图。', agoH: 28 },
  { id: 'seed_post_05', who: 2, text: '六级单词背到第 1200 个，感觉前面背的全忘了。有没有人一起每天打卡的，互相盯着点。', agoH: 6 },
  { id: 'seed_post_06', who: 2, text: '桌游社这周末有局，缺两个人。第一次玩也可以，有人教。别问规则了，来了就知道。', agoH: 30 }
]

function str(v) {
  return v === undefined || v === null ? '' : String(v)
}

async function findUser(phone) {
  const r = await db.collection(DB_USERS).where({ phone: dbCmd.in([phone, '86' + phone, '+86' + phone]) }).limit(1).get()
  if (r.data && r.data.length) return r.data[0]
  const r2 = await db.collection(DB_USERS).where({ phone: Number(phone) }).limit(1).get()
  return (r2.data && r2.data[0]) || null
}

async function tagMap() {
  const out = {}
  try {
    const r = await db.collection(DB_TAGS).field({ name: true }).limit(200).get()
    ;(r.data || []).forEach(function (t) { if (t && t.name) out[t.name] = t._id })
  } catch (e) {}
  return out
}

exports.main = async (event) => {
  try {
    if (!ALLOW) return { code: 403, msg: 'seed-demo-content 已被禁用' }
    const e = event || {}
    if (str(e.confirm) !== 'YES') return { code: 400, msg: "缺少确认参数：请传 confirm: 'YES'" }
    const write = e.write === true

    // 1) 三个演示号必须存在（账号由 demo-seed 建，这里不建账号）
    const users = []
    for (let i = 0; i < PHONES.length; i++) {
      const u = await findUser(PHONES[i])
      users.push(u)
    }
    const missing = []
    users.forEach(function (u, i) { if (!u) missing.push(PHONES[i]) })
    if (missing.length) return { code: 404, msg: '这些演示号不存在：' + missing.join('、') + '（先跑 demo-seed）' }

    // 2) 标签字典：按名字换 id，缺的跳过（不硬编码 id）
    const tmap = await tagMap()

    if (!write) {
      return {
        code: 0,
        msg: '预览：什么都没写（要写请传 write:true）',
        data: {
          cards: CARD_SEEDS.length,
          posts: POST_SEEDS.length,
          tagFound: Object.keys(tmap).length,
          cardTagMiss: CARD_SEEDS.reduce(function (n, c) { return n + c.tags.filter(function (t) { return !tmap[t] }).length }, 0),
          users: users.map(function (u) { return { phone: u.phone, nickname: u.nickname, school_id: str(u.school_id), city_code: str(u.city_code) } })
        }
      }
    }

    const now = Date.now()
    const cardIds = CARD_SEEDS.map(function (c) { return c.id })
    const postIds = POST_SEEDS.map(function (p) { return p.id })

    // 3) 先按固定 _id 清干净（含它们的 card_tags），再写 —— 这才是幂等
    await db.collection(DB_CARD_TAGS).where({ card_id: dbCmd.in(cardIds) }).remove()
    await db.collection(DB_CARDS).where({ _id: dbCmd.in(cardIds) }).remove()
    await db.collection(DB_POSTS).where({ _id: dbCmd.in(postIds) }).remove()

    // 4) 写卡片 + card_tags
    let tagRows = 0
    const cardReport = []
    for (let i = 0; i < CARD_SEEDS.length; i++) {
      const c = CARD_SEEDS[i]
      const u = users[c.who]
      const card = {
        _id: c.id,
        seed: SEED_TAG,
        owner_id: u._id,
        type: c.type,
        title: c.title,
        description: c.desc,
        school_id: str(u.school_id),
        city_code: str(u.city_code),
        geo_lat: typeof u.geo_lat === 'number' ? u.geo_lat : 0,
        geo_lng: typeof u.geo_lng === 'number' ? u.geo_lng : 0,
        location_name: c.place,
        start_time: now + c.startIn * 3600 * 1000,
        end_time: now + (c.startIn + 2) * 3600 * 1000,
        expected_people: c.people,
        images: [],
        status: 'open',
        created_at: now - i * 7 * 60 * 1000,
        updated_at: now - i * 7 * 60 * 1000
      }
      await db.collection(DB_CARDS).add(card)
      const tids = c.tags.map(function (t) { return tmap[t] }).filter(Boolean)
      for (let k = 0; k < tids.length; k++) {
        await db.collection(DB_CARD_TAGS).add({ card_id: c.id, tag_id: tids[k], seed: SEED_TAG })
        tagRows++;
      }
      cardReport.push({ id: c.id, owner: u.nickname, tags: tids.length });
    }

    // 5) 写动态
    const postReport = []
    for (let i = 0; i < POST_SEEDS.length; i++) {
      const p = POST_SEEDS[i]
      const u = users[p.who]
      await db.collection(DB_POSTS).add({
        _id: p.id,
        seed: SEED_TAG,
        owner_id: u._id,
        content: p.text,
        images: [],
        media_type: 'text',
        school_id: str(u.school_id),
        city_code: str(u.city_code),
        like_count: 0,
        comment_count: 0,
        status: 'normal',
        created_at: now - p.agoH * 3600 * 1000,
        updated_at: now - p.agoH * 3600 * 1000
      });
      postReport.push({ id: p.id, owner: u.nickname });
    }

    // 6) 演示号自己也要有标签，否则「与我同频」永远是 null（没标签谈不上重合）
    const shareTags = ['互相监督', '线下见面', '轻松就好']
    const shareIds = shareTags.map(function (t) { return tmap[t] }).filter(Boolean)
    let userTagRows = 0
    for (let i = 0; i < users.length; i++) {
      for (let k = 0; k < shareIds.length; k++) {
        const uid = users[i]._id
        const tid = shareIds[k]
        const exist = await db.collection(DB_USER_TAGS).where({ user_id: uid, tag_id: tid }).limit(1).get()
        if (exist.data && exist.data.length) continue;
        await db.collection(DB_USER_TAGS).add({ user_id: uid, tag_id: tid, seed: SEED_TAG });
        userTagRows++;
      }
    }

    return {
      code: 0,
      msg: '写好 ' + cardReport.length + ' 条需求、' + postReport.length + ' 条动态、' + tagRows + ' 条卡片标签、' + userTagRows + ' 条用户标签',
      data: { cards: cardReport, posts: postReport, cardTags: tagRows, userTags: userTagRows }
    }
  } catch (err) {
    return { code: 500, msg: (err && err.message) || '执行失败' }
  }
}
