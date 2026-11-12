import { Euler, Quaternion, Vector3 } from 'three'

const RAD = Math.PI / 180
const X_MINUS_90 = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2) // the view goes out of the back of the phone, not its top
const Z = new Vector3(0, 0, 1)

// deviceorientation angles and screen rotation (all in degrees) -> head rotation in a Y-up world, looking along -Z
export function deviceQuaternion(alpha, beta, gamma, screenAngle, out = new Quaternion()) {
  return out
    .setFromEuler(new Euler(beta * RAD, alpha * RAD, -gamma * RAD, 'YXZ'))
    .multiply(X_MINUS_90)
    .multiply(new Quaternion().setFromAxisAngle(Z, -screenAngle * RAD))
}

// Where the head looks, in radians: yaw around Y (positive to the left) and pitch (positive up).
export function gazeOf(q) {
  const forward = new Vector3(0, 0, -1).applyQuaternion(q)
  return { yaw: Math.atan2(-forward.x, -forward.z), pitch: Math.asin(Math.max(-1, Math.min(1, forward.y))) }
}

// Rotation of a monitor's own frame (it sits at -Z of that frame). `anchor` is the gaze the layout was centred on,
// yaw and pitch are the monitor's place in the layout in degrees, positive to the right and up.
export function monitorFrame(anchor, yaw, pitch, out = new Quaternion()) {
  return out
    .setFromEuler(new Euler(anchor.pitch, anchor.yaw, 0, 'YXZ'))
    .multiply(new Quaternion().setFromEuler(new Euler(pitch * RAD, -yaw * RAD, 0, 'YXZ')))
}
