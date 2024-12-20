
var getparam = Utilities.getparam;
var getboolparam = Utilities.getboolparam;
var float_menu_item_size = 30;
var float_menu_padding = 20;
var float_menu_width = (float_menu_item_size * 4) + float_menu_padding;

var cdebug = function () {
    Utilities.clog.apply(Utilities, arguments);
}
var clog = function () {
    Utilities.clog.apply(Utilities, arguments);
}

if (!getboolparam("floating_menu", true)) {
    $("#float_menu").hide();
}

function confirm_shutdown_server() {
    if (confirm("Shutdown this server?")) {
        client.reconnect = false;
        client.send(["shutdown-server"]);
    }
}

function upload_file(event) {
    $('.menu-content').slideUp();
    $('#upload').click();
}

function cleanup_dialogs() {
    $('.menu-content').slideUp();
    $('#about').hide();
    hide_sessioninfo();
}
function connection_established() {
    //this may be a re-connection,
    //so make sure we cleanup any left-overs
    clog("connection-established")
    cleanup_dialogs();
    $("button.menu-button").prop('disabled', false);
}
function connection_lost() {
    clog("connection-lost")
    cleanup_dialogs();
    $("button.menu-button").prop('disabled', true);
}

document.addEventListener('connection-established', connection_established);
document.addEventListener('connection-lost', connection_lost);


$("#pasteboard").blur(function () {
    //force focus back to our capture widget:
    if (client.capture_keyboard) {
        $("#pasteboard").focus();
    }
});

// <!--  <textarea id="pasteboard" onblur="this.focus()" autofocus style="display: block; position: absolute; left: -99em;"></textarea> -->

function show_about(event) {
    $('.menu-content').slideUp();
    $('#about').show();
    hide_sessioninfo();
    event.stopPropagation();
}

//session-info handling:
function show_sessioninfo(event) {
    $('.menu-content').slideUp();
    $('#about').hide();
    $('#sessiondata td').html("");
    $('#sessioninfo').show();
    client.start_info_timer();
    event.stopPropagation();
}
function hide_sessioninfo() {
    $('#sessioninfo').hide();
    client.stop_info_timer();
}

document.addEventListener('info-response', function (e) {
    var info = e.data;
    $("#endpoint").html(client.uri);
    $("#server_display").html(client.server_display);
    //$("#server_hostname").html(info["hostname"] || "");
    $("#server_platform").html(client.server_platform);
    if (client.server_load == null) {
        $("#server_load").html("n/a");
    }
    else {
        $("#server_load").html("" + client.server_load);
    }
    function toHHMMSS(t) {
        var s = "";
        var hh = Math.floor(t / 1000 / 60 / 60);
        if (hh > 0)
            s += "" + hh + ":";
        var mm = Math.floor(t / 1000 / 60) % 60;
        s += ("0" + mm).slice(-2);	//left pad with "0"
        var ss = Math.floor(t / 1000) % 60;
        s += ":" + ("0" + ss).slice(-2);	//left pad with "0"
        return s
    }
    //this one shows bogus values!?:
    //var elapsed = (new Date()).getTime()-info["server.start_time"];
    //$("#session_started").html(toHHMMSS(elapsed));
    var elapsed = (new Date()).getTime() - client.client_start_time;
    $("#session_connected").html(toHHMMSS(elapsed));
    if (client.server_ping_latency >= 0)
        $("#server_latency").html(client.server_ping_latency);
    if (client.client_ping_latency >= 0)
        $("#client_latency").html(client.client_ping_latency);
    //TODO:
    // * add packet counter to Protocol.js
    //"Packets Received"
    //"Encoding + Compression"
}, false);

var touchaction_scroll = true;

function toggle_touchaction() {
    touchaction_scroll = !touchaction_scroll;
    set_touchaction();
}

function set_touchaction() {
    var touchaction, label;
    if (touchaction_scroll) {
        touchaction = "none";
        label = "zoom";
    }
    else {
        touchaction = "auto";
        label = "scroll";
    }
    cdebug("mouse", "set_touchaction() touchaction=", touchaction, "label=", label);
    $('div.window canvas').css("touch-action", touchaction);
    $('#touchaction_link').html("Set Touch Action: " + label);
    if (!Utilities.isEdge()) {
        $('#touchaction_link').hide();
    }
}

function init_client() {
    if (typeof jQuery == 'undefined') {
        window.alert("Incomplete Xpra HTML5 client installation: jQuery is missing, cannot continue.");
        return;
    }

    // look at url parameters
    var username = getparam("username") || null;
    var password = getparam("password") || null;
    var sound = getboolparam("sound", true) || null;
    var audio_codec = getparam("audio_codec") || null;
    var encoding = getparam("encoding") || null;
    var bandwidth_limit = getparam("bandwidth_limit") || 0;
    var action = getparam("action") || "connect";
    var submit = getboolparam("submit", true);
    var server = getparam("server") || "localhost";
    var port = getparam("port") || "14501";
    var ssl = false;
    var path = getparam("path") || '/';
    var encryption = getparam("encryption") || null;
    var key = getparam("key") || null;
    var keyboard_layout = getparam("keyboard_layout") || null;
    var start = getparam("start");
    var exit_with_children = getboolparam("exit_with_children", false);
    var exit_with_client = getboolparam("exit_with_client", false);
    var sharing = getboolparam("sharing", false);
    var video = getboolparam("video", Utilities.is_64bit());
    var mediasource_video = getboolparam("mediasource_video", false);
    var remote_logging = getboolparam("remote_logging", true);
    var insecure = getboolparam("insecure", false);
    var ignore_audio_blacklist = getboolparam("ignore_audio_blacklist", false);
    const display = getparam("display") || "";
    const shadow_display = getparam("shadow_display") || "";
    var clipboard = getboolparam("clipboard", true);
    var printing = getboolparam("printing", true);
    var file_transfer = getboolparam("file_transfer", true);
    var steal = getboolparam("steal", true);
    var reconnect = getboolparam("reconnect", true);
    var swap_keys = getboolparam("swap_keys", Utilities.isMacOS());
    try {
        sessionStorage.removeItem("password");
    }
    catch (e) {
        //ignore
    }

    var progress_timer = null;
    var progress_value = 0;
    var progress_offset = 0;
    // show connection progress:
    function connection_progress(state, details, progress) {
        clog("connection_progress(", state, ", ", details, ", ", progress, ")");
        if (progress >= 100) {
            $('#progress').hide();
        }
        else {
            $('#progress').show();
        }
        $('#progress-label').text(state || " ");
        $('#progress-details').text(details || " ");
        $('#progress-bar').val(progress);
        progress_value = progress;
        if (progress_timer) {
            window.clearTimeout(progress_timer);
            progress_timer = null;
        }
        if (progress < 100) {
            progress_move_offset();
        }
    }
    // the offset is just to make the user feel better
    // nothing changes, but we just show a slow progress
    function progress_move_offset() {
        progress_timer = null;
        progress_offset++;
        $('#progress-bar').val(progress_value + progress_offset);
        if (progress_offset < 9) {
            progress_timer = window.setTimeout(progress_move_offset, (5 + progress_offset) * progress_offset);
        }
    }

    var debug_categories = [];
    var categories = ["main", "keyboard", "geometry", "mouse", "clipboard", "draw", "audio", "network"];
    for (var i = 0, len = categories.length; i < len; i++) {
        var category = categories[i];
        var debug = getboolparam("debug_" + category, false);
        if (debug) {
            debug_categories.push(category);
        }
    }
    clog("debug enabled for:", debug_categories);

    // create the client
    var client = new XpraClient('screen');
    client.debug_categories = debug_categories;
    client.remote_logging = remote_logging;
    client.sharing = sharing;
    client.insecure = insecure;
    client.clipboard_enabled = clipboard;
    client.printing = printing;
    client.file_transfer = file_transfer;
    client.bandwidth_limit = bandwidth_limit;
    client.steal = steal;
    client.reconnect = reconnect;
    client.swap_keys = swap_keys;
    client.on_connection_progress = connection_progress;
    //example overrides:
    //client.HELLO_TIMEOUT = 3600000;
    //client.PING_TIMEOUT = 60000;
    //client.PING_GRACE = 30000;
    //client.PING_FREQUENCY = 15000;

    if (debug) {
        //example of client event hooks:
        client.on_open = function () {
            cdebug("network", "connection open");
        };
        client.on_connect = function () {
            cdebug("network", "connection established");
        };
        client.on_first_ui_event = function () {
            cdebug("network", "first ui event");
        };
        client.on_last_window = function () {
            cdebug("network", "last window disappeared");
        };
    }

    // mediasource video
    if (video) {
        client.supported_encodings.push("h264");
        if (JSMpeg && JSMpeg.Renderer && JSMpeg.Decoder) {
            client.supported_encodings.push("mpeg1");
        }
        if (mediasource_video) {
            client.supported_encodings.push("vp8+webm", "h264+mp4", "mpeg4+mp4");
        }
    }
    else if (encoding && (encoding !== "auto")) {
        // the primary encoding can be set
        client.enable_encoding(encoding);
    }
    // encodings can be disabled like so
    // client.disable_encoding("h264");
    if (action && (action != "connect")) {
        sns = {
            "mode": action,
        };
        if (exit_with_children) {
            sns["exit-with-children"] = true;
            if (start) {
                sns["start-child"] = [start];
            }
        }
        else {
            if (start) {
                sns["start"] = [start];
            }
        }
        if (exit_with_client) {
            sns["exit-with-client"] = true;
        }
        client.start_new_session = sns
    }

    // sound support
    if (sound) {
        client.audio_enabled = true;
        clog("sound enabled, audio codec string: " + audio_codec);
        if (audio_codec && audio_codec.includes(":")) {
            var acparts = audio_codec.split(":");
            client.audio_framework = acparts[0];
            client.audio_codec = acparts[1];
        }
        client.audio_mediasource_enabled = getboolparam("mediasource", true);
        client.audio_aurora_enabled = getboolparam("aurora", true);
        client.audio_httpstream_enabled = getboolparam("http-stream", true);
    }

    if (keyboard_layout) {
        client.keyboard_layout = keyboard_layout;
    }

    // check for username and password
    if (username) {
        client.username = username;
    }
    if (password) {
        client.password = password;
    }
    if (action == "connect") {
        client.server_display = display;
    }
    else if (action == "shadow") {
        client.server_display = shadow_display;
    }

    // check for encryption parameters
    if (encryption) {
        client.encryption = encryption;
        if (key) {
            client.encryption_key = key;
        }
    }

    // attach a callback for when client closes
    var debug_main = getboolparam("debug_main", false);
    if (!debug_main) {
        client.callback_close = function (reason) {
            clog("closing: ", reason);
            if (submit) {
                var message = "Connection closed (socket closed)";
                if (reason) {
                    message = reason;
                }
                var url = "./connect.html";
                var has_session_storage = Utilities.hasSessionStorage();
                function add_prop(prop, value) {
                    if (has_session_storage) {
                        if (value === null || value === "undefined") {
                            sessionStorage.removeItem(prop);
                        }
                        else {
                            sessionStorage.setItem(prop, value);
                        }
                    } else {
                        if (value === null || value === "undefined") {
                            value = "";
                        }
                        url = url + "&" + prop + "=" + encodeURIComponent("" + value);
                    }
                }
                add_prop("disconnect", message);
                var props = {
                    "username": username,
                    "insecure": insecure,
                    "server": server,
                    "port": port,
                    "encoding": encoding,
                    "bandwidth_limit": bandwidth_limit,
                    "keyboard_layout": keyboard_layout,
                    "action": action,
                    "sound": sound,
                    "audio_codec": audio_codec,
                    "clipboard": clipboard,
                    "exit_with_children": exit_with_children,
                    "exit_with_client": exit_with_client,
                    "sharing": sharing,
                    "steal": steal,
                    "video": video,
                    "display": display,
                    "shadow_display": shadow_display,
                    "mediasource_video": mediasource_video,
                    "remote_logging": remote_logging,
                    "insecure": insecure,
                    "ignore_audio_blacklist": ignore_audio_blacklist,
                }
                for (var i = 0, len = client.debug_categories.length; i < len; i++) {
                    var category = client.debug_categories[i];
                    props["debug_" + category] = true;
                }
                if (insecure || Utilities.hasSessionStorage()) {
                    props["password"] = password;
                }
                else {
                    props["password"] = "";
                }
                for (var name in props) {
                    var value = props[name];
                    add_prop(name, value);
                }
                window.location = url;
            } else {
                // if we didn't submit through the form, silently redirect to the connect gui
                window.location = "connect.html";
            }
        }
    }
    client.init(ignore_audio_blacklist);

    client.host = server;
    client.port = port;
    client.ssl = ssl;
    client.path = path;
    return client;
}

function init_tablet_input(client) {
    //keyboard input for tablets:
    var pasteboard = $('#pasteboard');
    pasteboard.on("input", function (e) {
        var txt = pasteboard.val();
        pasteboard.val("");
        cdebug("keyboard", "oninput:", txt);
        if (!client.topwindow) {
            return;
        }
        for (var i = 0, len = txt.length; i < len; i++) {
            var str = txt[i];
            var keycode = str.charCodeAt(0);
            var keyname = str;
            if (str in CHAR_TO_NAME) {
                keyname = CHAR_TO_NAME[str];
                if (keyname.includes("_")) {
                    //ie: Thai_dochada
                    var lang = keyname.split("_")[0];
                    key_language = KEYSYM_TO_LAYOUT[lang];
                    client._check_browser_language(key_language);
                }
            }
            try {
                modifiers = [];
                keyval = keycode;
                group = 0;
                packet = ["key-action", client.topwindow, keyname, true, modifiers, keyval, str, keycode, group];
                cdebug("keyboard", packet);
                client.send(packet);
                packet = ["key-action", client.topwindow, keyname, false, modifiers, keyval, str, keycode, group];
                cdebug("keyboard", packet);
                client.send(packet);
            }
            catch (e) {
                client.exc(e, "input handling error");
            }
        }
    });
}

function init_clipboard(client) {
    var pasteboard = $('#pasteboard');
    //clipboard hooks:
    pasteboard.on('paste', function (e) {
        var paste_data;
        if (navigator.clipboard && navigator.clipboard.readText) {
            navigator.clipboard.readText().then(function (text) {
                cdebug("clipboard", "paste event, text=", text);
                var paste_data = unescape(encodeURIComponent(text));
                client.clipboard_buffer = paste_data;
                client.send_clipboard_token(paste_data);
            }, function (err) {
                cdebug("clipboard", "paste event failed:", err);
            });
        }
        else {
            var datatype = "text/plain";
            var clipboardData = (e.originalEvent || e).clipboardData;
            //IE: must use window.clipboardData because the event clipboardData is null!
            if (!clipboardData) {
                clipboardData = window.clipboardData;
            }
            if (Utilities.isIE()) {
                datatype = "Text";
            }
            paste_data = unescape(encodeURIComponent(clipboardData.getData(datatype)));
            cdebug("clipboard", "paste event, data=", paste_data);
            client.clipboard_buffer = paste_data;
            client.send_clipboard_token(paste_data);
        }
        return false;
    });
    pasteboard.on('copy', function (e) {
        var clipboard_buffer = client.get_clipboard_buffer();
        pasteboard.text(decodeURIComponent(escape(clipboard_buffer)));
        pasteboard.select();
        cdebug("clipboard", "copy event, clipboard buffer=", clipboard_buffer);
        client.clipboard_pending = false;
        return true;
    });
    pasteboard.on('cut', function (e) {
        var clipboard_buffer = client.get_clipboard_buffer();
        pasteboard.text(decodeURIComponent(escape(clipboard_buffer)));
        pasteboard.select();
        cdebug("clipboard", "cut event, clipboard buffer=", clipboard_buffer);
        client.clipboard_pending = false;
        return true;
    });
    $('#screen').on('click', function (e) {
        cdebug("clipboard", "click pending=", client.clipboard_pending, "buffer=", client.clipboard_buffer);
        if (client.clipboard_pending) {
            var clipboard_buffer = client.get_clipboard_buffer();
            var clipboard_datatype = (client.get_clipboard_datatype() || "").toLowerCase();
            var is_text = clipboard_datatype.indexOf("text") >= 0 || clipboard_datatype.indexOf("string") >= 0;
            if (!is_text) {
                //maybe just abort here instead?
                clipboard_buffer = "";
            }
            pasteboard.text(clipboard_buffer);
            pasteboard.select();
            cdebug("clipboard", "click event, with pending clipboard datatype=", clipboard_datatype, ", buffer=", clipboard_buffer);
            //for IE:
            var success = false;
            if (window.clipboardData && window.clipboardData.setData) {
                try {
                    if (Utilities.isIE()) {
                        window.clipboardData.setData("Text", clipboard_buffer);
                    }
                    else {
                        window.clipboardData.setData(clipboard_datatype, clipboard_buffer);
                    }
                    success = true;
                }
                catch (e) {
                    success = false;
                }
            }
            if (!success && is_text) {
                success = document.execCommand('copy');
            }
            else {
                //probably no point in trying again?
            }
            if (success) {
                //clipboard_buffer may have been cleared if not set to text:
                client.clipboard_buffer = clipboard_buffer;
                client.clipboard_pending = false;
            }
        }
    });
}

function init_file_transfer(client) {
    function send_file(f) {
        clog("file:", f.name, ", type:", f.type, ", size:", f.size, "last modified:", f.lastModifiedDate ? f.lastModifiedDate.toLocaleDateString() : 'n/a');
        var fileReader = new FileReader();
        fileReader.onloadend = function (evt) {
            var u8a = new Uint8Array(evt.target.result);
            var buf = Utilities.Uint8ToString(u8a);
            client.send_file(f.name, f.type, f.size, buf);
        };
        fileReader.readAsArrayBuffer(f);
    }
    function sendAllFiles(files) {
        for (var i = 0, f; f = files[i]; i++) {
            send_file(f);
        }
    }
    function handleFileSelect(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        sendAllFiles(evt.dataTransfer.files);
    }
    function handleDragOver(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
    }
    var screen = document.getElementById('screen');
    screen.addEventListener('dragover', handleDragOver, false);
    screen.addEventListener('drop', handleFileSelect, false);

    $("#upload").on("change", function (evt) {
        evt.stopPropagation();
        evt.preventDefault();
        sendAllFiles(this.files);
        return false;
    });
    $("#upload_form").on('submit', function (evt) {
        evt.preventDefault();
    });
}

function init_clock(client, enabled) {
    if (!enabled) {
        $("#clock_menu_entry").hide();
        return;
    }
    function update_clock() {
        var now = new Date().getTime();
        var server_time = client.last_ping_server_time + (now - client.last_ping_local_time) + client.server_ping_latency;
        var date = new Date(server_time);
        var clock_text = $("#clock_text");
        var width = clock_text.width();
        clock_text.text(date.toLocaleDateString() + " " + date.toLocaleTimeString());
        var clock_menu_text = $("#clock_menu_text");
        clock_menu_text.text(date.toLocaleDateString() + " " + date.toLocaleTimeString());
        if (width != clock_text.width()) {
            //trays have been shifted left or right:
            client.reconfigure_all_trays();
        }
        //try to land at the half-second point,
        //so that we never miss displaying a second:
        var delay = (1500 - (server_time % 1000)) % 1000;
        if (delay < 10) {
            delay = 1000;
        }
        setTimeout(update_clock, delay);
    }

    function wait_for_time() {
        if (client.last_ping_local_time > 0) {
            update_clock();
        }
        else {
            //check again soon:
            //(ideally, we should register a callback on the ping packet)
            setTimeout(wait_for_time, 1000);
        }
    }
    wait_for_time();
}

function toggle_fullscreen() {
    const f_el = document.hasOwnProperty("requestFullScreen") || document.hasOwnProperty("webkitRequestFullScreen") || document.hasOwnProperty("mozRequestFullScreen") || document.hasOwnProperty("msRequestFullscreen");
    if (!f_el) {
        const elem = document.getElementById("fullscreen_button");
        var is_fullscreen = document.fullScreen || document.mozFullScreen || document.webkitIsFullScreen;
        if (!is_fullscreen) {
            const req = elem.requestFullScreen || elem.webkitRequestFullScreen || elem.mozRequestFullScreen || elem.msRequestFullscreen;
            if (req) {
                req.call(document.body);
                $('#fullscreen').attr('src', './icons/unfullscreen.png');
                elem.title = "Exit Fullscreen";
                $('#fullscreen_button').attr('data-icon', 'fullscreen_exit');
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.hasOwnProperty("mozCancelFullScreen")) {
                document.mozCancelFullScreen();
            } else if (document.hasOwnProperty("msExitFullscreen")) {
                document.msExitFullscreen();
            }

            $('#fullscreen').attr('src', './icons/fullscreen.png');
            elem.title = "Fullscreen";
            $('#fullscreen_button').attr('data-icon', 'fullscreen');
        }
    }
}

function expand_float_menu() {
    var floatMenu = document.getElementById('float_menu');
    if (floatMenu) {
        var expanded_width = (float_menu_item_size * 4);
        floatMenu.style.width = expanded_width + 'px';
        $('#float_menu').children().show();
        if (client) {
            client.reconfigure_all_trays();
        }
    } else {
        console.error("expand_float_menu Element with ID 'float_menu' not found.");
    }
}

function retract_float_menu() {
    var floatMenu = document.getElementById('float_menu');
    if (floatMenu) {
        floatMenu.style.width = '0px';
        $('#float_menu').children().hide();
    } else {
        console.error("retract_float_menu Element with ID 'float_menu' not found.");
    }
}

if (getboolparam("autohide", false)) {
    $('#float_menu').on('mouseover', expand_float_menu);
    $('#float_menu').on('mouseout', retract_float_menu);
}
else {
    expand_float_menu();
}

var client = null;
$(document).ready(function () {
    clog("document is ready, browser is", navigator.platform, "64-bit:", Utilities.is_64bit());
    var touchaction = getparam("touchaction") || "scroll";
    touchaction_scroll = touchaction == "scroll";
    set_touchaction();

    client = init_client();
    client.connect();

    //from now on, send log and debug to client function
    //which may forward it to the server once connected:
    clog = function () {
        client.log.apply(client, arguments);
    }
    cdebug = function () {
        client.debug.apply(client, arguments);
    }
    init_tablet_input(client);
    if (client.clipboard_enabled) {
        init_clipboard(client);
    }
    if (client.file_transfer) {
        init_file_transfer(client);
    }
    else {
        $('upload_link').removeAttr('href');
    }
    init_clock(client, getboolparam("clock", true));
    client.on_audio_state_change = function (newstate, details) {
        if (client.audio_state == newstate) {
            return;
        }
        client.audio_state = newstate;
        var tooltip = "";
        var data_icon = "";
        if (newstate == "playing") {
            data_icon = "volume_up";
            tooltip = "audio playing,\nclick to stop";
        }
        else if (newstate == "waiting") {
            data_icon = "volume_up";
            tooltip = "audio buffering";
        }
        else {
            data_icon = "volume_off";
            tooltip = "audio off,\nclick to start";
        }
        clog("audio-state:", newstate);
        $("#sound_button").attr("data-icon", data_icon);
        $("#sound_button").attr("title", tooltip);
    };
    if (client.audio_enabled) {
        $("#sound_button").click(function () {
            clog("speaker icon clicked, audio_enabled=", client.audio_enabled);
            if (client.audio_state == "playing" || client.audio_state == "waiting") {
                client.on_audio_state_change("stopped", "user action");
                client.close_audio();
            }
            else {
                client.on_audio_state_change("waiting", "user action");
                client._audio_start_stream();
                client._sound_start_receiving();
            }
        })
    }
    else {
        $("#sound_button").hide();
    }
    document.addEventListener("visibilitychange", function (e) {
        window_ids = Object.keys(client.id_to_window).map(Number);
        clog("visibilitychange hidden=", document.hidden, "connected=", client.connected);
        if (client.connected) {
            if (document.hidden) {
                client.send(["suspend", true, window_ids]);
            }
            else {
                client.send(["resume", true, window_ids]);
                client.redraw_windows();
                client.request_refresh(-1);
            }
        }
    });
    $('#fullscreen').on('click', function (e) {
        toggle_fullscreen();
    });

    $('#fullscreen_button').on('click', function (e) {
        toggle_fullscreen();
    });

    var screen_change_events = "webkitfullscreenchange mozfullscreenchange fullscreenchange MSFullscreenChange";
    $(document).on(screen_change_events, function () {
        var f_el = document.fullscreenElement || document.mozFullScreen || document.webkitIsFullScreen || document.msFullscreenElement;
        clog("fullscreenchange:", f_el);
        if (f_el == null) {
            //we're not in fullscreen mode now, so show fullscreen icon again:
            $('#fullscreen_button').attr('data-icon', 'fullscreen');
        }
    });
    // disable right click menu:
    window.oncontextmenu = function (e) {
        client._poll_clipboard(e);
        //showCustomMenu();
        return false;
    }
});