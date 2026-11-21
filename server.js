// VR Workspace host: serves the app, proxies WHEP to MediaMTX, relays live settings, and runs MediaMTX.
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn, spawnSync, execFile, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { LAYOUT_SPEC, MONITOR_SPEC, LENS_SPEC, complete } from './app/params.js'
import { cleanOrder, HOME, blocked, passKey, wrongKey } from './orders.js'

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
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
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
const refused = new Map() // address from the internet -> { count, since }: its wrong keys (orders.js: blocked, wrongKey)
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
let menuOpenAt = 0 // when the headset page last said its list of applications is open (it says so every second)
// A headset on a cable: its picture (index.html?glasses) listens here for what is pushed to it as it comes (`live`:
// the head's turn, the PC's pointer inside a monitor or window), and asks for the PC's mouse to go into the panel our
// pointer is on (`enter`, said again and again while it is over one), which the extension carries out.
const listeners = new Set() // { res, glasses }
const glassesOn = () => [...listeners].some(l => l.glasses)
// While that picture is shown, on this very PC, nothing is compressed for it: raw.py hands it every monitor and
// window as plain pictures, each from a port of its own on this PC (the monitors from RAW_PORT on, the windows ten
// higher), to who gives the key. capture.py reads from .cable.json that it is so, and which monitor shows the
// picture (that one is not taken: a picture of itself); windows.py is told with every order. Three seconds longer
// than the picture is there: reloaded, it is back at once.
const RAW_PORT = 8700
Object.assign(process.env, { VR_RAW_PORT: String(RAW_PORT), VR_RAW_KEY: crypto.randomBytes(16).toString('hex') }) // for capture.py and windows.py
const CABLE_FILE = path.join(ROOT, '.cable.json')
let pictureScreen = null, glassesSeen = 0, cableTold = 'null' // pictureScreen: the GNOME connector of the monitor that shows the picture, from the extension
const cableOn = () => glassesOn() || Date.now() - glassesSeen < 3000
function tellCable() {
  if (glassesOn()) glassesSeen = Date.now()
  const now = JSON.stringify(cableOn() ? { screen: pictureScreen } : null)
  if (now === cableTold) return
  cableTold = now
  if (now === 'null') return fs.rmSync(CABLE_FILE, { force: true })
  fs.writeFileSync(CABLE_FILE + '.new', now) // put in place whole: half a file would read as "no cable"
  fs.renameSync(CABLE_FILE + '.new', CABLE_FILE)
}
fs.rmSync(CABLE_FILE, { force: true }) // left by a run that was killed
setInterval(tellCable, 1000)
process.on('exit', () => fs.rmSync(CABLE_FILE, { force: true }))
const push = (event, data) => {
  for (const l of listeners) {
    // A reader that stopped reading (its page hangs) would have everything kept here for it: let go (EventSource comes back)
    if (l.res.writableLength > 1e6) { listeners.delete(l); l.res.destroy(); continue }
    l.res.write(`event: ${event}\ndata: ${data}\n\n`)
  }
}
let connectors = {}, connectorsAt = 0 // capture.py's .connectors.json (which GNOME connector each monitor is), read at most every 2 s
let enter = { at: 0 }, enterQuiet = 0 // where the glasses page asks the PC's mouse into a monitor or window; no asks taken before enterQuiet
// Keys of the phone's keyboard held down in windows ("w0 30" -> the order). Should the phone go silent meanwhile (its
// Wi-Fi gone, its battery flat), they are let go: else they would stay pressed on the PC, Ctrl for ever.
const keysHeld = new Map()
setInterval(() => {
  if (!keysHeld.size || Date.now() - phoneSeen < 3000) return
  for (const order of keysHeld.values()) tellWindows({ ...order, down: false })
  keysHeld.clear()
}, 1000)

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
let cursor = { n: 0 }           // the PC's pointer, as the extension last told: { n: its pictures so far, png (empty: hidden), hot: [x, y] }
let note = null, notes = 0      // the PC's latest notification, for 10 s: { n, app, title, body, icon: its file }; how many so far
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
  // need: how much of its picture a window uses, from the top left: itself and its open menus (which may reach out of it)
  tellWindows({ raw: cableOn(), streams: Object.fromEntries(windowPanels().map(p => [p.id, { id: p.source, left: p.crop[0], top: p.crop[1],
    need: [0, 1].map(k => Math.ceil(p.crop[k] + Math.max(p.crop[2 + k], ...p.popups.map(r => r[k] + r[2 + k])))) }])) })
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
  // An address from the internet (not of the home network) that gave 10 wrong keys within an hour is not answered for
  // the rest of that hour, and the journal tells of it, as of every opening of the link from the internet.
  const from = req.socket.remoteAddress, local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(from), home = HOME.test(from)
  // Without the key: the CA certificate (to be installed first), and what Android fetches for a home screen icon
  // without cookies (the manifest and its icons). Nothing in them is private.
  if (!local && !['/ca.crt', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'].includes(url)) {
    if (blocked(refused, from)) return res.writeHead(403).end()
    if (searchParams.get('k') === TOKEN) {
      res.setHeader('set-cookie', `k=${TOKEN}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Strict`)
      if (!home) console.log(`the phone link was opened from the internet, from ${from}`)
    } else if (!req.headers.cookie?.split('; ').includes(`k=${TOKEN}`)) {
      if (wrongKey(refused, from)) console.log(`blocked for an hour: ${from}, 10 wrong keys`)
      return res.writeHead(403).end('Open the full link with ?k=... that the server printed on start')
    }
  }

  // The phone's microphone, while the setting is on: published to MediaMTX (WHIP), which has mic.py play it into the
  // PC's microphone "VR-Headset" (mediamtx.yml).
  if (url === '/whip/mic' && req.method === 'POST' && params.phoneMic) {
    const r = await fetch('http://127.0.0.1:8889/vr/mic/whip', { method: 'POST', headers: { 'content-type': 'application/sdp' }, body: await readBody(req) })
    return res.writeHead(r.status, { 'content-type': 'application/sdp' }).end(await r.text())
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
    if (told && 'picture' in told) { // the monitor that shows the picture of a headset on a cable, of those capture.py named
      pictureScreen = Object.values(connectors).includes(told.picture) ? told.picture : null
      tellCable()
    }
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
      resize: resizeWish, soon: Date.now() - resizeAt < 1000, cursor: cursor.n > 0,
      phoneOnline: Date.now() - phoneSeen < 2000, menuOpen: Date.now() - menuOpenAt < 3000, // for the Super key: our list instead of GNOME's overview
      numLock: params.numLock ?? 0, // F12 on the phone's keyboard: the extension presses the PC's Num Lock
      connectors: Object.values(connectors), // GNOME's names of the monitors in the headset: the extension says which shows the picture
      enter: glassesOn() && Date.now() - enter.at < 400 ? enter : null } // the monitor or window the PC's mouse is to go into
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
  // From the extension: the PC pointer's picture (PNG) and its hot spot, whenever its shape changes while windows are
  // in the headset, which draws it over them. The picture is fetched by its number, from /params.
  if (url === '/cursor' && req.method === 'POST' && local) {
    const told = JSON.parse(await readBody(req)), png = Buffer.from(String(told?.png ?? ''), 'base64')
    if (png.length > 262144 || !Array.isArray(told?.hot) || told.hot.length !== 2 || !told.hot.every(Number.isInteger)) throw new SyntaxError('a picture and its hot spot expected')
    cursor = { n: cursor.n + 1, png, hot: told.hot }
    return res.writeHead(204).end()
  }
  // A headset on a cable, from this PC only: what is pushed to its picture as it comes (Server-Sent Events).
  if (url === '/live' && local) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }).write(': open\n\n')
    const listener = { res, glasses: searchParams.has('glasses') }
    listeners.add(listener)
    tellCable()
    req.on('close', () => listeners.delete(listener))
    return
  }
  // From the extension: where the PC's pointer is inside the monitor or window it works in (u, v: 0..1 from its top
  // left), or that it has come out (out). For the headset on a cable, which draws it.
  if (url === '/pointer' && req.method === 'POST' && local) {
    const told = JSON.parse(await readBody(req))
    const ok = told?.out === true || (/^[mw]\d+$/.test(told?.id) && [told.u, told.v].every(Number.isFinite))
    if (!ok) throw new SyntaxError('a panel and a place, or out, expected')
    push('pointer', JSON.stringify(told.out ? { out: true } : { id: told.id, u: told.u, v: told.v }))
    return res.writeHead(204).end()
  }
  // From the extension: a notification that GNOME shows as a banner. The headset shows it too, for a few seconds.
  if (url === '/notify' && req.method === 'POST' && local) {
    const told = JSON.parse(await readBody(req)), text = (value, length) => String(value ?? '').slice(0, length)
    const icon = text(told?.icon, 500), n = ++notes
    note = { n, app: text(told?.app, 60), title: text(told?.title, 160), body: text(told?.body, 400), icon: ['.png', '.svg'].includes(path.extname(icon)) ? icon : '' }
    setTimeout(() => { if (note?.n === n) note = null }, 10000)
    return res.writeHead(204).end()
  }
  if (url === '/noteicon') return note?.icon ? sendFile(req, res, note.icon) : res.writeHead(404).end('no icon') // only a picture file the extension named
  if (url === '/cursor') return cursor.png?.length ? res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }).end(cursor.png) : res.writeHead(404).end()
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
      if ('key' in order && !passKey(order, source, focusedWindow, keysHeld)) continue // only into the window with the keyboard
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
    // head (4), anchor (2), the list of applications (open, yaw, the icon carried), the mouse (2), our pointer (3),
    // the panel in hand or being resized (index or -1, yaw, pitch, width or 0, shape)
    if (!Array.isArray(sent) || sent.length !== 19 || !sent.every(Number.isFinite)) throw new SyntaxError('nineteen numbers expected')
    pose = JSON.stringify(sent)
    push('pose', pose)
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
    if ('menuOpen' in patch) menuOpenAt = patch.menuOpen === true ? Date.now() : 0
    const e = patch.enter
    if (e && Date.now() > enterQuiet && /^[mw]\d+$/.test(e.id) && Number.isInteger(e.source) && typeof e.connector === 'string' && [e.u, e.v].every(Number.isFinite)
      && Array.isArray(e.corners) && e.corners.length === 4 && e.corners.every(c => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite)))
      enter = { id: e.id, source: e.source, connector: e.connector.slice(0, 40), u: e.u, v: e.v, corners: e.corners, at: Date.now() }
    // The list or the arranging: the pointer stays ours, not inside a panel. Asks already on their way are not taken
    // either: the page learns of it with its next reading of the settings, up to a fifth of a second later.
    if ('menuCall' in patch || 'edit' in patch) [enter, enterQuiet] = [{ at: 0 }, Date.now() + 600]
    delete patch.menuOpen
    delete patch.enter
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
    if (Date.now() - connectorsAt > 2000) { // the pages ask up to 25 times a second
      connectorsAt = Date.now()
      try { connectors = JSON.parse(fs.readFileSync(path.join(ROOT, '.connectors.json'), 'utf8')) } catch { connectors = {} }
    }
    // self: this monitor shows the picture of a headset on a cable, so it is not a panel there
    const monitors = [...CAPTURE.monitors.map(m => ({ ...m, connector: connectors[m.id], self: cableOn() && !!pictureScreen && connectors[m.id] === pictureScreen })), ...windowPanels()] // with `source`: the page tells by it that a place in the list holds another window now
    const answer = { ...params, ...CAPTURE, monitors, ...live, edit: Date.now() - editSeen < 2500, glasses: glassesOn(), ...(local && { raw: { port: RAW_PORT, key: process.env.VR_RAW_KEY } }), build: BUILD, phoneOnline: Date.now() - phoneSeen < 2000, spectator: Date.now() - spectatorSeen < 2000 || glassesOn(), settingsOnly: SETTINGS_ONLY }
    // ?full: with the defaults filled in, for the GNOME settings window (the pages do that themselves)
    return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(searchParams.has('full') ? { ...complete(answer), outside: local ? OUTSIDE_URL : '' }
        : { ...answer, cursor: cursor.n ? [cursor.n, ...cursor.hot, cursor.png.length ? 1 : 0] : null, // the pointer: its picture's number, hot spot, whether shown
          note: note && [note.n, note.app, note.title, note.body, note.icon ? 1 : 0] }))
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
if (TOKEN.length < 12) { // an empty key would let in anyone with "?k=" (a file left empty by a power cut while it was written)
  console.error('The key in certs/token is missing or too short: run ./setup.sh, then open the codes on the phone again')
  process.exit(1)
}

// From outside the home the phone names this PC by its address on the internet (`publicHost`, set in the GNOME
// settings window: an IPv4 address or a name; the router passes 8443 and 8189 on to this PC). The certificate must
// name it too (made anew here when it does not), MediaMTX offers it to the phone for the video, and the desktop gets
// a key that cannot be guessed (the 12 characters of the first ones were enough on the Wi-Fi at home).
const OUTSIDE = SETTINGS_ONLY || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(params.publicHost ?? '') || params.publicHost.length > 50 ? '' : params.publicHost.toLowerCase() // 50: the link must fit the settings window's QR code
if (OUTSIDE && TOKEN.length < 32) {
  TOKEN = crypto.randomBytes(16).toString('hex')
  fs.writeFileSync(path.join(ROOT, 'certs/token.tmp'), TOKEN + '\n') // aside and renamed: never a half-written key
  fs.renameSync(path.join(ROOT, 'certs/token.tmp'), path.join(ROOT, 'certs/token'))
  console.log('A longer key for the phone: open the links from the codes in the settings window again')
}
// At home the phone's link names this PC by its address on the Wi-Fi, not by its name (winsbar.local): the name is
// announced with the addresses of Docker's networks as well, and the phone took one of those and waited for nothing.
let LAN
try { LAN = /src (\S+)/.exec(execFileSync('ip', ['-4', 'route', 'get', '1.1.1.1'], { encoding: 'utf8' }))[1] } catch { LAN = `${os.hostname()}.local` } // no network: the name
// The certificate must name both addresses (the one at home changes when the router gives another): made anew when not.
if (!SETTINGS_ONLY) {
  const cert = new crypto.X509Certificate(tls.cert), named = host => net.isIPv4(host) ? cert.checkIP(host) : cert.checkHost(host)
  if (![LAN, OUTSIDE].filter(Boolean).every(named)) {
    if (spawnSync(path.join(ROOT, 'cert.sh'), OUTSIDE ? [OUTSIDE] : [], { stdio: 'inherit' }).status === 0) {
      tls = { key: fs.readFileSync(path.join(ROOT, 'certs/server.key')), cert: fs.readFileSync(path.join(ROOT, 'certs/server.crt')) }
    } else console.error(`The certificate could not be made for ${[LAN, OUTSIDE].join(' and ')}: the phone will not trust this PC`)
  }
}
const PHONE_URL = `https://${LAN}:8443/?k=${TOKEN}`, CA_URL = `http://${LAN}:8080/ca.crt`
const OUTSIDE_URL = OUTSIDE && `https://${OUTSIDE}:8443/?k=${TOKEN}`
let mtx
if (SETTINGS_ONLY) {
  http.createServer(listener).listen(8080, '127.0.0.1')
  console.log('Settings only, for the GNOME settings window: nothing is streamed')
} else {
  // cwd: mediamtx.yml runs ./capture.py. The address on the internet: a place more where the phone may find the video.
  mtx = spawn(path.join(ROOT, 'bin/mediamtx'), ['mediamtx.yml'], { stdio: 'inherit', cwd: ROOT, env: OUTSIDE ? { ...process.env, MTX_WEBRTCADDITIONALHOSTS: OUTSIDE } : process.env })
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
  if (OUTSIDE) console.log(`Phone from outside the home: ${OUTSIDE_URL}`)
}
