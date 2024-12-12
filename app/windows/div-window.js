function addScreenDiv(div) {
    const screenDiv = document.createElement("div");
    screenDiv.id = "screen";
    screenDiv.style.width = "100%";
    screenDiv.style.height = "100%";

    const floatMenuDiv = document.createElement("div");
    floatMenuDiv.id = "float_menu";

    const ul = document.createElement("ul");
    ul.className = "Menu -horizontal";

    const menuItems = [
        {
            class: "-hasSubmenu -noChevron",
            href: "#",
            title: "Xpra",
            dataIcon: "menu",
            submenu: [
                {
                    class: "-hasSubmenu",
                    href: "#",
                    dataIcon: "apps",
                    text: "Start",
                    submenuId: "startmenu"
                },
                {
                    class: "-hasSubmenu",
                    href: "#",
                    dataIcon: "kitchen",
                    text: "Server",
                    submenu: [
                        {
                            id: "clock_menu_entry",
                            href: "#",
                            dataIcon: "access_time",
                            onclick: "return false",
                            textId: "clock_menu_text"
                        },
                        {
                            href: "#",
                            dataIcon: "cloud_upload",
                            onclick: "upload_file(event); return false",
                            text: "Upload file"
                        },
                        {
                            href: "#",
                            dataIcon: "exit_to_app",
                            onclick: "confirm_shutdown_server(event); return false",
                            text: "Shutdown Server"
                        }
                    ]
                },
                {
                    class: "-hasSubmenu",
                    href: "#",
                    dataIcon: "info",
                    text: "Information",
                    submenu: [
                        {
                            href: "#",
                            dataIcon: "info",
                            onclick: "show_about(event); return false",
                            text: "About Xpra"
                        },
                        {
                            href: "#",
                            dataIcon: "trending_up",
                            onclick: "show_sessioninfo(event); return false",
                            text: "Session Info"
                        },
                        {
                            href: "#",
                            dataIcon: "bug_report",
                            onclick: "show_bugreport(event); return false",
                            text: "Bug Report"
                        }
                    ]
                },
                {
                    href: "#",
                    dataIcon: "exit_to_app",
                    onclick: "client.disconnect_reason='User request'; client.close(); return false",
                    text: "Disconnect"
                }
            ]
        },
        {
            class: "-hasSubmenu -noChevron",
            href: "#",
            title: "Open Windows",
            dataIcon: "filter",
            submenuId: "open_windows_list"
        },
        {
            class: "-hasSubmenu -noChevron",
            href: "#",
            id: "fullscreen_button",
            title: "Fullscreen",
            dataIcon: "fullscreen"
        },
        {
            class: "-hasSubmenu -noChevron",
            href: "#",
            id: "sound_button",
            title: "Audio",
            dataIcon: "volume_off"
        }
    ];

    menuItems.forEach(item => {
        const li = document.createElement("li");
        li.className = item.class || "";
        const a = document.createElement("a");
        a.href = item.href;
        a.title = item.title || "";
        a.className = item.className || "noDrag";
        a.dataset.icon = item.dataIcon;
        li.appendChild(a);

        if (item.submenu) {
            const ulSubmenu = document.createElement("ul");
            if (item.submenuId) ulSubmenu.id = item.submenuId;
            item.submenu.forEach(subItem => {
                const subLi = document.createElement("li");
                subLi.className = subItem.class || "";
                const subA = document.createElement("a");
                subA.href = subItem.href;
                subA.dataset.icon = subItem.dataIcon;
                if (subItem.onclick) subA.setAttribute("onclick", subItem.onclick);
                if (subItem.text) subA.textContent = subItem.text;
                if (subItem.textId) subA.id = subItem.textId;
                subLi.appendChild(subA);
                if (subItem.submenu) {
                    const subUl = document.createElement("ul");
                    subItem.submenu.forEach(subSubItem => {
                        const subSubLi = document.createElement("li");
                        const subSubA = document.createElement("a");
                        subSubA.href = subSubItem.href;
                        subSubA.dataset.icon = subSubItem.dataIcon;
                        if (subSubItem.onclick) subSubA.setAttribute("onclick", subSubItem.onclick);
                        subSubA.textContent = subSubItem.text;
                        subSubLi.appendChild(subSubA);
                        subUl.appendChild(subSubLi);
                    });
                    subLi.appendChild(subUl);
                }
                ulSubmenu.appendChild(subLi);
            });
            li.appendChild(ulSubmenu);
        }

        ul.appendChild(li);
    });

    floatMenuDiv.appendChild(ul);

    const floatTrayDiv = document.createElement("div");
    floatTrayDiv.id = "float_tray";
    floatTrayDiv.className = "menu-divright";
    floatMenuDiv.appendChild(floatTrayDiv);

    screenDiv.appendChild(floatMenuDiv);

    div.appendChild(screenDiv);
}


function divWindow() {

    const div = document.createElement("div");
    div.id = "xpra_screen_div";
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


    // Create and append elements programmatically
    const dpiDiv = document.createElement("div");
    dpiDiv.id = "dpi";
    dpiDiv.style.width = "1in";
    dpiDiv.style.height = "1in";
    dpiDiv.style.left = "-100%";
    dpiDiv.style.top = "-100%";
    dpiDiv.style.position = "absolute";
    div.appendChild(dpiDiv);

    const progressDiv = document.createElement("div");
    progressDiv.id = "progress";
    progressDiv.className = "overlay";
    progressDiv.style.display = "none";
    const progressLabel = document.createElement("p");
    progressLabel.id = "progress-label";
    const progressDetails = document.createElement("p");
    progressDetails.id = "progress-details";
    const progressBar = document.createElement("progress");
    progressBar.id = "progress-bar";
    progressBar.max = 100;
    progressBar.value = 10;
    progressDiv.appendChild(progressLabel);
    progressDiv.appendChild(progressDetails);
    progressDiv.appendChild(progressBar);
    div.appendChild(progressDiv);




    const screenDiv = document.createElement("div");
    screenDiv.id = "screen";
    screenDiv.style.width = "100%";
    screenDiv.style.height = "100%";
    fetch('./xpra/float_menu.html')
        .then(response => response.text())
        .then(data => {
            screenDiv.innerHTML = data;
        })
        .catch(error => console.error('Error loading float_menu.html:', error));
    div.appendChild(screenDiv);


    const notificationsDiv = document.createElement("div");
    notificationsDiv.className = "notifications";
    div.appendChild(notificationsDiv);

    const uploadForm = document.createElement("form");
    uploadForm.id = "upload_form";
    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.id = "upload";
    uploadInput.style.display = "none";
    uploadForm.appendChild(uploadInput);
    div.appendChild(uploadForm);

    const sessionInfoDiv = document.createElement("div");
    sessionInfoDiv.id = "sessioninfo";
    const sessionInfoH2 = document.createElement("h2");
    sessionInfoH2.textContent = "Session Information";
    const sessionInfoH3 = document.createElement("h3");
    sessionInfoH3.textContent = "Connection Data";
    const sessionInfoTable = document.createElement("table");
    sessionInfoTable.id = "sessiondata";

    const rows = [
        { th: "Server Endpoint", td: "endpoint" },
        { th: "Server Display", td: "server_display" },
        { th: "Server Platform", td: "server_platform" },
        { th: "Server Load", td: "server_load" },
        { th: "Session Connected", td: "session_connected" },
        { th: "Server Latency", td: "server_latency" },
        { th: "Client Latency", td: "client_latency" }
    ];

    rows.forEach(row => {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.textContent = row.th;
        const td = document.createElement("td");
        td.id = row.td;
        tr.appendChild(th);
        tr.appendChild(td);
        sessionInfoTable.appendChild(tr);
    });

    sessionInfoDiv.appendChild(sessionInfoH2);
    sessionInfoDiv.appendChild(sessionInfoH3);
    sessionInfoDiv.appendChild(sessionInfoTable);
    div.appendChild(sessionInfoDiv);

    const pasteboardDiv = document.createElement("div");
    const pasteboardTextarea = document.createElement("textarea");
    pasteboardTextarea.id = "pasteboard";
    pasteboardTextarea.style.display = "block";
    pasteboardTextarea.style.position = "absolute";
    pasteboardTextarea.style.left = "-99em";
    pasteboardDiv.appendChild(pasteboardTextarea);
    div.appendChild(pasteboardDiv);

    document.body.appendChild(div);

    const script = document.createElement("script");
    script.src = "./xpra/main_client.js";
    script.onload = () => {
        console.log("main_client.js loaded and executed");
    };
    document.body.appendChild(script);

    return div;
}

export { divWindow };
