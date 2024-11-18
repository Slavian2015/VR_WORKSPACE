#!/bin/bash
xpra start --bind-tcp=0.0.0.0:14500 --start-child=$1 --html5=off
