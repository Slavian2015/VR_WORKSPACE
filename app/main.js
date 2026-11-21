// Phone page: draws both eyes in one pass. Every screen pixel is turned into a view ray through the lens,
// so lens correction costs nothing and the desktop text is sampled only once (no blur from a second pass).
import * as THREE from 'three'
import { KEYCODES, LAYOUT_SPEC, MONITOR_SPEC, placeIcon, resizeWindow, setParams, snapPanel, watchParams } from './params.js'
import { deviceQuaternion, gazeInLayout, gazeOf, monitorFrame } from './orient.js'

const DEG = Math.PI / 180
// index.html?spectator on the PC: one flat picture of what the headset wearer looks at, to watch or to record.
// The same shader with lens separation and lens distortion set to zero is an ordinary camera. A number sets the
// width of the view in degrees: ?spectator=100.
// index.html?glasses: the picture of a headset on a cable (two displays side by side, a monitor to the PC), drawn
// here on the PC. It is the headset, as the phone page is with a phone: its list, its arranging, the windows. Only
// the head's turn comes from elsewhere, pushed by the server: for now the phone's, which then only senses. Always
// stereo, the left half of the window for the left eye, each eye seeing a flat screen glassesFov across its diagonal.
// The PC's own mouse works over it as the phone's mouse does over the phone (its own pointer hidden here, ours drawn
// in the sphere), and inside a monitor or window when ours goes onto it (the extension puts the real one there).
// Its camera is this PC's webcam for now. The extension finds this window by its title.
const GLASSES = new URLSearchParams(location.search).has('glasses')
if (GLASSES) {
  document.title = 'VR Workspace — glasses'
  document.documentElement.style.cursor = 'none'
}
const SPECTATOR = new URLSearchParams(location.search).has('spectator')
const sensorOnly = () => !!settings?.glasses && !GLASSES && !SPECTATOR // the phone while a headset on a cable is the headset: it gives the head's turn, nothing more
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
const pickCanvas = Object.assign(document.createElement('canvas'), { width: 1200, height: 640 }) // the backgrounds, below in the arranging mode
const clockCanvas = Object.assign(document.createElement('canvas'), { width: 640, height: 230 }) // the clock, above
const noteCanvas = Object.assign(document.createElement('canvas'), { width: 1000, height: 220 }) // a notification of the PC
// Those three go to the graphics card as one picture, each in its own place (SHEETS: x, y on it): an iPhone gives a
// shader 16 pictures, and each panel takes one.
const SHEETS = { pick: [0, 0], clock: [0, 640], note: [0, 870], arrow: [1000, 870] }, sheets = Object.assign(document.createElement('canvas'), { width: 1200, height: 1090 })
const sheetsTexture = new THREE.CanvasTexture(sheets)
for (const sheet of [menuTexture, sheetsTexture]) Object.assign(sheet, { generateMipmaps: false, minFilter: THREE.LinearFilter }) // drawn about 1:1
function toSheets(canvas, [x, y]) { // a sheet drawn anew: into its place
  const c = sheets.getContext('2d')
  c.clearRect(x, y, canvas.width, canvas.height)
  c.drawImage(canvas, x, y)
  sheetsTexture.needsUpdate = true
}
// Our pointer where it is not in a window (the list, arranging; on a cable everywhere), and in a window until the PC
// has told its shape: the usual arrow, white with a black edge, drawn twice as large as it shows, its tip at (3, 3).
const arrowCanvas = Object.assign(document.createElement('canvas'), { width: 32, height: 48 })
{
  const c = arrowCanvas.getContext('2d')
  c.translate(3, 3)
  c.scale(2, 2)
  c.beginPath()
  for (const [x, y] of [[0, 0], [0, 17], [4, 13], [7, 20], [9.5, 19], [6.5, 12], [12, 12]]) c.lineTo(x, y)
  c.closePath()
  Object.assign(c, { lineJoin: 'round', lineWidth: 2, strokeStyle: '#000', fillStyle: '#fff' })
  c.stroke()
  c.fill()
  toSheets(arrowCanvas, SHEETS.arrow)
}
// Where a sheet is in that picture, for the shader: its corner and size, 0..1 from the top left
const region = (canvas, [x, y]) => [x / sheets.width, y / sheets.height, canvas.width / sheets.width, canvas.height / sheets.height].map(n => n.toFixed(6)).join(', ')
// In place of the video of a panel out of view: three.js puts a video frame on the graphics card (and makes its mipmaps)
// only for a texture that is drawn with, so the frames of panels behind the viewer cost nothing there.
const blankTexture = Object.assign(new THREE.DataTexture(new Uint8Array(4), 1, 1), { needsUpdate: true })
// A monitor is shown slightly smaller than 1:1, mipmaps stop the text from shimmering
const crisp = texture => Object.assign(texture, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  anisotropy: renderer.capabilities.getMaxAnisotropy() })
let screens = [], uniforms, monitorIds
function build(keys) { // keys: what each monitor shows. One that stays keeps its video and its connection: no blink
  const old = screens, count = keys.length
  scene.children[0]?.material.dispose()
  scene.clear()
  const background = uniforms?.uBg.value ?? null // stays as it is
  screens = keys.map(key => old.find(s => s.key === key) ?? (() => {
    // A headset on a cable gets the pictures as they are, with no video in between (receivePlain): what stands for
    // the video there only tells the picture's size and whether one has come.
    const video = GLASSES ? { videoWidth: 0, videoHeight: 0, readyState: 0, remove() {} } : hiddenVideo()
    return { key, video, texture: crisp(GLASSES ? new THREE.DataTexture(new Uint8Array(4), 1, 1) : new THREE.VideoTexture(video)) }
  })())
  for (const { video, texture, stop } of old.filter(s => !screens.includes(s))) { stop?.(); texture.dispose(); video.remove() }
  uniforms = {
    uMonitor: { value: screens.map(s => s.texture) },
    uToMonitor: { value: screens.map(() => new THREE.Matrix3()) },
    uSize: { value: screens.map(() => new THREE.Vector4()) },
    uCrop: { value: screens.map(() => new THREE.Vector4(0, 0, 1, 1)) },
    uPopups: { value: Array.from({ length: count * 3 }, () => new THREE.Vector4()) },
    uGlow: { value: screens.map(() => new THREE.Vector4()) }, uLook: { value: screens.map(() => new THREE.Vector3(0, 1, 0)) },
    uGlowColor: { value: new THREE.Color() }, uGlowColor2: { value: new THREE.Color() }, uTime: { value: 0 }, uSharp: { value: new THREE.Vector2(1, 0) },
    uPointer: { value: new THREE.Vector3(-1, 0, 0) }, uPointerPx: { value: new THREE.Vector2(1, 1) },
    uRay: { value: new THREE.Vector3(0, 0, -1) }, uRayOn: { value: 0 }, uArrowPx: { value: 1 },
    uMenu: { value: menuTexture }, uMenuOn: { value: 0 }, uToMenu: { value: new THREE.Matrix3() }, uMenuPlace: { value: new THREE.Vector4() },
    uMenuSize: { value: new THREE.Vector2(1, 1) }, uMenuLit: { value: new THREE.Vector4(0, 0, -1, -1) }, uMenuDrag: { value: new THREE.Vector4(-1, 0, 0, 0) },
    uMenuAt: { value: new THREE.Vector2() },
    uToYaw: { value: new THREE.Matrix3() },
    uSheets: { value: sheetsTexture }, uPickOn: { value: 0 }, uPickPlace: { value: new THREE.Vector4() }, uPickSize: { value: new THREE.Vector2(1, 1) },
    uClockOn: { value: 0 }, uClockPlace: { value: new THREE.Vector4() }, uClockSize: { value: new THREE.Vector2(1, 1) },
    uNoteOn: { value: 0 }, uNotePlace: { value: new THREE.Vector4() },
    uBg: { value: background }, uToBg: { value: new THREE.Matrix3() }, uBgLook: { value: new THREE.Vector2() },
    uCam: { value: null }, uCamTan: { value: new THREE.Vector2() }, uCamShift: { value: new THREE.Vector2() }, uCamBelow: { value: -2 },
    uHud: { value: hudTexture }, uHudOn: { value: 0 }, uCursorBox: { value: cursorBox },
    uRes: { value: new THREE.Vector2() }, uCenter: { value: new THREE.Vector2() },
    uPxPerMm: { value: 1 }, uIpd: { value: SPECTATOR ? 0 : 63 }, uLensDist: { value: 40 }, uK1: { value: 0 }, uK2: { value: 0 }, uChroma: { value: 0 }, uDist: { value: 1.5 }, uSheetsAt: { value: 1.5 },
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
      uniform vec4 uPopups[${count * 3}];        // three for each: a single window's open menus where they reach out of it, as corners in its 0..1 (0: none)
      uniform vec4 uGlow[${count}];              // which sides of it glow: left, right, top, bottom as 0 or 1
      uniform vec3 uLook[${count}];              // how strongly they glow (0: not at all); how much of the panel shows (it fades in); 1: no picture yet` : ''}
      uniform vec3 uGlowColor, uGlowColor2;      // the glow drifts between these two
      uniform vec2 uSharp;                       // text sharpening: how much smaller a footprint picks the mipmap level (1: none); how much of the edges is added back
      uniform float uTime;                       // s
      uniform vec3 uPointer;                     // our pointer in a single window: the monitor it is on (-1: none) and its place there, 0..1
      uniform vec2 uPointerPx;                   // that window's size in its own pixels
      uniform vec3 uRay;                         // our pointer as a direction in head space (the list, arranging)
      uniform float uRayOn;
      uniform float uArrowPx;                    // our arrow's picture: its pixels per radian of view
      // Sheets hung around the viewer: the list of applications (fixed in the room), the backgrounds and the clock
      // (below and above wherever one looks). Place: pixels per radian, the height of its middle (rad), that middle
      // on the sheet (px). Lit: a rectangle of the sheet that is lit (px; none when its corners are the wrong way).
      uniform sampler2D uMenu, uSheets;          // uSheets: the backgrounds, the clock and a notification, in their places (SHEETS)
      uniform float uMenuOn, uPickOn, uClockOn, uNoteOn; // how much they show
      uniform vec4 uNotePlace;                   // a notification: fixed to the head, above the middle of the view
      uniform mat3 uToMenu, uToYaw;              // head space -> where the list hangs; -> a frame that turns with the head, but only around the vertical
      uniform vec4 uMenuPlace, uPickPlace, uClockPlace, uMenuLit;
      uniform vec2 uMenuSize, uPickSize, uClockSize; // px
      uniform vec4 uMenuDrag;                    // the icon in hand: its rectangle on the sheet (x < 0: none)
      uniform vec2 uMenuAt;                      // where the pointer is on the sheet, px
      uniform sampler2D uBg, uCam;
      uniform mat3 uToBg;                        // head space -> the panorama
      uniform vec2 uBgLook;                      // its darkening, 0..1, and blur, as a level of its smaller copies
      uniform vec2 uCamTan;                      // tangents of half the phone camera's view angles; 0: camera not shown
      uniform vec2 uCamShift;                    // where the camera looks relative to the eyes, as tangents
      uniform float uCamBelow;                   // the camera shows where the view's height (sine) is under this; 2: everywhere
      uniform float uHudOn;                      // arranging mode: whether the note is shown
      uniform sampler2D uHud;                    // the note; outside the arranging mode the PC pointer's picture, at its top left
      uniform vec4 uCursorBox;                   // that picture: width, height (0: not known, a dot instead; < 0: hidden), hot spot (px)
      uniform vec2 uRes, uCenter;                // px, mm
      uniform float uPxPerMm, uIpd, uLensDist, uK1, uK2;  // lengths in mm
      uniform float uChroma;                     // how much more the lens magnifies blue than green, and green than red
      uniform float uDist;                       // m: how far away the arranging note is drawn
      uniform float uSheetsAt;                   // m: how far away the list, the backgrounds, the clock, a notification and our pointer are (as new windows)

      // View ray in head space through a point of the screen; q: its offset from the lens axis over the lens distance.
      vec3 ray(vec2 q) {
        float r2 = dot(q, q);
        return normalize(vec3(q * (1.0 + uK1 * r2 + uK2 * r2 * r2), -1.0)); // the lens magnifies more toward its edge
      }

      bool within(vec2 p, vec4 r) { return all(greaterThanEqual(p, r.xy)) && all(lessThanEqual(p, r.zw)); }

      // The colour of the glow at a place of a panel (uv: 0..1): it drifts between the two around the panel.
      vec3 glowTint(vec2 uv) { return mix(uGlowColor, uGlowColor2, 0.5 + 0.5 * sin(uTime * 1.6 + 2.0 * atan(uv.y - 0.5, uv.x - 0.5))); }

      // A sheet's picture where the ray meets it; at: that place on the sheet, px. Its columns follow the azimuth,
      // its rows the height, both as angles. region: where the sheet is in the texture (corner, size; 0..1 from the top left).
      vec4 sheet(sampler2D tex, vec4 region, mat3 turn, vec4 place, vec2 size, vec3 toward, out vec2 at) {
        vec3 d = turn * toward;
        at = vec2(atan(d.x, -d.z) * place.x + place.z, place.w - (asin(clamp(d.y, -1.0, 1.0)) - place.y) * place.x);
        vec2 uv = at / size;
        return uv == clamp(uv, 0.0, 1.0) ? textureLod(tex, vec2(region.x + uv.x * region.z, 1.0 - region.y - uv.y * region.w), 0.0) : vec4(0.0);
      }
      vec4 arrow(vec2 px) { // our arrow (SHEETS.arrow) at px of its picture, from the top left; nothing beside it
        return px == clamp(px, vec2(0.0), vec2(${arrowCanvas.width}.0, ${arrowCanvas.height}.0))
          ? textureLod(uSheets, vec2(${SHEETS.arrow[0]}.0 + px.x, ${sheets.height - SHEETS.arrow[1]}.0 - px.y) / vec2(${sheets.width}.0, ${sheets.height}.0), 0.0) : vec4(0.0);
      }

      vec3 background(vec3 dir) {
        vec3 sky = uToBg * dir;
        // A level of its own, not one from how fast the place changes on the screen: that jumps at the seam behind.
        vec3 color = textureLod(uBg, vec2(atan(sky.x, -sky.z) / 6.2831853 + 0.5, asin(clamp(sky.y, -1.0, 1.0)) / 3.1415927 + 0.5), uBgLook.y).rgb * (1.0 - uBgLook.x);
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

      // A panel whose picture has not come yet (an application just started) is glass: what is behind it, frosted (a
      // small copy of the background), with a pale outline of a window on it (title bar, lines of text) that breathes,
      // a soft light passing over it, and a bright edge. uv: 0..1 on the panel; aa: a screen pixel in panel widths.
      vec3 glass(vec3 dir, vec2 uv, float aspect, float aa, vec2 edgePx) {
        vec3 sky = uToBg * dir;
        vec3 c = textureLod(uBg, vec2(atan(sky.x, -sky.z) / 6.2831853 + 0.5, asin(clamp(sky.y, -1.0, 1.0)) / 3.1415927 + 0.5), max(uBgLook.y, 5.0)).rgb * (1.0 - uBgLook.x);
        c = mix(c, vec3(1.0), 0.07);
        vec2 q = vec2(uv.x, (1.0 - uv.y) * aspect); // in panel widths, from its top left
        float outline = 1.0 - smoothstep(-aa, aa, q.y - 0.12 * aspect);
        const float lengths[5] = float[5](0.62, 0.8, 0.48, 0.72, 0.55);
        for (int i = 0; i < 5; i++) { // the lines: rounded bars
          float r = 0.0275 * aspect, y = (0.27 + float(i) * 0.13) * aspect + r, x0 = 0.07 + r, x1 = 0.07 + 0.86 * lengths[i] - r;
          float d = length(vec2(max(abs(q.x - 0.5 * (x0 + x1)) - 0.5 * (x1 - x0), 0.0), q.y - y)) - r;
          outline = max(outline, 1.0 - smoothstep(-aa, aa, d));
        }
        c = mix(c, vec3(1.0), outline * (0.1 + 0.04 * sin(uTime * 2.2)));
        float pass = fract(uTime / 1.9) * (1.6 + 0.5 * aspect) - 0.3; // the light, slanted, across in 1.9 s
        c = mix(c, vec3(1.0), 0.14 * exp(-pow((q.x + 0.5 * q.y - pass) / 0.12, 2.0)));
        return mix(c, vec3(1.0), 0.18 * (1.0 - smoothstep(0.5, 1.5, min(edgePx.x, edgePx.y))));
      }

      void main() {
        vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uPxPerMm - uCenter; // mm from the point between the lenses
        float side = p.x < 0.0 ? -1.0 : 1.0;                           // left half of the phone is the left eye
        vec2 fromAxis = p - vec2(side * 0.5 * uIpd, 0.0);              // mm from the lens axis
        vec3 dir = ray(fromAxis / uLensDist);                          // view ray and eye position, in head space
        vec3 eye = vec3(side * 0.0005 * uIpd, 0.0, 0.0);               // m
        vec3 toward = normalize(eye + uSheetsAt * dir); // from between the eyes to where this ray is that far away: where the sheets and our pointer are, for both eyes

        // The lens spreads colours: the blue picture comes out larger than the red one, more so toward the edge.
        // So red is drawn as if its pixel were a little nearer to the lens axis and blue a little farther.
        vec3 color = background(dir);
        if (uChroma != 0.0) {
          color.r = background(ray(fromAxis * (1.0 - uChroma) / uLensDist)).r;
          color.b = background(ray(fromAxis * (1.0 + uChroma) / uLensDist)).b;
        }
        ${screens.map((_, i) => /* glsl: sampler arrays accept only constant indexes, so the loop is unrolled here */ `
        // A panel hidden or out of view costs nothing: the branch is on a uniform, the same for every pixel.
        if (uSize[${i}].x > 0.0) {
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
          // The glow: a soft shadow and over it a light along the glowing sides, its colour drifting around the
          // panel. Only beyond those sides: a pixel beyond a side that does not glow gets none.
          vec4 beyond = vec4(max(-uv.x, 0.0), max(uv.x - 1.0, 0.0), max(uv.y - 1.0, 0.0), max(-uv.y, 0.0)) * vec4(width, width, width * uSize[${i}].y, width * uSize[${i}].y);
          if (uLook[${i}].x > 0.0 && dot(beyond, 1.0 - uGlow[${i}]) == 0.0) {
            float off = length(beyond * uGlow[${i}]) / away; // as an angle, rad
            float strength = uLook[${i}].x * uLook[${i}].y;
            color *= 1.0 - 0.5 * strength * exp(-off / 0.03);
            color = mix(color, glowTint(uv), strength * exp(-off / 0.01));
          }
          vec2 fw = fwidth(uv), edge = min(uv, 1.0 - uv) / fw;
          float inside = clamp(min(edge.x, edge.y), 0.0, 1.0), menu = 0.0; // 1 px soft edge; menu: an open menu of the window is here
          for (int j = ${i * 3}; j < ${i * 3 + 3}; j++) { // and the window's menus: the video has them also where they reach out of it
            vec2 e = min(uv - uPopups[j].xy, uPopups[j].zw - uv) / fwidth(uv);
            menu = max(menu, clamp(min(e.x, e.y), 0.0, 1.0));
          }
          inside = max(inside, menu);
          vec2 at = uCrop[${i}].xy + uv * uCrop[${i}].zw;      // where that is in the video
          vec2 dx = dFdx(at), dy = dFdy(at);                   // taken outside the branch, where they are defined
          if (inside > 0.0) {
            // Text through the lenses: a sharper level of the mipmaps than the screen's pixels would take, and the
            // picture's difference from its neighbours (one screen pixel away) added back: an unsharp mask. Added
            // as grey, after the colour shift below: that takes red and blue anew, and they would stay soft (green
            // alone sharpened draws coloured edges around letters).
            vec2 gx = dx * uSharp.x, gy = dy * uSharp.x;
            vec3 picture = textureGrad(uMonitor[${i}], at, gx, gy).rgb;
            float sharper = 0.0;
            if (uSharp.y > 0.0) {
              vec3 around = textureGrad(uMonitor[${i}], at + dx, gx, gy).rgb + textureGrad(uMonitor[${i}], at - dx, gx, gy).rgb
                + textureGrad(uMonitor[${i}], at + dy, gx, gy).rgb + textureGrad(uMonitor[${i}], at - dy, gx, gy).rgb;
              sharper = dot(picture - around * 0.25, vec3(0.299, 0.587, 0.114)) * uSharp.y;
            }
            // Out of the window the video is black where a menu's box has nothing (beside its arrow): not shown.
            if (min(edge.x, edge.y) < 0.0 && max(picture.r, max(picture.g, picture.b)) < 0.04) inside = 0.0;
            if (uChroma != 0.0) { // the same shift of red and blue, as a step along how the place changes across the screen
              vec2 shift = uChroma * uPxPerMm * (dx * fromAxis.x + dy * fromAxis.y);
              picture.r = textureGrad(uMonitor[${i}], at - shift, gx, gy).r;
              picture.b = textureGrad(uMonitor[${i}], at + shift, gx, gy).b;
            }
            picture = clamp(picture + sharper, 0.0, 1.0);
            if (uLook[${i}].z > 0.0) picture = glass(dir, uv, uSize[${i}].y, fw.x, edge); // no picture yet
            // The glowing sides also light the panel's own rim, a few tenths of a degree in: clearly which side it is.
            vec4 into = vec4(uv.x, 1.0 - uv.x, 1.0 - uv.y, uv.y) * vec4(width, width, width * uSize[${i}].y, width * uSize[${i}].y) / away;
            float rim = min(min(mix(1.0, into.x, uGlow[${i}].x), mix(1.0, into.y, uGlow[${i}].y)), min(mix(1.0, into.z, uGlow[${i}].z), mix(1.0, into.w, uGlow[${i}].w)));
            if (uLook[${i}].x > 0.0 && rim >= 0.0 && rim < 0.005 && menu == 0.0) { // on the window itself: not beyond it, not over its menus
              picture = mix(picture, glowTint(uv), uLook[${i}].x * (1.0 - rim / 0.005));
            }
            if (uPointer.x == ${i}.0) { // our pointer, in the window's pixels: the shape the PC's pointer has, or a dot until that is known
              vec2 px = (uv - uPointer.yz) * vec2(1.0, -1.0) * uPointerPx + uCursorBox.zw; // from the top left of its picture
              if (uCursorBox.x > 0.0 && px == clamp(px, vec2(0.0), uCursorBox.xy)) {
                vec4 shape = textureLod(uHud, vec2(px.x, vec2(textureSize(uHud, 0)).y - px.y) / vec2(textureSize(uHud, 0)), 0.0);
                picture = mix(picture, shape.rgb, shape.a);
              } else if (uCursorBox.x == 0.0) {
                vec4 a = arrow((uv - uPointer.yz) * vec2(1.0, -1.0) * uPointerPx * 2.0 + 3.0);
                picture = mix(picture, a.rgb, a.a);
              }
            }
            color = mix(color, picture, inside * uLook[${i}].y);
          }
        }`).join('')}
        if (uHudOn > 0.0) { // a note under the centre of the view, fixed to the head and as far away as the monitors
          vec2 t = dir.xy / -dir.z + vec2(side * 0.0005 * uIpd / uDist, 0.0);
          vec2 h = (t - vec2(0.0, -0.3)) / vec2(0.44, 0.08) * 0.5 + 0.5;
          vec4 note = textureLod(uHud, h, 0.0);
          color = mix(color, note.rgb, note.a * step(max(abs(h.x - 0.5), abs(h.y - 0.5)), 0.5));
        }
        vec2 at;
        if (uClockOn > 0.0) {
          vec4 s = sheet(uSheets, vec4(${region(clockCanvas, SHEETS.clock)}), uToYaw, uClockPlace, uClockSize, toward, at);
          color = mix(color, s.rgb, s.a * uClockOn);
        }
        if (uPickOn > 0.0) {
          vec4 s = sheet(uSheets, vec4(${region(pickCanvas, SHEETS.pick)}), uToYaw, uPickPlace, uPickSize, toward, at);
          color = mix(color, s.rgb, s.a * uPickOn);
        }
        if (uNoteOn > 0.0) { // over the panels, under the list of applications
          vec4 s = sheet(uSheets, vec4(${region(noteCanvas, SHEETS.note)}), mat3(1.0), uNotePlace, vec2(${noteCanvas.width}.0, ${noteCanvas.height}.0), toward, at);
          color = mix(color, s.rgb, s.a * uNoteOn);
        }
        if (uMenuOn > 0.0) { // the list of applications: a ribbon of icons around the viewer, fixed in the room, over everything
          color *= 1.0 - 0.8 * uMenuOn; // the whole view goes dark behind it
          vec4 s = sheet(uMenu, vec4(0.0, 0.0, 1.0, 1.0), uToMenu, uMenuPlace, uMenuSize, toward, at);
          if (within(at, uMenuLit)) color = mix(color, vec3(1.0), 0.18 * uMenuOn); // under the pointer
          color = mix(color, s.rgb, s.a * uMenuOn);
          vec2 halfSize = 0.5 * (uMenuDrag.zw - uMenuDrag.xy), q = at - uMenuAt + halfSize; // the icon in hand: its picture, centred on the pointer
          if (uMenuDrag.x >= 0.0 && within(q, vec4(0.0, 0.0, 2.0 * halfSize))) {
            vec4 icon = textureLod(uMenu, vec2((uMenuDrag.x + q.x) / uMenuSize.x, 1.0 - (uMenuDrag.y + q.y) / uMenuSize.y), 0.0);
            color = mix(color, icon.rgb, icon.a);
          }
        }
        if (uRayOn > 0.0 && dot(toward, uRay) > 0.5) { // our pointer: the arrow, its tip where it points, as large as on the PC
          vec3 right = normalize(cross(uRay, vec3(0.0, 1.0, 0.0))), down = cross(uRay, right);
          vec4 a = arrow(vec2(dot(toward, right), dot(toward, down)) / dot(toward, uRay) * uArrowPx + 3.0);
          color = mix(color, a.rgb, a.a);
        }
        gl_FragColor = vec4(color, 1.0);
      }`,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  scene.add(quad)
}

// --- 360 background: a photo, a video when the file is one, or plain 'black'. Its smaller copies (mipmaps) are what
// it is blurred with; a video makes them anew for every frame, so only while it is blurred.
let bgSrc, bgVideo
function setBackground(src, blurred) {
  const video = /\.(mp4|webm|mov)$/i.test(src)
  if (`${src} ${video && blurred}` === bgSrc) return
  bgSrc = `${src} ${video && blurred}`
  uniforms.uBg.value?.dispose()
  bgVideo?.remove()
  bgVideo = video ? hiddenVideo({ src, loop: true }) : null
  const tex = bgVideo ? new THREE.VideoTexture(bgVideo)
    : src === 'black' ? new THREE.DataTexture(new Uint8Array(4), 1, 1)
    : new THREE.TextureLoader().load(src)
  if (src === 'black') tex.needsUpdate = true // a data texture is uploaded only when asked
  tex.wrapS = THREE.RepeatWrapping // the panorama joins itself behind the viewer
  tex.generateMipmaps = !video || blurred
  tex.minFilter = tex.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
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
  if (!e.buttons || sensorSeen || SPECTATOR || GLASSES || settings?.monitors[looked]?.window) return // over a single window the mouse works in it
  dragYaw += e.movementX * 0.003
  dragPitch = THREE.MathUtils.clamp(dragPitch + e.movementY * 0.003, -1.5, 1.5)
  head.setFromEuler(new THREE.Euler(dragPitch, dragYaw, 0, 'YXZ'))
})

// --- arranging the monitors from inside the sphere. The control page takes the PC mouse and reports its left button
// and wheel in the settings answer (edit, grab, wheelSize, wheelCurve, wheelDist); everything else happens here, so a
// held monitor follows the head without any network delay. The spectator page only watches.
const clamp = (value, [, min, max]) => Math.min(max, Math.max(min, value))
let looked = -1 // the monitor under the centre of the view, found in the drawing loop
let held        // { i, dYaw, dPitch, yaw, pitch, mouse, snap }: the panel being carried, its offset from the gaze (mouse: the phone's mouse carries it, from its pointer) and where it is drawn to
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
  if (!p.edit || SPECTATOR || sensorOnly()) { // not arranging: nothing stays in hand; a window being resized keeps the size it got
    if (resizing) endResize(p)
    held = undefined
    return void (wheelSeen = undefined)
  }
  // Coming in: our pointer to the middle of the view, for the PC's mouse, which points with the gaze (the panel under
  // our pointer is found in the drawing loop, so it must be there before the first press). The phone's mouse moves it.
  if (wheelSeen === undefined && !GLASSES) Object.assign(mouse, { x: 0.5, y: 0.5 }) // (on a cable the PC's mouse is our pointer itself)
  if (menu.open) closeMenu() // its clicks are the arranging's now
  const id = p.monitors[held ? held.i : looked]?.id
  const wheel = [p.wheelSize, p.wheelCurve, p.wheelDist], was = wheelSeen ?? wheel
  wheelSeen = wheel
  if (pick.fade > 0.5) return void (wheel[0] !== was[0] && pickWheel(wheel[0] - was[0])) // looking down: the wheel turns the backgrounds' pages
  if (id && wheel[0] !== was[0]) zoomPanel(p, id, 0.06 * (wheel[0] - was[0])) // the PC's wheel through the extension: notches
  if (id && wheel[1] !== was[1]) change(p, { [`${id}.curve`]: clamp(p[`${id}.curve`] + 5 * (wheel[1] - was[1]), MONITOR_SPEC.curve) })
  if (id && wheel[2] !== was[2]) change(p, { [`${id}.dist`]: clamp(Math.round((p[`${id}.dist`] + 0.1 * (wheel[2] - was[2])) * 10) / 10, MONITOR_SPEC.dist) })
}

function putDown() { // the panel in hand stays where it was drawn to
  const id = settings.monitors[held.i]?.id
  if (id) change(settings, { [`${id}.yaw`]: Math.round(held.snap?.yaw ?? held.yaw), [`${id}.pitch`]: Math.round(held.snap?.pitch ?? held.pitch) })
  held = undefined
}

// The note with the numbers of the monitor in hand, drawn as text and shown by the shader.
const hud = Object.assign(document.createElement('canvas'), { width: 1408, height: 256 })
const hudTexture = new THREE.CanvasTexture(hud)
let hudShown
// Outside the arranging mode the same canvas holds the PC pointer's picture, drawn over the window worked in: never
// both at once, and an iPhone gives a shader 16 pictures (each panel takes one).
const cursorBox = new THREE.Vector4() // its width, height (0: not known yet; -1: hidden), hot spot, px
let cursorImage, cursorDrawn, cursorSeen // the picture as loaded; the one on the canvas; the number of the latest
function showCursor() {
  if (cursorDrawn === cursorImage) return
  const c = hud.getContext('2d')
  c.clearRect(0, 0, hud.width, hud.height)
  if (cursorImage) c.drawImage(cursorImage, 0, 0)
  hudTexture.needsUpdate = true
  cursorDrawn = cursorImage
  hudShown = undefined // the note is to be drawn again
}
function cursorFrom(told) { // from the settings: [its picture's number, hot spot x, y, whether shown], or null (not known)
  const [n, x, y, shown] = told ?? []
  if (n === cursorSeen) return
  cursorSeen = n
  if (!n || !shown) return void cursorBox.set(n ? -1 : 0, 0, 0, 0)
  const image = new Image()
  image.onload = () => {
    if (cursorSeen !== n) return // a newer one is on its way
    cursorImage = image
    cursorBox.set(Math.min(image.width, 128), Math.min(image.height, 128), x, y)
  }
  image.src = `/cursor?${n}`
}
function showArranging() {
  const i = held?.i ?? resizing?.i ?? (pointed.i >= 0 ? pointed.i : looked), m = settings.monitors[i], id = m?.id
  uniforms.uHudOn.value = settings.edit && !pick.fade ? 1 : 0 // not while the backgrounds are looked at, just under it
  uniforms.uDist.value = id ? settings[`${id}.dist`] : 1.5
  if (!settings.edit) return showCursor()
  cursorDrawn = undefined // the note takes the canvas; the pointer comes back after
  const where = held ? held.snap ?? held : resizing ?? { yaw: settings[`${id}.yaw`], pitch: settings[`${id}.pitch`] }
  const lines = [
    id ? `${m.window ? `Окно «${m.name.slice(0, 40)}»` : `Монитор ${i + 1} (${m.name})`}${held ? ': в руке' : resizing ? `: ${resizing.w} × ${resizing.h}` : ''}` : 'Наведите указатель или взгляд на панель',
    (id ? `вправо ${Math.round(where.yaw)}°   вверх ${Math.round(where.pitch)}°   ` +
      `ширина ${Math.round(resizing?.span ?? settings[`${id}.span`])}°   изгиб ${settings[`${id}.curve`]}%   расстояние ${settings[`${id}.dist`]} м` : 'мышь телефона или мышь компьютера'),
    'левая кнопка в любом месте: нести  ·  край или угол окна: размер окна  ·  колесо: размер  ·  Shift / Ctrl + колесо: изгиб / расстояние  ·  внизу: обои',
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
  // opens where the user is looking, at the distance of the setting windowDist, as large as it would be at 1.5 m
  // with one of its pixels on one pixel of the screen there (text as sharp as it can be: the picture arrives as sharp
  // as on the PC); farther it is smaller. (Windows that were there when the page started keep their places.)
  const perDegree = pxPerDegree(p)
  for (const m of p.monitors) {
    const { id, window, over, crop } = m
    if (!window || monitorIds === undefined || monitorIds.split(',').includes(key(m)) || !tapped || SPECTATOR || sensorOnly() || document.hidden) continue
    const parent = p.monitors.find(o => o.id === over), started = Date.now() - (launchSpot?.at ?? 0) < 20000
    const gaze = parent ? { yaw: p[`${over}.yaw`], pitch: p[`${over}.pitch`] } : started ? launchSpot : gazeInLayout(anchor, head)
    if (!parent && started) launchSpot = undefined
    change(p, {
      [`${id}.yaw`]: Math.round(gaze.yaw), [`${id}.pitch`]: Math.round(clamp(gaze.pitch, MONITOR_SPEC.pitch)),
      // (at most 120 degrees wide: a file chooser as large as the screen, over a small window, would go round the viewer)
      ...parent ? { [`${id}.dist`]: p[`${over}.dist`], [`${id}.curve`]: p[`${over}.curve`], [`${id}.span`]: Math.round(Math.min(120, clamp(p[`${over}.span`] * crop[2] / parent.crop[2], MONITOR_SPEC.span))) }
        : { [`${id}.dist`]: p.windowDist, [`${id}.span`]: Math.round(Math.min(120, clamp(crop[2] / perDegree * 1.5 / WIDTH_AT, MONITOR_SPEC.span))) },
    })
  }
  // A window just resized from the headset: its panel takes the size the PC really gave it (an application has a
  // smallest size, some dialogs keep theirs), for 2 s or until that is the size asked for. (Settings come here only
  // when they change, so a size reported meanwhile, the one asked for just before, is soon followed by the last.)
  const fit = fitting && Date.now() - fitting.at < 2000 && p.monitors.find(m => m.id === fitting.id && m.source === fitting.source)
  if (fit) {
    const [, , w, h] = fit.crop, { span, yaw, pitch } = resizeWindow(fitting.from, fitting.edge, null, WIDTH_AT, { w, h })
    const values = { [`${fit.id}.span`]: Math.round(span * 10) / 10, [`${fit.id}.yaw`]: Math.round(yaw), [`${fit.id}.pitch`]: Math.round(pitch) }
    if (Object.entries(values).some(([key, value]) => p[key] !== value)) change(p, values)
    if (w === fitting.w && h === fitting.h) fitting = undefined
  }
  monitorIds = ids
  if (recenterSeen !== undefined && p.recenter !== recenterSeen) centring = 'gaze'
  recenterSeen = p.recenter
  byKeys(p)
  arrange(p)
  settings = p
  if (GLASSES) {
    // their eyes are set up in every frame, from the window's size (see the drawing loop)
  } else if (SPECTATOR) { // a plain camera: the screen is as wide as the wanted view at this distance; the rest stays zero
    uniforms.uLensDist.value = p.screenW / 2 / Math.tan(SPECTATOR_FOV / 2)
  } else {
    uniforms.uIpd.value = p.ipd
    uniforms.uLensDist.value = p.lensDist
    uniforms.uK1.value = p.k1
    uniforms.uK2.value = p.k2
    uniforms.uChroma.value = p.chroma / 100
    uniforms.uCenter.value.set(p.cx, p.cy)
  }
  setBackground(p.fullscreen && p.autoBlack ? 'black' : p.bg, p.bgBlur > 0) // dark around a film that fills a monitor
  cursorFrom(p.cursor)
  noteFrom(p.note)
  uniforms.uBgLook.value.set(p.bgDim / 100, p.bgBlur / 100 * 6)
  uniforms.uSharp.value.set(1 - 0.4 * p.sharpen / 100, 1.2 * p.sharpen / 100)
  uniforms.uGlowColor.value.set(p.glowColor) // and a second colour, a sixth of the way round the colour wheel, to drift to
  uniforms.uGlowColor2.value.copy(uniforms.uGlowColor.value).offsetHSL(0.17, 0, 0.08)
  startStreams()
})

const Y = new THREE.Vector3(0, 1, 0), forward = new THREE.Vector3(), rotation = new THREE.Quaternion(), matrix = new THREE.Matrix4()
const toMatrix3 = (target, q) => target.setFromMatrix4(matrix.makeRotationFromQuaternion(q))
const sensorNote = document.getElementById('sensor')
let frameAt = 0
const appeared = {}, spans = [], aspects = [] // when each panel first showed (it fades in); from the last frame: degrees across (0: hidden), height / width
renderer.setAnimationLoop(now => {
  if (!settings || (SPECTATOR && now - frameAt < 30)) return // the spectator: 30 frames a second are enough, and the graphics card also encodes for the headset
  const dt = Math.min(0.1, (now - frameAt) / 1000)
  // The spectator glides toward the headset's direction, the same over time whatever the frame rate, a quarter of a
  // second behind: the phone's readings come over Wi-Fi in bursts, and a head-worn view shakes on a flat screen.
  if (SPECTATOR || GLASSES) head.slerp(poseTarget, 1 - Math.exp(-Math.min(now - frameAt, 100) / (GLASSES ? 40 : 250))) // glasses: worn, any lag is felt
  if (!SPECTATOR && centring) Object.assign(anchor, gazeOf(head))
  frameAt = now
  if (centring === 'heading') anchor.pitch = 0
  centring = null
  // The panorama keeps its horizon; it turns with the heading of the anchor and with the user's own offset.
  toMatrix3(uniforms.uToBg.value, rotation.setFromAxisAngle(Y, settings.bgYaw * DEG - anchor.yaw).multiply(head))
  uniforms.uTime.value = now / 1000
  uniforms.uArrowPx.value = 2 * pxPerDegree(settings) / DEG // one of the arrow's pixels on one of the screen's
  uniforms.uSheetsAt.value = settings.windowDist
  const gaze = gazeOf(head)
  toMatrix3(uniforms.uToYaw.value, rotation.setFromAxisAngle(Y, -gaze.yaw).multiply(head)) // what stays below and above wherever one looks
  if (held) { // the panel in hand goes where the head looks (taken with the phone's mouse: where its pointer is), keeping the offset it was taken with
    const to = held.mouse ? pointerInLayout() : gazeInLayout(anchor, head)
    held.yaw = ((to.yaw + held.dYaw + 540) % 360) - 180
    held.pitch = clamp(to.pitch + held.dPitch, MONITOR_SPEC.pitch)
    // ...and is drawn to its neighbours, as they were in the last frame
    const others = settings.monitors.map((m, i) => ({ i, yaw: settings[`${m.id}.yaw`], pitch: settings[`${m.id}.pitch`], w: spans[i], h: spans[i] * aspects[i] }))
      .filter(o => o.i !== held.i && o.w > 0)
    held.snap = snapPanel({ yaw: held.yaw, pitch: held.pitch, w: spans[held.i] ?? 0, h: (spans[held.i] ?? 0) * (aspects[held.i] ?? 0.6) }, others)
    held.snapTo = others[held.snap.to]?.i
  }
  if (resizing) resize(now)
  looked = -1
  pointed = { i: -1 }
  rayDir.copy(aim())
  settings.monitors.forEach((m, i) => {
    const { id, crop } = m
    const mine = SPECTATOR ? (moving?.i === i ? moving : null) : held?.i === i ? held.snap ?? held : resizing?.i === i ? resizing : null // where the panel in hand, or being resized, is drawn (the spectator: as the phone has it)
    const sized = SPECTATOR ? (moving?.i === i && moving.span ? moving : null) : resizing?.i === i ? { span: resizing.span, aspect: resizing.h / resizing.w } : null
    monitorFrame(anchor, mine ? mine.yaw : settings[`${id}.yaw`], mine ? mine.pitch : settings[`${id}.pitch`], rotation).invert().multiply(head)
    toMatrix3(uniforms.uToMonitor.value[i], rotation)
    const { videoWidth, videoHeight } = screens[i].video
    // A panel that has just come fades in, growing a little.
    const shown = Math.min(1, (now - (appeared[`${id}:${m.source ?? ''}`] ??= now)) / 300), grow = shown * shown * (3 - 2 * shown)
    uniforms.uLook.value[i].y = grow
    uniforms.uLook.value[i].z = screens[i].video.readyState < 2 ? 1 : 0 // HAVE_CURRENT_DATA: a frame to show
    // "Hide all monitors" leaves single windows (crop) in place: that is how to work with windows alone.
    // (self: the monitor that shows the picture of a headset on a cable; a picture of itself would be a tunnel of mirrors)
    const span = (settings.hideMonitors && !crop) || settings[`${id}.hidden`] || m.self ? 0 : (sized ? sized.span : zoomed(id, now) ?? settings[`${id}.span`]) * DEG * (0.9 + 0.1 * grow)
    const aspect = sized ? sized.aspect : crop ? crop[3] / crop[2] : videoWidth ? videoHeight / videoWidth : 9 / 16
    spans[i] = span / DEG * WIDTH_AT / settings[`${id}.dist`]
    aspects[i] = aspect
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
    // Out of view: farther from the centre of the view than an eye sees (about 60 degrees to its corners), plus half the
    // panel's diagonal and room for its glow and menus. Phones get hot in a headset, and a hot iPhone slows down.
    // (Not on the PC: a recording may be asked for a wider view than an eye's.)
    const seen = span > 0 && (SPECTATOR || Math.acos(Math.max(-1, Math.min(1, -ahead.z))) / DEG < 65 + Math.hypot(spans[i], spans[i] * aspect) / 2 + 12)
    uniforms.uSize.value[i].x = seen ? span : 0
    screens[i].seen = seen
    uniforms.uMonitor.value[i] = seen ? screens[i].texture : blankTexture
    const u = 0.5 + Math.atan2(ahead.x, -ahead.z) / (2 * halfWidth), v = 0.5 - Math.asin(ahead.y) / (2 * halfWidth * aspect)
    const [x0, y0, x1, y1] = crop ? reach(m).map((d, k) => d / crop[2 + k % 2]) : [0, 0, 1, 1] // a window with its open menus
    // The panels come in the order they are drawn: of those under the centre of the view, the last is on top.
    if (span && u >= x0 && u <= x1 && v >= y0 && v <= y1) looked = i
    if ((!settings.edit && !GLASSES) || !span) return
    // While arranging (and on a cable always): the panel under our pointer, and whether that is at a side or corner of a window (1.5 degrees deep).
    const ray = rayHere.copy(rayDir).applyQuaternion(rotation)
    const pu = 0.5 + Math.atan2(ray.x, -ray.z) / (2 * halfWidth), pv = 0.5 - Math.asin(ray.y) / (2 * halfWidth * aspect)
    if (pu < 0 || pu > 1 || pv < 0 || pv > 1) return
    const bu = Math.min(0.2, 1.5 / spans[i]), bv = Math.min(0.2, 1.5 / (spans[i] * aspect))
    const edge = [+(pu < bu), +(pu > 1 - bu), +(pv < bv), +(pv > 1 - bv)]
    pointed = { i, u: pu, v: pv, edge: crop && edge.some(Boolean) ? edge : null }
  })
  glow()
  showArranging()
  point(dt)
  // Below while arranging, the backgrounds; above, always, the clock. They come as the head turns to them.
  const look = gaze.pitch / DEG, ease = f => f * f * (3 - 2 * f)
  pick.fade = Math.max(0, Math.min(1, pick.fade + ((settings.edit && tapped && look < PICK.below) ? dt : -dt) / 0.25))
  clock.fade = Math.max(0, Math.min(1, clock.fade + (tapped && look > 35 ? dt : -dt) / 0.25))
  if (pick.fade > 0) showPick()
  if (clock.fade > 0) showClock()
  note.fade = Math.max(0, Math.min(1, note.fade + (now < note.until ? dt / 0.25 : -dt / 0.5)))
  uniforms.uNoteOn.value = ease(note.fade)
  uniforms.uNotePlace.value.set(noteCanvas.width / (NOTE.across * DEG) * sheetScale(), NOTE.height * DEG, noteCanvas.width / 2, noteCanvas.height / 2)
  uniforms.uPickOn.value = ease(pick.fade)
  uniforms.uClockOn.value = ease(clock.fade)
  if (!SPECTATOR) { // the spectator must not open the PC's own webcam (a headset on a cable takes it for its own)
    // `lowest` is how low the camera picture would reach at this tilt of the head. The camera is opened 5 degrees
    // before that reaches the look-down window, to be ready in time, and closed 2 s after it is 8 degrees clear.
    const aspect = phoneCam?.video?.videoWidth ? phoneCam.video.videoHeight / phoneCam.video.videoWidth : 0.5625
    const lowest = (gazeOf(head).pitch - Math.atan(Math.tan(settings.camFov * DEG / 2) * aspect)) / DEG
    const wanted = settings.passthrough || (settings.camBelow > 0 && !settings.edit && lowest < -settings.camBelow + (phoneCam?.track ? 8 : 5)) // arranging: the backgrounds are there instead
    if (wanted) {
      unseenSince = undefined
      openCamera()
    } else if (phoneCam?.track && !settings.camKeep && Date.now() - (unseenSince ??= Date.now()) > 2000) closeCamera() // camKeep: no closing, so no new permission question
  }
  const shown = (settings.passthrough || (settings.camBelow > 0 && !settings.edit)) && phoneCam?.video?.videoWidth ? phoneCam : null
  const tan = shown ? Math.tan(settings.camFov * DEG / 2) : 0
  uniforms.uCamBelow.value = settings.passthrough ? 2 : Math.sin(-settings.camBelow * DEG)
  uniforms.uCamShift.value.set(Math.tan(settings.camShiftX * DEG), Math.tan(settings.camShiftY * DEG))
  uniforms.uCam.value = shown?.texture ?? null
  uniforms.uCamTan.value.set(tan, shown ? tan * shown.video.videoHeight / shown.video.videoWidth : 0)
  const canvas = renderer.domElement
  uniforms.uRes.value.set(canvas.width, canvas.height)
  uniforms.uPxPerMm.value = canvas.width / settings.screenW
  if (GLASSES) { // a plain camera for each eye, on its half of the window
    const eye = canvas.width / 2, half = Math.tan(settings.glassesFov * DEG / 2) / Math.hypot(1, canvas.height / eye) // the tangent of half the width, from the diagonal
    // The shader's lengths ("mm") are here such that the middles of the two halves are ipd apart.
    uniforms.uIpd.value = settings.ipd
    uniforms.uPxPerMm.value = eye / settings.ipd
    uniforms.uLensDist.value = settings.ipd / 2 / half
  }
  sensorNote.hidden = !sensorOnly()
  if (!sensorOnly()) renderer.render(scene, camera) // a phone that is only the sensor draws nothing: it lies in a pocket and must not get hot
})

// --- working a single window from the headset with a mouse connected to the phone. The page cannot hold that mouse
// (Safari has no pointer lock): the system's own pointer keeps moving over the phone screen and stops at its edges.
// So the place of that pointer on the screen stands for the place in the window the user is looking at, edge to
// edge. It is sent to the PC, which puts the real pointer there; the pointer seen in the sphere is drawn here, at
// once. Movements are sent no faster than they are answered, the newest place replacing one that still waits.
// The whole screen stands for the window, not each eye's half: with halves, the pointer crossing the middle of the
// phone jumped from one edge of the window to the other. So where the phone's pointer stops at the edge of its
// screen, ours stays at the edge of the window. Windows are moved and resized in the arranging mode (see below).
// Only not quite edge to edge from top to bottom: the phone keeps the top and bottom of its screen for its own
// gestures, and its pointer stops short of them (a window's top bar, with its close button, was out of reach).
const mouse = { x: 0.5, y: 0.5 } // where the system's pointer is on the phone screen, 0..1 from the top left
const ROOM = 0.08 // the top and the bottom of the phone screen left out, of its height (as the frame around windows once was)
let orders = [], sendingOrders = false, pointedAt, pressedIn, wheelRest = 0, clickedAt = 0
const working = () => tapped && !SPECTATOR && !sensorOnly() && !settings.edit
const windowLooked = () => working() && !GLASSES && settings.monitors[looked]?.window ? settings.monitors[looked] : undefined // (on a cable: inside it, see glassesPointer)
const only = (what, ...keys) => Object.keys(what).every(key => keys.includes(key))
function order(what) { // a movement replaces a movement that still waits; presses and the wheel are never dropped
  const last = orders.at(-1)
  if (last && last.to === what.to && only(what, 'to', 'x', 'y') && only(last, 'to', 'x', 'y')) orders[orders.length - 1] = what
  else orders.push(what)
}
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
  return { to: target.id, x: x0 + mouse.x * (x1 - x0), y: y0 + Math.min(1, Math.max(0, (mouse.y - ROOM) / (1 - 2 * ROOM))) * (y1 - y0) }
}
// The view ray through the phone's pointer, in head space: the shader's ray() for a place of one eye's picture,
// the whole width of the phone standing for the width of that picture. So it sweeps the view once, smoothly, as the
// pointer crosses the phone (the phone's own round pointer, seen by one eye at a time, is no longer where ours is).
const aimed = new THREE.Vector3(), aimTurn = new THREE.Quaternion(), FORWARD = new THREE.Vector3(0, 0, -1)
function aim() {
  if (GLASSES) {
    const [h, v] = glassesTan()
    return aimed.set((mouse.x - 0.5) * 2 * h, (0.5 - mouse.y) * 2 * v, -1).normalize()
  }
  const mm = settings.screenW / innerWidth
  const x = (mouse.x - 0.5) * innerWidth / 2 * mm / settings.lensDist, y = ((0.5 - mouse.y) * innerHeight * mm - settings.cy) / settings.lensDist
  const r2 = x * x + y * y, more = 1 + settings.k1 * r2 + settings.k2 * r2 * r2
  return aimed.set(x * more, y * more, -1).normalize()
}
// A headset on a cable: the tangents of half one eye's view across and up (glassesFov is its diagonal)
// Pixels of the screen per degree of view in the middle of an eye's view: the phone's screen behind its lens, or the
// flat screen of each of the glasses’ eyes (with the phone’s lens settings the glasses’ windows came 2.4 times too large)
function pxPerDegree(p) {
  return GLASSES ? renderer.domElement.width / 4 / glassesTan(p)[0] * DEG : renderer.domElement.width / p.screenW * p.lensDist * DEG
}
// The list, the backgrounds, the clock and a notification are laid out in degrees for a phone in a Gear VR, about 96
// degrees across one eye's view. A headset on a cable shows them taking the same share of its own view (in degrees
// they were wider than the whole view of a monitor standing for one, 39 degrees: "very close to the face").
const PHONE_VIEW = 96
const sheetScale = () => GLASSES ? PHONE_VIEW / (2 * Math.atan(glassesTan()[0]) / DEG) : 1
function glassesTan(p = settings) {
  const eye = innerWidth / 2, across = Math.tan(p.glassesFov * DEG / 2) / Math.hypot(1, innerHeight / eye)
  return [across, across * innerHeight / eye]
}
const pointerInLayout = () => gazeInLayout(anchor, aimTurn.setFromUnitVectors(FORWARD, aim()).premultiply(head)) // as the gaze, for the pointer
function point(dt) { // every frame: the list of applications, or our pointer on the window looked at; and what is owed to the PC
  menu.fade = Math.max(0, Math.min(1, menu.fade + (menu.open ? dt : -dt) / 0.18)) // it comes and goes in a fifth of a second
  if (menu.open && !SPECTATOR && performance.now() - (menu.told ?? 0) > 1000) { // still open: else the extension lets the mouse go after 3 s
    menu.told = performance.now()
    setParams({ menuOpen: true })
  }
  uniforms.uMenuOn.value = menu.fade * menu.fade * (3 - 2 * menu.fade)
  if (menu.fade > 0) showMenu()
  if (GLASSES) return glassesPointer()
  const target = menu.open ? undefined : windowLooked()
  const at = target && place(target)
  if (SPECTATOR) { // where the phone has our pointer: its panel and place, sent with the head's direction
    uniforms.uPointer.value.copy(phonePointer)
    const crop = settings.monitors[phonePointer.x]?.crop
    if (crop) uniforms.uPointerPx.value.set(crop[2], crop[3])
  } else uniforms.uPointer.value.set(target ? looked : -1, at ? at.x / target.crop[2] : 0, at ? 1 - at.y / target.crop[3] : 0)
  // Our pointer as a dot in the view: over the list, and while arranging.
  uniforms.uRayOn.value = menu.open || settings.edit ? 1 : 0
  uniforms.uRay.value.copy(aim())
  if (target) {
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

// --- a headset on a cable: the PC's mouse. Over this window it is our pointer, drawn in the sphere at once, for the
// list, the arranging, the backgrounds and empty space. When it goes onto a monitor or a window (not while arranging
// or in the list), the extension is asked to put the real pointer there, at that place, and keeps it inside: the
// mouse and the keyboard then work there directly, and the extension tells where the pointer is, which is drawn
// here, at once (not in the picture, a tenth of a second late). Pushed past a side, it comes back here at that side
// (the panel's corners on this window go with the asking, and while inside).
let poseSeen = false, inside = null, askedAt = 0, asked = { text: '', at: 0 } // inside: { id: the panel, u, v } while the real pointer works in it
function glassesPointer() {
  uniforms.uRayOn.value = inside ? 0 : 1
  uniforms.uRay.value.copy(aim())
  const i = inside ? settings.monitors.findIndex(m => m.id === inside.id) : -1, m = settings.monitors[i]
  uniforms.uPointer.value.set(i, inside?.u ?? 0, 1 - (inside?.v ?? 0))
  if (m) uniforms.uPointerPx.value.set(...(m.crop ? m.crop.slice(2) : [screens[i].video.videoWidth || 1920, screens[i].video.videoHeight || 1080]))
  const over = inside ? i : !settings.edit && !menu.open ? pointed.i : -1, panel = settings.monitors[over], now = performance.now()
  if (!panel || now - askedAt < 50) return
  askedAt = now
  // inside: only the corners, u -1 (never taken for going in: the extension may have come out before we know it).
  // Sent when it changes, else every 0.3 s: the server forgets an ask after 0.4 s.
  const round = n => Math.round(n * 1e3) / 1e3
  const ask = { id: panel.id, source: panel.source ?? 0, connector: panel.connector ?? '', u: inside ? -1 : round(pointed.u), v: inside ? -1 : round(pointed.v), corners: panelCorners(over) }
  const text = JSON.stringify(ask)
  if (text === asked.text && now - asked.at < 300) return
  asked = { text, at: now }
  setParams({ enter: ask })
}
// Where the corners of panel i are on this window (top left, top right, bottom right, bottom left), as our pointer's
// place there (0..1 from the top left): a plain camera's view of the panel's surface, flat or bent.
const cornerTurn = new THREE.Quaternion(), headBack = new THREE.Quaternion(), corner = new THREE.Vector3()
function panelCorners(i) {
  const { id } = settings.monitors[i], away = settings[`${id}.dist`], bend = settings[`${id}.curve`] / 100
  const width = WIDTH_AT * settings[`${id}.span`] * DEG, height = width * aspects[i], [h, v] = glassesTan()
  monitorFrame(anchor, settings[`${id}.yaw`], settings[`${id}.pitch`], cornerTurn)
  headBack.copy(head).invert()
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const along = sx * width / 2, r = away / Math.max(bend, 1e-6)
    if (bend < 0.01) corner.set(along, sy * height / 2, -away)
    else corner.set(r * Math.sin(along / r), sy * height / 2, (r - away) - r * Math.cos(along / r))
    corner.applyQuaternion(cornerTurn).applyQuaternion(headBack)
    const ahead = Math.max(-corner.z, 1e-3) // behind the eyes: as far out as it goes
    return [0.5 + corner.x / ahead / (2 * h), 0.5 - corner.y / ahead / (2 * v)].map(n => Math.round(n * 1e3) / 1e3) // a tenth of a percent: the head's tremor does not count
  })
}
if (GLASSES) { // the head's turn and the real pointer inside a monitor or window, as the server has them
  const live = new EventSource('/live?glasses')
  live.addEventListener('pose', e => {
    poseTarget.fromArray(JSON.parse(e.data)) // the first four: the head
    if (poseSeen) return
    poseSeen = true
    head.copy(poseTarget)
    centring = 'heading' // the first reading: straight ahead is where the head looks now, level
  })
  live.addEventListener('pointer', e => {
    const told = JSON.parse(e.data)
    inside = told.out ? null : told
  })
}
// A press and the wheel carry the place they are meant for: the PC has one pointer, and it may have been moved by
// the PC's own mouse since our last movement.
function press(e, down) {
  if (!tapped || !settings || SPECTATOR || sensorOnly()) return
  clickedAt = performance.now()
  const left = e.pointerType !== 'mouse' || e.button === 0 // a drag with the button held reaches the page as a finger: the left button
  if (settings.edit) return editPress(e, down, left)
  if (menu.open) return menuPress(e, down, left)
  const target = down ? windowLooked() : pressedIn // a button is let go in the window it was pressed in, also when the gaze has left it
  if (down && !target) return void (!left && working() && openMenu()) // the right button on no window: the list of applications
  pressedIn = down ? target : undefined
  if (target) order({ ...place(target), button: e.pointerType === 'mouse' ? [272, 274, 273][e.button] ?? 272 : 272, down })
}
for (const type of ['pointerdown', 'pointerup', 'pointercancel']) addEventListener(type, e => press(e, type === 'pointerdown'))
addEventListener('contextmenu', e => tapped && e.preventDefault()) // the right button belongs to the window, or opens our list
addEventListener('wheel', e => {
  if (!tapped || !settings || SPECTATOR || sensorOnly() || menu.open) return // the list of applications is looked through by turning the head
  // The phone gives the wheel in pixels, 29 to a click on the iPhone, late and in bursts. For a window: clicks of
  // 25 px. For a panel's size while arranging: a degree for every 10 px, so that a burst is a glide and not a jump.
  const step = settings.edit ? 10 : 25
  wheelRest += e.deltaY
  let clicks = Math.trunc(wheelRest / step)
  if (!clicks) return
  wheelRest -= clicks * step
  if (GLASSES) clicks = -clicks // a PC's mouse: away from you is up, bigger, the page before
  // Signs: the iPhone reports the wheel as a finger pushing the page ("natural scrolling"), the other way than a PC.
  if (settings.edit) return editWheel(clicks)
  const target = windowLooked()
  if (target) order({ ...place(target), wheel: Math.max(-10, Math.min(10, -clicks)) })
}, { passive: true })

// --- the phone's keyboard (Bluetooth, or a receiver in its port): into the window that gets the PC's keyboard (lit
// with focusGlow), else into the one looked at, which the PC then brings to the front. Holding a key repeats it on
// the PC, as there, so the phone's repeats are not sent. Not Num Lock: on the PC it is the arranging mode, and in
// that mode no key is sent, so the phone could switch it on and not off again.
const keysDown = new Map() // code -> the window it went to, so that its release goes there too
addEventListener('keydown', e => {
  // F12 (the iPhone gives a page no Num Lock): the PC's Num Lock, the arranging mode, on and off. Also while arranging.
  if ((e.code === 'F12' || e.code === 'NumLock') && settings && tapped && !SPECTATOR && !GLASSES && !sensorOnly()) {
    e.preventDefault()
    if (!e.repeat) setParams({ numLock: Date.now() })
    return
  }
  const key = e.code !== 'NumLock' && KEYCODES[e.code], target = key && settings && working() && !GLASSES && (settings.monitors.find(m => m.window && m.focused) ?? windowLooked())
  if (!target) return
  e.preventDefault() // Space, Tab and the arrows would scroll the page or move its focus
  if (e.repeat || keysDown.has(e.code)) return
  keysDown.set(e.code, target.id)
  order({ to: target.id, key, down: true })
})
addEventListener('keyup', e => {
  const to = keysDown.get(e.code)
  if (!to) return
  keysDown.delete(e.code)
  order({ to, key: KEYCODES[e.code], down: false })
})
// Keys held as the page goes away (another app, the screen off) would stay pressed on the PC, Ctrl for ever: let go
// now, with what still waits, as a hidden page draws no frames (the drawing loop sends the orders).
function releaseKeys() {
  if (!keysDown.size) return
  const ups = [...keysDown].map(([code, to]) => ({ to, key: KEYCODES[code], down: false }))
  keysDown.clear()
  navigator.sendBeacon('/input', JSON.stringify([...orders.splice(0), ...ups]))
}
addEventListener('blur', releaseKeys)
document.addEventListener('visibilitychange', () => document.hidden && releaseKeys())

// --- arranging with the phone's mouse, while the arranging mode is on (Num Lock; the PC's mouse, which the extension
// catches then, works too: see arrange). A panel is taken anywhere with the left button and goes with the pointer
// and the head; it is drawn to its neighbours. A side or corner of a window changes the size of the window itself,
// on the PC; its panel grows with it, the text keeping its size. Below, looking down: the backgrounds.
let pointed = { i: -1 } // the panel under our pointer: { i, u, v (0..1 from its top left), edge: [left, right, top, bottom] or null }
let resizing            // { i, id, source, edge, from: { w, h, span, yaw, pitch, dist }, start: the pointer then, w, h, span, yaw, pitch, sent }
let fitting             // { id, source, edge, from, w, h, at }: a window let go after resizing (w, h: the size asked for; at: when)
const rayDir = new THREE.Vector3(), rayHere = new THREE.Vector3()
function editPress(e, down, left) {
  if (pick.fade > 0.5 && pickPress(down, left)) return
  if (!down) {
    if (e.type === 'pointercancel') return // the iPhone goes on with the same drag as a finger: its end puts the panel down
    pick.slider = null // also when the backgrounds went out of view while it was held
    if (held?.mouse) putDown()
    if (resizing) endResize()
    return
  }
  if (!left || pointed.i < 0 || held || resizing) return
  const m = settings.monitors[pointed.i], at = pointerInLayout(), here = { yaw: settings[`${m.id}.yaw`], pitch: settings[`${m.id}.pitch`] }
  if (pointed.edge) {
    const from = { w: m.crop[2], h: m.crop[3], span: settings[`${m.id}.span`], dist: settings[`${m.id}.dist`], ...here }
    fitting = undefined
    return void (resizing = { i: pointed.i, id: m.id, source: m.source, edge: pointed.edge, from, start: at, ...from, sent: { at: 0 } })
  }
  held = { i: pointed.i, mouse: true, dYaw: here.yaw - at.yaw, dPitch: here.pitch - at.pitch, ...here }
}
function resize(now) { // every frame while a side of a window is dragged; the PC is told the size eight times a second
  const at = pointerInLayout(), [left, right, top, bottom] = resizing.edge
  const moved = { yaw: ((at.yaw - resizing.start.yaw + 540) % 360) - 180, pitch: at.pitch - resizing.start.pitch }
  Object.assign(resizing, resizeWindow(resizing.from, { left, right, top, bottom }, moved, WIDTH_AT))
  if (now - resizing.sent.at > 120 && (resizing.w !== resizing.sent.w || resizing.h !== resizing.sent.h)) sendSize(now)
}
function sendSize(now) {
  const { id, w, h, edge } = resizing
  resizing.sent = { at: now, w, h }
  fetch('/resize', { method: 'POST', body: JSON.stringify({ to: id, w, h, edge }) }).catch(() => {})
}
function endResize(p = settings) {
  sendSize(performance.now())
  const { id, source, edge, from, w, h, span, yaw, pitch } = resizing
  change(p, { [`${id}.span`]: Math.round(span * 10) / 10, [`${id}.yaw`]: Math.round(yaw), [`${id}.pitch`]: Math.round(pitch) })
  const [left, right, top, bottom] = edge
  fitting = { id, source, edge: { left, right, top, bottom }, from, w, h, at: Date.now() }
  resizing = undefined
}
function editWheel(clicks) {
  if (pick.fade > 0.5) return pickWheel(clicks)
  const id = settings.monitors[pointed.i]?.id
  // Clicks of 10 px: a PC mouse's notch is about 120 px (6 % larger), the iPhone's click 29 (9 %)
  if (id) zoomPanel(settings, id, clicks * (GLASSES ? 0.005 : 0.03))
}
// A panel's size from the wheel: in proportion, so that a small window and a large monitor feel alike (a degree a
// click made a small window jump by half), and drawn growing to it over a moment instead of jumping there.
let zoom // { id, from, to, at }
const ZOOM_MS = 160
function zoomed(id, now) { // the size drawn meanwhile, or undefined
  if (zoom?.id !== id || now - zoom.at >= ZOOM_MS) return
  const f = (now - zoom.at) / ZOOM_MS
  return zoom.from + (zoom.to - zoom.from) * f * f * (3 - 2 * f)
}
function zoomPanel(p, id, by) { // by: how much larger, as a logarithm (0.06: 6 %)
  const now = performance.now(), to = Math.round(clamp(p[`${id}.span`] * Math.exp(by), MONITOR_SPEC.span) * 100) / 100
  zoom = { id, from: zoomed(id, now) ?? p[`${id}.span`], to, at: now }
  change(p, { [`${id}.span`]: to })
}
// Which panels glow, and how: the one being carried or resized, the one under the pointer (at a side: that side),
// the neighbour a carried panel is drawn to, and the window that gets the keyboard (if the setting is on).
const ALL = [1, 1, 1, 1]
function glow() {
  settings.monitors.forEach((m, i) => {
    let [sides, strength] = settings.focusGlow && m.focused ? [ALL, 0.7] : [null, 0]
    const busy = held || resizing
    if (!settings.edit || pick.fade > 0.5) {
      // only the keyboard's window
    } else if (resizing?.i === i) [sides, strength] = [resizing.edge, 1]
    else if (held?.i === i) [sides, strength] = [ALL, 1]
    else if (held && held.snapTo === i) [sides, strength] = [ALL, 0.45]
    else if (!busy && pointed.i === i) [sides, strength] = [pointed.edge ?? ALL, pointed.edge ? 1 : 0.55]
    else if (!busy && pointed.i < 0 && looked === i) [sides, strength] = [ALL, 0.35] // the PC's mouse takes what the gaze is on
    uniforms.uGlow.value[i].set(...(sides ?? [0, 0, 0, 0]))
    uniforms.uLook.value[i].x = strength
  })
}

// --- the list of the PC's applications, called up in the sphere with the right button while no window is looked at:
// a ribbon of icons, four in a column, hung in the room level with the eyes, always in the same place: its middle
// ahead of the centre of the layout (where one looks sitting straight), wherever one looked when calling it, so that
// the head can turn as far to either side. Everything else is darkened. In its middle is the user's own field of 4 x 4 places, its icons half as large again
// and a wider gap around it; the other applications are to its left and right in name order. Turning the head shows
// the rest; nothing scrolls (the iPhone gives the wheel late and in bursts). A click starts an application, and its
// window opens where the user looked before calling the list. An icon held with the left button and moved is
// carried: let go on a place of the field, it stays there; let go beside the field, it leaves it. Any other click
// closes the list.
// The sheet is laid out in pixels. cell: an icon's place; big: how much larger the field's are; gap: around the
// field; column: the degrees one cell takes in the view, at most.
const MENU = { rows: 4, field: 4, cell: [180, 200], big: 1.5, gap: 110, column: 9 }
const FIELD = MENU.field * MENU.rows // its places, numbered by rows: 0 1 2 3 / 4 5 6 7 / ...
const menu = { open: false, fade: 0, names: [], ids: [], icons: new Map(), drawn: '', at: 0, yaw: 0, spot: null, press: null, drag: -1, layout: null }
let launchSpot // { yaw, pitch, at }: where the user looked before calling the list, for the window of what was started from it
const menuTurn = new THREE.Quaternion() // head space -> the frame the ribbon hangs in: level, -Z at the middle of the field
function openMenu() {
  setParams({ menuOpen: true }) // the extension holds the PC's mouse for it while it is open (Super key)
  Object.assign(menu, { open: true, yaw: anchor.yaw, spot: gazeInLayout(anchor, head), press: null, drag: -1 })
  loadApps()
}
function loadApps() {
  fetch('/apps').then(answer => answer.json()).then(list => { // every time: applications get installed
    const names = list.map(app => app.name)
    if (names.join() !== menu.names.join()) Object.assign(menu, { names, ids: list.map(app => app.id), icons: new Map(), drawn: '' })
  }).catch(() => {})
}
// cells: the application in each place of the ribbon, column after column (-1: none); left: the columns before the
// field; pins: GNOME's id of the application in each place of the field (the setting "menuPins", kept on the PC).
// items: every place on the sheet: { n: the application (-1: none), k: its place in the field (-1: not there), x, y, w,
// h in px }; W, H: the sheet; field: where the field starts and ends across; mid: its middle; scale: px per radian;
// pins: GNOME's id of the application in each place of the field (the setting "menuPins", kept on the PC).
function menuLayout() {
  const pins = Array.from({ length: FIELD }, (_, k) => settings.menuPins?.[k] ?? null)
  const field = pins.map(id => menu.ids.indexOf(id)) // -1: a free place, or an application that is no longer installed
  const rest = menu.names.map((_, n) => n).filter(n => !field.includes(n))
  const [w, h] = MENU.cell, fw = w * MENU.big, fh = h * MENU.big, H = MENU.rows * fh, top = (H - MENU.rows * h) / 2 // the ribbon in the middle of the field's height
  const left = Math.ceil(Math.ceil(rest.length / MENU.rows) / 2), fieldX = left * w + MENU.gap, rightX = fieldX + MENU.field * fw + MENU.gap
  const items = [
    ...rest.map((n, i) => {
      const right = i >= left * MENU.rows, j = right ? i - left * MENU.rows : i
      return { n, k: -1, x: (right ? rightX : 0) + Math.floor(j / MENU.rows) * w, y: top + (j % MENU.rows) * h, w, h }
    }),
    ...field.map((n, k) => ({ n, k, x: fieldX + (k % MENU.field) * fw, y: Math.floor(k / MENU.field) * fh, w: fw, h: fh })),
  ]
  const W = Math.max(rightX - MENU.gap, ...items.map(i => i.x + i.w))
  // a very long list is drawn smaller: it must not close into a ring
  return { pins, items, W, H, field: [fieldX, rightX - MENU.gap], mid: fieldX + MENU.field * fw / 2, scale: Math.max(w / (MENU.column * DEG) * sheetScale(), W / (300 * DEG)) }
}
// Where the pointer is on the sheet (px), the place there (item), its application (n, -1: none) and place of the field (k, -1: beside it).
function menuSpot() {
  const { items, H, mid, scale } = menu.layout, d = aim().applyQuaternion(menuTurn)
  const x = Math.atan2(d.x, -d.z) * scale + mid, y = H / 2 - Math.asin(Math.max(-1, Math.min(1, d.y))) * scale
  const item = items.find(i => x >= i.x && x < i.x + i.w && y >= i.y && y < i.y + i.h)
  return { x, y, item, n: item?.n ?? -1, k: item?.k ?? -1 }
}
function showMenu() { // every frame while the list shows: where it hangs, what the pointer is on, the icon in hand
  menu.layout = menuLayout()
  drawMenu()
  toMatrix3(uniforms.uToMenu.value, menuTurn.setFromAxisAngle(Y, -menu.yaw).multiply(head))
  const { W, H, mid, scale, items } = menu.layout, spot = menuSpot()
  if (menu.press && menu.drag < 0 && Math.hypot(spot.x - menu.press.x, spot.y - menu.press.y) > 30) menu.drag = menu.press.n
  uniforms.uMenuPlace.value.set(scale, 0, mid, H / 2)
  uniforms.uMenuSize.value.set(W, H)
  // lit: the application under the pointer; while one is carried, the place of the field it would go to
  const lit = menu.open && (menu.drag < 0 ? spot.n >= 0 : spot.k >= 0) ? spot.item : null
  uniforms.uMenuLit.value.set(...(lit ? [lit.x + 8, lit.y + 8, lit.x + lit.w - 8, lit.y + lit.h - 8] : [0, 0, -1, -1]))
  const from = menu.drag >= 0 && items.find(i => i.n === menu.drag)
  uniforms.uMenuDrag.value.set(...(from ? [from.x, from.y, from.x + from.w, from.y + from.h] : [-1, 0, 0, 0]))
  uniforms.uMenuAt.value.set(spot.x, spot.y)
}
function closeMenu() {
  setParams({ menuOpen: false })
  Object.assign(menu, { open: false, press: null, drag: -1 })
}
// The Super key in the headset (the extension, instead of GNOME's overview) opens and closes the list: the PC's
// mouse is held for it meanwhile, its left button arriving as `grab` (as in the arranging mode).
let menuCallSeen, grabSeen
function byKeys(p) {
  if (SPECTATOR || sensorOnly()) return // the spectator shows the phone's list; a phone that only senses has none
  if (menuCallSeen !== undefined && p.menuCall !== menuCallSeen) {
    if (menu.open) closeMenu()
    else if (!p.edit && tapped) {
      if (!GLASSES) Object.assign(mouse, { x: 0.5, y: 0.5 }) // our pointer in the middle of the view: the gaze points (on a cable the mouse does)
      openMenu()
    }
  }
  menuCallSeen = p.menuCall
  // The PC's left button does what the phone mouse's does, with our pointer in the middle of the view, so the gaze
  // points. Arranging: a panel is carried, a side or corner of a window resizes the window, the backgrounds below are
  // chosen and their sliders moved. The list: what is looked at is started, or carried into the field.
  if (grabSeen !== undefined && p.grab !== grabSeen && (p.edit || menu.open)) {
    Object.assign(mouse, { x: 0.5, y: 0.5 })
    if (p.edit) editPress({ type: 'grab' }, p.grab, true)
    else menuPress({ type: 'grab' }, p.grab, true)
  }
  grabSeen = p.grab
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
  return lines.map(line => fitLine(c, line, width))
}
function fitLine(c, line, width) { // cut short with an ellipsis where it does not fit
  while (c.measureText(line).width > width && line.length > 2) line = line.slice(0, -2) + '…'
  return line
}
function drawMenu() { // the whole sheet, drawn again only when the list, the field or an icon has changed
  const { items, W, H, field } = menu.layout
  const state = [menu.names.length, items.map(i => i.n).join(), [...menu.icons.values()].filter(icon => icon.ready).length].join()
  if (state === menu.drawn || performance.now() - menu.at < 150) return // icons arrive in a burst: not a new sheet for each
  Object.assign(menu, { drawn: state, at: performance.now() })
  const fit = Math.min(1, 4096 / W) // a texture wider than 4096 px is not safe everywhere: a very long list is drawn coarser
  if (menuCanvas.width !== Math.round(W * fit) || menuCanvas.height !== Math.round(H * fit)) {
    Object.assign(menuCanvas, { width: Math.round(W * fit), height: Math.round(H * fit) })
    menuTexture.dispose() // another size: the copy on the graphics card cannot be written over
  }
  const c = menuCanvas.getContext('2d')
  c.setTransform(fit, 0, 0, fit, 0, 0)
  c.clearRect(0, 0, W, H) // no sheet of its own: the shader darkens the whole view
  c.fillStyle = 'rgba(255, 255, 255, 0.07)' // the field: a lighter ground
  c.beginPath()
  c.roundRect(field[0] - 30, 0, field[1] - field[0] + 60, H, 44)
  c.fill()
  const empty = items.every(i => i.k < 0 || i.n < 0)
  Object.assign(c, { textAlign: 'center', textBaseline: 'top', lineWidth: 3 })
  for (const item of items) {
    const k = item.w / MENU.cell[0], size = 104 * k, x = item.x + (item.w - size) / 2, y = item.y + 14 * k
    if (item.n < 0) {
      if (item.k < 0 || empty) continue
      c.setLineDash([10, 8]) // a free place of the field
      c.strokeStyle = 'rgba(255, 255, 255, 0.3)'
      c.beginPath()
      c.roundRect(x, y, size, size, 16 * k)
      c.stroke()
      c.setLineDash([])
      continue
    }
    let icon = menu.icons.get(item.n)
    if (!icon) { // asked for once; the sheet is drawn again when it has arrived
      icon = new Image()
      icon.onload = () => { icon.ready = true }
      icon.src = `/appicon/${item.n}`
      menu.icons.set(item.n, icon)
    }
    if (icon.ready) c.drawImage(icon, x, y, size, size)
    c.fillStyle = '#fff'
    c.font = `600 ${24 * k}px system-ui, sans-serif`
    twoLines(c, menu.names[item.n], item.w - 16 * k).forEach((line, j) => c.fillText(line, item.x + item.w / 2, item.y + 128 * k + j * 30 * k))
  }
  const words = !menu.names.length ? ['Список загружается…'] : empty ? ['Перетащите сюда', 'свои программы'] : []
  Object.assign(c, { fillStyle: '#c8d4e0', font: '500 40px system-ui, sans-serif' })
  words.forEach((line, i) => c.fillText(line, (field[0] + field[1]) / 2, H / 2 - 52 + i * 56))
  menuTexture.needsUpdate = true
}

// --- the backgrounds, below while arranging: round pictures, 4 x 2 a page (the wheel turns the pages), and the
// darkening and blur of the background. Where the phone camera shows otherwise; it is off in this mode.
const PICK = { cols: 4, rows: 2, height: -36, across: 50, below: -20 } // the height of its middle and its width; below: it comes when one looks lower than this (degrees)
const pick = { fade: 0, list: [], page: 0, thumbs: new Map(), drawn: '', slider: null, items: [], asked: 0 }
const yawTurn = new THREE.Quaternion()
function pickLayout() { // the places on the sheet: the backgrounds of this page, the two sliders
  const pages = Math.max(1, Math.ceil(pick.list.length / (PICK.cols * PICK.rows)))
  pick.page = Math.min(pick.page, pages - 1)
  const per = PICK.cols * PICK.rows, cellW = 280, cellH = 220, x0 = (pickCanvas.width - PICK.cols * cellW) / 2
  pick.items = [
    ...pick.list.slice(pick.page * per, pick.page * per + per).map((file, i) =>
      ({ kind: 'bg', file, x: x0 + (i % PICK.cols) * cellW + (cellW - 190) / 2, y: 84 + Math.floor(i / PICK.cols) * cellH, w: 190, h: 190 })),
    ...['bgDim', 'bgBlur'].map((key, i) => ({ kind: 'slider', key, x: 80 + i * 560, y: 560, w: 480, h: 50 })),
  ]
  return pages
}
function pickSpot() { // where our pointer is on the sheet (px) and what is there; null off the sheet
  const { width: W, height: H } = pickCanvas, scale = W / (PICK.across * DEG) * sheetScale()
  const d = rayHere.copy(aim()).applyQuaternion(yawTurn.setFromAxisAngle(Y, -gazeOf(head).yaw).multiply(head))
  const x = Math.atan2(d.x, -d.z) * scale + W / 2, y = H / 2 - (Math.asin(Math.max(-1, Math.min(1, d.y))) - PICK.height * DEG) * scale
  if (x < 0 || y < 0 || x > W || y > H) return null
  return { x, item: pick.items.find(i => x >= i.x && x < i.x + i.w && y >= i.y - 20 && y < i.y + i.h + 20) }
}
function setSlider({ key, x: x0, w }, x) {
  const [, min, max, step] = LAYOUT_SPEC[key], value = Math.round((min + Math.max(0, Math.min(1, (x - x0) / w)) * (max - min)) / step) * step
  if (value !== settings[key]) change(settings, { [key]: value })
}
function showPick() { // every frame while it shows
  if (!pick.list.length && performance.now() - pick.asked > 5000) {
    pick.asked = performance.now()
    fetch('/bgs').then(answer => answer.json()).then(list => { pick.list = list }).catch(() => {})
  }
  const pages = pickLayout(), spot = pickSpot()
  if (pick.slider && spot) setSlider(pick.slider, spot.x)
  drawPick(pages, spot?.item)
  const { width: W, height: H } = pickCanvas
  uniforms.uPickPlace.value.set(W / (PICK.across * DEG) * sheetScale(), PICK.height * DEG, W / 2, H / 2)
  uniforms.uPickSize.value.set(W, H)
}
function pickPress(down, left) { // whether the press was meant for the backgrounds
  if (!down) return pick.slider ? !(pick.slider = null) : false
  const spot = pickSpot()
  if (!spot) return false
  if (left && spot.item?.kind === 'bg') change(settings, { bg: spot.item.file })
  if (left && spot.item?.kind === 'slider') setSlider(pick.slider = spot.item, spot.x)
  return true
}
function pickWheel(clicks) {
  pick.page = Math.max(0, pick.page - Math.sign(clicks)) // pickLayout keeps it under the number of pages
}
function drawPick(pages, hovered) {
  const thumbs = [...pick.thumbs.values()].filter(t => t.ready).length
  const state = [pick.page, pages, pick.list.length, pick.items.indexOf(hovered), settings.bg, settings.bgDim, settings.bgBlur, settings.glowColor, thumbs].join()
  if (state === pick.drawn) return
  pick.drawn = state
  const c = pickCanvas.getContext('2d'), { width: W, height: H } = pickCanvas
  c.clearRect(0, 0, W, H)
  c.fillStyle = 'rgba(10, 14, 20, 0.82)'
  c.beginPath()
  c.roundRect(0, 0, W, H, 40)
  c.fill()
  Object.assign(c, { textAlign: 'center', textBaseline: 'middle', fillStyle: '#fff', font: '600 34px system-ui, sans-serif' })
  c.fillText(pages > 1 ? `Обои   ${pick.page + 1} / ${pages}   ·   колесо: листать` : 'Обои', W / 2, 44)
  for (const item of pick.items) {
    if (item.kind === 'bg') {
      const r = item.w / 2, cx = item.x + r, cy = item.y + r, name = item.file.replace(/^bg\//, '')
      let thumb = pick.thumbs.get(name)
      if (!thumb) {
        thumb = new Image()
        thumb.onload = () => { thumb.ready = true }
        thumb.src = `/thumb/${encodeURIComponent(name)}`
        pick.thumbs.set(name, thumb)
      }
      c.save()
      c.beginPath()
      c.arc(cx, cy, r, 0, 2 * Math.PI)
      c.clip()
      c.fillStyle = '#223'
      c.fillRect(item.x, item.y, item.w, item.h)
      if (thumb.ready) { // the middle of the panorama, filling the circle
        const s = Math.max(item.w / thumb.width, item.h / thumb.height)
        c.drawImage(thumb, cx - thumb.width * s / 2, cy - thumb.height * s / 2, thumb.width * s, thumb.height * s)
      }
      c.restore()
      const chosen = item.file === settings.bg
      if (chosen || item === hovered) {
        c.lineWidth = chosen ? 8 : 5
        c.strokeStyle = chosen ? settings.glowColor : 'rgba(255, 255, 255, 0.85)'
        c.beginPath()
        c.arc(cx, cy, r + 7, 0, 2 * Math.PI)
        c.stroke()
      }
    } else {
      const [, min, max] = LAYOUT_SPEC[item.key], value = settings[item.key], part = (value - min) / (max - min), mid = item.y + item.h / 2
      Object.assign(c, { textAlign: 'left', fillStyle: '#c8d4e0', font: '500 28px system-ui, sans-serif' })
      c.fillText(`${item.key === 'bgDim' ? 'Затемнение' : 'Размытие'}  ${value}%`, item.x, item.y - 14)
      c.fillStyle = 'rgba(255, 255, 255, 0.18)'
      c.beginPath()
      c.roundRect(item.x, mid - 6, item.w, 12, 6)
      c.fill()
      c.fillStyle = settings.glowColor
      c.beginPath()
      c.roundRect(item.x, mid - 6, item.w * part, 12, 6)
      c.fill()
      c.fillStyle = '#fff'
      c.beginPath()
      c.arc(item.x + item.w * part, mid, item === hovered || item === pick.slider ? 20 : 16, 0, 2 * Math.PI)
      c.fill()
    }
  }
  toSheets(pickCanvas, SHEETS.pick)
}

// --- a notification of the PC (GNOME's banner), shown for a few seconds above the middle of the view, fixed to the
// head: who is in the headset would not see it on the PC. As the PC shows banners: not in "Do Not Disturb".
const NOTE = { across: 40, height: 17, shown: 6000 } // its width and the height of its middle, degrees; ms on view
const note = { fade: 0, until: 0, seen: undefined }
function noteFrom(told) { // from the settings: [its number, application, title, body, whether it has an icon], or null
  const [n, app, title, body, icon] = told ?? []
  if (!n || n === note.seen) return
  note.seen = n
  note.until = performance.now() + NOTE.shown
  drawNote(app, title, body)
  if (!icon) return
  const image = new Image()
  image.onload = () => note.seen === n && drawNote(app, title, body, image)
  image.src = `/noteicon?${n}`
}
function drawNote(app, title, body, icon) {
  const c = noteCanvas.getContext('2d'), { width: W, height: H } = noteCanvas, x = icon ? 170 : 40, room = W - x - 40
  c.clearRect(0, 0, W, H)
  c.fillStyle = 'rgba(16, 20, 28, 0.92)'
  c.beginPath()
  c.roundRect(0, 0, W, H, 36)
  c.fill()
  if (icon) c.drawImage(icon, 36, (H - 108) / 2, 108, 108)
  Object.assign(c, { textAlign: 'left', textBaseline: 'top', fillStyle: '#9fb0c2', font: '500 26px system-ui, sans-serif' })
  c.fillText(fitLine(c, app, room), x, 26)
  Object.assign(c, { fillStyle: '#fff', font: '700 36px system-ui, sans-serif' })
  c.fillText(fitLine(c, title, room), x, 64)
  Object.assign(c, { fillStyle: '#d8e2ec', font: '400 30px system-ui, sans-serif' })
  twoLines(c, body.replace(/\s+/g, ' ').trim(), room).forEach((line, i) => line && c.fillText(line, x, 114 + i * 40))
  toSheets(noteCanvas, SHEETS.note)
}

// --- the clock, above wherever one looks: the time and, under it, the date. Drawn again when the minute changes.
const clock = { fade: 0, drawn: '' }
function showClock() {
  const now = new Date(), time = now.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  const { width: W, height: H } = clockCanvas
  if (time !== clock.drawn) {
    clock.drawn = time
    const c = clockCanvas.getContext('2d')
    c.clearRect(0, 0, W, H)
    c.fillStyle = 'rgba(10, 14, 20, 0.72)'
    c.beginPath()
    c.roundRect(0, 0, W, H, H / 2)
    c.fill()
    Object.assign(c, { textAlign: 'center', textBaseline: 'middle', fillStyle: '#fff', font: '600 112px system-ui, sans-serif' })
    c.fillText(time, W / 2, 92)
    Object.assign(c, { fillStyle: '#d8e2ec', font: '500 44px system-ui, sans-serif' })
    c.fillText(now.toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' }), W / 2, 178)
    toSheets(clockCanvas, SHEETS.clock)
  }
  uniforms.uClockPlace.value.set(W / (28 * DEG) * sheetScale(), 52 * DEG, W / 2, H / 2) // 28 degrees wide (on the phone), 52 up
  uniforms.uClockSize.value.set(W, H)
}

// --- the headset tells the spectator page where it looks
const pause = ms => new Promise(done => setTimeout(done, ms))
const poseTarget = new THREE.Quaternion(), phonePointer = new THREE.Vector3(-1, 0, 0)
let moving // the spectator: the panel the phone has in hand or resizes, { i, yaw, pitch, span (0: not resized), aspect }, or null
// The panel in hand or being resized, for the spectator (a headset on a cable shows the phone's view): its place,
// and while resized its width and shape. -1: none.
function movingNow() {
  const where = held ? held.snap ?? held : resizing
  if (!where) return [-1, 0, 0, 0, 0]
  return [held ? held.i : resizing.i, where.yaw, where.pitch, resizing && !held ? resizing.span : 0, resizing && !held ? resizing.h / resizing.w : 0]
}
async function sharePose() {
  for (;;) {
    const started = performance.now()
    try {
      if (SPECTATOR) {
        const sent = await (await fetch(GLASSES ? '/pose?glasses' : '/pose')).json() // the server: a headset on a cable is in use
        if (sent) {
          poseTarget.fromArray(sent)
          const [, , , , anchorYaw, anchorPitch, open, yaw, drag, x, y, p0, p1, p2, mi, myaw, mpitch, mspan, maspect] = sent
          const pointer = [p0, p1, p2]
          moving = mi >= 0 ? { i: mi, yaw: myaw, pitch: mpitch, span: mspan, aspect: maspect } : null
          Object.assign(anchor, { yaw: anchorYaw, pitch: anchorPitch })
          // The list of applications and our pointer, as the phone shows them: the spectator draws them the same way.
          if (open && !menu.names.length) loadApps()
          Object.assign(menu, { open: !!open, yaw, drag })
          Object.assign(mouse, { x, y })
          phonePointer.fromArray(pointer)
        }
      } else if (settings?.spectator && !document.hidden && !GLASSES) {
        // Only the page on screen: a second copy left open in Safari keeps running behind the home-screen one (it
        // plays sound), and its head, without sensors, stays where it started: the spectator jumped back to it.
        await fetch('/pose', { method: 'POST', body: JSON.stringify([...head.toArray(), anchor.yaw, anchor.pitch,
          menu.open ? 1 : 0, menu.yaw, menu.drag, mouse.x, mouse.y, ...uniforms.uPointer.value.toArray(), ...movingNow()]) })
      }
    } catch {} // the server is restarting: go on asking
    await pause(SPECTATOR || settings?.spectator ? Math.max(0, 33 - (performance.now() - started)) : 500) // 30 a second, however long the request took
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

// --- pictures from the PC as they are, for a headset on a cable: it is drawn on the PC itself, so nothing is
// compressed on the way. raw.py sends each monitor and window from a port of its own, picture after picture (width,
// height, time, pixels), always the latest. Each is read into the same memory and put on the graphics card at once.
// A panel out of view is not read, and then raw.py copies nothing either.
// Returns a function that stops the stream for good.
function receivePlain(screen, id) {
  const stopper = new AbortController(), gone = () => stopper.signal.aborted
  ;(async () => {
    let memory = new ArrayBuffer(1 << 16)
    while (!gone()) {
      try {
        const { port: first, key } = settings.raw ?? {} // given to pages on the PC only; a server started anew has a new key
        const port = first + (id[0] === 'w' ? 10 : 0) + Number(id.slice(1))
        const answer = await fetch(`http://127.0.0.1:${port}/?k=${key}`, { signal: stopper.signal })
        if (!answer.ok) throw new Error(answer.status)
        // Read into memory we give, where the browser can (Chromium): else it makes 900 MB of new buffers a second
        // for a monitor that changes all the time. Other browsers: their pieces are copied (`rest`: what is left of one).
        let reader, rest = new Uint8Array(0)
        try { reader = answer.body.getReader({ mode: 'byob' }) } catch { reader = answer.body.getReader() }
        const own = reader instanceof ReadableStreamBYOBReader
        const read = async length => {
          if (memory.byteLength < length) memory = new ArrayBuffer(length)
          for (let have = 0; have < length;) {
            if (!own && !rest.length) rest = (await reader.read()).value ?? rest
            const { value, done } = own ? await reader.read(new Uint8Array(memory, have, length - have), { min: length - have })
              : { value: rest.subarray(0, length - have), done: !rest.length }
            if (done) throw new Error('ended')
            if (own) memory = value.buffer // the reader takes the memory away and gives it back
            else { new Uint8Array(memory).set(value, have); rest = rest.subarray(value.length) }
            have += value.byteLength
          }
          return new Uint8Array(memory, 0, length)
        }
        for (;;) {
          const head = new DataView((await read(16)).buffer), width = head.getUint32(0, true), height = head.getUint32(4, true)
          const pixels = await read(width * height * 4)
          while (!screen.seen && !gone()) await pause(30)
          if (gone()) return
          if (screen.video.videoWidth !== width || screen.video.videoHeight !== height) { // a texture cannot change its size
            screen.texture.dispose()
            screen.texture = crisp(new THREE.DataTexture(pixels, width, height))
          } else screen.texture.image.data = pixels
          screen.texture.needsUpdate = true
          renderer.initTexture(screen.texture) // onto the graphics card now: the next picture goes into the same memory
          Object.assign(screen.video, { videoWidth: width, videoHeight: height, readyState: 4 })
        }
      } catch {
        await pause(400) // not there yet (a window has just opened, the capture is starting), or it ended: asked again
      }
    }
  })()
  return () => stopper.abort()
}

// --- start: browsers give sound, and iOS motion sensors, only after a tap
const sound = new Audio()
let tapped = false, soundOn = false
let keepCapture
function startStreams() { // called after the tap and after every change of settings: starts what is not running yet
  if (!tapped || !settings) return
  screens.forEach((screen, i) => {
    // No pictures for a phone that is only the sensor of a headset on a cable (it still plays the sound), and none of
    // the monitor that shows that headset's picture.
    if (sensorOnly() || settings.monitors[i].self) {
      screen.stop?.()
      screen.stop = null
    } else screen.stop ??= GLASSES ? receivePlain(screen, settings.monitors[i].id) : receive(settings.monitors[i].id, 'video', screen.video)
  })
  // MediaMTX runs the capture only while somebody takes "vr/m0" from it. On a cable that is a small black stand-in.
  if (GLASSES) keepCapture ??= receive('m0', 'video', hiddenVideo())
  if (!soundOn && !SPECTATOR && !GLASSES) receive('audio', 'audio', sound) // on the PC it would play the PC's sound back into itself
  soundOn = true
  if (settings.phoneMic && !SPECTATOR && !GLASSES) sendMic()
  else stopMic()
}

// --- the phone's microphone as the PC's, while the setting phoneMic is on: sent to MediaMTX (WHIP), whose mic.py
// plays it into the PC's microphone "VR-Headset". With echo cancellation: the phone plays the PC's sound meanwhile.
let mic // { pc, stream } while sent, { opening } meanwhile, { refused } when the phone said no, { failed: time }
async function sendMic() {
  if (mic && !(Date.now() - mic.failed > 3000)) return // sent, opening, refused (until the setting is switched off), or failed just now
  mic = { opening: true }
  let stream, pc
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch (e) {
    console.warn('microphone:', e.message)
    return void (mic = { refused: true })
  }
  try {
    if (!settings.phoneMic) throw new Error('switched off meanwhile')
    pc = new RTCPeerConnection()
    pc.addTransceiver(stream.getAudioTracks()[0], { direction: 'sendonly' })
    mic = { pc, stream }
    // Only when it has failed: "disconnected" often passes by itself within seconds, and closing then would take the
    // microphone away from the PC, and a call going on would move to another microphone and stay there.
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== 'failed' || mic?.pc !== pc) return
      stopMic()
      mic = { failed: Date.now() }
      setTimeout(startStreams, 4000) // again in a moment (the PC restarted, the Wi-Fi went)
    }
    await pc.setLocalDescription()
    await new Promise(done => { // no trickle: the offer carries our addresses (as in receive)
      pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && done()
      setTimeout(done, 500)
    })
    const answer = await fetch('/whip/mic', { method: 'POST', body: pc.localDescription.sdp, signal: AbortSignal.timeout(8000) })
    if (!answer.ok) throw new Error(await answer.text())
    await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() })
  } catch (e) {
    console.warn('microphone:', e.message)
    pc?.close()
    stream.getTracks().forEach(track => track.stop())
    mic = { failed: Date.now() }
    setTimeout(startStreams, 4000)
  }
}
function stopMic() {
  mic?.pc?.close()
  mic?.stream?.getTracks().forEach(track => track.stop())
  mic = undefined
}
const keepAwake = () => navigator.wakeLock?.request('screen').catch(() => {})
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && keepAwake())
const button = document.getElementById('start')
button.onclick = async () => {
  sound.play().catch(() => {}) // inside the tap: unlocks this element, so the stream that arrives later may play
  // Android: the whole screen and landscape at once, also in a browser tab (only inside the tap). An iPhone has no
  // such thing for a page; there the home screen icon gives the whole screen.
  if (!SPECTATOR && !GLASSES) document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).then(() => screen.orientation?.lock?.('landscape')).catch(() => {})
  const answer = GLASSES ? 'granted' : await (window.DeviceOrientationEvent?.requestPermission?.().catch(() => 'denied') ?? 'granted') // a PC has no motion sensors to ask for
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
if (GLASSES) button.click() // the glasses' picture has no sound or sensors to unlock: no tap to start
