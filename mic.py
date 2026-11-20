#!/usr/bin/env python3
"""The phone's microphone as this PC's microphone. MediaMTX runs this while the phone sends its microphone (path
vr/mic, see mediamtx.yml) and stops it when the phone stops. Meanwhile there is a microphone "VR-Headset": it is
the system's microphone while we run (the one used before comes back when we leave), and it hears what the phone
hears. Made of a sink that the phone's sound is played into and a microphone that takes what that sink plays."""
import signal, subprocess, sys

FEED = 'vr_mic_feed'  # the sink the phone's sound is played into (shown among outputs as "VR-Headset microphone feed")
SOURCE = 'vr_microphone'


def pactl(*args):
    return subprocess.run(['pactl', *args], capture_output=True, text=True).stdout.strip()


def remove():  # also what a run that was killed left behind; the microphone first, it takes from the sink
    for line in reversed(pactl('list', 'short', 'modules').splitlines()):
        if f'sink_name={FEED}' in line or f'source_name={SOURCE}' in line:
            pactl('unload-module', line.split()[0])


def main():
    # MediaMTX stops us with SIGINT, systemd with SIGTERM: both lead to the clean-up below, also while the devices
    # are still being made (stopped then, a silent "VR-Headset" would stay the system's microphone).
    signal.signal(signal.SIGTERM, signal.default_int_handler)
    remove()
    usual = pactl('get-default-source')
    player = None
    try:
        pactl('load-module', 'module-null-sink', f'sink_name={FEED}', 'sink_properties=device.description="VR-Headset microphone feed"')
        pactl('load-module', 'module-remap-source', f'master={FEED}.monitor', f'source_name={SOURCE}', 'source_properties=device.description=VR-Headset')
        pactl('set-default-source', SOURCE)
        # Read with as little buffering as ffmpeg allows: a voice late by half a second is hard to talk with.
        player = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'warning', '-fflags', 'nobuffer', '-flags', 'low_delay',
                                   '-rtsp_transport', 'tcp', '-i', 'rtsp://127.0.0.1:8554/vr/mic',
                                   '-f', 'pulse', '-buffer_duration', '40', '-device', FEED, 'phone microphone'])
        player.wait()
    except KeyboardInterrupt:
        pass
    finally:
        for sig in signal.SIGINT, signal.SIGTERM:  # a second signal must not cut the clean-up short
            signal.signal(sig, signal.SIG_IGN)
        if player and player.poll() is None:
            player.terminate()
            player.wait()
        if usual and usual != SOURCE:
            pactl('set-default-source', usual)
        remove()
    sys.exit(0)


if __name__ == '__main__':
    main()
