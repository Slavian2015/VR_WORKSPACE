import test from 'node:test'
import assert from 'node:assert/strict'
import { Euler, Quaternion, Vector3 } from 'three'
import { deviceQuaternion, gazeOf, monitorFrame } from './app/orient.js'

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
