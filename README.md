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

    xpra start :100 --bind-ws=0.0.0.0:14501  --daemon=no --speaker=off --webcam=no --mdns=no --pulseaudio=no --html=on --start-child=gnome-calculator --exit-with-children=yes

    xpra start :100 --bind-ws=0.0.0.0:14501  --daemon=no --speaker=off --webcam=no --mdns=no --pulseaudio=no --html=on --start-child=libreoffice --exit-with-children=yes

    gnome-terminal

    vlc


    xpra start :100 --bind-ws=0.0.0.0:14501 --html=on --start-child=gnome-calculator --exit-with-children=yes --auth=allow
    xpra start :100 --start="gnome-calculator" --bind-tcp=0.0.0.0:14500
    netstat -tuln | grep 14501
    xpra stop :100
    npm run dev


    sudo lsof -i :14500
    sudo kill -9 63840

    Upgrade Required

```


# 5) BUILD App

```bash
    npm run build
```