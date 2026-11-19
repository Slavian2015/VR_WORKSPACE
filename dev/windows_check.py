#!/usr/bin/python3
"""Checks windows.py by itself. Run INSIDE the session of iso.sh (with PIPEWIRE=1), with a staged copy of the
project (stage.sh) whose MediaMTX is running:

  windows_check.py <staged folder>

Opens a text editor, has windows.py stream it, looks for the stream in MediaMTX, sends the pointer to the editor's
menu button and a click, and reports where the pointer went and whether the menu opened.
"""
import json, os, subprocess, sys, time
from gi.repository import Gio, GLib

stage = sys.argv[1]
bus = Gio.bus_get_sync(Gio.BusType.SESSION)


def shell(js):
    ok, text = bus.call_sync('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval', GLib.Variant('(s)', (js,)), None, 0, 5000, None).unpack()
    return json.loads(text) if ok and text else text


WINDOWS = ("JSON.stringify(global.get_window_actors().map(a => { const w = a.meta_window, r = w.get_frame_rect(), b = w.get_buffer_rect(),"
           " t = w.get_transient_for(); return { id: w.get_id(), x: r.x, y: r.y, w: r.width, h: r.height, left: r.x - b.x, top: r.y - b.y,"
           " parent: t ? t.get_id() : null } }))")
used = lambda: (lambda info: (int(info['MemTotal'].split()[0]) - int(info['MemAvailable'].split()[0])) // 1024)(dict(line.split(':') for line in open('/proc/meminfo')))
shell('Main.overview.hide()')
subprocess.Popen(['gnome-text-editor'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(4)
win = json.loads(shell(WINDOWS))[0]
before = used()
module = subprocess.Popen([f'{stage}/windows.py'], cwd=stage, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=open(f'{stage}/windows.log', 'w'), text=True, bufsize=1)
tell = lambda **order: (module.stdin.write(json.dumps(order) + '\n'), module.stdin.flush())
tell(streams={'w0': {'id': win['id'], 'left': win['left'], 'top': win['top']}})
print('module says:', module.stdout.readline().strip(), flush=True)
time.sleep(3)
probe = subprocess.run(['ffprobe', '-v', 'error', '-rtsp_transport', 'tcp', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0',
                        'rtsp://127.0.0.1:18554/vr/w0'], capture_output=True, text=True, timeout=15)
print('the stream in MediaMTX:', probe.stdout.strip() or probe.stderr.strip()[:150], flush=True)
for step in range(6):  # to the menu button of the text editor, as a real mouse arrives: a run of small movements.
    tell(to='w0', x=607 + step * 6, y=22); time.sleep(0.03)  # (a click right after one far jump is ignored by the application)
time.sleep(0.4)
at = json.loads(shell('JSON.stringify(global.get_pointer().slice(0, 2))'))
print('pointer asked to window point (637, 22), it is at window point', (at[0] - win['x'], at[1] - win['y']), flush=True)
tell(to='w0', button=272, down=True); time.sleep(0.1); tell(to='w0', button=272, down=False)
time.sleep(1.2)
print('menu opened:', any(w['parent'] == win['id'] for w in json.loads(shell(WINDOWS))), flush=True)
tell(to='w0', button=272, down=True); time.sleep(0.1); tell(to='w0', button=272, down=False)  # closes the menu
time.sleep(0.5)
for step in range(6):
    tell(to='w0', x=270 + step * 6, y=300); time.sleep(0.03)
tell(to='w0', button=272, down=True); time.sleep(0.1); tell(to='w0', button=272, down=False)
time.sleep(0.3)
for code in (35, 23):  # "hi"
    tell(to='w0', key=code, down=True); tell(to='w0', key=code, down=False)
time.sleep(0.8)
print('typed text reached the window, its title is now:', shell('global.get_window_actors()[0].meta_window.get_title()'), flush=True)
tell(to='nothing', x=1, y=1)  # an order for a window that is not streamed is ignored
tell(streams={})
print('module says:', module.stdout.readline().strip(), flush=True)
module.stdin.close()
print('module ended with', module.wait(timeout=5), '; memory', f'{used() - before:+d} MB;', 'its complaints:', open(f'{stage}/windows.log').read().strip()[:300] or 'none', flush=True)
