#!/usr/bin/python3
"""Started by MediaMTX when the first viewer connects and stopped by it after the last one leaves.

Asks GNOME (Mutter) for a video stream of every real monitor and for extra virtual monitors, encodes each stream
on the GPU and publishes it to MediaMTX, and separately publishes the sound of a virtual audio output "VR Headset".
The virtual monitors and the audio output exist only while this runs, like devices that are plugged in.
Picture and sound are separate streams on purpose: played in sync, the picture would wait about 70 ms for the sound.

`capture.py --list` prints the monitors and the limit as JSON; server.js shows them to the pages.
System python on purpose (see the first line): the project venv has no GNOME bindings.
"""
import functools, itertools, json, os, signal, subprocess, sys, time, urllib.request
from gi.repository import Gio, GLib

ROOT = os.path.dirname(os.path.abspath(__file__))
SLOTS = 4  # most monitors shown at once: each is a 1080p60 stream the phone must decode. The only place for this limit.
VIRTUAL_SIZES = ['1920x1080', '2560x1080', '2560x1440', '3440x1440']  # the first is the default; H.264 allows up to 4096 wide
SINK = 'vr_headset'
SLOT_YAW = [0, 95, -95, 190]  # where monitors stand in the sphere until the user moves them; the same list is in app/params.js
DISPLAY_CONFIG = '/org/gnome/Mutter/DisplayConfig'
LOW_MEMORY_MB = 2000  # below this the capture stops itself: a frozen computer is worse than a frozen picture
# Shells started from the VS Code snap point GIO at the snap's modules; GStreamer crashes when it loads them.
ENV = {k: v for k, v in os.environ.items() if k != 'GIO_MODULE_DIR'}

bus = Gio.bus_get_sync(Gio.BusType.SESSION)


def mutter(service, path, method, args=None):
    interface = f'org.gnome.Mutter.{service}' + ('.Session' if 'Session/' in path else '')
    return bus.call_sync(f'org.gnome.Mutter.{service}', path, interface, method, args, None, 0, -1, None).unpack()


def settings():
    try:
        return json.load(open(os.path.join(ROOT, 'params.json')))
    except (OSError, ValueError):
        return {}


def monitors():
    """Connector names of the real monitors, primary first, then 'virtual' as many times as the settings ask."""
    _, physical, logical, _ = mutter('DisplayConfig', DISPLAY_CONFIG, 'GetCurrentState')
    virtual = {spec[0] for spec, _, _ in physical if spec[1] == 'MetaVendor'}  # ours from a run that is still alive
    active = [(not primary, spec[0]) for _, _, _, _, primary, specs, _ in logical for spec in specs if spec[0] not in virtual]
    real = [name for _, name in sorted(active)][:SLOTS]
    try:
        wanted = int(settings().get('virtual', 1))
    except (ValueError, TypeError):
        wanted = 1
    return real + ['virtual'] * max(0, min(wanted, SLOTS - len(real)))


def virtual_size(saved, i):
    """[width, height] to ask for virtual monitor i: its own setting, else the one for all, else the first listed.
    Only listed sizes pass, because the numbers go into a command line."""
    return next((s for s in (saved.get(f'm{i}.size'), saved.get('virtualSize')) if s in VIRTUAL_SIZES), VIRTUAL_SIZES[0]).split('x')


def place_in_sphere(saved, i):
    """Where monitor i stands according to the saved settings: (yaw, pitch, the width it is seen at), in degrees."""
    try:
        yaw, pitch = float(saved.get(f'm{i}.yaw', SLOT_YAW[i])), float(saved.get(f'm{i}.pitch', 0))
        # the setting is its width from 1.5 m: nearer it looks wider. 'dist' is the old distance, one for all.
        span = float(saved.get(f'm{i}.span', 90)) * 1.5 / float(saved.get(f'm{i}.dist', saved.get('dist', 1.5)))
    except (TypeError, ValueError, ZeroDivisionError):
        return SLOT_YAW[i], 0, 90
    return yaw, pitch, min(170, max(10, span))


@functools.lru_cache(maxsize=8)  # asked again at every change of any setting, with the same monitors
def system_layout(monitors):
    """Where to put the monitors in GNOME so that the pointer crosses between them the way they stand in the sphere.

    monitors: ((name, width, height, yaw, pitch, span), ...), the primary first; width and height in pixels, yaw
    grows to the right and pitch up, span is the width the monitor is seen at, all in degrees.
    Returns {name: (x, y)}: nothing overlaps, every monitor touches another, the top left corner of the whole is
    (0, 0), as GNOME requires.

    Every way of standing the monitors side by side or one above another is tried, and the one that keeps most of
    what is seen in the sphere wins: two monitors seen next to each other share an edge, on the side they are seen
    on, and the rest at least lie in the right direction. (Taking the nearest monitor one at a time, as before, put
    a monitor seen on the right under its neighbour, because a third one above was a little nearer.)"""
    turn = lambda a, b: (b - a + 180) % 360 - 180  # the short way round from yaw a to yaw b
    count = len(monitors)
    size = [(w, h) for _, w, h, _, _, _ in monitors]
    # How each pair stands in the sphere: across which edge they are neighbours (0: side by side, 1: one above the
    # other), in which direction, how much that counts (less with a gap between them), the offset of j from i in
    # degrees, and how many pixels a degree is for the two.
    seen = {}
    for i, j in itertools.combinations(range(count), 2):
        (_, wi, hi, yaw_i, pitch_i, span_i), (_, wj, hj, yaw_j, pitch_j, span_j) = monitors[i], monitors[j]
        dx, dy = turn(yaw_i, yaw_j), pitch_j - pitch_i
        wide, tall = (span_i + span_j) / 2, (span_i * hi / wi + span_j * hj / wj) / 2  # centres this far apart: they touch
        axis = 0 if abs(dx) / wide >= abs(dy) / tall else 1  # further apart sideways, by their own measure: side by side
        weight = (1.5 if i == 0 else 1) / (1 + max(abs(dx) - wide, abs(dy) - tall, 0) / 15)  # the primary's neighbours first
        seen[i, j] = (axis, (dx, dy)[axis] >= 0, weight, (dx, dy), (wi / span_i + wj / span_j) / 2)

    def score(at):
        total = 0
        for (i, j), (axis, positive, weight, offset, per_degree) in seen.items():
            (xi, yi), (wi, hi), (xj, yj), (wj, hj) = at[i], size[i], at[j], size[j]
            if axis == 0:
                touching = xj == xi + wi if positive else xj + wj == xi
                shared, least = min(yi + hi, yj + hj) - max(yi, yj), min(hi, hj)
                ordered = (xj + wj / 2 > xi + wi / 2) == positive
                across, wanted = (yj + hj / 2) - (yi + hi / 2), -offset[1] * per_degree  # up is a smaller y
            else:
                touching = yj + hj == yi if positive else yj == yi + hi
                shared, least = min(xi + wi, xj + wj) - max(xi, xj), min(wi, wj)
                ordered = (yj + hj / 2 < yi + hi / 2) == positive
                across, wanted = (xj + wj / 2) - (xi + wi / 2), offset[0] * per_degree
            if touching and shared >= least / 4:  # an edge long enough to find with the pointer
                total += weight * (10 - min(1, abs(across - wanted) / least))  # and shifted along it as in the sphere
            elif ordered:
                total += weight
            else:
                total -= 5 * weight
        return total

    best = None
    for order in itertools.permutations(range(1, count)):  # the primary stays first, the rest join in any order
        def place(done, at):
            nonlocal best
            if done == len(order):
                value = score(at)
                if best is None or value > best[0]:
                    best = (value, dict(at))
                return
            k = order[done]
            w, h = size[k]
            for a in at:
                axis, positive, _, offset, per_degree = seen[min(a, k), max(a, k)]
                dx, dy = (offset[0], offset[1]) if a < k else (-offset[0], -offset[1])  # of k from a
                (ax, ay), (aw, ah) = at[a], size[a]
                for side in ((1 if dx >= 0 else -1), 0), (0, (-1 if dy >= 0 else 1)):  # the two sides it is seen towards
                    if side[0]:
                        x, low, high, middle = (ax + aw if side[0] > 0 else ax - w), ay - h + min(h, ah) // 4, ay + ah - min(h, ah) // 4, ay + (ah - h) // 2
                        shifted = middle - round(dy * per_degree)
                    else:
                        y, low, high, middle = (ay + ah if side[1] > 0 else ay - h), ax - w + min(w, aw) // 4, ax + aw - min(w, aw) // 4, ax + (aw - w) // 2
                        shifted = middle + round(dx * per_degree)
                    # along the edge: as far as in the sphere, in the middle, or flush with either end
                    for along in dict.fromkeys((max(low, min(high, shifted)), middle, (ay if side[0] else ax), (ay + ah - h if side[0] else ax + aw - w))):
                        if side[0]:
                            y = along
                        else:
                            x = along
                        if any(x < px + size[p][0] and px < x + w and y < py + size[p][1] and py < y + h for p, (px, py) in at.items()):
                            continue
                        at[k] = (x, y)
                        place(done + 1, at)
                        del at[k]
        place(0, {0: (0, 0)})
    at = best[1]
    left, top = min(x for x, _ in at.values()), min(y for _, y in at.values())
    return {monitors[i][0]: (x - left, y - top) for i, (x, y) in at.items()}


def memory_action(available_mb, capturing):
    """What the low-memory guard does: 'stop' the capture when memory runs out; once it has stopped, 'leave' when
    there is room again, so that MediaMTX starts a fresh capture. The gap between the two limits prevents flapping."""
    if capturing:
        return 'stop' if available_mb < LOW_MEMORY_MB else None
    return 'leave' if available_mb > 2 * LOW_MEMORY_MB else None


def remove_output():
    modules = subprocess.run(['pactl', 'list', 'short', 'modules'], capture_output=True, text=True).stdout
    for line in modules.splitlines():
        if f'sink_name={SINK}' in line:
            subprocess.run(['pactl', 'unload-module', line.split()[0]])


def main():
    # A capture that keeps ending is not started again at once. Every start adds virtual monitors and every end
    # removes them, and GNOME Shell crashed on 2026-11-18 when that happened three times in half a minute.
    stamp = os.path.join(os.environ.get('XDG_RUNTIME_DIR', '/tmp'), 'vr-workspace-capture')
    try:
        wait = 30 - (time.time() - os.stat(stamp).st_mtime)
    except OSError:
        wait = 0  # the first start
    if wait > 0:
        print(f'capture.py: started again {30 - wait:.0f} s after the last start, waiting {wait:.0f} s', file=sys.stderr)
        try:
            time.sleep(wait)
        except KeyboardInterrupt:  # MediaMTX gave up waiting for the picture; it starts us again when asked
            sys.exit()
    open(stamp, 'w').close()
    sources = monitors()
    saved = settings()
    children = []  # processes that must stay alive: if one dies, everything stops and MediaMTX starts us again

    def spawn(command):
        children.append(subprocess.Popen(command.split(), env=ENV))
        return children[-1]

    def encode(i):
        size = ',width={},height={}'.format(*virtual_size(saved, i)) if sources[i] == 'virtual' else ''  # a virtual monitor takes the size we ask for
        # keepalive-time: GNOME sends frames only when the screen changes. The last one is repeated after 34 ms of
        # silence, so a still screen gives ~30 fps and a new viewer gets a key frame within 2 s (keyframe-period=60).
        # Not 17 ms: then repeats also land between real frames (72 fps measured with the pointer moving) and only
        # load the phone's decoder. (videorate cannot cap it: it aborts on these frames, they carry no duration.)
        # max-bframes=0: WebRTC cannot play B-frames.
        # Variable bitrate, 20 Mbit/s at most: a still screen of text took 0.7 Mbit/s instead of the 19 of a constant
        # rate, for the same picture (this encoder, 2026-11-20). A constant 20 for each monitor was 18 GB an hour on a
        # mobile network, and kept the Wi-Fi busy for nothing.
        # memory:DMABuf is essential: frames stay on the GPU. Asked for plain memory, GNOME allocates a new GPU texture
        # for every frame of a virtual monitor and keeps them: moving the pointer there ate 30 GB of RAM in a minute.
        # The older vaapi* elements are used because the newer va* ones cannot take these DMA-BUF frames (GStreamer 1.24).
        return spawn(f'gst-launch-1.0 -q pipewiresrc path={nodes[i]} keepalive-time=34'
                     f' ! video/x-raw(memory:DMABuf),format=BGRx{size},max-framerate=60/1 ! vaapipostproc'
                     ' ! vaapih264enc rate-control=vbr bitrate=20000 keyframe-period=60 max-bframes=0'
                     ' ! video/x-h264,profile=constrained-baseline'
                     f' ! h264parse ! flvmux streamable=true ! rtmp2sink location=rtmp://127.0.0.1:1935/vr/m{i}')

    def new_session():
        session = mutter('ScreenCast', '/org/gnome/Mutter/ScreenCast', 'CreateSession', GLib.Variant('(a{sv})', ({},)))[0]
        bus.signal_subscribe('org.gnome.Mutter.ScreenCast', 'org.gnome.Mutter.ScreenCast.Session', 'Closed', session, None, 0, on_closed)
        return session

    ours = set()                               # sessions we end ourselves
    halted = {'by': None}                      # GNOME ended a session: 'lock' (the screen is locked) or 'button'

    def allowed():
        """Does GNOME let screens be recorded now? It refuses while the screen is locked."""
        try:
            probe = mutter('ScreenCast', '/org/gnome/Mutter/ScreenCast', 'CreateSession', GLib.Variant('(a{sv})', ({},)))[0]
        except GLib.Error:
            return False
        mutter('ScreenCast', probe, 'Stop')
        return True

    def on_closed(_bus, _sender, session, _interface, _signal, _parameters):
        """GNOME ended a recording without being asked: its "stop sharing" button in the top bar was pressed, or the
        screen was locked. Starting again at once, as after an encoder that died, would work against the user and
        make the virtual monitors come and go. So everything is let go. After a lock the capture comes back when
        recording is allowed again; after the button VR Workspace is switched off, as the user asked."""
        if session in ours or halted['by']:
            return
        halted['by'] = 'pending'  # the sessions that stand_down ends must not bring us here again
        stand_down()
        halted['by'] = 'button' if allowed() else 'lock'
        if halted['by'] == 'button':
            print('capture.py: GNOME stopped the sharing of the screen: VR Workspace switches itself off', file=sys.stderr)
            try:
                urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8080/stop', method='POST'), timeout=2)
            except OSError:
                pass  # the server is on its way out already
        else:
            print('capture.py: the screen is locked, the capture waits for it to be unlocked', file=sys.stderr)

    def stand_down():
        for child in children:
            child.terminate()
        children.clear()
        real['encoders'] = []
        for session in virtual_session, real['session']:
            if session:
                ours.add(session)
                try:
                    mutter('ScreenCast', session, 'Stop')
                except (GLib.Error, TypeError):
                    pass  # not started yet, or closed already

    cursor = {'cursor-mode': GLib.Variant('u', 1)}  # 1: the pointer is drawn into the picture
    streams = {}     # D-Bus path of a stream -> index of its monitor
    nodes = {}       # index of the monitor -> PipeWire node of its stream
    connectors = {i: source for i, source in enumerate(sources) if source != 'virtual'}  # index -> name in GNOME;
    # for a virtual monitor the name is learnt when it appears

    # Virtual monitors live in one session for the whole run. "is-platform" makes them ordinary monitors: windows
    # and the pointer can go there.
    virtual_session = new_session()
    for i, source in enumerate(sources):
        if source == 'virtual':
            options = GLib.Variant('(a{sv})', ({**cursor, 'is-platform': GLib.Variant('b', True)},))
            streams[mutter('ScreenCast', virtual_session, 'RecordVirtual', options)[0]] = i

    # Real monitors are recorded last, and again after every change of the arrangement: GNOME closes the stream of
    # a real monitor when monitors move (the streams of virtual ones survive).
    real = {'session': None, 'encoders': []}

    def stop_real():
        for encoder in real['encoders']:
            children.remove(encoder)
            encoder.terminate()
        real['encoders'] = []
        if real['session']:
            ours.add(real['session'])
            try:
                mutter('ScreenCast', real['session'], 'Stop')
            except GLib.Error:
                pass  # GNOME has closed it already

    def record_real():
        stop_real()
        real['session'] = new_session()
        for i, source in enumerate(sources):
            if source != 'virtual':
                streams[mutter('ScreenCast', real['session'], 'RecordMonitor', GLib.Variant('(sa{sv})', (source, cursor)))[0]] = i
        mutter('ScreenCast', real['session'], 'Start')

    def virtual_connectors():
        return {spec[0] for spec, _, _ in mutter('DisplayConfig', DISPLAY_CONFIG, 'GetCurrentState')[1] if spec[1] == 'MetaVendor'}

    def start_virtual():
        """Starts the encoders of the virtual monitors one at a time: GNOME names a virtual monitor when its stream
        gets a consumer, so the one that appears next belongs to the stream just started. Nothing else tells."""
        waiting = [i for i, source in enumerate(sources) if source == 'virtual' and i not in connectors]
        if not waiting:
            return arrange()
        i, before = waiting[0], virtual_connectors()
        encode(i)

        def appeared():
            new = virtual_connectors() - before
            if not new:
                return True  # ask again; if the encoder died instead, watch() ends everything
            connectors[i] = new.pop()
            start_virtual()
            return False
        GLib.timeout_add(100, appeared)

    def on_stream(_bus, _sender, path, _interface, _signal, parameters):
        i = streams.get(path)
        if i is None:
            return  # a stream of another program
        nodes[i] = parameters.unpack()[0]
        if sources[i] != 'virtual':
            real['encoders'].append(encode(i))
        elif all(j in nodes for j, source in enumerate(sources) if source == 'virtual'):
            start_virtual()

    def arrange():
        """Puts the monitors in GNOME the way they stand in the sphere, so the pointer crosses where the eyes expect,
        and makes sure the real monitors are being recorded."""
        if len(connectors) < len(sources):
            return  # not all monitors are up yet
        try:
            serial, physical, logical, _ = mutter('DisplayConfig', DISPLAY_CONFIG, 'GetCurrentState')
            now = {specs[0][0]: (x, y, scale, transform, primary) for x, y, scale, transform, primary, specs, _ in logical}
            if set(now) != set(connectors.values()):
                raise StopIteration('there is a monitor that is not shown in the headset, or mirroring')
            mode = {spec[0]: next(m for m in modes if m[6].get('is-current')) for spec, modes, _ in physical if spec[0] in now}
            saved, sphere = settings(), []
            for i, name in sorted(connectors.items()):
                sphere.append((name, round(mode[name][1] / now[name][2]), round(mode[name][2] / now[name][2]), *place_in_sphere(saved, i)))
            wanted = system_layout(tuple(sphere))
            if any(now[name][:2] != wanted[name] for name in wanted):
                stop_real()  # before GNOME closes their streams itself
                config = [(*wanted[name], now[name][2], now[name][3], now[name][4], [(name, mode[name][0], {})]) for name in wanted]
                # 1: temporary, it is not written to the user's saved monitor arrangements
                mutter('DisplayConfig', DISPLAY_CONFIG, 'ApplyMonitorsConfig', GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', (serial, 1, config, {})))
        except (GLib.Error, StopIteration) as error:
            print(f'capture.py: monitors left as GNOME arranged them: {error}', file=sys.stderr)
        if not real['encoders']:
            record_real()

    bus.signal_subscribe('org.gnome.Mutter.ScreenCast', 'org.gnome.Mutter.ScreenCast.Stream', 'PipeWireStreamAdded', None, None, 0, on_stream)
    if 'virtual' in sources:
        mutter('ScreenCast', virtual_session, 'Start')  # the rest follows from on_stream
    else:
        arrange()

    # The audio output. It becomes the system's output while we run, so that the PC's volume and mute keys act on
    # what the phone plays; the output used before comes back when we leave. The system remembers its volume.
    remove_output()  # left over if a previous run was killed
    usual = subprocess.run(['pactl', 'get-default-sink'], capture_output=True, text=True).stdout.strip()
    subprocess.run(['pactl', 'load-module', 'module-null-sink', f'sink_name={SINK}', 'sink_properties=device.description=VR-Headset'], stdout=subprocess.DEVNULL)
    subprocess.run(['pactl', 'set-default-sink', SINK])
    spawn(f'ffmpeg -hide_banner -loglevel warning -f pulse -fragment_size 1920 -i {SINK}.monitor'
          ' -c:a libopus -b:a 128k -frame_duration 10 -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/vr/audio')

    loop = GLib.MainLoop()
    for sig in signal.SIGINT, signal.SIGTERM:
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, sig, loop.quit)
    seen = [None]  # when the settings file was last looked at

    def watch():
        if halted['by']:  # GNOME ended the recording and nothing runs. After a lock: leave once recording is allowed
            if halted['by'] == 'lock' and allowed():  # again, MediaMTX then starts us afresh. Else: wait to be stopped.
                print('capture.py: the screen is unlocked, the capture starts again', file=sys.stderr)
                loop.quit()
            return True
        if any(child.poll() is not None for child in children):  # an encoder died: leave, MediaMTX starts us again
            loop.quit()
        available = int(next(line for line in open('/proc/meminfo') if line.startswith('MemAvailable')).split()[1]) // 1024
        action = memory_action(available, capturing=bool(children))
        if action == 'stop':  # stay alive but idle, or MediaMTX would start us again at once
            print(f'capture.py: only {available} MB of memory left, capture stopped to keep the computer usable', file=sys.stderr)
            stand_down()
        elif action == 'leave':
            print(f'capture.py: {available} MB of memory again, capture restarts', file=sys.stderr)
            loop.quit()
        try:
            changed = os.stat(os.path.join(ROOT, 'params.json')).st_mtime
        except OSError:
            changed = None
        if children and changed != seen[0]:  # the user may have moved a monitor in the sphere
            seen[0] = changed
            arrange()
        return True
    GLib.timeout_add_seconds(1, watch)
    try:
        loop.run()
    finally:  # leaving also closes the sessions with GNOME, which removes the virtual monitors
        for child in children:
            child.terminate()
        if usual and usual != SINK:
            subprocess.run(['pactl', 'set-default-sink', usual])
        remove_output()


if __name__ == '__main__':
    if sys.argv[1:] == ['--list']:
        listed, virtual = [], 0
        for i, source in enumerate(monitors()):
            virtual += source == 'virtual'
            name = f'virtual {virtual}' if source == 'virtual' else source
            listed.append({'id': f'm{i}', 'name': name, 'virtual': source == 'virtual'})
        print(json.dumps({'monitors': listed, 'maxVirtual': SLOTS - (len(listed) - virtual), 'virtualSizes': VIRTUAL_SIZES}, ensure_ascii=False))
    else:
        main()
