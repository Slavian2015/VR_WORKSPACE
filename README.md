# VR Workspace

Your Linux desktop on monitors inside a 360° scene, seen on a phone in a VR headset.
The phone is only a display: keyboard and mouse stay on the PC and work as usual.

It shows the real monitors and adds virtual ones. You run it from an icon in the GNOME top bar.
Built for an iPhone 15 Pro in a Gear VR shell and GNOME 46 on Wayland (Ubuntu 24.04).

## What you need

- GNOME 46 on Wayland (`echo $XDG_SESSION_TYPE` says `wayland`).
- Node 22 or newer, ffmpeg, openssl, curl.
- GStreamer with VA-API (`vaapih264enc`, `vaapipostproc`, `pipewiresrc`), PipeWire with `pactl`,
  system Python with GNOME bindings (`python3-gi`). An Ubuntu desktop has the last two already.
- Phone and PC on the same Wi-Fi (5 GHz). The PC firewall must allow TCP 8080, 8443 and UDP 8189.

## Install, once

```bash
./setup.sh
```

Then log out and in. A headset icon appears in the top bar.

The script downloads MediaMTX, installs three.js, creates TLS certificates and an access key in `certs/`, makes
phone-sized copies of the 360 images from `app/assets/` in `app/bg/` (the first time only), and puts two files into your profile: a link
to the GNOME extension and two systemd user services that start the server (only when you ask, not at login).
It is safe to run again; do so when the PC gets a new name on the network, and after updating the code.

## Use

1. Click the headset icon in the top bar and switch **VR Workspace** on.
2. Choose **Settings** in the same menu. The first page shows a QR code: point the iPhone camera at it and open the
   link. (The very first time, open "First time with this iPhone" on that page and follow its five steps.)
3. Tap the screen of the phone once and put it in the headset.

The desktop is captured only while a phone is connected. Switch VR Workspace off in the same menu when done.

The menu also has **Centre on Gaze** (look where the middle of the monitors should be, then choose it) and
**Phone Camera as Background**.

## Settings

Everything is changed live while you wear the headset: the window is on one of the monitors you see.
The window also works while VR Workspace is off, to set things up beforehand; only the code for the phone is
missing then.
Every number has a slider and a field with − and + for exact values.

- **Connect** — on/off, the QR code and link for the phone, the first-time steps for an iPhone, a button that opens
  a flat view of what the headset shows (for recording).
- **Monitors** — a map of the view around you (straight ahead in the middle, behind you at the edges) on which
  you drag the monitors to where you want to see them; centre on gaze, hide all monitors, the number and size of
  virtual monitors; and a tab for every monitor with its direction (right/left, up/down), width, curve (100 %
  wraps it around you, 0 % is flat) and distance. A click on a monitor on the map opens its tab.
  A closer monitor looks bigger, as a real one does; the width in degrees is what it takes up at 1.5 m.
  Monitors always stand level with the horizon.
- **Background** — a gallery with a tab for 360 photos and one for 360 videos, nine to a page; turn the pages
  with the mouse wheel, by dragging, or with the arrows. Click a picture to use it; "Black" is the first photo.
  The bin that appears on a picture under the pointer moves its file to the trash. Below: rotation of the scene,
  black background while a window is fullscreen (for films), and a button that opens the folder for your own files.
- **Headset** — the phone camera (see below) and the lens calibration.

Settings are kept in `params.json` in this folder.

### Arranging monitors in the headset: Num Lock

Press **Num Lock** while a phone is connected: the mouse stops reaching the desktop and works in the headset.
Look at a monitor (a soft light comes around it, and a note with its numbers appears under the centre of the view),
hold the left button and carry it with your gaze; near another monitor it is drawn to sit beside it or in line with
it. The mouse connected to the phone works in this mode too: see "Single windows", step 6. Looking down shows the
backgrounds, with darkening and blur.

| Input | Does |
| --- | --- |
| Wheel | size |
| Shift + wheel | curve |
| Ctrl + wheel | distance |
| Keys 1–4 | hide or show the monitor with that number |
| Key 5 | centre on gaze |
| Num Lock again | give the mouse back |

Without a connected phone Num Lock is just Num Lock. Only the mouse and the keys 1–5 are taken; the rest of the
keyboard keeps working in your windows. If GNOME Shell itself stops responding, the mouse returns to the desktop
within three seconds on its own.

### Lens calibration

The defaults were found for an iPhone 15 Pro in a Gear VR. For another phone or headset: first "screen to lens"
and "lens separation" until the two pictures merge without eye strain; then k1 and k2 until straight lines are
straight at the edges; then "colour fringes" until white text near the edge has no red and blue outlines.

To measure the field of view, pick the background `test grid` and switch on "Hide all monitors". Keep the head
still and read the numbers at the edges of what you see: right minus left on the yellow ruler is the horizontal
angle, top minus bottom on a blue ruler the vertical one (small ticks are 1°). Turn the head to check the
calibration: the grid must stay still like a wall. If it swims, tune "screen to lens" until it does not; the
angles are true only then.

## Monitors

While the phone is connected, GNOME has extra **virtual monitors**: move windows and the pointer there as on any
monitor. They disappear when the phone disconnects, and their windows return to the real monitor.

Their number (0–3, one by default) is set on the Monitors page, and each one's size (1920×1080 up to 3440×1440)
on its own tab there; a change restarts the capture, the picture is back in about 10 s. Real monitors are read when VR Workspace
is switched on: switch it off and on after plugging one in or out. The first picture appears about 5 s after the
phone connects.

**The system arrangement follows the sphere.** Where you put a monitor in the sphere (right, left, above, below
its neighbour) is where GNOME puts it, so the pointer crosses from one to another the way you see them. It is
applied while the phone is connected and replaces what is set in GNOME Settings → Displays for that time. Moving a
monitor to another side blinks the real monitor's picture for a second.

GNOME needs its monitors edge to edge, so of all such arrangements the one closest to what you see is taken:
monitors seen side by side share a side edge, one seen above another stands on top of it, and a monitor above two
others stands on both, so the pointer reaches it from either. Monitors of different sizes are lined up along the
edge that lets this happen.

Known limit: every time a virtual monitor is created and removed, GNOME Shell keeps 50–100 MB of video memory
until you log out (measured on GNOME 46). It adds up only after many reconnects in one session.

## Single windows (experimental)

Besides whole monitors, one application window can be shown as a panel of its own and worked from the headset with
a mouse connected to the phone.

1. Click the window on the PC, then the headset icon → **Show “…” in the Headset**. The same item takes it back.
   Up to eight windows, dialogs included: each is a stream of its own, about 12 Mbit/s of Wi-Fi.
2. The window appears as a panel where you are looking (under the monitors, if the headset is not on yet), curved
   like a monitor, and as large as makes one pixel of the window one pixel of the phone screen: its text as sharp
   as it gets (the picture arrives as sharp as on the PC). Smaller is blurrier, larger is not sharper. Its curve is
   in its tab in Settings → Monitors.
3. Look at the panel and move the mouse that is connected to the **phone**: a white dot is the pointer. The whole
   phone screen stands for the window (from side to side; from top to bottom without the phone's own edges, which
   its pointer does not reach), so the pointer never jumps across it. Left and right button
   and the wheel go to the window. The window that gets the PC's keyboard has a soft coloured light around it.
4. **To start an application**, look where its window should open, away from the windows, and press the right
   button: the PC's applications hang around you level with your eyes, a ribbon of icons four in a column, always
   in the same place, its middle straight ahead (where the layout was last centred), and everything else goes dark.
   In its middle is your own field of 4 × 4 places with larger icons; the other
   applications are to its left and right by name. Turn your head to see the rest; a click starts an application,
   and its window opens where you looked when you pressed the right button. A click beside the icons closes the
   list.
5. **To arrange your field**, hold an icon with the left button and move it: let go on a place of the field and it
   stays there (if the place is taken, the icons move one place toward the nearest free place); let go beside the
   field and it leaves it. The field is kept on the PC.
6. **To move and resize windows**, switch on the arranging mode with Num Lock on the PC's keyboard. Our pointer is
   then a dot in the view, and the panel under it lights up:
   - hold the left button anywhere on a panel and move the mouse or turn your head: it goes along, and near another
     panel it is drawn to sit beside it, over or under it, or in line with it;
   - at a side or a corner of a window that side lights up: drag it to make the window itself wider or taller on
     the PC; its panel grows with it and the text keeps its size;
   - the wheel over a panel changes its size;
   - look down: the backgrounds as round pictures (the wheel turns the pages; a click chooses one) and two sliders,
     darkening and blur of the background. The phone camera is off in this mode.
   Num Lock again leaves the mode.
7. **Look up** for the time and date.

What to know:
- **Hide all monitors** (Settings → Monitors) leaves the single windows, so you can work with windows alone.
- Menus, drop-down lists and tooltips of a window are shown on it, also where they reach out of it. While one is
  open, the pointer reaches its part outside the window too, so the pointer moves a little when it opens. A menu
  reaching out to the left of or above the window is cut there.
- A dialog of a window in the headset (a file chooser, a question) comes into the headset by itself, lying on
  its window, and leaves when it is closed. It appears dark first; the picture follows in 3–4 seconds. It takes one
  of the eight places. So does any window that opens within 15 seconds after a click from the headset: a file
  chooser that a Flatpak application asks the system for, the second window of an application. Such a window lies
  on the window you clicked in, with its text as large, and leaves the headset with it.
- The iPhone shows its own round pointer too; Safari gives pages no way to hide or hold it.
- The PC has one pointer: while you work in a window from the headset, the PC's pointer is there, and the window is
  brought to the front.
- Whoever has the link with the key can now click in these windows, not only watch.
- The keyboard is not passed on yet.
- Settings → Headset → **Text sharpness** (40 % at first) makes letters crisper through the lenses; too much draws
  bright edges around them.
- A still window takes little Wi-Fi (about 0.4 Mbit/s); one that changes, up to 12.

## Sound

While the phone is connected, the sound of the PC plays on the phone: an audio output called **VR-Headset**
appears and becomes the system's output. The output you had before comes back about half a minute after the phone
disconnects. To keep the sound on the PC (headphones plugged into it, say), pick that output in the GNOME sound
menu after connecting.

Loudness: the volume and mute keys of the PC, as for any output (the system remembers the level), and the phone's
own volume buttons on top of that.
Sound is not synchronised with the picture on purpose (that would delay the picture by ~70 ms); it trails slightly.

## Phone camera

On the Headset page:

- **Camera as the background** (also in the top bar menu) shows the room instead of the scene; the monitors stay.
- **Camera when looking down** shows the camera only where you look further below the horizon than the angle you
  set, to see the keyboard and your hands. The scene and the monitors stay above. 0 switches it off.

The camera is open only while its picture is needed and closed completely the rest of the time, so the phone's
camera sign goes out. Reopening may ask for permission again. In a Safari tab you can allow the camera for this
one site: the page menu at the address bar → Website Settings → Camera → Allow. A page started from the Home
Screen does not remember that; for it, switch on "Keep the camera open" on the Headset page: the phone then asks
once at the start, and the camera sign stays on. It is also opened once at the start tap, so that the first
permission question comes while the phone is still in your hand.

The picture is fixed to the head, one camera for both eyes, and covers only what the camera sees. Set "camera view
angle" so that things look their real size. The camera sits to the side of your eyes, so near things appear
shifted; the two "shift the picture" settings line them up. The camera needs a free view out of the headset.

To switch the camera background from a keyboard shortcut, give GNOME Settings → Keyboard → Custom Shortcuts this
command:

```bash
curl -s -X POST http://localhost:8080/toggle/passthrough
```

## Recording what you see

In the project folder, while VR Workspace runs:

```bash
node record.mjs          # Ctrl+C stops; the video, with the PC's sound, goes to ~/Videos
node record.mjs 110      # a wider view: 110 degrees instead of 90
```

It records one flat picture of what the wearer is looking at (no stereo, no lens distortion), following the head a
quarter of a second behind so that it stays smooth. Nothing appears on the screen: an invisible Chromium draws the
picture on the graphics card. Our pointer and the list of applications are in it, as the phone shows them; the
phone camera is not.

To only watch: Settings → Connect → "See what the headset shows" opens http://localhost:8080/?spectator in the
browser (click it once). As a window on the PC it gets covered by the windows the headset brings to the front.

## Your own backgrounds

Settings → Background → "Open Folder" opens `app/bg/`. Put equirectangular files there (twice as wide as tall):
photos, or 360 videos as `.mp4`, `.webm` or `.mov` in a codec the phone plays (H.264 is safe). They appear in the
gallery the next time its page is opened. The same page has darkening and blur of the background, so that the
panels stand out; in the headset they are under the backgrounds when you look down in the arranging mode. `setup.sh` fills the folder only when it does not exist yet (with the
photos, a test grid and `video_test.mp4`), so what you delete stays deleted.

## Without the top bar icon

The extension is a remote control; the server works without it.

```bash
npm start                                # the same server, in a terminal; Ctrl+C stops it
systemctl --user start vr-workspace      # or the service the menu uses (stop: the same with "stop")
```

- http://localhost:8080/control.html — the same settings as a plain web page (in Russian). Its button "arrange
  with the mouse" does what Num Lock does. It also works from another device, with the key (see Security).
- http://localhost:8080/ — a preview on the PC; drag to look around.
- The link for the phone is printed when the server starts.

## If something does not work

- **The switch goes back to off** — the server did not start. The reason is in `journalctl --user -u vr-workspace -e`.
  Usually `./setup.sh` was not run, or the session is not Wayland.
- **No icon in the top bar** — log out and in after `./setup.sh`; check `gnome-extensions info vr-workspace@local`.
- **The phone cannot open the link** — same Wi-Fi? Firewall ports open? The link uses the PC's name
  (`<name>.local`); if the network does not resolve it, use the PC's IP address in the same link, and run
  `./setup.sh` again if that address has changed since (the certificate names it).
- **Safari warns about the certificate** — the "First time with this iPhone" steps were not finished, or the PC
  was renamed: run `./setup.sh` again.
- **The desktop stops reacting while the picture goes on** — GNOME Shell has hung (seen once with two virtual
  monitors; cause unknown). Windows still take the keyboard. Ctrl+Alt+F3 opens a text console: log in and run
  `systemctl --user stop vr-workspace`; if the desktop does not come back, `loginctl terminate-user $USER` ends the
  session without a hard reset. Ctrl+Alt+F2 (or F1) returns to the desktop.
- **VR Workspace switched itself off** — GNOME's own "stop sharing the screen" button (the orange one in the top
  bar) was pressed. It ends every recording, so VR Workspace takes it as "off". Switch it on again in its menu.
  A locked screen only pauses the picture; it comes back after unlocking.
- **Picture but no head tracking** — the tap on the phone screen allows the motion sensors; reload and tap again.
  Rotation lock must be off.

## Security

Anyone on the network who has the link with the key can watch your desktop and change the settings.
The key is in `certs/token`; delete it and run `./setup.sh` to get a new one. Never commit `certs/`.

## Uninstall

```bash
systemctl --user stop vr-workspace
gnome-extensions disable vr-workspace@local
rm ~/.local/share/gnome-shell/extensions/vr-workspace@local ~/.config/systemd/user/vr-workspace{,-settings}.service
```

Then delete this folder, and on the iPhone remove the profile "VR Workspace local CA" (Settings → General → VPN and
Device Management).

## How it works

```
GNOME screencast of each monitor → H.264 on the GPU → RTMP ┐
"VR-Headset" audio output → Opus → RTSP ───────────────────┴→ MediaMTX → WebRTC → phone (three.js shader, speakers)
```

- `capture.py` — asks GNOME for the monitor streams (creating the virtual monitors), runs one GStreamer encoder per
  monitor and ffmpeg for the sound, creates the virtual audio output.
- `mediamtx.yml` — MediaMTX settings; it starts `capture.py` when a viewer connects.
- `windows.py` — the same for single windows, and puts the pointer, buttons and wheel from the headset into them
  (`orders.js` checks what the headset may ask for).
- `server.js` — static files, HTTPS, the WHEP handshake proxy, live settings, previews of the backgrounds, the
  list of monitors; starts MediaMTX.
- `app/main.js` — the phone page. One shader turns each pixel into a view ray through the lens,
  so stereo and lens correction are done in a single pass and text is sampled once.
- `gnome-extension/` — the top bar menu (`extension.js`), the settings window (`prefs.js`) and `install.sh`.
  The extension keeps nothing itself: it reads and writes the server's settings over `http://127.0.0.1:8080`.
  While VR Workspace is off, the open settings window runs `server.js --settings` (the service
  `vr-workspace-settings`): the same settings, no stream, reachable from this PC only.
  Inside GNOME Shell it also reports fullscreen windows and holds the mouse while Num Lock is on.
- `npm test` — checks the head-orientation and layout maths, the QR code, and the low-memory rule of the capture.
