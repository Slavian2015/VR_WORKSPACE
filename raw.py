#!/usr/bin/python3
"""Hands one recorded monitor or window to the picture of a headset on a cable as plain pictures, with no video
compression: that picture is drawn on this very PC, and compressing it only to decompress it at once cost sharpness,
time and the GPU's video engine (which hung on it and froze the desktop, 2026-11-21).

    raw.py <PipeWire node of the recording> <port>        the key the page must give is in the environment: VR_RAW_KEY

The page asks http://127.0.0.1:<port>/?k=<key> and the answer never ends: one picture after another, each as its
width and height (two 32-bit numbers), when it was taken (a 64-bit float, milliseconds), then the pixels, four
bytes each (red, green, blue, one unused), rows from the bottom up as WebGL wants them. Always the latest: while
the page does not read (the panel is out of view, or it is busy), nothing is copied and nothing piles up. GNOME
makes a picture only when the screen changes, so a still window costs nothing either.

A window's picture is as large as its monitor, with the window in its top left corner. A line "<width> <height>"
on standard input says how much of that corner is wanted, and only that is sent.
Leaves when standard input ends: started by capture.py (monitors) and windows.py (windows), one for each stream.
"""
import os, socket, struct, sys, threading, time
import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst
import numpy

KEY = os.environ.get('VR_RAW_KEY', '')
fresh = threading.Condition()  # guards the three below
latest = None                  # (sample, when it was taken): the newest picture, as GStreamer holds it
serial = 0                     # grows with every new picture and every change of `wanted`
wanted = None                  # (width, height) of the top left corner to send; None: all of it


def cut(sample):
    """The picture's size and its pixels as bytes: the corner that is wanted, or all of it."""
    shape, buffer = sample.get_caps().get_structure(0), sample.get_buffer()
    width, height = shape.get_value('width'), shape.get_value('height')
    w, h = (min(wanted[0], width), min(wanted[1], height)) if wanted else (width, height)
    if (w, h) == (width, height):
        return w, h, buffer.extract_dup(0, width * height * 4)
    ok, memory = buffer.map(Gst.MapFlags.READ)
    if not ok:
        return 0, 0, b''
    try:  # rows come bottom up, so the top of the picture is the end of the buffer
        return w, h, numpy.frombuffer(memory.data, numpy.uint8, width * height * 4).reshape(height, width * 4)[height - h:, :w * 4].tobytes()
    finally:
        buffer.unmap(memory)


def serve(conn):
    """One page, for as long as it stays: the newest picture whenever it has taken the one before."""
    try:
        conn.settimeout(3)
        request = b''
        while b'\r\n\r\n' not in request and len(request) < 4096:
            piece = conn.recv(4096)
            if not piece:
                return
            request += piece
        asked = request.split(b'\r\n')[0].decode('latin-1').split(' ')
        if not KEY or len(asked) < 2 or asked[0] != 'GET' or f'k={KEY}' not in asked[1].partition('?')[2].split('&'):
            conn.sendall(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            return
        conn.settimeout(None)
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        # Any page may read the answer (it comes from another port than the page): the key is what keeps others out.
        conn.sendall(b'HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nCache-Control: no-store\r\n'
                     b'Access-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n')
        left = threading.Event()

        def listen():  # a page that leaves while the screen is still would not be noticed by sending
            try:
                while conn.recv(4096):
                    pass
            except OSError:
                pass
            left.set()
            with fresh:
                fresh.notify_all()
        threading.Thread(target=listen, daemon=True).start()
        sent = 0
        while not left.is_set():
            with fresh:
                fresh.wait_for(lambda: left.is_set() or (latest and serial != sent))
                if left.is_set():
                    return
                (sample, taken), sent = latest, serial
            width, height, pixels = cut(sample)
            del sample
            if pixels:
                conn.sendall(struct.pack('<IId', width, height, taken) + pixels)
    except OSError:
        pass
    finally:
        conn.close()


def main():
    global latest, serial, wanted
    node, port = int(sys.argv[1]), int(sys.argv[2])
    Gst.init(None)
    # As for the encoders (capture.py): the frames must be taken as DMA-BUF, or GNOME leaks graphics memory, and only
    # vaapipostproc can take those. It turns them upside down on the GPU and hands them over in ordinary memory.
    pipeline = Gst.parse_launch(f'pipewiresrc path={node} ! video/x-raw(memory:DMABuf),format=BGRx,max-framerate=60/1'
                                ' ! vaapipostproc video-direction=vert ! video/x-raw,format=RGBx ! appsink name=sink max-buffers=1 drop=true sync=false')
    sink = pipeline.get_by_name('sink')
    # No clock: nothing here has to wait for a time. (With one, a stream that had been paused came back in bursts
    # of sixteen pictures a second: each waited for the clock to reach its time stamp. Stand, 2026-11-21.)
    pipeline.use_clock(None)
    pipeline.set_state(Gst.State.PLAYING)  # before the first pull: a sink that has not started answers "ended"

    def pull():
        global latest, serial
        while True:
            sample = sink.emit('pull-sample')
            if sample is None:  # the recording has ended (the window was closed), or failed: main() leaves
                return
            with fresh:
                latest, serial = (sample, time.time() * 1000), serial + 1
                fresh.notify_all()

    def orders():
        global serial, wanted
        for line in sys.stdin:
            try:
                width, height = (int(n) for n in line.split())
            except ValueError:
                continue
            with fresh:
                wanted, serial = (width, height) if width > 0 and height > 0 else None, serial + 1
                fresh.notify_all()
        os._exit(0)  # who started us is gone

    server = socket.create_server(('127.0.0.1', port))  # this PC only

    def accept():
        while True:
            threading.Thread(target=serve, args=(server.accept()[0],), daemon=True).start()

    for job in pull, orders, accept:
        threading.Thread(target=job, daemon=True).start()
    message = pipeline.get_bus().timed_pop_filtered(Gst.CLOCK_TIME_NONE, Gst.MessageType.ERROR | Gst.MessageType.EOS)
    if message.type == Gst.MessageType.ERROR:
        print(f'raw.py: {message.parse_error()[0].message}', file=sys.stderr)
    pipeline.set_state(Gst.State.NULL)
    sys.exit(1)


if __name__ == '__main__':
    main()
