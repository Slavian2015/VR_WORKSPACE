#!/usr/bin/python3
"""Draws app/bg/test_grid.png: a 360 panorama with a grid in degrees, to read the field of view inside the headset.

Shown as the background, the number under the right edge of what you see minus the number under the left edge is
the horizontal angle of view; top minus bottom is the vertical one. Yellow line: the horizon, with the heading in
degrees (minus to the left). Blue lines: every 90 degrees of heading, with the height in degrees (minus down).
"""
import os
from PIL import Image, ImageDraw, ImageFont

W, H = 4096, 2048  # 11.4 px per degree, about what an iPhone 15 Pro shows per degree in a headset
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
x = lambda yaw: (yaw / 360 + 0.5) * W    # yaw 0 is the middle of the picture, as the phone page maps it
y = lambda pitch: (0.5 - pitch / 180) * H

image = Image.new('RGB', (W, H), '#0b0f14')
draw = ImageDraw.Draw(image)
big, small = ImageFont.truetype(BOLD, 30), ImageFont.truetype(BOLD, 20)

for degree in range(-180, 180, 10):   # the grid: every 10 degrees, brighter every 30
    draw.line([(x(degree), 0), (x(degree), H)], fill='#6b7c8f' if degree % 30 == 0 else '#33404d', width=3 if degree % 30 == 0 else 2)
for degree in range(-80, 90, 10):
    draw.line([(0, y(degree)), (W, y(degree))], fill='#6b7c8f' if degree % 30 == 0 else '#33404d', width=3 if degree % 30 == 0 else 2)

draw.line([(0, y(0)), (W, y(0))], fill='#ffd21f', width=5)   # the horizon with a ruler: a tick per degree, longer every 5
for degree in range(-180, 180):
    tick = 22 if degree % 10 == 0 else 14 if degree % 5 == 0 else 7
    draw.line([(x(degree), y(0) - tick), (x(degree), y(0) + tick)], fill='#ffd21f', width=2)
    if degree % 10 == 0:
        draw.text((x(degree), y(0) - 30), f'{degree:+d}' if degree else '0', font=big, fill='white', anchor='mb')

for heading in (-180, -90, 0, 90):   # a vertical ruler every 90 degrees of heading, so one is always near
    draw.line([(x(heading), 0), (x(heading), H)], fill='#35c8ff', width=5)
    for degree in range(-89, 90):
        tick = 22 if degree % 10 == 0 else 14 if degree % 5 == 0 else 7
        draw.line([(x(heading) - tick, y(degree)), (x(heading) + tick, y(degree))], fill='#35c8ff', width=2)
        if degree % 10 == 0 and degree:
            draw.text((x(heading) + 32, y(degree)), f'{degree:+d}', font=big, fill='white', anchor='lm')

for heading in range(-180, 180, 30):   # the heading again on the lines 30 degrees up and down, for a tilted head
    for pitch in (-30, 30):
        draw.text((x(heading) + 8, y(pitch) - 6), f'{heading:+d}' if heading else '0', font=small, fill='#9fb0c2', anchor='lb')

os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app/bg'), exist_ok=True)
image.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app/bg/test_grid.png'))
