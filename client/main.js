import * as THREE from './node_modules/three/build/three.module.js';
import { VRButton } from './node_modules/three/examples/jsm/webxr/VRButton.js';
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from './node_modules/three/examples/jsm/renderers/CSS3DRenderer.js';
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
    // camera.position.z = -1;
    // camera.position.x = -1;

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

    // createMonitorWindow(new THREE.Vector3(
    //     0, // higher value moves the window to the right
    //     200, // higher value moves the window up
    //     -2500 // higher value moves the window closer
    // ));

    // createMonitorWindow(new THREE.Vector3(0, 200, -2500), 500);
    // createMonitorWindow(new THREE.Vector3(1500, 200, -2500), 500);
    // createMonitorWindow(new THREE.Vector3(3000, 200, -2500), 500);
    // createMonitorWindow(new THREE.Vector3(4500, 200, -2500), 500);

    createCurvedMonitorWindow(new THREE.Vector3(0, 200, -1000), 500);
}

async function renderCalculator() {
    try {
        const response = await fetch("/xpra");
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);

        const texture = device.createTexture({
            size: [imageBitmap.width, imageBitmap.height, 1],
            format: swapChainFormat,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        device.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture: texture },
            [imageBitmap.width, imageBitmap.height, 1]
        );

        const commandEncoder = device.createCommandEncoder();
        const textureView = context.getCurrentTexture().createView();
        const renderPassDescriptor = {
            colorAttachments: [
                {
                    view: textureView,
                    loadOp: 'clear',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    storeOp: 'store',
                },
            ],
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);
    } catch (error) {
        console.error("Failed to render calculator:", error);
    }
}

function createCurvedMonitorWindow(position, radius) {
    const div = document.createElement('div');
    div.style.width = '800px';
    div.style.height = '600px';
    div.style.backgroundColor = 'white';
    div.style.border = '5px solid black';
    div.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    document.body.appendChild(div);

    const cssObject = new CSS3DObject(div);
    cssObject.position.set(position.x, position.y, position.z);
    scene.add(cssObject);

    // Curve the div to create a concave effect
    const planeGeometry = new THREE.PlaneGeometry(800, 600, 32, 32);
    const positionAttribute = planeGeometry.attributes.position;
    const vector = new THREE.Vector3();
    for (let i = 0; i < positionAttribute.count; i++) {
        vector.fromBufferAttribute(positionAttribute, i);
        const length = vector.length();
        vector.setLength(radius - (radius - length) * 0.5); // Adjust the curvature factor as needed
        positionAttribute.setXYZ(i, vector.x, vector.y, vector.z);
    }
    positionAttribute.needsUpdate = true;
    planeGeometry.computeVertexNormals();

    const planeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, opacity: 0, transparent: true });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.position.set(position.x, position.y, position.z);
    plane.lookAt(camera.position);
    scene.add(plane);

    // Render the calculator app in the div
    renderCalculator().catch(error => console.error("Failed to render calculator:", error));

    return cssObject;
}

function createMonitorWindow(position, radius) {
    const div = document.createElement('div');
    div.style.width = '1920px';
    div.style.height = '1080px';
    div.style.backgroundColor = 'white';
    div.style.border = 'none';
    div.style.boxShadow = '0 0 2px rgba(0,0,0,0.5)';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';

    div.innerHTML = '<h1>Desktop Monitor</h1><br/><br/><br/><textarea style="width: 100%; max-width: 80%; background-color: #grey; height: 80%; text-align: center; font-weight: 800"></textarea>';
    document.body.appendChild(div);



    const cssObject = new CSS3DObject(div);

    cssObject.position.set(position.x, position.y, position.z);
    scene.add(cssObject);

    let curvatureFactor = 30;
    // Apply initial curvature to the div
    div.style.transform = `translate(-50%, -50%) perspective(1500px) rotateX(${curvatureFactor}deg) rotateY(${curvatureFactor}deg)`;


    let isCtrlPressed = false;
    div.addEventListener('mouseenter', () => {
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('wheel', onWheel);
    });

    div.addEventListener('mouseleave', () => {
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('wheel', onWheel);
    });

    function onKeyDown(event) {
        if (event.key === 'Control') {
            isCtrlPressed = !isCtrlPressed;
            animateMonitorWindow();
        }
    }

    function animateMonitorWindow() {
        const direction = new THREE.Vector3();
        direction.subVectors(cssObject.position, camera.position).normalize();
        const targetPosition = cssObject.position.clone().add(direction.multiplyScalar(isCtrlPressed ? -1500 : 1500));
        const duration = 500; // duration in milliseconds
        const startTime = performance.now();

        function animate() {
            const elapsedTime = performance.now() - startTime;
            const progress = Math.min(elapsedTime / duration, 1);
            cssObject.position.lerp(targetPosition, progress);

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

    function onWheel(event) {
        if (event.deltaY < 0) {
            curvatureFactor += 1; // Increase curvature
        } else {
            curvatureFactor -= 1; // Decrease curvature
        }
        curvatureFactor = Math.max(0.1, Math.min(100, curvatureFactor)); // Clamp the value between 250 and 750


        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.transform = `rotate3d(0)`;

        // // Update the CSS transform to match the curvature
        // div.style.transform = `translate(-50%, -50%) perspective(800px) rotateX(${45}deg)`; // max  degree 1000

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

            // Calculate the new position in spherical coordinates
            const spherical = new THREE.Spherical();
            spherical.setFromVector3(cssObject.position.clone().sub(camera.position));
            spherical.theta -= deltaX * 0.001; // Adjust the sensitivity as needed
            spherical.phi -= deltaY * -0.001; // Adjust the sensitivity as needed

            // Convert back to Cartesian coordinates
            const newPosition = new THREE.Vector3().setFromSpherical(spherical).add(camera.position);
            cssObject.position.copy(newPosition);

            // Ensure the window remains parallel to the camera
            cssObject.lookAt(camera.position);

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