import * as THREE from "three";

import { addSphereControls } from "./../components/sphere-controls.js";

function addAppSphere(renderRadius, picture) {
    const sphereGeometry = new THREE.SphereGeometry(
        renderRadius, // radius
        64, // widthSegments
        64, // heightSegments
        4.55, // phiStart 4.5
        0.2, // phiLength 0.25
        1.8, // thetaStart 10% less
        0.02 // thetaLength 10% less
    );

    const textureLoader = new THREE.TextureLoader();

    const texture = textureLoader.load(picture, () => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
        texture.colorSpace = THREE.SRGBColorSpace;
    });

    const sphereMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
    });

    const paddingMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
    });

    const sphere = new THREE.Mesh(sphereGeometry, paddingMaterial);
    sphere.userData.isInnerSphere = false;
    sphere.position.set(0, 0, renderRadius / 2000);

    const innerSphereGeometry = new THREE.SphereGeometry(
        renderRadius - 200, // slightly smaller radius
        64, // widthSegments
        64, // heightSegments
        4.44, // phiStart 10% less
        0.42, // phiLength 10% less
        1.33, // thetaStart 10% less
        0.44 // thetaLength 10% less
    );


    const innerSphere = new THREE.Mesh(innerSphereGeometry, sphereMaterial);

    innerSphere.userData.isInnerSphere = true;
    innerSphere.position.set(0, 0, renderRadius / 2000);

    // addSphereControls(
    //     innerSphereGeometry.parameters.radius,
    //     innerSphereGeometry.parameters.phiStart,
    //     innerSphereGeometry.parameters.phiLength,
    //     innerSphereGeometry.parameters.thetaStart,
    //     innerSphereGeometry.parameters.thetaLength,
    //     innerSphere
    // );

    const buttonGeometry = new THREE.PlaneGeometry(1000, 500);
    const buttonMaterial = new THREE.MeshBasicMaterial({ 
        color: "red",
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1,
    });
    const button = new THREE.Mesh(buttonGeometry, buttonMaterial);

    button.position.set(0, 0, renderRadius / 2000);

    button.userData = { isButton: true };

    button.callback = function() {
        console.log("Button clicked!");
    };

    sphere.add(button);


    sphere.add(innerSphere);

    return sphere;
}




export { addAppSphere };
