// Settings shared by the phone page and the PC control page: key -> [default, min, max, step, label]
export const LAYOUT_SPEC = {
  bgYaw: [0, -180, 180, 5, 'Поворот фона, °'],
  camFov: [70, 40, 130, 1, 'Угол обзора камеры телефона, °'],
  camBelow: [0, 0, 80, 1, 'Камера при взгляде вниз: показывать ниже, ° под горизонтом (0 — выключено)'],
  camShiftX: [0, -20, 20, 0.5, 'Сдвиг картинки камеры вправо / влево, °'],
  camShiftY: [0, -20, 20, 0.5, 'Сдвиг картинки камеры вверх / вниз, °'],
  roomDepth: [0.8, 0.3, 5, 0.1, 'Движение головы по камере: расстояние до того, что перед камерой, м'],
  leanGain: [1.5, 0.5, 4, 0.1, 'Движение головы: сила приближения, × (1: как у настоящего монитора на расстоянии руки)'],
  trackFov: [72, 40, 130, 1, 'Движение головы по камере: сколько градусов камера видит поперёк на самом деле'], // 72: measured from clips of an iPhone 15 Pro's main camera
  bgDim: [0, 0, 90, 5, 'Затемнение фона, %'],
  bgBlur: [0, 0, 100, 5, 'Размытие фона, %'],
  sharpen: [40, 0, 100, 5, 'Резкость текста, %'],
  renderScale: [100, 50, 100, 5, 'Разрешение отрисовки, % (меньше: телефон греется меньше, текст мягче)'],
  windowDist: [2, 0.5, 5, 0.1, 'Расстояние до новых окон, м'], // at 1.5 they are 1:1 with the screen, farther smaller
}
// One set per monitor, stored as "m0.yaw", "m1.span", ...
export const MONITOR_SPEC = {
  yaw: [0, -180, 180, 1, 'Вправо / влево, °'],
  pitch: [0, -60, 60, 1, 'Вверх / вниз, °'],
  span: [90, 10, 180, 1, 'Ширина, ° (на расстоянии 1,5 м)'], // 10: a small window as sharp as it can be (see main.js)
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
  glassesFov: [46, 20, 120, 1, 'Очки на кабеле: угол обзора по диагонали, °'], // index.html?glasses; 46: XREAL-like, to be measured
}
const DEG = Math.PI / 180
const SLOT_YAW = [0, 95, -95, 190] // where monitors stand until the user moves them: centre, right, left, behind (same list in capture.py)
const WINDOW_YAW = [0, 55, -55, 110, -110, 165, -165, 0] // and single windows (w0, w1, ...): a row under the monitors

// Server answer -> full settings: every key has a value, monitors included.
export function complete(answer) {
  const all = { bg: 'bg/old_field.jpg', recenter: 0, menuCall: 0, scanCall: 0, autoBlack: true, hideMonitors: false, camKeep: false, sixDof: true, virtualSize: answer.virtualSizes[0],
    glowColor: '#4fb2ff', focusGlow: true, // the light around panels; around the one that gets the keyboard
    publicHost: '', // this PC's address on the internet, for the phone's link from outside the home (server.js)
    phoneMic: false } // the phone's microphone as this PC's (mic.py)
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

const turn = a => ((a + 540) % 360) - 180
const halfTurn = (w, pitch) => Math.atan(Math.tan(w / 2 * DEG) / Math.cos(pitch * DEG)) / DEG
// Where a panel goes to stand beside another one (side: left, right, above, below), `gap` degrees apart, as snapPanel
// would leave it there: at its height to a side, in line with it above or below. Panels as for snapPanel.
export function besidePanel(moving, o, side, gap = 2) {
  if (side === 'above' || side === 'below') return { yaw: o.yaw, pitch: o.pitch + (side === 'above' ? 1 : -1) * ((moving.h + o.h) / 2 + gap) }
  const away = halfTurn(moving.w, o.pitch) + halfTurn(o.w, o.pitch) + gap / Math.cos(o.pitch * DEG)
  return { yaw: turn(o.yaw + (side === 'right' ? away : -away)), pitch: o.pitch }
}

// Where a panel being carried is drawn to: within `reach` degrees of lining up with another panel it goes there (side
// by side or one over the other `gap` apart, edges or middles in line). Panels: { yaw, pitch, w, h }
// in degrees, yaw to the right, pitch up, w and h what they take in the view. Returns { yaw, pitch, to }: to is the
// index of the panel it lined up with, or -1. Above or below the eyes a degree of turn is less than a degree across,
// so half a panel's width takes more turn there (halfTurn: to the middle of its side).
export function snapPanel(moving, others, reach = 3, gap = 2) {
  const off = o => turn(moving.yaw - o.yaw)
  const best = { yaw: moving.yaw, pitch: moving.pitch, to: -1 }
  let miss = reach
  others.forEach((o, i) => { // first the height, if it is beside or over another: over or under it, middles, tops or bottoms in line
    if (Math.abs(off(o)) >= halfTurn(moving.w, moving.pitch) + halfTurn(o.w, o.pitch) + gap + reach) return
    const stack = (moving.h + o.h) / 2 + gap
    for (const target of [stack, -stack, 0, (o.h - moving.h) / 2, (moving.h - o.h) / 2]) {
      const away = Math.abs(moving.pitch - o.pitch - target)
      if (away < miss) [miss, best.pitch, best.to] = [away, o.pitch + target, i]
    }
  })
  miss = reach
  others.forEach((o, i) => { // then across, at the height it got: beside it, edges or middles in line
    if (Math.abs(best.pitch - o.pitch) >= (moving.h + o.h) / 2 + gap + reach / 2) return
    const a = halfTurn(moving.w, best.pitch), b = halfTurn(o.w, o.pitch), side = a + b + gap / Math.cos(best.pitch * DEG)
    for (const target of [side, -side, b - a, a - b, 0]) {
      const away = Math.abs(off(o) - target)
      if (away < miss) [miss, best.yaw, best.to] = [away, turn(o.yaw + target), i]
    }
  })
  return best
}

// A window resized from the headset by a side or a corner (edge: { left, right, top, bottom } as 0 or 1) after the
// pointer moved { yaw, pitch } degrees, or to the size the PC gave it (given: { w, h }): its size in pixels and where
// its panel stands, the opposite side staying where it was and the text as large as it was (the pixels a degree holds
// are kept). widthAt: the metres one radian of span is wide at (main.js WIDTH_AT); the panel takes span * widthAt /
// dist degrees across. Above or below the eyes a degree of turn is less than a degree across.
export function resizeWindow({ w, h, span, yaw, pitch, dist }, edge, moved, widthAt = 1.5, given) {
  const perDegree = w / (span * widthAt / dist), across = Math.cos(pitch * DEG)
  const width = given?.w ?? Math.max(200, Math.round(w + (edge.right - edge.left) * moved.yaw * across * perDegree))
  const height = given?.h ?? Math.max(150, Math.round(h - (edge.bottom - edge.top) * moved.pitch * perDegree))
  return {
    w: width, h: height, span: span * width / w,
    yaw: yaw + (edge.right - edge.left) * (width - w) / perDegree / 2 / across,
    pitch: pitch - (edge.bottom - edge.top) * (height - h) / perDegree / 2,
  }
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

// A key of the phone's keyboard as it lies (KeyboardEvent.code) -> its Linux key code, for a window on the PC: keys,
// not letters, so the PC's own layout makes the letters. The first ones in the order of their codes, from 1.
export const KEYCODES = Object.fromEntries([
  ...('Escape Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal Backspace Tab KeyQ KeyW KeyE KeyR ' +
    'KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Enter ControlLeft KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL ' +
    'Semicolon Quote Backquote ShiftLeft Backslash KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash ShiftRight ' +
    'NumpadMultiply AltLeft Space CapsLock F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 NumLock ScrollLock Numpad7 Numpad8 Numpad9 ' +
    'NumpadSubtract Numpad4 Numpad5 Numpad6 NumpadAdd Numpad1 Numpad2 Numpad3 Numpad0 NumpadDecimal').split(' ').map((code, i) => [code, i + 1]),
  ['IntlBackslash', 86], ['F11', 87], ['F12', 88], ['NumpadEnter', 96], ['ControlRight', 97], ['NumpadDivide', 98],
  ['PrintScreen', 99], ['AltRight', 100], ['Home', 102], ['ArrowUp', 103], ['PageUp', 104], ['ArrowLeft', 105],
  ['ArrowRight', 106], ['End', 107], ['ArrowDown', 108], ['PageDown', 109], ['Insert', 110], ['Delete', 111],
  ['NumpadEqual', 117], ['Pause', 119], ['MetaLeft', 125], ['MetaRight', 126], ['ContextMenu', 127],
])
