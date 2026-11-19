#!/usr/bin/python3
"""Shows single application windows in the headset, each as a video stream of its own, and works them from there:
the pointer, the mouse buttons, the wheel and keys go into the window they are meant for.

Started by server.js, which tells it what to do on standard input, one JSON object per line:
  {"streams": {"w0": {"id": 123, "left": 61, "top": 55}}}   the windows to stream now, by GNOME's window id;
                                                             left/top: where the window starts inside its picture
  {"to": "w0", "x": 350, "y": 20}                           the pointer goes to this point of the window
  {"to": "w0", "button": 272, "down": true}                 a mouse button (Linux codes: 272 left, 273 right)
  {"to": "w0", "wheel": 1}                                  the wheel, in clicks, positive scrolls down
  {"to": "w0", "key": 30, "down": true}                     a key (Linux key code)
and answers on standard output in the same way: {"slot": "w0", "live": true}.

Every window gets its own pair of GNOME sessions, one that records and one that controls: only so can the pointer
be put at a point of that window's picture. The picture is asked for without the pointer in it. With the pointer
drawn in, GNOME's frames cannot stay on the graphics card and the encoder used for the monitors fails on them; the
headset draws its own pointer anyway. A popup menu is a window of its own to GNOME and is not in the picture.
"""
import json, os, signal, subprocess, sys, time
from gi.repository import GLib
from capture import ENV, LOW_MEMORY_MB, bus, mutter

streams = {}  # slot -> {id, left, top, control (session), stream (path), watch, encoder}


def say(**what):
    print(json.dumps(what), flush=True)


def start(slot, window, tries=0):
    control = mutter('RemoteDesktop', '/org/gnome/Mutter/RemoteDesktop', 'CreateSession')[0]
    name = bus.call_sync('org.gnome.Mutter.RemoteDesktop', control, 'org.freedesktop.DBus.Properties', 'Get',
                         GLib.Variant('(ss)', ('org.gnome.Mutter.RemoteDesktop.Session', 'SessionId')), None, 0, -1, None).unpack()[0]
    record = mutter('ScreenCast', '/org/gnome/Mutter/ScreenCast', 'CreateSession', GLib.Variant('(a{sv})', ({'remote-desktop-session-id': GLib.Variant('s', name)},)))[0]
    stream = mutter('ScreenCast', record, 'RecordWindow', GLib.Variant('(a{sv})', ({'window-id': GLib.Variant('t', window['id']), 'cursor-mode': GLib.Variant('u', 0)},)))[0]
    entry = streams[slot] = {**window, 'control': control, 'stream': stream, 'encoder': None, 'since': time.monotonic(), 'tries': tries}

    def on_stream(_bus, _sender, _path, _interface, _signal, parameters):
        # The same encoder as for the monitors (see capture.py for the why of every setting), but a full picture
        # twice as often: a window comes into the headset while its stream runs (a dialog opens), and the headset
        # can start showing only from a full picture. A still window sends 30 frames a second: one second at most.
        entry['encoder'] = subprocess.Popen((
            f'gst-launch-1.0 -q pipewiresrc path={parameters.unpack()[0]} keepalive-time=34'
            ' ! video/x-raw(memory:DMABuf),format=BGRx,max-framerate=60/1 ! vaapipostproc'
            ' ! vaapih264enc rate-control=cbr bitrate=12000 keyframe-period=30 max-bframes=0'
            ' ! video/x-h264,profile=constrained-baseline'
            f' ! h264parse ! flvmux streamable=true ! rtmp2sink location=rtmp://127.0.0.1:1935/vr/{slot}').split(), env=ENV)
        say(slot=slot, live=True)
    entry['watch'] = bus.signal_subscribe('org.gnome.Mutter.ScreenCast', 'org.gnome.Mutter.ScreenCast.Stream', 'PipeWireStreamAdded', stream, None, 0, on_stream)
    mutter('RemoteDesktop', control, 'Start')  # starts the recording with it


def stop(slot, quiet=False):
    entry = streams.pop(slot)
    bus.signal_unsubscribe(entry['watch'])
    if entry['encoder']:
        entry['encoder'].terminate()
    try:
        mutter('RemoteDesktop', entry['control'], 'Stop')
    except GLib.Error:
        pass  # GNOME closed it already, with the window
    if not quiet:
        say(slot=slot, live=False)


def act(order):
    if 'streams' in order:
        wanted = order['streams']
        for slot in [s for s in streams if s not in wanted or wanted[s]['id'] != streams[s]['id']]:
            stop(slot)
        for slot, window in wanted.items():
            window = {'id': int(window['id']), 'left': float(window['left']), 'top': float(window['top'])}
            if slot in streams:
                streams[slot].update(window)  # the window was resized: its shadow may have changed
            else:
                start(slot, window)
        return
    entry = streams.get(order.get('to'))
    if not entry:
        return
    control = entry['control']
    if 'x' in order:
        mutter('RemoteDesktop', control, 'NotifyPointerMotionAbsolute', GLib.Variant('(sdd)', (entry['stream'], float(order['x']) + entry['left'], float(order['y']) + entry['top'])))
    if 'button' in order:
        mutter('RemoteDesktop', control, 'NotifyPointerButton', GLib.Variant('(ib)', (int(order['button']), bool(order['down']))))
    if 'wheel' in order:
        mutter('RemoteDesktop', control, 'NotifyPointerAxisDiscrete', GLib.Variant('(ui)', (0, int(order['wheel']))))
    if 'key' in order:
        mutter('RemoteDesktop', control, 'NotifyKeyboardKeycode', GLib.Variant('(ub)', (int(order['key']), bool(order['down']))))


def main():
    loop, pending = GLib.MainLoop(), ['']

    def on_input(source, condition):
        data = os.read(source, 65536) if condition & GLib.IO_IN else b''
        if not data:  # server.js is gone
            loop.quit()
            return False
        *lines, pending[0] = (pending[0] + data.decode()).split('\n')
        for line in lines:
            try:
                act(json.loads(line))
            except (ValueError, TypeError, KeyError, GLib.Error) as error:  # a bad order, or its window has just closed
                print(f'windows.py: {line[:120]}: {error}', file=sys.stderr)
        return True

    def watch():
        for slot, entry in [(s, e) for s, e in streams.items() if e['encoder'] and e['encoder'].poll() is not None]:
            # The window was closed, or the stream failed. In its first seconds that happens to windows that stay
            # ("target not found": the stream was gone before the encoder reached it), so it is asked for again,
            # twice at most. After that the window leaves the headset.
            again = time.monotonic() - entry['since'] < 10 and entry['tries'] < 2
            print(f"windows.py: {slot}: the stream of window {entry['id']} ended{', asked for again' if again else ''}", file=sys.stderr)
            stop(slot, quiet=again)
            if again:
                try:
                    start(slot, {k: entry[k] for k in ('id', 'left', 'top')}, entry['tries'] + 1)
                except GLib.Error:  # the window is gone after all
                    say(slot=slot, live=False)
        available = int(next(line for line in open('/proc/meminfo') if line.startswith('MemAvailable')).split()[1]) // 1024
        if streams and available < LOW_MEMORY_MB:  # as in capture.py: a frozen computer is worse than a frozen picture
            print(f'windows.py: only {available} MB of memory left, the windows are no longer streamed', file=sys.stderr)
            for slot in list(streams):
                stop(slot)
        return True

    GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN | GLib.IO_HUP, on_input)
    GLib.timeout_add_seconds(1, watch)
    for sig in signal.SIGINT, signal.SIGTERM:
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, loop.quit)
    try:
        loop.run()
    finally:
        for slot in list(streams):
            stop(slot)


if __name__ == '__main__':
    main()
