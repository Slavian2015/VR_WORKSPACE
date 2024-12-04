

function divWindow(mainRadius) {

    const div = document.createElement("div");
    div.style.width = "4000px";
    div.style.height = "2000px";
    div.style.backgroundColor = "white";


    div.style.border = "2px solid black";
    div.style.borderRadius = "10px";
    div.style.padding = "20px";
    div.style.textAlign = "center";
    div.style.fontSize = "100px";
    div.style.fontFamily = "Arial";
    div.style.color = "black";
    div.style.overflow = "hidden";
    div.style.display = "flex";
    div.style.justifyContent = "center";
    div.style.alignItems = "center";
    div.style.position = "absolute";

    div.style.zIndex = '1000';

    const canvas = document.createElement('canvas');
    $(canvas).addClass("gpu-trigger");

    // Transfer control to offscreen before getting the 2d context
    const offscreen = canvas.transferControlToOffscreen();
    const context = offscreen.getContext("2d");
    context.imageSmoothingEnabled = false;

    offscreen.width = 4000; // Set the width of the offscreen canvas
    offscreen.height = 2000; // Set the height of the offscreen canvas

    div.appendChild(canvas);

    document.body.appendChild(div); // Ensure the div is added to the DOM

    return { element: div, context: context };
    // return cssObject;
}

export { divWindow };
