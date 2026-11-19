#!/usr/bin/python3
"""Experiment for the "one stream per window" direction. Run it INSIDE the isolated session of iso.sh, never on the
real desktop: screen recording can leak memory fast, and only iso.sh has the guard against that.

Records one window (a text editor it opens) as its own stream, feeds it to a pipeline, changes the window by typing
and, if asked, by moving the pointer over it, and prints how many frames came and how memory moved.

usage: window_probe.py <folder> <dmabuf|plain|plain-h264> <cursor mode 0|1|2> <seconds> [pointer] [menu]
"""
import glob, json, os, shutil, subprocess, sys, time
from gi.repository import Gio, GLib

out, mode, cursor, seconds = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
bus = Gio.bus_get_sync(Gio.BusType.SESSION)
RD, SC = 'org.gnome.Mutter.RemoteDesktop', 'org.gnome.Mutter.ScreenCast'


def call(name, path, iface, method, args=None):
    return bus.call_sync(name, path, iface, method, args, None, 0, 5000, None)


def shell(js):
    ok, text = call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval', GLib.Variant('(s)', (js,))).unpack()
    return json.loads(text) if ok and text else text


def memory():  # megabytes in use on the PC, and of them graphics memory
    info = dict(line.split(':') for line in open('/proc/meminfo'))
    used = (int(info['MemTotal'].split()[0]) - int(info['MemAvailable'].split()[0])) // 1024
    return used, sum(int(open(f).read()) for f in glob.glob('/sys/class/drm/card*/device/mem_info_*_used') if 'vis' not in f) // 2**20


WINDOWS = ("JSON.stringify(global.get_window_actors().map(a => { const w = a.meta_window, r = w.get_frame_rect(), b = w.get_buffer_rect(),"
           " t = w.get_transient_for(); return { id: w.get_id(), type: w.get_window_type(), x: r.x, y: r.y, w: r.width, h: r.height,"
           " left: r.x - b.x, top: r.y - b.y, parent: t ? t.get_id() : null } }))")
shell('Main.overview.hide()')
subprocess.Popen(['gnome-text-editor'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(4)
win = json.loads(shell(WINDOWS))[0]
rd = call(RD, '/org/gnome/Mutter/RemoteDesktop', RD, 'CreateSession').unpack()[0]
rd_id = bus.call_sync(RD, rd, 'org.freedesktop.DBus.Properties', 'Get', GLib.Variant('(ss)', (RD + '.Session', 'SessionId')), None, 0, 5000, None).unpack()[0]
sc = call(SC, '/org/gnome/Mutter/ScreenCast', SC, 'CreateSession', GLib.Variant('(a{sv})', ({'remote-desktop-session-id': GLib.Variant('s', rd_id)},))).unpack()[0]
stream = call(SC, sc, SC + '.Session', 'RecordWindow', GLib.Variant('(a{sv})', ({'window-id': GLib.Variant('t', win['id']), 'cursor-mode': GLib.Variant('u', cursor)},))).unpack()[0]
node = []
bus.signal_subscribe(SC, SC + '.Stream', 'PipeWireStreamAdded', stream, None, 0, lambda *a: node.append(a[5].unpack()[0]))
call(RD, rd, RD + '.Session', 'Start')
end = time.time() + 5
while not node and time.time() < end:
    GLib.MainContext.default().iteration(False); time.sleep(0.05)


def point(x, y):  # a point of the window, through the window's own stream (whose picture starts at the shadow)
    call(RD, rd, RD + '.Session', 'NotifyPointerMotionAbsolute', GLib.Variant('(sdd)', (stream, float(win['left'] + x), float(win['top'] + y))))


def press(code=272):
    for down in (True, False):
        call(RD, rd, RD + '.Session', 'NotifyPointerButton', GLib.Variant('(ib)', (code, down))); time.sleep(0.12)


def key(code):
    for down in (True, False):
        call(RD, rd, RD + '.Session', 'NotifyKeyboardKeycode', GLib.Variant('(ub)', (code, down))); time.sleep(0.04)


src, frame = f'pipewiresrc path={node[0]} keepalive-time=34', f'{out}/frame.jpg'
encoder = 'vaapih264enc rate-control=cbr bitrate=8000 keyframe-period=60 max-bframes=0 ! identity silent=false ! fakesink'
pipeline = {
    'dmabuf': f'{src} ! video/x-raw(memory:DMABuf),format=BGRx,max-framerate=60/1 ! vaapipostproc ! {encoder}',  # as the monitors are sent
    'plain': f'{src} ! videoconvert ! identity silent=false ! jpegenc ! multifilesink location={frame}',
    'plain-h264': f'{src} ! videoconvert ! video/x-raw,format=NV12 ! {encoder}',  # converted on the processor, compressed by the graphics card
}[mode]
env = {'XDG_RUNTIME_DIR': os.environ['XDG_RUNTIME_DIR'], 'PATH': '/usr/bin:/bin'}
point(350, 300); time.sleep(0.3); press()  # the text takes the keyboard
before = memory()
gst = subprocess.Popen(['gst-launch-1.0', '-v', *pipeline.split()], env=env, stdout=open(f'{out}/gst.log', 'w'), stderr=subprocess.STDOUT)
time.sleep(2)
for second in range(seconds):
    for code in (30, 31, 32, 33, 34, 35, 36, 37):
        key(code)
        if 'pointer' in sys.argv:
            point(150 + 40 * (code - 30), 200 + 10 * (second % 8))
    now = memory()
    print(f'{second + 1} s: frames {open(out + "/gst.log").read().count("chain")}, pipeline alive {gst.poll() is None}, memory {now[0] - before[0]:+d} MB, graphics {now[1] - before[1]:+d} MB', flush=True)
if 'menu' in sys.argv and mode == 'plain':
    point(637, 22); time.sleep(0.3); press(); time.sleep(1.5)  # the menu button of the text editor
    print('windows with the menu open:', shell(WINDOWS), flush=True)
    shutil.copy(frame, f'{out}/window_stream.jpg')
    call('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot', 'org.gnome.Shell.Screenshot', 'Screenshot', GLib.Variant('(bbs)', (True, False, f'{out}/whole_screen.png')))
if 'popup' in sys.argv:  # a menu is a window of its own: how soon can it be shown as a stream of its own?
    point(637, 22); time.sleep(0.3); press(); time.sleep(1.0)  # the menu button of the text editor
    popup = next((w for w in json.loads(shell(WINDOWS)) if w['parent'] == win['id']), None)
    print('the menu as a window:', popup, flush=True)
    if popup:
        asked = time.time()
        sc2 = call(SC, '/org/gnome/Mutter/ScreenCast', SC, 'CreateSession', GLib.Variant('(a{sv})', ({},))).unpack()[0]
        stream2 = call(SC, sc2, SC + '.Session', 'RecordWindow', GLib.Variant('(a{sv})', ({'window-id': GLib.Variant('t', popup['id']), 'cursor-mode': GLib.Variant('u', 0)},))).unpack()[0]
        node2 = []
        bus.signal_subscribe(SC, SC + '.Stream', 'PipeWireStreamAdded', stream2, None, 0, lambda *a: node2.append(a[5].unpack()[0]))
        call(SC, sc2, SC + '.Session', 'Start')
        while not node2 and time.time() < asked + 5:
            GLib.MainContext.default().iteration(False); time.sleep(0.01)
        ready = time.time()
        src2 = f'pipewiresrc path={node2[0]} keepalive-time=34'
        fast = subprocess.Popen(['gst-launch-1.0', '-v', *f'{src2} ! video/x-raw(memory:DMABuf),format=BGRx,max-framerate=60/1 ! vaapipostproc ! {encoder}'.split()],
                                env=env, stdout=open(f'{out}/popup.log', 'w'), stderr=subprocess.STDOUT)
        while 'chain' not in open(f'{out}/popup.log').read() and time.time() < ready + 6 and fast.poll() is None:
            time.sleep(0.01)
        first = time.time()
        text = open(f'{out}/popup.log').read()
        print(f'menu stream: offered by GNOME after {ready - asked:.2f} s, first compressed frame after {first - asked:.2f} s, encoder alive {fast.poll() is None};',
              text[text.find('caps = video/x-raw(memory:DMABuf)'):][:110].replace('\n', ' '), flush=True)
        time.sleep(1)
        print('menu stream frames after 1 s more:', open(f'{out}/popup.log').read().count('chain'), flush=True)
        fast.terminate()
        look = subprocess.Popen(['gst-launch-1.0', '-q', *f'{src2} ! videoconvert ! jpegenc ! multifilesink location={out}/popup.jpg'.split()], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5); look.terminate()
        call('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot', 'org.gnome.Shell.Screenshot', 'Screenshot', GLib.Variant('(bbs)', (True, False, f'{out}/whole_screen.png')))
log = open(f'{out}/gst.log').read()
if gst.poll() is not None:
    print('pipeline died:', log[log.find('ERROR'):][:170].replace('\n', ' '), flush=True)
gst.terminate()
call(RD, rd, RD + '.Session', 'Stop')
time.sleep(1)
after = memory()
print(f'after stopping: memory {after[0] - before[0]:+d} MB, graphics {after[1] - before[1]:+d} MB', flush=True)
