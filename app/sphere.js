
import * as THREE from "three";

let camera, scene, renderer, controls, cssRenderer;

init().then(() => {
    animate();
});

async function init() {
    const { OrbitControls } = await import('./node_modules/three/examples/jsm/controls/OrbitControls.js');
    const { CSS3DRenderer } = await import('./node_modules/three/examples/jsm/renderers/CSS3DRenderer.js');
    const { VRButton } = await import('./node_modules/three/examples/jsm/webxr/VRButton.js');
    
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, -10);

    camera.position.set(0, 0, 5);
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
        1920, // radius
        64, // widthSegments
        64, // heightSegments
        0, // phiStart
        Math.PI * 2, // phiLength
        0, // thetaStart
        Math.PI // thetaLength
    );
    
    const sphereMaterial1 = new THREE.MeshBasicMaterial({
        map: new THREE.TextureLoader().load('./assets/old_field.jpg'),
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
    controls.screenSpacePanning = false;
    controls.minDistance = 2000;
    controls.maxDistance = 5000;
    controls.enableZoom = true;
    controls.enablePan = true;

    if (navigator.xr) {
        document.body.appendChild(VRButton.createButton(renderer));
    } else {
        console.error('WebXR not supported');
    }

    window.addEventListener('resize', onWindowResize, false);
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