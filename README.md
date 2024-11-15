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


# 3) RUN docker:

```bash
docker build -t 3d-spherical-workspace .

docker run -it --rm \
    --network=host \
    -e DISPLAY=$DISPLAY \
    -v /tmp/.X11-unix:/tmp/.X11-unix \
    --device /dev/dri \
    --group-add video \
    3d-spherical-workspace


docker exec -it 3d_world vulkaninfo

docker-compose up -d --build
```
