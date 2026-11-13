// Phone page: draws both eyes in one pass. Every screen pixel is turned into a view ray through the lens,
// so lens correction costs nothing and the desktop text is sampled only once (no blur from a second pass).
import * as THREE from 'three'
import { MONITOR_SPEC, setParams, watchParams } from './params.js'
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
let screens = [], uniforms, monitorIds
function build(count) {
  for (const { video, texture, stop } of screens) { stop?.(); texture.dispose(); video.remove() }
  scene.children[0]?.material.dispose()
  scene.clear()
  const background = uniforms?.uBg.value ?? null // stays as it is
  screens = Array.from({ length: count }, () => {
    const video = hiddenVideo()
    const texture = new THREE.VideoTexture(video)
    texture.generateMipmaps = true // a monitor is shown slightly smaller than 1:1, mipmaps stop the text from shimmering
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    return { video, texture }
  })
  uniforms = {
    uMonitor: { value: screens.map(s => s.texture) },
    uToMonitor: { value: screens.map(() => new THREE.Matrix3()) },
    uSize: { value: screens.map(() => new THREE.Vector4()) },
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
      uniform vec4 uSize[${count}];              // angular width in rad (0: hidden), height / width, curve (0 flat .. 1 around the viewer), distance in m` : ''}
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
          vec2 dx = dFdx(uv), dy = dFdy(uv);                   // taken outside the branch, where they are defined
          if (uSize[${i}].x > 0.0 && inside > 0.0) {
            vec3 picture = textureGrad(uMonitor[${i}], uv, dx, dy).rgb;
            if (uChroma != 0.0) { // the same shift of red and blue, as a step along how uv changes across the screen
              vec2 shift = uChroma * uPxPerMm * (dx * fromAxis.x + dy * fromAxis.y);
              picture.r = textureGrad(uMonitor[${i}], uv - shift, dx, dy).r;
              picture.b = textureGrad(uMonitor[${i}], uv + shift, dx, dy).b;
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
// Reopening asks for permission again unless Safari is set to always allow the camera for this site.
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
  if (!e.buttons || sensorSeen || SPECTATOR) return
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
  if (!p.edit || SPECTATOR) return void (held = wheelSeen = undefined)
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
  const ids = p.monitors.map(m => m.id).join()
  if (ids !== monitorIds) build(p.monitors.length)
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
  if (held) { // the held monitor goes where the head looks, keeping the offset it was taken with
    const gaze = gazeInLayout(anchor, head)
    held.yaw = ((gaze.yaw + held.dYaw + 540) % 360) - 180
    held.pitch = clamp(gaze.pitch + held.dPitch, MONITOR_SPEC.pitch)
  }
  let nearest = 1
  looked = -1
  settings.monitors.forEach(({ id }, i) => {
    const mine = held?.i === i
    monitorFrame(anchor, mine ? held.yaw : settings[`${id}.yaw`], mine ? held.pitch : settings[`${id}.pitch`], rotation).invert().multiply(head)
    toMatrix3(uniforms.uToMonitor.value[i], rotation)
    const { videoWidth, videoHeight } = screens[i].video
    const span = settings.hideMonitors || settings[`${id}.hidden`] ? 0 : settings[`${id}.span`] * DEG, aspect = videoWidth ? videoHeight / videoWidth : 9 / 16
    uniforms.uSize.value[i].set(span, aspect, settings[`${id}.curve`] / 100, settings[`${id}.dist`])
    // Is the centre of the view on this monitor? Its half-size as seen from here, in radians.
    const ahead = forward.set(0, 0, -1).applyQuaternion(rotation), halfWidth = WIDTH_AT * span / settings[`${id}.dist`] / 2
    const off = Math.max(Math.abs(Math.atan2(ahead.x, -ahead.z)) / halfWidth, Math.abs(Math.asin(ahead.y)) / (halfWidth * aspect))
    if (settings.edit && off < nearest) { nearest = off; looked = i }
  })
  showArranging()
  if (!SPECTATOR) { // the spectator must not open the PC's own webcam
    // `lowest` is how low the camera picture would reach at this tilt of the head. The camera is opened 5 degrees
    // before that reaches the look-down window, to be ready in time, and closed 2 s after it is 8 degrees clear.
    const aspect = phoneCam?.video?.videoWidth ? phoneCam.video.videoHeight / phoneCam.video.videoWidth : 0.5625
    const lowest = (gazeOf(head).pitch - Math.atan(Math.tan(settings.camFov * DEG / 2) * aspect)) / DEG
    const wanted = settings.passthrough || (settings.camBelow > 0 && lowest < -settings.camBelow + (phoneCam?.track ? 8 : 5))
    if (wanted) {
      unseenSince = undefined
      openCamera()
    } else if (phoneCam?.track && Date.now() - (unseenSince ??= Date.now()) > 2000) closeCamera()
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
  let pc, retryTimer, stopped = false
  const retry = () => { clearTimeout(retryTimer); if (!stopped) retryTimer = setTimeout(connect, 2000) }
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
      const answer = await fetch('/whep/' + name, { method: 'POST', body: mine.localDescription.sdp })
      if (!answer.ok) throw new Error(await answer.text())
      await mine.setRemoteDescription({ type: 'answer', sdp: await answer.text() })
    } catch (e) {
      console.warn(name, 'stream:', e.message)
      if (mine === pc) retry()
    }
  }
  connect()
  return () => { stopped = true; clearTimeout(retryTimer); pc?.close() }
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
