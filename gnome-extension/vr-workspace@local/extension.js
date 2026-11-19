// The part of VR Workspace that has to run inside GNOME Shell, because GNOME gives these things to nothing else:
// - the icon in the top bar: its menu starts and stops the server, shows whether the phone is connected and opens
//   the settings window (prefs.js);
// - it tells the server (server.js, on this PC) whether some window is fullscreen, so the headset can go dark
//   around a film;
// - single windows in the headset: the menu sends the window last used there or takes it back. While the server
//   runs it is told twice a second which windows are open and how big; it answers which window the headset's
//   pointer works in (that one is brought to the front: a click lands on whatever is in front) and which
//   application the headset asked to start (its window is then shown there). It also gets the list of installed
//   applications, for the headset's own menu of them. Menus, drop-down lists and tooltips of a window shown there
//   are copied into that window, so that its recording has them (see _copyPopup);
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
    this._shownWindows = [] // GNOME's ids of the windows shown in the headset one by one
    this._copies = new Map() // the copies of popups laid into those windows: copy -> { popup, window }
    this._windowCreated = global.display.connect('window-created', (_display, window) => {
      this._copyPopup(window)
      this._note(window, 'opened')
    })
    // Until the trouble with VLC's file chooser (2026-11-19) is understood: what windows do while the headset works in them.
    this._focusChanged = global.display.connect('notify::focus-window', () => this._note(global.display.focus_window, 'has the focus'))
    this._addMenu()
    // Twice a second while the server answers, every three seconds while it does not.
    this._windowsBeat = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
      if (this._serverSeen || ++this._silent % 6 === 0) this._tellWindows()
      return GLib.SOURCE_CONTINUE
    })
    this._silent = 0
    // GNOME's own "stop sharing" button stands next to our icon and ends every recording, so VR Workspace switches
    // off when it is pressed. It was pressed without anyone meaning to; the log tells what pressed it.
    this._stopButton = Main.panel.statusArea.screenSharing
    this._stopPressed = this._stopButton?.connect('button-press-event', (_actor, event) => {
      console.log(`VR Workspace: "stop sharing" pressed by ${event.get_source_device()?.get_device_name()} at ${event.get_coords().map(Math.round)}`)
      return Clutter.EVENT_PROPAGATE
    })
    this._fullscreenChanged = global.display.connect('in-fullscreen-changed', () => this._reportFullscreen())
    this._reportFullscreen()
    this._keymap = Clutter.get_default_backend().get_default_seat().get_keymap()
    this._numLock = this._keymap.get_num_lock_state() // only a change counts: Num Lock may be on already at login
    this._keymapChanged = this._keymap.connect('state-changed', () => this._onKeymap())
  }

  disable() {
    this._leave()
    global.display.disconnect(this._windowCreated)
    global.display.disconnect(this._focusChanged)
    for (const copy of this._copies.keys()) copy.destroy()
    this._copies.clear()
    for (const source of [this._watch, this._startCheck, this._windowsBeat]) if (source) GLib.source_remove(source)
    this._watch = this._startCheck = this._windowsBeat = 0
    if (this._stopPressed) this._stopButton.disconnect(this._stopPressed)
    this._stopPressed = 0
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
    this._windowItem = menu.addAction('', () => this._tellWindows({ toggle: this._candidate?.get_id() }))
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())
    menu.addAction(_('Settings'), () => this.openPreferences())
    // The state is asked for only while the menu is open: nothing runs in the background for an icon.
    menu.connect('open-state-changed', (_menu, open) => {
      if (this._watch) GLib.source_remove(this._watch)
      this._watch = open ? GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => (this._refresh(), GLib.SOURCE_CONTINUE)) : 0
      if (open) this._refresh()
      if (!open) return
      // The window used last: the one the user means by "this window" while the menu is open. For a dialog that is
      // the window it belongs to: dialogs go into the headset and out of it with their window.
      this._candidate = global.display.get_tab_list(Meta.TabList.NORMAL, null)[0]
      while (this._candidate?.get_transient_for()) this._candidate = this._candidate.get_transient_for()
      const title = (this._candidate?.get_title() ?? '').slice(0, 30)
      this._windowItem.label.text = !this._candidate ? _('No Window to Show in the Headset')
        : (this._shownWindows.includes(this._candidate.get_id()) ? _('Take “%s” out of the Headset') : _('Show “%s” in the Headset')).replace('%s', title)
      this._windowItem.setSensitive(!!this._candidate)
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

  // Tells the server the open windows (and, with `toggle`, to show that one in the headset or stop showing it) and
  // does what the answer says.
  _tellWindows(wish = {}) { // wish: { toggle: id } or { show: id }
    // Dialogs as well (a file chooser, a question): GNOME records every window alone, so a dialog is not in the
    // picture of the window it belongs to. `parent` names that window, and the server shows the dialog with it.
    const kinds = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG]
    const windows = global.get_window_actors().map(actor => actor.meta_window).filter(w => kinds.includes(w.get_window_type()))
    this._showStarted(windows, wish)
    if (this._needApps) wish.apps = this._apps()
    this._needApps = false
    const open = windows.map(w => {
      const frame = w.get_frame_rect(), buffer = w.get_buffer_rect() // the picture of a window starts at its shadow
      // popups: where the menus copied into it lie, from the window's top left (they may reach out of it)
      const popups = [...this._copies.values()].filter(c => c.window === w).map(({ popup }) => popup.get_frame_rect())
        .filter(r => r.width > 0 && r.height > 0).slice(-3).map(r => [r.x - frame.x, r.y - frame.y, r.width, r.height])
      return { id: w.get_id(), title: w.get_title() ?? '', w: frame.width, h: frame.height, left: frame.x - buffer.x, top: frame.y - buffer.y,
        parent: w.get_transient_for()?.get_id() ?? 0, type: w.get_window_type(), popups }
    })
    talk(this._http, '/windows', { open, ...wish }).then(answer => {
      if (!this._indicator) return // switched off meanwhile
      this._serverSeen = !!answer
      this._shownWindows = answer?.shown ?? []
      this._needApps = !!answer?.needApps
      // Not while a menu of it is open: the menu is what is being worked, and Qt programs (VLC) lose track of their
      // windows when theirs is activated under an open menu.
      const active = windows.find(w => w.get_id() === answer?.active)
      if (active && active !== global.display.focus_window && ![...this._copies.values()].some(c => c.window === active)) {
        console.log(`VR Workspace: bringing ${active.get_description()} "${active.get_title()}" to the front`)
        active.activate(global.get_current_time())
      }
      if (answer?.launch) this._start(answer.launch)
    })
  }

  _note(window, what) { // into the journal, while the server runs: GNOME's own warnings name X11 windows by these numbers
    if (!this._serverSeen || !window) return
    const parent = window.get_transient_for(), r = window.get_frame_rect()
    console.log(`VR Workspace: window ${window.get_description()} "${window.get_title() ?? ''}" ${what}: type ${window.get_window_type()}, ` +
      `${r.width}x${r.height}, pid ${window.get_pid()}${window.is_override_redirect() ? ', override-redirect' : ''}${parent ? `, belongs to ${parent.get_description()}` : ''}`)
    if (what === 'opened') window.connect('unmanaged', () => this._note(window, 'closed'))
  }

  // A popup (menu, drop-down list, tooltip) is a window of its own to GNOME, and the recording of the window it
  // drops from does not have it. So a copy of it is laid into that window, at the same place: the recording paints
  // a window with what it holds, and the headset sees the menu where it is. On the PC the copy lies exactly under
  // the popup and is not seen. The recording takes a new picture only when the window itself changes, so every
  // change of the popup (a highlighted item, closing) is passed on to the window as a change of its own.
  _copyPopup(popup) {
    const kinds = [Meta.WindowType.DROPDOWN_MENU, Meta.WindowType.POPUP_MENU, Meta.WindowType.COMBO, Meta.WindowType.TOOLTIP, Meta.WindowType.MENU]
    if (!kinds.includes(popup.get_window_type())) return
    // Into the nearest window shown in the headset that it belongs to (a submenu belongs to a menu). X11 menus
    // (Qt programs, VLC) may name no window: then the window of the same program that is shown there.
    const shown = w => this._shownWindows.includes(w.get_id())
    let window = popup.get_transient_for() ?? global.get_window_actors().map(actor => actor.meta_window)
      .find(w => popup.get_pid() > 0 && w.get_pid() === popup.get_pid() && shown(w))
    while (window && !shown(window)) window = window.get_transient_for()
    const actor = popup.get_compositor_private(), into = window?.get_compositor_private()
    if (!actor || !into) return
    const copy = new Clutter.Clone({ source: actor })
    const place = () => copy.set_position(actor.x - into.x, actor.y - into.y)
    const changed = () => into.emit('damaged')
    // The headset is told at once (not at the next report, half a second later) where the menu is: it shows the
    // part of it that reaches out of the window, and its pointer reaches there too.
    const tell = () => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => (this._http && this._tellWindows(), GLib.SOURCE_REMOVE))
    place()
    into.add_child(copy)
    this._copies.set(copy, { popup, window })
    actor.connectObject('notify::x', place, 'notify::y', place, 'damaged', changed, 'destroy', () => { copy.destroy(); changed() }, copy)
    into.connectObject('notify::x', place, 'notify::y', place, copy) // a copy goes with its window, as its child
    copy.connect('destroy', () => { this._copies.delete(copy); tell() })
    changed()
    tell()
  }

  // The installed applications that GNOME's own list shows, with the file of each one's icon.
  _apps() {
    const theme = new St.IconTheme()
    return Shell.AppSystem.get_default().get_installed().filter(info => info.should_show()).map(info => {
      const icon = info.get_icon()
      return { id: info.get_id(), name: info.get_display_name(), icon: (icon && theme.lookup_by_gicon(icon, 128, St.IconLookupFlags.FORCE_SIZE))?.get_filename() ?? '' }
    }).sort((a, b) => a.name.localeCompare(b.name))
  }

  // Starts an application for the headset. Its new window is then shown there; an application that only brings
  // forward a window it already has gets that one shown.
  _start(id) {
    const app = Shell.AppSystem.get_default().lookup_app(id)
    if (!app) return
    this._started = { app, had: app.get_windows().map(w => w.get_id()), at: Date.now() }
    app.open_new_window(-1)
  }

  _showStarted(windows, wish) {
    if (!this._started) return
    const { app, had, at } = this._started, mine = app.get_windows().filter(w => windows.includes(w))
    const fresh = mine.find(w => !had.includes(w.get_id())) ?? (Date.now() - at > 2500 ? mine[0] : undefined)
    if (fresh) wish.show = fresh.get_id()
    if (fresh || Date.now() - at > 10000) this._started = null
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
