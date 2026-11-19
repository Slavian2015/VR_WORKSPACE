// Phone page: draws both eyes in one pass. Every screen pixel is turned into a view ray through the lens,
// so lens correction costs nothing and the desktop text is sampled only once (no blur from a second pass).
import * as THREE from 'three'
import { MONITOR_SPEC, placeIcon, setParams, watchParams } from './params.js'
import { deviceQuaternion, gazeInLayout, gazeOf, monitorFrame } from './orient.js'

const DEG = Math.PI / 180
// index.html?spectator on the PC: one flat picture of what the headset wearer looks at, to watch or to record.
// The same shader with lens separation and lens distortion set to zero is an ordinary camera. A number sets the
// width of the view in degrees: ?spectator=100.
const SPECTATOR = new URLSearchParams(location.search).has('spectator')
const SPECTATOR_FOV = (+new URLSearchParams(location.search).get('spectator') || 90) * DEG
const WIDTH_AT = 1.5 // metres: a monitor's width in degrees is what it takes up at this distance

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' })
document.body.append(renderer.domElement)
const fit = () => { renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight) }
addEventListener('resize', fit)
fit()

function hiddenVideo(props) {
  const video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true, ...props })
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0' // Safari stalls a video that is not in the page
  document.body.append(video)
  return video
}

// --- the picture: one full-screen shader, built for exactly as many monitors as the PC has, so the phone does no
// work for absent ones. When the set of monitors changes it is rebuilt in place: a page reload would lose the tap
// that unlocked the sensors and the sound.
const scene = new THREE.Scene(), camera = new THREE.Camera()
const menuCanvas = Object.assign(document.createElement('canvas'), { width: 1536, height: 864 }) // the list of applications, see below
const menuTexture = new THREE.CanvasTexture(menuCanvas)
menuTexture.generateMipmaps = false // it is large and drawn about 1:1
menuTexture.minFilter = THREE.LinearFilter
let screens = [], uniforms, monitorIds
function build(keys) { // keys: what each monitor shows. One that stays keeps its video and its connection: no blink
  const old = screens, count = keys.length
  scene.children[0]?.material.dispose()
  scene.clear()
  const background = uniforms?.uBg.value ?? null // stays as it is
  screens = keys.map(key => old.find(s => s.key === key) ?? (() => {
    const video = hiddenVideo()
    const texture = new THREE.VideoTexture(video)
    texture.generateMipmaps = true // a monitor is shown slightly smaller than 1:1, mipmaps stop the text from shimmering
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    return { key, video, texture }
  })())
  for (const { video, texture, stop } of old.filter(s => !screens.includes(s))) { stop?.(); texture.dispose(); video.remove() }
  uniforms = {
    uMonitor: { value: screens.map(s => s.texture) },
    uToMonitor: { value: screens.map(() => new THREE.Matrix3()) },
    uSize: { value: screens.map(() => new THREE.Vector4()) },
    uCrop: { value: screens.map(() => new THREE.Vector4(0, 0, 1, 1)) },
    uPopups: { value: Array.from({ length: count * 3 }, () => new THREE.Vector4()) },
    uPointer: { value: new THREE.Vector3(-1, 0, 0) }, uPointerPx: { value: new THREE.Vector2(1, 1) },
    uMenu: { value: menuTexture }, uMenuOn: { value: 0 }, uToMenu: { value: new THREE.Matrix3() }, uMenuGrid: { value: new THREE.Vector4(1, 1, 1, 0) },
    uMenuFold: { value: new THREE.Vector3(1, 1, 0) }, uMenuPointer: { value: new THREE.Vector3(0, 0, -1) }, uMenuOver: { value: new THREE.Vector2(-1, -1) },
    uMenuDrag: { value: new THREE.Vector4(-1, 0, 0, 0) },
    uBg: { value: background }, uToBg: { value: new THREE.Matrix3() },
    uCam: { value: null }, uCamTan: { value: new THREE.Vector2() }, uCamShift: { value: new THREE.Vector2() }, uCamBelow: { value: -2 },
    uSelect: { value: -1 }, uSelectColor: { value: new THREE.Vector3() }, uHud: { value: hudTexture }, uHudOn: { value: 0 },
    uRes: { value: new THREE.Vector2() }, uCenter: { value: new THREE.Vector2() },
    uPxPerMm: { value: 1 }, uIpd: { value: SPECTATOR ? 0 : 63 }, uLensDist: { value: 40 }, uK1: { value: 0 }, uK2: { value: 0 }, uChroma: { value: 0 }, uDist: { value: 1.5 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      ${count ? /* glsl: an array of size 0 does not compile */ `
      uniform sampler2D uMonitor[${count}];
      uniform mat3 uToMonitor[${count}];         // head space -> the monitor's own frame
      uniform vec4 uSize[${count}];              // angular width in rad (0: hidden), height / width, curve (0 flat .. 1 around the viewer), distance in m
      uniform vec4 uCrop[${count}];              // the part of the video that is the picture: corner and size, 0..1 (a single window sits in a corner of its video)
      uniform vec4 uPopups[${count * 3}];        // three for each: a single window's open menus where they reach out of it, as corners in its 0..1 (0: none)` : ''}
      uniform vec3 uPointer;                     // our pointer in a single window: the monitor it is on (-1: none) and its place there, 0..1
      uniform vec2 uPointerPx;                   // that window's size in its own pixels
      uniform sampler2D uMenu;                   // the list of applications: its cells, column after column, cut into bands
      uniform float uMenuOn;
      uniform mat3 uToMenu;                      // head space -> the frame the list hangs in: level, -Z at its middle
      uniform vec4 uMenuGrid;                    // columns; the angle that one column and one row take, rad; the height of its middle, rad
      uniform vec3 uMenuFold;                    // the sheet: columns in a band, bands; and the column (from the left) in the middle of the field
      uniform vec3 uMenuPointer;                 // our pointer there: a direction in head space
      uniform vec2 uMenuOver;                    // the cell lit under it: column and row (-1: none)
      uniform vec4 uMenuDrag;                    // the icon in hand: its cell (column -1: none), and the pointer's place in columns and rows
      uniform sampler2D uBg, uCam;
      uniform mat3 uToBg;                        // head space -> the panorama
      uniform vec2 uCamTan;                      // tangents of half the phone camera's view angles; 0: camera not shown
      uniform vec2 uCamShift;                    // where the camera looks relative to the eyes, as tangents
      uniform float uCamBelow;                   // the camera shows where the view's height (sine) is under this; 2: everywhere
      uniform float uSelect, uHudOn;             // arranging mode: the monitor to frame (-1: none), whether the note is shown
      uniform vec3 uSelectColor;
      uniform sampler2D uHud;
      uniform vec2 uRes, uCenter;                // px, mm
      uniform float uPxPerMm, uIpd, uLensDist, uK1, uK2;  // lengths in mm
      uniform float uChroma;                     // how much more the lens magnifies blue than green, and green than red
      uniform float uDist;                       // m: how far away the arranging note is drawn

      // View ray in head space through a point of the screen; q: its offset from the lens axis over the lens distance.
      vec3 ray(vec2 q) {
        float r2 = dot(q, q);
        return normalize(vec3(q * (1.0 + uK1 * r2 + uK2 * r2 * r2), -1.0)); // the lens magnifies more toward its edge
      }

      // A point of the list of applications, in columns from its left and rows from its top, on its sheet: the
      // columns are cut into bands laid one under another.
      vec4 menuSheet(vec2 c) {
        float band = floor(c.x / uMenuFold.x);
        return textureLod(uMenu, vec2(c.x / uMenuFold.x - band, 1.0 - (c.y + band * ${MENU.rows}.0) / (${MENU.rows}.0 * uMenuFold.y)), 0.0);
      }

      vec3 background(vec3 dir) {
        vec3 sky = uToBg * dir;
        vec3 color = texture(uBg, vec2(atan(sky.x, -sky.z) / 6.2831853 + 0.5, asin(clamp(sky.y, -1.0, 1.0)) / 3.1415927 + 0.5)).rgb;
        if (uCamTan.x > 0.0) { // the phone camera: its picture is fixed to the head, like a window held before the eyes
          vec2 c = (dir.xy / -dir.z - uCamShift) / uCamTan;
          vec3 seen = texture(uCam, c * 0.5 + 0.5).rgb;
          float inFrame = step(max(abs(c.x), abs(c.y)), 1.0);
          if (uCamBelow > 1.5) return seen * inFrame; // pass-through: the camera everywhere, black where it does not see
          // Otherwise only low down, to find the keyboard and the hands by lowering the head; a soft edge 5 degrees wide.
          color = mix(color, seen, inFrame * smoothstep(uCamBelow + 0.04, uCamBelow - 0.04, sky.y));
        }
        return color;
      }

      void main() {
        vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uPxPerMm - uCenter; // mm from the point between the lenses
        float side = p.x < 0.0 ? -1.0 : 1.0;                           // left half of the phone is the left eye
        vec2 fromAxis = p - vec2(side * 0.5 * uIpd, 0.0);              // mm from the lens axis
        vec3 dir = ray(fromAxis / uLensDist);                          // view ray and eye position, in head space
        vec3 eye = vec3(side * 0.0005 * uIpd, 0.0, 0.0);               // m

        // The lens spreads colours: the blue picture comes out larger than the red one, more so toward the edge.
        // So red is drawn as if its pixel were a little nearer to the lens axis and blue a little farther.
        vec3 color = background(dir);
        if (uChroma != 0.0) {
          color.r = background(ray(fromAxis * (1.0 - uChroma) / uLensDist)).r;
          color.b = background(ray(fromAxis * (1.0 + uChroma) / uLensDist)).b;
        }
        ${screens.map((_, i) => /* glsl: sampler arrays accept only constant indexes, so the loop is unrolled here */ `{
          // A monitor faces -Z of its own frame, its centre away metres off (uSize.w). Its width in metres is fixed: an arc of
          // uSize.x radians at ${WIDTH_AT} m. So, like a real one, it looks bigger when it is brought closer.
          // It is bent into a cylinder that touches that centre: of that radius at full curve
          // (every point equally far from the eyes), of a larger radius for less curve, a plane for none.
          vec3 d = uToMonitor[${i}] * dir, o = uToMonitor[${i}] * eye, hit;
          float width = ${WIDTH_AT.toFixed(1)} * uSize[${i}].x, curve = uSize[${i}].z, away = uSize[${i}].w, along; // along: metres from the centre line, on the surface
          if (curve < 0.01) {
            hit = o + d * ((-away - o.z) / min(d.z, -1e-6));
            along = hit.x;
          } else {
            float r = away / curve;
            vec2 axis = vec2(0.0, r - away), oa = o.xz - axis;
            float a = max(dot(d.xz, d.xz), 1e-6), b = dot(oa, d.xz), c = dot(oa, oa) - r * r;
            hit = o + d * ((-b + sqrt(b * b - a * c)) / a);
            along = r * atan(hit.x, axis.y - hit.z);
          }
          vec2 uv = vec2(along / width, hit.y / (width * uSize[${i}].y)) + 0.5;
          vec2 edge = min(uv, 1.0 - uv) / fwidth(uv);
          float inside = clamp(min(edge.x, edge.y), 0.0, 1.0); // 1 px soft edge
          for (int j = ${i * 3}; j < ${i * 3 + 3}; j++) { // and the window's menus: the video has them also where they reach out of it
            vec2 e = min(uv - uPopups[j].xy, uPopups[j].zw - uv) / fwidth(uv);
            inside = max(inside, clamp(min(e.x, e.y), 0.0, 1.0));
          }
          vec2 at = uCrop[${i}].xy + uv * uCrop[${i}].zw;      // where that is in the video
          vec2 dx = dFdx(at), dy = dFdy(at);                   // taken outside the branch, where they are defined
          if (uSize[${i}].x > 0.0 && inside > 0.0) {
            vec3 picture = textureGrad(uMonitor[${i}], at, dx, dy).rgb;
            // Out of the window the video is black where a menu's box has nothing (beside its arrow): not shown.
            if (min(edge.x, edge.y) < 0.0 && max(picture.r, max(picture.g, picture.b)) < 0.04) inside = 0.0;
            if (uChroma != 0.0) { // the same shift of red and blue, as a step along how the place changes across the screen
              vec2 shift = uChroma * uPxPerMm * (dx * fromAxis.x + dy * fromAxis.y);
              picture.r = textureGrad(uMonitor[${i}], at - shift, dx, dy).r;
              picture.b = textureGrad(uMonitor[${i}], at + shift, dx, dy).b;
            }
            if (uPointer.x == ${i}.0) { // our pointer: a white dot with a dark rim, sized in the window's pixels
              float off = length((uv - uPointer.yz) * uPointerPx);
              if (off < 9.0) picture = off < 6.5 ? vec3(1.0) : vec3(0.0);
            }
            if (uSelect == ${i}.0 && min(edge.x, edge.y) < 9.0) picture = uSelectColor; // a frame 9 px thick
            color = mix(color, picture, inside);
          }
        }`).join('')}
        if (uHudOn > 0.0) { // a note under the centre of the view, fixed to the head and as far away as the monitors
          vec2 t = dir.xy / -dir.z + vec2(side * 0.0005 * uIpd / uDist, 0.0);
          vec2 h = (t - vec2(0.0, -0.3)) / vec2(0.44, 0.08) * 0.5 + 0.5;
          vec4 note = textureLod(uHud, h, 0.0);
          color = mix(color, note.rgb, note.a * step(max(abs(h.x - 0.5), abs(h.y - 0.5)), 0.5));
        }
        if (uMenuOn > 0.0) { // the list of applications: a ribbon of icons around the viewer, fixed in the room, over everything
          color *= 0.2; // the whole view goes dark behind it
          vec3 toward = normalize(eye + 1.5 * dir); // from between the eyes to where this ray is 1.5 m away: the ribbon's distance, for both eyes
          vec3 d = uToMenu * toward;
          vec2 cell = vec2(atan(d.x, -d.z) / uMenuGrid.y + uMenuFold.z, // the column from the left and the row from the top
            ${(MENU.rows / 2).toFixed(1)} - (asin(clamp(d.y, -1.0, 1.0)) - uMenuGrid.w) / uMenuGrid.z);
          if (cell.x > 0.0 && cell.x < uMenuGrid.x && cell.y > 0.0 && cell.y < ${MENU.rows}.0) {
            vec2 mid = abs(fract(cell) - 0.5);
            if (floor(cell) == uMenuOver && max(mid.x, mid.y) < 0.46) color = mix(color, vec3(1.0), 0.18); // under the pointer
            vec4 sheet = menuSheet(cell);
            color = mix(color, sheet.rgb, sheet.a);
          }
          vec2 carried = cell - uMenuDrag.zw + 0.5; // the icon in hand: its cell, centred on the pointer
          if (uMenuDrag.x >= 0.0 && carried == clamp(carried, 0.0, 1.0)) {
            vec4 icon = menuSheet(uMenuDrag.xy + carried);
            color = mix(color, icon.rgb, icon.a);
          }
          float off = degrees(acos(clamp(dot(toward, uMenuPointer), -1.0, 1.0)));
          if (off < 0.5) color = off < 0.36 ? vec3(1.0) : vec3(0.0); // the pointer
        }
        gl_FragColor = vec4(color, 1.0);
      }`,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  scene.add(quad)
}

// --- 360 background: a photo, a video when the file is one, or plain 'black'
let bgSrc, bgVideo
function setBackground(src) {
  if (src === bgSrc) return
  bgSrc = src
  uniforms.uBg.value?.dispose()
  bgVideo?.remove()
  bgVideo = /\.(mp4|webm|mov)$/i.test(src) ? hiddenVideo({ src, loop: true }) : null
  const tex = bgVideo ? new THREE.VideoTexture(bgVideo)
    : src === 'black' ? new THREE.DataTexture(new Uint8Array(4), 1, 1)
    : new THREE.TextureLoader().load(src)
  if (src === 'black') tex.needsUpdate = true // a data texture is uploaded only when asked
  tex.wrapS = THREE.RepeatWrapping // the panorama joins itself behind the viewer
  tex.generateMipmaps = false      // mipmaps would draw a seam along that join
  tex.minFilter = THREE.LinearFilter
  uniforms.uBg.value = tex
}

// --- the phone's own camera, for pass-through and for the window on the keyboard. It is open only while its picture
// can be seen, and closed completely otherwise (the drawing loop decides): the user wants the camera sign of the
// phone to be off the rest of the time, and pausing the camera does not put it out in Safari.
// Reopening asks for permission again unless Safari is set to always allow the camera for this site, and a page
// started from the iPhone home screen does not keep that permission at all: for that case `camKeep` leaves the
// camera open once it was opened.
let phoneCam   // { video, texture, track } while open, { opening } meanwhile, { failed: time } after a refusal
let unseenSince // when the camera picture was last needed, to close it a little later and not at every nod
async function openCamera() {
  if (phoneCam && !(Date.now() - phoneCam.failed > 30000)) return // open, opening, or refused less than 30 s ago
  phoneCam = { opening: true }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
    const video = hiddenVideo({ srcObject: stream })
    phoneCam = { video, texture: new THREE.VideoTexture(video), track: stream.getVideoTracks()[0] }
    // Which camera the browser gave us, and which ones it has, for the control page: the page only asks for "the
    // back camera", the choice is the browser's.
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput').map(d => d.label)
    if (phoneCam.track.label !== settings.camLabel || cameras.join() !== settings.cameras?.join()) setParams({ camLabel: phoneCam.track.label, cameras })
  } catch (e) {
    console.warn('camera:', e.message)
    phoneCam = { failed: Date.now() }
  }
}
function closeCamera() {
  phoneCam.track.stop()
  phoneCam.video.remove()
  phoneCam.texture.dispose()
  phoneCam = null
}

// --- head tracking
const head = new THREE.Quaternion()
let sensorSeen = false
addEventListener('deviceorientation', e => {
  if (e.alpha == null || SPECTATOR) return
  deviceQuaternion(e.alpha, e.beta, e.gamma, screen.orientation?.angle ?? window.orientation ?? 0, head)
  if (!sensorSeen) centring = 'heading'
  sensorSeen = true
})
// Preview on a PC without sensors: drag to look around.
let dragYaw = 0, dragPitch = 0
addEventListener('pointermove', e => {
  if (!e.buttons || sensorSeen || SPECTATOR || settings?.monitors[looked]?.window) return // over a single window the mouse works in it
  dragYaw += e.movementX * 0.003
  dragPitch = THREE.MathUtils.clamp(dragPitch + e.movementY * 0.003, -1.5, 1.5)
  head.setFromEuler(new THREE.Euler(dragPitch, dragYaw, 0, 'YXZ'))
})

// --- arranging the monitors from inside the sphere. The control page takes the PC mouse and reports its left button
// and wheel in the settings answer (edit, grab, wheelSize, wheelCurve, wheelDist); everything else happens here, so a
// held monitor follows the head without any network delay. The spectator page only watches.
const clamp = (value, [, min, max]) => Math.min(max, Math.max(min, value))
let looked = -1 // the monitor under the centre of the view, found in the drawing loop
let held        // { i, dYaw, dPitch, yaw, pitch }: the monitor being carried and its offset from the gaze
let wheelSeen   // the wheel counters of the previous answer
const pending = {} // key -> [value, when]: changed here, not yet echoed by the server; wins over its older answers

function change(p, values) {
  for (const [key, value] of Object.entries(values)) pending[key] = [p[key] = value, Date.now()]
  setParams(values)
}

function arrange(p) {
  for (const [key, [value, when]] of Object.entries(pending)) {
    if (p[key] === value || Date.now() - when > 1000) delete pending[key]
    else p[key] = value
  }
  if (!p.edit || SPECTATOR) { // not arranging from the PC: only a window carried with the phone's mouse stays in hand
    if (!held?.mouse) held = undefined
    return void (wheelSeen = undefined)
  }
  const id = p.monitors[held ? held.i : looked]?.id
  const wheel = [p.wheelSize, p.wheelCurve, p.wheelDist], was = wheelSeen ?? wheel
  wheelSeen = wheel
  if (id && wheel[0] !== was[0]) change(p, { [`${id}.span`]: clamp(p[`${id}.span`] + 2 * (wheel[0] - was[0]), MONITOR_SPEC.span) })
  if (id && wheel[1] !== was[1]) change(p, { [`${id}.curve`]: clamp(p[`${id}.curve`] + 5 * (wheel[1] - was[1]), MONITOR_SPEC.curve) })
  if (id && wheel[2] !== was[2]) change(p, { [`${id}.dist`]: clamp(Math.round((p[`${id}.dist`] + 0.1 * (wheel[2] - was[2])) * 10) / 10, MONITOR_SPEC.dist) })
  if (p.grab && !held && id) {
    const gaze = gazeInLayout(anchor, head)
    held = { i: looked, dYaw: p[`${id}.yaw`] - gaze.yaw, dPitch: p[`${id}.pitch`] - gaze.pitch, yaw: p[`${id}.yaw`], pitch: p[`${id}.pitch`] }
  } else if (!p.grab && held) {
    change(p, { [`${id}.yaw`]: Math.round(held.yaw), [`${id}.pitch`]: Math.round(held.pitch) })
    held = undefined
  }
}

// The note with the numbers of the monitor in hand, drawn as text and shown by the shader.
const hud = Object.assign(document.createElement('canvas'), { width: 1408, height: 256 })
const hudTexture = new THREE.CanvasTexture(hud)
let hudShown
function showArranging() {
  const i = held ? held.i : looked, id = settings.monitors[i]?.id
  uniforms.uHudOn.value = settings.edit ? 1 : 0
  uniforms.uSelect.value = settings.edit ? i : -1
  uniforms.uDist.value = id ? settings[`${id}.dist`] : 1.5
  uniforms.uSelectColor.value.set(...(held ? [0.25, 1, 0.45] : [1, 0.82, 0.12])) // green in hand, yellow under the gaze
  if (!settings.edit) return
  const lines = [
    id ? `Монитор ${i + 1} (${settings.monitors[i].name})${held ? ': в руке' : ''}` : 'Посмотрите на монитор',
    (id ? `вправо ${Math.round(held ? held.yaw : settings[`${id}.yaw`])}°   вверх ${Math.round(held ? held.pitch : settings[`${id}.pitch`])}°   ` +
      `ширина ${settings[`${id}.span`]}°   изгиб ${settings[`${id}.curve`]}%   расстояние ${settings[`${id}.dist`]} м` : 'мышь в сфере'),
    'левая кнопка: взять и нести взглядом  ·  колесо: размер  ·  Shift+колесо: изгиб  ·  Ctrl+колесо: расстояние этого монитора',
    'цифры: ' + settings.monitors.map(({ id }, n) => `${n + 1} ${settings[`${id}.hidden`] ? 'показать' : 'скрыть'} монитор ${n + 1}`).join(',  ') + '  ·  5: центрировать  ·  Esc: выход',
  ]
  if (lines.join() === hudShown) return
  hudShown = lines.join()
  const c = hud.getContext('2d')
  c.clearRect(0, 0, hud.width, hud.height)
  c.fillStyle = 'rgba(8, 12, 18, 0.85)'
  c.beginPath()
  c.roundRect(0, 0, hud.width, hud.height, 28)
  c.fill()
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  lines.forEach((line, n) => {
    let size = [50, 42, 27, 27][n]
    do c.font = `${n > 1 ? 500 : 700} ${size}px system-ui, sans-serif`
    while (c.measureText(line).width > hud.width - 56 && (size -= 2) > 14) // shrink a line that does not fit
    c.fillStyle = n > 1 ? '#9fb0c2' : '#fff'
    c.fillText(line, hud.width / 2, [44, 108, 170, 216][n])
  })
  hudTexture.needsUpdate = true
}

// --- settings and layout
// The layout hangs on `anchor`, the gaze it was last centred on. On the first sensor reading only the heading is
// taken (the phone is still in the hand then); the "centre" button takes the tilt too.
let settings, centring, recenterSeen
const anchor = { yaw: 0, pitch: 0 }
watchParams(p => {
  const key = m => `${m.id}:${m.source ?? ''}` // another window in the same place of the list is another stream
  const ids = p.monitors.map(key).join()
  if (ids !== monitorIds) build(p.monitors.map(key))
  // Where a single window that has just come into the sphere stands. A dialog (`over`: the panel of its window) lies
  // on its window as on the PC, at its distance and with its text as large as the window's. The first window after
  // a start from the list of applications opens where the user looked before calling the list. Any other window
  // opens where the user is looking. (Windows that were there when the page started keep their places.)
  for (const m of p.monitors) {
    const { id, window, over, crop } = m
    if (!window || monitorIds === undefined || monitorIds.split(',').includes(key(m)) || !tapped || SPECTATOR) continue
    const parent = p.monitors.find(o => o.id === over), started = Date.now() - (launchSpot?.at ?? 0) < 20000
    const gaze = parent ? { yaw: p[`${over}.yaw`], pitch: p[`${over}.pitch`] } : started ? launchSpot : gazeInLayout(anchor, head)
    if (!parent && started) launchSpot = undefined
    change(p, {
      [`${id}.yaw`]: Math.round(gaze.yaw), [`${id}.pitch`]: Math.round(clamp(gaze.pitch, MONITOR_SPEC.pitch)),
      // (at most 120 degrees wide: a file chooser as large as the screen, over a small window, would go round the viewer)
      ...parent && { [`${id}.dist`]: p[`${over}.dist`], [`${id}.curve`]: p[`${over}.curve`], [`${id}.span`]: Math.round(Math.min(120, clamp(p[`${over}.span`] * crop[2] / parent.crop[2], MONITOR_SPEC.span))) },
    })
  }
  monitorIds = ids
  if (recenterSeen !== undefined && p.recenter !== recenterSeen) centring = 'gaze'
  recenterSeen = p.recenter
  arrange(p)
  settings = p
  if (SPECTATOR) { // a plain camera: the screen is as wide as the wanted view at this distance; the rest stays zero
    uniforms.uLensDist.value = p.screenW / 2 / Math.tan(SPECTATOR_FOV / 2)
  } else {
    uniforms.uIpd.value = p.ipd
    uniforms.uLensDist.value = p.lensDist
    uniforms.uK1.value = p.k1
    uniforms.uK2.value = p.k2
    uniforms.uChroma.value = p.chroma / 100
    uniforms.uCenter.value.set(p.cx, p.cy)
  }
  setBackground(p.fullscreen && p.autoBlack ? 'black' : p.bg) // dark around a film that fills a monitor
  startStreams()
})

const Y = new THREE.Vector3(0, 1, 0), forward = new THREE.Vector3(), rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4()
const toMatrix3 = (target, q) => target.setFromMatrix4(matrix.makeRotationFromQuaternion(q))
renderer.setAnimationLoop(() => {
  if (!settings) return
  if (SPECTATOR) head.slerp(poseTarget, 0.35) // glide between the 30 readings a second
  else if (centring) Object.assign(anchor, gazeOf(head))
  if (centring === 'heading') anchor.pitch = 0
  centring = null
  // The panorama keeps its horizon; it turns with the heading of the anchor and with the user's own offset.
  toMatrix3(uniforms.uToBg.value, rotation.setFromAxisAngle(Y, settings.bgYaw * DEG - anchor.yaw).multiply(head))
  if (held) { // the held monitor goes where the head looks (taken with the phone's mouse: where its pointer is), keeping the offset it was taken with
    const gaze = held.mouse ? pointerInLayout() : gazeInLayout(anchor, head)
    held.yaw = ((gaze.yaw + held.dYaw + 540) % 360) - 180
    held.pitch = clamp(gaze.pitch + held.dPitch, MONITOR_SPEC.pitch)
  }
  looked = -1
  settings.monitors.forEach((m, i) => {
    const { id, crop } = m
    const mine = held?.i === i
    monitorFrame(anchor, mine ? held.yaw : settings[`${id}.yaw`], mine ? held.pitch : settings[`${id}.pitch`], rotation).invert().multiply(head)
    toMatrix3(uniforms.uToMonitor.value[i], rotation)
    const { videoWidth, videoHeight } = screens[i].video
    // "Hide all monitors" leaves single windows (crop) in place: that is how to work with windows alone.
    const span = (settings.hideMonitors && !crop) || settings[`${id}.hidden`] ? 0 : settings[`${id}.span`] * DEG
    const aspect = crop ? crop[3] / crop[2] : videoWidth ? videoHeight / videoWidth : 9 / 16
    // A single window is cut out of its video: [left, top, width, height] in pixels, top down; the video's v runs up.
    if (crop && videoWidth) uniforms.uCrop.value[i].set(crop[0] / videoWidth, 1 - (crop[1] + crop[3]) / videoHeight, crop[2] / videoWidth, crop[3] / videoHeight)
    else uniforms.uCrop.value[i].set(0, 0, 1, 1)
    uniforms.uSize.value[i].set(span, aspect, settings[`${id}.curve`] / 100, settings[`${id}.dist`])
    // A window's menus, where the video has them: it starts at the window's shadow and is as large as a monitor.
    menus[id] = (crop && videoWidth ? m.popups ?? [] : []).map(([x, y, w, h]) => [Math.max(x, -crop[0]), Math.max(y, -crop[1]), Math.min(x + w, videoWidth - crop[0]), Math.min(y + h, videoHeight - crop[1])])
      .filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0)
    for (let j = 0; j < 3; j++) {
      const r = menus[id][j]
      uniforms.uPopups.value[i * 3 + j].set(...(r ? [r[0] / crop[2], 1 - r[3] / crop[3], r[2] / crop[2], 1 - r[1] / crop[3]] : [0, 0, 0, 0]))
    }
    // Where the centre of the view is on this panel, 0..1 from its top left; its half-size as seen from here, in radians.
    const ahead = forward.set(0, 0, -1).applyQuaternion(rotation), halfWidth = WIDTH_AT * span / settings[`${id}.dist`] / 2
    const u = 0.5 + Math.atan2(ahead.x, -ahead.z) / (2 * halfWidth), v = 0.5 - Math.asin(ahead.y) / (2 * halfWidth * aspect)
    const [x0, y0, x1, y1] = crop ? reach(m).map((d, k) => d / crop[2 + k % 2]) : [0, 0, 1, 1] // a window with its open menus
    // The panels come in the order they are drawn: of those under the centre of the view, the last is on top.
    if (span && u >= x0 && u <= x1 && v >= y0 && v <= y1) looked = i
  })
  showArranging()
  point()
  if (!SPECTATOR) { // the spectator must not open the PC's own webcam
    // `lowest` is how low the camera picture would reach at this tilt of the head. The camera is opened 5 degrees
    // before that reaches the look-down window, to be ready in time, and closed 2 s after it is 8 degrees clear.
    const aspect = phoneCam?.video?.videoWidth ? phoneCam.video.videoHeight / phoneCam.video.videoWidth : 0.5625
    const lowest = (gazeOf(head).pitch - Math.atan(Math.tan(settings.camFov * DEG / 2) * aspect)) / DEG
    const wanted = settings.passthrough || (settings.camBelow > 0 && lowest < -settings.camBelow + (phoneCam?.track ? 8 : 5))
    if (wanted) {
      unseenSince = undefined
      openCamera()
    } else if (phoneCam?.track && !settings.camKeep && Date.now() - (unseenSince ??= Date.now()) > 2000) closeCamera() // camKeep: no closing, so no new permission question
  }
  const shown = (settings.passthrough || settings.camBelow > 0) && phoneCam?.video?.videoWidth ? phoneCam : null
  const tan = shown ? Math.tan(settings.camFov * DEG / 2) : 0
  uniforms.uCamBelow.value = settings.passthrough ? 2 : Math.sin(-settings.camBelow * DEG)
  uniforms.uCamShift.value.set(Math.tan(settings.camShiftX * DEG), Math.tan(settings.camShiftY * DEG))
  uniforms.uCam.value = shown?.texture ?? null
  uniforms.uCamTan.value.set(tan, shown ? tan * shown.video.videoHeight / shown.video.videoWidth : 0)
  const canvas = renderer.domElement
  uniforms.uRes.value.set(canvas.width, canvas.height)
  uniforms.uPxPerMm.value = canvas.width / settings.screenW
  renderer.render(scene, camera)
})

// --- working a single window from the headset with a mouse connected to the phone. The page cannot hold that mouse
// (Safari has no pointer lock): the system's own pointer keeps moving over the phone screen and stops at its edges.
// So the place of that pointer on the screen stands for the place in the window the user is looking at, edge to
// edge. It is sent to the PC, which puts the real pointer there; the pointer seen in the sphere is drawn here, at
// once. Movements are sent no faster than they are answered, the newest place replacing one that still waits.
// The whole screen stands for the window, not each eye's half: with halves, the pointer crossing the middle of the
// phone jumped from one edge of the window to the other (and a window being carried flew off). So where the phone's
// pointer stops at the edge of its screen, ours stays at the edge of the window.
// The window does not fill the screen to its edges: the rim around it is the window's frame. With the pointer there
// the frame is drawn, the left button takes the window and it goes with the pointer (so with the mouse, and with the
// head) until the button is let go; the wheel there changes its size. All around: when the frame was only a strip
// at the top of the screen, neither a press nor the wheel did anything there on the iPhone. The likely cause, not
// confirmed: the phone keeps what starts at the top and bottom edges of its screen for its own gestures.
const FRAME = [0.04, 0.08] // across, down: as wide as it was on each half
const mouse = { x: 0.5, y: 0.5 } // where the system's pointer is on the phone screen, 0..1 from the top left
let orders = [], sendingOrders = false, pointedAt, pressedIn, wheelRest = 0, clickedAt = 0
const working = () => tapped && !SPECTATOR && !settings.edit
const windowLooked = () => working() && settings.monitors[looked]?.window ? settings.monitors[looked] : undefined
const only = (what, ...keys) => Object.keys(what).every(key => keys.includes(key))
function order(what) { // a movement replaces a movement that still waits; presses and the wheel are never dropped
  const last = orders.at(-1)
  if (last && last.to === what.to && only(what, 'to', 'x', 'y') && only(last, 'to', 'x', 'y')) orders[orders.length - 1] = what
  else orders.push(what)
}
const onFrame = () => Math.min(mouse.x, 1 - mouse.x) < FRAME[0] || Math.min(mouse.y, 1 - mouse.y) < FRAME[1]
const within = (at, frame) => Math.min(1, Math.max(0, (at - frame) / (1 - 2 * frame))) // the pointer's place in the window, 0..1 from its left or top
// What the pointer covers in a window: the window, and while menus are open, all they reach (it only grows until they
// are all closed, so that the pointer does not jump as a submenu opens). [left, top, right, bottom] in its pixels.
// Only menus opened by a click count: a tooltip comes from mere pointing, and the pointer must not move under a
// still mouse (the next click would land beside the button aimed at).
const menus = {}, reached = {} // menus: by panel, as the drawing loop has them; reached: by window, what the pointer covers
function reach(target) {
  const [, , w, h] = target.crop, open = menus[target.id] ?? []
  if (!open.length || (!reached[target.source] && performance.now() - clickedAt > 1500)) return (delete reached[target.source], [0, 0, w, h])
  const box = reached[target.source] ??= [0, 0, w, h]
  for (const [x0, y0, x1, y1] of open) box.splice(0, 4, Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1))
  return box
}
const place = target => {
  const [x0, y0, x1, y1] = reach(target)
  return { to: target.id, x: x0 + within(mouse.x, FRAME[0]) * (x1 - x0), y: y0 + within(mouse.y, FRAME[1]) * (y1 - y0) }
}
// The view ray through the phone's pointer, in head space: the shader's ray() for a place of one eye's picture,
// the whole width of the phone standing for the width of that picture. So it sweeps the view once, smoothly, as the
// pointer crosses the phone (the phone's own round pointer, seen by one eye at a time, is no longer where ours is).
const aimed = new THREE.Vector3(), aimTurn = new THREE.Quaternion(), FORWARD = new THREE.Vector3(0, 0, -1)
function aim() {
  const mm = settings.screenW / innerWidth
  const x = (mouse.x - 0.5) * innerWidth / 2 * mm / settings.lensDist, y = ((0.5 - mouse.y) * innerHeight * mm - settings.cy) / settings.lensDist
  const r2 = x * x + y * y, more = 1 + settings.k1 * r2 + settings.k2 * r2 * r2
  return aimed.set(x * more, y * more, -1).normalize()
}
const pointerInLayout = () => gazeInLayout(anchor, aimTurn.setFromUnitVectors(FORWARD, aim()).premultiply(head)) // as the gaze, for the pointer
function point() { // every frame: the list of applications, or our pointer on the window looked at; and what is owed to the PC
  uniforms.uMenuOn.value = menu.open ? 1 : 0
  const target = menu.open ? undefined : windowLooked(), grip = target && onFrame()
  if (menu.open) showMenu()
  const at = target && place(target)
  uniforms.uPointer.value.set(target && !grip && !held ? looked : -1, at ? at.x / target.crop[2] : 0, at ? 1 - at.y / target.crop[3] : 0)
  if (grip || held?.mouse) { // the frame: yellow under the pointer, green in hand
    uniforms.uSelect.value = held?.mouse ? held.i : looked
    uniforms.uSelectColor.value.set(...(held?.mouse ? [0.25, 1, 0.45] : [1, 0.82, 0.12]))
  }
  if (target && !grip && !held) {
    uniforms.uPointerPx.value.set(target.crop[2], target.crop[3])
    if (mouse.moved || pointedAt !== target.id) order(place(target))
    mouse.moved = false
  }
  pointedAt = target?.id
  if (sendingOrders || !orders.length) return
  sendingOrders = true
  fetch('/input', { method: 'POST', body: JSON.stringify(orders.splice(0)) }).catch(() => {}).finally(() => sendingOrders = false)
}
addEventListener('pointermove', e => Object.assign(mouse, { x: e.clientX / innerWidth, y: e.clientY / innerHeight, moved: true }))
// A press and the wheel carry the place they are meant for: the PC has one pointer, and it may have been moved by
// the PC's own mouse since our last movement.
function press(e, down) {
  if (!tapped || !settings || SPECTATOR) return
  clickedAt = performance.now()
  const left = e.pointerType !== 'mouse' || e.button === 0 // a drag with the button held reaches the page as a finger: the left button
  if (held?.mouse) { // the carried window is put down where it is
    // Not when the press is cancelled: the iPhone then goes on with the same drag as a finger. The end of that, or
    // the next click, puts the window down.
    if (down || e.type === 'pointercancel') return
    const id = settings.monitors[held.i].id
    change(settings, { [`${id}.yaw`]: Math.round(held.yaw), [`${id}.pitch`]: Math.round(held.pitch) })
    return void (held = undefined)
  }
  if (menu.open) return menuPress(e, down, left)
  const target = down ? windowLooked() : pressedIn // a button is let go in the window it was pressed in, also when the gaze has left it
  if (down && !target) return void (!left && working() && openMenu()) // the right button on no window: the list of applications
  if (down && left && onFrame()) { // the frame: take the window, it goes with the pointer
    const gaze = pointerInLayout(), yaw = settings[`${target.id}.yaw`], pitch = settings[`${target.id}.pitch`]
    return void (held = { i: looked, mouse: true, dYaw: yaw - gaze.yaw, dPitch: pitch - gaze.pitch, yaw, pitch })
  }
  pressedIn = down ? target : undefined
  if (target) order({ ...place(target), button: e.pointerType === 'mouse' ? [272, 274, 273][e.button] ?? 272 : 272, down })
}
for (const type of ['pointerdown', 'pointerup', 'pointercancel']) addEventListener(type, e => press(e, type === 'pointerdown'))
addEventListener('contextmenu', e => tapped && e.preventDefault()) // the right button belongs to the window, or opens our list
addEventListener('wheel', e => {
  if (!tapped || !settings || SPECTATOR || menu.open) return // the list of applications is looked through by turning the head
  const target = windowLooked(), size = target && onFrame()
  // The phone gives the wheel in pixels, 29 to a click on the iPhone, late and in bursts. For the window: clicks of
  // 25 px. On the frame: a degree of size for every 10 px, so that a burst is a glide and not a jump.
  wheelRest += e.deltaY
  const clicks = Math.trunc(wheelRest / (size ? 10 : 25))
  if (!clicks) return
  wheelRest -= clicks * (size ? 10 : 25)
  // Signs: the iPhone reports the wheel as a finger pushing the page ("natural scrolling"), the other way than a PC.
  if (size) change(settings, { [`${target.id}.span`]: clamp(settings[`${target.id}.span`] + clicks, MONITOR_SPEC.span) })
  else if (target) order({ ...place(target), wheel: Math.max(-10, Math.min(10, -clicks)) })
}, { passive: true })

// --- the list of the PC's applications, called up in the sphere with the right button while no window is looked at:
// a ribbon of icons, four in a column, hung in the room around the place the user was looking at, with everything
// else darkened. In its middle is the user's own field of 4 x 4 places; the other applications are to its left and
// right in name order. Turning the head shows the rest; nothing scrolls (the iPhone gives the wheel late and in
// bursts). A click starts an application, and its window opens where the user looked before calling the list. An
// icon held with the left button and moved is carried: let go on a place of the field, it stays there; let go
// beside the field, it leaves it. Any other click closes the list.
// cell: a cell of the sheet in px; column: the degrees its width takes in the view; fold: the columns in one band of
// the sheet, which is the ribbon cut into bands laid one under another (a texture 4096 px wide is safe everywhere).
const MENU = { rows: 4, field: 4, cell: [180, 200], column: 9, fold: 22 }
const FIELD = MENU.field * MENU.rows // its places, numbered by rows: 0 1 2 3 / 4 5 6 7 / ...
const menu = { open: false, names: [], ids: [], icons: new Map(), drawn: '', at: 0, yaw: 0, pitch: 0, spot: null, press: null, drag: -1, layout: null }
let launchSpot // { yaw, pitch, at }: where the user looked before calling the list, for the window of what was started from it
const menuTurn = new THREE.Quaternion() // head space -> the frame the ribbon hangs in: level, -Z at the middle of the field
const menuAngle = columns => Math.min(MENU.column, 300 / columns) * DEG // of one column: a very long list is drawn smaller, it must not close into a ring
function openMenu() {
  const gaze = gazeOf(head)
  Object.assign(menu, { open: true, yaw: gaze.yaw, pitch: Math.max(-0.7, Math.min(0.7, gaze.pitch)), spot: gazeInLayout(anchor, head), press: null, drag: -1 })
  fetch('/apps').then(answer => answer.json()).then(list => { // every time: applications get installed
    const names = list.map(app => app.name)
    if (names.join() !== menu.names.join()) Object.assign(menu, { names, ids: list.map(app => app.id), icons: new Map(), drawn: '' })
  }).catch(() => {})
}
// cells: the application in each place of the ribbon, column after column (-1: none); left: the columns before the
// field; pins: GNOME's id of the application in each place of the field (the setting "menuPins", kept on the PC).
function menuLayout() {
  const pins = Array.from({ length: FIELD }, (_, k) => settings.menuPins?.[k] ?? null)
  const field = pins.map(id => menu.ids.indexOf(id)) // -1: a free place, or an application that is no longer installed
  const rest = menu.names.map((_, n) => n).filter(n => !field.includes(n))
  const left = Math.ceil(Math.ceil(rest.length / MENU.rows) / 2), cells = []
  rest.slice(0, left * MENU.rows).forEach((n, i) => { cells[i] = n })
  field.forEach((n, k) => { cells[(left + k % MENU.field) * MENU.rows + Math.floor(k / MENU.field)] = n })
  rest.slice(left * MENU.rows).forEach((n, i) => { cells[(left + MENU.field) * MENU.rows + i] = n })
  return { pins, left, cells: Array.from(cells, n => n ?? -1), columns: Math.ceil(cells.length / MENU.rows) }
}
// Where the pointer is on the ribbon: x, y in columns and rows from its top left, the application there (n, -1:
// none) and the place of the field there (k, -1: beside the field).
function menuSpot() {
  const { cells, left, columns } = menu.layout, d = aim().applyQuaternion(menuTurn), angle = menuAngle(columns)
  const x = Math.atan2(d.x, -d.z) / angle + left + MENU.field / 2
  const y = MENU.rows / 2 - (Math.asin(Math.max(-1, Math.min(1, d.y))) - menu.pitch) / (angle * MENU.cell[1] / MENU.cell[0])
  const column = Math.floor(x), row = Math.floor(y), onRibbon = column >= 0 && column < columns && row >= 0 && row < MENU.rows
  return { x, y, column, row, n: onRibbon ? cells[column * MENU.rows + row] : -1, k: onRibbon && column >= left && column < left + MENU.field ? row * MENU.field + column - left : -1 }
}
function showMenu() { // every frame while the list is open: where it hangs, what the pointer is on, the icon in hand
  menu.layout = menuLayout()
  drawMenu()
  toMatrix3(uniforms.uToMenu.value, menuTurn.setFromAxisAngle(Y, -menu.yaw).multiply(head))
  const { columns, left, cells } = menu.layout, angle = menuAngle(columns), spot = menuSpot()
  if (menu.press && menu.drag < 0 && Math.hypot(spot.x - menu.press.x, spot.y - menu.press.y) > 0.35) menu.drag = menu.press.n
  uniforms.uMenuGrid.value.set(columns, angle, angle * MENU.cell[1] / MENU.cell[0], menu.pitch)
  uniforms.uMenuFold.value.set(Math.min(columns, MENU.fold), Math.ceil(columns / MENU.fold), left + MENU.field / 2)
  uniforms.uMenuPointer.value.copy(aim())
  // lit: the application under the pointer; while one is carried, the place of the field it would go to
  uniforms.uMenuOver.value.set((menu.drag < 0 ? spot.n >= 0 : spot.k >= 0) ? spot.column : -1, spot.row)
  const from = cells.indexOf(menu.drag)
  uniforms.uMenuDrag.value.set(menu.drag < 0 ? -1 : Math.floor(from / MENU.rows), from % MENU.rows, spot.x, spot.y)
}
function closeMenu() {
  Object.assign(menu, { open: false, press: null, drag: -1 })
}
// Puts application n into place k of the field (-1: out of it); places of uninstalled applications become free.
function dropIcon(n, k) {
  change(settings, { menuPins: placeIcon(menu.layout.pins.map(id => menu.ids.includes(id) ? id : null), menu.ids[n], k) })
}
function menuPress(e, down, left) {
  const spot = menuSpot()
  if (down) {
    if (menu.drag >= 0) return // the release went unseen: the release of this press puts the icon down
    if (left && spot.n >= 0) return void (menu.press = { n: spot.n, x: spot.x, y: spot.y })
    return closeMenu()
  }
  // A cancelled press is not the end: the iPhone goes on with the same drag as a finger.
  if (e.type === 'pointercancel' || !menu.press) return
  if (menu.drag >= 0) dropIcon(menu.drag, spot.k)
  else if (spot.n === menu.press.n) {
    fetch('/launch', { method: 'POST', body: JSON.stringify({ app: spot.n }) }).catch(() => {})
    launchSpot = { ...menu.spot, at: Date.now() }
    return closeMenu()
  }
  Object.assign(menu, { press: null, drag: -1 })
}
function twoLines(c, text, width) {
  const lines = ['']
  for (const word of text.split(' ')) {
    const longer = lines.at(-1) ? `${lines.at(-1)} ${word}` : word
    if (!lines.at(-1) || c.measureText(longer).width <= width || lines.length === 2) lines[lines.length - 1] = longer
    else lines.push(word)
  }
  return lines.map(line => {
    while (c.measureText(line).width > width && line.length > 2) line = line.slice(0, -2) + '…'
    return line
  })
}
function drawMenu() { // the whole ribbon on one sheet, drawn again only when the list, the field or an icon has changed
  const { cells, left, columns } = menu.layout
  const state = [menu.names.length, cells.join(), [...menu.icons.values()].filter(icon => icon.ready).length].join()
  if (state === menu.drawn || performance.now() - menu.at < 150) return // icons arrive in a burst: not a new sheet for each
  Object.assign(menu, { drawn: state, at: performance.now() })
  const [w, h] = MENU.cell, width = Math.min(columns, MENU.fold) * w, height = Math.ceil(columns / MENU.fold) * MENU.rows * h
  if (menuCanvas.width !== width || menuCanvas.height !== height) {
    Object.assign(menuCanvas, { width, height })
    menuTexture.dispose() // another size: the copy on the graphics card cannot be written over
  }
  const c = menuCanvas.getContext('2d'), empty = cells.slice(left * MENU.rows, (left + MENU.field) * MENU.rows).every(n => n < 0)
  c.clearRect(0, 0, width, height) // no sheet of its own: the shader darkens the whole view
  Object.assign(c, { textAlign: 'center', textBaseline: 'top', lineWidth: 3 })
  cells.forEach((n, i) => {
    const column = Math.floor(i / MENU.rows), row = i % MENU.rows, x = (column % MENU.fold) * w, y = (Math.floor(column / MENU.fold) * MENU.rows + row) * h
    const inField = column >= left && column < left + MENU.field
    if (inField) { // the field: a lighter ground, a free place outlined
      c.fillStyle = 'rgba(255, 255, 255, 0.08)'
      c.fillRect(x, y, w, h)
    }
    if (inField && n < 0 && !empty) {
      c.setLineDash([10, 8])
      c.strokeStyle = 'rgba(255, 255, 255, 0.3)'
      c.beginPath()
      c.roundRect(x + (w - 104) / 2, y + 14, 104, 104, 16)
      c.stroke()
      c.setLineDash([])
    }
    if (n < 0) return
    let icon = menu.icons.get(n)
    if (!icon) { // asked for once; the sheet is drawn again when it has arrived
      icon = new Image()
      icon.onload = () => { icon.ready = true }
      icon.src = `/appicon/${n}`
      menu.icons.set(n, icon)
    }
    if (icon.ready) c.drawImage(icon, x + (w - 104) / 2, y + 14, 104, 104)
    c.fillStyle = '#fff'
    c.font = '600 24px system-ui, sans-serif'
    twoLines(c, menu.names[n], w - 16).forEach((line, i) => c.fillText(line, x + w / 2, y + 128 + i * 30))
  })
  // A word in the middle of the field while it has nothing to show (and lies within one band of the sheet).
  const words = !menu.names.length ? ['Список загружается…'] : empty ? ['Перетащите сюда', 'свои программы'] : []
  if (words.length && Math.floor(left / MENU.fold) === Math.floor((left + MENU.field - 1) / MENU.fold)) {
    Object.assign(c, { fillStyle: '#c8d4e0', font: '500 34px system-ui, sans-serif' })
    words.forEach((line, i) => c.fillText(line, ((left % MENU.fold) + MENU.field / 2) * w, (Math.floor(left / MENU.fold) * MENU.rows + MENU.rows / 2) * h - 46 + i * 48))
  }
  menuTexture.needsUpdate = true
}

// --- the headset tells the spectator page where it looks
const pause = ms => new Promise(done => setTimeout(done, ms))
const poseTarget = new THREE.Quaternion()
async function sharePose() {
  for (;;) {
    try {
      if (SPECTATOR) {
        const sent = await (await fetch('/pose')).json()
        if (sent) { poseTarget.fromArray(sent); anchor.yaw = sent[4]; anchor.pitch = sent[5] }
      } else if (settings?.spectator) {
        await fetch('/pose', { method: 'POST', body: JSON.stringify([...head.toArray(), anchor.yaw, anchor.pitch]) })
      }
    } catch {} // the server is restarting: go on asking
    await pause(SPECTATOR || settings?.spectator ? 33 : 500)
  }
}
sharePose()

// --- picture and sound from the PC (WebRTC; the WHEP handshake goes through our own server)
// Returns a function that stops the stream for good.
function receive(name, kind, element) {
  let pc, retryTimer, stopped = false, soon = 5 // soon: the stream of a window that has just opened is there within a second
  const retry = () => { clearTimeout(retryTimer); if (!stopped) retryTimer = setTimeout(connect, soon-- > 0 ? 400 : 2000) }
  async function connect() {
    pc?.close()
    const mine = pc = new RTCPeerConnection()
    pc.addTransceiver(kind, { direction: 'recvonly' })
    pc.ontrack = e => {
      if (kind === 'video') e.receiver.jitterBufferTarget = 0 // a desktop wants the newest frame, not a smooth one
      element.srcObject = new MediaStream([e.track])
      element.play().catch(() => {})
    }
    pc.onconnectionstatechange = () => {
      if (mine === pc && ['failed', 'disconnected'].includes(mine.connectionState)) retry()
    }
    try {
      await pc.setLocalDescription()
      await new Promise(done => { // the server has no trickle endpoint, so the offer must carry our addresses
        pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && done()
        setTimeout(done, 500)
      })
      // No answer in 8 s: asked just as the capture was ending, the request can hang in MediaMTX. Ask again.
      const answer = await fetch('/whep/' + name, { method: 'POST', body: mine.localDescription.sdp, signal: AbortSignal.timeout(8000) })
      if (!answer.ok) throw new Error(await answer.text())
      await mine.setRemoteDescription({ type: 'answer', sdp: await answer.text() })
    } catch (e) {
      console.warn(name, 'stream:', e.message)
      if (mine === pc) retry()
    }
  }
  connect()
  // The server may end a stream (the capture stopped, GNOME closed the recording) long before the connection
  // notices. Nothing received for 5 s means it has ended: a still screen repeats its frame 30 times a second and
  // the sound never pauses. Then the stream is asked for again, which also starts the capture if it is not running.
  let received = -1
  const pulse = setInterval(async () => {
    const mine = pc
    if (mine?.connectionState !== 'connected') return
    let bytes = 0
    for (const report of (await mine.getStats()).values()) if (report.type === 'inbound-rtp') bytes += report.bytesReceived ?? 0
    if (bytes === received && mine === pc) connect()
    received = bytes
  }, 5000)
  return () => { stopped = true; clearTimeout(retryTimer); clearInterval(pulse); pc?.close() }
}

// --- start: browsers give sound, and iOS motion sensors, only after a tap
const sound = new Audio()
let tapped = false, soundOn = false
function startStreams() { // called after the tap and after every change of settings: starts what is not running yet
  if (!tapped || !settings) return
  screens.forEach((screen, i) => screen.stop ??= receive(settings.monitors[i].id, 'video', screen.video))
  if (!soundOn && !SPECTATOR) receive('audio', 'audio', sound) // on the PC it would play the PC's sound back into itself
  soundOn = true
}
const keepAwake = () => navigator.wakeLock?.request('screen').catch(() => {})
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake())
const button = document.getElementById('start')
button.onclick = async () => {
  sound.play().catch(() => {}) // inside the tap: unlocks this element, so the stream that arrives later may play
  const answer = await (window.DeviceOrientationEvent?.requestPermission?.().catch(() => 'denied') ?? 'granted')
  if (answer !== 'granted') return void (button.textContent = 'Нет доступа к датчикам движения. Разрешите его в настройках Safari и обновите страницу.')
  button.hidden = true
  bgVideo?.play().catch(() => {})
  keepAwake()
  tapped = true
  startStreams()
  // Opened once now, while the phone is in the hand, so that the permission question comes here and not in the
  // headset; the drawing loop closes it again when it is not looked at.
  if ((settings?.camBelow > 0 || settings?.passthrough) && !SPECTATOR) openCamera()
}
