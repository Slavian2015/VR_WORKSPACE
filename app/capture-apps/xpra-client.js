const { exec } = require('child_process');

let runningApps = {};

function captureApp(appName, streamPort) {
  console.log('Starting app capture:', appName, streamPort);
  const appProcess = exec(`xpra start --bind-ws=0.0.0.0:${streamPort} --html=off --start-child=${appName} --exit-with-children=yes`, (err, stdout, stderr) => {
    if (err) {
      console.error('Failed to start app capture:', err);
      return;
    }
    console.log(`${appName} opened successfully`);
    console.log('XPRA stdout:', stdout);
    console.log('XPRA stderr:', stderr);
  });
  runningApps[appName] = appProcess;
}

function closeApp(appName) {
  if (runningApps[appName]) {
    runningApps[appName].kill();
    delete runningApps[appName];
  }
}

function openCalculator() {
  console.log('Opening calculator');
  exec('xpra start --bind-tcp=0.0.0.0:14500 --start-child=gnome-calculator', (err, stdout, stderr) => {
    if (err) {
      console.error('Failed to open calculator:', err);
      return;
    }
    console.log('Calculator opened successfully');
    console.log('XPRA stdout:', stdout);
    console.log('XPRA stderr:', stderr);
  });
}


module.exports = { captureApp, closeApp, openCalculator };
