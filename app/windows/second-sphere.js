import * as THREE from "three";
import { addSphereControls } from "./../components/sphere-controls.js";


function addSecondSphere(renderRadius, picture) {
    const sphereGeometry = new THREE.SphereGeometry(
        renderRadius, // radius
        64, // widthSegments
        64, // heightSegments
        4.4, // phiStart 4.5
        0.5, // phiLength 0.25
        1.3, // thetaStart 1.45
        0.5 // thetaLength 0.25
    );

    const textureLoader = new THREE.TextureLoader();


    const texture = textureLoader.load(picture, () => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
    });
    const sphereMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1,
    });

    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.set(0, 0, renderRadius/2000);
    // sphere.renderOrder = renderOrder;

    // addSphereControls(
    //     sphereGeometry.parameters.phiStart,
    //     sphereGeometry.parameters.phiLength,
    //     sphereGeometry.parameters.thetaStart,
    //     sphereGeometry.parameters.thetaLength,
    //     sphere
    // );

    return sphere;
}





export { addSecondSphere };
