import test from 'node:test'
import assert from 'node:assert/strict'
import { Euler, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import { deviceQuaternion, gazeInLayout, gazeOf, monitorFrame } from './app/orient.js'
import { checkBytes, qr } from './gnome-extension/vr-workspace@local/qr.js'
import { blocked, cleanOrder, foreign, passKey, wrongKey } from './orders.js'
import { KEYCODES, besidePanel, complete, placeIcon, resizeWindow, snapPanel } from './app/params.js'
import { space } from './app/track.js'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claudeProgram, fileNamed, layoutOf, layoutWindows, linkOf, lookedMost, meant, panelsTold, placePatch, settingsPatch, settingsTold, userFolders } from './assist.js'

const RAD = Math.PI / 180
const near = (v, x, y, z) => assert.ok(v.distanceTo(new Vector3(x, y, z)) < 1e-6, `${v.toArray()} is not ${[x, y, z]}`)
const forward = q => new Vector3(0, 0, -1).applyQuaternion(q)
const sub3 = (a, b) => a.map((n, k) => n - b[k])
const up = q => new Vector3(0, 1, 0).applyQuaternion(q)
// Head turned `right` degrees to the right and `upward` degrees up.
const looking = (right, upward) => new Quaternion().setFromEuler(new Euler(upward * RAD, -right * RAD, 0, 'YXZ'))
// Direction of the gaze as the monitor sees it: (0, 0, -1) means the monitor is dead ahead.
const gazeInMonitor = (head, anchor, yaw, pitch) => forward(monitorFrame(anchor, yaw, pitch).invert().multiply(head))

test('phone held upright in portrait looks at the horizon', () => {
  const q = deviceQuaternion(0, 90, 0, 0)
  near(forward(q), 0, 0, -1)
  near(up(q), 0, 1, 0)
})

test('phone in the headset (landscape) keeps the horizon level', () => {
  const q = deviceQuaternion(0, 0, -90, 90)
  near(up(q), 0, 1, 0)
  assert.ok(Math.abs(forward(q).y) < 1e-6)
})

test('centring puts the central monitor dead ahead, whatever the heading and tilt of the head', () => {
  const head = deviceQuaternion(137, 20, -70, 90)
  near(gazeInMonitor(head, gazeOf(head), 0, 0), 0, 0, -1)
})

test('a monitor placed 90° right and 20° up is dead ahead after turning the head there', () => {
  const anchor = gazeOf(looking(30, 0))
  near(gazeInMonitor(looking(30 + 90, 20), anchor, 90, 20), 0, 0, -1)
})

test('a monitor on the right is seen on the right', () => {
  const head = looking(0, 0)
  assert.ok(gazeInMonitor(head, gazeOf(head), 40, 0).x < -0.5) // the gaze is left of that monitor's centre
})

test('a monitor put where the gaze is, in layout coordinates, stands dead ahead', () => {
  const head = deviceQuaternion(210, 35, -60, 90), anchor = gazeOf(looking(-40, 15))
  const { yaw, pitch } = gazeInLayout(anchor, head)
  near(gazeInMonitor(head, anchor, yaw, pitch), 0, 0, -1)
  const plain = gazeInLayout(gazeOf(looking(0, 0)), looking(30, 10)) // no tilt of the layout: the numbers are the angles
  assert.ok(Math.abs(plain.yaw - 30) < 1e-6 && Math.abs(plain.pitch - 10) < 1e-6)
})

test('a monitor stays level with the horizon wherever it is put, also in a layout centred with the head tilted', () => {
  for (const anchor of [gazeOf(looking(0, 0)), gazeOf(looking(25, 30)), gazeOf(looking(-70, -20))]) {
    for (const [yaw, pitch] of [[0, 0], [40, 0], [-60, 10], [120, -25]]) {
      const right = new Vector3(1, 0, 0).applyQuaternion(monitorFrame(anchor, yaw, pitch)) // its right edge direction
      assert.ok(Math.abs(right.y) < 1e-6, `rolled by ${right.y} at ${yaw}, ${pitch}`)
    }
  }
})

test('QR code: the check bytes of the textbook example, and the fixed parts of the picture', () => {
  // "HELLO WORLD" at version 1-M, the worked example of QR tutorials
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
  assert.deepEqual(checkBytes(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
  const code = qr('https://my-pc.local:8443/?k=0123456789ab') // 40 bytes: version 3, 29 x 29
  assert.equal(code.length, 29)
  assert.ok(code[0][0] && !code[1][1] && code[3][3] && !code[7][7], 'corner square')
  assert.ok(code[6][8] && !code[6][9] && code[6][10], 'timing line')
  assert.ok(code[21][8], 'the module that is always dark')
  assert.throws(() => qr('x'.repeat(107)), RangeError)
})

test('the field of the list of applications: a taken place pushes its neighbours toward the nearest free place', () => {
  const field = text => text.split('').map(c => c === '.' ? null : c), show = pins => pins.map(p => p ?? '.').join('')
  assert.equal(show(placeIcon(field('................'), 'a', 5)), '.....a..........') // a free place
  assert.equal(show(placeIcon(field('.....bc.........'), 'a', 6)), '.....bac........') // taken: c moves on to 7
  assert.equal(show(placeIcon(field('abcdefghijklmno.'), 'd', 4)), 'abcedfghijklmno.') // one place on: e takes the place d left, nothing else moves
  assert.equal(show(placeIcon(field('abcdefghijklmnop'), 'x', 2)), 'abxcdefghijklmno') // full: the last one leaves
  assert.equal(show(placeIcon(field('ab..............'), 'a', -1)), '.b..............') // out of the field
})

test('a carried panel is drawn to its neighbours: beside them, in line with them, or not at all when far', () => {
  const snap = (...args) => { const s = snapPanel(...args); return { yaw: +s.yaw.toFixed(2), pitch: +s.pitch.toFixed(2), to: s.to } }
  const other = { yaw: 0, pitch: 0, w: 40, h: 25 }
  assert.deepEqual(snap({ yaw: 33, pitch: 1, w: 20, h: 15 }, [other]), { yaw: 32, pitch: 0, to: 0 }) // beside it, 2 degrees apart, same height
  assert.deepEqual(snap({ yaw: -11, pitch: 23.5, w: 20, h: 15 }, [other]), { yaw: -9.23, pitch: 22, to: 0 }) // left edges in line, 2 degrees over it (up there half its width takes 10.77 degrees of turn)
  assert.deepEqual(snap({ yaw: 2, pitch: 2, w: 20, h: 15 }, [other]).pitch, 0) // the same middle height
  assert.deepEqual(snap({ yaw: 70, pitch: 30, w: 20, h: 15 }, [other]), { yaw: 70, pitch: 30, to: -1 })
  assert.deepEqual(snap({ yaw: -170, pitch: 0, w: 20, h: 15 }, [{ yaw: 160, pitch: 0, w: 40, h: 25 }]).yaw, -168) // across the back of the sphere
  // 30 degrees up, beside each other: 2 degrees apart across, not overlapping (42 degrees of turn overlapped them by 3)
  const up = snapPanel({ yaw: 47, pitch: 30, w: 40, h: 25 }, [{ yaw: 0, pitch: 30, w: 40, h: 25 }])
  const side = (x, yaw) => new Vector3(Math.sin(x * RAD), 0, -Math.cos(x * RAD)).applyEuler(new Euler(30 * RAD, -yaw * RAD, 0, 'YXZ')) // the middle of a side
  const [right, left] = [side(20, 0), side(-20, up.yaw)]
  assert.ok(Math.atan2(left.x, -left.z) > Math.atan2(right.x, -right.z), 'overlapping')
  assert.ok(Math.abs(right.angleTo(left) / RAD - 2) < 0.1, `${right.angleTo(left) / RAD} degrees apart`)
})

test('a window resized by its side keeps the opposite side and the size of its text', () => {
  const panel = { w: 800, h: 600, span: 40, yaw: 0, pitch: 0, dist: 1.5 } // 40 degrees across: 20 pixels a degree
  assert.deepEqual(resizeWindow(panel, { left: 0, right: 1, top: 0, bottom: 0 }, { yaw: 10, pitch: 0 }), { w: 1000, h: 600, span: 50, yaw: 5, pitch: 0 })
  assert.deepEqual(resizeWindow(panel, { left: 1, right: 0, top: 0, bottom: 0 }, { yaw: 10, pitch: 0 }), { w: 600, h: 600, span: 30, yaw: 5, pitch: 0 })
  assert.deepEqual(resizeWindow(panel, { left: 0, right: 0, top: 0, bottom: 1 }, { yaw: 0, pitch: -5 }), { w: 800, h: 700, span: 40, yaw: 0, pitch: -2.5 })
  assert.equal(resizeWindow(panel, { left: 0, right: 1, top: 1, bottom: 0 }, { yaw: -40, pitch: -40 }).w, 200) // never smaller than 200 x 150
  const up = resizeWindow({ ...panel, pitch: 60 }, { left: 0, right: 1, top: 0, bottom: 0 }, { yaw: 10, pitch: 0 }) // 60 degrees up 10 degrees of turn are 5 across
  assert.deepEqual({ ...up, yaw: +up.yaw.toFixed(6) }, { w: 900, h: 600, span: 45, yaw: 5, pitch: 60 })
  // the PC gave another size than asked (an application's smallest size): the panel takes that one, its left side staying
  assert.deepEqual(resizeWindow(panel, { left: 0, right: 1, top: 0, bottom: 0 }, null, 1.5, { w: 700, h: 600 }), { w: 700, h: 600, span: 35, yaw: -2.5, pitch: 0 })
})

test('orders for a window: only a shown window, only inside it, only known buttons and keys', () => {
  const sizes = { w0: [[0, 0, 700, 520]] }
  assert.deepEqual(cleanOrder({ to: 'w0', x: 350.5, y: 20 }, sizes), { to: 'w0', x: 350.5, y: 20 })
  assert.deepEqual(cleanOrder({ to: 'w0', x: -50, y: 9999 }, sizes), { to: 'w0', x: 0, y: 519 })
  assert.deepEqual(cleanOrder({ to: 'w0', button: 272, down: true, extra: 'rm -rf' }, sizes), { to: 'w0', button: 272, down: true })
  assert.deepEqual(cleanOrder({ to: 'w0', wheel: -1 }, sizes), { to: 'w0', wheel: -1 })
  assert.deepEqual(cleanOrder({ to: 'w0', x: 10, y: 20, button: 273, down: false }, sizes), { to: 'w0', x: 10, y: 20, button: 273, down: false }) // a press carries its place
  assert.deepEqual(cleanOrder({ to: 'w0', key: 30, down: false }, sizes), { to: 'w0', key: 30, down: false })
  for (const bad of [{ to: 'w1', x: 1, y: 1 }, { to: 'w0' }, { to: 'w0', button: 1, down: true }, { to: 'w0', button: 272 }, { to: 'w0', wheel: 500 },
    { to: 'w0', key: 0, down: true }, { to: 'w0', x: 'a', y: 1 }, { to: 'streams', x: 1, y: 1 }, null, 'w0']) assert.equal(cleanOrder(bad, sizes), null, JSON.stringify(bad))
  // an open menu reaching out of the window at its bottom right: its part outside is allowed, the empty corner is not
  const menu = { w0: [[0, 0, 700, 520], [600, 400, 200, 300]] }
  assert.deepEqual(cleanOrder({ to: 'w0', x: 750, y: 650 }, menu), { to: 'w0', x: 750, y: 650 })
  assert.deepEqual(cleanOrder({ to: 'w0', x: 300, y: 650 }, menu), { to: 'w0', x: 300, y: 519 })
  assert.deepEqual(cleanOrder({ to: 'w0', x: 900, y: 450 }, menu), { to: 'w0', x: 799, y: 450 })
})

test('an address from the internet that keeps giving wrong keys is refused for the rest of the hour; the home network never', () => {
  const refused = new Map(), t = 1e6, guesser = '203.0.113.9'
  for (let i = 1; i <= 9; i++) assert.equal(wrongKey(refused, guesser, t + i), false)
  assert.equal(blocked(refused, guesser, t + 9), false) // nine are allowed
  assert.equal(wrongKey(refused, guesser, t + 10), true) // the tenth blocks (and is what the journal tells of)
  assert.equal(blocked(refused, guesser, t + 60e3), true)
  assert.equal(blocked(refused, '203.0.113.10', t + 60e3), false) // another address is not
  assert.equal(blocked(refused, guesser, t + 1 + 3600e3), false) // an hour after its first wrong key
  assert.equal(wrongKey(refused, guesser, t + 2 + 3600e3), false) // and counting starts afresh
  for (const home of ['::ffff:192.168.31.5', '10.0.0.7', '172.20.1.1', 'fd12::1', 'fe80::2', '::1']) {
    for (let i = 0; i < 20; i++) wrongKey(refused, home, t)
    assert.equal(blocked(refused, home, t), false, home)
  }
  for (let i = 0; i < 10; i++) wrongKey(refused, '::ffff:100.64.0.1', t) // a mobile network's shared address is not home
  assert.equal(blocked(refused, '::ffff:100.64.0.1', t), true)
})

test('a page of another site is not answered, also when its name is made to point at this PC; programs and our own pages are', () => {
  assert.equal(foreign(undefined, '127.0.0.1:8080', true), false) // the extension, curl, the helper's tools
  assert.equal(foreign('http://localhost:8080', 'localhost:8080', true), false) // the settings page on this PC
  assert.equal(foreign('https://192.168.1.5:8443', '192.168.1.5:8443', false), false) // the phone's page
  assert.equal(foreign('https://evil.example', '127.0.0.1:8080', true), true) // another site's page in a browser here
  assert.equal(foreign('https://evil.example', '192.168.1.5:8443', false), true) // and in a browser of the home
  assert.equal(foreign('null', '127.0.0.1:8080', true), true) // a page with no site of its own
  assert.equal(foreign('http://evil.example:8080', 'evil.example:8080', true), true) // its name pointed at this PC
  assert.equal(foreign(undefined, 'evil.example:8080', true), true)
  assert.equal(foreign(undefined, undefined, true), true)
})

test('the phone keyboard\'s keys get the Linux key codes', () => {
  assert.deepEqual([KEYCODES.Escape, KEYCODES.Digit0, KEYCODES.KeyA, KEYCODES.KeyM, KEYCODES.Space, KEYCODES.F10, KEYCODES.NumLock, KEYCODES.NumpadDecimal],
    [1, 11, 30, 50, 57, 68, 69, 83])
  assert.deepEqual([KEYCODES.ArrowUp, KEYCODES.Delete, KEYCODES.MetaLeft], [103, 111, 125])
})

test('a key from the phone: only into the window with the keyboard, no Alt+F2, a release only after its press', () => {
  const held = new Map(), key = (code, down) => ({ to: 'w0', key: code, down })
  assert.equal(passKey(key(30, true), 7, 8, held), false) // another window has the keyboard
  assert.equal(passKey(key(30, false), 7, 8, held), false) // so its release is not sent either
  assert.equal(passKey(key(30, true), 7, 7, held), true)
  assert.equal(passKey(key(30, false), 7, 7, held), true)
  assert.equal(held.size, 0)
  assert.equal(passKey(key(56, true), 7, 7, held), true) // Alt
  assert.equal(passKey(key(60, true), 7, 7, held), false) // + F2: GNOME's "run a command"
  assert.equal(passKey(key(62, true), 7, 7, held), true) // + F4 closes the window, as on the PC
})

// --- where the head is, from the camera (app/track.js): made-up pictures of a room, from a camera on an arm before
// the neck. The head turns about the neck; the neck moves when the body leans. The room, in metres from the neck: a
// wall 1 m ahead, a wall 45 cm to the right, a far one to the left, a desk 30 cm below, a floor, a ceiling. (The
// tests before these had one flat wall for a room: the way of tracking that failed on a real phone passed them.)
const SEEN = { w: 160, h: 90, focal: 80 / Math.tan(36 * RAD) }
const speck = (x, y, seed) => { let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32 * 2 - 1 }
function blotches(x, y, seed) { // a pattern of soft blotches, -1 to 1: values on a grid, smoothly between them
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  return (speck(x0, y0, seed) * (1 - u) + speck(x0 + 1, y0, seed) * u) * (1 - v) + (speck(x0, y0 + 1, seed) * (1 - u) + speck(x0 + 1, y0 + 1, seed) * u) * v
}
const paint = (a, b, seed) => 128 + 50 * blotches(a / 0.07, b / 0.07, seed) + 30 * blotches(a / 0.028, b / 0.028, seed + 50)
function seen(at, turn) { // the camera's picture from the place `at`, turned by `turn`
  const { w, h, focal } = SEEN, gray = new Float32Array(w * h), ray = new Vector3(), axes = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(turn))
  const [ax, ay, az] = at
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    ray.set((i - (w - 1) / 2) / focal, ((h - 1) / 2 - j) / focal, -1).applyMatrix3(axes)
    let near = Infinity, value = 128
    const hit = (far, seed, a, b) => { if (far > 0 && far < near) { near = far; value = paint(a(far), b(far), seed) } }
    const x = far => ax + far * ray.x, y = far => ay + far * ray.y, z = far => az + far * ray.z
    hit((-1 - az) / ray.z, 1, x, y) // the wall ahead
    hit((2 - az) / ray.z, 2, x, y) // the wall behind
    hit((0.45 - ax) / ray.x, 3, z, y) // to the right
    hit((-1.5 - ax) / ray.x, 4, z, y) // to the left
    hit((1.2 - ay) / ray.y, 5, x, z) // the ceiling
    hit((-1 - ay) / ray.y, 6, x, z) // the floor
    const desk = (-0.3 - ay) / ray.y
    if (z(desk) < -0.15) hit(desk, 7, x, z) // the desk, from 15 cm before the neck to the wall
    gray[j * w + i] = value
  }
  return gray
}
const ARM = new Vector3(0.03, 0.06, -0.15) // the camera from the neck: 3 cm right, 6 up, 15 ahead
const look = (yaw, pitch) => new Quaternion().setFromEuler(new Euler(pitch * RAD, yaw * RAD, 0, 'YXZ')) // degrees: to the left, up
// The room looked around for five seconds from a chair, and a map made of it. show(neck, yaw, pitch, wander): the
// next picture, the neck at `neck`, the sensors telling the yaw `wander` degrees wrong; gives whether the head was found.
function scanned() {
  const room = space(SEEN.w, SEEN.h, 72)
  const show = (neck, yaw, pitch, wander = 0) => {
    const turn = look(yaw, pitch)
    return room.step(seen(ARM.clone().applyQuaternion(turn).add(new Vector3(...neck)).toArray(), turn), look(yaw + wander, pitch).toArray())
  }
  room.scan()
  for (let i = 0; i < 150; i++) show([0, 0, 0], 25 * Math.sin(i / 150 * 6.283), 12 * Math.sin(i / 150 * 12.566))
  assert.ok(room.finish(), 'no map came of the scan')
  assert.ok(room.count > 40, `only ${room.count} landmarks`)
  return { room, show }
}
const size = v => Math.hypot(...v)

test('looking around moves nothing: toward the near wall on the right, down at the desk, up (what failed on the real phone)', () => {
  const { room, show } = scanned()
  let worst = 0, held = 0
  for (let i = 0; i < 90; i++) { // other looks than the scan's
    held += show([0, 0, 0], 22 * Math.sin(i / 90 * 6.283 * 1.5), 11 * Math.cos(i / 90 * 6.283))
    worst = Math.max(worst, size(room.head))
  }
  assert.ok(held > 85, `found in ${held} of 90 pictures`)
  assert.ok(worst < 0.03, `the head told ${worst} of the usual distance away`) // the old way told 0.25 and more
})
test('leaning forward and aside is found, each by itself, while the head also looks about', () => {
  const { room, show } = scanned()
  for (let i = 1; i <= 30; i++) show([0, 0, -0.1 * i / 30], 8 * Math.sin(i / 5), 0)
  const metres = 0.1 / -room.head[2] // the map's "usual distance" in metres, from the lean that is known
  assert.ok(metres > 0.4 && metres < 1.3, `a usual distance of ${metres} m in a room of 0.3 to 1.5 m`)
  assert.ok(Math.hypot(room.head[0], room.head[1]) * metres < 0.015, `leaning forward told as ${room.head.map(n => n * metres)}`)
  for (let i = 1; i <= 20; i++) show([0.06 * i / 20, 0, -0.1], -10 * i / 20, 5 * i / 20)
  const told = room.head.map(n => n * metres)
  assert.ok(Math.abs(told[0] - 0.06) < 0.015 && Math.abs(told[1]) < 0.015 && Math.abs(told[2] + 0.1) < 0.02, `6 cm right and 10 cm forward told as ${told}`)
  room.centre()
  show([0.06, 0, -0.1], -10, 5)
  assert.ok(size(room.head) * metres < 0.01, 'centred: zero is where the head is now')
})
test('sensors that wander by three degrees do not carry the head away', () => {
  const { room, show } = scanned()
  let held = 0
  for (let i = 0; i < 180; i++) held += show([0, 0, 0], 10 * Math.sin(i / 20), 4 * Math.sin(i / 13), 3 * i / 180)
  assert.ok(held > 170, `found in ${held} of 180 pictures`)
  assert.ok(size(room.head) < 0.04, `the head told ${room.head} away`) // 3 degrees taken for a step aside would be 0.05
})
test('where the scan never looked the head stays as last found, and is found again on the way back', () => {
  const { room, show } = scanned()
  for (let i = 1; i <= 15; i++) show([0, 0, -0.05 * i / 15], 0, 0)
  const leaned = room.head.slice()
  let kept
  for (let i = 1; i <= 40; i++) if (!show([0, 0, -0.05], 2.5 * i, 0)) kept ??= room.head.slice() // 100 degrees to the left
  assert.equal(room.held, false)
  assert.deepEqual(room.head, kept)
  assert.ok(size(sub3(kept, leaned)) < 0.02, `lost with the head told ${kept}, before the turn ${leaned}`)
  let held = false
  for (let i = 40; i >= 0; i--) held = show([0, 0, -0.05], 2.5 * i, 0)
  assert.ok(held && size(sub3(room.head, leaned)) < 0.02, `back, the head told ${room.head}, before ${leaned}`)
})

test('the helper may change only the sphere\'s own settings, numbers brought into their range and onto their step', () => {
  const backgrounds = ['bg/a.jpg', 'bg/b.jpg']
  assert.deepEqual(settingsPatch({ bgDim: 43, focusGlow: false, bg: 'bg/b.jpg', camShiftX: 99 }, backgrounds), { bgDim: 45, focusGlow: false, bg: 'bg/b.jpg', camShiftX: 20 })
  assert.throws(() => settingsPatch({ publicHost: 'x' }, backgrounds), /no setting "publicHost"/)
  assert.throws(() => settingsPatch({ bgDim: 'dark' }, backgrounds), /a number from 0 to 90/)
  assert.throws(() => settingsPatch({ bg: '../secret' }, backgrounds), /one of: bg\/a.jpg/)
  assert.throws(() => settingsPatch({ sixDof: 1 }, backgrounds), /true or false/)
  assert.throws(() => settingsPatch({}, backgrounds), /must be an object/)
  const told = settingsTold({ bgDim: 30, sixDof: true }, backgrounds).settings
  assert.deepEqual(told.find(s => s.key === 'bgDim'), { key: 'bgDim', about: 'Darkening of the background, %', value: 30, min: 0, max: 90, step: 5 })
  assert.equal(told.find(s => s.key === 'sixDof').value, true)
})

test('the Claude program: the one named, else the newest that came with VS Code, else none', () => {
  assert.equal(claudeProgram({ VR_CLAUDE: '/x/claude', PATH: '' }, '/nowhere'), '/x/claude')
  assert.equal(claudeProgram({ PATH: '/nowhere/bin' }, '/nowhere'), null)
})

test('the helper\'s tools answer Claude\'s requests and pass them on to the server', async () => {
  const asked = [], png = Buffer.from('fake picture').toString('base64')
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    asked.push([req.method, req.url, body])
    if (req.url === '/assist/marks') return res.end(JSON.stringify([{ n: 1, about: 'the whole of the window "Site".', png }]))
    if (req.url === '/assist/do') return res.writeHead(400).end('The actions: record, recenter, look_around, switch_off')
    res.end(JSON.stringify({ now: { bgDim: 40 } }))
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const tools = spawn(process.execPath, ['assist-tools.js'], { env: { ...process.env, VR_SERVER: `http://127.0.0.1:${server.address().port}` }, stdio: ['pipe', 'pipe', 'inherit'] })
  let text = ''
  tools.stdout.on('data', chunk => { text += chunk })
  const ask = async (id, method, params) => {
    tools.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    for (;;) {
      const line = text.split('\n').slice(0, -1).map(l => JSON.parse(l)).find(m => m.id === id)
      if (line) return line
      await once(tools.stdout, 'data')
    }
  }
  try {
    assert.equal((await ask(1, 'initialize', { protocolVersion: '2025-06-18' })).result.serverInfo.name, 'vr-sphere')
    tools.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n') // a notice gets no answer
    assert.deepEqual((await ask(2, 'tools/list')).result.tools.map(t => t.name), ['sphere_settings', 'sphere_set', 'sphere_do', 'sphere_marks', 'sphere_windows', 'sphere_open', 'sphere_place', 'sphere_close', 'sphere_type', 'sphere_layout'])
    await ask(7, 'tools/call', { name: 'sphere_windows', arguments: {} })
    assert.deepEqual(asked.at(-1), ['GET', '/assist/windows', ''])
    await ask(8, 'tools/call', { name: 'sphere_place', arguments: { panel: 'w0', beside: { panel: 'm0', side: 'right' } } })
    assert.deepEqual(asked.at(-1), ['POST', '/assist/place', '{"panel":"w0","beside":{"panel":"m0","side":"right"}}'])
    assert.deepEqual((await ask(3, 'tools/call', { name: 'sphere_set', arguments: { changes: { bgDim: 40 } } })).result.content, [{ type: 'text', text: '{"now":{"bgDim":40}}' }])
    assert.deepEqual(asked.at(-1), ['POST', '/assist/settings', '{"changes":{"bgDim":40}}'])
    assert.deepEqual((await ask(4, 'tools/call', { name: 'sphere_marks', arguments: {} })).result.content,
      [{ type: 'text', text: 'Mark 1: the whole of the window "Site".' }, { type: 'image', data: png, mimeType: 'image/png' }])
    const refused = (await ask(5, 'tools/call', { name: 'sphere_do', arguments: { action: 'dance' } })).result // the server's refusal reaches Claude as words
    assert.equal(refused.isError, true)
    assert.match(refused.content[0].text, /The actions: record/)
    assert.equal((await ask(6, 'resources/list')).error.code, -32601)
  } finally {
    tools.kill()
    server.close()
  }
})

// --- the helper and the windows
// A sphere for the tests: a monitor ahead and two windows, as server.js lists the panels
const PANELS = [{ id: 'm0', name: 'HDMI-2' }, { id: 'w0', name: 'main.js — VR_WORKSPACE — Visual Studio Code', app: 'Visual Studio Code', appId: 'code.desktop', window: true, crop: [20, 20, 1200, 800], focused: true },
  { id: 'w1', name: 'Site', app: 'Firefox', appId: 'firefox.desktop', window: true, crop: [0, 0, 1000, 1000] }]
const sphere = more => complete({ virtualSizes: ['1920x1080'], monitors: PANELS, 'm0.span': 60, 'w0.yaw': 40, 'w0.pitch': 10, 'w0.span': 30, 'w0.dist': 1.5, 'w1.yaw': -50, 'w1.pitch': 0, 'w1.span': 40, 'w1.dist': 2, ...more })

test('a panel put beside another stands where carrying it there by hand would leave it', () => {
  const other = { yaw: 10, pitch: 20, w: 40, h: 25 }, mine = { w: 30, h: 20 }
  for (const side of ['left', 'right', 'above', 'below']) {
    const at = besidePanel(mine, other, side), kept = snapPanel({ ...mine, ...at }, [other])
    assert.ok(Math.abs(kept.yaw - at.yaw) < 1e-9 && Math.abs(kept.pitch - at.pitch) < 1e-9 && kept.to === 0, side)
  }
  assert.ok(besidePanel(mine, other, 'right').yaw > 10 + 35 && besidePanel(mine, other, 'left').yaw < 10 - 35) // half of each and the gap, more than that above the eyes
  assert.equal(besidePanel(mine, other, 'above').pitch, 20 + 22.5 + 2)
})

test('the helper is told the panels: where each hangs, how much of the view it takes, which one was looked at', () => {
  const told = panelsTold(sphere({ 'm0.hidden': true }), PANELS, 'w1')
  assert.deepEqual(told[0], { panel: 'm0', kind: 'monitor', title: 'HDMI-2', yaw: 0, pitch: 0, width: 60, height: 33.8, dist: 1.5, hidden: true })
  assert.deepEqual(told[1], { panel: 'w0', kind: 'window', title: 'main.js — VR_WORKSPACE — Visual Studio Code', program: 'Visual Studio Code', yaw: 40, pitch: 10, width: 30, height: 20, dist: 1.5, keyboard: true })
  assert.deepEqual(told[2], { panel: 'w1', kind: 'window', title: 'Site', program: 'Firefox', yaw: -50, pitch: 0, width: 30, height: 30, dist: 2, looked: true }) // 40 degrees at 1.5 m are 30 at 2 m
})

test('the helper places a panel: numbers into their ranges, the size in the view kept apart from the distance, beside another one', () => {
  const all = sphere()
  assert.deepEqual(placePatch(all, PANELS, 'w0', { yaw: 200, pitch: -90 }), { 'w0.yaw': -160, 'w0.pitch': -60 })
  assert.deepEqual(placePatch(all, PANELS, 'w1', { width: 45 }), { 'w1.span': 60 })            // 45 degrees seen from 2 m
  assert.deepEqual(placePatch(all, PANELS, 'w1', { dist: 1 }), { 'w1.dist': 1 })                // nearer alone: larger in the view, as a real screen
  assert.deepEqual(placePatch(all, PANELS, 'w1', { dist: 1, width: 30 }), { 'w1.dist': 1, 'w1.span': 20 })
  // to the right of the code window, at its height: half of each (15.2 and 15.2 of turn at 10 degrees up) and the gap of 2
  assert.deepEqual(placePatch(all, PANELS, 'w1', { beside: { panel: 'w0', side: 'right' } }), { 'w1.yaw': 72, 'w1.pitch': 10 })
  assert.equal(placePatch(all, PANELS, 'w1', { beside: { panel: 'w0', side: 'below' } })['w1.pitch'], 10 - (20 + 30) / 2 - 2)
  assert.throws(() => placePatch(all, PANELS, 'w7', { yaw: 0 }), /no panel "w7".*m0, w0, w1/)
  assert.throws(() => placePatch(all, PANELS, 'w0', {}), /Say where/)
  assert.throws(() => placePatch(all, PANELS, 'w0', { yaw: 'left' }), /takes a number/)
  assert.throws(() => placePatch(all, PANELS, 'w0', { beside: { panel: 'w0', side: 'left' } }), /another panel/)
  assert.throws(() => placePatch(all, PANELS, 'w0', { beside: { panel: 'w1', side: 'behind' } }), /left, right, above or below/)
})

test('what the helper may open: a program by its name or a part of it, web links only, files of the user only', () => {
  const apps = [{ id: 'org.gnome.TextEditor.desktop', name: 'Текстовый редактор' }, { id: 'firefox_firefox.desktop', name: 'Firefox' }, { id: 'org.gnome.Nautilus.desktop', name: 'Файлы' }]
  const program = name => meant(apps.map(a => a.name), name, 'program', apps.map(a => a.id))
  assert.equal(program('firefox'), 1)
  assert.equal(program('редактор'), 0)
  assert.equal(program('nautilus'), 2) // by GNOME's id, when the name is in another language
  assert.throws(() => program('gnome'), /Several programs fit "gnome": Текстовый редактор, Файлы/)
  assert.throws(() => program('Blender'), /no program "Blender". There are: Текстовый редактор, Firefox, Файлы/)

  assert.equal(linkOf('youtube.com/watch?v=1'), 'https://youtube.com/watch?v=1')
  assert.equal(linkOf('localhost:3000'), 'http://localhost:3000/')
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'mailto:a@b.c', 'https://user:pass@site.com', '', 'http://']) assert.throws(() => linkOf(bad), /web address/, bad)

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-home-')), other = fs.mkdtempSync(path.join(os.tmpdir(), 'vr-other-'))
  try {
    for (const file of ['Documents/work/report 2026.pdf', 'Documents/notes.txt', 'Downloads/report-old.pdf', 'Documents/.hidden/key.txt', '.ssh/id_rsa', '.config/user-dirs.dirs']) {
      fs.mkdirSync(path.dirname(path.join(home, file)), { recursive: true })
      fs.writeFileSync(path.join(home, file), file.endsWith('.dirs') ? 'XDG_DOCUMENTS_DIR="$HOME/Documents"\nXDG_DOWNLOAD_DIR="$HOME/Downloads"\nXDG_TEMPLATES_DIR="$HOME/"\nXDG_MUSIC_DIR="$HOME/Music"\n' : 'x')
    }
    fs.writeFileSync(path.join(other, 'secret.txt'), 'x')
    const folders = userFolders(home)
    assert.deepEqual(folders, [path.join(home, 'Documents'), path.join(home, 'Downloads')]) // not the home folder itself, not one that is missing
    assert.equal(fileNamed('notes', home, folders), path.join(home, 'Documents/notes.txt'))
    assert.equal(fileNamed('report 2026', home, folders), path.join(home, 'Documents/work/report 2026.pdf'))
    assert.equal(fileNamed('downloads', home, folders), path.join(home, 'Downloads'))                       // a folder by its name
    assert.equal(fileNamed('~/Documents/notes.txt', home, folders), path.join(home, 'Documents/notes.txt'))
    assert.throws(() => fileNamed('report', home, folders), /Several fit "report".*report 2026\.pdf.*report-old\.pdf|Several fit "report".*report-old\.pdf.*report 2026\.pdf/)
    assert.throws(() => fileNamed('key', home, folders), /No file or folder is named like "key".*The newest there/)   // hidden folders are not looked into
    for (const not of ['~/.ssh/id_rsa', '~/Documents/.hidden/key.txt', path.join(other, 'secret.txt'), '~/Documents/../.ssh/id_rsa', '/etc/passwd', '~/nothing']) assert.throws(() => fileNamed(not, home, folders), /no such file among the user's own/, not)
    assert.equal(fileNamed('secret', home, userFolders(home, other)), path.join(other, 'secret.txt'))        // a folder named in the setting
  } finally {
    fs.rmSync(home, { recursive: true })
    fs.rmSync(other, { recursive: true })
  }
})

test('an arrangement is kept and brought back: each kept window is the open one of its program whose title fits best', () => {
  const kept = layoutOf(sphere({ hideMonitors: true }), [...PANELS, { id: 'w2', name: 'Open file', app: 'Firefox', appId: 'firefox.desktop', window: true, crop: [0, 0, 600, 400], over: 'w1' }])
  assert.equal(kept.hideMonitors, true)
  assert.deepEqual(kept.panels.map(p => p.id ?? p.appId), ['m0', 'code.desktop', 'firefox.desktop']) // the dialog is not kept
  assert.deepEqual(kept.panels[1], { appId: 'code.desktop', app: 'Visual Studio Code', title: 'main.js — VR_WORKSPACE — Visual Studio Code', w: 1200, yaw: 40, pitch: 10, span: 30, dist: 1.5, curve: 100 })
  const open = [{ id: 1, appId: 'code.desktop', title: 'index.ts — shop — Visual Studio Code' }, { id: 2, appId: 'code.desktop', title: 'server.js — VR_WORKSPACE — Visual Studio Code' },
    { id: 3, appId: 'firefox.desktop', title: 'Save as', parent: 9 }, { id: 4, appId: 'org.gnome.Nautilus.desktop', title: 'Home' }]
  // the code window of the same project, though another file is open in it now; Firefox has only a dialog open: to be started
  assert.deepEqual(layoutWindows(kept, open).map(({ entry, window }) => [entry.app, window]), [['Visual Studio Code', 2], ['Firefox', undefined]])
  // two kept windows of one program: each open window is taken once
  const two = { panels: [{ appId: 'a', title: 'one' }, { appId: 'a', title: 'two' }, { appId: 'a', title: 'three' }] }
  assert.deepEqual(layoutWindows(two, [{ id: 7, appId: 'a', title: 'two' }, { id: 8, appId: 'a', title: 'zero' }]).map(m => m.window), [8, 7, undefined])
})

test('"this window" is the panel looked at longest while speaking, not the glance at the keyboard for the key', () => {
  const looks = [{ id: 'w0', yaw: 40, pitch: 10, at: 0 }, { id: 'w0', yaw: 44, pitch: 12, at: 500 }, { id: 'w1', yaw: -50, pitch: 0, at: 4000 }, { id: '', yaw: 0, pitch: -55, at: 4600 }]
  assert.deepEqual(lookedMost(looks, 12000), { id: 'w0', yaw: 44, pitch: 12 }) // the longer of its two looks; the 7 s at nothing do not count
  assert.deepEqual(lookedMost([{ id: '', yaw: 5, pitch: -3, at: 0 }], 1000), { id: '', yaw: 5, pitch: -3 }) // no panel at all: where one looked
  assert.equal(lookedMost([], 1000), null)
})
