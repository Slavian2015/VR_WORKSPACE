import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';

let windows = [];



function planeCurve(g, z) {
    let p = g.parameters;
    let hw = p.width * 0.5;

    let a = new THREE.Vector2(-hw, 0);
    let b = new THREE.Vector2(0, z);
    let c = new THREE.Vector2(hw, 0);

    let ab = new THREE.Vector2().subVectors(a, b);
    let bc = new THREE.Vector2().subVectors(b, c);
    let ac = new THREE.Vector2().subVectors(a, c);

    let r = (ab.length() * bc.length() * ac.length()) / (2 * Math.abs(ab.cross(ac)));

    let center = new THREE.Vector2(0, z - r);
    let baseV = new THREE.Vector2().subVectors(a, center);
    let baseAngle = baseV.angle() - (Math.PI * 0.5);
    let arc = baseAngle * 2;

    let uv = g.attributes.uv;
    let pos = g.attributes.position;
    let mainV = new THREE.Vector2();
    for (let i = 0; i < uv.count; i++) {
        let uvRatio = 1 - uv.getX(i);
        let y = pos.getY(i);
        mainV.copy(c).rotateAround(center, (arc * uvRatio));
        pos.setXYZ(i, mainV.x, y, -mainV.y);
    }

    pos.needsUpdate = true;
}

function createCurvedWindow(position, scene, camera) {
    const windowGeometry = new THREE.PlaneGeometry(850, 650, 32, 32);
    const windowMaterial = new THREE.MeshBasicMaterial({ 
        color: "#000", 
        side: THREE.DoubleSide 
    });

    const windowMesh = new THREE.Mesh(windowGeometry, windowMaterial);
    windowMesh.position.set(position.x, position.y, position.z);


    const div = document.createElement('div');
    div.style.width = '800px';
    div.style.height = '600px';
    div.style.backgroundColor = 'white';
    div.style.border = 'none';
    div.style.boxShadow = '0 0 2px rgba(0,0,0,0.5)';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';

    div.innerHTML = '<br/><h1>Desktop Monitor</h1><br/><br/>';
    document.body.appendChild(div);
    const cssObject = new CSS3DObject(div);

    cssObject.position.set(0, 0, 0);
    windowMesh.add(cssObject);

    planeCurve(windowMesh.geometry, 120);

    scene.add(windowMesh);

    windowMesh.lookAt(camera.position);

    windows.push(windowMesh);

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
        direction.subVectors(windowMesh.position, camera.position).normalize();
        const targetPosition = windowMesh.position.clone().add(direction.multiplyScalar(isCtrlPressed ? 20 : -20));
        const duration = 500; // duration in milliseconds
        const startTime = performance.now();

        function animate() {
            const elapsedTime = performance.now() - startTime;
            const progress = Math.min(elapsedTime / duration, 1);
            windowMesh.position.lerp(targetPosition, progress);

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
            spherical.setFromVector3(windowMesh.position.clone().sub(camera.position));
            spherical.theta -= deltaX * 0.001;
            spherical.phi -= deltaY * -0.001;
            const newPosition = new THREE.Vector3().setFromSpherical(spherical).add(camera.position);
            windowMesh.position.copy(newPosition);
            windowMesh.lookAt(camera.position);

            previousMousePosition = { x: event.clientX, y: event.clientY };
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

}

export { createCurvedWindow, planeCurve, windows  };


