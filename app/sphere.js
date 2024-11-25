
import * as THREE from "three";
import { OrbitControls } from "OrbitControls";
import { CSS3DRenderer } from "CSS3DRenderer";
import { VRButton } from "VRButton";

import { addSecondSphere } from 'addSecondSphere';


let camera, scene, renderer, controls, cssRenderer;

let spheres = [];
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let isDragging = false;
let draggedSphere = null;
let previousMousePosition = { x: 0, y: 0 };
let lastFocusedSphere = null;
let lastFocusedSphereRadius = null;


init().then(() => {
    animate();
});

async function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, -10);

    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, 0);

    const canvas = document.getElementById('xr-canvas');
    let gl = canvas.getContext('webgl2', { xrCompatible: true });

    renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvas, context: gl });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 1);

    document.body.appendChild(renderer.domElement);

    cssRenderer = new CSS3DRenderer();
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.top = '0px';
    cssRenderer.domElement.style.left = '0px';
    cssRenderer.domElement.style.pointerEvents = 'none';
    document.body.appendChild(cssRenderer.domElement);

    const sphereGeometry1 = new THREE.SphereGeometry(
        5000, // radius
        64, // widthSegments
        64, // heightSegments
        0, // phiStart
        Math.PI * 2, // phiLength
        0, // thetaStart
        Math.PI // thetaLength
    );


    // beach  cyber castle utopia skysraper
    const texture = new THREE.TextureLoader().load('./assets/beach.png');
    texture.colorSpace = THREE.SRGBColorSpace;
    const sphereMaterial1 = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
        transparent: false,
        opacity: 1
    });


    const sphere = new THREE.Mesh(sphereGeometry1, sphereMaterial1);
    sphere.renderOrder = 1;

    // Rotate the sphere by 180 degrees around the Y-axis
    sphere.rotation.y = Math.PI;
    scene.add(sphere);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.minDistance = 0;
    controls.maxDistance = 5000;
    controls.enableZoom = false;
    controls.enablePan = false;

    if (navigator.xr) {
        document.body.appendChild(VRButton.createButton(renderer));
    } else {
        console.error('WebXR not supported');
    }

    window.addEventListener('resize', onWindowResize, false);
    window.addEventListener('mousedown', onMouseDown, false);
    window.addEventListener('mousemove', onMouseMove, false);
    window.addEventListener('mouseup', onMouseUp, false);
    document.addEventListener('wheel', zoomSphere);


    const sphere1 = addSecondSphere(4950, './assets/dog.png');
    const sphere3 = addSecondSphere(4950, './assets/dog.png');
    const sphere2 = addSecondSphere(4900, './assets/dog2.png');
    const sphere4 = addSecondSphere(4900, './assets/dog2.png');


    // spheres.push(sphere);
    spheres.push(sphere1);
    spheres.push(sphere2);
    spheres.push(sphere3);
    spheres.push(sphere4);
    scene.add(sphere1);
    scene.add(sphere2);   
    scene.add(sphere3);   
    scene.add(sphere4);   
    
    focusSphere(sphere1);
}


function zoomSphere(event) {

    if (event.ctrlKey && lastFocusedSphere) {
        const delta = event.wheelDelta ? event.wheelDelta : -event.detail;
        const zoomFactor = 0.1;
        const scale = delta > 0 ? 1 + zoomFactor : 1 - zoomFactor;
        
        const newPhiStart = lastFocusedSphere.geometry.parameters.phiStart - (lastFocusedSphere.geometry.parameters.phiLength * (scale - 1)) / 2;
        const newThetaStart = lastFocusedSphere.geometry.parameters.thetaStart - (lastFocusedSphere.geometry.parameters.thetaLength * (scale - 1)) / 2;

        lastFocusedSphere.geometry = new THREE.SphereGeometry(
            lastFocusedSphere.geometry.parameters.radius,
            lastFocusedSphere.geometry.parameters.widthSegments,
            lastFocusedSphere.geometry.parameters.heightSegments,
            newPhiStart,
            lastFocusedSphere.geometry.parameters.phiLength * scale,
            newThetaStart,
            lastFocusedSphere.geometry.parameters.thetaLength * scale
        );
    }
};


function focusSphere(sphere) {

    if (lastFocusedSphere && lastFocusedSphere !== sphere) {
        lastFocusedSphere.geometry.dispose();
        lastFocusedSphere.geometry = new THREE.SphereGeometry(
            lastFocusedSphereRadius, // radius
            lastFocusedSphere.geometry.parameters.widthSegments, // widthSegments
            lastFocusedSphere.geometry.parameters.heightSegments, // heightSegments
            lastFocusedSphere.geometry.parameters.phiStart, // phiStart
            lastFocusedSphere.geometry.parameters.phiLength, // phiLength
            lastFocusedSphere.geometry.parameters.thetaStart, // thetaStart
            lastFocusedSphere.geometry.parameters.thetaLength // thetaLength
        );
    }

    if (lastFocusedSphereRadius && lastFocusedSphereRadius === sphere.geometry.parameters.radius) {
        return;
    }

    const minRadius = Math.min(...spheres.map(s => s.geometry.parameters.radius)) - 100;

    lastFocusedSphereRadius = sphere.geometry.parameters.radius;
    sphere.geometry.dispose();

    sphere.geometry = new THREE.SphereGeometry(
        minRadius, // radius
        sphere.geometry.parameters.widthSegments, // widthSegments
        sphere.geometry.parameters.heightSegments, // heightSegments
        sphere.geometry.parameters.phiStart, // phiStart
        sphere.geometry.parameters.phiLength, // phiLength
        sphere.geometry.parameters.thetaStart, // thetaStart
        sphere.geometry.parameters.thetaLength // thetaLength
    );

    lastFocusedSphere = sphere;
};

// function focusSphere(sphere) {
//     if (lastFocusedSphere && lastFocusedSphere !== sphere) {
//     }
// }



function onMouseDown(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(spheres);

    if (intersects.length > 0) {
        isDragging = true;
        draggedSphere = intersects[0].object;
        previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
        focusSphere(draggedSphere);
    }
};

function onMouseMove(event) {
    if (isDragging && draggedSphere) {
        const deltaMove = {
            x: event.clientX - previousMousePosition.x,
            y: event.clientY - previousMousePosition.y
        };
        
        draggedSphere.rotation.y += deltaMove.x * -0.001;
        draggedSphere.rotation.x += deltaMove.y * -0.001;

        previousMousePosition = {
            x: event.clientX,
            y: event.clientY
        };
    }
};

function onMouseUp() {
    isDragging = false;
    draggedSphere = null;
};


function addSimpleButton() {
    const simpleButton = document.createElement('button');
    simpleButton.textContent = 'Open Window';
    simpleButton.style.position = 'absolute';
    simpleButton.style.top = '10px';
    simpleButton.style.left = '10px';
    simpleButton.addEventListener('click', () => {
        const additional_sphere = addSecondSphere(spheres.length + 1, scene, camera);
        spheres.push(additional_sphere);
        scene.add(additional_sphere);
    });
    document.body.appendChild(simpleButton);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    controls.update();
    renderer.clear();
    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
}