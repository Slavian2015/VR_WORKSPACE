import * as THREE from "three";


function addSphereControls(
    phiStart = 3.5,
    phiLength = 2,
    thetaStart = 2,
    thetaLength = 1,
    sphere
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
        sphere.geometry.dispose();
        sphere.geometry = new THREE.SphereGeometry(
            1000, // radius
            64, // widthSegments
            32, // heightSegments
            value, // phiStart
            sphere.geometry.parameters.phiLength, // phiLength
            sphere.geometry.parameters.thetaStart, // thetaStart
            sphere.geometry.parameters.thetaLength // thetaLength
        );
    }));

    controlPanel.appendChild(createSlider('phiLength', '0', `${Math.PI * 2}`, phiLength, `${Math.PI * 0.01}`, (value) => {
        sphere.geometry.dispose();
        sphere.geometry = new THREE.SphereGeometry(
            1000, // radius
            64, // widthSegments
            32, // heightSegments
            sphere.geometry.parameters.phiStart, // phiStart
            value, // phiLength
            sphere.geometry.parameters.thetaStart, // thetaStart
            sphere.geometry.parameters.thetaLength // thetaLength
        );
    }));

    controlPanel.appendChild(createSlider('thetaStart', '0', `${Math.PI * 2}`, thetaStart, `${Math.PI * 0.01}`, (value) => {
        sphere.geometry.dispose();
        sphere.geometry = new THREE.SphereGeometry(
            1000, // radius
            64, // widthSegments
            32, // heightSegments
            sphere.geometry.parameters.phiStart, // phiStart
            sphere.geometry.parameters.phiLength, // phiLength
            value, // thetaStart
            sphere.geometry.parameters.thetaLength // thetaLength
        );
    }));

    controlPanel.appendChild(createSlider('thetaLength', '0', `${Math.PI * 2}`, thetaLength, `${Math.PI * 0.01}`, (value) => {
        sphere.geometry.dispose();
        sphere.geometry = new THREE.SphereGeometry(
            1000, // radius
            64, // widthSegments
            32, // heightSegments
            sphere.geometry.parameters.phiStart, // phiStart
            sphere.geometry.parameters.phiLength, // phiLength
            sphere.geometry.parameters.thetaStart, // thetaStart
            value // thetaLength
        );
    }));

    document.body.appendChild(controlPanel);
}

export { addSphereControls };