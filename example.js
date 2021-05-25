import { InvisibleGlCanvas } from './gl-canvas.js';
import { HlsWorker } from './hls-worker.js';
import shader from './greyscale-shader.js';

let stream_url_el, go_live_el, monitor_el, waiting_el, hls_worker;

window.addEventListener('load', function () {
    stream_url_el = document.getElementById('stream-url');
    go_live_el = document.getElementById('go-live');
    monitor_el = document.getElementById('monitor');
    waiting_el = document.getElementById('waiting');

    stream_url_el.value = localStorage.getItem('streamana-example-streamurl');
    go_live_el.disabled = false;

    go_live_el.addEventListener('click', function () {
        if (this.checked) {
            start();
        } else {
            stop();
        }
    });
});

async function start() {
    const stream_url = stream_url_el.value.trim();
    if (!stream_url) {
        return;
    }
    localStorage.setItem('streamana-example-streamurl', stream_url);

    go_live_el.disabled = true;
    waiting_el.classList.remove('d-none');

    // capture video from webcam
    const camera_stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
            width: 4096,
            height: 2160,
            frameRate: {
                ideal: 30,
                max: 30
            }
        }
    });

    // create video element which will be used for grabbing the frames to
    // write to a canvas so we can apply webgl shaders
    // also used to get the native video dimensions
    const video = document.createElement('video');
    video.muted = true;

    // use glsl-canvas to make managing webgl stuff easier
    // because it's not visible, client dimensions are zero so we
    // need to substitute actual dimensions instead
    const gl_canvas = new InvisibleGlCanvas(document);

    // as an example, greyscale the stream
    gl_canvas.load(shader);

    // tell canvas to use frames from video
    gl_canvas.setTexture('u_texture', video);

    // wait for video to load (must come after gl_canvas.setTexture() since it
    // registers a loadeddata handler which then registers a play handler)
    video.addEventListener('loadeddata', function () {
        // make canvas same size as native video dimensions so every pixel is seen
        gl_canvas.canvas.width = this.videoWidth;
        gl_canvas.canvas.height = this.videoHeight;

        // start the camera video
        this.play();

        // capture video from the canvas
        const canvas_stream = gl_canvas.canvas.captureStream(30);
        canvas_stream.addTrack(camera_stream.getAudioTracks()[0]);

        // set up video recording from the canvas; note we don't start
        // recording until ffmpeg has started (below)
        const recorder = new MediaRecorder(canvas_stream, {
            mimeType: 'video/webm;codecs=H264',
            audioBitsPerSecond:  128 * 1000,
            videoBitsPerSecond: 2500 * 1000
        });

        // start ffmpeg in a worker
        hls_worker = new HlsWorker(stream_url);
        hls_worker.addEventListener('run', () => console.log('HLS running'));
        hls_worker.addEventListener('exit', ev => {
            console.log('HLS exited with code', ev.detail);
            for (let track of camera_stream.getTracks()) {
                track.stop();
            }
            gl_canvas.destroy();
            for (let track of canvas_stream.getTracks()) {
                track.stop();
            }
            if (recorder.state !== 'inactive') {
                recorder.stop();
            }
            monitor_el.srcObject = null;
            go_live_el.disabled = false;
        });
        hls_worker.addEventListener('error', ev => {
            console.error('HLS errored', ev.detail);
        });
        hls_worker.addEventListener('abort', ev => {
            console.error('HLS aborted', ev.detail);
        });
        hls_worker.addEventListener('start-video', () => {
            // start recording; produce data every second, we'll be chunking it anyway
            recorder.start(1000);

            // display the video locally so we can see what's going on
            // note the video seems to set its height automatically to keep the
            // correct aspect ratio
            waiting_el.classList.add('d-none');
            monitor_el.srcObject = canvas_stream;
            monitor_el.play();
        });

        // push encoded data into the ffmpeg worker
        recorder.ondataavailable = async function (event) {
            hls_worker.write(await event.data.arrayBuffer());
        };

        go_live_el.disabled = false;
    });

    // pass the stream from the camera to the video so it can render the frames
    video.srcObject = camera_stream;
}

function stop() {
    go_live_el.disabled = true;
    hls_worker.end();
}
