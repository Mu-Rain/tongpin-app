/**
 * 聊天图片的「本地文件」缓存（fileID → 手机上已存好的文件路径）
 *
 * 为什么光缓存临时链接还不够：
 *   uniCloud.getTempFileURL 返回的链接是**带签名的**，每次换到的链接不一定相同。
 *   image 组件按 URL 做磁盘缓存，URL 一变缓存就命不中，只能重新下载整张图。
 *   所以这里把图片**文件本身**存到手机本地，下次直接用本地路径渲染，一个字节都不下载。
 *
 * 用到的 uni API：
 *   downloadFile  把云链接拉成一个临时文件
 *   saveFile      把临时文件转成「持久保存」的文件，App 重启后依然在
 *   removeSavedFile 清理超量的旧文件（手机的存储空间不是无限的）
 *
 * 降级：任何一步失败（例如平台不支持 saveFile）都只是「这次没缓存成」，
 *       图片仍然会用云链接正常显示，不会报错、不会白屏。
 */

const KEY = 'chat_img_file_cache'
// 手机上最多留多少个图片文件；超过了就删最旧的
const MAX_FILES = 120
// 同时最多下载几张，避免一次进聊天页把几十张图并发拉爆
const MAX_CONCURRENT = 3

let mem = null
let running = 0
const queue = []
// ★ 正在下载中的 fileID。任务被取出执行后就离开 queue 了，
//   只查 queue 会把「下载途中又被请求一次」当成新任务，导致同一张图重复下载。
const inflight = {}

function now() {
  return Date.now()
}

function load() {
  if (mem) return mem
  let raw = null
  try {
    raw = uni.getStorageSync(KEY)
  } catch (e) {
    raw = null
  }
  mem = (raw && typeof raw === 'object') ? raw : {}
  return mem
}

function persist() {
  try {
    uni.setStorageSync(KEY, mem)
  } catch (e) {}
}

function dropFile(path) {
  if (!path) return
  try {
    uni.removeSavedFile({ filePath: path })
  } catch (e) {}
}

// 超量时按存放时间删最旧的几个
function trim() {
  const c = load()
  const ids = Object.keys(c)
  if (ids.length <= MAX_FILES) return
  ids.sort(function (a, b) {
    return (c[a].at || 0) - (c[b].at || 0)
  })
  const drop = ids.length - MAX_FILES
  for (let i = 0; i < drop; i++) {
    dropFile(c[ids[i]].path)
    delete c[ids[i]]
  }
  persist()
}

/** 取这张图在本机已保存的文件路径；没有就返回空串 */
export function getLocalImage(fileID) {
  if (!fileID) return ''
  const c = load()
  const e = c[fileID]
  return (e && e.path) ? e.path : ''
}

/** 记下某张图已经存好的本地路径 */
function markSaved(fileID, path) {
  const c = load()
  // 同一个 fileID 若之前存过另一个文件，先把旧文件删掉，别漏在手机上占空间
  const old = c[fileID]
  if (old && old.path && old.path !== path) dropFile(old.path)
  c[fileID] = { path: path, at: now() }
  persist()
  trim()
}

function runNext() {
  if (running >= MAX_CONCURRENT || !queue.length) return
  const job = queue.shift()
  running++
  download(job, function () {
    running--
    delete inflight[job.fileID]
    runNext()
  })
}

function download(job, done) {
  const fileID = job.fileID
  const url = job.url
  if (!url) {
    done()
    return
  }
  try {
    uni.downloadFile({
      url: url,
      success(res) {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          done()
          return
        }
        // 转成持久文件：这一步成功之后，App 重启这张图也还在
        uni.saveFile({
          tempFilePath: res.tempFilePath,
          success(sv) {
            const p = sv && sv.savedFilePath
            if (p) {
              markSaved(fileID, p)
              if (job.onSaved) job.onSaved(fileID, p)
              // 下载途中又被请求过的那些回调，一并通知
              const reg = inflight[fileID]
              if (reg && reg.callbacks) {
                reg.callbacks.forEach(function (cb) {
                  if (cb && cb !== job.onSaved) cb(fileID, p)
                })
              }
            }
            done()
          },
          fail() {
            // 平台不支持持久化就放弃缓存，图片照旧用云链接显示
            done()
          }
        })
      },
      fail() {
        done()
      }
    })
  } catch (e) {
    done()
  }
}

/**
 * 把一张图下载并保存到手机本地。
 * 同一张图不会重复排队；已经存过的直接回调。
 * @param onSaved 保存成功后回调 (fileID, localPath)，页面用它把 displayUrl 换成本地路径
 */
export function ensureLocalImage(fileID, url, onSaved) {
  if (!fileID || !url) return
  const have = getLocalImage(fileID)
  if (have) {
    if (onSaved) onSaved(fileID, have)
    return
  }
  // 已经在队列里就别重复排；已经在下载中的更不能重复排
  for (let i = 0; i < queue.length; i++) {
    if (queue[i].fileID === fileID) {
      if (onSaved) queue[i].onSaved = onSaved
      return
    }
  }
  if (inflight[fileID]) {
    // 正在下载：把回调追加到登记表上，下载完一并通知
    inflight[fileID].callbacks.push(onSaved)
    return
  }
  inflight[fileID] = { callbacks: onSaved ? [onSaved] : [] }
  queue.push({ fileID: fileID, url: url, onSaved: onSaved })
  runNext()
}

/**
 * 忘掉某一张图的本地文件记录。
 * 图片加载失败时调用：那条 file:// 路径已经不可用了（被系统清理或损坏），
 * 必须把记录删掉，否则下次还会拿到同一个坏路径，一直白框、反复失败。
 * 注意只删记录、不删文件（文件可能本就不在了，removeSavedFile 会报错）。
 */
export function forgetLocalImage(fileID) {
  if (!fileID) return
  const c = load()
  if (!c[fileID]) return
  delete c[fileID]
  persist()
}

/** 清掉全部本地图片文件（设置页或排障时用） */
export function clearLocalImages() {
  const c = load()
  Object.keys(c).forEach(function (id) {
    dropFile(c[id] && c[id].path)
  })
  mem = {}
  persist()
}

export function localImageCount() {
  return Object.keys(load()).length
}

export default { getLocalImage, ensureLocalImage, forgetLocalImage, clearLocalImages, localImageCount }
