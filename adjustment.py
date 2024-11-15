import glfw
from OpenGL.GL import *
import numpy as np
import math

sphere_radius = 5.0  # Same as in the C++ program


def draw_window_on_sphere(radius, theta, phi):
    # Convert spherical to Cartesian coordinates
    x = radius * math.sin(theta) * math.cos(phi)
    y = radius * math.sin(theta) * math.sin(phi)
    z = radius * math.cos(theta)

    glPushMatrix()
    glTranslatef(x, y, z)
    # Here you could draw a window-like quad
    glPopMatrix()


# Function for adjusting positions dynamically
def adjust_positions():
    theta, phi = np.radians(45), np.radians(45)  # Example angles for positioning
    draw_window_on_sphere(sphere_radius, theta, phi)


# Initialize GLFW and OpenGL
if not glfw.init():
    raise Exception("GLFW can't be initialized")

window = glfw.create_window(800, 600, "Python Adjustment Layer", None, None)

if not window:
    glfw.terminate()
    raise Exception("GLFW window can't be created")

glfw.make_context_current(window)


# Main loop
while not glfw.window_should_close(window):
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)

    # Dynamically adjust window position on the sphere
    adjust_positions()

    glfw.swap_buffers(window)
    glfw.poll_events()

glfw.terminate()
