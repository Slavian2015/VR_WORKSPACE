// Tells the VR Workspace server (server.js, on this PC) whether some window is fullscreen, so that the headset can
// go dark around a film. GNOME gives this information only to code that runs inside the shell, hence an extension.
import GLib from 'gi://GLib'
import Soup from 'gi://Soup?version=3.0'
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js'

export default class VrWorkspace extends Extension {
  enable() {
    this._http = new Soup.Session({ timeout: 2 })
    this._changed = global.display.connect('in-fullscreen-changed', () => this._report())
    this._report()
  }

  disable() {
    global.display.disconnect(this._changed)
    this._http.abort()
    this._http = null
  }

  // shortcut: reported only when it changes, a server started during a fullscreen film learns it at the next change;
  // report on a timer if that ever matters.
  _report() {
    let fullscreen = false
    for (let i = 0; i < global.display.get_n_monitors(); i++) fullscreen ||= global.display.get_monitor_in_fullscreen(i)
    const message = Soup.Message.new('POST', 'http://127.0.0.1:8080/params')
    message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(JSON.stringify({ fullscreen }))))
    this._http.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (http, result) => {
      try { http.send_and_read_finish(result) } catch {} // the server is not running: nothing to tell
    })
  }
}
