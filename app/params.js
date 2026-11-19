// Settings shared by the phone page and the PC control page: key -> [default, min, max, step, label]
export const LAYOUT_SPEC = {
  bgYaw: [0, -180, 180, 5, 'Поворот фона, °'],
  camFov: [70, 40, 130, 1, 'Угол обзора камеры телефона, °'],
  camBelow: [0, 0, 80, 1, 'Камера при взгляде вниз: показывать ниже, ° под горизонтом (0 — выключено)'],
  camShiftX: [0, -20, 20, 0.5, 'Сдвиг картинки камеры вправо / влево, °'],
  camShiftY: [0, -20, 20, 0.5, 'Сдвиг картинки камеры вверх / вниз, °'],
}
// One set per monitor, stored as "m0.yaw", "m1.span", ...
export const MONITOR_SPEC = {
  yaw: [0, -180, 180, 1, 'Вправо / влево, °'],
  pitch: [0, -60, 60, 1, 'Вверх / вниз, °'],
  span: [90, 30, 180, 1, 'Ширина, ° (на расстоянии 1,5 м)'],
  curve: [100, 0, 100, 5, 'Изгиб, % (0 — плоский)'],
  dist: [1.5, 0.5, 5, 0.1, 'Расстояние, м'],
}
// Headset calibration for iPhone 15 Pro in a Gear VR. lensDist, k1 and k2 were found in the user's headset; the rest is a starting guess.
export const LENS_SPEC = {
  screenW: [141, 100, 180, 0.5, 'Ширина экрана телефона, мм'],
  ipd: [63, 54, 72, 0.5, 'Расстояние между линзами, мм'],
  lensDist: [42, 25, 60, 0.5, 'От экрана до линзы, мм'], // 42: measured in the user's headset, the grid stands still at it
  k1: [0.52, 0, 1, 0.01, 'Искажение линзы k1'], // 0.52 and 0.6: tuned by the user until the grid lines were straight
  k2: [0.6, 0, 1, 0.01, 'Искажение линзы k2'],
  chroma: [0, -3, 3, 0.1, 'Цветные каймы, %'],
  cx: [0, -10, 10, 0.25, 'Сдвиг центра по горизонтали, мм'],
  cy: [0, -10, 10, 0.25, 'Сдвиг центра по вертикали, мм'],
}
const SLOT_YAW = [0, 95, -95, 190] // where monitors stand until the user moves them: centre, right, left, behind (same list in capture.py)
const WINDOW_YAW = [0, 55, -55, 110, -110, 165, -165, 0] // and single windows (w0, w1, ...): a row under the monitors

// Server answer -> full settings: every key has a value, monitors included.
export function complete(answer) {
  const all = { bg: 'bg/old_field.jpg', recenter: 0, autoBlack: true, hideMonitors: false, camKeep: false, virtualSize: answer.virtualSizes[0] }
  for (const [key, spec] of Object.entries({ ...LAYOUT_SPEC, ...LENS_SPEC })) all[key] = spec[0]
  answer.monitors.forEach(({ id, virtual, window }, i) => {
    if (virtual) all[`${id}.size`] = answer.virtualSize ?? answer.virtualSizes[0] // its own size, until set: the one for all
    for (const [key, spec] of Object.entries(MONITOR_SPEC)) all[`${id}.${key}`] = key === 'yaw' ? SLOT_YAW[i] ?? 0 : spec[0]
    if (window) Object.assign(all, { [`${id}.yaw`]: WINDOW_YAW[id.slice(1)] ?? 0, [`${id}.pitch`]: -45, [`${id}.span`]: 60 }) // curved as a monitor
    all[`${id}.hidden`] = false
    if (answer.dist != null) all[`${id}.dist`] = answer.dist // the distance used to be one for all monitors
  })
  return { ...all, ...answer }
}

// The user's field in the headset's list of applications: puts an application (GNOME's id) into place k (-1: out
// of the field). pins: the id in each place, null where free. A taken place: the icons between it and the nearest
// free place, on either side, move one place toward that one; in a full field the last one leaves it.
export function placeIcon(pins, id, k) {
  const out = pins.map(pin => pin === id ? null : pin)
  if (k < 0) return out
  const free = out.flatMap((pin, i) => pin === null ? [i] : [])
  out.splice(free.length ? free.reduce((a, b) => Math.abs(b - k) < Math.abs(a - k) ? b : a) : out.length - 1, 1)
  out.splice(k, 0, id)
  return out
}

// Calls onChange with the full settings at start and every time anyone changes them, and onLost when the server
// has not answered for a second (onChange is called again when it is back).
// Reloads the page when the server reports other code than the page was loaded with.
export function watchParams(onChange, onLost) {
  let seen, build, failures = 0, fast = false // fast: while monitors are arranged with the mouse, its buttons must feel instant
  const poll = async () => {
    let changed
    try {
      const text = await (await fetch('/params')).text()
      if (text !== seen) changed = JSON.parse(text)
      seen = text
      failures = 0
    } catch { // the server is restarting: keep the current settings and ask again
      if (++failures === 5) {
        seen = undefined // so that the first answer after the break counts as a change
        onLost?.()
      }
    }
    if (changed) fast = changed.edit
    setTimeout(poll, fast ? 40 : 200)
    if (!changed) return
    build ??= changed.build
    if (changed.build !== build) return location.reload()
    onChange(complete(changed))
  }
  poll()
}

// One request at a time, so that the last slider position is also the last one the server gets.
// A null value removes the setting, which brings back its default.
let sending = Promise.resolve()
export const setParams = patch => (sending = sending.then(() => fetch('/params', { method: 'POST', body: JSON.stringify(patch) })).catch(() => {}))
