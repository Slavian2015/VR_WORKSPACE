// Phone page: draws both eyes in one pass. Every screen pixel is turned into a view ray through the lens,
// so lens correction costs nothing and the desktop text is sampled only once (no blur from a second pass).
import * as THREE from 'three'
import { watchParams } from './params.js'
import { deviceQuaternion, gazeOf, monitorFrame } from './orient.js'

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
    uSize: { value: screens.map(() => new THREE.Vector3()) },
    uBg: { value: background }, uToBg: { value: new THREE.Matrix3() },
    uCam: { value: null }, uCamTan: { value: new THREE.Vector2() },
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
      uniform vec3 uSize[${count}];              // angular width in rad (0: hidden), height / width, curve (0 flat .. 1 around the viewer)` : ''}
      uniform sampler2D uBg, uCam;
      uniform mat3 uToBg;                        // head space -> the panorama
      uniform vec2 uCamTan;                      // tangents of half the phone camera's view angles; 0: camera not shown
      uniform vec2 uRes, uCenter;                // px, mm
      uniform float uPxPerMm, uIpd, uLensDist, uK1, uK2;  // lengths in mm
      uniform float uChroma;                     // how much more the lens magnifies blue than green, and green than red
      uniform float uDist;                       // m

      // View ray in head space through a point of the screen; q: its offset from the lens axis over the lens distance.
      vec3 ray(vec2 q) {
        float r2 = dot(q, q);
        return normalize(vec3(q * (1.0 + uK1 * r2 + uK2 * r2 * r2), -1.0)); // the lens magnifies more toward its edge
      }

      vec3 background(vec3 dir) {
        if (uCamTan.x > 0.0) { // the phone camera instead of the panorama: it is fixed to the head, like a window
          vec2 c = dir.xy / (-dir.z * uCamTan);
          return texture(uCam, c * 0.5 + 0.5).rgb * step(max(abs(c.x), abs(c.y)), 1.0);
        }
        vec3 sky = uToBg * dir;
        return texture(uBg, vec2(atan(sky.x, -sky.z) / 6.2831853 + 0.5, asin(clamp(sky.y, -1.0, 1.0)) / 3.1415927 + 0.5)).rgb;
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
          // A monitor faces -Z of its own frame, its centre uDist away. Its width in metres is fixed: an arc of
          // uSize.x radians at ${WIDTH_AT} m. So, like a real one, it looks bigger when it is brought closer.
          // It is bent into a cylinder that touches that centre: of radius uDist at full curve
          // (every point equally far from the eyes), of a larger radius for less curve, a plane for none.
          vec3 d = uToMonitor[${i}] * dir, o = uToMonitor[${i}] * eye, hit;
          float width = ${WIDTH_AT.toFixed(1)} * uSize[${i}].x, curve = uSize[${i}].z, along; // along: metres from the centre line, on the surface
          if (curve < 0.01) {
            hit = o + d * ((-uDist - o.z) / min(d.z, -1e-6));
            along = hit.x;
          } else {
            float r = uDist / curve;
            vec2 axis = vec2(0.0, r - uDist), oa = o.xz - axis;
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
            color = mix(color, picture, inside);
          }
        }`).join('')}
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

// --- the phone's own camera as the background ("pass-through"). It stays open while the setting is on: opening it
// asks for permission, which cannot be answered with the phone in the headset.
let phoneCam // { video, texture } while open, { failed } after a refusal, so that it is asked once
async function syncCamera(wanted) {
  if (!wanted === !phoneCam) return
  if (!wanted) {
    phoneCam.video?.srcObject.getTracks().forEach(track => track.stop())
    phoneCam.video?.remove()
    phoneCam.texture?.dispose()
    return void (phoneCam = null)
  }
  phoneCam = { failed: true } // also marks "being opened"
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
    const video = hiddenVideo({ srcObject: stream })
    phoneCam = { video, texture: new THREE.VideoTexture(video) }
    if (!settings.camera) syncCamera(false) // switched off while the permission question was on the screen
  } catch (e) {
    console.warn('camera:', e.message)
  }
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
  uniforms.uDist.value = p.dist
  setBackground(p.fullscreen && p.autoBlack ? 'black' : p.bg) // dark around a film that fills a monitor
  syncCamera(p.camera && !SPECTATOR) // the spectator must not open the PC's own webcam
  startStreams()
})

const Y = new THREE.Vector3(0, 1, 0), rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4()
const toMatrix3 = (target, q) => target.setFromMatrix4(matrix.makeRotationFromQuaternion(q))
renderer.setAnimationLoop(() => {
  if (!settings) return
  if (SPECTATOR) head.slerp(poseTarget, 0.35) // glide between the 30 readings a second
  else if (centring) Object.assign(anchor, gazeOf(head))
  if (centring === 'heading') anchor.pitch = 0
  centring = null
  // The panorama keeps its horizon; it turns with the heading of the anchor and with the user's own offset.
  toMatrix3(uniforms.uToBg.value, rotation.setFromAxisAngle(Y, settings.bgYaw * DEG - anchor.yaw).multiply(head))
  settings.monitors.forEach(({ id }, i) => {
    toMatrix3(uniforms.uToMonitor.value[i], monitorFrame(anchor, settings[`${id}.yaw`], settings[`${id}.pitch`], rotation).invert().multiply(head))
    const { videoWidth, videoHeight } = screens[i].video
    uniforms.uSize.value[i].set(settings.hideMonitors ? 0 : settings[`${id}.span`] * DEG, videoWidth ? videoHeight / videoWidth : 9 / 16, settings[`${id}.curve`] / 100)
  })
  const shown = settings.passthrough && phoneCam?.video?.videoWidth ? phoneCam : null
  const tan = shown ? Math.tan(settings.camFov * DEG / 2) : 0
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
}
