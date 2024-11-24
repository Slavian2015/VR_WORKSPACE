import * as THREE from "three";
import { addSphereControls } from "./../components/sphere-controls.js";

let sphere;
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };


function addSecondSphere(renderRadius) {
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
    });

    sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.set(0, 0, 0);
    // sphere.renderOrder = renderOrder;

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('wheel', zoomSphere);

    // addSphereControls(
    //     sphereGeometry.parameters.phiStart,
    //     sphereGeometry.parameters.phiLength,
    //     sphereGeometry.parameters.thetaStart,
    //     sphereGeometry.parameters.thetaLength,
    //     sphere
    // );

    return sphere;
}

const zoomSphere = (event) => {

    if (event.ctrlKey) {
        const delta = event.wheelDelta ? event.wheelDelta : -event.detail;
        const zoomFactor = 0.1;
        const scale = delta > 0 ? 1 + zoomFactor : 1 - zoomFactor;
        
        const newPhiStart = sphere.geometry.parameters.phiStart - (sphere.geometry.parameters.phiLength * (scale - 1)) / 2;
        const newThetaStart = sphere.geometry.parameters.thetaStart - (sphere.geometry.parameters.thetaLength * (scale - 1)) / 2;

        sphere.geometry = new THREE.SphereGeometry(
            sphere.geometry.parameters.radius,
            sphere.geometry.parameters.widthSegments,
            sphere.geometry.parameters.heightSegments,
            newPhiStart,
            sphere.geometry.parameters.phiLength * scale,
            newThetaStart,
            sphere.geometry.parameters.thetaLength * scale
        );
    }
};


const onMouseDown = (event) => {
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
    isDragging = false;
};


export { addSecondSphere };
