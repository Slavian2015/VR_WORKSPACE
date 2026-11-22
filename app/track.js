// Where the head is in the room, from a camera on it and the sensors that tell how it is turned. No library.
//
// First the room is looked around (a scan), and a map of it is made: landmarks, each a corner of something with a
// small picture of how it looks and a place in the room. After that the map is fixed, and every picture of the
// camera tells where the head is: the landmarks are found in it, each gives a line the camera lies on, and the
// camera is where those lines meet.
//
// The scan. Corners are picked in the camera's picture and followed from picture to picture. The turn is known, so
// a corner that is far away stays where the turn alone puts it, and a near one strays from that as the camera
// moves: on a head the camera sits on an arm before the neck and swings when the head looks around. From how the
// corners stray, the way the camera went is found, and each corner's place is where the lines along which it was
// seen meet. From then on every picture finds the landmarks it knows and from them its own place, and the corners
// still being followed become landmarks once they have been seen from far enough apart.
//
// The head, not the camera. While the room is looked around the body sits still, so the scan also tells where the
// camera is for each way of looking when nobody leans: roughly a camera on an arm before a pivot (the neck; the arm
// and the pivot that fit the scan's camera places are found, the arm level: its height cannot be told from a scan
// that mostly turns left and right, and a wrong one made a look down at the desk into 6 cm of leaning back), and
// what is left over, remembered for each way looked (a neck is no single hinge: looking up bends it lower down than
// looking down). Afterwards that resting place is taken off, so what is told is how far the body has moved:
// looking around moves nothing, leaning does. Where the scan never looked only the arm is known.
//
// What came before (2026-11-21 and 22, five tries on a real phone): one flat wall, a fixed distance away, was taken
// for the room, and how much larger or smaller it showed was told as a lean. A real room has a wall near on one
// side and a desk below, and a camera that swings toward them when the head turns sees them grow: turning right by
// 17 degrees was told as leaning 21 cm in. Two clips of the real camera (track-clips/, 2026-11-22) showed that,
// and showed this way holding the head still within 1 to 2 cm through the same turns.
//
// shortcut: the map lives as long as the page, and nothing is added to it after the scan. Keeping it for the next
// start needs the sensors' new heading found in it (a search over the yaw); upgrade when a look around at every
// start, or no head movement where the scan never looked, gets in the way.
//
// Lengths are in "distances": one is how far half of the landmarks are (how many metres that is, nobody can tell
// from pictures alone; the page has a setting for it). Axes as the head's: x right, y up, z back. A turn is a
// quaternion [x, y, z, w] that takes the head's axes to the world's.
//
//   const room = space(160, 90, 72)        the pictures' size and how wide the camera sees across, degrees
//   room.scan()                            a new map from here on: look around
//   room.step(gray, turn)                  gray: brightness, a row after a row from the top; true: the place is found
//   room.finish()                          the scan is over: true if a map came of it (else there is none again)
//   room.state                             'none', 'scan' or 'ready'
//   room.head                              [x, y, z] in the world's axes, from where it was during the scan
//   room.centre()                          the head is at zero where it is now
//   room.count, room.seen, room.dots       landmarks in the map; found in the last picture; where, [[x, y]]
//   shrink(context, video, 160, 90)        a camera's picture as that brightness, through a 2D canvas three times as large
//   turnAt(turns, when)                    the head's turn at the moment a picture was taken, from the turns told lately
//   clip(160, 90, 72, 0.8)                 keeps pictures with their turns for dev/replay.mjs: .add(…), .file()
const DEG = Math.PI / 180
const R = 3, AREA = (2 * R + 1) ** 2 // a landmark's picture: 7 x 7
const LEAST = 0.8 // how alike a place must be to a landmark's picture (1: the same)

function matrix([x, y, z, w]) { // the world's axes from the head's, row after row
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]
}
const turned = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z]
const back = (m, [x, y, z]) => [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z] // by the turn the other way
const times = (a, b) => [0, 1, 2].flatMap(i => [0, 1, 2].map(j => a[3 * i] * b[j] + a[3 * i + 1] * b[j + 3] + a[3 * i + 2] * b[j + 6]))
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = v => mul(v, 1 / (Math.hypot(...v) || 1))
const apart = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) // the angle between two directions
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]

// A picture made ready: a little smoothed (the camera's noise), with its slopes.
function ready(gray, w, h) {
  const data = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, n = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy
      if (xx >= 0 && xx < w && yy >= 0 && yy < h) { sum += gray[yy * w + xx]; n++ }
    }
    data[y * w + x] = sum / n
  }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    gx[y * w + x] = (data[y * w + x + 1] - data[y * w + x - 1]) / 2
    gy[y * w + x] = (data[(y + 1) * w + x] - data[(y - 1) * w + x]) / 2
  }
  return { w, h, data, gx, gy }
}
function sample({ w, data }, x, y) { // between four pixels
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, at = y0 * w + x0
  return (1 - fx) * (1 - fy) * data[at] + fx * (1 - fy) * data[at + 1] + (1 - fx) * fy * data[at + w] + fx * fy * data[at + w + 1]
}
// Corners: places that can be found again both across and up and down (the smaller eigenvalue of the slopes' matrix
// over 5 x 5), the best of each cell of a grid, away from the `taken` places. [[x, y]]
function corners({ w, h, gx, gy }, taken) {
  const CELL = 16, MARGIN = 8, found = []
  for (let cy = MARGIN; cy < h - MARGIN; cy += CELL) for (let cx = MARGIN; cx < w - MARGIN; cx += CELL) {
    let best = 4, bx = -1, by = -1
    for (let y = cy; y < Math.min(cy + CELL, h - MARGIN); y++) for (let x = cx; x < Math.min(cx + CELL, w - MARGIN); x++) {
      let a = 0, b = 0, c = 0
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const i = (y + dy) * w + x + dx
        a += gx[i] * gx[i]; b += gx[i] * gy[i]; c += gy[i] * gy[i]
      }
      const low = (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b)
      if (low > best) { best = low; bx = x; by = y }
    }
    if (bx >= 0 && !taken.some(([x, y]) => Math.abs(x - bx) < 7 && Math.abs(y - by) < 7)) found.push([bx, by])
  }
  return found
}
// The small picture around (x, y), its mean taken off and its length made one (so light and exposure do not count);
// null where there is nothing to tell by. `warp` [a, b, c, d]: where a step of it goes in this picture.
function patch(pic, x, y, warp = [1, 0, 0, 1]) {
  const out = new Float32Array(AREA), reach = R * Math.max(Math.abs(warp[0]) + Math.abs(warp[1]), Math.abs(warp[2]) + Math.abs(warp[3])) + 2
  if (!(x >= reach && y >= reach && x < pic.w - reach && y < pic.h - reach)) return null
  let mean = 0, n = 0
  for (let v = -R; v <= R; v++) for (let u = -R; u <= R; u++) mean += out[n++] = sample(pic, x + warp[0] * u + warp[1] * v, y + warp[2] * u + warp[3] * v)
  mean /= AREA
  let length = 0
  for (let i = 0; i < AREA; i++) { out[i] -= mean; length += out[i] * out[i] }
  if (length < AREA * 4) return null // flat: the brightness differs by less than 2 of 255
  length = Math.sqrt(length)
  for (let i = 0; i < AREA; i++) out[i] /= length
  return out
}
// Where the small picture `want` is in `pic`, within `reach` pixels of (x, y): [x, y] to a part of a pixel, or null.
function find(pic, want, x, y, reach, warp) {
  const score = (dx, dy) => {
    const got = patch(pic, x + dx, y + dy, warp)
    if (!got) return -1
    let sum = 0
    for (let i = 0; i < AREA; i++) sum += got[i] * want[i]
    return sum
  }
  let best = LEAST, bx = 0, by = 0, any = false
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const s = score(dx, dy)
    if (s > best) { best = s; bx = dx; by = dy; any = true }
  }
  if (!any || Math.abs(bx) === reach || Math.abs(by) === reach) return null // at the rim the best may lie outside
  // between the pixels: the top of a parabola through the neighbours, across and up and down
  const top = (lo, hi) => { const bend = lo - 2 * best + hi; return bend < -1e-6 ? Math.max(-0.5, Math.min(0.5, (lo - hi) / (2 * bend))) : 0 }
  return [x + bx + top(score(bx - 1, by), score(bx + 1, by)), y + by + top(score(bx, by - 1), score(bx, by + 1))]
}

// Three equations with three unknowns, the matrix symmetric (a b c / b d e / c e f); null if they do not decide.
function solve3([a, b, c, d, e, f], [p, q, r]) {
  const det = a * (d * f - e * e) - b * (b * f - e * c) + c * (b * e - d * c)
  if (!(Math.abs(det) > 1e-12 * Math.abs(a * d * f) + 1e-30)) return null
  return [(p * (d * f - e * e) - b * (q * f - e * r) + c * (q * e - d * r)) / det,
    (a * (q * f - e * r) - p * (b * f - e * c) + c * (b * r - q * c)) / det,
    (a * (d * r - q * e) - b * (b * r - q * c) + p * (b * e - d * c)) / det]
}
function solve(a, b) { // n equations, the rows of a; null if they do not decide
  const n = b.length, m = a.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    if (Math.abs(m[p][c]) < 1e-12) return null
    ;[m[c], m[p]] = [m[p], m[c]]
    for (let r = 0; r < n; r++) if (r !== c) { const k = m[r][c] / m[c][c]; for (let j = c; j <= n; j++) m[r][j] -= k * m[c][j] }
  }
  return m.map((row, i) => row[n] / row[i])
}
// One more line, through `from` along the direction `ray`, into the sums of "the point nearest to all the lines":
// used both ways, for a landmark from the cameras that saw it and for a camera from the landmarks it sees.
function line(sums, from, [x, y, z], weight) {
  const a = [1 - x * x, -x * y, -x * z, 1 - y * y, -y * z, 1 - z * z]
  for (let k = 0; k < 6; k++) sums.m[k] += weight * a[k]
  sums.v[0] += weight * (a[0] * from[0] + a[1] * from[1] + a[2] * from[2])
  sums.v[1] += weight * (a[1] * from[0] + a[3] * from[1] + a[4] * from[2])
  sums.v[2] += weight * (a[2] * from[0] + a[4] * from[1] + a[5] * from[2])
}
const fresh = () => ({ m: [0, 0, 0, 0, 0, 0], v: [0, 0, 0] })
// The direction t for which the sum of (t . n)^2 over the given [n, weight] is least: the eigenvector with the
// smallest eigenvalue of the sum of n n' (found by Jacobi's turns).
function least(vectors) {
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (const [n, weight] of vectors) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[i][j] += weight * n[i] * n[j]
  for (let sweep = 0; sweep < 12; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[p][q]) < 1e-18) continue
    const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c
    for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y }
    for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y }
    for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y }
  }
  const values = [a[0][0], a[1][1], a[2][2]], k = values.indexOf(Math.min(...values))
  return [v[0][k], v[1][k], v[2][k]]
}

// A picture of the camera for this: each pixel the mean of 3 x 3 of a copy three times as large (shrunk in one go,
// the fine lines of a room flicker). context: of a canvas 3 * width by 3 * height.
export function shrink(context, video, width, height) {
  context.drawImage(video, 0, 0, 3 * width, 3 * height)
  const pixels = context.getImageData(0, 0, 3 * width, 3 * height).data, gray = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) sum += pixels[((3 * y + dy) * 3 * width + 3 * x + dx) * 4 + 1] // green: most of the brightness
    gray[y * width + x] = sum / 9
  }
  return gray
}

// The head's turn at the moment `when`: between the two told around it. turns: [[when, x, y, z, w]] as they came, in
// order of time; before the first or after the last, that one.
export function turnAt(turns, when) {
  let i = turns.length - 1
  while (i > 0 && turns[i][0] > when) i--
  const a = turns[i], b = turns[i + 1]
  if (!b || when <= a[0]) return a.slice(1)
  const part = (when - a[0]) / (b[0] - a[0]), same = a[1] * b[1] + a[2] * b[2] + a[3] * b[3] + a[4] * b[4] < 0 ? -1 : 1
  const q = [1, 2, 3, 4].map(k => a[k] * (1 - part) + same * b[k] * part), length = Math.hypot(...q)
  return q.map(n => n / length)
}

// A scan and what followed it, kept as a clip for playing through this again on a PC (dev/replay.mjs): 'VRT2', the
// pictures' width and height, the camera's angle, the metres in a distance; then for each picture when it was taken
// (ms), the head's turn, the head's place as found, 2 while scanning, else 1 found or 0 not, and its pixels.
export function clip(width, height, angle, depth) {
  const parts = [], head = new DataView(new ArrayBuffer(16))
  'VRT2'.split('').forEach((letter, i) => head.setUint8(i, letter.charCodeAt(0)))
  head.setUint16(4, width, true); head.setUint16(6, height, true); head.setFloat32(8, angle, true); head.setFloat32(12, depth, true)
  return {
    add(taken, turn, place, state, gray) {
      const numbers = new DataView(new ArrayBuffer(40))
      numbers.setFloat64(0, taken, true)
      ;[...turn, ...place, state].forEach((n, i) => numbers.setFloat32(8 + 4 * i, n, true))
      parts.push(numbers.buffer, Uint8Array.from(gray))
    },
    file: () => new Blob([head.buffer, ...parts]),
  }
}

export function space(width, height, angle) {
  const f = width / 2 / Math.tan(angle * DEG / 2), cx = (width - 1) / 2, cy = (height - 1) / 2, PX = 1 / f // PX: a pixel as an angle
  const rayOf = (x, y) => unit([(x - cx) / f, (cy - y) / f, -1]) // a pixel's direction in the head's axes
  const pixelOf = ([x, y, z]) => z < -1e-6 ? [cx - f * x / z, cy + f * y / z] : null
  // Where a pixel of a picture taken with the turn `from` shows in one taken with the turn `to`, by the turn alone,
  // and how a step of a small picture there goes: [x, y, warp] or null.
  function carried(from, to, x, y) {
    const go = (px, py) => pixelOf(back(to, turned(from, rayOf(px, py))))
    const c = go(x, y), right = go(x + 1, y), down = go(x, y + 1)
    return c && right && down ? [c[0], c[1], [right[0] - c[0], down[0] - c[0], right[1] - c[1], down[1] - c[1]]] : null
  }

  const self = { state: 'none', head: [0, 0, 0], held: false, count: 0, seen: 0, fits: 0, dots: [], arm: [0, 0, 0], step, scan, finish, centre }
  // points: the landmarks, { at, patch, turn, x, y: how and where it was first seen, sums, ray: as last counted }
  // followed: corners not yet landmarks, { patch, turn, x, y, at: where in the last picture, now: its direction there
  //   (null: not found), first: its direction when the beginning was counted from, born, missed, lines }
  // place: the camera's; last: the turn of the picture before; fix: the sensors' slow wandering since the scan, undone
  // limb: the sums for the arm and the pivot, and the scan's camera places with their turns; home: the pivot;
  // rest: what the arm leaves over, [{ look, off }] for the ways looked during the scan; zero: where `head` is zero
  let points = [], followed = [], place = [0, 0, 0], last = null, lastTold = null, pictures = 0, lost = 0, base = 0, begun = false
  let fix = IDENTITY, limb = null, home = [0, 0, 0], rest = [], zero = [0, 0, 0]

  function scan() {
    points = []; followed = []; place = [0, 0, 0]; last = lastTold = null; pictures = lost = base = 0; begun = false
    fix = IDENTITY; home = [0, 0, 0]; rest = []; zero = [0, 0, 0]
    limb = { a: Array.from({ length: 6 }, () => new Array(6).fill(0)), b: new Array(6).fill(0), n: 0, seen: [] }
    Object.assign(self, { state: 'scan', head: [0, 0, 0], held: false, count: 0, seen: 0, dots: [], arm: [0, 0, 0] })
  }

  // Every known landmark, looked for where a camera at `from` would see it: [{ point, ray: the direction it shows in, x, y }]
  function sights(pic, turn, from, reach) {
    const got = []
    for (const point of points) {
      const px = pixelOf(back(turn, sub(point.at, from))), shape = px && carried(point.turn, turn, point.x, point.y)
      // from nearer it shows larger: the small picture is laid over as much more of this one (a lean of 15 cm toward
      // things half a metre away left a third of the landmarks to be told by their pictures as they were: 2026-11-22)
      const larger = Math.max(0.5, Math.min(2, (point.far ?? Math.hypot(...sub(point.at, point.first))) / Math.max(0.05, Math.hypot(...sub(point.at, from)))))
      const at = shape && find(pic, point.patch, px[0], px[1], reach, shape[2].map(n => n * larger))
      if (at) got.push({ point, ray: turned(turn, rayOf(at[0], at[1])), x: at[0], y: at[1] })
    }
    return got
  }
  // The camera's place from the landmarks seen: on the line through each along the direction it shows in. What does
  // not fit counts less (a thing that was moved, a wrong match). [the place, the sights that fit] or null.
  function locate(got, from) {
    let at = from
    const off = s => { // how far the landmark shows from where a camera at `at` would see it, as an angle; [that, whether before the camera]
      const d = sub(s.point.at, at), far = dot(d, s.ray)
      return [Math.hypot(...sub(d, mul(s.ray, far))) / Math.max(0.2, far), far > 0]
    }
    for (let round = 0; round < 4; round++) {
      const sums = fresh()
      for (const s of got) {
        const far = Math.max(0.2, dot(sub(s.point.at, at), s.ray))
        line(sums, s.point.at, s.ray, (round ? Math.min(1, 1.5 * PX / (off(s)[0] + 1e-9)) : 1) / (far * far)) // by the angle; less beyond a pixel and a half
      }
      const next = solve3(sums.m, sums.v)
      if (!next) return null
      at = next
    }
    return [at, got.filter(s => { const [angle, before] = off(s); return before && angle < 2.5 * PX })]
  }
  // Where the camera is, looked for from a guess. A few landmarks matched by chance also give a place, and from
  // that wrong place the same few are found again and again (a real phone held on to one for two seconds, 17 cm off:
  // 2026-11-22). So a place is believed only when enough of the landmarks that a camera there must have in its
  // picture are found where it would see them; and what was found from the guess is looked for again from the
  // place it gave, while that finds more. { at, fits, got } to believe, or null; told in self.seen and self.fits.
  function whereabouts(pic, turn, guess, reach) {
    let best = null, at = guess
    for (let pass = 0; pass < 3; pass++) {
      const got = sights(pic, turn, at, pass ? 3 : reach), found = got.length >= 6 && locate(got, at)
      if (!found || (best && found[1].length <= best.fits.length)) break
      const inView = points.filter(p => { const px = pixelOf(back(turn, sub(p.at, found[0]))); return px && px[0] > R + 2 && px[1] > R + 2 && px[0] < width - R - 3 && px[1] < height - R - 3 }).length
      best = { at: found[0], fits: found[1], got, inView }
      if (best.fits.length >= 0.6 * inView) break
      at = found[0]
    }
    self.seen = best ? best.got.length : 0
    self.fits = best ? best.fits.length : 0
    self.inView = best ? best.inView : 0
    self.dots = best ? best.got.map(s => [s.x, s.y]) : []
    return best && best.fits.length >= Math.max(6, 0.35 * best.inView) ? best : null
  }
  function note(point, from, ray) { // one more sight of a landmark: its place from all of them
    const far = Math.max(0.2, Math.hypot(...sub(point.at, from)))
    line(point.sums, from, ray, 1 / (far * far))
    point.ray = ray
    point.at = solve3(point.sums.m, point.sums.v) ?? point.at
  }
  // Where the lines meet, if they agree (within a pixel or so) and it is before every camera: the place, or null
  function meet(lines) {
    const sums = fresh()
    for (const l of lines) line(sums, l.from, l.ray, 1)
    const at = solve3(sums.m, sums.v)
    if (!at) return null
    for (const { from, ray } of lines) {
      const d = sub(at, from), far = dot(d, ray)
      if (!(far > 0.05) || Math.hypot(...sub(d, mul(ray, far))) / far > 1.2 * PX) return null
    }
    return at
  }
  function become(c, at, lines) { // a followed corner becomes a landmark
    const point = { at, patch: c.patch, turn: c.turn, x: c.x, y: c.y, sums: fresh(), ray: null, first: lines[0].from }
    for (const l of lines) note(point, l.from, l.ray)
    points.push(point)
    followed.splice(followed.indexOf(c), 1)
  }
  // The very beginning: no landmark yet. The corners as the first picture saw them and as this one does: once they
  // have strayed enough, the way the camera went between the two is the one that every pair of directions agrees
  // with (it lies in the plane of each pair), and each corner is where its two lines meet. How far the camera went
  // nobody can tell: the landmarks' usual distance is called one.
  function begin() {
    if (!base) base = pictures
    const pairs = followed.filter(c => c.now && c.born <= base)
    if (pairs.length < 12) { // too few are left of the first picture: this one is the first
      base = pictures
      for (const c of followed) if (c.now) Object.assign(c, { first: c.now, born: pictures })
      return
    }
    const strays = pairs.map(c => apart(c.first, c.now)).sort((a, b) => a - b)
    if (strays[strays.length >> 1] < 1.5 * DEG) return
    const planes = pairs.map(c => unit(cross(c.first, c.now)))
    let way, weights = pairs.map(() => 1)
    for (let round = 0; round < 4; round++) { // again with what does not agree counted less
      way = least(planes.map((n, k) => [n, weights[k]]))
      weights = planes.map(n => Math.min(1, 0.15 / (Math.abs(dot(way, n)) + 1e-9)))
    }
    let made = []
    for (const t of [way, mul(way, -1)]) { // forth or back: the one that puts the corners before the camera
      const good = pairs.map(c => { const lines = [{ from: [0, 0, 0], ray: c.first }, { from: t, ray: c.now }]; return { c, lines, at: meet(lines), t } }).filter(o => o.at)
      if (good.length > made.length) made = good
    }
    if (made.length < 10) return
    const fars = made.map(o => Math.hypot(...o.at)).sort((a, b) => a - b), k = 1 / fars[fars.length >> 1]
    for (const o of made) become(o.c, mul(o.at, k), o.lines.map(l => ({ from: mul(l.from, k), ray: l.ray })))
    for (const c of followed) c.lines = []
    place = mul(made[0].t, k)
    begun = self.held = true
  }
  // The sensors wander slowly (a degree in minutes): the landmarks then show turned aside, all together. A camera
  // moved aside looks much the same, but not quite: near landmarks shift more than far ones. So the small turn and
  // the camera's shift that together fit best are looked for at once (six unknowns), and a part of that turn is
  // undone with every picture; the camera's place itself is always found with the turn taken as known.
  function steady(fits) {
    const h = Array.from({ length: 6 }, () => new Array(6).fill(0)), g = new Array(6).fill(0)
    for (const s of fits) {
      const to = sub(s.point.at, place), far = Math.hypot(...to), e = mul(to, 1 / far), [x, y, z] = s.ray, d = sub(e, s.ray)
      // what a shift of the camera and a small turn do to where the landmark shows: three rows, six columns
      const rows = [0, 1, 2].map(i => [...[0, 1, 2].map(k => ((i === k ? -1 : 0) + e[i] * e[k]) / far), ...[[0, -z, y], [z, 0, -x], [-y, x, 0]][i]])
      for (const [i, row] of rows.entries()) for (let a = 0; a < 6; a++) { g[a] -= row[a] * d[i]; for (let b = 0; b < 6; b++) h[a][b] += row[a] * row[b] }
    }
    for (let k = 3; k < 6; k++) h[k][k] += 1e-6 * fits.length
    const found = solve(h, g)
    if (!found) return
    const [x, y, z] = mul(found.slice(3), 0.03), m = times([1, -z, y, z, 1, -x, -y, x, 1], fix)
    // made a turn again: its rows at right angles and of length one
    const a = unit(m.slice(0, 3)), b = unit(sub(m.slice(3, 6), mul(a, dot(a, m.slice(3, 6)))))
    fix = [...a, ...b, ...cross(a, b)]
  }

  function step(gray, q) {
    if (self.state === 'none') return false
    const told = matrix(q), turning = lastTold ? Math.acos(Math.max(-1, Math.min(1, (dot(told, lastTold) + dot(told.slice(3), lastTold.slice(3)) + dot(told.slice(6), lastTold.slice(6)) - 1) / 2))) : 0
    lastTold = told
    if (turning > 0.07) return self.held = false // a fast turn smears the picture (at thirty a second this is 120 degrees a second)
    const pic = ready(gray, width, height), turn = times(fix, told), grow = self.state === 'scan'
    pictures++
    if (grow && last) for (let k = followed.length - 1; k >= 0; k--) {
      // a followed corner: from where it was in the picture before, carried by the turn since; its small picture as it
      // was first seen, warped by the turn since then
      const c = followed[k], near = carried(last, turn, c.at[0], c.at[1]), shape = carried(c.turn, turn, c.x, c.y)
      const got = near && shape && find(pic, c.patch, near[0], near[1], 3, shape[2])
      if (got) Object.assign(c, { at: got, now: turned(turn, rayOf(got[0], got[1])), missed: 0 })
      else { c.now = null; if (!near || ++c.missed > 2) followed.splice(k, 1) }
    }
    last = turn
    if (begun) {
      // lost for a while: looked for farther around, and in turn from where it was last and from where the scan was made
      const guess = lost > 5 && !grow && pictures % 2 ? add(resting(turn), zero) : place
      const found = whereabouts(pic, turn, guess, lost > 30 ? 10 : lost > 5 ? 6 : 4)
      self.held = !!found
      if (found) {
        place = found.at
        lost = 0
        if (grow) {
          for (const s of found.fits) if (apart(s.ray, s.point.ray) > 0.3 * DEG) note(s.point, place, s.ray)
          for (let k = 0; k < 3; k++) { // for the arm: place[k] = pivot[k] + (row k of the turn) . arm
            const row = [0, 0, 0, turn[3 * k], turn[3 * k + 1], turn[3 * k + 2]]
            row[k] = 1
            for (let r = 0; r < 6; r++) { limb.b[r] += row[r] * place[k]; for (let c = 0; c < 6; c++) limb.a[r][c] += row[r] * row[c] }
          }
          if (limb.n++ % (1 + (limb.n >> 10)) === 0) limb.seen.push({ turn, place }) // (a very long scan: not every picture)
        } else {
          if (found.fits.length >= 12) steady(found.fits)
          self.head = back(fix, sub(sub(place, resting(turn)), zero))
        }
      } else lost++
    } else if (grow) begin()
    if (!grow) return self.held
    // followed corners that have been seen from far enough apart become landmarks
    if (begun && self.held) for (const c of followed.slice()) {
      if (!c.now) continue
      if (!c.lines.length || apart(c.now, c.lines.at(-1).ray) > 0.4 * DEG) c.lines.push({ from: place, ray: c.now })
      if (c.lines.length < 3 || apart(c.lines[0].ray, c.now) < 1.2 * DEG) continue
      const at = meet(c.lines)
      if (at) become(c, at, c.lines)
      else if (c.lines.length > 12) followed.splice(followed.indexOf(c), 1) // never agrees: something that moves
    }
    // new corners where nothing is followed or known
    if (pictures % 3 === 1 && points.length + followed.length < 400) {
      const taken = followed.map(c => c.at)
      if (begun && self.held) for (const p of points) { const px = pixelOf(back(turn, sub(p.at, place))); if (px) taken.push(px) }
      for (const [x, y] of corners(pic, taken)) {
        const small = patch(pic, x, y), now = turned(turn, rayOf(x, y))
        if (small) followed.push({ patch: small, turn, x, y, at: [x, y], now, first: now, born: pictures, missed: 0, lines: [] })
      }
    }
    self.count = points.length
    return self.held
  }

  // The scan is over. The arm and the pivot that fit the camera's places (with the arm drawn a little toward none:
  // a scan that hardly turned tells nothing about it); the map's size made one usual distance from the pivot.
  function finish() {
    if (self.state !== 'scan') return self.state === 'ready'
    followed = []
    if (points.length < 15 || !limb.n) { self.state = 'none'; return false }
    for (let k = 3; k < 6; k++) limb.a[k][k] += (k === 4 ? 1e3 : 0.002) * limb.n // the arm level, and drawn a little toward none
    const fit = solve(limb.a, limb.b) ?? [...place, 0, 0, 0]
    const pivot = fit.slice(0, 3), fars = points.map(p => Math.hypot(...sub(p.at, pivot))).sort((a, b) => a - b), k = 1 / fars[fars.length >> 1]
    for (const p of points) { // its small picture was taken from `first`: that far away it looks as it was kept
      p.far = Math.hypot(...sub(p.at, p.first)) * k
      p.at = mul(p.at, k)
      delete p.sums
      delete p.first
    }
    place = mul(place, k)
    home = mul(pivot, k)
    Object.assign(self, { state: 'ready', arm: mul(fit.slice(3), k), head: [0, 0, 0], count: points.length })
    rest = limb.seen.map(({ turn, place }) => ({ look: turned(turn, [0, 0, -1]), off: sub(mul(place, k), add(home, turned(turn, self.arm))) }))
    limb = null
    lost = 0
    return true
  }
  // Where the camera is when the head looks this way and the body sits as it did during the scan: the arm from the
  // pivot, and what the scan found left over when it looked within some 7 degrees of this way (none far from there).
  function resting(turn) {
    const look = turned(turn, [0, 0, -1]), sum = [0, 0, 0]
    let weights = 1
    for (const r of rest) {
      const w = Math.exp((dot(look, r.look) - 1) / 0.015)
      weights += w
      sum[0] += w * r.off[0]; sum[1] += w * r.off[1]; sum[2] += w * r.off[2]
    }
    return add(add(home, turned(turn, self.arm)), mul(sum, 1 / weights))
  }
  function centre() { // zero is where the head is now
    if (self.state === 'ready' && self.held && last) { zero = sub(place, resting(last)); self.head = [0, 0, 0] }
  }
  return self
}
