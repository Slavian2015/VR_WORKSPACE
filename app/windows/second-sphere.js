import * as THREE from "three";

import { addSphereControls } from "./../components/sphere-controls.js";

let sphere;


function addSecondSphere(renderOrder) {
    const sphereGeometry = new THREE.SphereGeometry(
        1000, // радиус
        64, // ширина сегментов
        64, // высота сегментов
        3.6, // phiStart 1
        2, // phiLength 2
        1, // thetaStart 4.4
        1 // thetaLength 1
    );

    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load('./assets/dog.png', () => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
    });
    const sphereMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1,
        depthTest: true,
        depthWrite: true
    });

    sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.set(0, 0, 0);
    sphere.renderOrder = renderOrder;

    addSphereControls(
        sphereGeometry.parameters.phiStart,
        sphereGeometry.parameters.phiLength,
        sphereGeometry.parameters.thetaStart,
        sphereGeometry.parameters.thetaLength,
        sphere
    );
    return sphere;
}

export { addSecondSphere };