import * as THREE from 'three';
import { VRButton } from './../node_modules/three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from './../node_modules/three/examples/jsm/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from './../node_modules/three/examples/jsm/renderers/CSS3DRenderer.js';
import { initWebGPU } from './webgpu.js';

let camera, scene, renderer, cssRenderer, controls, device, context, swapChainFormat;

init();
animate();

async function init() {
    // Set up the scene
    scene = new THREE.Scene();

    // Set up the camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 5); // Position the camera at the origin
    camera.lookAt(0, 0, 0); // Make the camera look straight ahead

    // Set up the renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Set up the CSS3DRenderer
    cssRenderer = new CSS3DRenderer();
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.top = '0px';
    cssRenderer.domElement.style.left = '0px';
    cssRenderer.domElement.style.pointerEvents = 'none';
    document.body.appendChild(cssRenderer.domElement);

    // Add a sphere with a 360-degree background image
    const sphereGeometry = new THREE.SphereGeometry(500, 60, 40);
    const sphereMaterial = new THREE.MeshBasicMaterial({
        map: new THREE.TextureLoader().load('src/assets/old_field.jpg'),
        side: THREE.BackSide
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    scene.add(sphere);

    // Set up OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 1000;

    // Set up WebXR
    if (navigator.xr) {
        document.body.appendChild(VRButton.createButton(renderer));
    } else {
        console.warn('WebXR not supported');
    }

    // Handle window resize
    window.addEventListener('resize', onWindowResize, false);

    // Initialize WebGPU
    const webGPU = await initWebGPU();
    if (!webGPU) {
        console.error("Failed to initialize WebGPU.");
        return;
    }
    device = webGPU.device;
    context = webGPU.context;
    swapChainFormat = webGPU.swapChainFormat;

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
    controls.update(); // Update controls
    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
}