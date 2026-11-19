#!/usr/bin/python3
"""Carries out actions in the GNOME Shell of the current D-Bus session (the isolated one that iso.sh starts).

usage: drive.py <folder for screenshots> <file with one action per line>

  eval:<js>          run JavaScript inside the shell and print the result (needs the test extension of iso.sh)
  shot:<name>        screenshot into <folder>/<name>.png
  prefs              open the settings window of the project's extension
  move:x,y           put the pointer there
  click:x,y          left click there
  drag:x1,y1,x2,y2   press, move, release
  down / up          press / release the left button where the pointer is
  wiggle:<seconds>   move the pointer about
  scroll:<clicks>    wheel, positive scrolls a page down
  key:<code>         press and release a key (Linux key code: 1 Esc, 69 Num Lock, 2..11 the digits 1..0);
                     key:29+24 holds the first while the second is pressed (Ctrl+O)
  sh:<command>       run a shell command and print its output
  wait:<seconds>
"""
import subprocess, sys, time
from gi.repository import Gio, GLib

bus = Gio.bus_get_sync(Gio.BusType.SESSION)


def call(name, path, iface, method, args=None, timeout=4000):
    return bus.call_sync(name, path, iface, method, args, None, 0, timeout, None)


N = 'org.gnome.Mutter.RemoteDesktop'
S = N + '.Session'
session = call(N, '/org/gnome/Mutter/RemoteDesktop', N, 'CreateSession').unpack()[0]
call(N, session, S, 'Start')
out, started = sys.argv[1], time.time()
button = lambda down: call(N, session, S, 'NotifyPointerButton', GLib.Variant('(ib)', (272, down)))
move = lambda dx, dy: call(N, session, S, 'NotifyPointerMotionRelative', GLib.Variant('(dd)', (float(dx), float(dy))))


def goto(x, y):  # the far corner first, where nothing reacts to the pointer, then the way back: positions stay exact
    move(20000, 20000)
    time.sleep(0.2)
    width, height = eval(call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval', GLib.Variant('(s)', ('[global.stage.width, global.stage.height]',))).unpack()[1])
    move(x - (width - 1), y - (height - 1))


for action in open(sys.argv[2]).read().split('\n'):
    kind, _, arg = action.partition(':')
    try:
        if kind == 'eval':
            answer = call('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval', GLib.Variant('(s)', (arg,))).unpack()
            print(f'{time.time() - started:5.1f} eval {arg[:90]} -> {str(answer)[:400]}', flush=True)
        elif kind == 'shot':
            call('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot', 'org.gnome.Shell.Screenshot', 'Screenshot', GLib.Variant('(bbs)', (True, False, f'{out}/{arg}.png')))
        elif kind == 'prefs':
            call('org.gnome.Shell.Extensions', '/org/gnome/Shell/Extensions', 'org.gnome.Shell.Extensions', 'OpenExtensionPrefs', GLib.Variant('(ssa{sv})', ('vr-workspace@local', '', {})))
        elif kind in ('move', 'click'):
            goto(*map(float, arg.split(',')))
            if kind == 'click':
                time.sleep(0.2)
                button(True); time.sleep(0.08); button(False)
        elif kind == 'drag':
            x1, y1, x2, y2 = map(float, arg.split(','))
            goto(x1, y1); time.sleep(0.2)
            button(True); time.sleep(0.1)
            for _ in range(20):
                move((x2 - x1) / 20, (y2 - y1) / 20); time.sleep(0.02)
            time.sleep(0.2)
            button(False)
        elif kind in ('down', 'up'):
            button(kind == 'down')
        elif kind == 'wiggle':
            end, i = time.time() + float(arg), 0
            while time.time() < end:
                i += 1
                move(7 if i % 40 < 20 else -7, 3 if i % 30 < 15 else -3); time.sleep(0.008)
        elif kind == 'scroll':
            for _ in range(abs(int(arg))):
                call(N, session, S, 'NotifyPointerAxisDiscrete', GLib.Variant('(ui)', (0, 1 if int(arg) > 0 else -1))); time.sleep(0.05)
        elif kind == 'key':
            codes = [int(code) for code in arg.split('+')]
            for code, down in [(code, True) for code in codes] + [(code, False) for code in reversed(codes)]:
                call(N, session, S, 'NotifyKeyboardKeycode', GLib.Variant('(ub)', (code, down))); time.sleep(0.05)
        elif kind == 'sh':
            print(f'{time.time() - started:5.1f} sh {arg[:70]} -> {subprocess.run(arg, shell=True, capture_output=True, text=True).stdout.strip()[:1500]}', flush=True)
        elif kind == 'wait':
            time.sleep(float(arg))
    except Exception as error:  # an action that failed is a result too
        print(f'{time.time() - started:5.1f} {kind} FAILED: {str(error)[:200]}', flush=True)
    time.sleep(0.3)
try:
    call(N, session, S, 'Stop')
except GLib.Error:
    pass
