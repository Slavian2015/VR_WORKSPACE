# VR Workspace

Your Linux desktop on a curved monitor inside a 360° scene, viewed on a phone in a VR headset.
The phone is only a display: keyboard and mouse stay on the PC and work as usual.

It shows the real monitors and adds virtual ones. Needs GNOME on Wayland. Built for an iPhone 15 Pro in a Gear VR.

## Setup, once

```bash
./setup.sh
```

It downloads MediaMTX, installs three.js, creates TLS certificates and an access key in `certs/`,
and makes phone-sized copies of the 360 images from `app/assets/` in `app/bg/`.
Run it again whenever the PC gets a new IP address (the certificate is tied to it).

Needs: GNOME on Wayland, Node 22+, GStreamer with VA-API (`vaapih264enc`, `vaapipostproc`, `pipewiresrc`), system Python with
GNOME bindings (`python3-gi`), ffmpeg, PipeWire (`pactl`), openssl.

## Run

```bash
npm start
```

- Settings on the PC: http://localhost:8080/control.html
- Preview on the PC: http://localhost:8080/ (drag to look around)
- Phone: the `https://...:8443/?k=...` link printed on start

The desktop is captured only while a viewer is connected.

## Sound

While the phone is connected, the PC has an extra audio output called **VR-Headset**.
Pick it once in the GNOME sound menu: everything played to it comes out of the phone.
The system remembers the choice, so next time the sound moves to the phone by itself when you connect,
and returns to the previous output about half a minute after you disconnect.

Loudness: the phone's volume buttons, or the PC volume while VR-Headset is the selected output.
Sound is not synchronised with the picture on purpose (that would delay the picture by ~70 ms); it trails slightly.

## iPhone, once

1. Open `http://<PC address>:8080/ca.crt` in Safari and allow the profile download.
2. Settings → General → VPN & Device Management → install the profile.
3. Settings → General → About → Certificate Trust Settings → enable "VR Workspace local CA".
4. Open the phone link in Safari, then Share → Add to Home Screen. Start it from the home screen: only then it is fullscreen.
5. Turn off the rotation lock, hold the phone in landscape, tap the screen once to allow motion sensors, put it in the headset.

Phone and PC must be on the same Wi-Fi (5 GHz). The PC firewall must allow TCP 8080, 8443 and UDP 8189.

## Control page

Everything is changed live from http://localhost:8080/control.html while you wear the headset (the page is visible
on the virtual monitor). The line at the top tells whether the phone is connected and receiving the changes.

- **Centre on gaze** — look where the middle of the layout should be and press the button (or Space while it has
  focus). The whole arrangement of monitors moves there, tilt included, so it also works lying down.
- **Monitors** — every monitor of the PC is a separate panel with its own direction (right/left, up/down), width and
  curve (100 % wraps it around you, 0 % makes it flat). Up to four are shown. Distance is common to all: closer
  monitors look bigger, as real ones do; the width in degrees is what a monitor takes up at 1.5 m.
- **Background** — a 360 photo or video and its rotation, or plain black. With the GNOME extension (see below) it
  turns black by itself while some window is fullscreen, for watching films.
- **Lens calibration** (folded at the bottom) — start with "lens distance" and "lens separation" until the two
  pictures merge without eye strain, then k1/k2 until straight lines of the desktop look straight at the edges.

Settings are saved in `params.json`. After an update of the code the pages reload themselves; the phone then asks for a tap again.
Changing the monitors does not reload anything.

## Monitors

While the phone is connected, GNOME has extra **virtual monitors** to the right of the real one: move windows and the
pointer there as on any monitor, arrange them in Settings → Displays. They disappear when the phone disconnects, and
their windows return to the real monitor.

Their number (0–3, one by default) and size (1920×1080 up to 3440×1440, the same for all) are set on the control
page; a change restarts the capture, the picture is back in about 10 s. Real monitors are read when the server
starts: restart it after plugging one in or out. The first picture appears about 5 s after the phone connects.

**The system arrangement follows the sphere.** Where you put a monitor in the sphere (right, left, above, below
its neighbour) is where GNOME puts it, so the pointer crosses from one to another the way you see them. It is
applied while the phone is connected and replaces what is set in Settings → Displays for that time. Moving a
monitor to another side blinks the real monitor's picture for a second.

Known limit: every time a virtual monitor is created and removed, GNOME Shell keeps 50–100 MB of video memory
until you log out (measured on GNOME 46). It adds up only after many reconnects in one session.

## Automatic black background (optional)

```bash
gnome-extension/install.sh
```

then log out and in. The small extension tells the server when a window is fullscreen (GNOME gives that
information only to extensions). The checkbox on the control page turns the behaviour off.

## Phone camera as the background (pass-through)

Tick "keep the phone camera on" on the control page before you put the headset on: the phone asks for permission
once. Then the button on the control page, or this command, switches the background between the panorama and
the camera:

```bash
curl -s -X POST http://localhost:8080/toggle/passthrough
```

To have it on a key: Settings → Keyboard → View and Customize Shortcuts → Custom Shortcuts → add one with that
command and, for example, Super+X.

The picture is fixed to the head, one camera for both eyes, and covers only what the camera sees; set "camera view
angle" so that things look their real size. The camera must have a free view out of the headset.

## Backgrounds

Any file in `app/bg/` appears in the control page: equirectangular photos, or a 360 video (`.mp4`, `.webm`, `.mov`).
`setup.sh` makes `video_test.mp4` there, a photo with slowly cycling colours, to try video backgrounds with.

## Security

Anyone on the network who has the link with the key can watch your desktop and change the settings.
The key is in `certs/token`; delete it and run `./setup.sh` to get a new one. Never commit `certs/`.

## How it works

```
GNOME screencast of each monitor → H.264 on the GPU → RTMP ┐
"VR-Headset" audio output → Opus → RTSP ───────────────────┴→ MediaMTX → WebRTC → phone (three.js shader, speakers)
```

- `capture.py` — asks GNOME for the monitor streams (creating the virtual monitors), runs one GStreamer encoder per
  monitor and ffmpeg for the sound, creates the virtual audio output.
- `mediamtx.yml` — MediaMTX settings; it starts `capture.py` when a viewer connects.
- `server.js` — static files, HTTPS, the WHEP handshake proxy, live settings, the list of monitors, starts MediaMTX.
- `app/main.js` — the phone page. One shader turns each pixel into a view ray through the lens,
  so stereo and lens correction are done in a single pass and text is sampled once.
- `npm test` — checks the head-orientation and layout maths and the low-memory rule of the capture.
