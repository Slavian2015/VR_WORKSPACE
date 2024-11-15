# Use an Ubuntu base image for the container
FROM ubuntu:20.04

# Set environment variables to avoid tzdata prompt
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/New_York

# Install dependencies
RUN apt-get update && apt-get install -y build-essential
RUN apt-get install -y cmake
RUN apt-get install -y libglfw3-dev
RUN apt-get install -y libglew-dev
RUN apt-get install -y libglm-dev
RUN apt-get install -y python3
RUN apt-get install -y python3-pip
RUN apt-get install -y x11-apps
RUN apt-get install -y libx11-dev
RUN apt-get install -y mesa-utils
# RUN apt-get install -y libgl1-mesa-dri
# RUN apt-get install -y libgl1-mesa-glx
RUN apt-get install -y libdrm-amdgpu1
RUN apt-get install -y libdrm2
RUN apt-get install -y vulkan-tools
RUN apt-get install -y vulkan-utils
RUN apt-get install -y libvulkan-dev
RUN apt-get install -y tzdata
RUN apt-get install -y 
RUN rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip3 install glfw
# RUN pip3 install PyOpenGL
RUN pip3 install numpy

# Create runtime directory
RUN mkdir -p /tmp/runtime-root && chmod 700 /tmp/runtime-root

# Copy the C++ and Python code into the container
COPY main.cpp /workspace/main.cpp
COPY adjustment.py /workspace/adjustment.py
WORKDIR /workspace

# Compile the C++ code
RUN g++ main.cpp -o main -lglfw -lvulkan

# Run the main application
# CMD ["./main"]
