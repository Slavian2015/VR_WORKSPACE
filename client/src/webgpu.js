async function initWebGPU() {
    const canvas = document.getElementById('webgpuCanvas');
    if (!canvas) {
        console.error("Canvas element not found.");
        return null;
    }
  
    if (!navigator.gpu) {
        console.error("WebGPU is not supported in this browser.");
        return null;
    }
  
    let adapter;
    try {
        adapter = await navigator.gpu.requestAdapter();
    } catch (err) {
        console.error("Failed to get GPU adapter:", err);
        return null;
    }
  
    if (!adapter) {
        console.error("Failed to get GPU adapter.");
        return null;
    }
  
    let device;
    try {
        device = await adapter.requestDevice();
    } catch (err) {
        console.error("Failed to get GPU device:", err);
        return null;
    }
  
    const context = canvas.getContext('webgpu');
    const swapChainFormat = 'bgra8unorm';
    context.configure({
        device,
        format: swapChainFormat,
    });
  
    return { device, context, swapChainFormat };
  }
  
  export { initWebGPU };
  