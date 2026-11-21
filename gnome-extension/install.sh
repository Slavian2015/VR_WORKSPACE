#!/usr/bin/env bash
# Puts VR Workspace into GNOME (setup.sh runs this; safe to run again):
# - links the extension (the top bar icon with its menu and settings window) into your GNOME profile and enables it;
# - writes three systemd user services, so that the menu can start and stop the server and the recording, and the
#   settings window can read the settings while the server is off. Nothing is started at login.
# GNOME loads the extension at the next login.
# To remove: gnome-extensions disable vr-workspace@local, then delete the files this script names at the end.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(dirname "$PWD")
NODE=$(command -v node) || { echo "node is not found: install Node.js 22 or newer first" >&2; exit 1; }

mkdir -p ~/.local/share/gnome-shell/extensions ~/.config/systemd/user
ln -sfn "$PWD/vr-workspace@local" ~/.local/share/gnome-shell/extensions/vr-workspace@local
# The full path of node: a service does not see what your shell adds to PATH (nvm, for one).
# KillMode=mixed: only the server is told to stop; it stops MediaMTX, which stops the capture, which then removes
# its sound output undisturbed (signalled all at once, the command that removes it was cut short).
cat > ~/.config/systemd/user/vr-workspace.service <<UNIT
[Unit]
Description=VR Workspace server
# The settings-only server holds the same port: it is stopped first.
Conflicts=vr-workspace-settings.service
After=vr-workspace-settings.service

[Service]
WorkingDirectory=$ROOT
ExecStart="$NODE" server.js
KillMode=mixed
UNIT
# The same server without the stream, for the settings window while VR Workspace is off.
cat > ~/.config/systemd/user/vr-workspace-settings.service <<UNIT
[Unit]
Description=VR Workspace settings (no stream, this PC only)

[Service]
WorkingDirectory=$ROOT
ExecStart="$NODE" server.js --settings
UNIT
# The recording of what the headset shows ("Record Video" in the menu). Stopped with SIGINT, as Ctrl+C in a terminal:
# it then finishes its file. PartOf: it stops with VR Workspace, and saves what it has.
cat > ~/.config/systemd/user/vr-workspace-record.service <<UNIT
[Unit]
Description=VR Workspace: a video of what the headset shows, into ~/Videos
PartOf=vr-workspace.service
After=vr-workspace.service

[Service]
WorkingDirectory=$ROOT
ExecStart="$NODE" record.mjs
KillSignal=SIGINT
KillMode=mixed
UNIT
systemctl --user daemon-reload

# GSETTINGS_SCHEMA_DIR is unset because the VS Code snap terminal points it at schemas without GNOME Shell's.
env -u GSETTINGS_SCHEMA_DIR /usr/bin/python3 -c "
from gi.repository import Gio
settings = Gio.Settings.new('org.gnome.shell')
enabled = settings.get_strv('enabled-extensions')
if 'vr-workspace@local' not in enabled:
    settings.set_strv('enabled-extensions', enabled + ['vr-workspace@local'])
    Gio.Settings.sync()
"
echo "Installed:"
echo "  ~/.local/share/gnome-shell/extensions/vr-workspace@local   (a link to this folder)"
echo "  ~/.config/systemd/user/vr-workspace.service, vr-workspace-settings.service and vr-workspace-record.service"
echo "Log out and in again: the headset icon appears in the top bar."
