const { exec } = require('child_process');

function captureApp(appName, streamPort) {
  exec(`xpra start :100 --bind-tcp=0.0.0.0:${streamPort} --start=${appName}`, (err, stdout, stderr) => {
    if (err) console.error('Failed to start app capture:', err);
    console.log(stdout);
  });
}

module.exports = { captureApp };
