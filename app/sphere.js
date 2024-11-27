
import * as THREE from "three";
import { OrbitControls } from "OrbitControls";
import { CSS3DRenderer } from "CSS3DRenderer";
import { VRButton } from "VRButton";
import { addAppSphere } from 'addAppSphere';


let camera, scene, renderer, controls, cssRenderer;
let mainRadius = 5000;

let spheres = [];
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let isDragging = false;
let draggedSphere = null;
let previousMousePosition = { x: 0, y: 0 };
let lastFocusedSphere = null;
let mainSphere = null;


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
        mainRadius, // radius
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
    sphere.userData.isInnerSphere = false;
    sphere.userData.isCloseButton = false;
    sphere.renderOrder = 1;
    sphere.rotation.y = Math.PI;
    scene.add(sphere);

    mainSphere = sphere;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.minDistance = 0;
    controls.maxDistance = mainRadius;
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


    const sphere1 = addAppSphere(mainRadius - 100, './assets/dog.png', scene);

    spheres.push(sphere);
    spheres.push(sphere1);
    scene.add(sphere1);  
    
    lastFocusedSphere = sphere1;

    addSimpleButton();
}


function zoomSphere(event) {

    if (event.ctrlKey && lastFocusedSphere) {
        const delta = event.wheelDelta ? event.wheelDelta : -event.detail;
        const zoomFactor = 0.1;
        const scale = delta > 0 ? 1 + zoomFactor : 1 - zoomFactor;
        const windowSphere = lastFocusedSphere.children.find(child => child.userData.isWindow);
        const closeButton = lastFocusedSphere.children.find(child => child.userData.isCloseButton);
        
        const newPhiStart = windowSphere.geometry.parameters.phiStart - (windowSphere.geometry.parameters.phiLength * (scale - 1)) / 2;
        const newThetaStart = windowSphere.geometry.parameters.thetaStart - (windowSphere.geometry.parameters.thetaLength * (scale - 1)) / 2;

        windowSphere.geometry = new THREE.SphereGeometry(
            windowSphere.geometry.parameters.radius,
            windowSphere.geometry.parameters.widthSegments,
            windowSphere.geometry.parameters.heightSegments,
            newPhiStart,
            windowSphere.geometry.parameters.phiLength * scale,
            newThetaStart,
            windowSphere.geometry.parameters.thetaLength * scale
        );

        closeButton.geometry = new THREE.SphereGeometry(
            closeButton.geometry.parameters.radius,
            closeButton.geometry.parameters.widthSegments,
            closeButton.geometry.parameters.heightSegments,
            newPhiStart,
            closeButton.geometry.parameters.phiLength,
            newThetaStart - 0.05,
            closeButton.geometry.parameters.thetaLength
        );

        const lastFocusedSphereNewPhiStart = lastFocusedSphere.geometry.parameters.phiStart - (lastFocusedSphere.geometry.parameters.phiLength * (scale - 1)) / 2;

        lastFocusedSphere.geometry = new THREE.SphereGeometry(
            lastFocusedSphere.geometry.parameters.radius,
            lastFocusedSphere.geometry.parameters.widthSegments,
            lastFocusedSphere.geometry.parameters.heightSegments,
            lastFocusedSphereNewPhiStart,
            lastFocusedSphere.geometry.parameters.phiLength * scale,
            windowSphere.geometry.parameters.thetaLength + windowSphere.geometry.parameters.thetaStart + 0.02,
            lastFocusedSphere.geometry.parameters.thetaLength * scale
        );
    }
};


function changeSphereRadius(sphere, radius) {
    sphere.geometry.dispose();
    sphere.geometry = new THREE.SphereGeometry(
        radius,
        sphere.geometry.parameters.widthSegments,
        sphere.geometry.parameters.heightSegments,
        sphere.geometry.parameters.phiStart,
        sphere.geometry.parameters.phiLength,
        sphere.geometry.parameters.thetaStart,
        sphere.geometry.parameters.thetaLength
    );

    sphere.children.forEach(child => {
        child.geometry.dispose();
        child.geometry = new THREE.SphereGeometry(
            radius,
            child.geometry.parameters.widthSegments,
            child.geometry.parameters.heightSegments,
            child.geometry.parameters.phiStart,
            child.geometry.parameters.phiLength,
            child.geometry.parameters.thetaStart,
            child.geometry.parameters.thetaLength
        );
    });
}


function addFocusSphere(focusSphere) {

    console.log('mainSphere radius : ', mainSphere.geometry.parameters.radius);
    if (lastFocusedSphere !== focusSphere && focusSphere !== mainSphere) {

        let minRadius = Math.min(...spheres.map(s => s.geometry.parameters.radius));


        changeSphereRadius(focusSphere, minRadius);


        console.log('mainSphere radius 2 : ', mainSphere.geometry.parameters.radius);

        let remainingSpheres = spheres.filter(s => s !== focusSphere && s !== mainSphere).sort((a, b) => b.geometry.parameters.radius - a.geometry.parameters.radius);

        remainingSpheres.forEach((s, index) => {
            changeSphereRadius(s, mainRadius - (index + 1) * 100);
        });


        console.log('mainSphere radius 3 : ', mainSphere.geometry.parameters.radius);
        lastFocusedSphere = focusSphere;
    }
}


function onMouseDown(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(spheres);

    if (intersects.length > 0) {
        if (intersects[0].object.userData.isInnerSphere === true) {

            if (intersects[0].object.userData.isCloseButton === true) {

                const parentSphere = intersects[0].object.parent;
                const childrenToRemove = parentSphere.children.slice();
                childrenToRemove.forEach(child => {
                    parentSphere.remove(child);
                    scene.remove(child);
                    spheres = spheres.filter(s => s !== child);
                });
                scene.remove(parentSphere);
                spheres = spheres.filter(s => s !== parentSphere);
            }

        } else {
            isDragging = true;
            draggedSphere = intersects[0].object;
            previousMousePosition = {
                x: event.clientX,
                y: event.clientY
            };
            addFocusSphere(draggedSphere);

            draggedSphere.material.opacity = 0.8;

            const childrenToRemove = draggedSphere.children.slice();
            childrenToRemove.forEach(child => {
                child.material.opacity = 0.8;
            });
        }
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

    if (lastFocusedSphere) {
        lastFocusedSphere.material.opacity = 1;
        const childrenToRemove = lastFocusedSphere.children.slice();
        childrenToRemove.forEach(child => {
            child.material.opacity = 1;
        });
    }
};


function addSimpleButton() {
    const simpleButton = document.createElement('button');
    simpleButton.textContent = 'Open Window';
    simpleButton.style.position = 'absolute';
    simpleButton.style.top = '10px';
    simpleButton.style.left = '10px';
    simpleButton.addEventListener('click', () => {
        const additional_sphere = addAppSphere(mainRadius - (spheres.length) * 100, './assets/dog.png');
        spheres.push(additional_sphere);
        scene.add(additional_sphere);
        lastFocusedSphere = additional_sphere;
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