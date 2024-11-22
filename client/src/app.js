import * as THREE from 'three';
import { VRButton } from './../node_modules/three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from './../node_modules/three/examples/jsm/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from './../node_modules/three/examples/jsm/renderers/CSS3DRenderer.js';
import { initWebGPU } from './webgpu.js';
import { createMonitorWindow } from './SimpleWindow.js';
import { createCurvedWindow, planeCurve, windows } from './CurvedWindow.js';

let camera, scene, renderer, cssRenderer, controls, device, context, swapChainFormat;

const colors = ["#fff", "#000", "yellow", "red", "blue", "green", "purple", "orange", "pink", "brown"];
let usedColors = [];

init();
animate();

async function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 0);
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

    const sphereGeometry = new THREE.SphereGeometry(
        2000, // radius
        64, // widthSegments
        32, // heightSegments
        0, // phiStart
        Math.PI * 2, // phiLength
        0, // thetaStart
        Math.PI // thetaLength
    );
    const sphereMaterial = new THREE.MeshBasicMaterial({
        map: new THREE.TextureLoader().load('src/assets/old_field.jpg'),
        side: THREE.BackSide
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    scene.add(sphere);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false
    controls.minDistance = 2000;
    controls.maxDistance = 5000;
    controls.enableZoom = true;
    controls.enablePan = true;

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
    // addCurvedButton();
    // addSlider();

    addSecondSphere();
}

function addSecondSphere() {
    const sphereGeometry = new THREE.SphereGeometry(
        1000, // radius
        64, // widthSegments
        32, // heightSegments
        0, // phiStart
        Math.PI * 2, // phiLength
        0, // thetaStart
        Math.PI // thetaLength
    );
    const sphereMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.5
    });
    const sphere2 = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere2.position.set(0, 0, 0);
    scene.add(sphere2);

    const cssObject = document.createElement('div');
    cssObject.style.width = '1000px';
    cssObject.style.height = '1000px';
    cssObject.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
    cssObject.textContent = 'CSS Object';
    cssObject.style.color = 'white';
    cssObject.style.display = 'flex';
    cssObject.style.alignItems = 'center';
    cssObject.style.justifyContent = 'center';

    const cssWindow = new CSS3DObject(cssObject);
    cssWindow.position.set(0, 1000, 0);
    cssWindow.lookAt(0, 0, 0);

    sphere2.add(cssWindow);

}


function addSimpleButton() {
    const simpleButton = document.createElement('button');
    simpleButton.textContent = 'Open Window';
    simpleButton.style.position = 'absolute';
    simpleButton.style.top = '10px';
    simpleButton.style.left = '10px';
    simpleButton.addEventListener('click', () => {
        createMonitorWindow(
            new THREE.Vector3(0, 0, -1920), 
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
            new THREE.Vector3(10, 0, -900), 
            scene,
            camera
        );
    });
    document.body.appendChild(curvedButton);
}

function addSlider() {
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '150';
    slider.value = '120';
    slider.step = '0.5';
    slider.style.position = 'absolute';
    slider.style.bottom = '10px';
    slider.style.left = '90%';
    slider.style.transform = 'translateX(-50%)';
    slider.addEventListener('input', (event) => {
        const value = parseFloat(event.target.value);
        windows.forEach(windowMesh => {
            planeCurve(windowMesh.geometry, value);
        });
    });
    document.body.appendChild(slider);
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