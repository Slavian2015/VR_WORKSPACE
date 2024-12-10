

function divWindow() {

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


    // div.innerHTML = "<h1>Hello World</h1>";

    // Create an iframe element
    const iframe = document.createElement("iframe");
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    iframe.src = "http://0.0.0.0:14501";

    // Append the iframe to the div
    div.appendChild(iframe);

    document.body.appendChild(div);
    return div;
}

export { divWindow };
