import * as THREE from "three";


function getCloseButtonSphere(radius, phiStart, thetaStart) {

    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    canvas.style.backgroundColor = 'transparent';
    canvas.style.border = 'none';
    canvas.style.borderRadius = '50%';
    const context = canvas.getContext('2d');
    context.fillStyle = 'red';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black';
    context.font = '80px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('X', canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.repeat.set(1, 1);
    texture.colorSpace = THREE.SRGBColorSpace;

    const sphereMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
    });

    const sphereGeometry = new THREE.SphereGeometry(
        radius, 
        64, // widthSegments
        64, // heightSegments
        phiStart, // phiStart
        0.03, // phiLength
        thetaStart - 0.05, // thetaStart 
        0.03 // thetaLength
    );
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.userData.isInnerSphere = true;
    sphere.userData.isCloseButton = true;
    sphere.position.set(0, 0, radius / 2000);
    return sphere;
};


function addAppSphere(renderRadius, picture) {

    const textureLoader = new THREE.TextureLoader();

    const texture = textureLoader.load(picture, () => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
        texture.colorSpace = THREE.SRGBColorSpace;
    });

    const innerSphereGeometry = new THREE.SphereGeometry(
        renderRadius,
        64, // widthSegments
        64, // heightSegments
        4.44, // phiStart
        0.42, // phiLength
        1.33, // thetaStart
        0.44 // thetaLength
    );

    const sphereMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
    });

    const innerSphere = new THREE.Mesh(innerSphereGeometry, sphereMaterial);
    innerSphere.userData.isInnerSphere = true;
    innerSphere.userData.isWindow = true;
    innerSphere.userData.isCloseButton = false;
    innerSphere.position.set(0, 0, renderRadius / 2000);
    const button = getCloseButtonSphere(
        renderRadius, 
        innerSphereGeometry.parameters.phiStart, 
        innerSphereGeometry.parameters.thetaStart
    );

    const sphereGeometry = new THREE.SphereGeometry(
        renderRadius, // radius
        64, // widthSegments
        64, // heightSegments

        innerSphereGeometry.parameters.phiStart + 0.11, // phiStart 10% less
        // 4.55, // phiStart 4.5
        0.2, // phiLength 0.25
        // innerSphereGeometry.parameters.thetaStart + 0.01, // thetaStart 10% less
        1.8, // thetaStart 10% less
        0.02 // thetaLength 10% less
    );

    const paddingMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
    });

    const sphere = new THREE.Mesh(sphereGeometry, paddingMaterial);
    sphere.userData.isInnerSphere = false;
    sphere.userData.isCloseButton = false;
    sphere.position.set(0, 0, renderRadius / 2000);

    sphere.add(button);
    sphere.add(innerSphere);
    return sphere;
}


export { addAppSphere };
