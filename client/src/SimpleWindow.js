import * as THREE from 'three';
import { CSS3DObject } from './../node_modules/three/examples/jsm/renderers/CSS3DRenderer.js';


function createMonitorWindow(position, scene, camera) {
    const div = document.createElement('div');
    div.style.width = '1920px';
    div.style.height = '1080px';
    div.style.backgroundColor = 'white';
    div.style.border = 'none';
    div.style.boxShadow = '0 0 2px rgba(0,0,0,0.5)';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';

    div.innerHTML = '<br/><h1>Desktop Monitor</h1><br/><br/>';
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
            spherical.theta -= deltaX * 0.001;
            spherical.phi -= deltaY * -0.001;
            const newPosition = new THREE.Vector3().setFromSpherical(spherical).add(camera.position);
            cssObject.position.copy(newPosition);
            cssObject.lookAt(camera.position);

            previousMousePosition = { x: event.clientX, y: event.clientY };
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

export { createMonitorWindow };