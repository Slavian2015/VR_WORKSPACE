import { LightXpraClient } from 'LightXpraClient';


function init_client(port) {
    if (typeof jQuery == "undefined") {
        window.alert("Incomplete Xpra HTML5 client installation: jQuery is missing, cannot continue.");
        return;
    }

    const debug = true;

    const server = "localhost";
    const client = new LightXpraClient("screen");
    client.host = server;
    client.port = port;
    client.ssl = false; // Set to true if using SSL
    client.webtransport = false; // Set to true if using WebTransport

    if (debug) {
        // Example of client event hooks:
        client.on('open', function () {
            console.log("network", "connection open");
        });
        client.on('connect', function () {
            console.log("network", "connection established");
        });
        client.on('first_ui_event', function () {
            console.log("network", "first ui event");
        });
        client.on('last_window', function () {
            console.log("network", "last window disappeared");
        });
    }

    client.connect();
    return client;
}


export { init_client };