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
import { cleanOrder } from './orders.js'

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
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
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

// --- single application windows in the headset. The GNOME extension tells which windows are open and which of them
// the user wants there; windows.py records those and works them. A wanted window that is open takes a slot and is
// one more panel in the list of monitors, cut out of its stream (`crop`: left, top, width, height in the picture).
// Eight: each is a stream of its own (12 Mbit/s, a hardware encoder, about 200 MB of graphics memory), and dialogs count.
const WINDOW_SLOTS = Array.from({ length: 8 }, (_, i) => `w${i}`)
let openWindows = []            // [{ id, title, w, h, left, top, parent }], as the extension last told; parent: the window a dialog belongs to, or 0
const wantedWindows = new Map() // GNOME's window id -> slot, in the order they came into the headset
let activeWindow = null, activeAt = 0, activeSince = 0 // the window the headset's pointer is in, when it last did something there, and since when
let headsetClick = { at: 0, in: null } // when the headset last clicked, and in which window (null: it started an application)
const adopted = new Map()       // window id -> the window it is taken for a dialog of: it opened right after a click there, naming no parent
let windowsTold = false         // whether the extension has told the open windows once: before that, none is new
let focusedWindow = 0           // the window that gets the keyboard on the PC, as the extension last told
let resizeWish = null, resizeAt = 0 // { id, w, h, edge }: a size the headset asked for a window, until the extension has taken it
let windowsModule               // the windows.py process, started when first needed
// The headset's own list of applications: the extension tells which are installed (name and icon file), the headset
// shows them and names one to start, and the extension starts it and shows its window.
let apps = []    // [{ id, name, icon }]
let launch = null // the application the headset asked for, until the extension has taken it
// In the order the windows came into the headset: it draws the later ones on top, as a dialog over its window.
// A dialog's panel names the panel of its window (`over`).
const windowPanels = () => [...wantedWindows].map(([id, slot]) => [openWindows.find(w => w.id === id), slot]).filter(([w]) => w)
  .map(([w, slot]) => ({ id: slot, name: w.title, window: true, crop: [w.left, w.top, w.w, w.h], source: w.id, over: wantedWindows.get(w.parent || adopted.get(w.id)), popups: w.popups,
    focused: w.id === focusedWindow }))
function tellWindows(order) {
  if (!windowsModule) {
    windowsModule = spawn(path.join(ROOT, 'windows.py'), { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] })
    windowsModule.on('exit', () => { windowsModule = null })
    windowsModule.stdin.on('error', () => {}) // it died: the next order starts it again
    // A stream that ended without being told to (GNOME stopped the sharing, or the encoder failed): that window
    // leaves the headset. Asking again by ourselves would work against a user who pressed "stop".
    windowsModule.stdout.on('data', text => {
      for (const line of String(text).split('\n').filter(Boolean)) {
        const said = JSON.parse(line)
        for (const [id, slot] of wantedWindows) if (said.live === false && slot === said.slot) wantedWindows.delete(id)
      }
    })
  }
  windowsModule.stdin.write(JSON.stringify(order) + '\n')
}
function syncWindows() {
  for (const id of new Set([...wantedWindows.keys(), ...adopted.keys()])) { // it was closed
    if (!openWindows.some(w => w.id === id)) { wantedWindows.delete(id); adopted.delete(id) }
  }
  if (SETTINGS_ONLY || (!wantedWindows.size && !windowsModule)) return
  tellWindows({ streams: Object.fromEntries(windowPanels().map(p => [p.id, { id: p.source, left: p.crop[0], top: p.crop[1] }])) })
}
process.on('exit', () => windowsModule?.kill())

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
  if (stream && req.method === 'POST' && (stream[1] === 'audio' || [...CAPTURE.monitors, ...windowPanels()].some(m => m.id === stream[1]))) {
    const r = await fetch(`http://127.0.0.1:8889/vr/${stream[1]}/whep`, { method: 'POST', headers: { 'content-type': 'application/sdp' }, body: await readBody(req) })
    return res.writeHead(r.status, { 'content-type': 'application/sdp' }).end(await r.text())
  }

  // From the GNOME extension, so from this PC only: the windows that are open, and the user's wish to have one in
  // the headset or out of it. The answer tells the extension which are shown and which one to bring to the front.
  if (url === '/windows' && req.method === 'POST' && local) {
    const told = JSON.parse(await readBody(req))
    let opened = [] // windows that were not there at the last report
    if (Number.isFinite(told?.focus)) focusedWindow = told.focus
    if (Array.isArray(told?.open)) {
      const before = new Set(openWindows.map(w => w.id))
      openWindows = told.open.filter(w => [w?.id, w?.left, w?.top].every(Number.isFinite) && w.w > 0 && w.h > 0)
        .map(w => ({ id: w.id, title: String(w.title).slice(0, 80), w: w.w, h: w.h, left: w.left, top: w.top, parent: Number.isFinite(w.parent) ? w.parent : 0, type: w.type,
          popups: (Array.isArray(w.popups) ? w.popups : []).filter(r => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && r[2] > 0 && r[3] > 0).slice(0, 3) }))
      opened = windowsTold ? openWindows.filter(w => !before.has(w.id)) : []
      windowsTold = true
    }
    if (Array.isArray(told?.apps)) {
      apps = told.apps.slice(0, 500).filter(a => typeof a?.id === 'string' && typeof a.name === 'string')
        .map(a => ({ id: a.id.slice(0, 200), name: a.name.slice(0, 60), icon: String(a.icon ?? '') }))
    }
    // toggle: the user's choice in the menu of the top bar; show: the window of an application started from the headset
    const freeSlot = () => WINDOW_SLOTS.find(s => ![...wantedWindows.values()].includes(s))
    if (wantedWindows.has(told?.toggle)) { // out of the headset, and its dialogs with it
      for (const w of openWindows) if ([w.id, w.parent, adopted.get(w.id)].includes(told.toggle)) wantedWindows.delete(w.id)
    } else if ([told?.toggle, told?.show].some(id => openWindows.some(w => w.id === id) && !wantedWindows.has(id))) {
      if (freeSlot()) wantedWindows.set(told.toggle ?? told.show, freeSlot())
    }
    // A dialog of a window that is in the headset goes there too: who looks only into the headset would not know
    // that it opened. (A dialog of a dialog follows with the next report.) So does any window that opens soon after
    // a click from the headset: a file chooser that another program shows (Flatpak applications ask the system for
    // it, and GNOME does not know whose it is), the second window of an application, the main window after a splash.
    // Opened after a click in a window and naming no parent, it is taken for a dialog of that window: it lies on it,
    // as large as its text, and leaves the headset with it.
    const soon = Date.now() - headsetClick.at < 15000
    for (const w of openWindows) {
      if (wantedWindows.has(w.id) || !freeSlot() || !(wantedWindows.has(w.parent) || (soon && opened.includes(w)))) continue
      wantedWindows.set(w.id, freeSlot())
      if (!w.parent && soon && wantedWindows.has(headsetClick.in)) adopted.set(w.id, headsetClick.in)
    }
    // For finding out why a window did not come into the headset. The title only of those that did: the journal is kept for weeks.
    for (const w of opened) console.log(`window opened: type ${w.type}, ${w.w}x${w.h}${w.parent ? ', a dialog' : ''}${wantedWindows.has(w.id) ? `, shown in the headset: "${w.title}"` : ''}`)
    syncWindows()
    // `active` only while the pointer is at work there: otherwise the desktop's own choice of window stands
    // soon: a window is being resized from the headset; the extension then asks again in a tenth of a second
    const answer = { shown: [...wantedWindows.keys()], active: Date.now() - activeAt < 1000 ? activeWindow : null, launch, needApps: !apps.length,
      resize: resizeWish, soon: Date.now() - resizeAt < 1000 }
    launch = resizeWish = null
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer))
  }
  // For the headset's list of applications: names and GNOME's ids in order (the user's own places in the list are
  // kept by id), each one's icon, and the wish to start one.
  if (url === '/apps') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(apps.map(({ id, name }) => ({ id, name }))))
  const icon = /^\/appicon\/(\d+)$/.exec(url)
  if (icon) { // only picture files, and only those the extension named
    const file = apps[icon[1]]?.icon ?? ''
    return ['.png', '.svg'].includes(path.extname(file)) ? sendFile(req, res, file) : res.writeHead(404).end('no icon')
  }
  if (url === '/launch' && req.method === 'POST') {
    const wish = JSON.parse(await readBody(req))
    if (!apps[wish?.app]) throw new SyntaxError('the number of an application expected')
    launch = apps[wish.app].id
    headsetClick = { at: Date.now(), in: null }
    return res.writeHead(204).end()
  }
  // From the headset: a new size for a window it shows, dragged at a side or corner (edge: left, right, top, bottom as
  // 0 or 1: the opposite sides stay where they are). The extension resizes the window.
  if (url === '/resize' && req.method === 'POST') {
    const wish = JSON.parse(await readBody(req)), panel = windowPanels().find(p => p.id === wish?.to)
    const size = n => Number.isInteger(n) && n >= 150 && n <= 8192
    if (!panel || !size(wish.w) || !size(wish.h) || !Array.isArray(wish.edge) || wish.edge.length !== 4 || !wish.edge.every(e => e === 0 || e === 1)) throw new SyntaxError('a window, a size and its sides expected')
    resizeWish = { id: panel.source, w: wish.w, h: wish.h, edge: wish.edge }
    resizeAt = Date.now()
    return res.writeHead(204).end()
  }
  // From capture.py: GNOME's own "stop sharing" button was pressed. That switches VR Workspace off.
  if (url === '/stop' && req.method === 'POST' && local) {
    res.writeHead(204).end()
    return process.kill(process.pid, 'SIGTERM')
  }
  // From the headset: the pointer, the buttons, the wheel and keys for a window it shows.
  if (url === '/input' && req.method === 'POST') {
    const panels = windowPanels(), areas = Object.fromEntries(panels.map(p => [p.id, [[0, 0, ...p.crop.slice(2)], ...p.popups]]))
    const orders = JSON.parse(await readBody(req))
    if (!Array.isArray(orders) || orders.length > 50) throw new SyntaxError('a short list of orders expected')
    for (const order of orders.map(o => cleanOrder(o, areas)).filter(Boolean)) {
      const source = panels.find(p => p.id === order.to).source
      if (source !== activeWindow) activeSince = Date.now()
      activeWindow = source
      activeAt = Date.now()
      // A press must not come before the extension had the time to bring this window to the front (it asks twice a
      // second): it would land on whatever covers the window on the desktop.
      if (order.down && 'button' in order && Date.now() - activeSince < 700) {
        console.log('a press from the headset was held back: its window was brought to the front less than 0.7 s ago')
        continue
      }
      if (order.down && 'button' in order) headsetClick = { at: Date.now(), in: source }
      // Until the trouble with VLC's file chooser (2026-11-19) is understood: every button from the headset.
      if ('button' in order) console.log(`input: button ${order.button} ${order.down ? 'down' : 'up'} in ${order.to} (window ${source}) at ${Math.round(order.x)},${Math.round(order.y)}`)
      tellWindows(order)
    }
    return res.writeHead(204).end()
  }

  if (url === '/toggle/passthrough' && req.method === 'POST') {
    live.passthrough = !live.passthrough
    return res.writeHead(204).end()
  }

  if (url === '/pose' && req.method === 'POST') {
    // Only the phone's: a preview page left open on this PC sends its own, and the spectator jumped between the two.
    if (local) return res.writeHead(204).end()
    const sent = JSON.parse(await readBody(req))
    // head (4), anchor (2), the list of applications (open, yaw, pitch, the icon carried), the mouse (2), our pointer (3)
    if (!Array.isArray(sent) || sent.length !== 15 || !sent.every(Number.isFinite)) throw new SyntaxError('fifteen numbers expected')
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
    // capture.py reads the number and the sizes of the virtual monitors when MediaMTX starts it again
    if ('virtual' in patch || 'virtualSize' in patch || Object.keys(patch).some(key => /^m\d\.size$/.test(key))) {
      readMonitors()
      if (mtx) spawn('pkill', ['-INT', '-P', String(mtx.pid)]) // only the capture.py started by our own MediaMTX
    }
    return res.writeHead(204).end()
  }
  if (url === '/params') {
    if (!local) phoneSeen = Date.now()
    const monitors = [...CAPTURE.monitors, ...windowPanels()] // with `source`: the page tells by it that a place in the list holds another window now
    const answer = { ...params, ...CAPTURE, monitors, ...live, edit: Date.now() - editSeen < 2500, build: BUILD, phoneOnline: Date.now() - phoneSeen < 2000, spectator: Date.now() - spectatorSeen < 2000, settingsOnly: SETTINGS_ONLY }
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
