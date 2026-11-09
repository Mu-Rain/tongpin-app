/**
 * 称号皮肤表：code → { cls, icon }
 *
 * 为什么放在前端：
 *   服务端只负责「谁拿到了哪个称号、条件是什么」，
 *   长什么样是纯视觉，不该让云端下发 CSS 类名 —— 那样改一次配色就要重传云函数。
 *
 * ★ 外部轮廓固定：一律是胶囊（.tt 基类），高度/圆角/内边距都一样。
 *   能变的是内部：底色、描边、字色、字体、字重、字距、大小写、图标。
 *   这条是用户明确要求的 —— 轮廓统一，里面各自发挥。
 *
 * ★ 新称号上线步骤：① title-list 里加一条定义（code 必须一致）
 *   ② 这里加一行皮肤 ③ styles/title-skins.css 里确认皮肤类存在。
 *   漏了第②③步不会崩，会落到 DEFAULT 皮肤（黑底白字）。
 */
export const TITLE_SKINS = {
  // —— 基础三枚 ——
  profile_complete: { cls: 'tt--ice', icon: '❄' },
  verify_pass: { cls: 'tt--forest', icon: '✓' },
  first_buddy: { cls: 'tt--gold', icon: '★' },

  // —— 标签 ——
  tag_3: { cls: 'tt--kraft', icon: '◈' },
  tag_8: { cls: 'tt--candy', icon: '✧' },
  tag_10: { cls: 'tt--royal', icon: '✦' },

  // —— 发布需求 ——
  card_1: { cls: 'tt--mono', icon: '▲' },
  card_5: { cls: 'tt--sakura', icon: '●' },
  card_10: { cls: 'tt--flame', icon: '⚡' },

  // —— 好友 ——
  friend_1: { cls: 'tt--cyber', icon: '♪' },
  friend_5: { cls: 'tt--pixel', icon: '◆' },

  // —— 动态 ——
  post_1: { cls: 'tt--paper', icon: '○' },
  post_10: { cls: 'tt--neon', icon: '◉' },

  // —— 信誉 ——
  credit_110: { cls: 'tt--ink', icon: '✎' },
  credit_130: { cls: 'tt--gold', icon: '✚' },

  // —— 搭子 ——
  buddy_3: { cls: 'tt--retro', icon: '☀' },
  buddy_10: { cls: 'tt--royal', icon: '✳' }
}

const DEFAULT_SKIN = { cls: 'tt--mono', icon: '·' }

export function skinOf(code) {
  return TITLE_SKINS[String(code || '')] || DEFAULT_SKIN
}
