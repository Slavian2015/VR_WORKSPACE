// How the panel menu and the settings window reach the VR Workspace server (server.js) on this PC.
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Soup from 'gi://Soup?version=3.0'

export const SERVER = 'http://127.0.0.1:8080'

export const http = () => new Soup.Session({ timeout: 2 })

// GET of `path`, or POST of `values` as JSON. Gives the answer's bytes, or null when the server is not running or
// refused.
export function load(session, path, values) {
  const message = Soup.Message.new(values ? 'POST' : 'GET', SERVER + path)
  if (values) message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(JSON.stringify(values))))
  return new Promise(done => session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_session, result) => {
    try {
      const bytes = session.send_and_read_finish(result)
      done(message.get_status() < 300 ? bytes : null)
    } catch {
      done(null)
    }
  }))
}

// The same for JSON: gives the parsed answer ({} when it is empty), or null when it failed.
export async function talk(session, path, values) {
  try {
    const text = new TextDecoder().decode((await load(session, path, values)).get_data())
    return text ? JSON.parse(text) : {}
  } catch {
    return null
  }
}

// The server is two systemd user services, which gnome-extension/install.sh writes; starting one stops the other.
const service = (name, on) => Gio.Subprocess.new(['systemctl', '--user', on ? 'start' : 'stop', `${name}.service`], Gio.SubprocessFlags.NONE)
// VR Workspace itself: the phone can connect.
export const power = on => service('vr-workspace', on)
// Only its settings, for the settings window while VR Workspace is off: nothing is streamed, the answers say
// `settingsOnly`.
export const settingsOnly = on => service('vr-workspace-settings', on)
