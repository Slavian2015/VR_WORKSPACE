const capabilities = {
    version: "17",
    "client_type": "HTML5",
    "display": "",
    "build": {
        "revision": 0,
        "local_modifications": 0,
        "branch": "master"
    },
    platform: {
        "": "Linux",
        "name": "Linux",
        "processor": "unknown",
        "platform": "5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.137 Electron/33.2.1 Safari/537.36"
    },
    argv: [
        "file:///home/winsbar/PycharmProjects/VR_WORKSPACE/app/index.html"
    ],
    "audio": {
        "receive": true,
        "send": true,
        "decoders": []
    },
    "auto_refresh_delay": 500,
    "bandwidth-limit": 0,
    bell: true,
    brotli: true,
    clipboard: {
        "enabled": false,
        "want_targets": true,
        "greedy": true,
        "selections": [1],
        "preferred-targets": [5]
    },
    compression_level: 1,
    "connection-data": {},
    cursors: true,
    desktop_mode_size: [4000, 2000],
    desktop_size: [4000, 2000],
    digest: ["xor", "keycloak", "hmac+sha1", "hmac+sha256", "hmac+sha384", "hmac+sha512"],
    dpi: {
        "x": 96,
        "y": 96
    },
    "encoding": {
        "": "auto",
        "icons": {},
        "transparency": true,
        "rgb_lz4": true,
        "decoder-speed": {}
    },
    encodings: {
        "": [5],
        "core": [5],
        "rgb_formats": [3],
        "window-icon": [1],
        "cursor": [1]
    },
    "file": {
        "enabled": true,
        "printing": false,
        "open-url": null,
        "size-limit": 33554432
    },
    "file-chunks": 131072,
    "keyboard": true,
    "keymap": {
        "layout": "us",
        "keycodes": [138]
    },
    "lz4": true,
    "metadata.supported": ["fullscreen", "maximized", "iconic", "above", "below", "title", "size-hints", "class-instance", "transient-for", "window-type", "has-alpha", "decorations", "override-redirect", "tray", "modal", "opacity"],
    "mouse.show": true,
    "named_cursors": false,
    "network": {
        "pings": 5
    },
    notifications: {
        "enabled": true
    },
    rencodeplus: true,
    "salt-digest": ["xor", "keycloak", "hmac+sha1", "hmac+sha256", "hmac+sha384", "hmac+sha512"],
    screen_sizes: [10],

    "session-type": "Chrome",
    "session-type.full": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) vr-workspace/1.0.0 Chrome/130.0.6723.137 Electron/33.2.1 Safari/537.36",
    "setting-change": true,
    share: false,
    steal: true,
    system_tray: true,
    username: "",
    uuid: "456789a23456789abc45678-3456789a34567123456789abcdef-123456789a678-456789abcdef89abcde123456456789abcdef-2345678c6789a0123456012345c9abc34567456789abc",
    vrefresh: -1,
    wants: [],
    "window.pre-map": true,
    windows: true,
    "xdg-menu-update": true,
    "xdg-menu": true,
}

const jsonCapabilities = JSON.stringify(capabilities, null, 2);
console.log(jsonCapabilities);
