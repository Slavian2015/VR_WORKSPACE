// Settings shared by the phone page and the PC control page: key -> [default, min, max, step, label]
export const LAYOUT_SPEC = {
  dist: [1.5, 0.5, 5, 0.1, 'Расстояние до мониторов, м'],
  bgYaw: [0, -180, 180, 5, 'Поворот фона, °'],
  camFov: [70, 40, 130, 1, 'Угол обзора камеры телефона, °'],
}
// One set per monitor, stored as "m0.yaw", "m1.span", ...
export const MONITOR_SPEC = {
  yaw: [0, -180, 180, 1, 'Вправо / влево, °'],
  pitch: [0, -60, 60, 1, 'Вверх / вниз, °'],
  span: [90, 30, 180, 1, 'Ширина, ° (на расстоянии 1,5 м)'],
  curve: [100, 0, 100, 5, 'Изгиб, % (0 — плоский)'],
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

// Server answer -> full settings: every key has a value, monitors included.
function complete(answer) {
  const all = { bg: 'bg/old_field.jpg', recenter: 0, autoBlack: true, camera: false, hideMonitors: false, virtualSize: answer.virtualSizes[0] }
  for (const [key, spec] of Object.entries({ ...LAYOUT_SPEC, ...LENS_SPEC })) all[key] = spec[0]
  answer.monitors.forEach(({ id }, i) => {
    for (const [key, spec] of Object.entries(MONITOR_SPEC)) all[`${id}.${key}`] = key === 'yaw' ? SLOT_YAW[i] : spec[0]
  })
  return { ...all, ...answer }
}

// Calls onChange with the full settings at start and every time anyone changes them, and onLost when the server
// has not answered for a second (onChange is called again when it is back).
// Reloads the page when the server reports other code than the page was loaded with.
export function watchParams(onChange, onLost) {
  let seen, build, failures = 0
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
    setTimeout(poll, 200)
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
