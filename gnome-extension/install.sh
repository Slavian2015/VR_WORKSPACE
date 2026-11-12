#!/usr/bin/env bash
# Optional: installs the GNOME extension that reports a fullscreen window to VR Workspace (for the automatic black
# background). It links this folder into your GNOME profile and adds the extension to the enabled ones.
# GNOME loads it at the next login. To remove: gnome-extensions disable vr-workspace@local, then delete the link.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ~/.local/share/gnome-shell/extensions
ln -sfn "$PWD/vr-workspace@local" ~/.local/share/gnome-shell/extensions/vr-workspace@local
# GSETTINGS_SCHEMA_DIR is unset because the VS Code snap terminal points it at schemas without GNOME Shell's.
env -u GSETTINGS_SCHEMA_DIR /usr/bin/python3 -c "
from gi.repository import Gio
settings = Gio.Settings.new('org.gnome.shell')
enabled = settings.get_strv('enabled-extensions')
if 'vr-workspace@local' not in enabled:
    settings.set_strv('enabled-extensions', enabled + ['vr-workspace@local'])
    Gio.Settings.sync()
"
echo "Installed. Log out and in again to load it."
