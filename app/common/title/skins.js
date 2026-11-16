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
 *
 * ★ 带 --aurora / --pulse / --hologram / --ember / --shimmer / --tide / --nebula
 *   的皮肤是"动态"的（CSS 动画）。未获得的称号在 .badge--off 下会统一关掉动画，
 *   否则满屏灰块还在闪，看着像出故障。
 *
 * ★ form: 'wordmark' 表示这一枚不走「图标 + 文字」的常规形式，改成纯字标
 *   （不画图标、内嵌一圈细描边、字距拉开）。目前只给传说档用 ——
 *   一档一个视觉语法，玩家扫一眼就知道这不是普通称号。
 */
export const TITLE_SKINS = {
  // ============ 普通 · 一次性就能做到 ============
  profile_complete: { cls: 'tt--ice', icon: '❄' },
  verify_pass: { cls: 'tt--forest', icon: '✓' },
  first_buddy: { cls: 'tt--gold', icon: '★' },
  tag_3: { cls: 'tt--kraft', icon: '◈' },
  card_1: { cls: 'tt--mono', icon: '▲' },
  friend_1: { cls: 'tt--cyber', icon: '♪' },
  post_1: { cls: 'tt--paper', icon: '○' },
  comment_10: { cls: 'tt--dawn', icon: '☁' },
  like_50: { cls: 'tt--pulse', icon: '♡' },
  post_6: { cls: 'tt--glass', icon: '◍' },

  // ============ 稀有 · 要持续攒 ============
  tag_8: { cls: 'tt--candy', icon: '✧' },
  card_5: { cls: 'tt--sakura', icon: '●' },
  friend_5: { cls: 'tt--pixel', icon: '◆' },
  post_10: { cls: 'tt--neon', icon: '◉' },
  buddy_3: { cls: 'tt--retro', icon: '☀' },
  veteran_30: { cls: 'tt--glass', icon: '▤' },
  comment_50: { cls: 'tt--aurora', icon: '✺' },
  like_200: { cls: 'tt--hologram', icon: '◈' },

  // ============ 史诗 · 长期投入 ============
  tag_10: { cls: 'tt--royal', icon: '✦' },
  card_10: { cls: 'tt--flame', icon: '⚡' },
  card_30: { cls: 'tt--ember', icon: '✹' },
  post_40: { cls: 'tt--shimmer', icon: '✍' },
  friend_20: { cls: 'tt--tide', icon: '≋' },
  buddy_10: { cls: 'tt--carbon', icon: '▩' },
  buddy_30: { cls: 'tt--nebula', icon: '✳' },
  like_500: { cls: 'tt--hologram', icon: '❥' },
  veteran_100: { cls: 'tt--velvet', icon: '❖' },
  comment_200: { cls: 'tt--neon', icon: '◉' },

  // ============ 传说 · 比史诗更难，且全部动态 ============
  // ★ 这一档的皮肤必须带动画，静态皮肤不许进来
  buddy_50: { cls: 'tt--phoenix', icon: '✵', form: 'wordmark' },
  post_100: { cls: 'tt--galaxy', icon: '✴', form: 'wordmark' },
  friend_50: { cls: 'tt--prism', icon: '◈', form: 'wordmark' },
  veteran_200: { cls: 'tt--legend', icon: '♛', form: 'wordmark' },
  like_1000: { cls: 'tt--thunder', icon: '⚡', form: 'wordmark' }
}

const DEFAULT_SKIN = { cls: 'tt--mono', icon: '·' }

export function skinOf(code) {
  return TITLE_SKINS[String(code || '')] || DEFAULT_SKIN
}
