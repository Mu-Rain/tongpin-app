/**
 * 本地账号簿 —— 记住这台手机上登录过哪些号，方便一键切换。
 *
 * 为什么要自己存：
 *   登录成功后只有 token 和 userInfo 留在本地，token 一清就没法回到那个号，
 *   必须重新输手机号密码。但一个账号的登录凭据是长期有效的（30 天），
 *   完全可以留着，切换时直接换回去。
 *
 * 存储设计（一个 key 放整个列表，别拆成多个 key，省得漏删）：
 *   uni.setStorageSync('accountBook', [
 *     {
 *       user_id, phone, nickname, avatar, school,
 *       token,          // 该账号的登录凭据
 *       token_expire,   // 毫秒时间戳，过期了就不显示"可切换"
 *       last_login_at   // 最近一次登录时间，用来排序
 *     },
 *     ...
 *   ])
 *
 * 安全说明：
 *   token 存在应用沙盒里，未 root 的安卓机其他应用读不到；
 *   和"记住密码"不是一回事，我们不存密码。
 *   退出登录（onLogout）会把这个号的 token 一起清掉，但仍保留在列表里显示，
 *   只是点击它需要重新输密码。这样用户能看见"我登过哪些号"。
 */

const KEY = 'accountBook'
const MAX_ACCOUNTS = 5

function readAll() {
  try {
    const v = uni.getStorageSync(KEY)
    if (!v) return []
    const arr = typeof v === 'string' ? JSON.parse(v) : v
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

function writeAll(list) {
  try {
    uni.setStorageSync(KEY, list)
  } catch (e) {
    /* 存储满了也不能让登录失败 */
  }
}

/** 这个 token 是不是还能直接用 */
function isUsable(acc) {
  if (!acc || !acc.token) return false
  if (!acc.token_expire) return true
  return acc.token_expire > Date.now()
}

/**
 * 账号簿里存的 avatar 必须是「稳定标识」，取值优先级：云存储 fileID > 包内静态路径 > http。
 *
 * 为什么必须分级而不是「有值就用」：
 *   - user-login 给的 avatar_url 是临时链接（user-login:208 用 toTempUrl 换过），
 *     约 2 小时过期，直接存下来第二天就是裂图；
 *   - 自带头像/历史账号只有 avatar_url 一个字段（avatar 留给用户自己传的 fileID，
 *     见 user-login:83 只写 avatar_url），avatar 为空时必须从 avatar_url 里挑。
 * 旧实现只认「以 / 开头」的 avatar_url，cloud:// fileID 和 http 一律返回空串，
 * 那个设过头像的号在账号簿里就这么被存成了空头像。
 */
function rankOf(v) {
  const s = String(v == null ? '' : v)
  if (s.indexOf('cloud://') === 0) return 3
  if (s.charAt(0) === '/') return 2
  if (s.indexOf('http') === 0) return 1
  return 0
}

/** 从若干候选里挑等级最高的（同等级取先出现的） */
function bestAvatar(cands) {
  let best = ''
  for (let i = 0; i < cands.length; i++) {
    const v = String(cands[i] == null ? '' : cands[i])
    if (rankOf(v) > rankOf(best)) best = v
  }
  return best
}

function stableAvatar(user) {
  const u = user || {}
  return bestAvatar([u.avatar, u.avatar_url])
}

/**
 * 一条账号记录能拿去渲染的头像标识。
 * 只认 acc.avatar 不够：老版本把它存成了空串，但 fileID 还在 profile 快照里
 * （remember 存的是整份 user），从快照里捞一次就能救回来，不用联网。
 */
function avatarOf(acc) {
  if (!acc) return ''
  const p = acc.profile || {}
  return bestAvatar([acc.avatar, p.avatar, p.avatar_url])
}

/**
 * 登录成功后调用：把账号写进账号簿。
 * 同一个 user_id 只留一条（后写的覆盖前面的头像/昵称/新 token）。
 */
function remember(loginResult) {
  const user = (loginResult && loginResult.user) || {}
  const token = (loginResult && loginResult.token) || ''
  const uid = user._id || user.id || ''
  if (!uid || !token) return

  const list = readAll().filter((a) => a && a.user_id !== uid)
  list.unshift({
    user_id: uid,
    phone: user.phone || '',
    nickname: user.nickname || '同学',
    avatar: stableAvatar(user),
    school: user.school || '',
    // 整份快照：切号时先靠它把 userInfo 填回去（信誉分、角色、school_id 这些
    // 只存昵称头像是不够的，见 switchTo 的注释）
    profile: user,
    token: token,
    // 后端 token 有效期 7 天（user-login 里写的），这里留 6 天余量
    token_expire: Date.now() + 6 * 24 * 3600 * 1000,
    last_login_at: Date.now()
  })

  writeAll(list.slice(0, MAX_ACCOUNTS))
}

/** 只更新昵称头像这类展示信息，不动 token */
function touch(user) {
  const uid = user && (user._id || user.id)
  if (!uid) return
  const list = readAll()
  let hit = false
  for (const a of list) {
    if (a && a.user_id === uid) {
      a.nickname = user.nickname || a.nickname
      // 只向上换：新值只是条 http 临时链接时，不能把已经存下的 fileID 顶掉
      const nextAvatar = stableAvatar(user)
      if (nextAvatar && rankOf(nextAvatar) >= rankOf(a.avatar)) a.avatar = nextAvatar
      a.school = user.school || a.school
      a.phone = user.phone || a.phone
      // 快照跟着更新：换头像 / 改信誉分之后，切回来不该看到旧值
      a.profile = Object.assign({}, a.profile || {}, user)
      hit = true
    }
  }
  if (hit) writeAll(list)
}

/** 退出登录：清掉这个号的 token，但保留记录（用户还看得见登过哪些号） */
function forgetToken(userId) {
  const list = readAll()
  for (const a of list) {
    if (a && a.user_id === userId) {
      a.token = ''
      a.token_expire = 0
    }
  }
  writeAll(list)
}

/** 从账号簿彻底删除一条 */
function remove(userId) {
  writeAll(readAll().filter((a) => a && a.user_id !== userId))
}

/** 拿全部，按最近登录时间倒序；顺手把「avatar 是空串但快照里有 fileID」的老记录补上 */
function listAll() {
  const list = readAll()
    .filter(Boolean)
    .sort((a, b) => (b.last_login_at || 0) - (a.last_login_at || 0))
  let fixed = false
  for (const a of list) {
    const best = avatarOf(a)
    if (best && best !== a.avatar) {
      a.avatar = best
      fixed = true
    }
  }
  if (fixed) writeAll(list)
  return list
}

/**
 * 切换到某个账号：把它的 token / userInfo 写回当前会话。
 * 返回 true 表示切换成功，false 表示这个号的凭据已经不能用了（需要重新输密码）。
 */
function switchTo(userId) {
  const acc = listAll().find((a) => a.user_id === userId)
  if (!acc) return false
  if (!isUsable(acc)) return false

  uni.setStorageSync('token', acc.token)
  // ★ 这里以前只写 _id / phone / nickname / avatar / school 五个字段，
  //   切号后「我的」页的信誉条是空的（credit 不在里面）、管理员入口消失（role 没了）、
  //   同校相关页面也拿不到 school_id。要么带上登录时的整份快照，要么像老数据那样
  //   只有五个字段时，由调用方再 await hydrate() 去服务端补齐。
  // 五个基础字段先铺底，整份快照再覆盖：老记录的 profile 不一定齐，
  // 不能因为它缺 _id / nickname 就把「我是谁」切成空。字段集合与以前一样，只是不再依赖快照完整。
  const snap = Object.assign({
    _id: acc.user_id,
    phone: acc.phone,
    nickname: acc.nickname,
    avatar: acc.avatar,
    school: acc.school
  }, acc.profile || {})
  // 账号簿补出来的头像要跟着带去「我的」页，否则两边头像对不上
  const ava = bestAvatar([snap.avatar, acc.avatar])
  if (ava) snap.avatar = ava
  uni.setStorageSync('userInfo', snap)
  // autoLogin 是"下次启动自动进首页"的标记。
  // 从账号簿切过去也算正常登录状态，所以重新打上，
  // 否则用户切完号一杀进程再开又掉回登录页。
  uni.setStorageSync('autoLogin', {
    state: 'ok',
    token: acc.token,
    at: Date.now()
  })

  // 更新一下最近登录时间，让它排到最前
  const list = readAll()
  for (const a of list) {
    if (a && a.user_id === userId) a.last_login_at = Date.now()
  }
  writeAll(list)

  return true
}

/**
 * 用当前 token 向服务端要一次完整的自己，合并进本地 userInfo。
 *
 * 为什么需要它：账号簿只保证「能切回去」，不保证「字段齐全」——
 *   - 早版本 remember 只存了昵称头像，切号后 userInfo 缺 credit / role / school_id；
 *   - 后台改过信誉分、角色，本地那份就是旧的。
 * 一次 user-me 同时解决这两件事。失败返回 null，调用方保持原值即可（不报错、不白屏）。
 */
async function hydrate() {
  const token = uni.getStorageSync('token') || ''
  if (!token) return null
  try {
    const res = await uniCloud.callFunction({ name: 'user-me', data: { token: token } })
    const r = (res && res.result) || {}
    if (r.code !== 0 || !r.data || !r.data.user) return null
    const server = r.data.user
    const cached = uni.getStorageSync('userInfo') || {}
    const merged = Object.assign({}, cached, server)
    // 服务端换不出头像链接时会给空串，别用它盖掉本地已有的值
    if (!merged.avatar && cached.avatar) merged.avatar = cached.avatar
    uni.setStorageSync('userInfo', merged)
    touch(merged)
    return merged
  } catch (e) {
    return null
  }
}

/* 本次进程内已经问过头像的号：避免每次 onShow 都打一遍 user-me */
const avatarAsked = Object.create(null)

/**
 * 拿某个号自己的 token 向服务端要一次头像，写回账号簿。
 *
 * 为什么需要：早期版本把 avatar 存成了空串（stableAvatar 老实现只认 /static 路径），
 * 那个号的 fileID 只剩在云端，本地怎么拼都拼不回来 —— 只能用它自己的凭据换一次。
 * 失败一律返回空串，调用方保持空圆占位，不弹错、不白屏。
 */
async function refreshAvatar(userId) {
  const acc = listAll().find((a) => a.user_id === userId)
  if (!acc || !isUsable(acc)) return ''
  if (avatarAsked[userId]) return ''
  avatarAsked[userId] = true
  // ★ 只有「真拿到地址」才保留这个去重标记。失败（弱网 / 云函数还是旧版 / 该号凭据过期）
  //   必须撤回，否则这一次失败会被记成「问过了」，本次运行内再也不重试 ——
  //   表现就是「切号页那个号一直空着头像，重启 App 才恢复」。
  try {
    const res = await uniCloud.callFunction({ name: 'user-me', data: { token: acc.token } })
    const r = (res && res.result) || {}
    const u = (r.code === 0 && r.data && r.data.user) || null
    if (!u) {
      delete avatarAsked[userId]
      return ''
    }
    const best = stableAvatar(u)
    if (!best) {
      delete avatarAsked[userId]
      return ''
    }
    touch(u)
    return best
  } catch (e) {
    delete avatarAsked[userId]
    return ''
  }
}

/**
 * 把某条记录里「已经死掉的地址」降级掉。
 *
 * 什么时候用：<image> 报了 error。常见成因是历史数据里存着一条早已过期的 http 临时链接，
 * 它比空值更坏 —— 有值就会被挑成 bestAvatar，于是永远渲染同一张裂图，也不会去问服务端。
 * 只清 http 这一档，cloud:// 与包内静态路径不动（它们没有过期概念）。
 */
function markAvatarDead(userId) {
  const uid = String(userId || '')
  if (!uid) return false
  const list = readAll()
  let changed = false
  for (const a of list) {
    if (!a || a.user_id !== uid) continue
    if (rankOf(a.avatar) === 1) {
      a.avatar = ''
      changed = true
    }
    const p = a.profile || {}
    if (rankOf(p.avatar) === 1) {
      p.avatar = ''
      changed = true
    }
    if (rankOf(p.avatar_url) === 1) {
      p.avatar_url = ''
      changed = true
    }
  }
  if (changed) writeAll(list)
  return changed
}

/** 当前登录的是哪个号（用来在列表里标"当前"） */
function currentUserId() {
  const u = uni.getStorageSync('userInfo') || {}
  return u._id || u.id || ''
}

// ★ 必须用 ESM 的 export default。
//   这个文件被 .vue 页面用 `import book from '@/common/account/book.js'` 引入，
//   之前写成 module.exports（CommonJS），HBuilderX 编译链直接报
//   「"default" is not exported by book.js」，整个 App 编译失败。
export default {
  remember,
  markAvatarDead,
  hydrate,
  touch,
  forgetToken,
  remove,
  listAll,
  switchTo,
  avatarOf,
  refreshAvatar,
  currentUserId,
  isUsable
}
