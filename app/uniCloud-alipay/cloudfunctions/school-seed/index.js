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
  { id: 'dlut', name: '大连理工大学', aliases: ['大工', 'DLUT'], city_code: '210200', province: '辽宁', level: 'university' },

  // ===== 重庆（77 所，教育部 2026-06-18 名单，数据截至 2026-06-17）=====
  // 本科 31 所（含 5 所本科层次职业大学：重庆电子科技职业大学、重庆机电职业技术大学、
  // 重庆工业职业技术大学 2025-07 教育部函设置、重庆城市管理职业大学 与 重庆工程职业技术大学 2026-06 教育部函设置）
  // 重庆大学 cqu、西南大学 swu 已在上方四川节内，此处不重复
  { id: 'cqupt', name: '重庆邮电大学', aliases: ['重邮', '重庆邮电学院', 'CQUPT'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqjtu', name: '重庆交通大学', aliases: ['重交', '重庆交大', '重庆交通学院', 'CQJTU'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqmu', name: '重庆医科大学', aliases: ['重医', 'CQMU'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqnu', name: '重庆师范大学', aliases: ['重师', '重庆师大', '重庆师范学院', 'CQNU'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqwu', name: '重庆文理学院', aliases: ['重文理', '渝西学院', 'CQWL'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqsanxia', name: '重庆三峡科技大学', aliases: ['三峡学院', '重庆三峡学院', 'CQSXXY'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'yznu', name: '长江师范学院', aliases: ['长江师院', '涪陵师范学院', 'YZNU'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'sisucq', name: '四川外国语大学', aliases: ['川外', '四川外语学院', 'SISU'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'swupl', name: '西南政法大学', aliases: ['西政', '西南政法学院', 'SWUPL'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'scfai', name: '四川美术学院', aliases: ['川美', 'SCFAI'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqust', name: '重庆科技大学', aliases: ['重科大', '重庆科技学院', 'CQUST'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqut', name: '重庆理工大学', aliases: ['重理工', '重庆工学院', 'CQUT'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'ctbu', name: '重庆工商大学', aliases: ['重工商', '渝州大学', 'CTBU'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqpc', name: '重庆警察学院', aliases: ['重庆警院', '重庆警官职业学院'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cque', name: '重庆第二师范学院', aliases: ['重庆二师', '重庆教育学院', 'CQUE'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqetu', name: '重庆电子科技职业大学', aliases: ['重庆电子工程职业学院', '电子工程职院', '重电', 'CQCET'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqtcm', name: '重庆中医药学院', aliases: ['重中医', 'CQTCM'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqjd', name: '重庆机电职业技术大学', aliases: ['重庆机电职业技术学院', '机电职大', 'CQJD'], city_code: '500000', province: '重庆', level: 'university' },
  // 2025/2026 由高职专科升格为本科层次职业大学：id 沿用原条目，旧校名进 aliases
  { id: 'cqgzy', name: '重庆工业职业技术大学', aliases: ['重庆工业职业技术学院', '重庆工业职院', '工业职院', '工业职大'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqcsgl', name: '重庆城市管理职业大学', aliases: ['重庆城市管理职业学院', '城管职院', '城市管理职院', '城管职大'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqgczy', name: '重庆工程职业技术大学', aliases: ['重庆工程职业技术学院', '工程职院', '工程职大'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqgc', name: '重庆工程学院', aliases: ['重工院', '重庆正大软件职业技术学院', 'CQGC'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqcst', name: '重庆城市科技学院', aliases: ['重庆大学城市科技学院', '城科', 'CQCST'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqrw', name: '重庆人文科技学院', aliases: ['西南大学育才学院', '人文科技', 'CQRW'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqwyws', name: '重庆外语外事学院', aliases: ['四川外国语大学重庆南方翻译学院', '川外南方翻译学院', '重外', 'CQWYWS'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqdwjm', name: '重庆对外经贸学院', aliases: ['重庆师范大学涉外商贸学院', '对外经贸', 'CQDWJM'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqcj', name: '重庆财经学院', aliases: ['重庆工商大学融智学院', '重财', 'CQCJ'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'ctbupaisi', name: '重庆工商大学派斯学院', aliases: ['派斯学院', 'CTBUPaisi'], city_code: '500000', province: '重庆', level: 'university' },
  { id: 'cqyt', name: '重庆移通学院', aliases: ['重庆邮电大学移通学院', '移通', 'CQYT'], city_code: '500000', province: '重庆', level: 'university' },
  // 高职专科 46 所
  { id: 'cqht', name: '重庆航天职业技术学院', aliases: ['重庆航天职院', '航天职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqepc', name: '重庆电力高等专科学校', aliases: ['重庆电专', '电力高专'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqsxzy', name: '重庆三峡职业学院', aliases: ['三峡职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqgm', name: '重庆工贸职业技术学院', aliases: ['工贸职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqcszy', name: '重庆城市职业学院', aliases: ['城市职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqsldl', name: '重庆水利电力职业技术学院', aliases: ['水利电力职院', '水电职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqgszy', name: '重庆工商职业学院', aliases: ['工商职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqsxyy', name: '重庆三峡医药高等专科学校', aliases: ['三峡医专'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqyygz', name: '重庆医药高等专科学校', aliases: ['重庆医专', '医药高专'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqqn', name: '重庆青年职业技术学院', aliases: ['青年职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqcjzy', name: '重庆财经职业学院', aliases: ['财经职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqjzgc', name: '重庆建筑工程职业学院', aliases: ['建筑职院', '建工职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqsw', name: '重庆商务职业学院', aliases: ['商务职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqhg', name: '重庆化工职业学院', aliases: ['化工职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqly', name: '重庆旅游职业学院', aliases: ['旅游职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqaq', name: '重庆安全技术职业学院', aliases: ['安全职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqyesf', name: '重庆幼儿师范高等专科学校', aliases: ['重庆幼专', '幼师高专'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqwhys', name: '重庆文化艺术职业学院', aliases: ['文化艺术职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqgx', name: '重庆工信职业学院', aliases: ['工信职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqwy', name: '重庆五一职业技术学院', aliases: ['五一职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqhl', name: '重庆海联职业技术学院', aliases: ['海联职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqxxjs', name: '重庆信息技术职业学院', aliases: ['信息职院', '信息技术职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqcm', name: '重庆传媒职业学院', aliases: ['传媒职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqjzkj', name: '重庆建筑科技职业学院', aliases: ['建筑科技职院', '重庆房地产职业学院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqyyjs', name: '重庆应用技术职业学院', aliases: ['应用技术职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqkc', name: '重庆科创职业学院', aliases: ['科创职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqdianxun', name: '重庆电讯职业学院', aliases: ['电讯职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqny', name: '重庆能源职业学院', aliases: ['能源职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqjtzy', name: '重庆交通职业学院', aliases: ['交通职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqggys', name: '重庆公共运输职业学院', aliases: ['公共运输职院', '公运职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqysgc', name: '重庆艺术工程职业学院', aliases: ['艺术工程职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqqg', name: '重庆轻工职业学院', aliases: ['轻工职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqdianxin', name: '重庆电信职业学院', aliases: ['电信职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqjm', name: '重庆经贸职业学院', aliases: ['经贸职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqkjzy', name: '重庆科技职业学院', aliases: ['科技职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqzyhj', name: '重庆资源与环境保护职业学院', aliases: ['资源环境职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqhlzy', name: '重庆护理职业学院', aliases: ['护理职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqlgzy', name: '重庆理工职业学院', aliases: ['理工职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqzn', name: '重庆智能工程职业学院', aliases: ['智能工程职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqjk', name: '重庆健康职业学院', aliases: ['健康职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqszcy', name: '重庆数字产业职业技术学院', aliases: ['数字产业职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqxdzz', name: '重庆现代制造职业学院', aliases: ['现代制造职院'], city_code: '500000', province: '重庆', level: 'college' },
  // 2025/2026 新设高职专科（教育部备案名单新增）
  { id: 'cqnyzy', name: '重庆农业职业学院', aliases: ['重庆农业职院', '农业职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqcxfz', name: '重庆城乡发展职业学院', aliases: ['重庆城乡发展职院', '城乡发展职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqafzy', name: '重庆安防职业学院', aliases: ['重庆安防职院', '安防职院'], city_code: '500000', province: '重庆', level: 'college' },
  { id: 'cqzyzy', name: '重庆中药职业学院', aliases: ['重庆中药职院', '中药职院'], city_code: '500000', province: '重庆', level: 'college' }
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
