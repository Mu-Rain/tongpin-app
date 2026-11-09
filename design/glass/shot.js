// 用 CDP 逐屏截图：node shot.js <screen> <out.png> [width] [height] [dsf]
// 依赖一个已带 --remote-debugging-port=9222 的 Edge 实例（headless）。
const http = require('http')
const net = require('net')
const crypto = require('crypto')
const fs = require('fs')

const SCREEN = process.argv[2] || 'home'
const OUT = process.argv[3] || `.shot/${SCREEN}.png`
const W = parseInt(process.argv[4] || '390', 10)
const H = parseInt(process.argv[5] || '844', 10)
const DSF = parseFloat(process.argv[6] || '2')
const PAGE = process.argv[7] || 'dazi-app/design/glass/index.html'

function httpGet(path) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: 9222, path }, r => {
      let d = ''
      r.on('data', c => (d += c))
      r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } })
    }).on('error', rej)
  })
}

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const key = crypto.randomBytes(16).toString('base64')
    const sock = net.connect(parseInt(u.port, 10), u.hostname, () => {
      sock.write(
        'GET ' + u.pathname + ' HTTP/1.1\r\n' +
        'Host: ' + u.host + '\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      )
    })
    let handshook = false
    let buf = Buffer.alloc(0)
    const handlers = []
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk])
      if (!handshook) {
        const idx = buf.indexOf('\r\n\r\n')
        if (idx < 0) return
        const head = buf.slice(0, idx).toString()
        if (!head.includes('101')) { reject(new Error('handshake: ' + head)); return }
        handshook = true
        buf = buf.slice(idx + 4)
        resolve({
          send(obj) {
            const payload = Buffer.from(JSON.stringify(obj))
            const len = payload.length
            const mask = crypto.randomBytes(4)
            let header
            if (len < 126) { header = Buffer.alloc(6); header[0] = 0x81; header[1] = 0x80 | len; mask.copy(header, 2) }
            else if (len < 65536) { header = Buffer.alloc(8); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); mask.copy(header, 4) }
            else { header = Buffer.alloc(14); header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); mask.copy(header, 10) }
            const masked = Buffer.alloc(len)
            for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4]
            sock.write(Buffer.concat([header, masked]))
          },
          onMessage(fn) { handlers.push(fn) },
          close() { sock.destroy() }
        })
      }
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f
        const isMasked = (buf[1] & 0x80) !== 0
        let len = buf[1] & 0x7f
        let off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        if (isMasked) off += 4
        if (buf.length < off + len) return
        const data = buf.slice(off, off + len)
        buf = buf.slice(off + len)
        if (opcode === 1) handlers.forEach(h => h(data.toString()))
        else if (opcode === 8) { sock.destroy(); return }
      }
    })
    sock.on('error', reject)
  })
}

;(async () => {
  const list = await httpGet('/json/list')
  // 只认普通网页目标：Edge 自带的 edge:// 页面会吃掉 Page.enable，不能当靶子
  const usable = x =>
    x.type === 'page' && !/^(edge|chrome|devtools):/i.test(x.url || '')
  let page = list.find(usable)
  if (!page) {
    page = await new Promise((res, rej) => {
      http.get({ host: '127.0.0.1', port: 9222, path: '/json/new?about:blank' }, r => {
        let d = ''
        r.on('data', c => (d += c))
        r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } })
      }).on('error', rej)
    })
  }
  const ws = await wsConnect(page.webSocketDebuggerUrl)
  let id = 1
  const pending = {}
  ws.onMessage(txt => {
    const m = JSON.parse(txt)
    if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id] }
  })
  function cmd(method, params, timeout) {
    return new Promise((res, rej) => {
      const myId = id++
      pending[myId] = res
      ws.send({ id: myId, method, params: params || {} })
      setTimeout(() => { if (pending[myId]) { pending[myId] = null; rej(new Error('timeout ' + method)) } }, timeout || 20000)
    })
  }

  await cmd('Page.enable')
  await cmd('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: DSF, mobile: true, screenWidth: W, screenHeight: H
  })
  const fileUrl = 'file:///' + require('path').resolve(PAGE).replace(/\\/g, '/') +
    (SCREEN === 'all' ? '' : '?s=' + SCREEN)
  await cmd('Page.navigate', { url: fileUrl })
  await new Promise(r => setTimeout(r, 1200))
  // 等字体与 backdrop-filter 稳定
  await cmd('Runtime.evaluate', { expression: 'document.fonts && document.fonts.status', returnByValue: true })
  await new Promise(r => setTimeout(r, 500))

  const shot = await cmd('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true })
  if (!shot.result || !shot.result.data) throw new Error('no image: ' + JSON.stringify(shot).slice(0, 300))
  fs.mkdirSync(require('path').dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
  console.log('OK ' + OUT + ' ' + fs.statSync(OUT).size + ' bytes  (' + W + 'x' + H + ' dsf' + DSF + ')')
  ws.close()
  setTimeout(() => process.exit(0), 150)
})().catch(e => { console.error('ERR ' + e.message); process.exit(1) })
