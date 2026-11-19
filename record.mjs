#!/usr/bin/env node
// Records what the headset shows, with the PC's sound, without any window on the screen: the spectator page
// (index.html?spectator) is drawn by an invisible Chromium on the graphics card and recorded inside it. A window
// on the screen would be covered by the windows the headset brings to the front, and would show up in the sphere.
// The sound is taken by ffmpeg from what the PC plays (what the phone plays too), and joined to the picture at the
// end: the invisible Chromium has no sound device, so a sound it receives never reaches its recording.
//
//   node record.mjs [width of the view in degrees, 90 if not given]      Ctrl+C stops; the file goes to ~/Videos
//
// Needs VR Workspace running; the view follows the phone.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const view = /^\d+$/.test(process.argv[2] ?? '') ? `=${process.argv[2]}` : ''
const profile = path.join(os.homedir(), 'snap/chromium/common/vr-workspace-record') // Chromium from the snap may write only there
const chrome = spawn('chromium', ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`, '--window-size=1920,1080',
  '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', // the graphics card: drawn in software, 12 frames a second
  '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank'], { stdio: 'ignore', detached: true }) // detached: Ctrl+C in the terminal must reach only us, so that we can still finish the file
const cleanUp = () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} } // may still be written to while it is closing
process.on('exit', () => { chrome.kill(); cleanUp() })
const sleep = ms => new Promise(done => setTimeout(done, ms))

let target
for (let i = 0; i < 60 && !target; i++) {
  await sleep(250)
  try { target = (await (await fetch('http://127.0.0.1:9334/json')).json()).find(t => t.type === 'page') } catch {}
}
if (!target) throw new Error('Chromium did not start')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(done => ws.onopen = done)
let id = 0
const pending = new Map()
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id) pending.get(d.id)?.(d.result ?? d.error) }
ws.onclose = () => { for (const done of pending.values()) done({}) } // Chromium is gone: nobody waits for an answer forever
const send = (method, params = {}) => new Promise(done => { pending.set(++id, done); ws.send(JSON.stringify({ id, method, params })) })
const run = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value

await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `http://127.0.0.1:8080/?spectator${view}` })
await sleep(3000)
if (!await run("!!document.querySelector('canvas')")) {
  console.error('No picture: is VR Workspace switched on?')
  process.exit(1)
}
for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 960, y: 540, button: 'left', clickCount: 1 }) // the page starts on a click
await sleep(3000) // the streams connect
// All of it at low priority: what goes live to the headset must not wait for the recording. Chromium raises its own
// main and graphics processes (to -8, above the live streams), so they are lowered once they all run.
spawnSync('renice', ['-n', '10', '-g', String(chrome.pid)])

// In the page: the drawing as a video stream, recorded.
const type = await run(`(async () => {
  const type = ['video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t))
  const chunks = []
  const recorder = new MediaRecorder(document.querySelector('canvas').captureStream(30), { mimeType: type, videoBitsPerSecond: 8e6 })
  recorder.ondataavailable = e => chunks.push(new Promise(done => {
    const reader = new FileReader()
    reader.onload = () => done(reader.result.split(',')[1])
    reader.readAsDataURL(e.data)
  }))
  recorder.start(1000)
  window.take = () => Promise.all(chunks.splice(0))
  window.stop = () => new Promise(done => { recorder.onstop = done; recorder.stop() })
  return type
})()`)
if (!type) throw new Error('this Chromium cannot record video')
const stamp = new Date().toLocaleString('sv').slice(0, 16).replace(/[ :]/g, '-') // local time, as 2026-11-19-16-46
const file = path.join(os.homedir(), 'Videos', `VR-Workspace-${stamp}.webm`)
fs.mkdirSync(path.dirname(file), { recursive: true })
const out = fs.openSync(`${file}.video`, 'w')
// detached, as Chromium: it is stopped by us, once the picture is complete
const sound = spawn('nice', ['-n', '10', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'pulse', '-i', '@DEFAULT_MONITOR@', '-c:a', 'libopus', '-b:a', '128k', '-y', '-f', 'webm', `${file}.sound`],
  { stdio: ['ignore', 'ignore', 'inherit'], detached: true })
process.on('exit', () => sound.kill())
let taking = Promise.resolve() // one after another, so that the pieces are written in their order
const take = () => (taking = taking.then(async () => { for (const part of await run('window.take()') ?? []) fs.writeSync(out, Buffer.from(part, 'base64')) }))
const timer = setInterval(() => take().catch(() => {}), 1000)
console.log(`Recording into ${file}. Ctrl+C stops.`)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    clearInterval(timer)
    await run('window.stop()')
    await take()
    fs.closeSync(out)
    sound.kill('SIGINT') // ffmpeg finishes its file on it
    chrome.kill()
    await Promise.all([sound, chrome].map(child => (child.exitCode ?? child.signalCode) === null && new Promise(done => child.once('exit', done))))
    cleanUp()
    // Picture and sound into one file, copied, not encoded again (which also tells players how long it is: the
    // recording itself does not, so they could not seek). Without the sound if ffmpeg could not take it.
    const join = inputs => spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs.flatMap(i => ['-i', i]), '-c', 'copy', file]).status === 0
    if (!join([`${file}.video`, `${file}.sound`]) && !join([`${file}.video`])) fs.copyFileSync(`${file}.video`, file)
    for (const part of ['video', 'sound']) fs.rmSync(`${file}.${part}`, { force: true })
    console.log(`\nSaved: ${file}`)
    process.exit()
  })
}
