#!/bin/bash
cd "$(dirname "$0")"
f="$(mktemp XXXXXXXXXX.mp4)"
ffmpeg -f lavfi -i color=white:640x480:d=1,format=rgb24 -f lavfi -i anullsrc=cl=mono:r=48000 -vf format=yuv420p -t 1 -y "$f"
cat > ../site/empty-video.js <<EOF
export default "data:video/mp4;base64,$(base64 --wrap=0 "$f")";
EOF
rm "$f"
