import * as THREE from 'three';
import { VRButton } from './../node_modules/three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from './../node_modules/three/examples/jsm/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from './../node_modules/three/examples/jsm/renderers/CSS3DRenderer.js';
import { initWebGPU } from './webgpu.js';
import { createMonitorWindow } from './SimpleWindow.js';
import { createCurvedWindow } from './CurvedWindow.js';

let camera, scene, renderer, cssRenderer, controls, device, context, swapChainFormat;

init();
animate();

async function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    cssRenderer = new CSS3DRenderer();
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.top = '0px';
    cssRenderer.domElement.style.left = '0px';
    cssRenderer.domElement.style.pointerEvents = 'none';
    document.body.appendChild(cssRenderer.domElement);

    const sphereGeometry = new THREE.SphereGeometry(750, 60, 40);
    const sphereMaterial = new THREE.MeshBasicMaterial({
        map: new THREE.TextureLoader().load('src/assets/old_field.jpg'),
        side: THREE.BackSide
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    scene.add(sphere);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 1000;

    if (navigator.xr) {
        document.body.appendChild(VRButton.createButton(renderer));
    } else {
        console.warn('WebXR not supported');
    }

    window.addEventListener('resize', onWindowResize, false);

    const webGPU = await initWebGPU();
    if (!webGPU) {
        console.error("Failed to initialize WebGPU.");
        return;
    }
    device = webGPU.device;
    context = webGPU.context;
    swapChainFormat = webGPU.swapChainFormat;

    addSimpleButton();
    addCurvedButton();
}

function addSimpleButton() {
    const simpleButton = document.createElement('button');
    simpleButton.textContent = 'Open Window';
    simpleButton.style.position = 'absolute';
    simpleButton.style.top = '10px';
    simpleButton.style.left = '10px';
    simpleButton.addEventListener('click', () => {
        createMonitorWindow(
            new THREE.Vector3(0, 0, -2000), 
            scene,
            camera
        );
    });
    document.body.appendChild(simpleButton);
}

function addCurvedButton() {
    const curvedButton = document.createElement('button');
    curvedButton.textContent = 'Open Curved Window';
    curvedButton.style.position = 'absolute';
    curvedButton.style.top = '10px';
    curvedButton.style.right = '10px';
    curvedButton.addEventListener('click', () => {
        createCurvedWindow(
            new THREE.Vector3(10, 0, -550), 
            scene,
            camera
        );
    });
    document.body.appendChild(curvedButton);
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
    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
}