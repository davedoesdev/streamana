#!/bin/bash
cd "$(dirname "$@")"
ffmpeg -f lavfi -i color=white:640x480:d=1,format=rgb24 -vf format=yuv420p site/empty.mp4
