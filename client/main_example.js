import * as THREE from './node_modules/three/build/three.module.js';
import { OrbitControls } from './node_modules/three/examples/jsm/controls/OrbitControls.js';
import { CSS3DRenderer, CSS3DObject } from './node_modules/three/examples/jsm/renderers/CSS3DRenderer.js';

let vrSession = null;
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);

navigator.xr.requestSession('immersive-vr').then(session => {
    vrSession = session;
    // Use session to render VR environment
    onSessionStarted(session);
});

function onSessionStarted(session) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const cssRenderer = new CSS3DRenderer();
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(cssRenderer.domElement);

    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(10, 32, 32),
        new THREE.MeshBasicMaterial({ map: new THREE.TextureLoader().load('assets/old_field.jpg') })
    );
    sphere.material.side = THREE.BackSide;
    scene.add(sphere);

    const windowGeometry = new THREE.PlaneGeometry(0.8, 0.8, 32, 32);

    function createVirtualWindow(url, position) {
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.width = 800;
        iframe.height = 600;
        document.body.appendChild(iframe);

        const cssObject = new CSS3DObject(iframe);
        cssObject.position.set(position.x, position.y, position.z);
        scene.add(cssObject);
    }

    createVirtualWindow('about:blank', new THREE.Vector3(0, 1, -3));
    createVirtualWindow('about:blank', new THREE.Vector3(-2, 1, -3));
    // createVirtualWindow('cheerpx/app.html', new THREE.Vector3(2, 1, -3));

    function render() {
        renderer.render(scene, camera);
        cssRenderer.render(scene, camera);
    }

    renderer.setAnimationLoop(render);
}