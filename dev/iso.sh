#!/usr/bin/env bash
# Starts a second GNOME Shell that nobody sees (own settings, own extensions folder, no real monitor) and runs the
# actions of the given file in it with drive.py. The desktop you work on is not touched.
#
#   dev/iso.sh actions.txt
#
# What is loaded there: the project's extension (talking to 127.0.0.1:18080, not 8080) and a test-only extension
# that lets drive.py run JavaScript in the shell and take screenshots.
# Options, as environment variables:
#   MONITORS=3            number of monitors of 1300x1000 (default 1)
#   SIZES="1920x1080 2560x1440"   the monitors by their sizes, in place of MONITORS
#   EXTRA="uuid uuid"     copies of other installed extensions to load as well
#   ANIM=true             system animations on (default off)
#   PIPEWIRE=1            let that shell use the real PipeWire, so that screen recording works there
#   INSIDE="command"      run inside that session after the shell is up, before the actions (background it yourself)
#   LIMIT=60              seconds before everything is stopped
#   GROWTH=800            megabytes the PC's memory use may grow by before everything is stopped at once
#
# The memory guard is not optional. Screen recording in GNOME 46 can leak graphics memory at hundreds of megabytes a
# second (it is ordinary memory on this PC), and that shell shares the PC with the real desktop: on 2026-11-18 a
# test without a guard froze the whole machine before its time limit ran out.
# Prints the folder with shell.log, drive.log and the screenshots.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); P=$(dirname "$HERE")
ACTIONS=$(realpath "$1")
T=$(mktemp -d "${TMPDIR:-/tmp}/vr-iso.XXXXXX"); mkdir -p "$T/config" "$T/data/gnome-shell/extensions" "$T/bin" "$T/shots"
R=/run/user/$(id -u)/vrt  # a socket path must be short, so not under $T
for m in gvfs doc; do fusermount -u "$R/$m" 2>/dev/null; done; rm -rf "${R:?}"; mkdir -m 700 "$R"
E="$T/data/gnome-shell/extensions"
cp -r "$P/gnome-extension/vr-workspace@local" "$E/"
sed -i 's/127.0.0.1:8080/127.0.0.1:18080/' "$E/vr-workspace@local/link.js"
mkdir -p "$E/unsafe@test"
echo '{"uuid":"unsafe@test","name":"test: Eval and Screenshot for drive.py","description":"x","shell-version":["46"]}' > "$E/unsafe@test/metadata.json"
echo 'export default class { enable() { global.context.unsafe_mode = true } disable() {} }' > "$E/unsafe@test/extension.js"
LIST="'vr-workspace@local', 'unsafe@test'"
for x in ${EXTRA:-}; do
  for d in ~/.local/share/gnome-shell/extensions /usr/share/gnome-shell/extensions; do [ -d "$d/$x" ] && cp -rL "$d/$x" "$E/" && LIST="$LIST, '$x'" && break; done
done
# a stand-in for systemctl: the test must not start or stop the real services
printf '#!/bin/sh\necho "systemctl $*" >> "%s/systemctl.log"\n' "$T" > "$T/bin/systemctl"; chmod +x "$T/bin/systemctl"
[ -n "${PIPEWIRE:-}" ] && ln -s "/run/user/$(id -u)/pipewire-0" "$R/pipewire-0"
VM=""; for size in ${SIZES:-$(for _ in $(seq "${MONITORS:-1}"); do echo 1300x1000; done)}; do VM="$VM --virtual-monitor $size"; done
cd "$T"
used() { awk '/MemTotal/ {t = $2} /MemAvailable/ {a = $2} END {printf "%d", (t - a) / 1024}' /proc/meminfo; }
BASE=$(used)
# In a session of its own, so that the guard can stop everything the test started, whatever it is.
setsid env -i HOME="$HOME" USER="$USER" PATH="$T/bin:/usr/local/bin:/usr/bin:/bin" LANG=C.UTF-8 NO_AT_BRIDGE=1 \
  XDG_CONFIG_HOME="$T/config" XDG_DATA_HOME="$T/data" XDG_RUNTIME_DIR="$R" XDG_DATA_DIRS=/usr/share/ubuntu:/usr/share/gnome:/usr/local/share:/usr/share \
  timeout -s KILL "${LIMIT:-60}" dbus-run-session -- bash -c "
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions \"[$LIST]\"
    gsettings set org.gnome.desktop.interface enable-animations ${ANIM:-false}
    gsettings set org.gnome.desktop.interface enable-hot-corners false
    (ulimit -f 40000; exec gnome-shell --headless --wayland --no-x11 $VM --wayland-display vrtest-0 > shell.log 2>&1) &
    SHELL_PID=\$!
    sleep 7
    dbus-update-activation-environment WAYLAND_DISPLAY=vrtest-0 GDK_BACKEND=wayland
    export WAYLAND_DISPLAY=vrtest-0 GDK_BACKEND=wayland
    ${INSIDE:-true}
    /usr/bin/python3 '$HERE/drive.py' '$T/shots' '$ACTIONS' > drive.log 2>&1
    kill \$(jobs -p | grep -v \$SHELL_PID) 2>/dev/null; sleep 1; kill \$SHELL_PID 2>/dev/null; sleep 1; kill -9 \$SHELL_PID 2>/dev/null
  " > /dev/null 2>&1 < /dev/null &
SESSION=$!
stop_all() {  # the whole session of the test, and that shell by name in case it left the session
  kill -9 -- "-$SESSION" 2>/dev/null
  for p in $(pgrep -x gnome-shell); do tr '\0' ' ' < /proc/$p/cmdline | grep -q -- '--wayland-display vrtest-0' && kill -9 "$p"; done
}
# The guard: looks twice a second at the memory in use (graphics memory included) and stops everything the moment
# it has grown too much, or little is left.
(
  while sleep 0.5; do
    NOW=$(used); FREE=$(awk '/MemAvailable/ {printf "%d", $2 / 1024}' /proc/meminfo)
    if [ $((NOW - BASE)) -gt "${GROWTH:-800}" ] || [ "$FREE" -lt 3000 ]; then
      echo "MEMORY GUARD: use grew by $((NOW - BASE)) MB (allowed ${GROWTH:-800}), $FREE MB left: the test was stopped" > "$T/guard.log"
      stop_all
      exit
    fi
  done
) &
GUARD=$!
{ wait $SESSION; } 2>/dev/null  # quiet when the guard killed it
kill $GUARD 2>/dev/null
stop_all  # whatever is left, also when the time limit cut it short
for m in gvfs doc; do fusermount -u "$R/$m" 2>/dev/null; done; rm -rf "${R:?}" 2>/dev/null
cat "$T/drive.log"
[ -f "$T/guard.log" ] && cat "$T/guard.log"
echo "--- memory in use: $BASE MB before, $(used) MB after"
echo "--- shell log: $(grep -c 'JS ERROR' "$T/shell.log") JS errors, $(grep -c -E 'sweeping phase of GC|during garbage collection' "$T/shell.log") GC-storm lines"
grep -E 'JS ERROR|Extension .* error' -A3 "$T/shell.log" | head -8
[ -f "$T/systemctl.log" ] && { echo '--- systemctl was asked:'; cat "$T/systemctl.log"; }
echo "--- files: $T"
