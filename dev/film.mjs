// A made-up film of a camera on a head, for trying the head movement (app/track.js) on the stand without a phone: a
// room (a wall 1 m ahead, a wall 45 cm to the right, a far one to the left, a desk 30 cm below, a floor, a
// ceiling), seen by a camera 72 degrees across that never turns (the stand's page keeps one turn; a film cannot be
// kept in step with made-up sensors). 480 x 270, 30 pictures a second, 40 s, which the browser then repeats:
//
//    0 to 14 s   the camera sways, 6 cm aside and 4 cm up and down (for the look around: something to tell distances by)
//   16 to 26 s   10 cm forward (held from 17 to 25)
//   28 to 38 s   6 cm to the right (held from 29 to 37)
//
// Grey pictures to standard output:
//
//   node dev/film.mjs | ffmpeg -v error -y -f rawvideo -pix_fmt gray -s 480x270 -r 30 -i - -c:v mjpeg -q:v 3 \
//     -pix_fmt yuvj420p -f mjpeg ~/snap/chromium/common/vr-fake-camera.mjpeg
//   CHROMIUM_FLAGS="--use-file-for-fake-video-capture=$HOME/snap/chromium/common/vr-fake-camera.mjpeg" node dev/page.mjs …
//
// (the snap's Chromium reads files only under ~/snap/chromium/common). The landmarks come out about 0.9 m away, so
// with "distance to what the camera sees" at 0.8 m the page must tell about 9 cm forward and 5 cm to the right, from
// wherever the head was on average while the room was looked around. The room is the one of the tests (test.js).
const W = 480, H = 270, F = W / 2 / Math.tan(36 * Math.PI / 180)
const speck = (x, y, seed) => { let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32 * 2 - 1 }
function blotches(x, y, seed) { // a pattern of soft blotches, -1 to 1: values on a grid, smoothly between them
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  return (speck(x0, y0, seed) * (1 - u) + speck(x0 + 1, y0, seed) * u) * (1 - v) + (speck(x0, y0 + 1, seed) * (1 - u) + speck(x0 + 1, y0 + 1, seed) * u) * v
}
const paint = (a, b, seed) => 128 + 50 * blotches(a / 0.07, b / 0.07, seed) + 30 * blotches(a / 0.028, b / 0.028, seed + 50)
const ease = t => t * t * (3 - 2 * t), ramp = (t, a, b) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))))
for (let frame = 0; frame < 1200; frame++) {
  const t = frame / 30, sway = ramp(t, 0, 1) - ramp(t, 13, 14)
  const ax = 0.06 * sway * Math.sin(t * 1.4) + 0.06 * (ramp(t, 28, 29) - ramp(t, 37, 38)), ay = 0.04 * sway * Math.sin(t * 2.3), az = -0.1 * (ramp(t, 16, 17) - ramp(t, 25, 26))
  const out = Buffer.alloc(W * H)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const rx = (i - (W - 1) / 2) / F, ry = ((H - 1) / 2 - j) / F, rz = -1
    let near = Infinity, value = 128
    const hit = (far, seed, a, b) => { if (far > 0 && far < near) { near = far; value = paint(a(far), b(far), seed) } }
    const x = far => ax + far * rx, y = far => ay + far * ry, z = far => az + far * rz
    hit((-1 - az) / rz, 1, x, y) // the wall ahead
    hit((0.45 - ax) / rx, 3, z, y) // to the right
    hit((-1.5 - ax) / rx, 4, z, y) // to the left
    hit((1.2 - ay) / ry, 5, x, z) // the ceiling
    hit((-1 - ay) / ry, 6, x, z) // the floor
    const desk = (-0.3 - ay) / ry
    if (z(desk) < -0.15) hit(desk, 7, x, z) // the desk, from 15 cm before the neck to the wall
    out[j * W + i] = Math.max(0, Math.min(255, value))
  }
  process.stdout.write(out)
}
