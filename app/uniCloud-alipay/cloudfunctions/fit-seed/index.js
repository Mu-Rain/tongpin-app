'use strict'
/**
 * fit-seed · 灌数据（一次性工具，幂等，可反复运行）
 *
 * 干什么：
 *   1) 把动作库写进 fit_exercises（按固定 _id 判重，已存在就跳过，不覆盖手工改过的数据）
 *   2) 把官方训练计划写进 fit_plans + fit_plan_items
 *
 * 怎么跑：
 *   HBuilderX 里右键本函数 → 上传并运行。返回 { code:0, data:{ exercises:{inserted,skipped}, plans:{...} } }
 *   重复跑安全，第二次会全是 skipped。
 *
 * 为什么用固定 _id：
 *   判重不靠名字靠 id。以后改动作的中文名（「杠铃卧推」→「平板卧推」）也不会重复插入一条。
 *
 * 安全：
 *   上线前把 ALLOW 改成 false 或直接删掉这个云函数。它不需要 token，任何人调都能灌数据，
 *   但因为是幂等的，最坏结果只是"数据被重新灌一遍"，不会破坏已有记录。
 */

const db = uniCloud.database()

const ALLOW = true

const DB_EX = 'fit_exercises'
const DB_PLAN = 'fit_plans'
const DB_ITEM = 'fit_plan_items'

// ---------------------------------------------------------------------------
// 动作库
// 字段含义见 docs/09-fitness-study.md §2.1
// reps 用字符串：「8-12」「力竭」「30 秒」都合法
// ---------------------------------------------------------------------------
const EXERCISES = [
  // ===== 胸 chest =====
  { _id: 'bench_press', name: '杠铃卧推', alias: ['卧推', '平板卧推'], muscle: 'chest', muscle_sub: '中下胸', equipment: 'barbell', mechanics: 'compound', force: 'push', level: 'intermediate', default_sets: 4, default_reps: '6-10', default_rest: 120, secondary: ['triceps', 'shoulder'], tip: '肩胛骨收紧下沉，杠铃落到乳头附近，手腕不要后折。', sort: 1 },
  { _id: 'incline_bench_press', name: '上斜杠铃卧推', alias: ['上斜卧推'], muscle: 'chest', muscle_sub: '上胸', equipment: 'barbell', mechanics: 'compound', force: 'push', level: 'intermediate', default_sets: 4, default_reps: '8-10', default_rest: 120, secondary: ['shoulder', 'triceps'], tip: '靠背 30° 左右，落点在锁骨下沿，太多角度会变成推肩。', sort: 2 },
  { _id: 'decline_bench_press', name: '下斜杠铃卧推', alias: ['下斜卧推'], muscle: 'chest', muscle_sub: '下胸', equipment: 'barbell', mechanics: 'compound', force: 'push', level: 'intermediate', default_sets: 3, default_reps: '8-12', default_rest: 90, secondary: ['triceps'], tip: '固定好腿再起杠，落点在下胸位置。', sort: 3 },
  { _id: 'db_bench_press', name: '哑铃卧推', alias: ['平板哑铃卧推'], muscle: 'chest', muscle_sub: '中下胸', equipment: 'dumbbell', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 4, default_reps: '8-12', default_rest: 90, secondary: ['triceps', 'shoulder'], tip: '下放到胸侧有拉伸感，推起时两只哑铃不要相撞。', sort: 4 },
  { _id: 'db_incline_press', name: '上斜哑铃卧推', alias: ['上斜哑铃推'], muscle: 'chest', muscle_sub: '上胸', equipment: 'dumbbell', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 4, default_reps: '8-12', default_rest: 90, secondary: ['shoulder'], tip: '下放到位时上臂约与地面成 45°。', sort: 5 },
  { _id: 'db_fly', name: '平躺哑铃飞鸟', alias: ['哑铃飞鸟', '飞鸟'], muscle: 'chest', muscle_sub: '中下胸', equipment: 'dumbbell', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '10-15', default_rest: 60, secondary: [], tip: '肘微屈固定角度，像抱一棵大树，别用太重。', sort: 6 },
  { _id: 'cable_crossover', name: '绳索十字夹胸', alias: ['龙门架夹胸', '绳索夹胸'], muscle: 'chest', muscle_sub: '中下胸', equipment: 'cable', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: [], tip: '身体前倾，双手在体前交叉，顶峰收缩一秒。', sort: 7 },
  { _id: 'machine_chest_press', name: '器械推胸', alias: ['坐姿推胸'], muscle: 'chest', muscle_sub: '中下胸', equipment: 'machine', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 3, default_reps: '10-12', default_rest: 90, secondary: ['triceps'], tip: '调好坐垫高度，手柄大概在胸口中线。', sort: 8 },
  { _id: 'pushup', name: '俯卧撑', alias: ['标准俯卧撑'], muscle: 'chest', muscle_sub: '中下胸', equipment: 'bodyweight', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 3, default_reps: '力竭', default_rest: 60, secondary: ['triceps', 'core'], tip: '手在肩宽略宽，身体成一条直线，别塌腰。', sort: 9 },
  { _id: 'dip', name: '双杠臂屈伸', alias: ['双杠撑'], muscle: 'chest', muscle_sub: '下胸', equipment: 'bodyweight', mechanics: 'compound', force: 'push', level: 'advanced', default_sets: 3, default_reps: '8-12', default_rest: 90, secondary: ['triceps'], tip: '身体前倾练胸、直立练三头，别下放太低伤肩。', sort: 10 },

  // ===== 背 back =====
  { _id: 'deadlift', name: '硬拉', alias: ['传统硬拉'], muscle: 'back', muscle_sub: '下背', equipment: 'barbell', mechanics: 'compound', force: 'pull', level: 'advanced', default_sets: 4, default_reps: '4-6', default_rest: 180, secondary: ['legs', 'glutes'], tip: '杠贴近小腿，起杠时背挺直别弓，先蹬腿再伸髋。', sort: 1 },
  { _id: 'barbell_row', name: '杠铃划船', alias: ['俯身划船', '划船'], muscle: 'back', muscle_sub: '背阔', equipment: 'barbell', mechanics: 'compound', force: 'pull', level: 'intermediate', default_sets: 4, default_reps: '8-10', default_rest: 120, secondary: ['biceps'], tip: '俯身约 45°，拉向下腹，别用腰甩。', sort: 2 },
  { _id: 'pullup', name: '引体向上', alias: ['引体'], muscle: 'back', muscle_sub: '背阔', equipment: 'bodyweight', mechanics: 'compound', force: 'pull', level: 'advanced', default_sets: 4, default_reps: '力竭', default_rest: 120, secondary: ['biceps', 'forearm'], tip: '肩胛先下沉再拉，下巴过杆，下落控制住。', sort: 3 },
  { _id: 'lat_pulldown', name: '高位下拉', alias: ['下拉', '绳索下拉'], muscle: 'back', muscle_sub: '背阔', equipment: 'cable', mechanics: 'compound', force: 'pull', level: 'beginner', default_sets: 4, default_reps: '10-12', default_rest: 90, secondary: ['biceps'], tip: '拉到手柄到胸上方，肩别耸起来。', sort: 4 },
  { _id: 'seated_row', name: '坐姿划船', alias: ['坐姿绳索划船'], muscle: 'back', muscle_sub: '中背', equipment: 'cable', mechanics: 'compound', force: 'pull', level: 'beginner', default_sets: 4, default_reps: '10-12', default_rest: 90, secondary: ['biceps'], tip: '挺胸把肩胛夹紧，手肘贴近身体拉。', sort: 5 },
  { _id: 'db_row', name: '哑铃单臂划船', alias: ['单臂划船', '哑铃划船'], muscle: 'back', muscle_sub: '背阔', equipment: 'dumbbell', mechanics: 'compound', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '10-12', default_rest: 75, secondary: ['biceps'], tip: '另一只手撑在凳上，背保持水平，拉到腰侧。', sort: 6 },
  { _id: 'machine_row', name: '器械划船', alias: ['坐姿器械划船'], muscle: 'back', muscle_sub: '中背', equipment: 'machine', mechanics: 'compound', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '10-12', default_rest: 90, secondary: ['biceps'], tip: '胸口贴住挡板，拉的时候别耸肩。', sort: 7 },
  { _id: 'face_pull', name: '绳索面拉', alias: ['面拉'], muscle: 'back', muscle_sub: '后束', equipment: 'cable', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: ['shoulder'], tip: '拉向脸前方，手肘抬高，改善圆肩。', sort: 8 },
  { _id: 'back_extension', name: '山羊挺身', alias: ['背屈伸'], muscle: 'back', muscle_sub: '下背', equipment: 'bodyweight', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: ['glutes'], tip: '起来时别过度后仰，到身体成直线就停。', sort: 9 },

  // ===== 肩 shoulder =====
  { _id: 'ohp', name: '站姿杠铃推举', alias: ['军事推举', '推举'], muscle: 'shoulder', muscle_sub: '前束', equipment: 'barbell', mechanics: 'compound', force: 'push', level: 'intermediate', default_sets: 4, default_reps: '6-10', default_rest: 120, secondary: ['triceps'], tip: '核心收紧，杠从下巴推过头顶，别过度挺腰。', sort: 1 },
  { _id: 'db_shoulder_press', name: '哑铃推举', alias: ['坐姿哑铃推举', '肩上推'], muscle: 'shoulder', muscle_sub: '前束', equipment: 'dumbbell', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 4, default_reps: '8-12', default_rest: 90, secondary: ['triceps'], tip: '下放到耳朵高度，推起时手肘别完全锁死。', sort: 2 },
  { _id: 'lateral_raise', name: '哑铃侧平举', alias: ['侧平举', '侧举'], muscle: 'shoulder', muscle_sub: '中束', equipment: 'dumbbell', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 4, default_reps: '12-15', default_rest: 60, secondary: [], tip: '重量宁轻不重，举到与肩平就够了，别借力甩。', sort: 3 },
  { _id: 'rear_delt_fly', name: '哑铃俯身飞鸟', alias: ['后半鸟', '俯身飞鸟'], muscle: 'shoulder', muscle_sub: '后束', equipment: 'dumbbell', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: ['back'], tip: '俯身到背水平，拇指略朝下打开。', sort: 4 },
  { _id: 'front_raise', name: '哑铃前平举', alias: ['前平举'], muscle: 'shoulder', muscle_sub: '前束', equipment: 'dumbbell', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: [], tip: '举到肩高，别用腰发力。', sort: 5 },
  { _id: 'upright_row', name: '杠铃直立划船', alias: ['直立划船'], muscle: 'shoulder', muscle_sub: '中束', equipment: 'barbell', mechanics: 'isolation', force: 'pull', level: 'intermediate', default_sets: 3, default_reps: '10-12', default_rest: 75, secondary: ['back'], tip: '拉到胸口就停，别太高，肩不舒服就换侧平举。', sort: 6 },
  { _id: 'reverse_pec_deck', name: '反向蝴蝶机', alias: ['后束机'], muscle: 'shoulder', muscle_sub: '后束', equipment: 'machine', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: ['back'], tip: '手肘微屈，打开到与身体成同一平面。', sort: 7 },

  // ===== 二头 biceps =====
  { _id: 'barbell_curl', name: '杠铃弯举', alias: ['弯举'], muscle: 'biceps', muscle_sub: '', equipment: 'barbell', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 4, default_reps: '8-12', default_rest: 75, secondary: ['forearm'], tip: '肘固定在身侧不动，下放要慢。', sort: 1 },
  { _id: 'db_curl', name: '哑铃弯举', alias: ['交替弯举'], muscle: 'biceps', muscle_sub: '', equipment: 'dumbbell', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '10-12', default_rest: 60, secondary: ['forearm'], tip: '弯到顶时小指略高，掌心朝上。', sort: 2 },
  { _id: 'hammer_curl', name: '锤式弯举', alias: ['锤式'], muscle: 'biceps', muscle_sub: '', equipment: 'dumbbell', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '10-12', default_rest: 60, secondary: ['forearm'], tip: '掌心相对握，练肱肌和前臂。', sort: 3 },
  { _id: 'cable_curl', name: '绳索弯举', alias: ['器械弯举'], muscle: 'biceps', muscle_sub: '', equipment: 'cable', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: [], tip: '全程保持张力，别让重量落到底。', sort: 4 },
  { _id: 'preacher_curl', name: '牧师凳弯举', alias: ['斜托弯举'], muscle: 'biceps', muscle_sub: '', equipment: 'barbell', mechanics: 'isolation', force: 'pull', level: 'intermediate', default_sets: 3, default_reps: '10-12', default_rest: 75, secondary: [], tip: '下放到接近伸直就停，别硬拉到底伤肘。', sort: 5 },

  // ===== 三头 triceps =====
  { _id: 'cable_pushdown', name: '绳索下压', alias: ['三头下压', '下压'], muscle: 'triceps', muscle_sub: '', equipment: 'cable', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 4, default_reps: '12-15', default_rest: 60, secondary: [], tip: '大臂夹紧身体，只有小臂动。', sort: 1 },
  { _id: 'skull_crusher', name: '仰卧臂屈伸', alias: ['碎颅者'], muscle: 'triceps', muscle_sub: '', equipment: 'barbell', mechanics: 'isolation', force: 'push', level: 'intermediate', default_sets: 3, default_reps: '10-12', default_rest: 75, secondary: [], tip: '大臂垂直固定，把杠放到额头上方。', sort: 2 },
  { _id: 'close_grip_bench', name: '窄距卧推', alias: ['窄推'], muscle: 'triceps', muscle_sub: '', equipment: 'barbell', mechanics: 'compound', force: 'push', level: 'intermediate', default_sets: 3, default_reps: '8-10', default_rest: 120, secondary: ['chest'], tip: '握距约肩宽，下放时手肘贴身体。', sort: 3 },
  { _id: 'overhead_ext', name: '哑铃过顶臂屈伸', alias: ['过顶三头'], muscle: 'triceps', muscle_sub: '', equipment: 'dumbbell', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '10-12', default_rest: 60, secondary: [], tip: '两手托住一只哑铃，手肘朝前别张开。', sort: 4 },
  { _id: 'bench_dip', name: '凳上反屈伸', alias: ['凳上臂屈伸'], muscle: 'triceps', muscle_sub: '', equipment: 'bodyweight', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: ['shoulder'], tip: '身体贴近凳子，下放到大臂与地面平行。', sort: 5 },

  // ===== 腿 legs =====
  { _id: 'squat', name: '杠铃深蹲', alias: ['深蹲', '后蹲'], muscle: 'legs', muscle_sub: '股四头', equipment: 'barbell', mechanics: 'compound', force: 'push', level: 'intermediate', default_sets: 5, default_reps: '5-8', default_rest: 180, secondary: ['glutes', 'core'], tip: '下蹲到大腿平行地面，膝盖朝脚尖方向。', sort: 1 },
  { _id: 'front_squat', name: '前蹲', alias: ['杠铃前蹲'], muscle: 'legs', muscle_sub: '股四头', equipment: 'barbell', mechanics: 'compound', force: 'push', level: 'advanced', default_sets: 4, default_reps: '6-8', default_rest: 150, secondary: ['glutes', 'core'], tip: '杠放在前三角上，手肘抬高保持上身直立。', sort: 2 },
  { _id: 'leg_press', name: '腿举', alias: ['蹬腿'], muscle: 'legs', muscle_sub: '股四头', equipment: 'machine', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 4, default_reps: '10-15', default_rest: 120, secondary: ['glutes'], tip: '膝盖别锁死，下放到位即可。', sort: 3 },
  { _id: 'lunge', name: '哑铃箭步蹲', alias: ['箭步蹲', '弓步蹲'], muscle: 'legs', muscle_sub: '股四头', equipment: 'dumbbell', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 3, default_reps: '12', default_rest: 90, secondary: ['glutes'], tip: '每侧 12 次，前腿膝盖不超过脚尖太多。', sort: 4 },
  { _id: 'leg_extension', name: '坐姿腿屈伸', alias: ['腿屈伸'], muscle: 'legs', muscle_sub: '股四头', equipment: 'machine', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: [], tip: '到顶停一秒，下放控制住。', sort: 5 },
  { _id: 'leg_curl', name: '俯卧腿弯举', alias: ['腿弯举'], muscle: 'legs', muscle_sub: '股二头', equipment: 'machine', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: [], tip: '骨盆贴紧垫子，用大腿后侧发力。', sort: 6 },
  { _id: 'rdl', name: '罗马尼亚硬拉', alias: ['RDL', '直腿硬拉'], muscle: 'legs', muscle_sub: '股二头', equipment: 'barbell', mechanics: 'compound', force: 'pull', level: 'intermediate', default_sets: 4, default_reps: '8-10', default_rest: 120, secondary: ['glutes', 'back'], tip: '膝盖微屈固定，靠屈髋下放，杠贴腿走。', sort: 7 },
  { _id: 'goblet_squat', name: '壶铃杯式深蹲', alias: ['杯式深蹲'], muscle: 'legs', muscle_sub: '股四头', equipment: 'kettlebell', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 90, secondary: ['glutes', 'core'], tip: '壶铃抱在胸前，蹲到底部保持挺胸。', sort: 8 },

  // ===== 臀 glutes =====
  { _id: 'hip_thrust', name: '杠铃臀推', alias: ['臀推'], muscle: 'glutes', muscle_sub: '', equipment: 'barbell', mechanics: 'compound', force: 'push', level: 'intermediate', default_sets: 4, default_reps: '10-12', default_rest: 120, secondary: ['legs'], tip: '下巴微收，靠臀部发力顶起，到顶停一秒。', sort: 1 },
  { _id: 'glute_bridge', name: '臀桥', alias: ['自重臀桥'], muscle: 'glutes', muscle_sub: '', equipment: 'bodyweight', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '15-20', default_rest: 45, secondary: [], tip: '脚跟发力，肋骨收住别用腰顶。', sort: 2 },
  { _id: 'cable_kickback', name: '绳索后踢腿', alias: ['踢腿'], muscle: 'glutes', muscle_sub: '', equipment: 'cable', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 45, secondary: [], tip: '身体稳定别晃，靠臀部把腿往后带。', sort: 3 },
  { _id: 'hip_abduction', name: '坐姿髋外展', alias: ['髋外展'], muscle: 'glutes', muscle_sub: '', equipment: 'machine', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '15-20', default_rest: 45, secondary: [], tip: '打开到最大处停一下再慢慢回收。', sort: 4 },

  // ===== 核心 core =====
  { _id: 'plank', name: '平板支撑', alias: ['平板'], muscle: 'core', muscle_sub: '', equipment: 'bodyweight', mechanics: 'isolation', force: 'static', level: 'beginner', default_sets: 3, default_reps: '60 秒', default_rest: 45, secondary: [], tip: '身体成一条线，别塌腰也别撅屁股。', sort: 1 },
  { _id: 'crunch', name: '卷腹', alias: ['仰卧卷腹'], muscle: 'core', muscle_sub: '上腹', equipment: 'bodyweight', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '15-20', default_rest: 45, secondary: [], tip: '下巴微收，把肩胛骨卷离地面就行，别拉脖子。', sort: 2 },
  { _id: 'hanging_leg_raise', name: '悬垂举腿', alias: ['吊杠举腿'], muscle: 'core', muscle_sub: '下腹', equipment: 'bodyweight', mechanics: 'isolation', force: 'push', level: 'advanced', default_sets: 3, default_reps: '8-12', default_rest: 60, secondary: ['forearm'], tip: '用腹部把腿带起来，别靠晃动。', sort: 3 },
  { _id: 'russian_twist', name: '俄罗斯转体', alias: ['转体'], muscle: 'core', muscle_sub: '侧腹', equipment: 'bodyweight', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '20', default_rest: 45, secondary: [], tip: '左右各一次算 1 个，转的时候看手。', sort: 4 },
  { _id: 'ab_wheel', name: '健腹轮', alias: ['腹肌轮'], muscle: 'core', muscle_sub: '', equipment: 'other', mechanics: 'compound', force: 'push', level: 'advanced', default_sets: 3, default_reps: '8-12', default_rest: 60, secondary: ['shoulder'], tip: '从跪姿开始，腰别塌。', sort: 5 },
  { _id: 'cable_crunch', name: '绳索卷腹', alias: ['跪姿卷腹'], muscle: 'core', muscle_sub: '上腹', equipment: 'cable', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 60, secondary: [], tip: '髋固定，用腹部把上身卷下去。', sort: 6 },

  // ===== 前臂 forearm =====
  { _id: 'wrist_curl', name: '腕弯举', alias: ['正握腕弯举'], muscle: 'forearm', muscle_sub: '', equipment: 'dumbbell', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '15-20', default_rest: 45, secondary: [], tip: '小臂固定住，只动手腕。', sort: 1 },
  { _id: 'reverse_curl', name: '反握弯举', alias: ['反握'], muscle: 'forearm', muscle_sub: '', equipment: 'barbell', mechanics: 'isolation', force: 'pull', level: 'beginner', default_sets: 3, default_reps: '12-15', default_rest: 45, secondary: ['biceps'], tip: '掌心朝下握杠，手腕保持直。', sort: 2 },

  // ===== 小腿 calf =====
  { _id: 'standing_calf_raise', name: '站姿提踵', alias: ['提踵'], muscle: 'calf', muscle_sub: '', equipment: 'machine', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 4, default_reps: '15-20', default_rest: 45, secondary: [], tip: '到顶踮满，下放让脚跟落到最低。', sort: 1 },
  { _id: 'seated_calf_raise', name: '坐姿提踵', alias: ['坐姿小腿'], muscle: 'calf', muscle_sub: '', equipment: 'machine', mechanics: 'isolation', force: 'push', level: 'beginner', default_sets: 4, default_reps: '15-20', default_rest: 45, secondary: [], tip: '膝盖弯 90°，练比目鱼肌。', sort: 2 },

  // ===== 有氧 cardio =====
  { _id: 'treadmill_run', name: '跑步机慢跑', alias: ['跑步', '慢跑'], muscle: 'cardio', muscle_sub: '有氧', equipment: 'other', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 1, default_reps: '20 分钟', default_rest: 0, secondary: ['legs'], tip: '速度以能说话不喘为宜，别一上来就冲。', sort: 1 },
  { _id: 'elliptical', name: '椭圆机', alias: ['椭圆'], muscle: 'cardio', muscle_sub: '有氧', equipment: 'machine', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 1, default_reps: '20 分钟', default_rest: 0, secondary: ['legs'], tip: '膝盖不疼的替代方案，阻力调到微喘。', sort: 2 },
  { _id: 'jump_rope', name: '跳绳', alias: ['跳绳'], muscle: 'cardio', muscle_sub: '有氧', equipment: 'other', mechanics: 'compound', force: 'push', level: 'beginner', default_sets: 5, default_reps: '60 秒', default_rest: 60, secondary: ['calf'], tip: '手腕发力，跳得别太高。', sort: 3 },
  { _id: 'rowing_machine', name: '划船机', alias: ['风阻划船'], muscle: 'cardio', muscle_sub: '有氧', equipment: 'machine', mechanics: 'compound', force: 'pull', level: 'beginner', default_sets: 1, default_reps: '15 分钟', default_rest: 0, secondary: ['back', 'legs'], tip: '腿→髋→手，回程反过来。', sort: 4 },

  // ===== 拉伸 stretch =====
  { _id: 'stretch_chest', name: '胸大肌拉伸', alias: ['扩胸拉伸'], muscle: 'stretch', muscle_sub: '', equipment: 'bodyweight', mechanics: 'isolation', force: 'static', level: 'beginner', default_sets: 2, default_reps: '30 秒', default_rest: 30, secondary: [], tip: '手扶门框，身体往前转，到有牵拉感就停。', sort: 1 },
  { _id: 'stretch_hamstring', name: '腘绳肌拉伸', alias: ['腿后侧拉伸'], muscle: 'stretch', muscle_sub: '', equipment: 'bodyweight', mechanics: 'isolation', force: 'static', level: 'beginner', default_sets: 2, default_reps: '30 秒', default_rest: 30, secondary: ['legs'], tip: '腿伸直，从髋折叠，别弯腰弓背。', sort: 2 },
  { _id: 'stretch_quad', name: '股四头拉伸', alias: ['腿前侧拉伸'], muscle: 'stretch', muscle_sub: '', equipment: 'bodyweight', mechanics: 'isolation', force: 'static', level: 'beginner', default_sets: 2, default_reps: '30 秒', default_rest: 30, secondary: ['legs'], tip: '扶墙单腿站，把脚跟拉向臀部。', sort: 3 },
  { _id: 'stretch_back', name: '背阔肌拉伸', alias: ['背部拉伸'], muscle: 'stretch', muscle_sub: '', equipment: 'bodyweight', mechanics: 'isolation', force: 'static', level: 'beginner', default_sets: 2, default_reps: '30 秒', default_rest: 30, secondary: ['back'], tip: '抓杆或门框，屁股往后坐。', sort: 4 }
]

// ---------------------------------------------------------------------------
// 官方计划模板
// 每周 1-3 个训练日，动作精简（每 5-6 个），够用且不吓人
// ---------------------------------------------------------------------------
const PLANS = [
  {
    _id: 'tpl_ppl_beginner',
    name: '推拉腿三分化 · 新手版',
    goal: 'muscle',
    level: 'beginner',
    days_per_week: 3,
    duration_weeks: 0,
    desc: '最经典的三分化：推日练胸肩三头，拉日练背二头，腿日练下肢。每周每个部位练两次。',
    cover_color: '#FF6B4A',
    tags: ['新手友好', '增肌'],
    sort: 1,
    days: [
      { day_index: 1, day_name: '推日', items: [
        { exercise_id: 'bench_press', sets: 4, reps: '8-10', rest: 120 },
        { exercise_id: 'db_shoulder_press', sets: 3, reps: '10-12', rest: 90 },
        { exercise_id: 'machine_chest_press', sets: 3, reps: '10-12', rest: 90 },
        { exercise_id: 'lateral_raise', sets: 3, reps: '12-15', rest: 60 },
        { exercise_id: 'cable_pushdown', sets: 3, reps: '12-15', rest: 60 }
      ] },
      { day_index: 2, day_name: '拉日', items: [
        { exercise_id: 'lat_pulldown', sets: 4, reps: '10-12', rest: 90 },
        { exercise_id: 'seated_row', sets: 4, reps: '10-12', rest: 90 },
        { exercise_id: 'machine_row', sets: 3, reps: '10-12', rest: 90 },
        { exercise_id: 'face_pull', sets: 3, reps: '12-15', rest: 60 },
        { exercise_id: 'barbell_curl', sets: 3, reps: '10-12', rest: 75 }
      ] },
      { day_index: 3, day_name: '腿日', items: [
        { exercise_id: 'squat', sets: 4, reps: '6-8', rest: 180 },
        { exercise_id: 'leg_press', sets: 3, reps: '10-15', rest: 120 },
        { exercise_id: 'rdl', sets: 3, reps: '8-10', rest: 120 },
        { exercise_id: 'leg_curl', sets: 3, reps: '12-15', rest: 60 },
        { exercise_id: 'standing_calf_raise', sets: 4, reps: '15-20', rest: 45 },
        { exercise_id: 'plank', sets: 3, reps: '60 秒', rest: 45 }
      ] }
    ]
  },
  {
    _id: 'tpl_upper_lower',
    name: '上下肢二分化',
    goal: 'muscle',
    level: 'intermediate',
    days_per_week: 4,
    duration_weeks: 0,
    desc: '上肢一天、下肢一天，交替练。时间不够又想练全身的最优解。',
    cover_color: '#3B82F6',
    tags: ['高效', '增肌'],
    sort: 2,
    days: [
      { day_index: 1, day_name: '上肢', items: [
        { exercise_id: 'bench_press', sets: 4, reps: '6-8', rest: 150 },
        { exercise_id: 'barbell_row', sets: 4, reps: '8-10', rest: 120 },
        { exercise_id: 'ohp', sets: 3, reps: '8-10', rest: 120 },
        { exercise_id: 'lat_pulldown', sets: 3, reps: '10-12', rest: 90 },
        { exercise_id: 'db_curl', sets: 3, reps: '10-12', rest: 60 },
        { exercise_id: 'skull_crusher', sets: 3, reps: '10-12', rest: 60 }
      ] },
      { day_index: 2, day_name: '下肢', items: [
        { exercise_id: 'squat', sets: 5, reps: '5-8', rest: 180 },
        { exercise_id: 'rdl', sets: 4, reps: '8-10', rest: 120 },
        { exercise_id: 'leg_press', sets: 3, reps: '10-15', rest: 120 },
        { exercise_id: 'leg_curl', sets: 3, reps: '12-15', rest: 60 },
        { exercise_id: 'standing_calf_raise', sets: 4, reps: '15-20', rest: 45 },
        { exercise_id: 'hanging_leg_raise', sets: 3, reps: '8-12', rest: 60 }
      ] }
    ]
  },
  {
    _id: 'tpl_full_body_newbie',
    name: '新手全身 · 每周三练',
    goal: 'muscle',
    level: 'beginner',
    days_per_week: 3,
    duration_weeks: 8,
    desc: '每次练全身，隔天练。动作都是复合动作，8 周打基础。',
    cover_color: '#12B76A',
    tags: ['零基础', '8 周'],
    sort: 3,
    days: [
      { day_index: 1, day_name: '全身', items: [
        { exercise_id: 'squat', sets: 3, reps: '8-10', rest: 150 },
        { exercise_id: 'bench_press', sets: 3, reps: '8-10', rest: 120 },
        { exercise_id: 'lat_pulldown', sets: 3, reps: '10-12', rest: 90 },
        { exercise_id: 'db_shoulder_press', sets: 2, reps: '10-12', rest: 90 },
        { exercise_id: 'plank', sets: 3, reps: '45 秒', rest: 45 }
      ] }
    ]
  },
  {
    _id: 'tpl_fat_loss_circuit',
    name: '减脂循环 · 全身燃脂',
    goal: 'fat_loss',
    level: 'beginner',
    days_per_week: 3,
    duration_weeks: 6,
    desc: '动作之间休息短，心率拉起来。练完加 15 分钟有氧。',
    cover_color: '#F04438',
    tags: ['减脂', '高强度'],
    sort: 4,
    days: [
      { day_index: 1, day_name: '循环 A', items: [
        { exercise_id: 'goblet_squat', sets: 3, reps: '15', rest: 45 },
        { exercise_id: 'pushup', sets: 3, reps: '力竭', rest: 45 },
        { exercise_id: 'db_row', sets: 3, reps: '12', rest: 45 },
        { exercise_id: 'lunge', sets: 3, reps: '12', rest: 45 },
        { exercise_id: 'russian_twist', sets: 3, reps: '20', rest: 45 },
        { exercise_id: 'jump_rope', sets: 5, reps: '60 秒', rest: 60 }
      ] },
      { day_index: 2, day_name: '循环 B', items: [
        { exercise_id: 'hip_thrust', sets: 3, reps: '15', rest: 45 },
        { exercise_id: 'db_shoulder_press', sets: 3, reps: '12', rest: 45 },
        { exercise_id: 'lat_pulldown', sets: 3, reps: '12', rest: 45 },
        { exercise_id: 'glute_bridge', sets: 3, reps: '20', rest: 45 },
        { exercise_id: 'plank', sets: 3, reps: '45 秒', rest: 45 },
        { exercise_id: 'treadmill_run', sets: 1, reps: '15 分钟', rest: 0 }
      ] }
    ]
  },
  {
    _id: 'tpl_stretch_recovery',
    name: '拉伸恢复 · 练后十分钟',
    goal: 'stretch',
    level: 'beginner',
    days_per_week: 7,
    duration_weeks: 0,
    desc: '练完或者久坐之后做一遍，每个动作 30 秒。',
    cover_color: '#A855F7',
    tags: ['恢复', '每天可做'],
    sort: 5,
    days: [
      { day_index: 1, day_name: '恢复', items: [
        { exercise_id: 'stretch_chest', sets: 2, reps: '30 秒', rest: 30 },
        { exercise_id: 'stretch_back', sets: 2, reps: '30 秒', rest: 30 },
        { exercise_id: 'stretch_hamstring', sets: 2, reps: '30 秒', rest: 30 },
        { exercise_id: 'stretch_quad', sets: 2, reps: '30 秒', rest: 30 }
      ] }
    ]
  }
]

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function now() {
  return Date.now()
}

/**
 * 分批查已存在的 _id，避免一次 in() 传太多。
 * uniCloud 的 in() 元素上限约 100，这里用 50 保守一点。
 */
async function existingIds(collection, ids) {
  const found = {}
  const CHUNK = 50
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK)
    try {
      const r = await db.collection(collection).where({ _id: db.command.in(part) }).field({ _id: true }).limit(CHUNK).get()
      const list = r.data || []
      for (const d of list) found[d._id] = true
    } catch (e) {
      console.warn('[fit-seed] 查重失败', collection, e.message)
    }
  }
  return found
}

async function insertBatch(collection, docs) {
  const t = now()
  const CHUNK = 20
  let inserted = 0
  let failed = 0
  for (let i = 0; i < docs.length; i += CHUNK) {
    const part = docs.slice(i, i + CHUNK)
    try {
      await db.collection(collection).add(part.map(function (d) {
        return Object.assign({}, d, { created_at: t })
      }))
      inserted += part.length
    } catch (e) {
      console.warn('[fit-seed] 批量写入失败，改逐条', collection, e.message)
      // 退化为逐条写，单条失败不影响其余
      for (const d of part) {
        try {
          await db.collection(collection).add(Object.assign({}, d, { created_at: t }))
          inserted++
        } catch (e2) {
          failed++
          console.warn('[fit-seed] 单条写入失败', d._id, e2.message)
        }
      }
    }
  }
  return { inserted: inserted, failed: failed }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function seedExercises() {
  const allIds = EXERCISES.map(function (e) { return e._id })
  const exist = await existingIds(DB_EX, allIds)
  const todo = EXERCISES.filter(function (e) { return !exist[e._id] }).map(function (e) {
    return {
      _id: e._id,
      name: e.name,
      alias: e.alias || [],
      muscle: e.muscle,
      muscle_sub: e.muscle_sub || '',
      equipment: e.equipment,
      mechanics: e.mechanics,
      force: e.force,
      level: e.level,
      default_sets: e.default_sets,
      default_reps: e.default_reps,
      default_rest: e.default_rest,
      secondary: e.secondary || [],
      tip: e.tip || '',
      is_custom: false,
      owner_id: '',
      active: true,
      sort: e.sort || 99
    }
  })
  const r = await insertBatch(DB_EX, todo)
  return {
    total: allIds.length,
    skipped: allIds.length - todo.length,
    inserted: r.inserted,
    failed: r.failed
  }
}

async function seedPlans() {
  const planIds = PLANS.map(function (p) { return p._id })
  const existPlan = await existingIds(DB_PLAN, planIds)

  let planInserted = 0
  let planSkipped = 0

  for (const p of PLANS) {
    if (existPlan[p._id]) {
      planSkipped++
      continue
    }
    try {
      await db.collection(DB_PLAN).add({
        _id: p._id,
        name: p.name,
        goal: p.goal,
        level: p.level,
        days_per_week: p.days_per_week,
        duration_weeks: p.duration_weeks,
        source: 'official',
        owner_id: '',
        desc: p.desc,
        cover_color: p.cover_color,
        tags: p.tags || [],
        active: true,
        sort: p.sort || 99,
        created_at: now()
      })
      planInserted++
    } catch (e) {
      console.warn('[fit-seed] 计划写入失败', p._id, e.message)
      continue
    }
  }

  // 计划明细：只给「本次新插入的计划」写明细，避免重复
  // 但如果计划存在而明细为空（比如上次写到一半失败），也应该补——所以按 plan_id 查重
  let itemInserted = 0
  let itemSkipped = 0
  for (const p of PLANS) {
    const planId = p._id
    // 查这个计划已有的明细条数
    let hasItems = 0
    try {
      const c = await db.collection(DB_ITEM).where({ plan_id: planId }).count()
      hasItems = c.total || 0
    } catch (e) {
      hasItems = 0
    }
    if (hasItems > 0) {
      itemSkipped += hasItems
      continue
    }
    const docs = []
    for (const day of p.days) {
      let idx = 0
      for (const it of day.items) {
        idx++
        const ex = EXERCISES.find(function (e) { return e._id === it.exercise_id })
        if (!ex) {
          console.warn('[fit-seed] 计划里的动作不存在', planId, it.exercise_id)
          continue
        }
        docs.push({
          plan_id: planId,
          day_index: day.day_index,
          day_name: day.day_name || '',
          exercise_id: it.exercise_id,
          exercise_name: ex.name,
          sets: it.sets,
          reps: it.reps,
          rest: it.rest,
          sort: idx,
          created_at: now()
        })
      }
    }
    const r = await insertBatch(DB_ITEM, docs)
    itemInserted += r.inserted
  }

  return {
    total: planIds.length,
    inserted: planInserted,
    skipped: planSkipped,
    items_inserted: itemInserted,
    items_skipped: itemSkipped
  }
}

exports.main = async (event, context) => {
  if (!ALLOW) {
    return { code: 403, msg: 'fit-seed 已关闭（ALLOW=false），如需重新灌数据请改回 true 并重新上传部署' }
  }

  // URL 化调用时 event 会被包一层，这里兼容一下
  let ev = event || {}
  if (ev.queryStringParameters && typeof ev.queryStringParameters === 'object') {
    ev = Object.assign({}, ev.queryStringParameters, ev)
  }
  const only = String(ev.only || '').trim()

  const result = { exercises: null, plans: null }

  try {
    if (!only || only === 'exercises') {
      result.exercises = await seedExercises()
    }
    if (!only || only === 'plans') {
      result.plans = await seedPlans()
    }
  } catch (e) {
    console.error('[fit-seed] 失败', e)
    return { code: 500, msg: '灌数据失败：' + (e.message || '未知错误'), data: result }
  }

  return {
    code: 0,
    msg: '灌数据完成（重复运行安全）',
    data: result
  }
}
