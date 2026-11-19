// Plays the phone: opens a page in headless Chromium and does what the arguments say, in order.
//
//   node dev/page.mjs <url> [width height] <action>...
//
//   wait:<seconds>      eval:<js expression, printed>      shot:<file.png>
//   move:x,y            path:x1,y1,x2,y2 (a run of small movements, as a real mouse)
//   press / release     (the left button, where the pointer is)      click:x,y      rclick:x,y      wheel:<pixels>
//   orient:alpha,beta,gamma   (the phone's orientation sensor; 0,90,0 looks at the horizon, a larger alpha turns left)
import { spawn } from 'node:child_process'
import fs from 'node:fs'
const [url, ...rest] = process.argv.slice(2)
const [width, height] = /^\d+$/.test(rest[0]) ? rest.splice(0, 2).map(Number) : [1280, 590]
const chrome = spawn('chromium', ['--headless=new', '--remote-debugging-port=9333', `--window-size=${width},${height}`,
  `--user-data-dir=${process.env.HOME}/snap/chromium/common/vr-test-profile`, '--autoplay-policy=no-user-gesture-required', '--mute-audio',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const started = Date.now(), log = (...what) => console.log(((Date.now() - started) / 1000).toFixed(1).padStart(5), ...what)
try {
  let target
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250)
    try { target = (await (await fetch('http://127.0.0.1:9333/json')).json()).find(t => t.type === 'page') } catch {}
  }
  if (!target) throw new Error('Chromium did not open its debugging port')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(r => ws.onopen = r)
  let id = 0
  const pending = new Map()
  ws.onmessage = m => {
    const d = JSON.parse(m.data)
    if (d.id) pending.get(d.id)?.(d.result ?? d.error)
    else if (d.method === 'Runtime.exceptionThrown') log('PAGE ERROR', d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text)
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type !== 'log') log('page says', d.params.type, d.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200))
  }
  const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })) })
  await send('Runtime.enable'); await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url })
  let at = [0, 0]
  const mouse = (type, x, y, more = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...more })
  for (const action of rest) {
    const [kind, arg = ''] = action.split(/:(.*)/s), numbers = arg.split(',').map(Number)
    if (kind === 'wait') await sleep(arg * 1000)
    else if (kind === 'eval') log('eval ->', JSON.stringify((await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true })).result?.value))
    else if (kind === 'shot') fs.writeFileSync(arg, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    else if (kind === 'move') await mouse('mouseMoved', ...(at = numbers))
    else if (kind === 'path') {
      const [x1, y1, x2, y2] = numbers
      for (let i = 0; i <= 12; i++) { await mouse('mouseMoved', ...(at = [x1 + (x2 - x1) * i / 12, y1 + (y2 - y1) * i / 12])); await sleep(16) }
    } else if (kind === 'press') await mouse('mousePressed', ...at, { button: 'left', buttons: 1, clickCount: 1 })
    else if (kind === 'release') await mouse('mouseReleased', ...at, { button: 'left', clickCount: 1 })
    else if (kind === 'click') {
      at = numbers
      await mouse('mouseMoved', ...at); await mouse('mousePressed', ...at, { button: 'left', buttons: 1, clickCount: 1 }); await sleep(80)
      await mouse('mouseReleased', ...at, { button: 'left', clickCount: 1 })
    } else if (kind === 'rclick') {
      at = numbers
      await mouse('mouseMoved', ...at); await mouse('mousePressed', ...at, { button: 'right', buttons: 2, clickCount: 1 }); await sleep(80)
      await mouse('mouseReleased', ...at, { button: 'right', clickCount: 1 })
    } else if (kind === 'orient') await send('DeviceOrientation.setDeviceOrientationOverride', { alpha: numbers[0], beta: numbers[1], gamma: numbers[2] })
    else if (kind === 'wheel') await mouse('mouseWheel', ...at, { deltaX: 0, deltaY: +arg })
    else throw new Error(`unknown action ${action}`)
    if (kind !== 'wait') log(action.slice(0, 60))
  }
  ws.close()
} finally {
  chrome.kill()
}
