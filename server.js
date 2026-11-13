// VR Workspace host: serves the app, proxies WHEP to MediaMTX, relays live settings, and runs MediaMTX.
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFile, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { LAYOUT_SPEC, MONITOR_SPEC, LENS_SPEC, complete } from './app/params.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PARAMS_FILE = path.join(ROOT, 'params.json')
// `node server.js --settings`: VR Workspace is off, but its GNOME settings window is open and needs the settings.
// Nothing is streamed (no MediaMTX, so no capture and no sound output) and only this PC is listened to.
const SETTINGS_ONLY = process.argv.includes('--settings')
const BG = path.join(ROOT, 'app/bg')
// The 360 backgrounds on offer: every file in app/bg (setup.sh puts photos there, a 360 video dropped in works too).
const backgrounds = () => fs.existsSync(BG) ? fs.readdirSync(BG).filter(f => !f.startsWith('.')) : []
const MOUNTS = [
  ['/three/', path.join(ROOT, 'node_modules/three/build/')],
  ['/', path.join(ROOT, 'app/')],
]
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.crt': 'application/x-x509-ca-cert',
}

// What capture.py will publish and allows. monitors: [{ id, name, virtual }], real ones first, then the virtual
// ones the settings ask for; maxVirtual; virtualSizes.
let CAPTURE
const readMonitors = () => { CAPTURE = JSON.parse(execFileSync(path.join(ROOT, 'capture.py'), ['--list'], { encoding: 'utf8' })) }
// Pages reload themselves when this changes, that is after an update of their code.
const BUILD = Math.max(...fs.readdirSync(path.join(ROOT, 'app'))
  .filter(f => /\.(js|html)$/.test(f)).map(f => fs.statSync(path.join(ROOT, 'app', f)).mtimeMs))
try {
  readMonitors()
} catch (e) {
  console.error('Cannot get the list of monitors from GNOME (a GNOME session is required):', e.message)
  process.exit(1)
}

let params = {}
try { params = JSON.parse(fs.readFileSync(PARAMS_FILE, 'utf8')) } catch {}
let phoneSeen = 0 // when a device other than this PC last asked for the settings
// The headset's view direction, for the spectator page (index.html?spectator); the phone sends it only while
// somebody watches, which it learns from `spectator` in the settings answer.
let pose = 'null', spectatorSeen = 0
// State that is not a setting, so it is not saved: fullscreen is reported by the GNOME extension, passthrough (the
// phone camera as the background) is switched by POST /toggle/passthrough, which a keyboard shortcut can call.
const live = { fullscreen: false, passthrough: false, grab: false, wheelSize: 0, wheelCurve: 0, wheelDist: 0 }
// Arranging monitors with the mouse: whoever holds the mouse (the GNOME extension on Num Lock, or the control page)
// says `edit: true` every second, sends the left button as `grab` and wheel steps as `wheel...: +1 / -1`, which are
// added up here for the phone to read. A holder that died stops saying `edit`, and the mode ends.
let editSeen = 0

async function readBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1e6) throw new Error('body too large')
  }
  return body
}

function sendFile(req, res, file) {
  let stat
  try { stat = fs.statSync(file) } catch {}
  if (!stat?.isFile()) return res.writeHead(404).end('not found')
  const headers = { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'accept-ranges': 'bytes' }
  // Safari refuses to play a video unless the server answers byte-range requests.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (!range) return fs.createReadStream(file).pipe(res.writeHead(200, { ...headers, 'content-length': stat.size }))
  const start = range[1] ? +range[1] : Math.max(0, stat.size - +range[2])
  const end = range[1] && range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1
  if (start > end) return res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end()
  res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${stat.size}` })
  fs.createReadStream(file, { start, end }).pipe(res)
}

async function handle(req, res) {
  const { pathname: url, searchParams } = new URL(req.url, 'http://x')

  // The stream is the user's whole desktop: other devices must open the link with the key once (it is then kept in a cookie).
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
  if (!local && url !== '/ca.crt') {
    if (searchParams.get('k') === TOKEN) res.setHeader('set-cookie', `k=${TOKEN}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Strict`)
    else if (!req.headers.cookie?.split('; ').includes(`k=${TOKEN}`)) return res.writeHead(403).end('Open the full link with ?k=... that the server printed on start')
  }

  const stream = /^\/whep\/(\w+)$/.exec(url)
  if (stream && req.method === 'POST' && (stream[1] === 'audio' || CAPTURE.monitors.some(m => m.id === stream[1]))) {
    const r = await fetch(`http://127.0.0.1:8889/vr/${stream[1]}/whep`, { method: 'POST', headers: { 'content-type': 'application/sdp' }, body: await readBody(req) })
    return res.writeHead(r.status, { 'content-type': 'application/sdp' }).end(await r.text())
  }

  if (url === '/toggle/passthrough' && req.method === 'POST') {
    live.passthrough = !live.passthrough
    return res.writeHead(204).end()
  }

  if (url === '/pose' && req.method === 'POST') {
    const sent = JSON.parse(await readBody(req))
    if (!Array.isArray(sent) || sent.length !== 6 || !sent.every(Number.isFinite)) throw new SyntaxError('six numbers expected')
    pose = JSON.stringify(sent)
    return res.writeHead(204).end()
  }
  if (url === '/pose') {
    spectatorSeen = Date.now()
    return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(pose)
  }

  // Live settings: pages poll GET a few times a second, POST merges a JSON object into them (null removes a key).
  // Polling, not server-sent events: pushes did not reach Safari on the iPhone, plain requests do.
  if (url === '/params' && req.method === 'POST') {
    const patch = JSON.parse(await readBody(req))
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SyntaxError('object expected')
    if ('edit' in patch) editSeen = patch.edit === true ? Date.now() : 0
    // `toggle: "m1.hidden"` flips that monitor's visibility: the keys 1-4 of the arranging mode do not know its state.
    const flip = /^(m\d)\.hidden$/.exec(patch.toggle)
    if (flip && CAPTURE.monitors.some(m => m.id === flip[1])) patch[patch.toggle] = !params[patch.toggle]
    delete patch.toggle
    delete patch.edit
    for (const key of Object.keys(live)) {
      const sent = patch[key]
      if (typeof sent === 'boolean' && typeof live[key] === 'boolean') live[key] = sent
      if (Number.isFinite(sent) && typeof live[key] === 'number') live[key] += sent
      delete patch[key]
    }
    if (Object.keys(patch).length) {
      for (const [key, value] of Object.entries(patch)) value === null ? delete params[key] : params[key] = value
      // Written aside and renamed: a rename is atomic, so a crash never leaves half a file (all settings would be
      // lost), and capture.py never reads one.
      fs.writeFileSync(PARAMS_FILE + '.tmp', JSON.stringify(params, null, 2))
      fs.renameSync(PARAMS_FILE + '.tmp', PARAMS_FILE)
    }
    if ('virtual' in patch || 'virtualSize' in patch) { // capture.py reads them when MediaMTX starts it again
      readMonitors()
      if (mtx) spawn('pkill', ['-INT', '-P', String(mtx.pid)]) // only the capture.py started by our own MediaMTX
    }
    return res.writeHead(204).end()
  }
  if (url === '/params') {
    if (!local) phoneSeen = Date.now()
    const answer = { ...params, ...CAPTURE, ...live, edit: Date.now() - editSeen < 2500, build: BUILD, phoneOnline: Date.now() - phoneSeen < 2000, spectator: Date.now() - spectatorSeen < 2000, settingsOnly: SETTINGS_ONLY }
    // ?full: with the defaults filled in, for the GNOME settings window (the pages do that themselves)
    return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(searchParams.has('full') ? complete(answer) : answer))
  }
  // What only this PC may know, for the GNOME settings window: the links for the phone (with the key) and the
  // ranges of the settings.
  if (url === '/host' && local) {
    return res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ phone: PHONE_URL, ca: CA_URL, bgDir: BG, layout: LAYOUT_SPEC, monitor: MONITOR_SPEC, lens: LENS_SPEC }))
  }

  if (url === '/bgs') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(backgrounds().map(f => 'bg/' + f)))
  // A small picture of a background for a gallery: the middle of the panorama (what is ahead), a frame from 1 s
  // into a video. Made by ffmpeg when first asked for and kept in app/bg/.thumbs.
  const thumb = /^\/thumb\/([^/]+)$/.exec(url)
  if (thumb) {
    const name = decodeURIComponent(thumb[1])
    if (!backgrounds().includes(name)) return res.writeHead(404).end('not found')
    const source = path.join(BG, name), small = path.join(BG, '.thumbs', name + '.jpg')
    if (!(fs.statSync(small, { throwIfNoEntry: false })?.mtimeMs > fs.statSync(source).mtimeMs)) {
      fs.mkdirSync(path.dirname(small), { recursive: true })
      await promisify(execFile)('ffmpeg', ['-v', 'error', '-y', ...(/\.(mp4|webm|mov)$/i.test(name) ? ['-ss', '1'] : []), '-i', source,
        '-frames:v', '1', '-vf', 'crop=iw/2:ih/2,scale=480:-2', '-q:v', '4', small])
    }
    return sendFile(req, res, small)
  }
  if (url === '/ca.crt') return sendFile(req, res, path.join(ROOT, 'certs/ca.crt'))

  const [prefix, dir] = MOUNTS.find(([p]) => url.startsWith(p))
  const file = path.join(dir, decodeURIComponent(url.slice(prefix.length)) || 'index.html')
  if (!file.startsWith(dir)) return res.writeHead(403).end() // an encoded ../ must not leave the mount
  sendFile(req, res, file)
}

const listener = (req, res) => handle(req, res).catch(e => {
  if (!res.headersSent) res.writeHead(e instanceof SyntaxError || e instanceof URIError ? 400 : 502)
  res.end(String(e.message))
})

let tls, TOKEN
try {
  TOKEN = fs.readFileSync(path.join(ROOT, 'certs/token'), 'utf8').trim()
  tls = { key: fs.readFileSync(path.join(ROOT, 'certs/server.key')), cert: fs.readFileSync(path.join(ROOT, 'certs/server.crt')) }
} catch {
  console.error('No certificates or MediaMTX yet: run ./setup.sh first')
  process.exit(1)
}

const PHONE_URL = `https://${os.hostname()}.local:8443/?k=${TOKEN}`, CA_URL = `http://${os.hostname()}.local:8080/ca.crt`
let mtx
if (SETTINGS_ONLY) {
  http.createServer(listener).listen(8080, '127.0.0.1')
  console.log('Settings only, for the GNOME settings window: nothing is streamed')
} else {
  mtx = spawn(path.join(ROOT, 'bin/mediamtx'), ['mediamtx.yml'], { stdio: 'inherit', cwd: ROOT }) // cwd: mediamtx.yml runs ./capture.py
  let stopping = false
  mtx.on('exit', code => process.exit(stopping ? 0 : code ?? 1))
  mtx.on('error', e => { console.error('MediaMTX did not start:', e.message); process.exit(1) })
  process.on('exit', () => mtx.kill())
  // Asked to stop: MediaMTX is stopped and waited for (the line above then ends us). It in turn waits for the
  // capture, which removes its sound output. Leaving first would have systemd kill them halfway through that.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      stopping = true
      mtx.kill()
      setTimeout(() => process.exit(1), 5000).unref() // MediaMTX hung: do not hang with it
    })
  }

  http.createServer(listener).listen(8080)
  https.createServer(tls, listener).listen(8443)
  console.log('PC:    http://localhost:8080/control.html (settings)   http://localhost:8080/ (preview)')
  console.log(`Phone: ${PHONE_URL}   (once before that: ${CA_URL})`)
}
