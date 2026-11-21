// What the headset may ask to be done in a window it shows. This arrives from the network and ends as mouse and
// keyboard input on the PC, so only what is spelled out here passes.
// order: { to: slot, x, y } | { to, button, down } | { to, wheel } | { to, key, down }, also combined.
// areas: { slot: [[x, y, width, height], ...] } of the windows shown: the window itself ([0, 0, w, h]) and its open
// menus, which may reach out of it. Returns the order with only its valid parts, or null.
export function cleanOrder(order, areas) {
  const rects = areas[order?.to]
  if (!rects) return null
  const clean = { to: order.to }
  if (Number.isFinite(order.x) && Number.isFinite(order.y)) { // never outside the window and its menus: else the nearest point of them
    const into = ([x, y, w, h]) => [Math.min(Math.max(order.x, x), x + w - 1), Math.min(Math.max(order.y, y), y + h - 1)]
    const off = ([x, y]) => Math.hypot(x - order.x, y - order.y);
    [clean.x, clean.y] = rects.map(into).reduce((best, point) => off(point) < off(best) ? point : best)
  }
  if ([272, 273, 274].includes(order.button) && typeof order.down === 'boolean') Object.assign(clean, { button: order.button, down: order.down })
  else if (Number.isInteger(order.key) && order.key > 0 && order.key < 256 && typeof order.down === 'boolean') Object.assign(clean, { key: order.key, down: order.down })
  if (Number.isInteger(order.wheel) && order.wheel && Math.abs(order.wheel) <= 10) clean.wheel = order.wheel
  return Object.keys(clean).length > 1 ? clean : null
}

// A key of the phone's keyboard, already through cleanOrder: whether it may go on to the PC. A press only into the
// window that has the PC's keyboard (until the extension brings the looked-at one to the front, the keyboard is with
// another, maybe one not in the headset at all), and never F2 while Alt is held: GNOME's "run a command" box has no
// window of its own, so the keys typed into it would pass. A release only of a key whose press went through.
// source: GNOME's id of the order's window; focused: of the one with the keyboard; held: "slot key" -> the press,
// kept by the caller (updated here).
export function passKey(order, source, focused, held) {
  const id = `${order.to} ${order.key}`, alt = [...held.values()].some(press => press.key === 56 || press.key === 100)
  if (order.down ? source !== focused || (order.key === 60 && alt) : !held.has(id)) return false
  order.down ? held.set(id, order) : held.delete(id)
  return true
}

// Guessing the key from the internet. An address that is not of the home network and gave 10 wrong keys within an
// hour is refused for the rest of that hour, key or no key. refused: Map address -> { count, since }, kept by the caller.
// HOME: addresses of the home network and of this PC (IPv4 private and link-local; IPv6 loopback, unique local, link-local).
export const HOME = /^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)|^(::1$|f[cd][0-9a-f]{2}:|fe80:)/i
export function blocked(refused, from, now = Date.now()) {
  const wrong = HOME.test(from) ? null : refused.get(from)
  return wrong?.count >= 10 && now - wrong.since < 3600e3
}
export function wrongKey(refused, from, now = Date.now()) { // a wrong key from that address; true when this one blocks it
  if (HOME.test(from)) return false
  if (refused.size > 10000) refused.clear() // shortcut: forgets all at 10000 guessing addresses, a block per network if that is ever seen
  const wrong = refused.get(from)
  if (wrong && now - wrong.since <= 3600e3) return ++wrong.count === 10
  refused.set(from, { count: 1, since: now })
  return false
}
