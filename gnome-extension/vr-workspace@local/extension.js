// The part of VR Workspace that has to run inside GNOME Shell, because GNOME gives these things to nothing else:
// - the icon in the top bar: its menu starts and stops the server, shows whether the phone is connected and opens
//   the settings window (prefs.js);
// - it tells the server (server.js, on this PC) whether some window is fullscreen, so the headset can go dark
//   around a film;
// - Num Lock hands the mouse to the headset: while it is on, the left button and the wheel arrange the monitors in
//   the sphere instead of reaching the desktop, the keys 1-4 hide or show a monitor and 5 centres the layout on
//   the gaze. Num Lock off gives the mouse back.
//   This must never be able to lock the user out. On 2026-11-13 the shell's JavaScript stopped running while its
//   compositor went on (cause not found), and a modal grab held by this code left the PC without mouse and keyboard.
//   So: nothing is modal, the keyboard is not taken (only the keys 1-5 are asked for, one by one), and the mouse
//   comes back by itself when this code stops running (see _hold).
import Clutter from 'gi://Clutter'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import GObject from 'gi://GObject'
import Meta from 'gi://Meta'
import Shell from 'gi://Shell'
import St from 'gi://St'
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { http, talk, power } from './link.js'

export default class VrWorkspace extends Extension {
  enable() {
    this._http = http()
    this._addMenu()
    this._fullscreenChanged = global.display.connect('in-fullscreen-changed', () => this._reportFullscreen())
    this._reportFullscreen()
    this._keymap = Clutter.get_default_backend().get_default_seat().get_keymap()
    this._numLock = this._keymap.get_num_lock_state() // only a change counts: Num Lock may be on already at login
    this._keymapChanged = this._keymap.connect('state-changed', () => this._onKeymap())
  }

  disable() {
    this._leave()
    for (const source of [this._watch, this._startCheck]) if (source) GLib.source_remove(source)
    this._watch = this._startCheck = 0
    this._indicator.destroy()
    this._indicator = null
    this._keymap.disconnect(this._keymapChanged)
    global.display.disconnect(this._fullscreenChanged)
    this._http.abort()
    this._http = null
  }

  // Sends settings to the server, or with no body asks for them; `done` gets the answer or null when it failed.
  _talk(values, done) {
    talk(this._http, '/params', values).then(answer => done?.(answer))
  }

  _addMenu() {
    this._indicator = new PanelMenu.Button(0.5, 'VR Workspace')
    this._indicator.add_child(new St.Icon({ gicon: Gio.icon_new_for_string(`${this.path}/icons/vr-workspace-symbolic.svg`), style_class: 'system-status-icon' }))
    const menu = this._indicator.menu
    this._power = new PopupMenu.PopupSwitchMenuItem('VR Workspace', false)
    this._power.connect('toggled', (_item, on) => this._setPower(on))
    menu.addMenuItem(this._power)
    this._status = new PopupMenu.PopupMenuItem('', { reactive: false })
    menu.addMenuItem(this._status)
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
    this._centre = menu.addAction(_('Centre on Gaze'), () => this._talk({ recenter: Date.now() }))
    this._camera = new PopupMenu.PopupSwitchMenuItem(_('Phone Camera as Background'), false)
    this._camera.connect('toggled', (_item, on) => this._talk({ passthrough: on }))
    menu.addMenuItem(this._camera)
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
    menu.addAction(_('Settings'), () => this.openPreferences())
    // The state is asked for only while the menu is open: nothing runs in the background for an icon.
    menu.connect('open-state-changed', (_menu, open) => {
      if (this._watch) GLib.source_remove(this._watch)
      this._watch = open ? GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => (this._refresh(), GLib.SOURCE_CONTINUE)) : 0
      if (open) this._refresh()
    })
    this._refresh()
    Main.panel.addToStatusArea(this.uuid, this._indicator)
  }

  _refresh() {
    this._talk(null, answer => {
      if (!this._indicator) return // switched off meanwhile
      const on = !!answer && !answer.settingsOnly // settingsOnly: just the settings window's helper is running
      const starting = this._startCheck && !on
      this._power.setToggleState(on || !!starting)
      this._status.label.text = starting ? _('Starting…') : !on ? _('Off')
        : answer.phoneOnline ? _('Phone connected') : _('Waiting for the phone: the link is in Settings')
      this._centre.setSensitive(on && answer.phoneOnline)
      this._camera.setSensitive(on)
      this._camera.setToggleState(on && answer.passthrough)
    })
  }

  _setPower(on) {
    if (this._startCheck) GLib.source_remove(this._startCheck)
    this._startCheck = 0
    try {
      power(on)
    } catch (e) { // no systemctl
      return Main.notify('VR Workspace', e.message)
    }
    if (!on) return
    // The menu closes on a click, so a failed start has to be told aloud.
    this._startCheck = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 8, () => {
      this._startCheck = 0
      this._talk(null, answer => (answer && !answer.settingsOnly) || Main.notify('VR Workspace', _('Did not start. Why: journalctl --user -u vr-workspace -e')))
      return GLib.SOURCE_REMOVE
    })
  }

  // shortcut: reported only when it changes, a server started during a fullscreen film learns it at the next change;
  // report on a timer if that ever matters.
  _reportFullscreen() {
    let fullscreen = false
    for (let i = 0; i < global.display.get_n_monitors(); i++) fullscreen ||= global.display.get_monitor_in_fullscreen(i)
    this._talk({ fullscreen })
  }

  _onKeymap() {
    const on = this._keymap.get_num_lock_state()
    if (on === this._numLock) return // it was Caps Lock
    this._numLock = on
    if (!on) return this._leave()
    // Num Lock is an ordinary key too: the mouse is taken only while a phone is actually connected.
    this._talk(null, answer => answer?.phoneOnline && this._numLock && this._http && this._enter())
  }

  _enter() {
    if (this._catcher) return
    // The mouse: an actor laid over everything takes the clicks and the wheel that would reach windows and panels.
    this._catcher = new St.Widget({ reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height })
    Main.layoutManager.uiGroup.add_child(this._catcher)
    this._smooth = 0
    this._catcher.connect('button-press-event', (_actor, event) => this._button(event, true))
    this._catcher.connect('button-release-event', (_actor, event) => this._button(event, false))
    this._catcher.connect('scroll-event', (_actor, event) => this._scroll(event))
    // The keys 1-5, top row and number pad: asked from the window manager one by one. Every other key stays with
    // the desktop.
    this._keys = new Map() // what the window manager calls the key -> the digit
    for (let digit = 1; digit <= 5; digit++) {
      for (const name of [`${digit}`, `KP_${digit}`]) {
        const action = global.display.grab_accelerator(name, Meta.KeyBindingFlags.NONE)
        if (action === Meta.KeyBindingAction.NONE) continue // taken by something else
        Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action), Shell.ActionMode.ALL)
        this._keys.set(action, digit)
      }
    }
    this._keyPressed = global.display.connect('accelerator-activated', (_display, action) => {
      const digit = this._keys.get(action)
      if (digit === 5) this._talk({ recenter: Date.now() }) // the "centre on gaze" button
      else if (digit) this._talk({ toggle: `m${digit - 1}.hidden` }) // hide or show that monitor
    })
    this._talk({ edit: true })
    this._hold()
    // Repeated every second: the server ends the mode by itself if this stops, and we end it if the server is gone.
    this._beat = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
      this._hold()
      this._talk({ edit: true }, answer => answer || this._leave())
      return GLib.SOURCE_CONTINUE
    })
  }

  // Keeps the mouse for three more seconds. The catcher is told to jump far off the screen after that time, and
  // the compositor carries that out by itself, in C. While this code runs, the jump is put off every second; if it
  // stops running, the catcher leaves and the desktop has its mouse again.
  _hold() {
    const catcher = this._catcher
    catcher.remove_transition('leave')
    catcher.translation_x = 0
    // An explicit transition: unlike eased properties it also runs with animations switched off in the system.
    const leave = new Clutter.PropertyTransition({ property_name: 'translation-x', delay: 3000, duration: 1 })
    leave.set_interval(new Clutter.Interval({ value_type: GObject.TYPE_FLOAT, initial: 0, final: -4 * global.stage.width }))
    catcher.add_transition('leave', leave)
  }

  _leave() {
    if (!this._catcher) return
    GLib.source_remove(this._beat)
    global.display.disconnect(this._keyPressed)
    for (const action of this._keys.keys()) global.display.ungrab_accelerator(action)
    this._catcher.destroy()
    this._catcher = null
    this._talk({ edit: false, grab: false })
  }

  _button(event, pressed) {
    if (event.get_button() === Clutter.BUTTON_PRIMARY) this._talk({ grab: pressed })
    return Clutter.EVENT_STOP
  }

  // One click of a wheel is one step. A wheel reports each click twice, once as a second, emulated event that is
  // skipped here; a touchpad reports only small smooth movements, which are added up into steps.
  _scroll(event) {
    if (event.is_pointer_emulated()) return Clutter.EVENT_STOP
    let steps = 0
    const direction = event.get_scroll_direction()
    if (direction === Clutter.ScrollDirection.UP) steps = 1
    else if (direction === Clutter.ScrollDirection.DOWN) steps = -1
    else if (direction === Clutter.ScrollDirection.SMOOTH) {
      this._smooth -= event.get_scroll_delta()[1] // away from you is negative
      steps = Math.trunc(this._smooth)
      this._smooth -= steps
    }
    if (steps) {
      const state = event.get_state()
      const key = state & Clutter.ModifierType.CONTROL_MASK ? 'wheelDist' : state & Clutter.ModifierType.SHIFT_MASK ? 'wheelCurve' : 'wheelSize'
      this._talk({ [key]: steps })
    }
    return Clutter.EVENT_STOP
  }
}
