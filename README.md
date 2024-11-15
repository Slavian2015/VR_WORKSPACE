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