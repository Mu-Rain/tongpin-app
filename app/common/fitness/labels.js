/**
 * 健身板块的中文名映射（前端用）
 *
 * 为什么单独一个文件：
 *   健身首页、动作库、训练记录三个页面都要把 'chest' 显示成「胸」，
 *   分散写三份，以后加肌群就会漏改一处。
 *
 * ★ 与云函数的一致性：
 *   这些 key 必须和 docs/09-fitness-study.md §2.6 以及
 *   cloudfunctions/fit-seed/index.js 里的 MUSCLES / EQUIPMENTS 完全一致。
 *   改这里就要同时改那边，否则动作查不出来。
 */

export const MUSCLE_LABEL = {
  chest: '胸',
  back: '背',
  shoulder: '肩',
  biceps: '二头',
  triceps: '三头',
  legs: '腿',
  glutes: '臀',
  core: '核心',
  forearm: '前臂',
  calf: '小腿',
  cardio: '有氧',
  stretch: '拉伸'
}

export const MUSCLE_ORDER = [
  'chest', 'back', 'shoulder', 'biceps', 'triceps', 'legs',
  'glutes', 'core', 'forearm', 'calf', 'cardio', 'stretch'
]

export const MUSCLE_COLOR = {
  chest: '#FF6B4A',
  back: '#3B82F6',
  shoulder: '#F59E0B',
  biceps: '#A855F7',
  triceps: '#8B5CF6',
  legs: '#12B76A',
  glutes: '#EC4899',
  core: '#06B6D4',
  forearm: '#84CC16',
  calf: '#14B8A6',
  cardio: '#F04438',
  stretch: '#64748B'
}

export const EQUIPMENT_LABEL = {
  barbell: '杠铃',
  dumbbell: '哑铃',
  machine: '器械',
  cable: '绳索',
  bodyweight: '自重',
  kettlebell: '壶铃',
  band: '弹力带',
  other: '其他'
}

export const EQUIPMENT_ORDER = [
  'barbell', 'dumbbell', 'machine', 'cable',
  'bodyweight', 'kettlebell', 'band', 'other'
]

export const LEVEL_LABEL = {
  beginner: '入门',
  intermediate: '进阶',
  advanced: '高阶'
}

export const GOAL_LABEL = {
  muscle: '增肌',
  fat_loss: '减脂',
  shaping: '塑形',
  stretch: '拉伸',
  strength: '力量'
}

/** 取中文名，取不到就给原值，避免界面上出现空字符串 */
export function muscleName(key) {
  return MUSCLE_LABEL[key] || key || ''
}

export function equipmentName(key) {
  return EQUIPMENT_LABEL[key] || key || ''
}

export function muscleColor(key) {
  return MUSCLE_COLOR[key] || '#8F959E'
}

export function goalName(key) {
  return GOAL_LABEL[key] || key || ''
}

/** 秒 → 「12 分 30 秒」 */
export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  if (s < 60) return s + ' 秒'
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return r ? m + ' 分 ' + r + ' 秒' : m + ' 分钟'
  const h = Math.floor(m / 60)
  return h + ' 小时 ' + (m % 60) + ' 分'
}

/** 毫秒时间戳 → 'YYYY-MM-DD' */
export function dayKey(ts) {
  const d = new Date(ts || Date.now())
  const y = d.getFullYear()
  const m = ('0' + (d.getMonth() + 1)).slice(-2)
  const dd = ('0' + d.getDate()).slice(-2)
  return y + '-' + m + '-' + dd
}

/** 'YYYY-MM-DD' → '10月18日' */
export function fmtDate(str) {
  const s = String(str || '')
  const p = s.split('-')
  if (p.length < 3) return s
  return Number(p[1]) + '月' + Number(p[2]) + '日'
}
