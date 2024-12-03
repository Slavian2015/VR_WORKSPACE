import { Utilities } from 'Utilities';
import { XpraProtocol } from "protocol";

const XPRA_CLIENT_FORCE_NO_WORKER = false;
const CLIPBOARD_IMAGES = true;
const CLIPBOARD_EVENT_DELAY = 100;
const DECODE_WORKER = !!window.createImageBitmap;
const SHOW_START_MENU = true;
const FILE_SIZE_LIMIT = 4 * 1024 * 1024 * 1024; //are we even allowed to allocate this much memory?
const FILE_CHUNKS_SIZE = 128 * 1024;
const MAX_CONCURRENT_FILES = 5;
const CHUNK_TIMEOUT = 10 * 1000;

const TEXT_PLAIN = "text/plain";
const UTF8_STRING = "UTF8_STRING";
const TEXT_HTML = "text/html";

const FLOAT_MENU_SELECTOR = "#float_menu";
const PASTEBOARD_SELECTOR = "#pasteboard";
const WINDOW_PREVIEW_SELECTOR = "#window_preview";

const BELL_SOUND =  "data:audio/wav;base64,//uQRAAAAWMSLwUIYAAsYkXgoQwAEaYLWfkWgAI0wWs/ItAAAGDgYtAgAyN+QWaAAihwMWm4G8QQRDiMcCBcH3Cc+CDv/7xA4Tvh9Rz/y8QADBwMWgQAZG/ILNAARQ4GLTcDeIIIhxGOBAuD7hOfBB3/94gcJ3w+o5/5eIAIAAAVwWgQAVQ2ORaIQwEMAJiDg95G4nQL7mQVWI6GwRcfsZAcsKkJvxgxEjzFUgfHoSQ9Qq7KNwqHwuB13MA4a1q/DmBrHgPcmjiGoh//EwC5nGPEmS4RcfkVKOhJf+WOgoxJclFz3kgn//dBA+ya1GhurNn8zb//9NNutNuhz31f////9vt///z+IdAEAAAK4LQIAKobHItEIYCGAExBwe8jcToF9zIKrEdDYIuP2MgOWFSE34wYiR5iqQPj0JIeoVdlG4VD4XA67mAcNa1fhzA1jwHuTRxDUQ//iYBczjHiTJcIuPyKlHQkv/LHQUYkuSi57yQT//uggfZNajQ3Vmz+Zt//+mm3Wm3Q576v////+32///5/EOgAAADVghQAAAAA//uQZAUAB1WI0PZugAAAAAoQwAAAEk3nRd2qAAAAACiDgAAAAAAABCqEEQRLCgwpBGMlJkIz8jKhGvj4k6jzRnqasNKIeoh5gI7BJaC1A1AoNBjJgbyApVS4IDlZgDU5WUAxEKDNmmALHzZp0Fkz1FMTmGFl1FMEyodIavcCAUHDWrKAIA4aa2oCgILEBupZgHvAhEBcZ6joQBxS76AgccrFlczBvKLC0QI2cBoCFvfTDAo7eoOQInqDPBtvrDEZBNYN5xwNwxQRfw8ZQ5wQVLvO8OYU+mHvFLlDh05Mdg7BT6YrRPpCBznMB2r//xKJjyyOh+cImr2/4doscwD6neZjuZR4AgAABYAAAABy1xcdQtxYBYYZdifkUDgzzXaXn98Z0oi9ILU5mBjFANmRwlVJ3/6jYDAmxaiDG3/6xjQQCCKkRb/6kg/wW+kSJ5//rLobkLSiKmqP/0ikJuDaSaSf/6JiLYLEYnW/+kXg1WRVJL/9EmQ1YZIsv/6Qzwy5qk7/+tEU0nkls3/zIUMPKNX/6yZLf+kFgAfgGyLFAUwY//uQZAUABcd5UiNPVXAAAApAAAAAE0VZQKw9ISAAACgAAAAAVQIygIElVrFkBS+Jhi+EAuu+lKAkYUEIsmEAEoMeDmCETMvfSHTGkF5RWH7kz/ESHWPAq/kcCRhqBtMdokPdM7vil7RG98A2sc7zO6ZvTdM7pmOUAZTnJW+NXxqmd41dqJ6mLTXxrPpnV8avaIf5SvL7pndPvPpndJR9Kuu8fePvuiuhorgWjp7Mf/PRjxcFCPDkW31srioCExivv9lcwKEaHsf/7ow2Fl1T/9RkXgEhYElAoCLFtMArxwivDJJ+bR1HTKJdlEoTELCIqgEwVGSQ+hIm0NbK8WXcTEI0UPoa2NbG4y2K00JEWbZavJXkYaqo9CRHS55FcZTjKEk3NKoCYUnSQ0rWxrZbFKbKIhOKPZe1cJKzZSaQrIyULHDZmV5K4xySsDRKWOruanGtjLJXFEmwaIbDLX0hIPBUQPVFVkQkDoUNfSoDgQGKPekoxeGzA4DUvnn4bxzcZrtJyipKfPNy5w+9lnXwgqsiyHNeSVpemw4bWb9psYeq//uQZBoABQt4yMVxYAIAAAkQoAAAHvYpL5m6AAgAACXDAAAAD59jblTirQe9upFsmZbpMudy7Lz1X1DYsxOOSWpfPqNX2WqktK0DMvuGwlbNj44TleLPQ+Gsfb+GOWOKJoIrWb3cIMeeON6lz2umTqMXV8Mj30yWPpjoSa9ujK8SyeJP5y5mOW1D6hvLepeveEAEDo0mgCRClOEgANv3B9a6fikgUSu/DmAMATrGx7nng5p5iimPNZsfQLYB2sDLIkzRKZOHGAaUyDcpFBSLG9MCQALgAIgQs2YunOszLSAyQYPVC2YdGGeHD2dTdJk1pAHGAWDjnkcLKFymS3RQZTInzySoBwMG0QueC3gMsCEYxUqlrcxK6k1LQQcsmyYeQPdC2YfuGPASCBkcVMQQqpVJshui1tkXQJQV0OXGAZMXSOEEBRirXbVRQW7ugq7IM7rPWSZyDlM3IuNEkxzCOJ0ny2ThNkyRai1b6ev//3dzNGzNb//4uAvHT5sURcZCFcuKLhOFs8mLAAEAt4UWAAIABAAAAAB4qbHo0tIjVkUU//uQZAwABfSFz3ZqQAAAAAngwAAAE1HjMp2qAAAAACZDgAAAD5UkTE1UgZEUExqYynN1qZvqIOREEFmBcJQkwdxiFtw0qEOkGYfRDifBui9MQg4QAHAqWtAWHoCxu1Yf4VfWLPIM2mHDFsbQEVGwyqQoQcwnfHeIkNt9YnkiaS1oizycqJrx4KOQjahZxWbcZgztj2c49nKmkId44S71j0c8eV9yDK6uPRzx5X18eDvjvQ6yKo9ZSS6l//8elePK/Lf//IInrOF/FvDoADYAGBMGb7FtErm5MXMlmPAJQVgWta7Zx2go+8xJ0UiCb8LHHdftWyLJE0QIAIsI+UbXu67dZMjmgDGCGl1H+vpF4NSDckSIkk7Vd+sxEhBQMRU8j/12UIRhzSaUdQ+rQU5kGeFxm+hb1oh6pWWmv3uvmReDl0UnvtapVaIzo1jZbf/pD6ElLqSX+rUmOQNpJFa/r+sa4e/pBlAABoAAAAA3CUgShLdGIxsY7AUABPRrgCABdDuQ5GC7DqPQCgbbJUAoRSUj+NIEig0YfyWUho1VBBBA//uQZB4ABZx5zfMakeAAAAmwAAAAF5F3P0w9GtAAACfAAAAAwLhMDmAYWMgVEG1U0FIGCBgXBXAtfMH10000EEEEEECUBYln03TTTdNBDZopopYvrTTdNa325mImNg3TTPV9q3pmY0xoO6bv3r00y+IDGid/9aaaZTGMuj9mpu9Mpio1dXrr5HERTZSmqU36A3CumzN/9Robv/Xx4v9ijkSRSNLQhAWumap82WRSBUqXStV/YcS+XVLnSS+WLDroqArFkMEsAS+eWmrUzrO0oEmE40RlMZ5+ODIkAyKAGUwZ3mVKmcamcJnMW26MRPgUw6j+LkhyHGVGYjSUUKNpuJUQoOIAyDvEyG8S5yfK6dhZc0Tx1KI/gviKL6qvvFs1+bWtaz58uUNnryq6kt5RzOCkPWlVqVX2a/EEBUdU1KrXLf40GoiiFXK///qpoiDXrOgqDR38JB0bw7SoL+ZB9o1RCkQjQ2CBYZKd/+VJxZRRZlqSkKiws0WFxUyCwsKiMy7hUVFhIaCrNQsKkTIsLivwKKigsj8XYlwt/WKi2N4d//uQRCSAAjURNIHpMZBGYiaQPSYyAAABLAAAAAAAACWAAAAApUF/Mg+0aohSIRobBAsMlO//Kk4soosy1JSFRYWaLC4qZBYWFRGZdwqKiwkNBVmoWFSJkWFxX4FFRQWR+LsS4W/rFRb/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////VEFHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU291bmRib3kuZGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMjAwNGh0dHA6Ly93d3cuc291bmRib3kuZGUAAAAAAAAAACU=";

const METADATA_SUPPORTED = [
    "fullscreen", "maximized",
    "iconic", "above", "below",
    "title", "size-hints",
    "class-instance", "transient-for", "window-type",
    "has-alpha", "decorations", "override-redirect",
    "tray", "modal", "opacity",
]

function truncate(input) {
  if (!input) {
    return input;
  }
  const s = input.toString();
  if (s.length > 5) {
    return s.slice(0, 5) + "..."; // eslint-disable-line prefer-template
  }
  return s;
}


class LightXpraClient {
  constructor(container) {
    this.container = document.querySelector(`#${container}`);
    if (!this.container) {
      throw new Error('invalid container element');
    }

    this.protocol = new XpraProtocol();


    this.init_settings();
    this.init_state();
  }

  init() {
    this.init_packet_handlers();
    this.init_keyboard();
  }


  init_packet_handlers() {
    this.packet_handlers = {
      [PACKET_TYPES.ack_file_chunk]: this._process_ack_file_chunk,
      [PACKET_TYPES.bell]: this._process_bell,
      [PACKET_TYPES.challenge]: this._process_challenge,
      [PACKET_TYPES.clipboard_request]: this._process_clipboard_request,
      [PACKET_TYPES.clipboard_token]: this._process_clipboard_token,
      [PACKET_TYPES.close]: this._process_close,
      [PACKET_TYPES.configure_override_redirect]: this._process_configure_override_redirect,
      [PACKET_TYPES.cursor]: this._process_cursor,
      [PACKET_TYPES.desktop_size]: this._process_desktop_size,
      [PACKET_TYPES.disconnect]: this._process_disconnect,
      [PACKET_TYPES.draw]: this._process_draw,
      [PACKET_TYPES.encodings]: this._process_encodings,
      [PACKET_TYPES.eos]: this._process_eos,
      [PACKET_TYPES.error]: this._process_error,
      [PACKET_TYPES.hello]: this._process_hello,
      [PACKET_TYPES.info_response]: this._process_info_response,
      [PACKET_TYPES.initiate_moveresize]: this._process_initiate_moveresize,
      [PACKET_TYPES.lost_window]: this._process_lost_window,
      [PACKET_TYPES.new_override_redirect]: this._process_new_override_redirect,
      [PACKET_TYPES.new_tray]: this._process_new_tray,
      [PACKET_TYPES.new_window]: this._process_new_window,
      [PACKET_TYPES.notify_close]: this._process_notify_close,
      [PACKET_TYPES.notify_show]: this._process_notify_show,
      [PACKET_TYPES.open]: this._process_open,
      [PACKET_TYPES.open_url]: this._process_open_url,
      [PACKET_TYPES.ping]: this._process_ping,
      [PACKET_TYPES.ping_echo]: this._process_ping_echo,
      [PACKET_TYPES.pointer_position]: this._process_pointer_position,
      [PACKET_TYPES.raise_window]: this._process_raise_window,
      [PACKET_TYPES.startup_complete]: this._process_startup_complete,
      [PACKET_TYPES.window_icon]: this._process_window_icon,
      [PACKET_TYPES.window_metadata]: this._process_window_metadata,
      [PACKET_TYPES.window_move_resize]: this._process_window_move_resize,
      [PACKET_TYPES.window_resized]: this._process_window_resized,
    };
  }

  init_settings() {

    this.host = null;
    this.port = null;
    this.ssl = null;
    this.webtransport = false;
    this.uri = "";


    this.id_to_window = {};
    this.events = {};
    this.open_url = true;

    //connection options:
    this.remote_logging = true;
    this.debug_categories = [];
    this.start_new_session = null;
    this.clipboard_enabled = false;
    this.clipboard_poll = false;
    this.clipboard_preferred_format = TEXT_PLAIN;
    this.keyboard_layout = null;
    this.printing = false;
    this.key_packets = [];
    this.clipboard_delayed_event_time = 0;


    // state
    this.connected = false;
    this.desktop_width = 0;
    this.desktop_height = 0;
    this.server_remote_logging = false;
    this.server_start_time = -1;
    this.client_start_time = new Date();

    // some client stuff
    this.capabilities = {};
    this.RGB_FORMATS = ["RGBX", "RGBA", "RGB"];
    this.disconnect_reason = null;
    this.password_prompt_fn = null;
    this.keycloak_prompt_fn = null;

    // detect locale change:
    this.browser_language = Utilities.getFirstBrowserLanguage();
    this.browser_language_change_embargo_time = 0;
    this.key_layout = null;
    this.last_keycode_pressed = 0;
    this.last_key_packet = [];

    // mouse
    this.buttons_pressed = new Set();
    this.last_button_event = [-1, false, -1, -1];
    this.mousedown_event = null;
    this.last_mouse_x = null;
    this.last_mouse_y = null;
    this.wheel_delta_x = 0;
    this.wheel_delta_y = 0;
    this.mouse_grabbed = false;
    this.scroll_reverse_x = false;
    this.scroll_reverse_y = "auto";

    // clipboard
    this.clipboard_direction = default_settings["clipboard_direction"] || "both";
    this.clipboard_datatype = null;
    this.clipboard_buffer = "";
    this.clipboard_server_buffers = {};
    this.clipboard_pending = false;
    this.clipboard_targets = [TEXT_HTML, UTF8_STRING, "TEXT", "STRING", TEXT_PLAIN];

    // hello
    this.hello_timer = null;
    this.open_timer = null;
    this.info_timer = null;
    this.info_request_pending = false;
    this.server_last_info = {};
    // ping
    this.ping_timeout_timer = null;
    this.ping_grace_timer = null;
    this.ping_timer = null;
    this.last_ping_server_time = 0;
    this.last_ping_local_time = 0;
    this.last_ping_echoed_time = 0;
    this.server_ping_latency = 0;
    this.client_ping_latency = 0;
    this.server_load = null;
    this.server_ok = false;
    //packet handling
    this.decode_worker = null;

    this.scale = 1;
    this.vrefresh = -1;
    this.bandwidth_limit = 0;
    this.reconnect = true;
    this.reconnect_count = 5;
    this.reconnect_in_progress = false;
    this.reconnect_delay = 1000; //wait 1 second before retrying
    this.reconnect_attempt = 0;

    this.HELLO_TIMEOUT = 30000;
    this.OPEN_TIMEOUT = 2000;
    this.PING_TIMEOUT = 15000;
    this.PING_GRACE = 2000;
    this.PING_FREQUENCY = 5000;
    this.INFO_FREQUENCY = 1000;
    this.uuid = Utilities.getHexUUID();
    this.try_gpu = TRY_GPU_TRIGGER;
  }

  connect() {
    let details = `${this.host}:${this.port}`;
    this.uri = `ws://${details}`;
    this.on_connection_progress("Connecting to server", details, 40);
    this.open_protocol();
  }

  remove_windows() {
    for (const wid in this.id_to_window) {
      const win = this.id_to_window[wid];
      window.removeWindowListItem(win.wid);
      win.destroy();
    }
  }

  do_reconnect() {
    //try again:
    this.reconnect_in_progress = true;
    const protocol = this.protocol;
    setTimeout(() => {
      try {
        this.remove_windows();
        this.clear_timers();
        this.init_state();
        if (protocol) {
          this.protocol = null;
          protocol.terminate();
        }
        this.emit_connection_lost();
        this.connect();
      } finally {
        this.reconnect_in_progress = false;
      }
    }, this.reconnect_delay);
  }

  open_protocol() {
    this.protocol.set_packet_handler((packet) => this._route_packet(packet));
    this.on_connection_progress("Opening WebSocket connection", this.uri, 50);
    this.protocol.open(this.uri);
    console.log("open_protocol() done");
    this.emit('open');
  }

  close_protocol() {
    this.connected = false;
    if (this.protocol) {
      this.protocol.close();
      this.protocol = null;
    }
  }

  _route_packet(packet) {
    const packet_type = Utilities.s(packet[0]);
    this.debug("network", "received a", packet_type, "packet");
    const function_ = this.packet_handlers[packet_type];
    if (function_ == undefined) {
      this.cerror("no packet handler for ", packet_type);
      this.clog(packet);
    } else {
      function_.call(this, packet);
    }

    // // Handle packet routing here
    // if (packet_type === 'open') {
    //   this.emit('connect');
    // }
  }

  on_connection_progress(state, details, progress) {
    console.log("STATE :", state, "details", details);
  }

  debug(category, ...args) {
    if (this.debug_categories.includes(category)) {
      console.debug(...args);
    }
  }


  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event].forEach(listener => listener(...args));
    }
  }

  // _process_new_tray(packet) {
  //   const wid = packet[1];
  //   const metadata = packet[4];
  //   const mydiv = document.createElement("div");
  //   mydiv.id = String(wid);
  //   const mycanvas = document.createElement("canvas");
  //   mydiv.append(mycanvas);

  //   const float_tray = document.querySelector("#float_tray");
  //   const float_menu = document.querySelector(FLOAT_MENU_SELECTOR);
  //   const float_menu_element = $(FLOAT_MENU_SELECTOR);
  //   float_menu_element.children().show();
  //   //increase size for tray icon
  //   const new_width = float_menu_width + float_menu_item_size - float_menu_padding + 5;
  //   float_menu.style.width = `${new_width}px`;
  //   float_menu_width = float_menu_element.width() + 10;
  //   mydiv.style.backgroundColor = "white";

  //   float_tray.append(mydiv);
  //   const x = 0;
  //   const y = 0;
  //   const w = float_menu_item_size;
  //   const h = float_menu_item_size;

  //   mycanvas.width = w;
  //   mycanvas.height = h;
  //   this.id_to_window[wid] = new XpraWindow(this, wid,
  //     x, y, w, h,
  //     metadata, false, true,
  //     {},
  //     //TODO: send new tray geometry to the server using send_tray_configure
  //     () => this.debug("tray", "tray geometry changed (ignored)"),
  //     (event, window) => this.on_mousemove(event, window),
  //     (event, window) => this.on_mousedown(event, window),
  //     (event, window) => this.on_mouseup(event, window),
  //     (event, window) => this.on_mousescroll(event, window),
  //     () => this.debug("tray", "tray set focus (ignored)"),
  //     () => this.debug("tray", "tray closed (ignored)"),
  //     this.scale
  //   );
  //   this.send_tray_configure(wid);
  // }


  // do_process_draw(packet, start) {
  //   if (!packet) {
  //     //no valid draw packet, likely handle errors for that here
  //     return;
  //   }
  //   const ptype = packet[0];
  //   const wid = packet[1];
  //   const win = this.id_to_window[wid];
  //   if (ptype == "eos") {
  //     this.debug("draw", "eos for window", wid);
  //     if (win) {
  //       win.eos();
  //     }
  //     return;
  //   }

  //   const width = packet[4];
  //   const height = packet[5];
  //   const coding = Utilities.s(packet[6]);
  //   const packet_sequence = packet[8];
  //   const options = packet[10] || {};
  //   const protocol = this.protocol;
  //   if (!protocol) {
  //     return;
  //   }
  //   const me = this;
  //   function send_damage_sequence(decode_time, message) {
  //     me.do_send_damage_sequence(packet_sequence, wid, width, height, decode_time, message);
  //   }
  //   const client = this;
  //   function decode_result(error) {
  //     const flush = options["flush"] || 0;
  //     let decode_time = Math.round(1000 * performance.now() - 1000 * start);
  //     if (flush == 0) {
  //       client.request_redraw(win);
  //     }
  //     if (error || start == 0) {
  //       this.request_redraw(win);
  //       decode_time = -1;
  //     }
  //     client.debug("draw", "decode time for ", coding, " sequence ", packet_sequence, ": ", decode_time, ", flush=", flush);
  //     send_damage_sequence(decode_time, error || "");
  //   }
  //   if (!win) {
  //     this.debug("draw", "cannot paint, window not found:", wid);
  //     send_damage_sequence(-1, `window ${wid} not found`);
  //     return;
  //   }
  //   if (coding == "offscreen-painted") {
  //     const decode_time = options["decode_time"];
  //     send_damage_sequence(decode_time || 0, "");
  //     return;
  //   }
  //   try {
  //     win.paint(packet, decode_result);
  //   } catch (error) {
  //     this.exc(error, "error painting", coding, "sequence no", packet_sequence);
  //     send_damage_sequence(-1, String(error));
  //     //there may be other screen updates pending:
  //     win.paint_pending = 0;
  //     win.may_paint_now();
  //     this.request_redraw(win);
  //   }
  // }


  // /**
  //  * Window Painting
  //  */
  // _process_draw(packet) {
  //   //ensure that the pixel data is in a byte array:
  //   const coding = Utilities.s(packet[6]);
  //   let img_data = packet[7];
  //   const raw_buffers = [];
  //   const now = performance.now();
  //   if (coding != "scroll") {
  //     raw_buffers.push(img_data.buffer);
  //   }
  //   if (this.decode_worker) {
  //     this.decode_worker.postMessage(
  //       { cmd: "decode", packet, start: now },
  //       raw_buffers
  //     );
  //     //the worker draw event will call do_process_draw
  //   } else {
  //     this.do_process_draw(packet, now);
  //   }
  // }

  // _process_eos(packet) {
  //   this.do_process_draw(packet, 0);
  //   const wid = packet[1];
  //   if (this.decode_worker) {
  //     this.decode_worker.postMessage({ cmd: "eos", wid });
  //   }
  // }

  // request_redraw(win) {
  //   if (document.hidden) {
  //     this.debug("draw", "not redrawing, document.hidden=", document.hidden);
  //     return;
  //   }

  //   if (this.offscreen_api) {
  //     this.decode_worker.postMessage({ cmd: "redraw", wid: win.wid });
  //     return;
  //   }
  //   // request that drawing to screen takes place at next available opportunity if possible
  //   this.debug("draw", "request_redraw for", win);
  //   win.swap_buffers();
  //   if (!window.requestAnimationFrame) {
  //     // requestAnimationFrame is not available, draw immediately
  //     win.draw();
  //     return;
  //   }
  //   if (!this.pending_redraw.includes(win)) {
  //     this.pending_redraw.push(win);
  //   }
  //   if (this.draw_pending) {
  //     // already scheduled
  //     return;
  //   }
  //   // schedule a screen refresh if one is not already due:
  //   this.draw_pending = performance.now();
  //   window.requestAnimationFrame(() => {
  //     this.draw_pending_list();
  //   });
  // }

  // draw_pending_list() {
  //   const elapsed = performance.now() - this.draw_pending;
  //   this.debug("draw", "animation frame:", this.pending_redraw.length, "windows to paint, processing delay", elapsed, "ms");
  //   this.draw_pending = 0;
  //   // draw all the windows in the list:
  //   while (this.pending_redraw.length > 0) {
  //     const w = this.pending_redraw.shift();
  //     w.draw();
  //   }
  // }

  //   /**
  //  * Cursors
  //  */
  //   reset_cursor() {
  //     for (const wid in this.id_to_window) {
  //       const win = this.id_to_window[wid];
  //       win.reset_cursor();
  //     }
  //   }
  
  //   _process_cursor(packet) {
  //     if (packet.length < 9) {
  //       this.reset_cursor();
  //       return;
  //     }
  //     //we require a png encoded cursor packet:
  //     const encoding = packet[1];
  //     if (encoding != "png") {
  //       this.warn(`invalid cursor encoding: ${encoding}`);
  //       return;
  //     }
  //     const w = packet[4];
  //     const h = packet[5];
  //     const xhot = packet[6];
  //     const yhot = packet[7];
  //     const img_data = packet[9];
  //     for (const wid in this.id_to_window) {
  //       const win = this.id_to_window[wid];
  //       win.set_cursor(encoding, w, h, xhot, yhot, img_data);
  //     }
  //   }
  
  //   _process_window_icon(packet) {
  //     const wid = packet[1];
  //     const w = packet[2];
  //     const h = packet[3];
  //     const encoding = packet[4];
  //     const img_data = packet[5];
  //     this.debug("main", "window-icon: ", encoding, " size ", w, "x", h);
  //     const win = this.id_to_window[wid];
  //     if (win) {
  //       const source = win.update_icon(w, h, encoding, img_data);
  //       //update favicon too:
  //       if (wid == this.focus || this.server_is_desktop || this.server_is_shadow) {
  //         jQuery("#favicon").attr("href", source);
  //       }
  //     }
  //   }

  // init(ignore_blacklist) {
  //   this.on_connection_progress("Initializing", "", 20);
  //   this.init_packet_handlers();
  //   this.init_keyboard();
  //   if (this.scale !== 1) {
  //     this.container.style.width = `${100 * this.scale}%`;
  //     this.container.style.height = `${100 * this.scale}%`;
  //     this.container.style.transform = `scale(${1 / this.scale})`;
  //     this.container.style.transformOrigin = "top left";
  //   }
  // }

  // init_packet_handlers() {
  //   // the client holds a list of packet handlers
  //   this.packet_handlers = {
  //     [PACKET_TYPES.ack_file_chunk]: this._process_ack_file_chunk,
  //     [PACKET_TYPES.bell]: this._process_bell,
  //     [PACKET_TYPES.close]: this._process_close,
  //     [PACKET_TYPES.configure_override_redirect]: this._process_configure_override_redirect,
  //     [PACKET_TYPES.cursor]: this._process_cursor,
  //     [PACKET_TYPES.desktop_size]: this._process_desktop_size,
  //     [PACKET_TYPES.disconnect]: this._process_disconnect,
  //     [PACKET_TYPES.draw]: this._process_draw,
  //     [PACKET_TYPES.encodings]: this._process_encodings,
  //     [PACKET_TYPES.eos]: this._process_eos,
  //     [PACKET_TYPES.info_response]: this._process_info_response,
  //     [PACKET_TYPES.lost_window]: this._process_lost_window,
  //     [PACKET_TYPES.new_override_redirect]: this._process_new_override_redirect,
  //     [PACKET_TYPES.new_tray]: this._process_new_tray,
  //     [PACKET_TYPES.new_window]: this._process_new_window,
  //     [PACKET_TYPES.open]: this._process_open,
  //     [PACKET_TYPES.open_url]: this._process_open_url,
  //     [PACKET_TYPES.ping]: this._process_ping,
  //     [PACKET_TYPES.ping_echo]: this._process_ping_echo,
  //     [PACKET_TYPES.pointer_position]: this._process_pointer_position,
  //     [PACKET_TYPES.startup_complete]: this._process_startup_complete,
  //     [PACKET_TYPES.window_icon]: this._process_window_icon,
  //   };
  // }

}

export { LightXpraClient };