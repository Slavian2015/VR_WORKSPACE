// A QR code for a short text (a link): rows of booleans, true is a dark module. No quiet zone around it.
// shortcut: byte mode, error correction L, versions 1-5 (up to 106 bytes) and always mask 0, which is all a link to
// this PC needs; take a QR library when longer texts or damaged prints must be handled.
const DATA = [19, 34, 55, 80, 108], CHECK = [7, 10, 15, 20, 26] // codewords of versions 1-5 at level L, one block each

// Reed-Solomon check bytes over GF(256), polynomial 0x11D
export function checkBytes(data, count) {
  const mul = (a, b) => { let r = 0; for (; b; b >>= 1, a = (a << 1) ^ (a & 128 ? 0x11D : 0)) if (b & 1) r ^= a; return r }
  const gen = [1] // the product of (x - 2^i), highest power first
  for (let i = 0, root = 1; i < count; i++, root = mul(root, 2)) {
    gen.push(0)
    for (let j = gen.length - 1; j > 0; j--) gen[j] ^= mul(gen[j - 1], root)
  }
  const rest = Array(count).fill(0)
  for (const byte of data) {
    const factor = byte ^ rest.shift()
    rest.push(0)
    for (let j = 0; j < count; j++) rest[j] ^= mul(gen[j + 1], factor)
  }
  return rest
}

export function qr(text) {
  const bytes = [...new TextEncoder().encode(text)]
  const v = DATA.findIndex(capacity => bytes.length <= capacity - 2)
  if (v < 0) throw new RangeError('text too long for this QR encoder')
  const size = 21 + 4 * v
  // mode "bytes" (0100), the length, the bytes, four zero bits, then filler up to the capacity
  const bits = [0, 1, 0, 0, ...[bytes.length, ...bytes].flatMap(b => [7, 6, 5, 4, 3, 2, 1, 0].map(i => b >> i & 1)), 0, 0, 0, 0]
  const data = Array.from({ length: bits.length / 8 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2))
  for (let pad = 0xEC; data.length < DATA[v]; pad ^= 0xEC ^ 0x11) data.push(pad)
  const words = [...data, ...checkBytes(data, CHECK[v])]

  const dark = Array.from({ length: size }, () => Array(size).fill(false))
  const fixed = Array.from({ length: size }, () => Array(size).fill(false)) // modules that carry no data
  const set = (x, y, on) => { if (x >= 0 && y >= 0 && x < size && y < size) { dark[y][x] = on; fixed[y][x] = true } }
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) } // timing lines
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) { // the three corner squares with their margins
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) set(cx + dx, cy + dy, ![2, 4].includes(Math.max(Math.abs(dx), Math.abs(dy))))
  }
  if (v > 0) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(size - 7 + dx, size - 7 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  // format: level L and mask 0, protected by a BCH code, written twice
  let rest = 0b01000
  for (let i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >> 9) * 0x537)
  const format = (0b01000 << 10 | rest) ^ 0x5412, bit = i => (format >> i & 1) === 1
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
  set(8, size - 8, true)

  // the codewords go in two-module columns from the right edge, snaking up and down; mask 0 flips every other module
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < size; step++) {
      for (const x of [right, right - 1]) {
        const y = (right + 1) & 2 ? step : size - 1 - step
        if (fixed[y][x]) continue
        const on = i < words.length * 8 && (words[i >> 3] >> (7 - (i & 7)) & 1) === 1
        dark[y][x] = on !== ((x + y) % 2 === 0)
        i++
      }
    }
  }
  return dark
}
