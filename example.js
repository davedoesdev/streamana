import { InvisibleGlCanvas } from './gl-canvas.js';
import { HlsWorker } from './hls-worker.js';
import shader from './greyscale-shader.js';

const ingestion_url_el = document.getElementById('ingestion-url');
ingestion_url_el.value = localStorage.getItem('streamana-example-ingestion-url');

const go_live_el = document.getElementById('go-live');
go_live_el.disabled = false;
go_live_el.addEventListener('click', function () {
    if (this.checked) {
        start();
    } else {
        stop();
    }
});

const monitor_el = document.getElementById('monitor');
const waiting_el = document.getElementById('waiting');

let hls_worker;

async function start() {
    const ingestion_url = ingestion_url_el.value.trim();
    if (!ingestion_url) {
        return;
    }
    localStorage.setItem('streamana-example-ingestion-url', ingestion_url);

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

        // start HLS from the canvas stream to the ingestion URL
        hls_worker = new HlsWorker(canvas_stream, ingestion_url);
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
            // display the video locally so we can see what's going on
            // note the video seems to set its height automatically to keep the
            // correct aspect ratio
            waiting_el.classList.add('d-none');
            monitor_el.srcObject = canvas_stream;
            monitor_el.play();
        });

        go_live_el.disabled = false;
    });

    // pass the stream from the camera to the video so it can render the frames
    video.srcObject = camera_stream;
}

function stop() {
    go_live_el.disabled = true;
    hls_worker.end();
}
