'use strict'
/**
 * school-seed —— 往 schools 集合灌预置学校名单（幂等，可反复跑）
 *
 * 为什么要一张学校表：
 *   同校频道靠 school_id 判"是不是同一所学校"。如果直接用用户手打的中文校名，
 *   "北京大学" / "北大" / "北京大学 " 会被当成三所学校，同校频道就废了。
 *   所以学校必须是选出来的、有稳定 id 的。
 *
 * 字段：
 *   _id        自增式字符串（用校名拼音/简称生成，稳定不重复）
 *   name       全称，显示用
 *   aliases    简称/别名数组，搜索用（搜"北大"能出"北京大学"）
 *   city_code  城市编码，和用户表的 city_code 对齐，用于"同城"筛选
 *   province   省份，后台筛选用
 *   level      办学层次：'university' 本科 / 'college' 专科 / 'middle' 中学
 *   active     是否可选
 *
 * 跑法：HBuilderX 里右键 → 上传并运行
 *     重复跑安全：已存在的 _id 直接跳过，不会重复插入，也不会覆盖你手工改过的数据。
 */

const db = uniCloud.database()
const dbCmd = db.command

const DB_SCHOOLS = 'schools'

/**
 * 预置名单。
 * 范围：**本期**只做高等院校（本科 + 专科），暂不含中小学。
 * 原因（2026-10-18 定）：大学以下学生接触手机时间少，注册量和留存都会很低，
 * 先不做，把 33 天的开发精力放在主力用户上。
 *
 * ⚠️ 这不是永久裁掉：用户已明确（2026-10-18）「以后肯定是会加入中小学的」。
 *    所以这里刻意保留了 level 字段（'university' / 'college' / 'middle' / 'primary'），
 *    将来扩学段 = 往 SCHOOLS 数组补数据 + verify-submit 按学段分支认证材料
 *    （中小学没有学信网，只能走学生证人工审核），表结构不用动。
 *    写新代码时不要假设"只有大学"，也不要写死 level === 'university' 的过滤条件。
 */
const SCHOOLS = [
  // ===== 北京 =====
  { id: 'pku', name: '北京大学', aliases: ['北大', 'PKU'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'thu', name: '清华大学', aliases: ['清华', 'THU'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'ruc', name: '中国人民大学', aliases: ['人大', 'RUC'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'bnu', name: '北京师范大学', aliases: ['北师大', 'BNU'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'buaa', name: '北京航空航天大学', aliases: ['北航', 'BUAA'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'bit', name: '北京理工大学', aliases: ['北理工', 'BIT'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'bupt', name: '北京邮电大学', aliases: ['北邮', 'BUPT'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'cau', name: '中国农业大学', aliases: ['农大', 'CAU'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'uibe', name: '对外经济贸易大学', aliases: ['贸大', 'UIBE'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'cufe', name: '中央财经大学', aliases: ['央财', 'CUFE'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'bfsu', name: '北京外国语大学', aliases: ['北外', 'BFSU'], city_code: '110000', province: '北京', level: 'university' },
  { id: 'cuc', name: '中国传媒大学', aliases: ['中传', 'CUC'], city_code: '110000', province: '北京', level: 'university' },

  // ===== 天津 =====
  { id: 'nku', name: '南开大学', aliases: ['南开', 'NKU'], city_code: '120000', province: '天津', level: 'university' },
  { id: 'tju', name: '天津大学', aliases: ['天大', 'TJU'], city_code: '120000', province: '天津', level: 'university' },

  // ===== 上海 =====
  { id: 'fudan', name: '复旦大学', aliases: ['复旦', 'FDU'], city_code: '310000', province: '上海', level: 'university' },
  { id: 'sjtu', name: '上海交通大学', aliases: ['上交', '上海交大', 'SJTU'], city_code: '310000', province: '上海', level: 'university' },
  { id: 'tongji', name: '同济大学', aliases: ['同济', 'Tongji'], city_code: '310000', province: '上海', level: 'university' },
  { id: 'ecnu', name: '华东师范大学', aliases: ['华东师大', 'ECNU'], city_code: '310000', province: '上海', level: 'university' },
  { id: 'ecust', name: '华东理工大学', aliases: ['华理', 'ECUST'], city_code: '310000', province: '上海', level: 'university' },
  { id: 'suibe', name: '上海对外经贸大学', aliases: ['上外贸', 'SUIBE'], city_code: '310000', province: '上海', level: 'university' },
  { id: 'shisu', name: '上海外国语大学', aliases: ['上外', 'SISU'], city_code: '310000', province: '上海', level: 'university' },

  // ===== 江苏 =====
  { id: 'nju', name: '南京大学', aliases: ['南大', 'NJU'], city_code: '320100', province: '江苏', level: 'university' },
  { id: 'seu', name: '东南大学', aliases: ['东大', 'SEU'], city_code: '320100', province: '江苏', level: 'university' },
  { id: 'nuaa', name: '南京航空航天大学', aliases: ['南航', 'NUAA'], city_code: '320100', province: '江苏', level: 'university' },
  { id: 'njust', name: '南京理工大学', aliases: ['南理工', 'NJUST'], city_code: '320100', province: '江苏', level: 'university' },
  { id: 'njnu', name: '南京师范大学', aliases: ['南师大', 'NJNU'], city_code: '320100', province: '江苏', level: 'university' },
  { id: 'suda', name: '苏州大学', aliases: ['苏大', 'SUDA'], city_code: '320500', province: '江苏', level: 'university' },
  { id: 'ju', name: '江南大学', aliases: ['江南', 'JU'], city_code: '320200', province: '江苏', level: 'university' },

  // ===== 浙江 =====
  { id: 'zju', name: '浙江大学', aliases: ['浙大', 'ZJU'], city_code: '330100', province: '浙江', level: 'university' },
  { id: 'zjut', name: '浙江工业大学', aliases: ['浙工大', 'ZJUT'], city_code: '330100', province: '浙江', level: 'university' },
  { id: 'hznu', name: '杭州师范大学', aliases: ['杭师大', 'HZNU'], city_code: '330100', province: '浙江', level: 'university' },
  { id: 'nbu', name: '宁波大学', aliases: ['宁大', 'NBU'], city_code: '330200', province: '浙江', level: 'university' },

  // ===== 广东 =====
  { id: 'sysu', name: '中山大学', aliases: ['中大', 'SYSU'], city_code: '440100', province: '广东', level: 'university' },
  { id: 'scut', name: '华南理工大学', aliases: ['华工', 'SCUT'], city_code: '440100', province: '广东', level: 'university' },
  { id: 'szu', name: '深圳大学', aliases: ['深大', 'SZU'], city_code: '440300', province: '广东', level: 'university' },
  { id: 'jnu', name: '暨南大学', aliases: ['暨大', 'JNU'], city_code: '440100', province: '广东', level: 'university' },
  { id: 'scnu', name: '华南师范大学', aliases: ['华师', 'SCNU'], city_code: '440100', province: '广东', level: 'university' },
  { id: 'sustech', name: '南方科技大学', aliases: ['南科大', 'SUSTech'], city_code: '440300', province: '广东', level: 'university' },

  // ===== 湖北 / 湖南 =====
  { id: 'whu', name: '武汉大学', aliases: ['武大', 'WHU'], city_code: '420100', province: '湖北', level: 'university' },
  { id: 'hust', name: '华中科技大学', aliases: ['华科', '华中大', 'HUST'], city_code: '420100', province: '湖北', level: 'university' },
  { id: 'ccnu', name: '华中师范大学', aliases: ['华中师大', 'CCNU'], city_code: '420100', province: '湖北', level: 'university' },
  { id: 'hunnu', name: '湖南大学', aliases: ['湖大', 'HNU'], city_code: '430100', province: '湖南', level: 'university' },
  { id: 'csu', name: '中南大学', aliases: ['中南', 'CSU'], city_code: '430100', province: '湖南', level: 'university' },

  // ===== 四川 / 重庆 =====
  { id: 'scu', name: '四川大学', aliases: ['川大', 'SCU'], city_code: '510100', province: '四川', level: 'university' },
  { id: 'uestc', name: '电子科技大学', aliases: ['电子科大', '成电', 'UESTC'], city_code: '510100', province: '四川', level: 'university' },
  { id: 'swjtu', name: '西南交通大学', aliases: ['西南交大', 'SWJTU'], city_code: '510100', province: '四川', level: 'university' },
  { id: 'cqu', name: '重庆大学', aliases: ['重大', 'CQU'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'swu', name: '西南大学', aliases: ['西大', 'SWU'], city_code: '500000', province: '重庆', level: 'university' },

  // ===== 陕西 / 山东 / 福建 / 安徽 / 东北 =====
  { id: 'xjtu', name: '西安交通大学', aliases: ['西交', '西安交大', 'XJTU'], city_code: '610100', province: '陕西', level: 'university' },
  { id: 'npu', name: '西北工业大学', aliases: ['西工大', 'NPU'], city_code: '610100', province: '陕西', level: 'university' },
  { id: 'xidian', name: '西安电子科技大学', aliases: ['西电', 'Xidian'], city_code: '610100', province: '陕西', level: 'university' },
  { id: 'sdu', name: '山东大学', aliases: ['山大', 'SDU'], city_code: '370100', province: '山东', level: 'university' },
  { id: 'ouc', name: '中国海洋大学', aliases: ['海大', 'OUC'], city_code: '370200', province: '山东', level: 'university' },
  { id: 'xmu', name: '厦门大学', aliases: ['厦大', 'XMU'], city_code: '350200', province: '福建', level: 'university' },
  { id: 'fzu', name: '福州大学', aliases: ['福大', 'FZU'], city_code: '350100', province: '福建', level: 'university' },
  { id: 'ustc', name: '中国科学技术大学', aliases: ['中科大', 'USTC'], city_code: '340100', province: '安徽', level: 'university' },
  { id: 'hfut', name: '合肥工业大学', aliases: ['合工大', 'HFUT'], city_code: '340100', province: '安徽', level: 'university' },
  { id: 'hrbust', name: '哈尔滨工业大学', aliases: ['哈工大', 'HIT'], city_code: '230100', province: '黑龙江', level: 'university' },
  { id: 'jlu', name: '吉林大学', aliases: ['吉大', 'JLU'], city_code: '220100', province: '吉林', level: 'university' },
  { id: 'neu', name: '东北大学', aliases: ['东北大学', 'NEU'], city_code: '210100', province: '辽宁', level: 'university' },
  { id: 'dlut', name: '大连理工大学', aliases: ['大工', 'DLUT'], city_code: '210200', province: '辽宁', level: 'university' }
]

exports.main = async (event, context) => {
  const now = Date.now()

  // 一次性把已有的全捞出来判重（名单一百多条，一次 get 就够，不用逐条查）
  const existRes = await db.collection(DB_SCHOOLS).field({ _id: true }).limit(500).get()
  const existIds = new Set(existRes.data.map((s) => s._id))

  const toAdd = SCHOOLS.filter((s) => !existIds.has(s.id)).map((s) => ({
    _id: s.id,
    name: s.name,
    aliases: s.aliases || [],
    city_code: s.city_code || '',
    province: s.province || '',
    level: s.level || 'university',
    active: true,
    create_time: now
  }))

  let inserted = 0
  if (toAdd.length) {
    // 分批写，避免一次 add 太多被限流
    const CHUNK = 20
    for (let i = 0; i < toAdd.length; i += CHUNK) {
      const chunk = toAdd.slice(i, i + CHUNK)
      try {
        await db.collection(DB_SCHOOLS).add(chunk)
        inserted += chunk.length
      } catch (e) {
        // 单批失败不影响其他批，返回里能看到差多少
        console.warn('[school-seed] chunk failed at', i, e.message)
      }
    }
  }

  return {
    code: 0,
    msg: 'ok',
    data: {
      total: SCHOOLS.length,
      already: existIds.size,
      inserted: inserted,
      skipped: SCHOOLS.length - inserted
    }
  }
}
