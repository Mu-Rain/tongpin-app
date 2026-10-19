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
    avatar: user.avatar || '',
    school: user.school || '',
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
      a.avatar = user.avatar || a.avatar
      a.school = user.school || a.school
      a.phone = user.phone || a.phone
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

/** 拿全部，按最近登录时间倒序 */
function listAll() {
  return readAll()
    .filter(Boolean)
    .sort((a, b) => (b.last_login_at || 0) - (a.last_login_at || 0))
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
  uni.setStorageSync('userInfo', {
    _id: acc.user_id,
    phone: acc.phone,
    nickname: acc.nickname,
    avatar: acc.avatar,
    school: acc.school
  })
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
  touch,
  forgetToken,
  remove,
  listAll,
  switchTo,
  currentUserId,
  isUsable
}
