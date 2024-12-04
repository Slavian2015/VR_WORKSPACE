import { XpraProtocol, XpraProtocolWorkerHost } from "protocol";
import { XpraWebTransportProtocol } from "XpraWebTransportProtocol";
import { divWindow } from 'divWindow';
import { CSS3DObject } from "CSS3DObject";
import { Utilities } from "Utilities";


const DECODE_WORKER = !!window.createImageBitmap;
const TEXT_PLAIN = "text/plain";
const UTF8_STRING = "UTF8_STRING";
const TEXT_HTML = "text/html";
const TRY_GPU_TRIGGER = true;


class CustomClientProtocol {
    constructor(scene, serverUri, mainRadius) {
        this.serverUri = serverUri;
        this.mainRadius = mainRadius;
        this.canvas = null;
        this.scene = scene;

        this.init_settings();
        this.init_state();

        this.init_packet_handlers();

        this.protocol = null;
    }

    init_settings() {
        this.scale = 1;
        this.vrefresh = -1;
        this.bandwidth_limit = 0;
        this.start_new_session = null;
        this.keyboard_layout = null;

        this.reconnect = true;
        this.reconnect_count = 5;
        this.reconnect_in_progress = false;
        this.reconnect_delay = 1000;
        this.reconnect_attempt = 0;

        this.HELLO_TIMEOUT = 30_000;
        this.OPEN_TIMEOUT = 2_000;
        this.PING_TIMEOUT = 15_000;
        this.PING_GRACE = 2000;
        this.PING_FREQUENCY = 5000;
        this.INFO_FREQUENCY = 1000;
        this.uuid = Utilities.getHexUUID();

        this.offscreen_api = false;
        this.try_gpu = TRY_GPU_TRIGGER;

        this.init_encodings();
    }

    init_encodings() {
        this.encoding = "auto";
        //basic set of encodings:
        //(more may be added after checking via the DecodeWorker)
        this.supported_encodings = [
            "jpeg",
            "png",
            "png/P",
            "png/L",
            "rgb",
            "rgb32",
            "rgb24",
            "scroll",
            "void",
        ];
        //extra encodings we enable if validated via the decode worker:
        //(we also validate jpeg and png as a sanity check)
        this.check_encodings = [
            "jpeg",
            "png",
            "png/P",
            "png/L",
            "rgb",
            "rgb32",
            "rgb24",
            "scroll",
            "webp",
            "void",
            "avif",
        ];
        // this may be overriden after detecting the offscreen worker:
        const video_max_size = [1024, 768];
        this.encoding_options = {
            "": this.encoding,
            "icons": {
                "max_size": [30, 30],
            },
            "transparency": true,
            "rgb_lz4": (lz4 && lz4.decode != "undefined"),
            "decoder-speed": { "video": 0 },
            "color-gamut": Utilities.getColorGamut(),
            "video_scaling": true,
            "video_max_size": video_max_size,
            "full_csc_modes": {
                "mpeg1": ["YUV420P"],
                "h264": ["YUV420P"],
                "mpeg4+mp4": ["YUV420P"],
                "h264+mp4": ["YUV420P"],
                "vp8+webm": ["YUV420P"],
                "webp": ["BGRX", "BGRA"],
                "jpeg": ["BGRX", "BGRA", "BGR", "RGBX", "RGBA", "RGB", "YUV420P", "YUV422P", "YUV444P"],
                "vp8": ["YUV420P"],
            },
            "h264": {
                "score-delta": 80,
                "YUV420P": {
                    "profile": "baseline",
                    "level": "2.1",
                    "cabac": false,
                    "deblocking-filter": false,
                    "fast-decode": true,
                },
            },
            "h264+mp4": {
                "score-delta": 50,
                "YUV420P": {
                    "profile": "baseline",
                    "level": "3.0",
                },
            },
            //prefer unmuxed VPX
            "vp8": {
                "score-delta": 70,
            },
            "mpeg4+mp4": {
                "score-delta": 40,
            },
            "vp8+webm": {
                "score-delta": 40,
            },
        };
    }

    init_state() {
        // state
        this.connected = false;
        this.server_remote_logging = false;
        this.server_start_time = -1;
        this.client_start_time = new Date();

        // some client stuff
        this.capabilities = {};
        this.RGB_FORMATS = ["RGBX", "RGBA", "RGB"];
        this.disconnect_reason = null;
        this.password_prompt_fn = null;
        this.keycloak_prompt_fn = null;

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

        this.server_display = "";
        this.server_platform = "";
        this.server_resize_exact = false;
        this.server_screen_sizes = [];

        this.server_connection_data = false;

        // a list of our windows
        this.id_to_window = {};
        this.ui_events = 0;
        this.pending_redraw = [];
        this.draw_pending = 0;

        // basic window management
        this.topwindow = null;
        this.topindex = 0;
        this.focus = 0;

        const me = this;
    }

    init_packet_handlers() {
        this.packet_handlers = {
            //   [PACKET_TYPES.ack_file_chunk]: this._process_ack_file_chunk,
            [PACKET_TYPES.bell]: this._process_bell,
            // [PACKET_TYPES.challenge]: this._process_challenge,
            //   [PACKET_TYPES.clipboard_request]: this._process_clipboard_request,
            //   [PACKET_TYPES.clipboard_token]: this._process_clipboard_token,
            [PACKET_TYPES.close]: this._process_close,
            //   [PACKET_TYPES.configure_override_redirect]: this._process_configure_override_redirect,
            //   [PACKET_TYPES.cursor]: this._process_cursor,
            [PACKET_TYPES.desktop_size]: this._process_desktop_size,
            [PACKET_TYPES.disconnect]: this._process_disconnect,
            //   [PACKET_TYPES.draw]: this._process_draw,
            [PACKET_TYPES.encodings]: this._process_encodings,
            //   [PACKET_TYPES.eos]: this._process_eos,
            [PACKET_TYPES.error]: this._process_error,
            [PACKET_TYPES.hello]: this._process_hello,
            //   [PACKET_TYPES.info_response]: this._process_info_response,
            //   [PACKET_TYPES.initiate_moveresize]: this._process_initiate_moveresize,
            //   [PACKET_TYPES.lost_window]: this._process_lost_window,
            //   [PACKET_TYPES.new_override_redirect]: this._process_new_override_redirect,
            //   [PACKET_TYPES.new_tray]: this._process_new_tray,
            //   [PACKET_TYPES.new_window]: this._process_new_window,
            //   [PACKET_TYPES.notify_close]: this._process_notify_close,
            //   [PACKET_TYPES.notify_show]: this._process_notify_show,
            [PACKET_TYPES.open]: this._process_open,
            //   [PACKET_TYPES.open_url]: this._process_open_url,
            [PACKET_TYPES.ping]: this._process_ping,
            [PACKET_TYPES.ping_echo]: this._process_ping_echo,
            //   [PACKET_TYPES.pointer_position]: this._process_pointer_position,
            //   [PACKET_TYPES.raise_window]: this._process_raise_window,
            //   [PACKET_TYPES.send_file]: this._process_send_file,
            //   [PACKET_TYPES.send_file_chunk]: this._process_send_file_chunk,
            //   [PACKET_TYPES.set_clipboard_enabled]: this._process_set_clipboard_enabled,
            //   [PACKET_TYPES.setting_change]: this._process_setting_change,
            //   [PACKET_TYPES.sound_data]: this._process_sound_data,
            [PACKET_TYPES.startup_complete]: this._process_startup_complete,
            //   [PACKET_TYPES.window_icon]: this._process_window_icon,
            [PACKET_TYPES.window_metadata]: this._process_window_metadata,
            //   [PACKET_TYPES.window_move_resize]: this._process_window_move_resize,
            //   [PACKET_TYPES.window_resized]: this._process_window_resized,
        };
    }

    send() {
        this.debug("network", "sending a", arguments[0], "packet");
        if (this.protocol) {
            this.protocol.send.apply(this.protocol, arguments);
        }
    }

    send_log(level, arguments_) {
        if (this.remote_logging && this.server_remote_logging && this.connected) {
            try {
                const sargs = [];
                for (const argument of arguments_) {
                    sargs.push(unescape(encodeURIComponent(String(argument))));
                }
                this.send([PACKET_TYPES.logging, level, sargs]);
            } catch {
                this.cerror("remote logging failed");
                for (const index in arguments_) {
                    const argument = arguments_[index];
                    this.clog(" argument", index, typeof argument, ":", `'${argument}'`);
                }
            }
        }
    }
    exc() {
        //first argument is the exception:
        const exception = arguments[0];
        let arguments_ = [...arguments];
        arguments_ = arguments_.splice(1);
        if (arguments_.length > 0) {
            this.cerror(arguments_);
        }
        if (exception.stack) {
            try {
                //logging.ERROR = 40
                this.send_log(40, [exception.stack]);
            } catch {
                //we tried our best
            }
        }
    }
    error() {
        //logging.ERROR = 40
        this.send_log(40, arguments);
        Reflect.apply(this.cerror, this, arguments);
    }
    cerror() {
        Utilities.cerror.apply(Utilities, arguments);
    }
    warn() {
        //logging.WARN = 30
        this.send_log(30, arguments);
        Reflect.apply(this.cwarn, this, arguments);
    }
    cwarn() {
        Utilities.cwarn.apply(Utilities, arguments);
    }
    log() {
        //logging.INFO = 20
        this.send_log(20, arguments);
        Reflect.apply(this.clog, this, arguments);
    }
    clog() {
        Utilities.clog.apply(Utilities, arguments);
    }
    debug() {
        const category = arguments[0];
        const arguments_ = [...arguments];
        if (this.debug_categories.includes(category)) {
            if (category != "network") {
                //logging.DEBUG = 10
                this.send_log(10, arguments_);
            }
            Reflect.apply(this.cdebug, this, arguments);
        }
    }
    cdebug() {
        Utilities.cdebug.apply(Utilities, arguments);
    }

    callback_close(reason) {
        if (reason === undefined) {
            reason = "unknown reason";
        }
        this.clog(`connection closed: ${reason}`);
    }

    /**
     * Info
     */
    start_info_timer() {
        if (this.info_timer == undefined) {
            this.info_timer = setInterval(() => {
                if (this.info_timer != undefined) {
                    this.send_info_request();
                }
            }, this.INFO_FREQUENCY);
        }
    }

    send_info_request() {
        if (!this.info_request_pending) {
            this.send([PACKET_TYPES.info_request, [this.uuid], [], []]);
            this.info_request_pending = true;
        }
    }

    _process_info_response(packet) {
        this.info_request_pending = false;
        this.server_last_info = packet[1];
        this.debug("network", "info-response:", this.server_last_info);
        const event = document.createEvent("Event");
        event.initEvent("info-response", true, true);
        event.data = this.server_last_info;
        document.dispatchEvent(event);
    }

    stop_info_timer() {
        if (this.info_timer) {
            clearTimeout(this.info_timer);
            this.info_timer = null;
            this.info_request_pending = false;
        }
    }

    _update_capabilities(appendobj) {
        for (const attribute in appendobj) {
            this.capabilities[attribute] = appendobj[attribute];
        }
    }

    /**
     * Ping
     */
    _check_server_echo(ping_sent_time) {
        const last = this.server_ok;
        this.server_ok = this.last_ping_echoed_time >= ping_sent_time;
        if (last != this.server_ok) {
            if (!this.server_ok) {
                this.clog("server connection is not responding, drawing spinners...");
            } else {
                this.clog("server connection is OK");
            }
            // for (const index in this.id_to_window) {
            //     const win = this.id_to_window[index];
            //     win.set_spinner(this.server_ok);
            // }
        }
    }

    _check_echo_timeout(ping_time) {
        if (this.reconnect_in_progress) {
            return;
        }
        if (this.last_ping_echoed_time > 0 && this.last_ping_echoed_time < ping_time) {
            if (this.reconnect && this.reconnect_attempt < this.reconnect_count) {
                this.warn("ping timeout - reconnecting");
                this.reconnect_attempt++;
                this.do_reconnect();
            } else {
                // no point in telling the server here...
                this.disconnect(`server ping timeout, waited ${this.PING_TIMEOUT}ms without a response`);
            }
        }
    }

    _emit_event(event_type) {
        const event = document.createEvent("Event");
        event.initEvent(event_type, true, true);
        document.dispatchEvent(event);
    }

    emit_connection_lost(event_type) {
        this._emit_event("connection-lost");
    }

    emit_connection_established(event_type) {
        this._emit_event("connection-established");
    }


    /**
     * Hello
     */
    _send_hello(counter) {
        if (this.decode_worker == undefined) {
            counter = counter || 0;
            if (counter == 0) {
                this.clog("waiting for decode worker to finish initializing");
            } else if (counter > 100) {
                //we have waited 10 seconds or more...
                //continue without:
                this.do_send_hello(null, null);
            }
            //try again later:
            setTimeout(() => this._send_hello(counter + 1), 100);
        } else {
            this.do_send_hello(null, null);
        }
    }

    do_send_hello(challenge_response, client_salt) {
        // make the base hello
        this._make_hello_base();
        // handle a challenge if we need to
        if (!challenge_response) {
            // tell the server we expect a challenge (this is a partial hello)
            this.capabilities["challenge"] = true;
            this.clog("sending partial hello");
        } else {
            this.clog("sending hello");
            // finish the hello
            this._make_hello();
        }
        if (challenge_response) {
            this._update_capabilities({ "challenge_response": challenge_response });
            if (client_salt) {
                this._update_capabilities({ "challenge_client_salt": client_salt });
            }
        }
        this.clog("sending hello capabilities", this.capabilities);
        // verify:
        for (const key in this.capabilities) {
            if (key == undefined) {
                throw new Error("invalid null key in hello packet data");
            }
            const value = this.capabilities[key];
            if (value == undefined) {
                throw new Error(`invalid null value for key ${key} in hello packet data`);
            }
        }
        // send the packet
        this.send([PACKET_TYPES.hello, this.capabilities]);
        this.schedule_hello_timer();
    }

    _make_hello_base() {
        this.capabilities = {};
        this._update_capabilities({
            "version": Utilities.VERSION,
            "client_type": "HTML5",
            "display": this.server_display || "",
            "build": this._get_build_caps(),
            "platform": this._get_platform_caps(),
            "session-type": Utilities.getSimpleUserAgentString(),
            "session-type.full": navigator.userAgent,
            "username": null,
            "uuid": this.uuid,
            "argv": [window.location.href],
            "share": false,
            "steal": true,
            "mouse.show": true,
            "vrefresh": this.vrefresh,
            "file-chunks": FILE_CHUNKS_SIZE,
            "setting-change": true,  // Required by v5 servers
            "xdg-menu-update": true,
            "xdg-menu": true,
        });
        this._update_capabilities(this._get_network_caps());
        if (this.start_new_session) {
            this._update_capabilities({
                "start-new-session": this.start_new_session,
            });
        }
    }

    _make_hello() {
        this.desktop_width = 4000;
        this.desktop_height = 2000;
        this.key_layout = this._get_keyboard_layout();

        this._update_capabilities({
            auto_refresh_delay: 500,
            "metadata.supported": METADATA_SUPPORTED,
            "encodings": {
                "": this.supported_encodings,
                "core": this.supported_encodings,
                "rgb_formats": this.RGB_FORMATS,
                "window-icon": ["png"],
                "cursor": ["png"],
                "packet": true,
            },
            "encoding": this._get_encoding_caps(),
            "keymap": this._get_keymap_caps(),
            "wants": [],
            // encoding stuff
            windows: true,
            "window.pre-map": true,
            //partial support:
            keyboard: true,
            desktop_size: [this.desktop_width, this.desktop_height],
            desktop_mode_size: [this.desktop_width, this.desktop_height],
            // screen_sizes: this._get_screen_sizes(),
            dpi: {
                "x": this._get_DPI(),
                "y": this._get_DPI(),
            },
            notifications: {
                "enabled": true,
            },
            cursors: true,
            bell: true,
            system_tray: true,
            //we cannot handle this (GTK only):
            named_cursors: false,
        });
    }

    _get_network_caps() {
        const digests = this._get_digests();
        return {
            "digest": digests,
            "salt-digest": digests,
            "compression_level": 1,
            "rencodeplus": true,
            "brotli": (typeof BrotliDecode != "undefined"),
            "lz4": (lz4 && lz4.decode != "undefined"),
            "bandwidth-limit": this.bandwidth_limit,
            "connection-data": Utilities.getConnectionInfo(),
            "network": {
                "pings": 5,
            }
        }
    }

    _get_digests() {
        const digests = ["xor", "keycloak"];

        if (typeof crypto.subtle !== "undefined") {
            try {
                this.debug("network", "crypto.subtle=", crypto.subtle);
                for (const hash of ["sha1", "sha256", "sha384", "sha512"]) {
                    digests.push("hmac+" + hash);
                }
                this.debug("network", "digests:", digests);
            } catch {
                this.cerror("Error probing crypto.subtle digests");
            }
        } else {
            this.clog("cryptography library 'crypto.subtle' not found");
        }
        return digests;
    }

    _get_DPI() {
        // const dpi_div = document.querySelector("#dpi");
        // if (dpi_div != undefined && dpi_div.offsetWidth > 0 && dpi_div.offsetHeight > 0) {
        //     return Math.round((dpi_div.offsetWidth + dpi_div.offsetHeight) / 2);
        // }
        // //alternative:
        // if ("deviceXDPI" in screen) {
        //     return (screen.systemXDPI + screen.systemYDPI) / 2;
        // }
        // //default:
        return 96;
    }

    _process_error(packet) {
        const code = Number.parseInt(packet[2]);
        let reconnect = this.reconnect || this.reconnect_attempt < this.reconnect_count;
        if (reconnect && [0, 1006, 1008, 1010, 1014, 1015].includes(code)) {
            // don't re-connect unless we had actually managed to connect
            // (because these specific websocket error codes are likely permanent)
            reconnect = this.connected;
        }
        this.cerror("websocket error: ", packet[1], "code: ", code, "reason: ", this.disconnect_reason,
            ", connected: ", this.connected, ", reconnect: ", reconnect);
        if (this.reconnect_in_progress) {
            return;
        }
        this.packet_disconnect_reason(packet);
        if (!reconnect) {
            this.close();
        }
    }

    packet_disconnect_reason(packet) {
        if (!this.disconnect_reason && packet[1]) {
            const code = packet[2];
            if (!this.connected && [0, 1006, 1008, 1010, 1014, 1015].includes(code)) {
                this.disconnect_reason = "connection failed, invalid address?";
            } else {
                this.disconnect_reason = packet[1];
                let index = 2;
                while (packet.length > index && packet[index]) {
                    this.disconnect_reason += `\n${packet[index]}`;
                    index++;
                }
            }
        }
    }

    on_open() {
        //this hook can be overriden
    }

    _process_open() {
        this.cancel_open_timer();
        this._send_hello();
        this.on_open();
    }

    schedule_open_timer() {
        this.cancel_open_timer();
        this.open_timer = setTimeout(() => {
            let reconnect = this.reconnect || this.reconnect_attempt < this.reconnect_count;
            if (reconnect) {
                this.close_protocol();
                this.reconnect_attempt++;
                this.do_reconnect();
            }
            else {
                this.disconnect_reason = "failed to open connection";
                this.close();
            }
        }, this.OPEN_TIMEOUT);
    }

    cancel_open_timer() {
        if (this.open_timer) {
            clearTimeout(this.open_timer);
            this.open_timer = null;
        }
    }

    do_reconnect() {
        this.reconnect_in_progress = true;
        const protocol = this.protocol;
        setTimeout(() => {
            try {
                this.remove_window();
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

    schedule_hello_timer() {
        this.cancel_hello_timer();
        this.hello_timer = setTimeout(() => {
            this.disconnect_reason = "Did not receive hello before timeout reached, not an Xpra server?";
            this.close();
        }, this.HELLO_TIMEOUT);
    }

    cancel_hello_timer() {
        if (this.hello_timer) {
            clearTimeout(this.hello_timer);
            this.hello_timer = null;
        }
    }

    close_protocol() {
        this.connected = false;
        if (this.protocol) {
            this.protocol.close();
            this.protocol = null;
        }
    }

    clear_timers() {
        this.stop_info_timer();
        this.cancel_hello_timer();
        if (this.ping_timer) {
            clearTimeout(this.ping_timer);
            this.ping_timer = null;
        }
        if (this.ping_timeout_timer) {
            clearTimeout(this.ping_timeout_timer);
            this.ping_timeout_timer = null;
        }
        if (this.ping_grace_timer) {
            clearTimeout(this.ping_grace_timer);
            this.ping_grace_timer = null;
        }
    }

    set_encoding(encoding) {
        // add an encoding to our hello.encodings list
        this.clog("encoding:", encoding);
        this.encoding = encoding;
    }

    set_encoding_option(option, value) {
        this.clog("encoding: ", option, "=", value);
        this.encoding_options[option] = value;
    }

    remove_window() {
        //* Remove div window from the scene and destroy it

        // for (const wid in this.id_to_window) {
        //   const win = this.id_to_window[wid];
        //   window.removeWindowListItem(win.wid);
        //   win.destroy();
        // }
    }

    _process_close(packet) {
        this.clog("websocket closed: ", packet[1], "reason: ", this.disconnect_reason,
            ", reconnect: ", this.reconnect, ", reconnect attempt: ", this.reconnect_attempt);
        if (this.reconnect_in_progress) {
            return;
        }
        this.packet_disconnect_reason(packet);
        if (this.reconnect && this.reconnect_attempt < this.reconnect_count) {
            this.emit_connection_lost();
            this.close_protocol();
            this.reconnect_attempt++;
            this.do_reconnect();
        } else {
            this.close();
        }
    }

    disconnect(reason) {
        this.disconnect_reason = reason || "unknown";
        this.close();
    }

    close() {
        if (this.reconnect_in_progress) {
            return;
        }
        this.clog("client closed");
        this.cancel_open_timer();
        this.cancel_hello_timer();
        this.emit_connection_lost();
        // this.remove_windows();
        this.clear_timers();
        this.close_protocol();
        // call the client's close callback
        this.callback_close(this.disconnect_reason);
    }

    _process_disconnect(packet) {
        this.debug("main", "disconnect reason:", packet[1]);
        if (this.reconnect_in_progress) {
            return;
        }
        // save the disconnect reason
        this.packet_disconnect_reason(packet);
        this.close();
        // call the client's close callback
        this.callback_close(this.disconnect_reason);
    }

    _process_startup_complete(packet) {
        this.log("startup complete");
        this.emit_connection_established();
    }

    _connection_change(e) {
        const ci = Utilities.getConnectionInfo();
        this.clog("connection status - change event=", e, ", connection info=", ci, "tell server:", this.server_connection_data);
        if (ci && this.server_connection_data) {
            this.send([PACKET_TYPES.connection_data, ci]);
        }
    }

    _process_hello(packet) {
        this.cancel_open_timer();
        this.cancel_hello_timer();
        const hello = packet[1];
        this.clog("received hello capabilities", hello);
        if (!hello["rencodeplus"]) {
            throw "no common packet encoders, 'rencodeplus' is required by this client";
        }

        this.server_display = hello["display"] || "";
        this.server_platform = hello["platform"] || "";
        this.server_remote_logging = hello["remote-logging.multi-line"];
        if (this.server_remote_logging && this.remote_logging) {
            //hook remote logging:
            Utilities.log = () => this.log(arguments);
            Utilities.warn = () => this.warn(arguments);
            Utilities.error = () => this.error(arguments);
            Utilities.exc = () => this.exc(arguments);
        }

        const version = Utilities.s(hello["version"]);
        try {
            const vparts = version.split(".");
            const vno = vparts.map((x) => Number.parseInt(x));
            if (vno[0] <= 0 && vno[1] < 10) {
                this.disconnect(`unsupported version: ${version}`);
                this.close();
                return;
            }
        } catch {
            this.disconnect(`error parsing version number '${version}'`);
            this.close();
            return;
        }

        this.log("got hello: server version", version, "accepted our connection");
        this._process_modifier_keycodes(hello["modifier_keycodes"] || {});

        this.server_resize_exact = hello["resize_exact"] || false;
        this.server_screen_sizes = hello["screen-sizes"] || [];
        this.clog("server screen sizes:", this.server_screen_sizes);

        this.server_connection_data = hello["connection-data"];
        if (Object.hasOwn((navigator, "connection"))) {
            navigator.connection.addEventListener("change", this._connection_change);
            this._connection_change();
        }

        this._send_ping();
        this.ping_timer = setInterval(() => this._send_ping(), this.PING_FREQUENCY);
        this.reconnect_attempt = 0;
        // Drop start_new_session to avoid creating new displays
        // on reconnect
        this.start_new_session = null;
        this.on_connect();
        this.connected = true;
    }

    _process_modifier_keycodes(modifier_keycodes) {
        // find the modifier to use for Num_Lock
        if (!modifier_keycodes) {
            return;
        }
        for (const modifier in modifier_keycodes) {
            if (Object.hasOwn(modifier_keycodes, modifier)) {
                const mappings = modifier_keycodes[modifier];
                for (const keycode in mappings) {
                    const keys = mappings[keycode];
                    for (const index in keys) {
                        const key = keys[index];
                        if (key == "Num_Lock") {
                            this.num_lock_modifier = modifier;
                        } else if (key == "Alt_L") {
                            this.alt_modifier = modifier;
                        } else if (key == "Meta_L") {
                            this.meta_modifier = modifier;
                        } else if (key == "ISO_Level3_Shift" || key == "Mode_switch") {
                            this.altgr_modifier = modifier;
                        } else if (key == "Control_L") {
                            this.control_modifier = modifier;
                        }
                    }
                }
            }
        }
    }

    _process_window_metadata(packet) {
        const wid = packet[1];
        const metadata = packet[2];

        console.log("_process_window_metadata   wid : ", wid);
        console.log("metadata : ", metadata);
        // const win = this.id_to_window[wid];
        // if (win != undefined) {
        //     win.update_metadata(metadata);
        // }
    }

    _process_desktop_size(packet) {
        //we don't use this yet,
        //we could use this to clamp the windows to a certain area
    }

    _process_bell(packet) {
        const percent = packet[3];
        const pitch = packet[4];
        const duration = packet[5];
        if (this.audio_context != undefined) {
            const oscillator = this.audio_context.createOscillator();
            const gainNode = this.audio_context.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(this.audio_context.destination);
            gainNode.gain.setValueAtTime(percent, this.audio_context.currentTime);
            oscillator.frequency.setValueAtTime(pitch, this.audio_context.currentTime);
            oscillator.start();
            setTimeout(() => oscillator.stop(), duration);
        } else {
            const snd = new Audio(BELL_SOUND);
            snd.play();
        }
    }

    _process_encodings(packet) {
        const caps = packet[1];
        this.log("update encodings:", Object.keys(caps));
    }

    connect() {
        this.schedule_open_timer();
        this.initialize_workers();
    }

    initialize_workers() {
        const safe_encodings = [
            "jpeg",
            "png",
            "png/P",
            "png/L",
            "rgb",
            "rgb32",
            "rgb24",
            "scroll",
            "void",
        ];
        // detect websocket in webworker support and degrade gracefully
        if (!window.Worker) {
            // no webworker support
            this.supported_encodings = safe_encodings;
            this.offscreen_api = false;
            this.decode_worker = false;
            this.clog("no webworker support at all.");
            this._do_connect(false);
            return;
        }
        this.clog("we have webworker support");
        // spawn worker that checks for a websocket
        const worker = new Worker("js/lib/wsworker_check.js");
        worker.addEventListener(
            "message",
            (e) => {
                const data = e.data;
                switch (data["result"]) {
                    case true:
                        // yey, we can use websocket in worker!
                        this.clog("we can use websocket in webworker");
                        this._do_connect(true);
                        break;
                    case false:
                        this.clog("we can't use websocket in webworker, won't use webworkers");
                        this._do_connect(false);
                        break;
                    default:
                        this.clog("client got unknown message from worker");
                        this._do_connect(false);
                }
            },
            false
        );
        // ask the worker to check for websocket support, when we receive a reply
        // through the eventlistener above, _do_connect() will finish the job
        worker.postMessage({ cmd: "check" });

        if (!DECODE_WORKER) {
            this.supported_encodings = safe_encodings;
            this.decode_worker = false;
            this.offscreen_api = false;
            return;
        }

        let decode_worker;
        if (this.offscreen_api) {
            // check that it is actually available:
            this.offscreen_api = DECODE_WORKER && XpraOffscreenWorker.isAvailable(this.ssl);
        }
        if (this.offscreen_api) {
            this.set_encoding_option('video_max_size', [4096, 4096]);
            this.clog("using offscreen decode worker");
            decode_worker = new Worker("js/OffscreenDecodeWorker.js");
        } else {
            this.clog("using decode worker");
            decode_worker = new Worker("js/DecodeWorker.js");
        }
        decode_worker.addEventListener(
            "message",
            (e) => {
                const data = e.data;
                if (data["draw"]) {
                    this.do_process_draw(data["draw"], data["start"]);
                    return;
                }
                if (data["error"]) {
                    const message = data["error"];
                    const packet = data["packet"];
                    const wid = packet[1];
                    const width = packet[2];
                    const height = packet[3];
                    const coding = packet[6];
                    const packet_sequence = packet[8];
                    this.clog("decode error on ", coding, "packet sequence", packet_sequence, ":", message);
                    if (!this.offscreen_api) {
                        this.clog(" pixel data:", packet[7]);
                    }
                    this.do_send_damage_sequence(packet_sequence, wid, width, height, -1, message);
                    return;
                }
                switch (data["result"]) {
                    case true: {
                        const formats = [...data["formats"]];
                        this.clog("we can decode using a worker:", decode_worker);
                        this.supported_encodings = formats;
                        this.clog("full list of supported encodings:", this.supported_encodings);
                        this.decode_worker = decode_worker;
                        break;
                    }
                    case false:
                        this.clog(`we can't decode using a worker: ${data["errors"]}`);
                        this.decode_worker = false;
                        break;
                    default:
                        this.clog("client got unknown message from the decode worker");
                        this.decode_worker = false;
                }
            },
            false
        );
        this.clog("decode worker will check:", this.check_encodings);
        decode_worker.postMessage({
            cmd: "check",
            encodings: this.check_encodings,
        });
    }

    _do_connect(with_worker) {
        if (this.webtransport) {
            this.protocol = new XpraWebTransportProtocol();
        }
        else {
            const use_worker = with_worker && !XPRA_CLIENT_FORCE_NO_WORKER;
            this.protocol = use_worker ? new XpraProtocolWorkerHost() : new XpraProtocol();
        }
        this.open_protocol();
    }

    open_protocol() {
        this.protocol.set_packet_handler((packet) => this._route_packet(packet));
        this.protocol.open(this.serverUri);
        console.log("open_protocol() done");
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
    }

    onOpen() {
        console.log('Connected to XPRA server');
        const { element, context } = divWindow(this.mainRadius);
        const cssObject = new CSS3DObject(element);
        cssObject.position.set(0, 0, -this.mainRadius + 100);
        this.scene.add(cssObject);

        this.canvas = { element, context };
        document.body.appendChild(this.canvas.element);
    }

    on_connect() {
        //this hook can be overriden
    }

    _send_ping() {
        if (this.reconnect_in_progress || !this.connected) {
            return;
        }
        const now_ms = Math.ceil(performance.now());
        this.send([PACKET_TYPES.ping, now_ms]);
        // add timeout to wait for ping timout
        this.ping_timeout_timer = setTimeout(
            () => this._check_echo_timeout(now_ms),
            this.PING_TIMEOUT
        );
        // add timeout to detect temporary ping miss for spinners
        const wait = 2000;
        this.ping_grace_timer = setTimeout(
            () => this._check_server_echo(now_ms),
            wait
        );
    }

    _process_ping(packet) {
        const echotime = packet[1];
        this.last_ping_server_time = echotime;
        if (packet.length > 2) {
            //prefer system time (packet[1] is monotonic)
            this.last_ping_server_time = packet[2];
        }
        let sid = "";
        if (packet.length >= 4) {
            sid = packet[3];
        }
        this.last_ping_local_time = Date.now();
        const l1 = 0;
        const l2 = 0;
        const l3 = 0;
        this.send([PACKET_TYPES.ping_echo, echotime, l1, l2, l3, 0, sid]);
    }

    _process_ping_echo(packet) {
        this.last_ping_echoed_time = packet[1];
        const l1 = packet[2];
        const l2 = packet[3];
        const l3 = packet[4];
        this.client_ping_latency = packet[5];
        this.server_ping_latency = Math.ceil(performance.now()) - this.last_ping_echoed_time;
        this.server_load = [l1 / 1000, l2 / 1000, l3 / 1000];
        // make sure server goes OK immediately instead of waiting for next timeout
        this._check_server_echo(0);
    }

    onDraw(packet) {
        if (!this.canvas) {
            console.error('Canvas not initialized');
            return;
        }
        const context = this.canvas.context;
        const drawInstructions = packet[1];
        drawInstructions.forEach(instruction => {
            switch (instruction.type) {
                case 'rect':
                    context.fillStyle = instruction.color;
                    context.fillRect(instruction.x, instruction.y, instruction.width, instruction.height);
                    break;
                // Add more cases to handle different types of drawing instructions
                default:
                    console.log('Unknown draw instruction:', instruction);
            }
        });
    }

    _get_keyboard_layout() {
        this.debug("keyboard", "_get_keyboard_layout() keyboard_layout=", this.keyboard_layout);
        if (this.keyboard_layout) return this.keyboard_layout;
        return Utilities.getKeyboardLayout();
    }

    _get_encoding_caps() {
        return this.encoding_options;
    }

    _get_build_caps() {
        return {
            "revision": Utilities.REVISION,
            "local_modifications": Utilities.LOCAL_MODIFICATIONS,
            "branch": Utilities.BRANCH,
        }
    }

    _get_platform_caps() {
        return {
            "": Utilities.getPlatformName(),
            "name": Utilities.getPlatformName(),
            "processor": Utilities.getPlatformProcessor(),
            "platform": navigator.appVersion,
        }
    }

    _get_keymap_caps() {
        return {
            "layout": this.key_layout,
            "keycodes": this._get_keycodes(),
        }
    }
}

export { CustomClientProtocol };