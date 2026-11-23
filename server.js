// VR Workspace host: serves the app, proxies WHEP to MediaMTX, relays live settings, and runs MediaMTX.
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn, spawnSync, execFile, execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { LAYOUT_SPEC, MONITOR_SPEC, LENS_SPEC, complete } from './app/params.js'
import { cleanOrder, HOME, blocked, foreign, passKey, wrongKey } from './orders.js'
import { ask, fileNamed, layoutOf, layoutWindows, linkOf, lookedMost, meant, panelsTold, placePatch, settingsPatch, settingsTold, userFolders } from './assist.js'

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
let picturePose = { text: 'null', at: 0 } // the same from the picture of a headset on a cable, while there is one and somebody watches
// State that is not a setting, so it is not saved: fullscreen is reported by the GNOME extension, passthrough (the
// phone camera as the background) is switched by POST /toggle/passthrough, which a keyboard shortcut can call.
const live = { fullscreen: false, recording: false, passthrough: false, grab: false, grab2: false, assistOn: false, scanning: false, roomReady: false, wheelSize: 0, wheelCurve: 0, wheelDist: 0 } // recording: record.mjs runs, as the extension tells
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
// Ten at most, dialogs counted: each is a stream of its own (12 Mbit/s, a hardware encoder; what ten cost was
// measured on the stand, see the README). And monitors and windows together at most PANELS: the page's shader takes
// one texture for each and five for itself, and a phone's browser (and Chromium) gives a shader sixteen.
const WINDOW_SLOTS = Array.from({ length: 10 }, (_, i) => `w${i}`), PANELS = 11
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
// --- the helper (assist.js): Claude asked from inside the sphere. Its key (Caps Lock, told by the extension) switches
// its mode: while it is on (live.assistOn) the microphone is listened to and the mouse marks places on the panels
// (the pages do that and send each mark's picture here), and at the next press what was said and marked goes to
// Claude. A press while Claude works stops it; a press while it asks "yes or no" is the yes. What goes on shows as a
// card on every page (`assist`), the words as they are heard among it.
let assist = null               // the card: { n, state: listen | think | do | done | ask | fail, text }
let assistN = 0, cardTimer, asking = null, confirming = null, pages = null
let marking = false             // marks are taken: from the mode's start until the request leaves (a mark made just before the second press is still on its way then)
let marks = []                  // { n, kind: window | frame | arrow, id: the panel, rect: [u0, v0, u1, v1] from its top left, about, png }
const exchanges = []            // the last few: { at, said, answer }, so that "a bit more" is understood
// Where the user looks, as the working page tells it when that changes (POST /params, `looked`): the panel under the
// centre of the view ('' for none) and the direction in the layout. looks: the same all through the helper's mode,
// for what "this window" and "here" mean; spoke: what came of them (assist.js, lookedMost), for the request now with Claude.
let gaze = { id: '', yaw: 0, pitch: 0, at: 0 }, looks = [], spoke = null
const pause = ms => new Promise(done => setTimeout(done, ms))
// The helper's ears (listen.py): speech into text on this PC, once ./setup-speech.sh has made .speech/. Started with
// the first use of the mode and kept, its model loaded. heard: who waits for the words of a recording that has ended.
const EARS = path.join(ROOT, '.speech/venv/bin/python')
let ears = null, heard = null
process.on('exit', () => ears?.kill())
function earsTold(word) { // start, stop or cancel; false: there are no ears
  if (!fs.existsSync(EARS)) return false
  if (!ears) {
    const mine = ears = spawn(EARS, [path.join(ROOT, 'listen.py')], { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] })
    const gone = () => { if (ears === mine) { ears = null; heard?.('') } }
    mine.on('exit', gone)
    mine.on('error', gone)
    mine.stdin.on('error', () => {})
    mine.stdout.setEncoding('utf8') // whole letters: a Cyrillic one may be cut in two between two pieces
    let rest = ''
    mine.stdout.on('data', text => {
      const lines = (rest + text).split('\n')
      rest = lines.pop()
      for (const line of lines.filter(Boolean)) {
        let told
        try { told = JSON.parse(line) } catch { continue }
        if (told.partial && live.assistOn) card('listen', `«${told.partial}»`)
        if (typeof told.text === 'string') heard?.(told.text.slice(0, 1000))
        if (told.error) console.log('the helper cannot hear:', told.error)
      }
    })
  }
  ears.stdin.write(word + '\n')
  return true
}
function card(state, text = '', ms = 0) {
  assist = { n: ++assistN, state, text: String(text).slice(0, 400) }
  clearTimeout(cardTimer)
  if (ms) cardTimer = setTimeout(() => { assist = null }, ms)
}
// Settings changed: kept in the file. Written aside and renamed: a rename is atomic, so a crash never leaves half a
// file (all settings would be lost), and capture.py never reads one.
function keep(patch) {
  for (const [key, value] of Object.entries(patch)) value === null ? delete params[key] : params[key] = value
  fs.writeFileSync(PARAMS_FILE + '.tmp', JSON.stringify(params, null, 2))
  fs.renameSync(PARAMS_FILE + '.tmp', PARAMS_FILE)
}
function assistEnd() { // the mode off, nothing sent
  live.assistOn = live.grab2 = marking = false
  marks = []
  spoke = null
  heard = null
  if (ears) earsTold('cancel')
}
function request(said) { // to Claude: the words and what is marked
  live.assistOn = live.grab2 = marking = false
  const nothing = /^(стоп|отмена|отбой|хватит)[.! ]*$/i.test(said) ? 'Отменено' : !said && !marks.length
  if (nothing) spoke = null
  if (nothing === 'Отменено') return (marks = [], card('fail', 'Отменено', 2500))
  if (nothing) return card('fail', fs.existsSync(EARS) ? 'Ничего не сказано и не помечено' : 'Ничего не помечено. Речь не подключена: ./setup-speech.sh', 4000)
  card('think', said || 'Смотрю помеченное')
  const before = exchanges.filter(e => Date.now() - e.at < 600000).slice(-3)
  const model = /^claude-[a-z0-9-]+$/.test(params.assistModel) ? params.assistModel : undefined // the setting `assistModel`; else the usual one (assist.js)
  const mine = asking = ask({ said, marks: marks.length, before, model, server: `http://127.0.0.1:${pages.address().port}`, tools: path.join(ROOT, 'assist-tools.js') }, doing => asking === mine && card('do', doing))
  mine.done.then(answer => {
    exchanges.push({ at: Date.now(), said: said || '(пометил место)', answer })
    if (exchanges.length > 6) exchanges.shift()
    if (asking === mine) card('done', answer, Math.min(20000, 4000 + 70 * answer.length))
  }, e => asking === mine && card('fail', e.message, 5000)).finally(() => { if (asking === mine) { asking = null; marks = []; spoke = null } })
}
function assistKey() {
  if (confirming) return confirming(true)
  if (heard) return // the words of the recording just ended are on their way
  if (asking) {
    asking.stop()
    asking = null
    marks = []
    return card('fail', 'Остановлено', 2500)
  }
  if (live.assistOn) { // the mode ends: what was said and what is marked goes to Claude
    live.assistOn = live.grab2 = false
    spoke = lookedMost(looks, Date.now())
    const listened = earsTold('stop'), timer = setTimeout(() => heard?.(''), listened ? 20000 : 400) // without ears: a moment for the last mark to come
    if (listened) card('think', 'Распознаю речь')
    heard = said => { clearTimeout(timer); heard = null; request(said.trim()) }
    return
  }
  if (Date.now() - editSeen < 2500) return card('fail', 'Сначала выйдите из расстановки окон (Num Lock)', 3500)
  live.assistOn = marking = true
  marks = []
  looks = gaze.at && pageHere() ? [{ ...gaze, at: Date.now() }] : []
  card('listen', earsTold('start') ? 'Говорите и помечайте мышью. Caps Lock: отправить, Esc: отмена'
    : 'Пометьте место мышью: щелчок, рамка, правой кнопкой стрелка. Caps Lock: отправить. Речь не подключена: ./setup-speech.sh')
}
// "Yes or no" in the headset before something that cannot be taken back (switching off, closing a window, typing
// into one): the helper's key is the yes, ten seconds of nothing the no
function confirmed(question, ms = 10000) { // ms: longer when there is more to read
  confirming?.(false) // one question at a time: an earlier one is a no
  return new Promise(resolve => {
    const timer = setTimeout(() => confirming(false), ms)
    confirming = yes => { clearTimeout(timer); confirming = null; card(asking ? 'do' : 'fail', yes ? 'Да' : 'Не подтверждено', asking ? 0 : 2500); resolve(yes) }
    card('ask', `${question} Да: Caps Lock. Нет: подождите`)
  })
}
const isSelf = m => cableOn() && !!pictureScreen && connectors[m.id] === pictureScreen // this monitor shows the picture of a headset on a cable, so it is not a panel there
const panelsNow = () => [...CAPTURE.monitors.filter(m => !isSelf(m)), ...windowPanels()]
const settingsNow = () => complete({ ...params, ...CAPTURE, monitors: panelsNow(), ...live })
let windowsModule               // the windows.py process, started when first needed
// The headset's own list of applications: the extension tells which are installed (name and icon file), the headset
// shows them and names one to start, and the extension starts it and shows its window.
let apps = []    // [{ id, name, icon }]
const launches = [] // the applications the headset or the helper asked for, until the extension has taken them (one with each report)
let openWish = null // a link or a file (as file://...) the helper asked to open, until the extension has taken it
let opening = Promise.resolve() // the helper's openings, one after another: each waits for its own window
let closeWish = null, typeWish = null // a window the helper asked to close; text it asked to type into one: { id, text, enter }; both confirmed in the headset
let windowsAt = 0   // when the extension last told the windows
const placed = new Set() // windows shown with a place of their own (an arrangement brought back): the page does not put those where the user looks
let awaited = []    // programs started for an arrangement: [{ entry: its kept window, until }], placed when their window opens
// Arrangements the helper keeps under names (assist.js, layoutOf): a file beside the settings
const LAYOUTS_FILE = path.join(ROOT, 'layouts.json')
const layouts = () => { try { return JSON.parse(fs.readFileSync(LAYOUTS_FILE, 'utf8')) } catch { return {} } }
// Where a kept window stands in the place of the list it has now: as kept, as wide as keeps its text the size it was (w: its width in pixels now)
const placeOf = (slot, kept, w) => ({ ...Object.fromEntries(['yaw', 'pitch', 'dist', 'curve'].map(key => [`${slot}.${key}`, kept[key]])),
  [`${slot}.span`]: +Math.min(MONITOR_SPEC.span[2], Math.max(MONITOR_SPEC.span[1], kept.span * w / kept.w)).toFixed(1) })
const freeSlot = () => CAPTURE.monitors.length + wantedWindows.size < PANELS ? WINDOW_SLOTS.find(s => ![...wantedWindows.values()].includes(s)) : undefined
// A window out of the headset, and its dialogs with it (it stays open on the PC)
const takeOut = id => { for (const w of openWindows) if ([w.id, w.parent, adopted.get(w.id)].includes(id)) wantedWindows.delete(w.id) }
const pageHere = () => Date.now() - phoneSeen < 2000 || glassesOn() // a page that shows the sphere to its user is open
// In the order the windows came into the headset: it draws the later ones on top, as a dialog over its window.
// A dialog's panel names the panel of its window (`over`).
const windowPanels = () => [...wantedWindows].map(([id, slot]) => [openWindows.find(w => w.id === id), slot]).filter(([w]) => w)
  .map(([w, slot]) => ({ id: slot, name: w.title, app: w.app, appId: w.appId, placed: placed.has(w.id) || undefined, window: true, crop: [w.left, w.top, w.w, w.h], source: w.id, over: wantedWindows.get(w.parent || adopted.get(w.id)), popups: w.popups,
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
  for (const id of placed) if (!wantedWindows.has(id)) placed.delete(id) // shown again later, it comes where the user looks
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
  if (foreign(req.headers.origin, req.headers.host, local)) return res.writeHead(403).end('asked by a page of another site') // orders.js
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
    windowsAt = Date.now()
    if (Number.isFinite(told?.focus)) focusedWindow = told.focus
    for (const key of ['fullscreen', 'recording']) if (typeof told?.[key] === 'boolean') live[key] = told[key]
    if (told?.picture !== undefined) { // the monitor that shows the picture of a headset on a cable, of those capture.py named
      pictureScreen = Object.values(connectors).includes(told.picture) ? told.picture : null
      tellCable()
    }
    if (Array.isArray(told?.open)) {
      const before = new Set(openWindows.map(w => w.id))
      openWindows = told.open.filter(w => [w?.id, w?.left, w?.top].every(Number.isFinite) && w.w > 0 && w.h > 0)
        .map(w => ({ id: w.id, title: String(w.title).slice(0, 80), app: String(w.app ?? '').slice(0, 60), appId: String(w.appId ?? '').slice(0, 200), w: w.w, h: w.h, left: w.left, top: w.top, parent: Number.isFinite(w.parent) ? w.parent : 0, type: w.type,
          popups: (Array.isArray(w.popups) ? w.popups : []).filter(r => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && r[2] > 0 && r[3] > 0).slice(0, 3) }))
      opened = windowsTold ? openWindows.filter(w => !before.has(w.id)) : []
      windowsTold = true
    }
    if (Array.isArray(told?.apps)) {
      apps = told.apps.slice(0, 500).filter(a => typeof a?.id === 'string' && typeof a.name === 'string')
        .map(a => ({ id: a.id.slice(0, 200), name: a.name.slice(0, 60), icon: String(a.icon ?? '') }))
    }
    // A program started for an arrangement (the helper's "restore"): its window goes to the place kept for it
    awaited = awaited.filter(a => Date.now() < a.until)
    for (const w of opened) {
      const i = awaited.findIndex(a => (a.entry.appId || a.entry.app) === (w.appId || w.app))
      if (i < 0 || w.parent || wantedWindows.has(w.id) || !freeSlot()) continue
      wantedWindows.set(w.id, freeSlot())
      placed.add(w.id)
      keep(placeOf(wantedWindows.get(w.id), awaited.splice(i, 1)[0].entry, w.w))
    }
    // toggle: the user's choice in the menu of the top bar; show: the window of an application started from the headset
    if (wantedWindows.has(told?.toggle)) takeOut(told.toggle)
    else if ([told?.toggle, told?.show].some(id => openWindows.some(w => w.id === id) && !wantedWindows.has(id))) {
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
    const answer = { shown: [...wantedWindows.keys()], active: Date.now() - activeAt < 1000 ? activeWindow : null, launch: launches.shift() ?? null, open: openWish, close: closeWish, type: typeWish, needApps: !apps.length,
      resize: resizeWish, soon: Date.now() - resizeAt < 1000, cursor: cursor.n > 0,
      phoneOnline: Date.now() - phoneSeen < 2000, menuOpen: Date.now() - menuOpenAt < 3000, // for the Super key: our list instead of GNOME's overview
      numLock: params.numLock ?? 0, // F12 on the phone's keyboard: the extension presses the PC's Num Lock
      record: params.recordCall ?? 0, // the record button in the headset's list: the extension starts or stops the recording
      off: params.offCall ?? 0, // the off button there: the extension switches VR Workspace off
      assistOn: live.assistOn, // the helper's mode: the extension holds the mouse for its marks
      connectors: Object.values(connectors), // GNOME's names of the monitors in the headset: the extension says which shows the picture
      enter: glassesOn() && Date.now() - enter.at < 400 ? enter : null } // the monitor or window the PC's mouse is to go into
    openWish = resizeWish = closeWish = typeWish = null
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
    launches.push(apps[wish.app].id)
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
  // From the test page of the head movement (track-test.html): half a minute of what the phone's camera saw, small
  // and grey, with the head's turns, to be played through the tracker again on the PC (dev/replay.mjs).
  if (url === '/trackclip' && req.method === 'POST') {
    const parts = []
    let size = 0
    for await (const chunk of req) {
      if ((size += chunk.length) > 16e6) throw new Error('body too large')
      parts.push(chunk)
    }
    const clip = Buffer.concat(parts)
    if (!['VRTC', 'VRT2'].includes(clip.subarray(0, 4).toString('latin1'))) throw new SyntaxError('a clip expected')
    // `?auto`: from the headset itself, with every look around the room; of those only the last eight are kept
    const auto = searchParams.has('auto'), name = `${auto ? 'auto' : 'clip'}-${new Date().toLocaleString('sv').replace(/[ :]/g, '-')}.bin`, folder = path.join(ROOT, 'track-clips')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, name), clip)
    if (auto) for (const old of fs.readdirSync(folder).filter(f => /^auto-.*\.bin$/.test(f)).sort().slice(0, -8)) fs.rmSync(path.join(folder, old))
    console.log(`a clip of the phone's camera for the head movement: track-clips/${name}, ${(size / 1e6).toFixed(1)} MB`)
    return res.writeHead(204).end()
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
    // And that of the picture of a headset on a cable (?glasses), for the spectator alone: the pointer, the list and
    // the arranging are that page's there, not the phone's.
    const picture = local && searchParams.has('glasses')
    if (local && !picture) return res.writeHead(204).end()
    const sent = JSON.parse(await readBody(req))
    // head (4), anchor (2), the list of applications (open, yaw, the icon carried), the mouse (2), our pointer (3),
    // the panel in hand or being resized (index or -1, yaw, pitch, width or 0, shape), where the head is (3, metres)
    if (!Array.isArray(sent) || sent.length !== 22 || !sent.every(Number.isFinite)) throw new SyntaxError('twenty-two numbers expected')
    if (picture) picturePose = { text: JSON.stringify(sent), at: Date.now() }
    else push('pose', pose = JSON.stringify(sent))
    return res.writeHead(204).end()
  }
  if (url === '/pose') {
    spectatorSeen = Date.now()
    return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(Date.now() - picturePose.at < 1000 ? picturePose.text : pose)
  }

  // Live settings: pages poll GET a few times a second, POST merges a JSON object into them (null removes a key).
  // Polling, not server-sent events: pushes did not reach Safari on the iPhone, plain requests do.
  if (url === '/params' && req.method === 'POST') {
    const patch = JSON.parse(await readBody(req))
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new SyntaxError('object expected')
    if ('edit' in patch) editSeen = patch.edit === true ? Date.now() : 0
    if (patch.edit === true && live.assistOn) { assistEnd(); assist = null } // the arranging takes the mouse: the helper's mode gives way
    if ('trackSeen' in patch) { // how the phone's camera serves for finding the head: into the journal, not a setting
      console.log('head from the camera:', JSON.stringify(patch.trackSeen).slice(0, 300))
      delete patch.trackSeen
    }
    if ('menuOpen' in patch) menuOpenAt = patch.menuOpen === true ? Date.now() : 0
    if ('assistKey' in patch && local) assistKey() // Caps Lock, from the extension
    delete patch.assistKey
    delete patch.assistOn // its mode is switched by its key only, not as the other live values are
    if (Array.isArray(patch.looked)) { // from the working page: the panel under the centre of its view and where the view points
      const [id, yaw, pitch] = patch.looked
      if (typeof id === 'string' && /^([mw]\d+)?$/.test(id) && [yaw, pitch].every(Number.isFinite)) {
        gaze = { id, yaw, pitch, at: Date.now() }
        if (live.assistOn && looks.length < 500) looks.push(gaze)
      }
    }
    delete patch.looked
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
    if (Object.keys(patch).length) keep(patch)
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
    const monitors = [...CAPTURE.monitors.map(m => ({ ...m, connector: connectors[m.id], self: isSelf(m) })), ...windowPanels()] // with `source`: the page tells by it that a place in the list holds another window now
    const answer = { ...params, ...CAPTURE, monitors, ...live, edit: Date.now() - editSeen < 2500, glasses: cableOn(), watched: Date.now() - spectatorSeen < 2000, ...(local && { raw: { port: RAW_PORT, key: process.env.VR_RAW_KEY } }), build: BUILD, phoneOnline: Date.now() - phoneSeen < 2000, spectator: Date.now() - spectatorSeen < 2000 || glassesOn(), settingsOnly: SETTINGS_ONLY }
    // ?full: with the defaults filled in, for the GNOME settings window (the pages do that themselves)
    return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      .end(JSON.stringify(searchParams.has('full') ? { ...complete(answer), outside: local ? OUTSIDE_URL : '' }
        : { ...answer, cursor: cursor.n ? [cursor.n, ...cursor.hot, cursor.png.length ? 1 : 0] : null, // the pointer: its picture's number, hot spot, whether shown
          note: note && [note.n, note.app, note.title, note.body, note.icon ? 1 : 0],
          assist, marks: marks.map(({ n, kind, id, rect }) => ({ n, kind, id, rect })) }))
  }
  // --- the helper. From the pages: a mark with its picture (PNG), and the mode given up (nothing is sent).
  if (url === '/assist/mark' && req.method === 'POST') {
    const parts = []
    let size = 0
    for await (const chunk of req) {
      if ((size += chunk.length) > 8e6) throw new Error('body too large')
      parts.push(chunk)
    }
    const png = Buffer.concat(parts), kind = searchParams.get('kind'), id = searchParams.get('id'), rect = (searchParams.get('rect') ?? '').split(',').map(Number)
    const panel = [...CAPTURE.monitors, ...windowPanels()].find(m => m.id === id)
    if (!marking || marks.length >= 6 || !panel || !['window', 'frame', 'arrow'].includes(kind) || rect.length !== 4 || !rect.every(n => n >= 0 && n <= 1) || png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) throw new SyntaxError('a mark expected')
    const on = panel.window ? `the window "${panel.name}"${panel.app ? ` of the program ${panel.app}` : ''}` : `the monitor ${panel.name ?? id}`, pc = n => Math.round(n * 100)
    const about = kind === 'window' ? `the whole of ${on}.`
      : kind === 'frame' ? `a frame around a part of ${on}: from ${pc(rect[0])} to ${pc(rect[2])} % of its width and from ${pc(rect[1])} to ${pc(rect[3])} % of its height, counted from its top left. The picture is that part alone.`
        : `an arrow drawn on ${on}, pointing from ${pc(rect[0])} %, ${pc(rect[1])} % to ${pc(rect[2])} %, ${pc(rect[3])} % (across, down from its top left). The picture is the part of it around the arrow, with the arrow in red: it points at its tip.`
    marks.push({ n: marks.length + 1, kind, id, rect, about, png })
    return res.writeHead(204).end()
  }
  if (url === '/assist/cancel' && req.method === 'POST') {
    confirming?.(false)
    if (asking) asking.stop()
    asking = null
    assistEnd()
    assist = null
    return res.writeHead(204).end()
  }
  // From this PC only: the key as the extension presses it and words as if spoken (both for trying it out), and what
  // the tools ask (assist-tools.js).
  if (url === '/assist/key' && req.method === 'POST' && local) return (assistKey(), res.writeHead(204).end())
  if (url === '/assist' && req.method === 'POST' && local) {
    const said = String(JSON.parse(await readBody(req))?.text ?? '').trim().slice(0, 1000)
    if (confirming) confirming(/^(да|ага|давай|yes)(?![а-яёa-z])/i.test(said))
    else if (!asking && !heard) request(said)
    return res.writeHead(204).end()
  }
  if (url === '/assist/marks' && local) {
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(marks.map(m => ({ n: m.n, about: m.about, png: m.png.toString('base64') }))))
  }
  if (url === '/assist/settings' && local) {
    const told = () => ({ ...settingsTold(complete({ ...params, ...CAPTURE, monitors: [], ...live }), backgrounds().map(f => 'bg/' + f)), recording: live.recording })
    if (req.method !== 'POST') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(told()))
    let patch
    try { patch = settingsPatch(JSON.parse(await readBody(req))?.changes, backgrounds().map(f => 'bg/' + f)) } catch (e) { return res.writeHead(400).end(e.message) }
    if ('passthrough' in patch) { live.passthrough = patch.passthrough; delete patch.passthrough } // not kept in the file
    if (Object.keys(patch).length) keep(patch)
    return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ now: Object.fromEntries(told().settings.map(s => [s.key, s.value])) }))
  }
  if (url === '/assist/do' && req.method === 'POST' && local) {
    const { action, on } = JSON.parse(await readBody(req)) ?? {}, done = what => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(what))
    if (action === 'record') {
      if (typeof on !== 'boolean') return res.writeHead(400).end('"record" takes `on`: true or false')
      if (live.recording !== on) keep({ recordCall: Date.now() })
      return done({ recording: on })
    }
    if (action === 'recenter') return (keep({ recenter: Date.now() }), done({ done: true }))
    if (action === 'look_around') {
      if (params.sixDof === false) return res.writeHead(400).end('The head movement is switched off: set "sixDof" to true first')
      return (keep({ scanCall: Date.now() }), done({ done: true, note: 'the user now looks around the room for 15 seconds' }))
    }
    if (action === 'switch_off') {
      if (!await confirmed('Выключить VR Workspace?')) return done({ done: false, why: 'the user did not confirm it' })
      return (keep({ offCall: Date.now() }), done({ done: true }))
    }
    return res.writeHead(400).end('The actions: record, recenter, look_around, switch_off')
  }
  // Windows for the helper: what is in the sphere and where, opening, placing, arrangements kept under names.
  const sent = what => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(what))
  if (url === '/assist/windows' && local) {
    const at = spoke ?? (gaze.at && pageHere() ? gaze : null) // while speaking; asked without the mode (text, the chat): now
    return sent({ panels: panelsTold(settingsNow(), panelsNow(), at?.id), gaze: at && { yaw: at.yaw, pitch: at.pitch },
      // of the windows that are not in the sphere only the programs: their titles stay on this PC
      elsewhere: [...new Set(openWindows.filter(w => !w.parent && !wantedWindows.has(w.id) && w.app).map(w => w.app))], layouts: Object.keys(layouts()) })
  }
  if (url === '/assist/place' && req.method === 'POST' && local) {
    const { panel, ...where } = JSON.parse(await readBody(req)) ?? {}
    try { keep(placePatch(settingsNow(), panelsNow(), panel, where)) } catch (e) { return res.writeHead(400).end(e.message) }
    return sent({ now: panelsTold(settingsNow(), panelsNow()).find(p => p.panel === panel) })
  }
  if (url === '/assist/open' && req.method === 'POST' && local) {
    const wish = JSON.parse(await readBody(req)) ?? {}, before = opening
    opening = new Promise(over => res.on('close', over)) // answered, or Claude was stopped meanwhile: the next one's turn
    await before
    const had = new Set(wantedWindows.keys())
    try {
      if (Date.now() - windowsAt > 3000) throw new Error('The VR Workspace extension of GNOME is not answering: nothing can be opened now')
      if (!freeSlot()) throw new Error(`No more windows fit into the sphere: ${wantedWindows.size} are there (sphere_close with "out" takes one out)`)
      if (typeof wish.program === 'string') {
        const app = apps[meant(apps.map(a => a.name), wish.program, 'program', apps.map(a => a.id))]
        const there = openWindows.find(w => w.appId === app.id && !w.parent && !wantedWindows.has(w.id)) // open on the PC and not in the sphere: that one comes
        if (there) wantedWindows.set(there.id, freeSlot())
        else launches.push(app.id)
      } else if (typeof wish.link === 'string') openWish = linkOf(wish.link)
      else if (typeof wish.file === 'string') openWish = pathToFileURL(fileNamed(wish.file, os.homedir(), userFolders(os.homedir(), params.assistFolders))).href
      else throw new Error('One of `program`, `link`, `file` is needed')
    } catch (e) { return res.writeHead(400).end(e.message) }
    headsetClick = { at: Date.now(), in: null } // the window that opens now comes into the sphere, as after a start from the list
    syncWindows()
    let panel
    for (const until = Date.now() + 10000; !(panel = windowPanels().find(p => !had.has(p.source))) && Date.now() < until;) await pause(150)
    if (!panel) return sent({ opened: false, note: 'No new window came within 10 seconds: the program may have used a window it already has (see sphere_windows), or it is slow to start.' })
    await pause(700) // the page puts a new window where the user looks: after that its place is in the settings
    return sent({ opened: panelsTold(settingsNow(), panelsNow()).find(p => p.panel === panel.id) })
  }
  // Closing a window, taking it out of the sphere, typing into it. Closing and typing are asked in the headset first:
  // the window may be the wrong one (taken by the gaze), and typed text may be a command.
  if ((url === '/assist/close' || url === '/assist/type') && req.method === 'POST' && local) {
    const { panel, how, text, enter } = JSON.parse(await readBody(req)) ?? {}, p = windowPanels().find(p => p.id === panel), name = `«${[p?.app, p?.name].filter(Boolean).join(': ').slice(0, 34)}»`
    if (!p) return res.writeHead(400).end(`"${panel}" is not a window in the sphere (monitors cannot be closed or typed into). The windows: ${windowPanels().map(p => p.id).join(', ') || 'none'}`)
    if (url === '/assist/close' && how === 'out') {
      takeOut(p.source)
      syncWindows()
      return sent({ done: true, note: 'the window is out of the sphere and still open on the PC' })
    }
    if (Date.now() - windowsAt > 3000) return res.writeHead(400).end('The VR Workspace extension of GNOME is not answering: this cannot be done now')
    if (url === '/assist/close') {
      if (how !== 'close') return res.writeHead(400).end('`how` takes "close" (the window is closed on the PC) or "out" (it leaves the sphere and stays open)')
      if (!await confirmed(`Закрыть окно ${name}?`)) return sent({ done: false, why: 'the user did not confirm it' })
      closeWish = p.source
      return sent({ done: true, note: 'its program was asked to close the window; it may first ask about unsaved work in a dialog' })
    }
    // 160: what the card shows whole with the question around it, so that what is confirmed is what is typed
    if (typeof text !== 'string' || !text.trim() || text.length > 160 || /[\x00-\x09\x0b-\x1f\x7f]/.test(text)) return res.writeHead(400).end('`text` takes plain text, 160 characters at most (more: in parts)')
    if (!await confirmed(`Напечатать в ${name}: «${text.replace(/\n/g, ' ⏎ ')}»${enter === true ? ' и нажать Enter' : ''}?`, 10000 + 60 * text.length)) return sent({ done: false, why: 'the user did not confirm it' })
    typeWish = { id: p.source, text, enter: enter === true }
    return sent({ done: true, note: 'the text was pasted into the window where its cursor is; whether the program took it cannot be seen from here' })
  }
  if (url === '/assist/layout' && req.method === 'POST' && local) {
    const { action, name } = JSON.parse(await readBody(req)) ?? {}, kept = layouts(), names = Object.keys(kept)
    const write = () => { fs.writeFileSync(LAYOUTS_FILE + '.tmp', JSON.stringify(kept, null, 2)); fs.renameSync(LAYOUTS_FILE + '.tmp', LAYOUTS_FILE) } // aside and renamed, as the settings
    try {
      if (action === 'list') return sent({ layouts: names })
      if (action === 'save') {
        const title = String(name ?? '').trim().slice(0, 60)
        if (!title) throw new Error('`name` is needed')
        kept[title] = layoutOf(settingsNow(), panelsNow())
        write()
        return sent({ saved: title, panels: kept[title].panels.length })
      }
      if (!['restore', 'forget'].includes(action)) throw new Error('The actions: save, restore, list, forget')
      const title = names[meant(names, name, 'arrangement')], layout = kept[title]
      if (action === 'forget') {
        delete kept[title]
        write()
        return sent({ forgotten: title })
      }
      // The monitors go back to their places; each kept window that is open comes into the sphere at its place; a
      // program with no window open is started, and its window is placed when it comes (/windows).
      const patch = { hideMonitors: layout.hideMonitors }, started = [], missing = []
      let back = 0
      for (const { id, hidden, ...at } of layout.panels.filter(e => e.id && CAPTURE.monitors.some(m => m.id === e.id))) Object.assign(patch, { [`${id}.hidden`]: hidden }, ...Object.entries(at).map(([key, value]) => ({ [`${id}.${key}`]: value })))
      for (const { entry, window } of layoutWindows(layout, openWindows)) {
        const open = openWindows.find(w => w.id === window), app = entry.appId || apps.find(a => a.name === entry.app)?.id // GNOME's id of its program (the list of applications may be older than the program)
        if (open && (wantedWindows.has(open.id) || freeSlot())) {
          if (!wantedWindows.has(open.id)) placed.add(open.id)
          if (!wantedWindows.has(open.id)) wantedWindows.set(open.id, freeSlot())
          Object.assign(patch, placeOf(wantedWindows.get(open.id), entry, open.w))
          back++
        } else if (!open && app && Date.now() - windowsAt < 3000) {
          launches.push(app)
          awaited.push({ entry, until: Date.now() + 40000 })
          started.push(entry.app)
        } else missing.push(entry.app)
      }
      keep(patch)
      if (started.length) headsetClick = { at: Date.now(), in: null }
      syncWindows()
      return sent({ restored: title, windowsPlaced: back, started, missing, ...(started.length && { note: 'the started programs come to their places as their windows open' }) })
    } catch (e) { return res.writeHead(400).end(e.message) }
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
  pages = http.createServer(listener).listen(8080, '127.0.0.1')
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

  pages = http.createServer(listener).listen(8080)
  https.createServer(tls, listener).listen(8443)
  console.log('PC:    http://localhost:8080/control.html (settings)   http://localhost:8080/ (preview)')
  console.log(`Phone: ${PHONE_URL}   (once before that: ${CA_URL})`)
  if (OUTSIDE) console.log(`Phone from outside the home: ${OUTSIDE_URL}`)
}
