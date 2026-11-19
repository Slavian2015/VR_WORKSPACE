// The settings window of VR Workspace ("Settings" in its top bar menu, or the Extensions app).
// Nothing is kept here: all settings live in the server (server.js). The window asks it for them twice a second
// and sends every change at once, so it shows the same as the headset and the browser control page.
import Adw from 'gi://Adw'
import Gdk from 'gi://Gdk'
import Gio from 'gi://Gio'
import GLib from 'gi://GLib'
import Gtk from 'gi://Gtk'
import Pango from 'gi://Pango'
import PangoCairo from 'gi://PangoCairo'
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'
import { http, load, talk, power, settingsOnly } from './link.js'
import { qr } from './qr.js'

const CSS = `
  .vr-card { padding: 6px; border-radius: 12px; }
  .vr-card.vr-current { background: alpha(@accent_bg_color, 0.3); }
  .vr-delete { opacity: 0; transition: opacity 150ms; }
  .vr-cell:hover .vr-delete, .vr-delete:focus-visible { opacity: 1; }
  .vr-thumb { border-radius: 8px; background: black; }
  .vr-qr { border-radius: 12px; }
`
const VIDEO = /\.(mp4|webm|mov)$/i

export default class VrWorkspacePrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const session = http()
    const shows = {} // settings key -> function that puts the server's value into its control
    const touched = {} // settings key -> when it was changed here: an answer that was already on its way must not pull it back
    let applying = false // values from the server are being put into the controls: those changes are not the user's
    const change = (key, value) => {
      if (applying) return
      touched[key] = Date.now()
      talk(session, '/params', { [key]: value })
    }
    const fromServer = work => { applying = true; try { work() } finally { applying = false } }

    // Rows. `spec` is [default, min, max, step] as the server gives it.
    // A number: a slider for the hand and a field with +/- for the exact value, both on one adjustment.
    const number = (key, [, min, max, step], title, subtitle = '') => {
      const digits = (String(step).split('.')[1] ?? '').length
      const adjustment = new Gtk.Adjustment({ lower: min, upper: max, step_increment: step, page_increment: step * 10 })
      const slider = new Gtk.Scale({ adjustment, draw_value: false, width_request: 170, valign: Gtk.Align.CENTER })
      // A wheel turned over a slider changes its value, so scrolling the page would change settings on the way:
      // over a slider the wheel scrolls the page, as everywhere else.
      const wheel = new Gtk.EventControllerScroll({ flags: Gtk.EventControllerScrollFlags.VERTICAL, propagation_phase: Gtk.PropagationPhase.CAPTURE })
      wheel.connect('scroll', (_wheel, _dx, dy) => {
        const page = slider.get_ancestor(Gtk.ScrolledWindow.$gtype)?.vadjustment
        if (page) page.value += wheel.get_unit() === Gdk.ScrollUnit.SURFACE ? dy : dy * page.page_size ** (2 / 3) // a wheel click: GTK's own step
        return true
      })
      slider.add_controller(wheel)
      const row = new Adw.ActionRow({ title, subtitle })
      row.add_suffix(slider)
      row.add_suffix(new Gtk.SpinButton({ adjustment, digits, numeric: true, width_chars: 5, valign: Gtk.Align.CENTER })) // one width: the sliders line up
      adjustment.connect('value-changed', () => {
        if (applying) return
        const value = +(Math.round(adjustment.value / step) * step).toFixed(digits) // the slider stops between steps
        if (Math.abs(value - adjustment.value) > 1e-9) adjustment.value = value // which brings us here again
        else change(key, value)
      })
      shows[key] = value => { if (Math.abs(adjustment.value - value) > step / 100) adjustment.value = value }
      return row
    }
    const toggle = (key, title, subtitle = '') => {
      const row = new Adw.SwitchRow({ title, subtitle })
      row.connect('notify::active', () => change(key, row.active))
      shows[key] = value => { if (row.active !== !!value) row.active = !!value }
      return row
    }
    const colour = (key, title, subtitle = '') => { // a colour, kept as #rrggbb
      const button = new Gtk.ColorDialogButton({ dialog: new Gtk.ColorDialog({ with_alpha: false }), valign: Gtk.Align.CENTER })
      const hex = rgba => '#' + [rgba.red, rgba.green, rgba.blue].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
      button.connect('notify::rgba', () => change(key, hex(button.rgba)))
      shows[key] = value => {
        const rgba = new Gdk.RGBA()
        if (rgba.parse(value) && hex(rgba) !== hex(button.rgba)) button.rgba = rgba
      }
      const row = new Adw.ActionRow({ title, subtitle })
      row.add_suffix(button)
      return row
    }
    const action = (title, subtitle, label, run, style) => {
      const button = new Gtk.Button({ label, valign: Gtk.Align.CENTER, css_classes: style ? [style] : [] })
      button.connect('clicked', run)
      const row = new Adw.ActionRow({ title, subtitle, activatable_widget: button })
      row.add_suffix(button)
      return row
    }
    const group = (page, properties, ...rows) => {
      const box = new Adw.PreferencesGroup(properties)
      for (const row of rows) box.add(row)
      page.add(box)
      return box
    }
    const code = text => { // a QR code
      const dark = qr(text), cells = dark.length + 8 // with a white margin of four modules, which scanners need
      const area = new Gtk.DrawingArea({ content_width: cells * 5, content_height: cells * 5 })
      area.set_draw_func((_area, cr, width) => {
        const cell = width / cells
        cr.setSourceRGB(1, 1, 1)
        cr.paint()
        cr.setSourceRGB(0, 0, 0)
        dark.forEach((row, y) => row.forEach((on, x) => on && cr.rectangle((x + 4) * cell, (y + 4) * cell, cell, cell)))
        cr.fill()
        cr.$dispose()
      })
      return new Adw.Bin({ child: area, halign: Gtk.Align.CENTER, margin_top: 6, margin_bottom: 12, overflow: Gtk.Overflow.HIDDEN, css_classes: ['vr-qr'] })
    }

    // ---- Connect: always there, the other pages come when the server has told the ranges of the settings
    const connect = new Adw.PreferencesPage({ title: _('Connect'), icon_name: 'phone-symbolic' })
    window.add(connect)
    const run = new Adw.SwitchRow({ title: 'VR Workspace' })
    let wanted = null // { on, until }: the switch was just used and the server needs a moment to follow
    let failed = false
    run.connect('notify::active', () => {
      if (applying) return
      failed = false
      wanted = { on: run.active, until: Date.now() + (run.active ? 10000 : 3000) }
      try {
        power(run.active)
      } catch (e) { // no systemctl
        window.add_toast(new Adw.Toast({ title: e.message }))
      }
    })
    const start = group(connect, {}, run)
    const showPower = answer => { // the server's answer while VR Workspace is on, else null
      const running = !!answer
      start.description = running ? '' : _('Switch it on to connect the phone: its code appears here. The settings can be changed before that.')
      if (wanted && (running === wanted.on || Date.now() > wanted.until)) {
        failed = wanted.on && !running
        wanted = null
      }
      if (!wanted) fromServer(() => run.active = running)
      run.subtitle = wanted ? (wanted.on ? _('Starting…') : _('Stopping…'))
        : failed ? _('Did not start. Run ./setup.sh in the VR Workspace folder once; the reason is in: journalctl --user -u vr-workspace')
          : !running ? _('Off')
            : answer.phoneOnline ? _('Phone connected: changes are seen in the headset at once') : _('On, waiting for the phone')
    }

    let host, pages // what the server told once; the pages built from it
    let redraw = () => {} // draws the map of the monitors again
    const build = settings => {
      const display = Gdk.Display.get_default()
      const css = new Gtk.CssProvider()
      css.load_from_string(CSS)
      Gtk.StyleContext.add_provider_for_display(display, css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

      const copy = new Gtk.Button({ icon_name: 'edit-copy-symbolic', tooltip_text: _('Copy'), valign: Gtk.Align.CENTER, css_classes: ['flat'] })
      copy.connect('clicked', () => {
        display.get_clipboard().set(host.phone)
        window.add_toast(new Adw.Toast({ title: _('Link copied') }))
      })
      const link = new Adw.ActionRow({ title: _('Link'), subtitle: GLib.markup_escape_text(host.phone, -1), subtitle_selectable: true, css_classes: ['property'] })
      link.add_suffix(copy)
      const first = new Adw.ExpanderRow({ title: _('First time with this iPhone'), subtitle: _('Once: the phone has to trust this PC') })
      for (const step of [
        _('1. Point the camera at the code below and allow the download of the profile'),
        code(host.ca),
        _('2. On the iPhone: Settings → General → VPN and Device Management → install the profile'),
        _('3. Settings → General → About → Certificate Trust Settings → switch on “VR Workspace local CA”'),
        _('4. Open the link from the code at the top in Safari, then Share → Add to Home Screen. Start it from the home screen: only then it is fullscreen'),
        _('5. Switch off the rotation lock, hold the phone in landscape, tap the screen once and put it in the headset'),
      ]) first.add_row(typeof step === 'string' ? new Adw.ActionRow({ title: step }) : step)
      const phone = group(connect, {
        title: _('Phone'),
        description: _('Point the iPhone camera at the code and open the link. The phone and this PC must be on the same Wi-Fi.'),
      }, code(host.phone))
      const more = group(connect, {}, link, first)
      const pc = group(connect, { title: _('On This PC') },
        new Adw.ActionRow({
          title: _('Sound'),
          subtitle: _('While the phone is connected, the sound of this PC plays on the phone (output “VR-Headset”). The volume and mute keys of the PC work as usual'),
        }),
        action(_('See what the headset shows'), _('One flat picture in the browser that follows the head; record it with any screen recorder'), _('Open'),
          () => Gtk.show_uri(window, 'http://localhost:8080/?spectator', Gdk.CURRENT_TIME)))

      // ---- Monitors: a map to arrange them on, what applies to all, then one tab for each
      const monitors = new Adw.PreferencesPage({ title: _('Monitors'), icon_name: 'video-display-symbolic' })
      const monitorKeys = () => Object.keys(shows).filter(key => /^m\d+\./.test(key))
      const tabs = new Gtk.Stack({ vhomogeneous: false })

      // The map is the sphere unrolled and seen from inside: straight ahead in the middle, behind you at both edges,
      // the horizon across. A monitor is as big on it as it looks. Dragging one moves it in the sphere; the headset
      // and GNOME follow when it is let go (GNOME rearranging its monitors at every step of the way would blink).
      const map = new Gtk.DrawingArea({ content_height: 230, hexpand: true, css_classes: ['card'] })
      let held = null, moved = null // the monitor under the pressed pointer; where it has been dragged to
      const boxes = () => last.monitors.map((monitor, i) => {
        const { id, name } = monitor
        const [w, h] = monitor.crop ? monitor.crop.slice(2) : (monitor.virtual ? last[`${id}.size`] : '16x9').split('x') // crop: a single window // shortcut: a real monitor is drawn 16:9, the server does not tell its size
        const wide = Math.min(170, last[`${id}.span`] * 1.5 / last[`${id}.dist`]) // nearer than 1.5 m it looks wider
        const at = moved?.id === id ? moved : { yaw: last[`${id}.yaw`], pitch: last[`${id}.pitch`] }
        return { id, i, name, hidden: last[`${id}.hidden`], yaw: at.yaw, pitch: at.pitch, wide, tall: wide * h / w }
      })
      map.set_draw_func((_area, cr, width, height) => {
        const scale = width / 360, ink = map.get_color()
        const [themed, accent] = map.get_style_context().lookup_color('accent_bg_color')
        const paint = (colour, alpha) => cr.setSourceRGBA(colour.red, colour.green, colour.blue, alpha)
        cr.setLineWidth(1)
        paint(ink, 0.15) // the horizon and straight ahead
        cr.moveTo(0, Math.round(height / 2) + 0.5)
        cr.lineTo(width, Math.round(height / 2) + 0.5)
        cr.moveTo(Math.round(width / 2) + 0.5, 0)
        cr.lineTo(Math.round(width / 2) + 0.5, height)
        cr.stroke()
        for (const box of boxes()) {
          const current = tabs.visible_child_name === box.id, colour = current && themed ? accent : ink
          const w = box.wide * scale, h = box.tall * scale, y = height / 2 - box.pitch * scale - h / 2
          const label = map.create_pango_layout(`${box.i + 1}`)
          const [labelWidth, labelHeight] = label.get_pixel_size()
          for (const turn of [-360, 0, 360]) { // a monitor behind you shows at both edges
            const x = (box.yaw + turn + 180) * scale - w / 2
            if (x > width || x + w < 0) continue
            cr.rectangle(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h))
            paint(colour, box.hidden ? 0.06 : current ? 0.4 : 0.16)
            cr.fillPreserve()
            paint(colour, box.hidden ? 0.3 : 0.85)
            cr.setLineWidth(current ? 2 : 1)
            cr.stroke()
            paint(ink, box.hidden ? 0.4 : 1)
            cr.moveTo(x + (w - labelWidth) / 2, y + (h - labelHeight) / 2)
            PangoCairo.show_layout(cr, label)
          }
        }
        cr.$dispose()
      })
      redraw = () => map.queue_draw()
      tabs.connect('notify::visible-child-name', redraw)
      const drag = new Gtk.GestureDrag()
      drag.connect('drag-begin', (_drag, x, y) => {
        const scale = map.get_width() / 360, middle = map.get_height() / 2
        held = boxes().reverse().find(box => Math.abs(y - (middle - box.pitch * scale)) <= box.tall * scale / 2 &&
          [-360, 0, 360].some(turn => Math.abs(x - (box.yaw + turn + 180) * scale) <= box.wide * scale / 2)) ?? null
        if (!held) return
        drag.set_state(Gtk.EventSequenceState.CLAIMED)
        tabs.visible_child_name = held.id // a click on a monitor opens its tab
      })
      drag.connect('drag-update', (_drag, dx, dy) => {
        if (!held) return
        const scale = map.get_width() / 360, [, lowest, highest] = host.monitor.pitch
        moved = {
          id: held.id,
          yaw: ((Math.round(held.yaw + dx / scale) + 540) % 360) - 180,
          pitch: Math.max(lowest, Math.min(highest, Math.round(held.pitch - dy / scale))),
        }
        redraw()
      })
      drag.connect('drag-end', () => {
        for (const key of moved ? ['yaw', 'pitch'] : []) {
          const name = `${moved.id}.${key}`, value = moved[key]
          last[name] = value
          change(name, value)
          fromServer(() => shows[name]?.(value))
        }
        held = moved = null
        redraw()
      })
      map.add_controller(drag)
      group(monitors, {
        title: _('Arrangement'),
        description: _('The view around you, unrolled: straight ahead is the middle, behind you are the edges, the line across is the horizon. Drag a monitor to where you want to see it. GNOME puts its monitors the same way, so the pointer crosses from one to another where you see them side by side.'),
      }, map)
      group(monitors, {},
        action(_('Centre on gaze'), _('Look where the middle of the map should be, then press'), _('Centre'),
          () => talk(session, '/params', { recenter: Date.now() }), 'suggested-action'),
        new Adw.ActionRow({
          title: _('Arrange in the headset: Num Lock'),
          subtitle: _('While Num Lock is on, the mouse works in the headset. Look at a monitor, hold the left button and carry it with your gaze. Wheel: size. Shift+wheel: curve. Ctrl+wheel: distance. Keys 1–4: hide or show a monitor, 5: centre. Num Lock again gives the mouse back; the rest of the keyboard works as usual.'),
        }),
        toggle('hideMonitors', _('Hide all monitors'), _('To look at the background, or to work with single windows alone: those stay')),
        // 'dist': the distance used to be one for all monitors
        action(_('Reset the arrangement'), _('Every monitor back to its place, size and distance'), _('Reset'),
          () => talk(session, '/params', Object.fromEntries([...monitorKeys().filter(key => !key.endsWith('.size')), 'dist'].map(key => [key, null]))), 'destructive-action')) // not the pixel sizes: that would restart the picture
      const counts = Array.from({ length: settings.maxVirtual + 1 }, (_n, i) => String(i))
      const count = new Adw.ComboRow({ title: _('Number'), model: Gtk.StringList.new(counts) })
      count.connect('notify::selected', () => change('virtual', count.selected))
      group(monitors, {
        title: _('Virtual Monitors'),
        description: _('Extra monitors that exist only in the headset; windows and the pointer go there as to any monitor. Each has its size on its tab below. A change restarts the picture, it is back in about 10 s.'),
      }, count)
      // One tab for each monitor; a click on the map opens the tab of that monitor.
      group(monitors, { title: _('Each Monitor') }, new Gtk.StackSwitcher({ stack: tabs, halign: Gtk.Align.CENTER, margin_bottom: 12 }), tabs)
      let shown // the monitors the page has tabs for
      shows.monitors = list => {
        if (JSON.stringify(list) === shown) return
        shown = JSON.stringify(list)
        const open = tabs.visible_child_name
        for (let tab; (tab = tabs.get_first_child());) tabs.remove(tab)
        for (const key of monitorKeys()) delete shows[key]
        list.forEach(({ id, name, virtual, window: single }, i) => {
          const tab = new Adw.PreferencesGroup()
          const size = virtual
            ? new Adw.ComboRow({ title: _('Size, pixels'), subtitle: _('A change restarts the picture'), model: Gtk.StringList.new(settings.virtualSizes.map(s => s.replace('x', ' × '))) })
            : new Adw.ActionRow({ title: _('Size, pixels'), subtitle: single ? _('This is a single window: it is as big as that window is on the desktop') : _('This is a real monitor: its size is set in GNOME Settings → Displays') })
          if (virtual) {
            size.connect('notify::selected', () => change(`${id}.size`, settings.virtualSizes[size.selected]))
            shows[`${id}.size`] = value => size.selected = settings.virtualSizes.indexOf(value)
          }
          for (const row of [
            size,
            number(`${id}.yaw`, host.monitor.yaw, _('Right / left, °')),
            number(`${id}.pitch`, host.monitor.pitch, _('Up / down, °')),
            number(`${id}.span`, host.monitor.span, _('Width, °'), _('What it takes up at 1.5 m; closer it looks bigger, as a real one does')),
            number(`${id}.curve`, host.monitor.curve, _('Curve, %'), _('100 wraps it around you, 0 makes it flat')),
            number(`${id}.dist`, host.monitor.dist, _('Distance, m')),
            toggle(`${id}.hidden`, _('Hidden'), `${_('While arranging in the headset: key')} ${i + 1}`),
          ]) tab.add(row)
          tabs.add_titled(tab, id, `${i + 1} · ${name}`)
        })
        if (list.some(({ id }) => id === open)) tabs.visible_child_name = open
        count.selected = list.filter(m => m.virtual).length
      }

      // ---- Background: a gallery with a tab for photos and one for videos, then what applies to both.
      // Each tab is a book of pages with 3 x 3 pictures, leafed through sideways (wheel, drag or the arrows).
      const background = new Adw.PreferencesPage({ title: _('Background'), icon_name: 'preferences-desktop-wallpaper-symbolic' })
      const book = () => {
        const carousel = new Adw.Carousel({ spacing: 12 })
        const leaf = by => carousel.n_pages && carousel.scroll_to(carousel.get_nth_page(Math.max(0, Math.min(carousel.n_pages - 1, Math.round(carousel.position) + by))), true)
        const bar = new Gtk.Box({ halign: Gtk.Align.CENTER, spacing: 6 })
        for (const [icon, by, tip] of [['go-previous-symbolic', -1, _('Previous page')], [null], ['go-next-symbolic', 1, _('Next page')]]) {
          if (!icon) { bar.append(new Adw.CarouselIndicatorDots({ carousel })); continue }
          const arrow = new Gtk.Button({ icon_name: icon, tooltip_text: tip, css_classes: ['flat', 'circular'] })
          arrow.connect('clicked', () => leaf(by))
          bar.append(arrow)
        }
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 })
        box.append(carousel)
        box.append(bar)
        return { carousel, box, bar }
      }
      const photos = book(), videos = book()
      const stack = new Gtk.Stack({ vhomogeneous: false })
      stack.add_titled(photos.box, 'photos', _('Photos'))
      stack.add_titled(videos.box, 'videos', _('Videos'))
      group(background, {}, new Gtk.StackSwitcher({ stack, halign: Gtk.Align.CENTER, margin_bottom: 12 }), stack)
      let cards = [], listed // { file, button } of every picture in the gallery; the list they were made from
      shows.bg = file => {
        for (const { file: its, button } of cards) its === file ? button.add_css_class('vr-current') : button.remove_css_class('vr-current')
      }
      const remove = (file, title) => {
        const name = file.replace(/^bg\//, '')
        try { // to the trash, not away: a mistaken click can be undone in Files
          Gio.File.new_for_path(GLib.build_filenamev([host.bgDir, name])).trash(null)
        } catch (e) {
          return window.add_toast(new Adw.Toast({ title: e.message }))
        }
        try { Gio.File.new_for_path(GLib.build_filenamev([host.bgDir, '.thumbs', `${name}.jpg`])).delete(null) } catch {} // its preview
        if (last.bg === file) change('bg', last.bg = 'black') // the headset must not be left with a missing picture
        window.add_toast(new Adw.Toast({ title: `${_('Moved to the trash')}: ${title}` }))
        gallery()
      }
      const card = (file, title, picture, video) => {
        // The Clamp gives the preview its size: a picture alone asks for the size of its file.
        const thumb = new Gtk.Overlay({ child: new Adw.Bin({ child: picture && new Adw.Clamp({ maximum_size: 170, child: picture }), height_request: 84, overflow: Gtk.Overflow.HIDDEN, css_classes: ['vr-thumb'] }) })
        if (video) thumb.add_overlay(new Gtk.Image({ icon_name: 'media-playback-start-symbolic', halign: Gtk.Align.END, valign: Gtk.Align.END, margin_end: 6, margin_bottom: 6, css_classes: ['osd', 'circular'] }))
        const face = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 })
        face.append(thumb)
        face.append(new Gtk.Label({ label: title, ellipsize: Pango.EllipsizeMode.END, css_classes: ['caption'] }))
        const button = new Gtk.Button({ child: face, tooltip_text: title, css_classes: ['flat', 'vr-card'] })
        button.connect('clicked', () => {
          change('bg', file)
          shows.bg(file) // marked at once, as any other control shows what was just chosen
        })
        cards.push({ file, button })
        const cell = new Gtk.Overlay({ child: button, css_classes: ['vr-cell'] })
        if (file !== 'black') { // shown when the pointer is over the picture
          const bin = new Gtk.Button({ icon_name: 'user-trash-symbolic', tooltip_text: _('Move to the trash'), halign: Gtk.Align.END, valign: Gtk.Align.START, margin_top: 10, margin_end: 10, css_classes: ['osd', 'circular', 'vr-delete'] })
          bin.connect('clicked', () => remove(file, title))
          cell.add_overlay(bin)
        }
        return cell
      }
      const fill = ({ carousel, bar }, cells) => {
        const at = Math.round(carousel.position)
        while (carousel.n_pages) carousel.remove(carousel.get_nth_page(0))
        for (let first = 0; first < Math.max(cells.length, 1); first += 9) {
          const page = new Gtk.Grid({ column_homogeneous: true, column_spacing: 6, row_spacing: 6, hexpand: true, valign: Gtk.Align.START })
          // empty places too, so that a page with one picture still has three columns
          for (let i = 0; i < 9; i++) if (cells[first + i] || i < 3) page.attach(cells[first + i] ?? new Adw.Bin(), i % 3, Math.floor(i / 3), 1, 1)
          carousel.append(page)
        }
        bar.visible = carousel.n_pages > 1
        return at
      }
      const turnTo = ({ carousel }, page) => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { // once the pages have their places
        if (carousel.n_pages) carousel.scroll_to(carousel.get_nth_page(Math.min(page, carousel.n_pages - 1)), false)
        return GLib.SOURCE_REMOVE
      })
      const gallery = async () => {
        const files = await talk(session, '/bgs')
        if (!files || JSON.stringify(files) === listed) return
        const first = !listed
        listed = JSON.stringify(files)
        cards = []
        const cells = { photos: [card('black', _('Black'), null)], videos: [] }
        for (const file of files) {
          const name = file.replace(/^bg\//, ''), video = VIDEO.test(name)
          const picture = new Gtk.Picture({ content_fit: Gtk.ContentFit.COVER, can_shrink: true })
          cells[video ? 'videos' : 'photos'].push(card(file, name.replace(/\.\w+$/, '').replaceAll('_', ' '), picture, video))
          load(session, '/thumb/' + encodeURIComponent(name)).then(bytes => {
            try { picture.paintable = Gdk.Texture.new_from_bytes(bytes) } catch {} // no preview: the card stays black
          })
        }
        const were = { photos: fill(photos, cells.photos), videos: fill(videos, cells.videos) }
        fromServer(() => shows.bg(last.bg))
        if (first) { // open at the picture in use
          const tab = VIDEO.test(last.bg) ? 'videos' : 'photos'
          stack.visible_child_name = tab
          were[tab] = Math.floor(Math.max(0, cells[tab].findIndex(cell => cell.child === cards.find(c => c.file === last.bg)?.button)) / 9)
        }
        turnTo(photos, were.photos)
        turnTo(videos, were.videos)
      }
      // Made when the page is first opened (its pages can be turned only once they are on the screen), and looked
      // over every time it is opened again: files may have been added.
      background.connect('map', gallery)
      group(background, {},
        number('bgYaw', host.layout.bgYaw, _('Rotation, °'), _('Turns the scene around you')),
        number('bgDim', host.layout.bgDim, _('Darkening, %'), _('So that the panels stand out. Also in the headset: arranging mode, look down')),
        number('bgBlur', host.layout.bgBlur, _('Blur, %'), _('So that the scene does not draw the eye')),
        toggle('autoBlack', _('Black while a window is fullscreen'), _('For films: the scene goes dark around them')),
        action(_('Your own backgrounds'), _('Put 360° photos or videos (equirectangular, twice as wide as tall; .jpg, .png, .mp4, .webm, .mov) into the folder'), _('Open Folder'),
          () => Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(host.bgDir, null), null)))

      // ---- Headset: the phone's camera and the lenses
      const headset = new Adw.PreferencesPage({ title: _('Headset'), icon_name: 'camera-photo-symbolic' })
      const camera = new Adw.ActionRow({ title: _('Camera the phone gave'), css_classes: ['property'], visible: false })
      shows.camLabel = label => Object.assign(camera, { subtitle: GLib.markup_escape_text(label, -1), visible: true })
      group(headset, {
        title: _('Phone Camera'),
        description: _('See the room through the camera of the phone. It is open only while its picture is needed.'),
      },
      toggle('passthrough', _('Camera as the background'), _('Pass-through: the room instead of the scene, the monitors stay')),
      number('camBelow', host.layout.camBelow, _('Camera when looking down, °'), _('To see the keyboard and your hands: the camera shows below this angle under the horizon. 0 switches it off')),
      toggle('camKeep', _('Keep the camera open'), _('The phone then asks for permission once, at the start, and not at every look down; its camera sign stays on. For a page started from the iPhone home screen, which does not remember the permission')),
      number('camFov', host.layout.camFov, _('Camera view angle, °'), _('Set it so that things look their real size')),
      number('camShiftX', host.layout.camShiftX, _('Shift the picture right / left, °')),
      number('camShiftY', host.layout.camShiftY, _('Shift the picture up / down, °')),
      camera)
      group(headset, {
        title: _('Picture'),
      },
      number('sharpen', host.layout.sharpen, _('Text sharpness, %'), _('Crisper letters through the lenses; too much draws bright edges around them')))
      group(headset, {
        title: _('Highlights'),
        description: _('A soft light around panels: the one in the arranging mode under the pointer, being carried or resized, and the window that gets the keyboard.'),
      },
      colour('glowColor', _('Colour'), _('It drifts a little around the panel')),
      toggle('focusGlow', _('Light the window that gets the keyboard'), _('What you type on the PC goes there')))
      group(headset, {
        title: _('Lens Calibration'),
        description: _('First the two distances, until both pictures merge without eye strain. Then k1 and k2, until straight lines are straight at the edges. Then the colour fringes, until white text near the edge has no red and blue outlines. The background “test grid” shows all of it best.'),
      },
      number('lensDist', host.lens.lensDist, _('Screen to lens, mm')),
      number('ipd', host.lens.ipd, _('Lens separation, mm')),
      number('k1', host.lens.k1, _('Lens distortion k1')),
      number('k2', host.lens.k2, _('Lens distortion k2')),
      number('chroma', host.lens.chroma, _('Colour fringes, %')),
      number('screenW', host.lens.screenW, _('Phone screen width, mm')),
      number('cx', host.lens.cx, _('Centre shift, horizontal, mm')),
      number('cy', host.lens.cy, _('Centre shift, vertical, mm')),
      action(_('Reset the calibration'), _('Back to the values found for an iPhone 15 Pro in a Gear VR'), _('Reset'),
        () => talk(session, '/params', Object.fromEntries(Object.keys(host.lens).map(key => [key, null]))), 'destructive-action'))

      pages = [monitors, background, headset]
      for (const page of pages) window.add(page)
      pages.push(phone, more, pc)
    }

    let last, seen, busy = false, asked = 0 // the settings as last answered; the same as text; an answer is awaited; when the settings-only server was last asked for
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const settings = await talk(session, '/params?full')
        const on = !!settings && !settings.settingsOnly
        showPower(on ? settings : null)
        // VR Workspace is off: the settings come from the same server started without the stream. Asked for again
        // every few seconds until it answers; not while the switch is being followed, starting it would stop that.
        if (!settings && !wanted && Date.now() - asked > 3000) {
          asked = Date.now()
          try { settingsOnly(true) } catch {} // no systemctl: the window then has only the switch
        }
        if (settings && !pages) {
          host = await talk(session, '/host')
          if (host) build(last = settings)
        }
        // The settings work whenever a server answers; the phone's links are of use only while VR Workspace is on.
        for (const part of pages ?? []) part instanceof Adw.PreferencesPage ? part.sensitive = !!settings : part.visible = on
        if (!settings || !pages || JSON.stringify(settings) === seen) return
        last = settings
        seen = JSON.stringify(settings)
        fromServer(() => {
          shows.monitors(settings.monitors) // first: it makes the rows of the monitors, which then get their values
          for (const [key, show] of Object.entries(shows)) if (settings[key] !== undefined && !(Date.now() - touched[key] < 1000)) show(settings[key])
        })
        redraw()
      } finally {
        busy = false
      }
    }
    tick()
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => (tick(), GLib.SOURCE_CONTINUE))
    window.connect('close-request', () => {
      GLib.source_remove(timer)
      session.abort()
      try { settingsOnly(false) } catch {} // if it was ours; VR Workspace itself is not touched
      return false
    })
    window.set_default_size(700, 860)
    window.search_enabled = true
  }
}
