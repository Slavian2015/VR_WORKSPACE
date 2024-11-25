project-root/
├── index.html          # Entry point for the application
├── main.js             # Main WebXR application logic
├── cheerpx/
│   ├── app.html        # Container for virtualized applications
│   ├── cheerpx_loader.js  # CheerpX WebVM loader
├── assets/             # Static resources (models, textures)
│   └── sphere_bg.jpg   # Background for VR sphere
├── css/
│   └── styles.css      # VR workspace styling
└── package.json        # Node.js dependencies


## To create and start a virtual environment, follow these steps in the terminal:

# 1) Install virtualenv (if it's not installed):

```bash
    pip install virtualenv
```


# 2) Create a virtual environment:

```bash
    virtualenv venv
```

# 3) Activate the virtual environment:

```bash
    source venv/bin/activate
```

# 3) RUN App:

```bash
    npx http-server -p 8080
```



# 4) RUN calculator:

```bash
    xpra start :100 --start="gnome-calculator" --bind-tcp=0.0.0.0:14500

    netstat -tuln | grep 14500


    xpra stop :100


    npm run dev
```


# 5) BUILD App

```bash
    npm run build
```



project/
├── server/                    # Серверная часть WebRTC и Xpra
│   ├── index.js               # WebRTC сервер на Node.js
│   ├── xpra-control.sh        # Скрипт для запуска Xpra и приложений
│   └── package.json           # Зависимости для Node.js
├── client/                    # Клиентская часть WebXR
│   ├── index.html             # Веб-приложение с WebXR
│   ├── app.js                 # Взаимодействие с WebRTC
│   ├── three.min.js           # Three.js библиотека
│   └── styles.css             # Стили интерфейса
└── README.md                  # Инструкции по запуску