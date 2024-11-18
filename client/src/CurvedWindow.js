import * as THREE from 'three';

let slider = null;
let curveValue = 1;
let windows = [];


function addSlider() {
    const sliderContainer = document.createElement('div');
    sliderContainer.style.position = 'absolute';
    sliderContainer.style.top = '30px';
    sliderContainer.style.right = '10px';
    sliderContainer.style.display = 'flex';
    sliderContainer.style.alignItems = 'center';
    sliderContainer.style.minWidth = '300px';

    slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '-150';
    slider.max = '150';
    slider.step = '0.5';
    slider.value = curveValue;
    slider.style.marginRight = '10px';

    const sliderValue = document.createElement('span');
    sliderValue.textContent = slider.value;
    sliderValue.style.color = '#000';
    sliderValue.style.fontSize = "30px";
    sliderValue.style.fontWeight = "600";

    sliderContainer.appendChild(slider);
    sliderContainer.appendChild(sliderValue);
    document.body.appendChild(sliderContainer);

    slider.addEventListener('input', (event) => {
        const curveValue = parseFloat(event.target.value);
        sliderValue.textContent = curveValue;
        windows.forEach(windowMesh => {
            planeCurve(windowMesh.geometry, curveValue);
        });
    });
}

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

    const windowGeometry = new THREE.PlaneGeometry(800, 600, 32, 32);
    const windowMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xffffff, 
        side: THREE.DoubleSide 
    });

    const windowMesh = new THREE.Mesh(windowGeometry, windowMaterial);
    windowMesh.position.set(position.x, position.y, position.z);

    planeCurve(windowMesh.geometry, curveValue);
    scene.add(windowMesh);

    windowMesh.lookAt(camera.position);

    windows.push(windowMesh);

    if (!slider) {
        addSlider();
    }
}

export { createCurvedWindow };


