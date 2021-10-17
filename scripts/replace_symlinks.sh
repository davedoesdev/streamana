#!/bin/bash
cd "$(dirname "$0")/../site"

for f in encoder-worker.js \
         resolution.js \
         webm-muxer.js \
         webm-muxer.wasm \
         webm-worker.js
do
    rm "$f"
    cp "../webm-muxer.js/$f" .
done

for f in ffmpeg-worker-hls.js \
         ffmpeg-worker-hls.wasm \
         ffmpeg-worker-dash.js \
         ffmpeg-worker-dash.wasm
do
    rm "$f"
    cp "../ffmpeg.js/$f" .
done
