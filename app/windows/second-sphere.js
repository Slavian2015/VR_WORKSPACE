import * as THREE from "three";
let sphere2;


function addSecondSphere() {
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

    sphere2 = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere2.position.set(0, 0, 0);
    sphere2.renderOrder = 2;
    return sphere2;

    // addSphereControls(
    //     sphereGeometry.parameters.phiStart,
    //     sphereGeometry.parameters.phiLength,
    //     sphereGeometry.parameters.thetaStart,
    //     sphereGeometry.parameters.thetaLength
    // );
}

export { addSecondSphere };