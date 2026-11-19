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
