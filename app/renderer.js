console.log('Renderer process started');

const { exec } = require('child_process');

window.launchApp = function(appName) {
  exec(appName, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.log(`${appName} started`);
    }
  });
};