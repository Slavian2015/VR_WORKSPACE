const { app, BrowserWindow, ipcMain } = require('electron');
const { captureApp, closeApp, openCalculator } = require('./capture-apps/xpra-client');


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


ipcMain.on('launch-app', (event, { appName, streamPort }) => {

    try {
        captureApp(appName, streamPort);
        event.reply('app-launched', { appName, streamPort });
      } catch (err) {
        console.error('Failed to launch app:', err);
      }
});


ipcMain.on('close-app', (event, appName) => {
    console.log('close-app', appName);
    closeApp(appName);
    event.reply('app-closed', 'App closed');
});


ipcMain.on('launch-calc', (event) => {
    console.log('launch-calc');
    openCalculator();
    event.reply('calc-lunched', 'Calc launched');
});