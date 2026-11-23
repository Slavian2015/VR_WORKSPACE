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
- Phone and PC on the same Wi-Fi (5 GHz). The PC firewall must allow TCP 8080, 8443 and 8189, and UDP 8189.
  (From outside the home: see below.)

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
2. Choose **Settings** in the same menu. The first page, tab **Local Wi-Fi**, shows a QR code: point the iPhone
   camera at it and open the link in Safari. (The very first time, open "First time with this iPhone" there and
   follow its five steps.) Chrome on the iPhone reaches the PC at home only with its permission for the local network
   (iPhone Settings → Privacy & Security → Local Network → Chrome); Safari needs none.
3. Tap the screen of the phone once and put it in the headset.

The desktop is captured only while a phone is connected. Switch VR Workspace off in the same menu when done.

### Android phone

The same page works in Chrome on Android.

1. The first time, install the certificate: open the code under "First time with this phone", then Settings →
   Security → Encryption and credentials → Install a certificate → CA certificate, and pick the downloaded file
   (the names differ by maker: search the settings for "certificate"). Chrome trusts certificates installed so.
2. Open the link from Local Wi-Fi in Chrome and tap: the page takes the whole screen in landscape. ⋮ → Add to Home
   screen gives an icon that opens it so.
3. The lens settings were measured for an iPhone 15 Pro. For another phone set its screen width in mm (Settings →
   Headset → Phone), then the lens distance and k1, k2 until straight lines look straight.
4. The video is H.264: nearly every Android phone plays it; one that does not shows no picture.
5. A Samsung phone in a Gear VR starts the Oculus app when it is put in. Switch the Gear VR service off once,
   with the phone on a cable and USB debugging on: `adb shell pm disable-user --user 0 com.samsung.android.hmt.vrsvc`
   (`pm enable` brings it back; the name may differ on some models).

### From outside the home

Over the mobile internet or another Wi-Fi, if this PC has an address on the internet that does not change (a static
IP from the provider; a name that points to it works too):

1. Check that it is really this PC's: the address the router shows for its internet side must be the one that a
   "what is my IP" site shows. If they differ, the provider shares one address among many and this cannot work.
2. In the router, pass these ports on to this PC: **8443** (TCP, the page) and **8189** (UDP and TCP, the video).
   Nothing else: 8080 serves the page without encryption and is for the home network only.
3. In Settings → Connect → **Remote**, enter the address, then switch VR Workspace off and on. The server
   then puts the address into its certificate (the phone trusts it already) and makes the key of the links longer:
   open both codes on the iPhone again and add the second link to the Home Screen as a second icon.

The same page works both ways; only the address differs. At home the link from Remote does not open (the router
does not take its own address on the internet from inside): use the one from Local Wi-Fi there. Over the internet the pointer lags a little more, and a
still screen costs little, a changing one (a film, scrolling) up to 20 Mbit/s for each monitor and 12 for each
window: mind the mobile data.

The top bar menu has four items: **VR Workspace** (the server on or off), **Headset on a Cable** (see below),
**Record Video** (see "Recording what you see") and **Settings**. **Centre on gaze** is in Settings → Monitors (and key 5 in the arranging mode); the camera as the
background in Settings → Headset → Phone Camera.

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
it. The gaze points as the phone's mouse would: look at a side or corner of a single window, hold the left button and
turn your head to change the window's size. The mouse connected to the phone works in this mode too:
see "Single windows", step 6.

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

1. Start the application from the list in the headset (step 4): its window comes into the headset by itself, and
   leaves it when closed. Up to ten windows, dialogs included, and monitors and windows together at most eleven
   (with two monitors nine windows): the page has one texture for each, and a phone's browser gives it sixteen,
   five of them the page's own. Each window is a stream of its own, up to 12 Mbit/s of Wi-Fi while it changes.
   What ten cost was measured on the stand (2026-11-23, windows of 900×620, the stand's encoders on the
   processor): about 120 MB of memory a window, 1.2 GB for ten, of which 80 MB a window is the stand's own
   encoder; the graphics memory counter rose by 230 MB a window. The picture of one monitor and ten windows,
   all in view, was drawn at 60 frames a second on this PC. A window out of view costs the page nothing (its
   stream is not taken), but its encoder on the PC runs on. Ten encoders of the real graphics chip at once were
   not tried: the stand never uses that chip's encoder.
2. The window appears as a panel where you are looking (under the monitors, if the headset is not on yet), curved
   like a monitor, at Settings → Monitors → **Distance of new windows** (2 m at first). At 1.5 m one pixel of the
   window is one pixel of the screen: its text as sharp as it gets (the picture arrives as sharp as on the PC);
   farther it is smaller and softer, larger is not sharper. Its curve is in its tab in Settings → Monitors.
3. Look at the panel and move the mouse that is connected to the **phone**: the pointer has the shape it has on the
   PC (an arrow, a text cursor, a hand), an arrow until the PC has told it. The whole
   phone screen stands for the window (from side to side; from top to bottom without the phone's own edges, which
   its pointer does not reach), so the pointer never jumps across it. Left and right button
   and the wheel go to the window. The window that gets the PC's keyboard has a soft coloured light around it.
4. **To start an application**, look where its window should open, away from the windows, and press the right
   button: the PC's applications hang around you level with your eyes, a ribbon of icons four in a column, always
   in the same place, its middle straight ahead (where the layout was last centred), and everything else goes dark.
   In its middle is your own field of 4 × 4 places with larger icons; the other
   applications are to its left and right by name. Turn your head to see the rest; a click starts an application,
   and its window opens where you looked when you pressed the right button. A click beside the icons closes the
   list. **The Super (Windows) key** opens the same list while the headset is in use, instead of GNOME's overview:
   look at an application and click with the PC's mouse (it works for the list until it closes); hold the button
   and look elsewhere to carry an icon; the right button or Super again closes it.

   **Over the list are four round buttons** (look up a little): **Record** (a red dot starts the recording, a white
   square on red stops it), **6D** (the head movement from the camera: it begins with a look around the room, see
   "Moving the head" below; blue while on), **Settings** and **Off**. Off wants a second press within three
   seconds; then it does what the emergency key does: the picture of a headset on a cable closes and VR Workspace
   is switched off.

   **Settings** shows, in place of the icons, four blocks side by side, all in view at once and always at the same
   size: **Картинка** (text sharpness, the drawing's resolution, the light around the window that gets the keyboard, hiding the monitors),
   **Движение головы** (on or off, the strength of the lean, "look around again"), **Камера телефона** (the camera
   as the background, below which angle it shows, keeping it open, the angle and the shift of its picture) and
   **Фон**: the backgrounds as round pictures, nine a page (a click shows one at once; the arrows under them or the
   wheel turn the pages), with its darkening and blur. Only what shows at once in the headset is there; the rest stays in the
   settings window on the PC. A switch flips with a click. A slider: hold the button on it and look left or right;
   while it is held everything else disappears and the view is not darkened, so what it does is seen at once. The
   same button brings the icons back, and the list always opens with the icons.
5. **To arrange your field**, hold an icon with the left button and move it: let go on a place of the field and it
   stays there (if the place is taken, the icons move one place toward the nearest free place); let go beside the
   field and it leaves it. The field is kept on the PC.
6. **To move and resize windows**, switch on the arranging mode with Num Lock on the PC's keyboard (F12 on a
   keyboard connected to the phone). Our pointer is
   then an arrow in the view, as large as on the PC, and the panel under it lights up:
   - hold the left button anywhere on a panel and move the mouse or turn your head: it goes along, and near another
     panel it is drawn to sit beside it, over or under it, or in line with it;
   - at a side or a corner of a window that side lights up: drag it to make the window itself wider or taller on
     the PC; its panel grows with it and the text keeps its size;
   - the wheel over a panel changes its size, smoothly, about 6 % a notch.
   Looking down shows the phone camera as everywhere else (the keyboard and your hands); the backgrounds are among
   the settings over the list of applications. Num Lock again leaves the mode.
7. **Look up** for the time and date.

What to know:
- **Hide all monitors** (Settings → Monitors) leaves the single windows, so you can work with windows alone.
- Menus, drop-down lists and tooltips of a window are shown on it, also where they reach out of it. While one is
  open, the pointer reaches its part outside the window too, so the pointer moves a little when it opens. A menu
  reaching out to the left of or above the window is cut there.
- A dialog of a window in the headset (a file chooser, a question) comes into the headset by itself, lying on
  its window, and leaves when it is closed. It shows a spinner first; the picture follows in 3–4 seconds (so does any panel before its picture comes). It takes one
  of the ten places. So does any window that opens within 15 seconds after a click from the headset: a file
  chooser that a Flatpak application asks the system for, the second window of an application. Such a window lies
  on the window you clicked in, with its text as large, and leaves the headset with it.
- The iPhone shows its own round pointer too; Safari gives pages no way to hide or hold it.
- The PC has one pointer: while you work in a window from the headset, the PC's pointer is there, and the window is
  brought to the front.
- Whoever has the link with the key can now click and type in these windows, not only watch.
- **A keyboard connected to the phone** (Bluetooth, or a receiver in its port) types into the window that gets the
  PC's keyboard (the lit one), else into the one looked at, which comes to the front first. Keys are passed as keys,
  not letters, so the PC's layout makes the letters (Russian or English, switched as on the PC). Holding a key
  repeats it as on the PC. Keys held when the page leaves the screen, or when the phone goes silent for 3 seconds,
  are let go on the PC. **F12** switches the arranging mode, as the PC's Num Lock does (the iPhone gives the page no
  Num Lock). Not passed on: Alt+F2 (GNOME's "run a command", see Security) and what the iPhone keeps for
  itself (Cmd+Tab, Cmd+Space; Alt+Tab did not arrive either). The number pad works as the PC's does with Num Lock
  off: Home, End, Page Up and Down, the arrows. To monitors the phone's keyboard goes nowhere yet.
- Settings → Headset → Picture → **Text sharpness** (40 % at first) makes letters crisper through the lenses; too much draws
  bright edges around them.
- **A phone that gets hot.** Three things spare it. A monitor or window far behind you (or hidden) is not taken
  from the PC at all after three seconds, and taken again as you turn toward it; its last picture stands for the
  second that takes. The phone camera's picture is used only while you look down to where it shows. And
  **Разрешение отрисовки** (the drawing's resolution, in the Картинка block of the settings in the sphere, and on
  the settings page) draws fewer pixels: at 70 % the graphics chip has half the work. The screen shows about 13
  pixels a degree through the lenses and the eye tells them apart, so text gets softer with it: try how far you
  can go.
- A still window takes little Wi-Fi (about 0.4 Mbit/s); one that changes, up to 12.

## Sound

While the phone is connected, the sound of the PC plays on the phone: an audio output called **VR-Headset**
appears and becomes the system's output. The output you had before comes back about half a minute after the phone
disconnects. To keep the sound on the PC (headphones plugged into it, say), pick that output in the GNOME sound
menu after connecting.

Loudness: the volume and mute keys of the PC, as for any output (the system remembers the level), and the phone's
own volume buttons on top of that.
Sound is not synchronised with the picture on purpose (that would delay the picture by ~70 ms); it trails slightly.

**The phone's microphone** can be the PC's: switch on Settings → Connect → Phone microphone. While the phone is
connected, a microphone called **VR-Headset** appears and becomes the system's microphone (the one you had before
comes back when the phone stops); programs started meanwhile use it, one already running may need it chosen in its
own settings. The phone asks for permission when the page starts, and shows its microphone sign while it is sent.
Echo cancellation is on: the phone plays the PC's sound at the same time.

## Glasses on a cable (in preparation)

Glasses that are a monitor of this PC (USB-C with DisplayPort, a motion sensor and cameras inside, nothing else):
the PC draws their picture itself, with no Wi-Fi and no video compression on the way. For now, before such glasses
are here, the parts are tried with what there is:

- **Their picture:** top bar menu → **Headset on a Cable**, or the **Pause** key from anywhere (switching it off closes
  the picture). A window on the
  whole screen it opens on shows what the glasses would, its left half for the left eye and the right half for the
  right. Each eye sees a flat screen as wide as Settings → Headset → Picture → **Field of view on a cable** (across
  the diagonal, as the maker gives it). The same is `http://localhost:8080/?glasses` in any browser.
- **On a monitor, before the glasses are here:** Settings → Monitors → Virtual Monitors → Number: 1 (the windows
  live there while your screen shows the picture), the phone running in your hand as the sensor, then the switch.
- **The head's turn:** from the phone, which must be running in the headset as usual (later from the glasses' own
  sensor, read as [XRLinuxDriver](https://github.com/wheaney/XRLinuxDriver) does).
- **Their camera:** this PC's webcam, wherever the phone's camera would show (Settings → Headset → Phone Camera).
- **No video on the way:** while the picture is on, nothing is compressed for it. Every monitor and window goes
  from GNOME to the picture as it is (`raw.py`), and only while its panel is in view and something changes on it.
  Text is as sharp as on the monitor. Measured on the stand: a 2560×1440 monitor changing 60 times a second arrives
  60 times a second, 15 ms after GNOME made the picture, for three quarters of one processor core; a still window
  costs nothing. The graphics card's video engine is not used at all (it hung on the first frame of a small window
  three times of three on 2026-11-21 and froze the whole desktop). Switching the picture on or off changes the way
  at once, without making the virtual monitors anew.
- **The monitor that shows the picture** is no panel in it: it would show itself.
- **The phone meanwhile** is the sensor and nothing else: a dark screen with one line of text, no pictures taken
  over Wi-Fi, the sound still played. The spectator page on this PC (so the preview and `record.mjs` too)
  then shows what the wearer of the headset on the cable sees: the same pictures, and that picture's pointer and
  list. A spectator on another device gets no pictures meanwhile. Switched off, the picture comes back to the phone
  by itself within some ten to twenty seconds.

**The mouse** works there as the phone's mouse works on the phone's screen. While the glasses' picture fills a
screen, the pointer stays on that screen and the picture draws it itself, at once. Moved onto a monitor or a single
window's panel, the real pointer goes into that monitor or window, at that place: the mouse and the keyboard work
there directly, and the window comes to the front. The pointer is drawn over the panel at once; GNOME's own, which
would come with the picture a tenth of a second late, is hidden meanwhile. Pushed hard past a side of the panel, the
pointer comes back out onto the picture. Num Lock (arranging) and Super (the list of applications) bring it out too:
panels are carried and resized with it, and the list and its settings are worked with it. The right
button beside the panels opens the list. A window lying on the headset's own screen, under its picture, is moved to
another monitor first, and so is a new window that opens there. New windows come at the distance of new windows,
sized for the glasses' own screen. The picture needs no tap to start.

The picture's own "Black while a window is fullscreen" does not count it as a film.

**The emergency key: Ctrl+Alt+Backspace**, always, from anywhere. It takes the glasses' window off the screen (also
when it hangs), lets go of the mouse and switches VR Workspace off, so that its virtual monitors go and every window
comes back to the plain screen. Glasses may be the only screen; a picture that hangs there must not leave you blind.

## Notifications

GNOME's notifications show in the headset too, for six seconds, above the middle of the view: the application, the
title and the start of the text. The same ones as GNOME shows as banners on the PC, so "Do Not Disturb" and the
per-application settings in GNOME Settings → Notifications apply here as well.

## Phone camera

On the Headset page:

- **Camera as the background** shows the room instead of the scene; the monitors stay.
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

## Moving the head (its place in the room, from the camera)

The phone's sensors tell only how the head is turned. With Settings → Headset → Phone Camera → **Head movement from
the camera** (on unless switched off) the phone also finds where the head is in the room, from what its back camera
sees: lean toward a window and it comes nearer (text gets larger), lean back and it goes away, lean aside and the
windows shift as real things would. The sphere stays where it is and the panels in it are seen from the head's new
place. So is the list of applications. Looking around moves nothing.

**First the room is looked around**, for 15 seconds, once you sit: open the list of applications (Super) and press
the **6D** button over it (or switch the setting on). A note in the headset says "Осмотритесь": turn the head slowly
to the left, to the right, up and down, as far as you will look later: also down at the keyboard, if you look
there (where the look around never went, a look is told a little as a move of the head). The phone makes a map of the room from that:
landmarks (corners of things) with their places. Then the map is fixed and the head is found in it, in every
picture of the camera. **A screen that shows the sphere and that the camera can see** (the headset's picture on a
monitor, the spectator window) goes dark for the look around, with only the note on it: what it shows follows the
head, and taken for a part of the room it made a window come nearer by itself (the camera saw the window grow on
that screen and took it for the head coming nearer). The button shows which it is: "Осмотреться" (on, no map yet: press it), "Идёт осмотр…",
"6DoF включён"; a press while it is on switches it off. After the page was started anew the room has to be looked
around again (the map is not kept).

The head's way counts as many times as new windows hang farther than a real monitor stands (0.7 m): leaning toward
a window is then as leaning toward a monitor an arm's length away. One to one, a lean of 20 cm toward a window 2 m
away would hardly show. On top of that comes **the strength of the lean** (1.5 by default; among the settings in
the headset, and Settings → Headset → Phone Camera): 1 is as at a real monitor, more makes a smaller lean do as
much. It counts the same for everything, so the sphere stays whole. With a headset on a cable the
phone sends the head's place along with its turn (the phone must be worn on the head then, its camera looking
forward).

- **Not while arranging** (Num Lock): panels are carried around the middle of the sphere there.
- **Distance to what the camera sees, m** (0.8 by default): pictures alone cannot tell a small room from a large
  one. It is how far the things around usually are; if a lean of a hand's width moves the windows less than that,
  make the number larger.
- **What the camera really sees across, °** (72 by default, the main camera of an iPhone): for another camera, its
  true angle. "Camera view angle" above it is only for how the camera's picture is shown.
- **Centre on gaze** also puts the head at zero where it is now (the map stays).
- It is made for sitting, leaning and looking around, up to 30 cm from where the room was looked around. Where the
  look around never went there are no landmarks: looking there, the head stays as last found.
- The camera must see things that stand still and have something to tell them by (a desk, shelves, a wall with
  pictures): not a blank wall, not the dark. Things that move, a screen that changes, hands: they are left out
  when they do not fit the rest.
- The camera should not see the screen that shows the sphere itself (a monitor standing in for a headset on a
  cable): its picture changes with every answer. Inside a real headset this cannot happen.
- The camera stays open while it is on (the phone gets warmer).
- Every look around in the headset is kept with the 15 seconds after it as a clip on the PC
  (`track-clips/auto-….bin`, small grey pictures with the head's turns; the last eight): what goes wrong in the
  headset and not on the test page can then be played through the same code again (`node dev/replay.mjs`).
- Every five seconds the phone tells the server how it goes, and the server's journal keeps it
  (`journalctl --user -u vr-workspace | grep 'head from the camera'`): the camera's picture and rate, whether there
  is a map and of how many landmarks, how many were found in the last picture, the part of the pictures in which
  the head was found, and where it was taken to be.

**To try it without the headset**: the phone's start screen has the link "Проверка движения головы" (the page
`track-test.html`). Hold the phone at your face as it sits in the headset, press "Начать", then "Осмотреться" and
turn with it for 15 seconds; after that it shows where the head is, in centimetres (forward, right, up), and the
landmarks it found as dots on the camera's picture. Turning must leave the numbers near zero; leaning forward by a
hand's width must show about 10 cm. It needs neither a login nor a restart to try again. "Записать осмотр и
проверку" keeps the look around and the 15 seconds after it (small grey pictures with the phone's turns) in
`track-clips/` on the PC, and `node dev/replay.mjs track-clips/clip-….bin` plays such a clip through the same code
again, so a change to it is tried on what the real camera saw (`node dev/replay.mjs <a clip> <another>`: the map
from the first, the second followed in it).

How it works is told at the top of `app/track.js`. Before it (2026-11-21 and 22) five tries took one flat wall for
the room and told how much larger it showed as a lean: a camera that swings toward a near wall or a desk when the
head turns sees them grow, and turning right by 17° was told as leaning 21 cm in. Two clips of the real camera
showed that, and showed this way holding the head within 1 to 2 cm through the same turns, with the leans in them
still found. The tests (`node --test`) now have a room with a near wall and a desk, not one wall.

## The helper: Claude in the sphere (a first version)

Claude can be asked from inside the sphere, by voice: it changes the sphere's own settings, opens and arranges
windows, and looks at what you mark with the mouse. The plan and what is done so far: `ASSISTANT-PLAN.md`.

**Caps Lock** is its key while the headset is in use (a phone connected, or the picture of a headset on a cable);
it types no capitals then. The first press switches its mode on: a card low in the view says so. Speak (the words
show in the card as they are heard), and mark with the mouse what Claude is to look at:

- a click on a window or monitor: all of it;
- the left button dragged: a frame around a part of it;
- the right button dragged: an arrow, from its tail to what it points at.

Each mark gets a number, up to six. The next press of Caps Lock sends the words and the marks, and Claude answers in
the card. **Esc** gives the mode up and wipes the marks, and so does saying nothing but "стоп" or "отмена"; Caps
Lock while Claude works stops it. With a mouse connected to the PC the
gaze points and the buttons mark (as in the arranging mode); with a headset on a cable its picture has the mouse.
Not while arranging (Num Lock).

**Only what you marked leaves the PC** as a picture: that window, the framed part alone, or the part around an
arrow, with the window's title and its program. Never the whole desktop. For a request about windows Claude is also
told, as text, the titles and programs of the windows in the sphere, and of the windows open elsewhere on the PC
only their programs.

**Speech** is turned into text on this PC and never leaves it. Set it up once, without sudo:

```bash
./setup-speech.sh        # makes .speech/ here: the recognizer (faster-whisper) and its model, 0.9 GB
```

Then restart VR Workspace. The microphone is the system's own: the phone's while "the phone's microphone" is on,
else the PC's. A short phrase is recognized in about a second, at most a minute is listened to, and the words are
taken for Russian. `./setup-speech.sh medium` gets a larger, more exact and slower model (then
`VR_SPEECH_MODEL=medium` in the server's environment). Without the setup the mode still marks, and words can be
given as text: `curl -X POST http://127.0.0.1:8080/assist -d '{"text": "сделай фон темнее"}'`.

It can change every setting of the blocks over the list of applications (the picture, the head movement, the phone
camera, the background), start and stop the recording, centre the sphere, start a look around the room, and switch
VR Workspace off. Before that last one it asks in the card: Caps Lock is the yes, ten seconds of nothing the no.
It keeps the last few exchanges in mind for ten minutes ("a bit more").

**Windows by voice.** It knows what is in the sphere and where it hangs, and what else is open on the PC:

- «Открой калькулятор», «открой ютуб», «открой файл с отчётом»: a program by its name (a window of it that is
  already open on the PC comes into the sphere, else it is started), a web address (in a browser window of its own),
  a file or a folder by its name or a part of it. Files are looked for in your folders (the desktop, documents,
  downloads, pictures, music, videos), three levels deep; more folders are the setting `assistFolders`, paths with
  ":" between (`curl -X POST http://127.0.0.1:8080/params -d '{"assistFolders": "/home/me/projects"}'`). Nothing
  hidden and nothing outside your home folder and those folders is opened. When a name fits nothing or several
  files, Claude is told names of files there to choose from; otherwise no file name leaves the PC.
- «Поставь это окно левее», «сделай крупнее», «ближе», «по центру», «справа от редактора»: the window moves. "This
  window", with nothing marked, is the one you looked at while speaking (the glance down at the key does not count).
- «Открой рядом сайт и дизайн»: both open and stand side by side.
- «Запомни расстановку как работа», «верни расстановку работа»: where every monitor and window stands is kept
  under a name (`layouts.json`). Bringing it back puts the windows of those programs that are open at their places
  and starts the programs that are not running; it does not open documents inside them again.
- «Закрой это окно»: the window is closed as by its own button (its program may ask about unsaved work).
  «Убери это окно»: it only leaves the sphere and stays open on the PC.
- «Напиши в это окно: …», «… и отправь»: the text is typed where the window's cursor is, and Enter pressed if
  you asked to send or run it. Up to 160 characters at a time. It goes in by the clipboard and Shift+Insert (keys
  cannot spell text: they make the letters of the layout in use), which works in GNOME's and Qt's programs,
  browsers, VS Code and terminals; the text the clipboard held before is put back, a picture copied before is
  lost from it.

Before closing a window and before typing, the card asks, with the window and the whole text: **Caps Lock is the
yes**, waiting is the no. The window may be the wrong one, and typed text may be a command.

**With what you marked** it can do more than look:

- «Где здесь кнопка…?», «как включить…?»: it finds the place in the marked picture and shows it on the window, a
  frame around the button or an arrow to it, in its own colour for half a minute, and says what to press. Mark the
  window with a click first: without a mark it has no picture.
- «Покажи, где это в коде»: it takes the label or the error's text from the marked picture, finds the line in your
  code and opens the file at it in VS Code (`code --goto`; `VR_EDITOR` in the server's environment names another
  editor that takes `--goto file:line`), whose window comes into the sphere. Your code is the folders VS Code has
  open, and those of the setting `assistCode` (paths with ":" between). The search never looks into hidden files
  and folders, and in a folder of git only into what git knows or would add. The lines found go to Claude.
- A walk: mark several places, say something about each, and it writes a list of tasks, one for each place with
  its picture beside it, into `Documents/VR Workspace/<the list's name>.md` (checkboxes; a list that is there is
  added to).
- «Скажи, когда сборка закончится»: it watches the marked place and tells you with a notification and on the card
  when that has happened, and how it ended. The place is looked at again each time it has changed and stood still
  for four seconds (a blinking cursor is no change), half an hour and twenty looks at most; each look sends its
  picture of then to Claude. One watch at a time; «перестань следить» ends it.
- «Запомни, как было», and later «сделай ролик было и стало»: a clip of five seconds from the two pictures of the
  same place, each with its word, into your videos. The second picture it takes by itself: the window must be in
  the sphere and in view.

It cannot press buttons in a window, read a whole file, or see what was not marked.

**From the chat in VS Code.** The same tools are offered to Claude Code in this project (`.mcp.json`; VS Code asks
once whether to allow the server `sphere`). Ask the chat to read or change the sphere's settings, to open or move
windows, or to look at what you have marked.

**How it runs.** The server starts Claude Code without its window for each request (`claude -p`, the program that
came with the VS Code extension, or `claude` if it is installed; `VR_CLAUDE` names another), under your own
sign-in: no key, no package. It is given no tools of its own, neither files nor a shell, only the sphere's
(`assist-tools.js`). The model is `claude-sonnet-5-5` at low effort: three to four seconds for a change of a
setting, two of them the program starting. `claude-opus-5-5` is more careful with pictures and vague requests and
took five to six seconds for the same; `claude-haiku-5-5` about four (measured 2026-11-22). Another one is the
setting `assistModel`:

```bash
curl -X POST http://127.0.0.1:8080/params -d '{"assistModel": "claude-opus-5-5"}'
```

## Recording what you see

Three ways, all the same switch: top bar menu → **Record Video**; the **Scroll Lock** key from anywhere; and in the
headset the first round button over the list of applications (the Super key opens the list), which shows a red
dot to start and a white square on red while it records. On starts it, off stops it and saves the video, with the PC's
sound, into `~/Videos` (switching VR Workspace off saves it too). A notification in the headset says which way it
went. The same from a terminal, in the project folder, while VR Workspace runs:

```bash
node record.mjs          # Ctrl+C stops; the video, with the PC's sound, goes to ~/Videos
node record.mjs 110      # a wider view: 110 degrees instead of 90
```

It records one flat picture of what the wearer is looking at (no stereo, no lens distortion), following the head a
quarter of a second behind so that it stays smooth. Nothing appears on the screen: an invisible Chromium draws the
picture on the graphics card. Our pointer and the list of applications are in it, as the phone shows them; the
phone camera is not. With a headset on a cable it records what that headset's wearer sees, the same way.

To only watch: Settings → Connect → "See what the headset shows" opens http://localhost:8080/?spectator in the
browser (click it once). As a window on the PC it gets covered by the windows the headset brings to the front.

## Your own backgrounds

Settings → Background → "Open Folder" opens `app/bg/`. Put equirectangular files there (twice as wide as tall):
photos, or 360 videos as `.mp4`, `.webm` or `.mov` in a codec the phone plays (H.264 is safe). They appear in the
gallery the next time its page is opened. The same page has darkening and blur of the background, so that the
panels stand out; in the headset both, and the backgrounds themselves, are in the block **Фон** of the settings over the list of applications. `setup.sh` fills the folder only when it does not exist yet (with the
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
- **The phone cannot open the link** — same Wi-Fi? Firewall ports open? Chrome on the iPhone needs the permission
  for the local network; Safari does not. The link names the PC by its address on the Wi-Fi (not by its name: that
  is announced with Docker's addresses too, and the phone waited on one of those). When the router gives the PC
  another address, the link changes: open the code again. (Best: give the PC a fixed address in the router.)
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

Anyone on the network who has the link with the key can watch your desktop and change the settings, and click and
type in the windows shown in the headset (a keyboard connected to the phone): a terminal shown there runs what is
typed. The helper (Claude) is asked from this PC only; what it gets to see is what was marked for it (a watched
place again each time it changes), the titles of the windows in the sphere and the lines of your code that hold a
text it looked for, and that goes to Anthropic, as everything you show Claude does. Such text
comes from outside (a web page names its own window) and may try to give the helper orders: it is told to take it
for data, and what it can do at all is little: the sphere's settings, moving windows, opening a web address or a
file of your own folders with its usual program. It cannot read a file. Closing a window and typing into one (which
in a terminal runs a command) happen only after you have seen the window's name and the whole text on the card and
pressed Caps Lock. A page of another site, open in a browser on this PC or in
the home, is not answered: requests from this PC need no key, and a browser lets any page send one. Keys go only into the window that has the PC's keyboard, and never Alt+F2 (GNOME's "run a command"). The key is in `certs/token`; delete it and run `./setup.sh` to get a new one
(then open the codes on the phone again). The server does not start with a key that is missing or shorter than 12
characters (an empty one would let anyone in); `./setup.sh` makes a new one then. Never commit `certs/`.

With an address on the internet set, the key is 32 characters, too many to guess. An address from the internet (not
of the home network) that gives 10 wrong keys within an hour gets no answer for the rest of the hour; the journal
(`journalctl --user -u vr-workspace`) tells of each such block and of every opening of the link from the internet.

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
- `cert.sh` — the certificate the phone checks this PC by, signed by the CA that `setup.sh` made.
- `mic.py` — the phone's microphone as the PC's microphone "VR-Headset"; MediaMTX runs it while the phone sends it.
- `windows.py` — the same for single windows, and puts the pointer, buttons and wheel from the headset into them
  (`orders.js` checks what the headset may ask for).
- `raw.py` — hands one monitor or window to the picture of a headset on a cable as plain pictures, in place of an
  encoder (ports 8700 and up, on this PC only, for who gives the key of this run).
- `server.js` — static files, HTTPS, the WHEP handshake proxy, live settings, previews of the backgrounds, the
  list of monitors; starts MediaMTX.
- `app/track.js` — where the head is, from the phone camera's pictures (leaning toward a window).
- `assist.js` — the helper: runs Claude for a request, tells what it may change, open, place, show, find in the code and watch; `assist-tools.js` — its tools
  as Claude takes them (also for the chat in VS Code, `.mcp.json`); `listen.py` — its ears, speech into text
  (`setup-speech.sh` installs what it needs into `.speech/`); the server keeps its card and the marks.
- `app/main.js` — the phone page. One shader turns each pixel into a view ray through the lens,
  so stereo and lens correction are done in a single pass and text is sampled once.
- `gnome-extension/` — the top bar menu (`extension.js`), the settings window (`prefs.js`) and `install.sh`.
  The extension keeps nothing itself: it reads and writes the server's settings over `http://127.0.0.1:8080`.
  While VR Workspace is off, the open settings window runs `server.js --settings` (the service
  `vr-workspace-settings`): the same settings, no stream, reachable from this PC only.
  Inside GNOME Shell it also reports fullscreen windows and holds the mouse while Num Lock is on.
- `npm test` — checks the head-orientation and layout maths, the QR code, and the low-memory rule of the capture.
