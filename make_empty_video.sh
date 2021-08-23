#!/bin/bash
cd "$(dirname "$0")"
ffmpeg -f lavfi -i color=white:640x480:d=1,format=rgb24 -f lavfi -i anullsrc=cl=mono:r=48000 -vf format=yuv420p -t 1 site/empty.mp4
