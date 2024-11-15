import * as THREE from './node_modules/three/build/three.module.js';
import { VRButton } from './node_modules/three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from './node_modules/three/examples/jsm/renderers/CSS3DRenderer.js';

let camera, scene, renderer, cssRenderer, controls;

init();
animate();

function init() {
    // Set up the scene
    scene = new THREE.Scene();

    // Set up the camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = -1;
    camera.position.x = -1;

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

    createMonitorWindow(new THREE.Vector3(
        0, // higher value moves the window to the right
        200, // higher value moves the window up
        -2500 // higher value moves the window closer
    ));
}


function createMonitorWindow(position) {
    const div = document.createElement('div');
    div.style.width = '1920px';
    div.style.height = '1080px';
    div.style.backgroundColor = 'white';
    div.style.border = 'none';
    div.style.boxShadow = '0 0 2px rgba(0,0,0,0.5)';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    div.innerHTML = '<h1>Desktop Monitor</h1>';
    document.body.appendChild(div);

    const cssObject = new CSS3DObject(div);
    cssObject.position.set(position.x, position.y, position.z);
    scene.add(cssObject);

    let isCtrlPressed = false;
    div.addEventListener('mouseenter', () => {
        document.addEventListener('keydown', onKeyDown);
    });

    div.addEventListener('mouseleave', () => {
        document.removeEventListener('keydown', onKeyDown);
    });

    function onKeyDown(event) {
        if (event.key === 'Control') {
            isCtrlPressed = !isCtrlPressed;
            if (isCtrlPressed) {
                cssObject.position.z += 1500;
            } else {
                cssObject.position.z -= 1500;
            }
        }
    }

    function animateMonitorWindow() {
        const targetZ = isCtrlPressed ? cssObject.position.z + 1500 : cssObject.position.z - 1500;
        const duration = 500; // duration in milliseconds
        const startTime = performance.now();

        function animate() {
            const elapsedTime = performance.now() - startTime;
            const progress = Math.min(elapsedTime / duration, 1);
            cssObject.position.z = THREE.MathUtils.lerp(cssObject.position.z, targetZ, progress);

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        }

        animate();
    }

    function onKeyDown(event) {
        if (event.key === 'Control') {
            isCtrlPressed = !isCtrlPressed;
            animateMonitorWindow();
        }
    }

    // Add drag-and-drop functionality
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    div.addEventListener('mousedown', (event) => {
        isDragging = true;
        previousMousePosition = { x: event.clientX, y: event.clientY };
    });

    document.addEventListener('mousemove', (event) => {
        if (isDragging) {
            const deltaX = event.clientX - previousMousePosition.x;
            const deltaY = event.clientY - previousMousePosition.y;
            cssObject.position.x += deltaX * 1.5; // Adjust the sensitivity as needed
            cssObject.position.y -= deltaY * 1.5; // Adjust the sensitivity as needed
            previousMousePosition = { x: event.clientX, y: event.clientY };
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}



function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // cssRenderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    renderer.setAnimationLoop(render);
}

function render() {
    controls.update(); // Update controls
    renderer.render(scene, camera);
    cssRenderer.render(scene, camera);
}