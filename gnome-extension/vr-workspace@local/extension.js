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
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js'
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js'
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js'
import { http, talk, power, SERVER } from './link.js'

Gio._promisify(Shell.Screenshot, 'composite_to_stream') // as GNOME Shell's own screenshots do
const isGlasses = window => window.get_title()?.startsWith('VR Workspace — glasses') ?? false // the title index.html?glasses gives itself

export default class VrWorkspace extends Extension {
  enable() {
    this._http = http()
    this._shownWindows = [] // GNOME's ids of the windows shown in the headset one by one
    this._copies = new Map() // the copies of popups laid into those windows: copy -> { popup, window }
    this._inside = null // a headset on a cable: { id, window, rect, corners, barriers, box, push, timer } while the PC's mouse works inside a monitor or window (_follow)
    this._windowCreated = global.display.connect('window-created', (_display, window) => {
      this._copyPopup(window)
      this._note(window, 'opened')
      // GNOME opens a window where the pointer is, which on a cable is the headset's own screen: there it would lie
      // over the headset's picture until the pointer went into its panel (VS Code did, 2026-11-20). Moved at once.
      const types = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG]
      if (!types.includes(window.get_window_type())) return
      const shown = window.connect('shown', () => { window.disconnect(shown); this._offHeadset(window) })
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
    this._fullscreenChanged = global.display.connect('in-fullscreen-changed', () => {
      this._reportFullscreen()
      this._keepPointerOn()
    })
    Main.layoutManager.connectObject('monitors-changed', () => this._keepPointerOn(), this)
    this._reportFullscreen()
    this._keymap = Clutter.get_default_backend().get_default_seat().get_keymap()
    this._numLock = this._keymap.get_num_lock_state() // only a change counts: Num Lock may be on already at login
    this._keymapChanged = this._keymap.connect('state-changed', () => this._onKeymap())
    // The pointer's shape (an arrow, a hand, a text cursor), for the pointer the headset draws over a window: GNOME
    // leaves the pointer out of a window's recording, so the server gets its picture whenever it changes.
    this._cursorTracker = Meta.CursorTracker.get_for_display(global.display)
    this._cursorChanged = this._cursorTracker.connect('cursor-changed', () => this._cursorSoon())
    // GNOME shows its pointer again at every move of the mouse: hidden again at once while the headset draws it (_follow)
    this._cursorShown = this._cursorTracker.connect('visibility-changed', () => this._inside && this._cursorTracker.get_pointer_visible() && this._cursorTracker.set_pointer_visible(false))
    // The emergency key, Ctrl+Alt+Backspace, always: back to the plain desktop, whatever the headset or the glasses
    // show. Glasses on a cable may be the only screen, and a picture that hangs there would leave one blind.
    // (Ctrl+Alt+Escape is GNOME's own.) Asked from the window manager: it works in every state of the desktop.
    this._emergency = global.display.grab_accelerator('<Control><Alt>BackSpace', Meta.KeyBindingFlags.NONE)
    if (this._emergency === Meta.KeyBindingAction.NONE) console.log('VR Workspace: Ctrl+Alt+Backspace is taken, there is no emergency key')
    else Main.wm.allowKeybinding(Meta.external_binding_name_for_action(this._emergency), Shell.ActionMode.ALL)
    this._emergencyPressed = global.display.connect('accelerator-activated', (_display, action) => action === this._emergency && this._emergencyStop())
    // The Super key (and the Activities corner) call Main.overview.toggle(): through us while we are enabled.
    this._toggleOverview = Main.overview.toggle
    Main.overview.toggle = (...args) => this._overview(...args)
    // GNOME's notifications, to the headset as well: who wears it does not see the banners on the PC.
    Main.messageTray.connectObject('source-added', (_tray, source) => this._watchSource(source), this)
    for (const source of Main.messageTray.getSources()) this._watchSource(source)
    this._keepPointerOn() // a picture already open: GNOME turns extensions off while the screen is locked, and on again
  }

  disable() {
    this._leave()
    this._out()
    global.display.disconnect(this._windowCreated)
    global.display.disconnect(this._focusChanged)
    for (const copy of this._copies.keys()) copy.destroy()
    this._copies.clear()
    for (const source of [this._watch, this._startCheck, this._windowsBeat, this._soon]) if (source) GLib.source_remove(source)
    this._watch = this._startCheck = this._windowsBeat = this._soon = 0
    if (this._stopPressed) this._stopButton.disconnect(this._stopPressed)
    this._stopPressed = 0
    this._indicator.destroy()
    this._indicator = null
    this._keymap.disconnect(this._keymapChanged)
    global.display.disconnect(this._fullscreenChanged)
    Main.layoutManager.disconnectObject(this)
    for (const barrier of this._barriers ?? []) barrier.destroy()
    this._barriers = []
    this._cursorTracker.disconnect(this._cursorChanged)
    this._cursorTracker.disconnect(this._cursorShown)
    this._nudger = this._keyboard = null
    global.display.disconnect(this._emergencyPressed)
    Main.overview.toggle = this._toggleOverview
    if (this._emergency !== Meta.KeyBindingAction.NONE) global.display.ungrab_accelerator(this._emergency)
    Main.messageTray.disconnectObject(this)
    for (const source of Main.messageTray.getSources()) source.disconnectObject(this)
    if (this._cursorTimer) GLib.source_remove(this._cursorTimer)
    this._cursorTimer = 0
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
    // A headset on a cable: its picture, a window of its own filling the screen it opens on
    this._cable = new PopupMenu.PopupSwitchMenuItem(_('Headset on a Cable'), false)
    this._cable.connect('toggled', (_item, on) => {
      if (on) return this._openPicture()
      this._pictureAsked = 0
      this._glassesWindow()?.delete(global.get_current_time())
    })
    menu.addMenuItem(this._cable)
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
      // (the picture takes a few seconds to open and to be known by its title)
      this._cable.setToggleState(!!this._glassesWindow() || Date.now() - (this._pictureAsked ?? 0) < 8000)
      this._cable.setSensitive(on || !!this._glassesWindow()) // a picture left open can be closed here also with the server off
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
    // A window of the headset never stays on the screen that shows the headset's picture, where it covers it: also
    // one that its program put back after it was shown (VS Code goes back to its last place). Once a second.
    if (Date.now() - (this._offAt ?? 0) > 1000) {
      this._offAt = Date.now()
      for (const w of windows) if (this._shownWindows.includes(w.get_id())) this._offHeadset(w)
    }
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
    talk(this._http, '/windows', { open, focus: global.display.focus_window?.get_id() ?? 0, picture: this._pictureScreen(), ...wish }).then(answer => {
      if (!this._indicator) return // switched off meanwhile
      this._serverSeen = !!answer
      this._connectors = answer?.connectors ?? []
      const before = this._shownWindows.length
      this._shownWindows = answer?.shown ?? []
      this._phoneOnline = !!answer?.phoneOnline
      if (answer && this._numLockSeen !== undefined && answer.numLock !== this._numLockSeen) this._pressNumLock()
      if (answer) this._numLockSeen = answer.numLock
      if (this._menuSince && answer?.menuOpen) this._hold()
      else if (this._menuSince && Date.now() - this._menuSince > 2000) this._leave() // the page has closed it (or is gone)
      // Windows came into the headset (the pointer may have changed while none was there), or the server started anew
      if (this._shownWindows.length && (!before || answer.cursor === false)) {
        this._cursorSent = null
        this._cursorSoon()
      }
      this._needApps = !!answer?.needApps
      // Not while a menu of it is open: the menu is what is being worked, and Qt programs (VLC) lose track of their
      // windows when theirs is activated under an open menu.
      const active = windows.find(w => w.get_id() === answer?.active)
      if (active && active !== global.display.focus_window && ![...this._copies.values()].some(c => c.window === active)) {
        console.log(`VR Workspace: bringing ${active.get_description()} "${active.get_title()}" to the front`)
        active.activate(global.get_current_time())
      }
      if (answer?.launch) this._start(answer.launch)
      if (answer?.resize) this._resize(windows.find(w => w.get_id() === answer.resize.id), answer.resize)
      const onCable = !!this._glassesWindow()
      if (onCable && !this._catcher && !this._editing) this._follow(answer?.enter, windows)
      else this._out()
      // While a window is resized from the headset: the next report in a tenth of a second, not in half of one. With
      // a headset on a cable in a twentieth: its pointer going onto a monitor or window is felt.
      if ((answer?.soon || onCable) && !this._soon) this._soon = GLib.timeout_add(GLib.PRIORITY_DEFAULT, onCable ? 50 : 100, () => (this._soon = 0, this._http && this._tellWindows(), GLib.SOURCE_REMOVE))
    })
  }

  // GNOME's name of the monitor that shows the picture of a headset on a cable, of those the server named: that
  // monitor is no panel in the headset (a picture of itself). null: no such picture, or on a monitor that is not there.
  _pictureScreen() {
    const glasses = this._glassesWindow()
    if (!glasses?.is_fullscreen()) return null
    const manager = global.backend.get_monitor_manager()
    return (this._connectors ?? []).find(name => manager.get_monitor_for_connector(name) === glasses.get_monitor()) ?? null
  }

  // The pointer's picture and its hot spot (the pixel that points), to the server: only while windows are in the
  // headset, and at most ten times a second (an animated pointer, "busy", changes all the time).
  _cursorSoon() {
    if (this._cursorTimer || (!this._shownWindows.length && !this._inside) || !this._serverSeen) return
    this._cursorTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      this._cursorTimer = 0
      this._sendCursor().catch(e => console.log(`VR Workspace: the pointer's picture: ${e.message}`))
      return GLib.SOURCE_REMOVE
    })
  }

  async _sendCursor() {
    const sprite = this._cursorTracker.get_sprite(), [x, y] = this._cursorTracker.get_hot()
    let png = '' // none: the pointer is hidden
    if (sprite) {
      const stream = Gio.MemoryOutputStream.new_resizable()
      await Shell.Screenshot.composite_to_stream(sprite, 0, 0, -1, -1, 1, null, 0, 0, 1, stream)
      stream.close(null)
      png = GLib.base64_encode(stream.steal_as_bytes().toArray())
    }
    if (!this._http || `${png}${x},${y}` === this._cursorSent) return
    this._cursorSent = `${png}${x},${y}`
    talk(this._http, '/cursor', { png, hot: [x, y] })
  }

  // The emergency key: the glasses view off the screen at once (minimised by the window manager itself, so also when
  // the page hangs, then asked to close), the mouse let go, and VR Workspace switched off. Its virtual monitors go
  // with it, and their windows come back to the real screen.
  _emergencyStop() {
    const time = global.get_current_time()
    for (const window of global.get_window_actors().map(actor => actor.meta_window)) {
      if (!isGlasses(window)) continue
      if (window.is_fullscreen()) window.unmake_fullscreen()
      window.minimize()
      window.delete(time)
    }
    this._leave()
    this._out()
    this._setPower(false)
    Main.notify('VR Workspace', _('Switched off by the emergency key (Ctrl+Alt+Backspace)'))
  }

  // A new notification goes to the server when GNOME would show it as a banner (the same rules as its own: not when
  // already seen, not of low urgency, not in "Do Not Disturb" or for an application whose banners are off, unless it
  // is urgent), and only while the server runs. Taken when added, before GNOME's own banner marks it as seen (its
  // request for a banner reaches GNOME first), and not again when it is updated (a download's progress).
  _watchSource(source) {
    source.connectObject('notification-added', (_source, notification) => {
      if (!this._serverSeen || notification.acknowledged || notification.urgency === MessageTray.Urgency.LOW) return
      if (!source.policy.showBanners && notification.urgency !== MessageTray.Urgency.CRITICAL) return
      const gicon = notification.gicon ?? source.icon
      const icon = (gicon && new St.IconTheme().lookup_by_gicon(gicon, 128, St.IconLookupFlags.FORCE_SIZE))?.get_filename() ?? ''
      const plain = text => (text ?? '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
      talk(this._http, '/notify', { app: source.title ?? '', title: plain(notification.title), body: notification.useBodyMarkup ? plain(notification.body) : notification.body ?? '', icon })
    }, this)
  }

  // A size the headset asked for (dragged at a side or a corner there): the opposite sides stay where they are.
  _resize(window, { w, h, edge: [left, , top] }) {
    if (!window?.allows_resize()) return
    if (window.get_maximized()) window.unmaximize(Meta.MaximizeFlags.BOTH)
    const r = window.get_frame_rect()
    window.move_resize_frame(true, left ? r.x + r.width - w : r.x, top ? r.y + r.height - h : r.y, w, h)
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
  _reportFullscreen() { // a film, say; not the glasses' own picture (it would turn the scene in it black)
    const fullscreen = global.get_window_actors().some(({ meta_window: window }) => window.is_fullscreen() && !isGlasses(window))
    this._talk({ fullscreen })
  }

  // A window off the headset's own screen, where it would lie over the headset's picture: onto another monitor
  _offHeadset(window) {
    const glasses = this._glassesWindow(), screen = glasses?.get_monitor()
    if (glasses?.is_fullscreen() && window !== glasses && window.get_monitor() === screen && global.display.get_n_monitors() > 1)
      window.move_to_monitor(screen === 0 ? 1 : 0)
  }

  // Opens the picture of a headset on a cable: Chromium's window of its own (closing it closes nothing else), on
  // the whole screen at once. It decodes the streams on the processor, to keep this PC's picture off the GPU's
  // video engine, which hung on 2026-11-21 (that alone did not stop the hangs: see windows.py).
  _openPicture() {
    this._pictureAsked = Date.now()
    try {
      Gio.Subprocess.new(['chromium', `--app=${SERVER}/?glasses`, '--start-fullscreen', '--disable-accelerated-video-decode'], Gio.SubprocessFlags.NONE)
    } catch (e) { // no Chromium
      this._pictureAsked = 0
      this._cable.setToggleState(false)
      Main.notify('VR Workspace', e.message)
    }
  }

  // The window of a headset on a cable (index.html?glasses), or undefined
  _glassesWindow() {
    return global.get_window_actors().map(actor => actor.meta_window).find(isGlasses)
  }

  // Four barriers on the sides of a box that let the pointer only in, or only out. Mutter blocks a motion unless all
  // its directions are allowed, so a side lets the motion along it through too (in and down at once is in).
  _box(x0, y0, x1, y1, onlyIn) {
    const D = Meta.BarrierDirection, alongY = D.POSITIVE_Y | D.NEGATIVE_Y, alongX = D.POSITIVE_X | D.NEGATIVE_X
    const barrier = (bx1, by1, bx2, by2, directions) => new Meta.Barrier({ backend: global.backend, x1: bx1, y1: by1, x2: bx2, y2: by2, directions })
    const [left, right, top, bottom] = onlyIn ? [D.POSITIVE_X, D.NEGATIVE_X, D.POSITIVE_Y, D.NEGATIVE_Y] : [D.NEGATIVE_X, D.POSITIVE_X, D.NEGATIVE_Y, D.POSITIVE_Y]
    return [barrier(x0, y0, x0, y1, left | alongY), barrier(x1, y0, x1, y1, right | alongY), barrier(x0, y0, x1, y0, top | alongX), barrier(x0, y1, x1, y1, bottom | alongX)]
  }

  // Puts the pointer there. After a bare warp GNOME and the programs miss the next click until the mouse moves (a
  // click on a window just entered was lost), so a pixel there and back follows, as from a mouse.
  _warp(x, y) {
    const seat = Clutter.get_default_backend().get_default_seat(), now = GLib.get_monotonic_time()
    seat.warp_pointer(x, y)
    this._nudger ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE)
    this._nudger.notify_relative_motion(now, 1, 0)
    this._nudger.notify_relative_motion(now, -1, 0)
  }

  // A headset on a cable, its picture filling a screen: the PC's pointer stays on that screen, where the picture takes
  // it as the headset's own pointer (barriers let it in, not out), except while it works inside a monitor or window
  // (_follow). A pointer elsewhere is brought to the middle of it. at: where it is, if just put there (GNOME moves it
  // a moment later, and asked at once tells where it was: it was brought to the middle after coming out of a window).
  _keepPointerOn(at = global.get_pointer()) {
    for (const barrier of this._barriers ?? []) barrier.destroy()
    this._barriers = []
    const glasses = this._glassesWindow()
    if (!glasses?.is_fullscreen() || this._inside || this._catcher) return
    const { x, y, width, height } = global.display.get_monitor_geometry(glasses.get_monitor()), [px, py] = at
    if (px < x || px >= x + width || py < y || py >= y + height) this._warp(x + width / 2, y + height / 2)
    this._barriers = this._box(x, y, x + width, y + height, true)
  }

  // A headset on a cable: the PC's mouse goes into the monitor or window the headset's pointer is on (`asked`, from
  // its page through the server), as the phone's mouse works in the sphere. The real pointer is put there, at that
  // place, and kept inside (a window: with its open menus) by barriers; a window comes to the front (one on the
  // headset's own screen, under its picture, is moved to another monitor first). The mouse and the keyboard then work
  // there directly. GNOME's own pointer is hidden meanwhile: the headset draws it at once, from where it is told
  // sixty times a second (in the pictures it would come a tenth of a second late). Pushed hard past a side, the
  // pointer goes back onto the headset's picture, at that side (the panel's corners on the picture come with `asked`).
  _follow(asked, windows) {
    const inside = this._inside
    if (inside) {
      if (asked?.id === inside.id) inside.corners = asked.corners // the head turns: the panel moves on the picture
      return this._fit()
    }
    if (!asked || asked.u < 0) {
      // u -1: the headset thinks the pointer inside (it sends only the corners), and it is not. Told again: the news
      // of its coming out was lost, or a place sent just before it arrived after it, and the two waited for each
      // other for ever (the pointer stuck in a window, 2026-11-21).
      if (asked && this._http) talk(this._http, '/pointer', { out: true })
      return
    }
    let window = null, rect
    if (asked.source) {
      window = windows.find(w => w.get_id() === asked.source)
      if (!window) return
      this._offHeadset(window)
      window.activate(global.get_current_time())
      rect = window.get_frame_rect()
    } else {
      const screen = global.backend.get_monitor_manager().get_monitor_for_connector(asked.connector)
      if (screen < 0 || screen === this._glassesWindow()?.get_monitor()) return
      rect = global.display.get_monitor_geometry(screen)
    }
    for (const barrier of this._barriers ?? []) barrier.destroy() // the picture's own, which keep the pointer on it
    this._barriers = []
    this._inside = { id: asked.id, window, rect, corners: asked.corners, barriers: [], box: '', push: 0, since: Date.now() }
    this._warp(Math.min(rect.x + asked.u * rect.width, rect.x + rect.width - 1), Math.min(rect.y + asked.v * rect.height, rect.y + rect.height - 1))
    // Hidden, GNOME's pointer would also stop pointing for the programs (no clicks reach them) unless told to go on
    Clutter.get_default_backend().get_default_seat().inhibit_unfocus()
    this._cursorTracker.set_pointer_visible(false)
    this._fit()
    this._cursorSent = null // its shape, too
    this._cursorSoon()
    let told = ''
    this._inside.timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
      const now = this._inside, r = now && this._rect(now)
      if (!r) return GLib.SOURCE_CONTINUE // a window closed: let go at the next report (_fit)
      const [px, py] = global.get_pointer(), u = (px - r.x) / r.width, v = (py - r.y) / r.height, place = `${u.toFixed(4)},${v.toFixed(4)}`
      if (place !== told && this._http) {
        told = place
        talk(this._http, '/pointer', { id: now.id, u, v })
      }
      return GLib.SOURCE_CONTINUE
    })
  }

  // The rectangle of what the PC's mouse works in: a window's frame (null once it is closed), or a monitor
  _rect(inside) {
    return inside.window ? (inside.window.get_compositor_private() ? inside.window.get_frame_rect() : null) : inside.rect
  }

  // The barriers that keep the pointer inside: around a window and its open menus (they come and go), or a monitor.
  // Pushing on one counts; pushed far enough, the pointer goes back out at that side.
  _fit() {
    const inside = this._inside, r = this._rect(inside)
    if (!r) return this._out() // the window was closed under the pointer
    const boxes = [r, ...(inside.window ? [...this._copies.values()].filter(c => c.window === inside.window).map(({ popup }) => popup.get_frame_rect()) : [])]
    const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y))
    const x1 = Math.max(...boxes.map(b => b.x + b.width)), y1 = Math.max(...boxes.map(b => b.y + b.height))
    // The barriers keep in only what is in. A window that became smaller or went elsewhere under the pointer (out
    // of fullscreen, a menu closed) leaves it outside, unseen and free on the desktop: then it comes out for good.
    // Not right after going in: the pointer gets there a moment after it is put.
    const [px, py] = global.get_pointer()
    if (Date.now() - inside.since > 200 && (px < x0 - 1 || px > x1 || py < y0 - 1 || py > y1)) return this._out()
    if ([x0, y0, x1, y1].join() === inside.box) return
    for (const barrier of inside.barriers) barrier.destroy()
    inside.box = [x0, y0, x1, y1].join()
    inside.barriers = this._box(x0, y0, x1, y1, true)
    inside.barriers.forEach((barrier, side) => {
      barrier.connect('hit', (_barrier, event) => {
        inside.push += Math.abs(event.dx) + Math.abs(event.dy)
        if (inside.push > 40 && this._inside === inside) this._out(side) // a deliberate push, not a brush along the side
      })
      barrier.connect('left', () => { inside.push = 0 })
    })
  }

  // Out of the monitor or window: back onto the headset's picture where the side left by is on it (from the panel's
  // corners there, a little beyond it), GNOME's pointer shown again, the headset told. Side undefined (the list, the
  // arranging): just where it is seen on the picture.
  _out(side) {
    const inside = this._inside
    if (!inside) return
    const r = this._rect(inside), [px, py] = global.get_pointer()
    GLib.source_remove(inside.timer)
    for (const barrier of inside.barriers) barrier.destroy()
    this._inside = null
    this._cursorTracker.set_pointer_visible(true)
    Clutter.get_default_backend().get_default_seat().uninhibit_unfocus()
    if (this._http) talk(this._http, '/pointer', { out: true })
    const glasses = this._glassesWindow(), g = glasses?.get_frame_rect()
    let at
    if (g && r) {
      const clamp = n => Math.min(1, Math.max(0, n)), u = clamp((px - r.x) / r.width), v = clamp((py - r.y) / r.height)
      const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      const [topLeft, topRight, bottomRight, bottomLeft] = inside.corners, [mx, my] = lerp(lerp(topLeft, topRight, u), lerp(bottomLeft, bottomRight, u), v)
      const [ox, oy] = [[-1, 0], [1, 0], [0, -1], [0, 1]][side] ?? [0, 0]
      at = [g.x + clamp(mx + 0.02 * ox) * (g.width - 1), g.y + clamp(my + 0.02 * oy) * (g.height - 1)]
      this._warp(...at)
    }
    this._keepPointerOn(at)
  }

  // The PC's Num Lock pressed for the phone's keyboard (its F12: an iPhone gives a page no Num Lock), so that the
  // arranging mode stays one thing, whichever keyboard switches it
  _pressNumLock() {
    this._keyboard ??= Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE)
    const now = GLib.get_monotonic_time()
    this._keyboard.notify_key(now, 69, Clutter.KeyState.PRESSED) // Linux's KEY_NUMLOCK
    this._keyboard.notify_key(now, 69, Clutter.KeyState.RELEASED)
  }

  _onKeymap() {
    const on = this._keymap.get_num_lock_state()
    if (on === this._numLock) return // it was Caps Lock
    this._numLock = on
    if (!on) return this._leave()
    // Num Lock is an ordinary key too: the mouse is taken only while a phone is actually connected.
    this._talk(null, answer => (answer?.phoneOnline || this._glassesWindow()) && this._numLock && this._http && this._enter())
  }

  // The mouse: an actor laid over everything takes the clicks and the wheel that would reach windows and panels.
  _takeMouse() {
    this._catcher = new St.Widget({ reactive: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height })
    Main.layoutManager.uiGroup.add_child(this._catcher)
    this._smooth = 0
    this._catcher.connect('button-press-event', (_actor, event) => this._button(event, true))
    this._catcher.connect('button-release-event', (_actor, event) => this._button(event, false))
    this._catcher.connect('scroll-event', (_actor, event) => this._scroll(event))
    this._hold()
  }

  _enter() {
    if (this._editing) return
    if (this._catcher) this._leave() // our list had it: the arranging mode closes the list anyway
    this._editing = true
    // With a headset on a cable its picture takes the mouse itself, as the phone's screen takes the phone's mouse
    if (!this._glassesWindow()) this._takeMouse()
    else if (this._inside) this._out() // the arranging works on the panels, not inside them (_out keeps it on the picture)
    else this._keepPointerOn()
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
    if (!catcher) return // a headset on a cable: no catcher
    catcher.remove_transition('leave')
    catcher.translation_x = 0
    // An explicit transition: unlike eased properties it also runs with animations switched off in the system.
    const leave = new Clutter.PropertyTransition({ property_name: 'translation-x', delay: 3000, duration: 1 })
    leave.set_interval(new Clutter.Interval({ value_type: GObject.TYPE_FLOAT, initial: 0, final: -4 * global.stage.width }))
    catcher.add_transition('leave', leave)
  }

  _leave() { // the arranging mode, or our list: the mouse back to the desktop
    this._menuSince = 0
    if (this._editing) {
      this._editing = false
      GLib.source_remove(this._beat)
      global.display.disconnect(this._keyPressed)
      for (const action of this._keys.keys()) global.display.ungrab_accelerator(action)
      this._talk({ edit: false })
    }
    if (!this._catcher) return
    this._catcher.destroy()
    this._catcher = null
    this._talk({ grab: false })
    this._keepPointerOn()
  }

  // The Super key while the headset is in use (a phone connected, or the picture of a headset on a cable open): our
  // list of applications in the sphere, not GNOME's overview, which would show flat on a screen no one looks at. The
  // mouse is held for the list until the page says it is closed (it says it is open every second, so if the page is
  // gone the mouse comes back within 3 s). Its left button chooses what is looked at; the right one closes it.
  _overview(...args) {
    const inHeadset = this._phoneOnline || global.get_window_actors().some(actor => isGlasses(actor.meta_window))
    if (!inHeadset || !this._http) return this._toggleOverview.apply(Main.overview, args)
    this._talk({ menuCall: Date.now() })
    if (this._glassesWindow()) return this._out() // on a cable the headset's picture takes the mouse itself (its pointer out of any window, for the list)
    if (this._catcher) return // the arranging mode has it (and closes the list), or the list has it already
    this._takeMouse()
    this._menuSince = Date.now()
  }

  _button(event, pressed) {
    if (event.get_button() === Clutter.BUTTON_PRIMARY) this._talk({ grab: pressed })
    else if (event.get_button() === Clutter.BUTTON_SECONDARY && pressed && this._menuSince) this._talk({ menuCall: Date.now() }) // closes our list
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
