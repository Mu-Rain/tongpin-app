'use strict'
/**
 * 设置我的头像
 *
 * 入参：{ token, file_id }
 * 出参：{ code, msg, data: { avatar } }
 *
 * 为什么要单独一个云函数：user-profile 是「看别人主页」的只读接口，
 * user-me 是「读我自己」，项目里没有任何一处能写回自己的资料。
 * 没有这个入口，前端就只能直连数据库，那样谁也拦不住有人把别人空间的地址写进来。
 *
 * 为什么存 fileID 不存临时链接：tempFileURL 约 2 小时过期，
 * 存进库第二天头像全白且原 fileID 已丢、不可逆。展示那侧换链即可。
 */
const db = uniCloud.database()
const COLL_USERS = 'uni-id-users'
const MAX_FILE_ID = 512
const CLOUD_PREFIX = 'cloud://'
const STATIC_PREFIX = '/static/avatars/'
/**
 * 内置头像白名单（7 张，与 app/static/avatars/ 及 user-register 的 PRESET_AVATARS 一一对应）。
 *
 * 为什么必须有白名单：前端把路径原样带上来，不校验就等于开了一个
 * 「任意字符串写进 avatar 字段」的口子 —— 写进去的值前端是当 <image src> 直接用的。
 * ★ 顺序与 user-register/PRESET_AVATARS 保持一致，改名要三处一起改。
 */
const STATIC_AVATARS = [
  '/static/avatars/av-study.png', // 学习
  '/static/avatars/av-fitness.png', // 健身
  '/static/avatars/av-photo.png', // 拍照
  '/static/avatars/av-meal.png', // 吃饭
  '/static/avatars/av-sport.png', // 运动
  '/static/avatars/av-competition.png', // 竞赛
  '/static/avatars/av-other.png' // 其他
]

/* 内置头像只能是这 7 条完整路径：前缀只是第一道闸，名单才是唯一的真值 */
function isStaticAvatar(v) {
  if (v.indexOf(STATIC_PREFIX) !== 0) return false
  return STATIC_AVATARS.indexOf(v) >= 0
}

function fail(msg, code) {
  const e = new Error(msg)
  e.bizCode = code || 400
  throw e
}

function str(v) {
  return v === undefined || v === null ? '' : String(v)
}

async function getUserByToken(token) {
  const r = await db.collection(COLL_USERS).where({ token: token }).limit(1).get()
  const u = (r.data && r.data[0]) || null
  if (!u) fail('登录已过期，请重新登录', 401)
  if (u.tokenExpire && Date.now() > u.tokenExpire) fail('登录已过期，请重新登录', 401)
  if (u.status === 'banned' || u.status === 0) fail('账号已被封禁', 403)
  return u
}

exports.main = async (event) => {
  try {
    const e = event || {}
    const token = str(e.token)
    if (!token) fail('未登录', 401)
    const me = await getUserByToken(token)

    const fileId = str(e.file_id).trim()
    if (!fileId) fail('缺少头像文件', 400)
    if (fileId.length > MAX_FILE_ID) fail('头像地址太长', 400)
    // 只收两类：① 上传到云存储的 fileID；② 白名单内的内置头像路径。
    // 外链一律不收：会在对方设备上变成裂图，而且与「上传失败提示」对不上。
    if (fileId.indexOf(CLOUD_PREFIX) !== 0 && !isStaticAvatar(fileId)) {
      // /static/ 下但不是那 7 个文件：是被改过的路径，和「没上传」要分开报，否则排查时看不出方向
      if (fileId.indexOf('/static/') === 0) fail('内置头像不存在', 400)
      fail('头像必须先上传到云存储', 400)
    }

    // 写入前先留一份旧值：换头像之后这两个字段会被覆盖，事后就再也找不到旧文件了
    const oldAvatar = str(me.avatar)
    const oldAvatarUrl = str(me.avatar_url)

    // avatar 是 uni-id 标准字段、avatar_url 是本项目自定义字段，
    // 读的地方两个都在用（user-me 读 avatar、user-profile 兜底 avatar_url），所以两处一起写
    await db.collection(COLL_USERS).doc(me._id).update({
      avatar: fileId,
      avatar_url: fileId,
      updated_at: Date.now()
    })

    // 更新成功后顺手把旧文件删掉，否则每换一次头像就在云存储里留一份垃圾
    try {
      const olds = [oldAvatar, oldAvatarUrl]
      const fileList = []
      for (let i = 0; i < olds.length; i++) {
        const v = olds[i]
        // 只删云存储地址：https 直链不归我们管，等于新 fileID 的是刚传的，删了就白传。
        // 内置头像（/static/...）是包内资源，交给 deleteFile 只会报错 ——
        // 它同样落在这条 continue 里，所以「从内置头像换成云头像」不会去删一个云端没有的文件。
        if (!v || v.indexOf(CLOUD_PREFIX) !== 0) continue
        if (v === fileId) continue
        if (fileList.indexOf(v) >= 0) continue
        fileList.push(v)
      }
      if (fileList.length) {
        await uniCloud.deleteFile({ fileList: fileList.slice(0, 2) })
      }
    } catch (e) {
      console.warn('[user-avatar] 旧头像清理失败', e && e.message)
    }

    return { code: 0, msg: 'ok', data: { avatar: fileId } }
  } catch (err) {
    return { code: err.bizCode || 500, msg: err.message || '设置头像失败' }
  }
}
