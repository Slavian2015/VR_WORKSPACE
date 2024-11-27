import * as THREE from "three";
import { addSphereControls } from "./../components/sphere-controls.js";
import { CSS3DObject } from "CSS3DRenderer";


function getCloseButtonSphere(radius) {
    // const div = document.createElement('div');
    // div.style.width = '100px';
    // div.style.height = '100px';
    // div.style.backgroundColor = 'red';
    // div.style.color = 'black';
    // div.style.border = 'none';
    // div.style.borderRadius = '50%';
    // div.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';
    // div.style.display = 'flex';
    // div.style.alignItems = 'center';
    // div.style.justifyContent = 'center';
    // div.style.textAlign = 'center';
    // div.style.padding = '0';
    // div.style.margin = '0';
    // div.style.fontSize = '80px';
    // div.style.cursor = 'pointer';
    // div.innerHTML = '<span>X</span>';
    // document.body.appendChild(div);

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
        4.46, // phiStart
        0.03, // phiLength
        1.29, // thetaStart 
        0.03 // thetaLength
    );


    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);

    sphere.userData.isInnerSphere = true;
    sphere.userData.isCloseButton = true;
    sphere.position.set(0, 0, radius / 2000);


    return sphere;
};


function getCloseButtonPlane(radius, phiStart, thetaStart) {

    const x = radius * Math.sin(thetaStart) * Math.cos(phiStart);
    const y = radius * Math.sin(thetaStart) * Math.sin(phiStart);
    const z = radius * Math.cos(thetaStart);


    console.log(`radius * Math.sin(thetaStart): ${radius * Math.sin(thetaStart)}`);

    console.log(`x: ${x}, y: ${y}, z: ${z}`);

    // const position = new THREE.Vector3(x, y, z);
    const position = new THREE.Vector3(-150, 1400, -radius);

    // const div = document.createElement('div');
    // div.style.width = '100px';
    // div.style.height = '100px';
    // div.style.backgroundColor = 'red';
    // div.style.color = 'black';
    // div.style.border = 'none';
    // div.style.borderRadius = '50%';
    // div.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';
    // div.style.display = 'flex';
    // div.style.alignItems = 'center';
    // div.style.justifyContent = 'center';
    // div.style.textAlign = 'center';
    // div.style.padding = '0';
    // div.style.margin = '0';
    // div.style.fontSize = '80px';
    // div.style.cursor = 'pointer';
    // div.innerHTML = '<span>X</span>';
    // document.body.appendChild(div);

    // const cssObject = new CSS3DObject(div);
    // cssObject.position.set(position.x, position.y, position.z);


    const button = document.createElement('button');
    button.style.position = 'absolute';
    button.style.width = '100px';
    button.style.height = '100px';
    button.style.backgroundColor = 'red';
    button.style.border = 'none';
    button.style.borderRadius = '50%';
    button.style.cursor = 'pointer';
    button.style.fontSize = '80px';
    button.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';
    button.innerHTML = '<span>X</span>';
    button.style.transform = `translate3d(${position.x}px, ${position.y}px, ${position.z}px)`;

    button.addEventListener('click', function () {
        console.log("Button clicked!");
    });

    document.body.appendChild(button);

    const cssObject = new CSS3DObject(button);
    cssObject.position.set(position.x, position.y, position.z);

    return cssObject;
}



function addAppSphere(renderRadius, picture, scene) {
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
        opacity: 1,
    });

    const sphere = new THREE.Mesh(sphereGeometry, paddingMaterial);
    sphere.userData.isInnerSphere = false;
    sphere.userData.isCloseButton = false;
    sphere.position.set(0, 0, renderRadius / 2000);

    const innerSphereGeometry = new THREE.SphereGeometry(
        renderRadius,
        64, // widthSegments
        64, // heightSegments
        4.44, // phiStart
        0.42, // phiLength
        1.33, // thetaStart
        0.44 // thetaLength
    );

    const innerSphere = new THREE.Mesh(innerSphereGeometry, sphereMaterial);
    innerSphere.userData.isInnerSphere = true;
    innerSphere.userData.isCloseButton = false;
    innerSphere.position.set(0, 0, renderRadius / 2000);

    // addSphereControls(
    //     innerSphereGeometry.parameters.radius,
    //     innerSphereGeometry.parameters.phiStart,
    //     innerSphereGeometry.parameters.phiLength,
    //     innerSphereGeometry.parameters.thetaStart,
    //     innerSphereGeometry.parameters.thetaLength,
    //     innerSphere
    // );

    const button = getCloseButtonSphere(renderRadius);
    sphere.add(button);
    sphere.add(innerSphere);
    return sphere;
}




export { addAppSphere };
