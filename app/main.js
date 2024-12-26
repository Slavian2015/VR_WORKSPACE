const { app, BrowserWindow } = require('electron');


let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1980,
        height: 1300,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: false,
            webgl: true,
            experimentalFeatures: true,
            enableBlinkFeatures: 'WebXR',
            additionalArguments: [
                '--enable-webxr', 
                '--enable-webxr-hit-test', 
                '--enable-webxr-hand-tracking', 
                '--enable-webxr-plane-detection'
            ]
        },
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.openDevTools();
}


app.on('ready', () => {
    createWindow();
});


app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});


app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
