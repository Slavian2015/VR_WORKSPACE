

function saveSphereState(apps) {
    const state = apps.map(app => ({
        appName: app.appName,
        position: app.sphere.position.toArray(),
        geometry: {
            radius: app.sphere.geometry.parameters.radius,
            widthSegments: app.sphere.geometry.parameters.widthSegments,
            heightSegments: app.sphere.geometry.parameters.heightSegments,
            phiStart: app.sphere.geometry.parameters.phiStart,
            phiLength: app.sphere.geometry.parameters.phiLength,
            thetaStart: app.sphere.geometry.parameters.thetaStart,
            thetaLength: app.sphere.geometry.parameters.thetaLength,
        },
    }));
    localStorage.setItem('sphereState', JSON.stringify(state));
}

export { saveSphereState };


// function restoreSphereState() {
//     const savedState = JSON.parse(localStorage.getItem('sphereState'));
//     if (!savedState) return;

//     savedState.forEach((appState) => {
//         addApp(appState.appName, appPorts[appState.appName]);

//         // Wait until app is added
//         setTimeout(() => {
//             if (app) {
//                 app.sphere.position.fromArray(appState.position);
//                 app.sphere.geometry.dispose();
//                 app.sphere.geometry = new THREE.SphereGeometry(
//                     appState.geometry.radius,
//                     appState.geometry.widthSegments,
//                     appState.geometry.heightSegments,
//                     appState.geometry.phiStart,
//                     appState.geometry.phiLength,
//                     appState.geometry.thetaStart,
//                     appState.geometry.thetaLength
//                 );
//             }
//         }, 1000);
//     });
// }

// export { restoreSphereState };