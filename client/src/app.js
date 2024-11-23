import * as THREE from 'three';
import { VRButton } from './../node_modules/three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from './../node_modules/three/examples/jsm/controls/OrbitControls.js';
import { CSS3DRenderer } from './../node_modules/three/examples/jsm/renderers/CSS3DRenderer.js';
import { initWebGPU } from './webgpu.js';
import { createMonitorWindow } from './SimpleWindow.js';

let camera, scene, renderer, cssRenderer, controls, device, context, swapChainFormat;
let sphere2;

init();
animate();

async function init() {
    scene = new THREE.Scene();

    // camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 0);
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, -10);



    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.autoClear = false; // Ensure the rendere
    renderer.setClearColor(0x000000, 1); // Set background color


    document.body.appendChild(renderer.domElement);

    cssRenderer = new CSS3DRenderer();
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.top = '0px';
    cssRenderer.domElement.style.left = '0px';
    cssRenderer.domElement.style.pointerEvents = 'none';
    document.body.appendChild(cssRenderer.domElement);

    const sphereGeometry1 = new THREE.SphereGeometry(
        1920, // radius
        64, // widthSegments
        64, // heightSegments
        0, // phiStart
        Math.PI * 2, // phiLength
        0, // thetaStart
        Math.PI // thetaLength
    );
    
    const sphereMaterial1 = new THREE.MeshBasicMaterial({
        map: new THREE.TextureLoader().load('src/assets/old_field.jpg'),
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.2,
    });
    const sphere = new THREE.Mesh(sphereGeometry1, sphereMaterial1);
    sphere.renderOrder = 1;
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

    
}


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
    const texture = textureLoader.load('src/assets/dog.png', () => {
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
    scene.add(sphere2);

    addSphereControls(
        sphereGeometry.parameters.phiStart,
        sphereGeometry.parameters.phiLength,
        sphereGeometry.parameters.thetaStart,
        sphereGeometry.parameters.thetaLength
    );
}

function addSphereControls(
    phiStart = 3.5,
    phiLength = 2,
    thetaStart = 2,
    thetaLength = 1
) {
    const controlPanel = document.createElement('div');
    controlPanel.style.position = 'absolute';
    controlPanel.style.top = '10px';
    controlPanel.style.right = '10px';
    controlPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    controlPanel.style.padding = '10px';
    controlPanel.style.borderRadius = '5px';
    controlPanel.style.color = 'white';

    const createSlider = (labelText, min, max, value, step, onChange) => {
        const container = document.createElement('div');
        container.style.marginBottom = '10px';

        const label = document.createElement('label');
        label.textContent = labelText;
        label.style.display = 'block';

        const valueLabel = document.createElement('span');
        valueLabel.textContent = value;
        valueLabel.style.float = 'right';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min;
        slider.max = max;
        slider.value = value;
        slider.step = step;
        slider.style.width = '100%';
        slider.addEventListener('input', (event) => {
            const newValue = parseFloat(event.target.value);
            valueLabel.textContent = newValue.toFixed(2);
            onChange(newValue);
        });

        container.appendChild(label);
        container.appendChild(valueLabel);
        container.appendChild(slider);
        return container;
    };

    controlPanel.appendChild(createSlider('phiStart', '0', `${Math.PI * 2}`, phiStart, `${Math.PI * 0.01}`, (value) => {
        sphere2.geometry.dispose();
        sphere2.geometry = new THREE.SphereGeometry(
            1000, // radius
            64, // widthSegments
            32, // heightSegments
            value, // phiStart
            sphere2.geometry.parameters.phiLength, // phiLength
            sphere2.geometry.parameters.thetaStart, // thetaStart
            sphere2.geometry.parameters.thetaLength // thetaLength
        );
    }));

    controlPanel.appendChild(createSlider('phiLength', '0', `${Math.PI * 2}`, phiLength, `${Math.PI * 0.01}`, (value) => {
        sphere2.geometry.dispose();
        sphere2.geometry = new THREE.SphereGeometry(
            1000, // radius
            64, // widthSegments
            32, // heightSegments
            sphere2.geometry.parameters.phiStart, // phiStart
            value, // phiLength
            sphere2.geometry.parameters.thetaStart, // thetaStart
            sphere2.geometry.parameters.thetaLength // thetaLength
        );
    }));

    controlPanel.appendChild(createSlider('thetaStart', '0', `${Math.PI * 2}`, thetaStart, `${Math.PI * 0.01}`, (value) => {
        sphere2.geometry.dispose();
        sphere2.geometry = new THREE.SphereGeometry(
            1000, // radius
            64, // widthSegments
            32, // heightSegments
            sphere2.geometry.parameters.phiStart, // phiStart
            sphere2.geometry.parameters.phiLength, // phiLength
            value, // thetaStart
            sphere2.geometry.parameters.thetaLength // thetaLength
        );
    }));

    controlPanel.appendChild(createSlider('thetaLength', '0', `${Math.PI * 2}`, thetaLength, `${Math.PI * 0.01}`, (value) => {
        sphere2.geometry.dispose();
        sphere2.geometry = new THREE.SphereGeometry(
            1000, // radius
            64, // widthSegments
            32, // heightSegments
            sphere2.geometry.parameters.phiStart, // phiStart
            sphere2.geometry.parameters.phiLength, // phiLength
            sphere2.geometry.parameters.thetaStart, // thetaStart
            value // thetaLength
        );
    }));

    document.body.appendChild(controlPanel);
}


function addSimpleButton() {
    const simpleButton = document.createElement('button');
    simpleButton.textContent = 'Open Window';
    simpleButton.style.position = 'absolute';
    simpleButton.style.top = '10px';
    simpleButton.style.left = '10px';
    simpleButton.addEventListener('click', () => {
        addSecondSphere();
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