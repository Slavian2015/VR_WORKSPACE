// Plays clips of the phone's camera (kept by app/track-test.html in track-clips/) through app/track.js again, on the
// PC: what a real camera gives cannot be made up here.
//
//   node dev/replay.mjs <clip>                  the clip's own scan (the pictures it marks as the scan; an old clip
//                                               has none marked: all of it is the scan), then the rest followed
//   node dev/replay.mjs <scan clip> <clip>      the map from all of the first clip, the second followed in it
//   … --angle 72                                how wide the camera sees, in place of what the clip says
//   … --pictures <folder>                       also every 15th picture of the last clip, as PGM files
//
// Half second by half second: where the phone looked (degrees from its first picture), where the head was found (cm,
// in the first picture's axes, at the clip's "distance to what the camera sees"), how many landmarks were found, the
// part of the pictures in which the head was, and what the phone itself told then (forward, cm).
import fs from 'node:fs'
import { space } from '../app/track.js'

const args = process.argv.slice(2), option = name => args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : null
const angle = option('--angle'), pictures = option('--pictures'), DEG = Math.PI / 180
function read(file) {
  const data = fs.readFileSync(file), view = new DataView(data.buffer, data.byteOffset, data.byteLength), kind = data.subarray(0, 4).toString('latin1')
  if (kind !== 'VRTC' && kind !== 'VRT2') throw new Error(`${file} is not a clip`)
  const w = view.getUint16(4, true), h = view.getUint16(6, true), head = kind === 'VRT2' ? 40 : 32, frames = []
  for (let at = 16; at + head + w * h <= data.length; at += head + w * h) {
    const numbers = k => view.getFloat32(at + 8 + 4 * k, true)
    frames.push({ turn: [0, 1, 2, 3].map(numbers), pixels: data.subarray(at + head, at + head + w * h),
      // the old clips: a lean (toward what was looked at) and whether found; the new: the head's place and 0 lost, 1 found, 2 scanning
      ...(kind === 'VRT2' ? { then: [4, 5, 6].map(numbers), state: numbers(7) } : { forward: numbers(4), state: numbers(5) }) })
  }
  // an old clip's angle is the setting of the camera's picture, which the tracker must not go by: 72 was measured for the iPhone
  return { name: file.split('/').pop(), w, h, angle: +(angle ?? (kind === 'VRT2' ? view.getFloat32(8, true) : 72)), depth: view.getFloat32(12, true), frames }
}
const gaze = ([x, y, z, w]) => [Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)) / DEG, Math.asin(Math.max(-1, Math.min(1, -2 * (y * z - w * x)))) / DEG]
const into = ([x, y, z, w], v) => { // v from the world's axes into those of the turn
  const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]
}

const clips = args.map(read), first = clips[0], last = clips.at(-1), room = space(first.w, first.h, first.angle), cm = last.depth * 100
const marked = first.frames.some(f => f.state === 2), scan = clips.length > 1 || !marked ? first.frames : first.frames.filter(f => f.state === 2)
const rest = clips.length > 1 ? last.frames : marked ? first.frames.filter(f => f.state !== 2) : first.frames
room.scan()
let held = 0
for (const f of scan) held += room.step(Float32Array.from(f.pixels), f.turn)
const made = room.finish()
console.log(`${first.name}: ${first.frames.length} pictures of ${first.w} x ${first.h}, the camera taken to see ${first.angle} degrees across`)
console.log(`the scan, ${scan.length} pictures: ${made ? `a map of ${room.count} landmarks` : 'NO MAP'}, the camera found in ${held} of them; the camera before the pivot (right, up, back): ${room.arm.map(v => (v * cm).toFixed(1)).join(', ')} cm`)
if (made) {
  console.log(`${clips.length > 1 ? last.name : marked ? 'the rest of it' : 'the same clip again'}, followed in that map:`)
  console.log(' time   yaw pitch |  right     up   back | found | held | told then, forward')
  const from = rest[0].turn, g0 = gaze(from), rows = []
  if (pictures) fs.mkdirSync(pictures, { recursive: true })
  rest.forEach((f, i) => {
    const found = room.step(Float32Array.from(f.pixels), f.turn), g = gaze(f.turn)
    rows.push({ yaw: g[0] - g0[0], pitch: g[1] - g0[1], found: +found, head: into(from, room.head), seen: room.seen, then: f.forward ?? -into(from, f.then)[2] })
    if (pictures && i % 15 === 0) fs.writeFileSync(`${pictures}/${String(i).padStart(4, '0')}.pgm`, Buffer.concat([Buffer.from(`P5 ${last.w} ${last.h} 255\n`), f.pixels]))
  })
  for (let at = 0; at < rows.length; at += 15) {
    const part = rows.slice(at, at + 15), mean = pick => part.reduce((sum, r) => sum + pick(r), 0) / part.length
    console.log(`${(at / 30).toFixed(1).padStart(5)} ${mean(r => r.yaw).toFixed(0).padStart(5)} ${mean(r => r.pitch).toFixed(0).padStart(5)} | ${[0, 1, 2].map(k => (mean(r => r.head[k]) * cm).toFixed(1).padStart(6)).join(' ')} | ${mean(r => r.seen).toFixed(0).padStart(5)} | ${mean(r => r.found).toFixed(2)} | ${(mean(r => r.then) * cm).toFixed(1).padStart(6)}`)
  }
}
