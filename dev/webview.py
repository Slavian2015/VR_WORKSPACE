#!/usr/bin/python3
"""Opens a page in a window of its own (WebKitGTK, not a snap: a snap browser cannot reach the display of iso.sh's
shell), titled as the headset-on-a-cable window, so that the extension takes it for that.

  dev/webview.py <url> [--fullscreen]          inside iso.sh: INSIDE="dev/webview.py http://127.0.0.1:18080/?glasses --fullscreen &"
"""
import sys
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('WebKit', '6.0')
from gi.repository import Gtk, WebKit

url, fullscreen = sys.argv[1], '--fullscreen' in sys.argv[2:]


def open_window(app):
    window = Gtk.ApplicationWindow(application=app, title='VR Workspace — glasses', default_width=1300, default_height=1000)
    view = WebKit.WebView()
    view.get_settings().set_enable_webgl(True)
    view.get_settings().set_enable_write_console_messages_to_stdout(True)  # the page's console.warn and errors, in the log
    view.load_uri(url)
    window.set_child(view)
    if fullscreen:
        window.fullscreen()
    window.present()


app = Gtk.Application(application_id='local.vrworkspace.webview')
app.connect('activate', open_window)
app.run([])
