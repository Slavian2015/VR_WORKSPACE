import test from 'node:test'
import assert from 'node:assert/strict'
import { Euler, Quaternion, Vector3 } from 'three'
import { deviceQuaternion, gazeInLayout, gazeOf, monitorFrame } from './app/orient.js'
import { checkBytes, qr } from './gnome-extension/vr-workspace@local/qr.js'
import { blocked, cleanOrder, wrongKey } from './orders.js'
import { KEYCODES, placeIcon, resizeWindow, snapPanel } from './app/params.js'

const RAD = Math.PI / 180
const near = (v, x, y, z) => assert.ok(v.distanceTo(new Vector3(x, y, z)) < 1e-6, `${v.toArray()} is not ${[x, y, z]}`)
const forward = q => new Vector3(0, 0, -1).applyQuaternion(q)
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

test('the phone keyboard\'s keys get the Linux key codes', () => {
  assert.deepEqual([KEYCODES.Escape, KEYCODES.Digit0, KEYCODES.KeyA, KEYCODES.KeyM, KEYCODES.Space, KEYCODES.F10, KEYCODES.NumLock, KEYCODES.NumpadDecimal],
    [1, 11, 30, 50, 57, 68, 69, 83])
  assert.deepEqual([KEYCODES.ArrowUp, KEYCODES.Delete, KEYCODES.MetaLeft], [103, 111, 125])
})
