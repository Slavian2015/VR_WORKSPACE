import * as THREE from "three";
import { addSphereControls } from "./../components/sphere-controls.js";

let sphere;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };


function addSecondSphere(renderOrder) {
    const sphereGeometry = new THREE.SphereGeometry(
        1000, // radius
        64, // widthSegments
        64, // heightSegments
        4.4, // phiStart 4.5
        0.5, // phiLength 0.25
        1.3, // thetaStart 1.45
        0.5 // thetaLength 0.25
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

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    addSphereControls(
        sphereGeometry.parameters.phiStart,
        sphereGeometry.parameters.phiLength,
        sphereGeometry.parameters.thetaStart,
        sphereGeometry.parameters.thetaLength,
        sphere
    );

    return sphere;
}


const onMouseDown = (event) => {
    console.log('mouse DOwN');
    isDragging = true;
    previousMousePosition = {
        x: event.clientX,
        y: event.clientY
    };
};

const onMouseMove = (event) => {
    if (isDragging) {
        const deltaMove = {
            x: event.clientX - previousMousePosition.x,
            y: event.clientY - previousMousePosition.y
        };

        sphere.rotation.y += deltaMove.x * -0.001;
        sphere.rotation.x += deltaMove.y * -0.001;

        previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
    }
};

const onMouseUp = () => {
    console.log('mouse up');
    isDragging = false;
};


export { addSecondSphere };
