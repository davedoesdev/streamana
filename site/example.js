//import { InvisibleGlCanvas } from './gl-canvas.js';
import { safari_hack_InvisibleGlCanvas } from './gl-canvas.js';
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
const error_alert_el = document.getElementById('error-alert');
const error_alert_el_parent = error_alert_el.parentNode;
const error_alert_el_nextSibling = error_alert_el.nextSibling;
error_alert_el_parent.removeChild(error_alert_el);

const ffmpeg_lib_url_el = document.getElementById('ffmpeg-lib-url');
ffmpeg_lib_url_el.value = localStorage.getItem('streamana-ffmpeg-lib-url');
ffmpeg_lib_url_el.addEventListener('input', function (e) {
    localStorage.setItem('streamana-ffmpeg-lib-url', this.value);
});

let hls_worker;

async function start() {
    const ingestion_url = ingestion_url_el.value.trim();
    if (!ingestion_url) {
        go_live_el.checked = false;
        return;
    }
    localStorage.setItem('streamana-example-ingestion-url', ingestion_url);

    const ffmpeg_lib_url = ffmpeg_lib_url_el.value.trim() ||
                           ffmpeg_lib_url_el.placeholder.trim();

    go_live_el.disabled = true;
    waiting_el.classList.remove('d-none');

    if (error_alert_el.parentNode) {
        error_alert_el_parent.removeChild(error_alert_el);
    }

    let camera_stream, gl_canvas, canvas_stream, done = false;
    function cleanup(err) {
        if (done) {
            return;
        }
        done = true;
        if (err) {
            console.error(err);
            error_alert_el_parent.insertBefore(error_alert_el, error_alert_el_nextSibling);
            error_alert_el.classList.add('show');
        }
        if (camera_stream) {
            for (let track of camera_stream.getTracks()) {
                track.stop();
            }
        }
        if (gl_canvas) {
            gl_canvas.destroy();
        }
        if (canvas_stream) {
            for (let track of canvas_stream.getTracks()) {
                track.stop();
            }
        }
        monitor_el.srcObject = null;
        go_live_el.checked = false;
        go_live_el.disabled = false;
        waiting_el.classList.add('d-none');
    }

    try {
        // capture video from webcam
        const video_constraints = {
            width: 4096,
            height: 2160,
            frameRate: {
                ideal: 30,
                max: 30
            }
        };
        try {
            camera_stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: video_constraints
            });
        } catch (ex) {
            // retry in case audio isn't available
            console.warn("Failed to get user media, retrying without audio");
            camera_stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: video_constraints
            });
        }

        // create video element which will be used for grabbing the frames to
        // write to a canvas so we can apply webgl shaders
        // also used to get the native video dimensions
        const video = document.createElement('video');
        video.muted = true;

        // use glsl-canvas to make managing webgl stuff easier
        // because it's not visible, client dimensions are zero so we
        // need to substitute actual dimensions instead
        //gl_canvas = new InvisibleGlCanvas(document);
        gl_canvas = new (await safari_hack_InvisibleGlCanvas())(document);

        // as an example, greyscale the stream
        gl_canvas.load(shader);

        // tell canvas to use frames from video
        gl_canvas.setTexture('u_texture', video);

        // wait for video to load (must come after gl_canvas.setTexture() since it
        // registers a loadeddata handler which then registers a play handler)
        video.addEventListener('loadeddata', function () {
            try {
                // make canvas same size as native video dimensions so every pixel is seen
                gl_canvas.canvas.width = this.videoWidth;
                gl_canvas.canvas.height = this.videoHeight;

                // start the camera video
                this.play();

                // capture video from the canvas
                canvas_stream = gl_canvas.canvas.captureStream(30);

                // add audio if present
                let audio_tracks = camera_stream.getAudioTracks();
                if (audio_tracks.length === 0) {
                    // if audio isn't present, use silence
                    console.warn("No audio present, adding silence");
                    const context = new AudioContext();
                    const silence = context.createBufferSource();
                    const dest = context.createMediaStreamDestination();
                    silence.connect(dest);
                    silence.start();
                    audio_tracks = dest.stream.getAudioTracks();
                }
                canvas_stream.addTrack(audio_tracks[0]);

                // start HLS from the canvas stream to the ingestion URL
                hls_worker = new HlsWorker(canvas_stream, ingestion_url, ffmpeg_lib_url);
                hls_worker.addEventListener('run', () => console.log('HLS running'));
                hls_worker.addEventListener('exit', ev => {
                    const msg = `HLS exited with status ${ev.detail}`;
                    if (ev.detail === 0) {
                        console.log(msg);
                        cleanup();
                    } else {
                        cleanup(msg);
                    }
                });
                hls_worker.addEventListener('error', cleanup);
                hls_worker.addEventListener('abort', cleanup);
                hls_worker.addEventListener('start-video', () => {
                    // display the video locally so we can see what's going on
                    // note the video seems to set its height automatically to keep the
                    // correct aspect ratio
                    waiting_el.classList.add('d-none');
                    monitor_el.srcObject = canvas_stream;
                    monitor_el.play();
                });

                go_live_el.disabled = false;
            } catch (ex) {
                cleanup(ex);
            }
        });

        // pass the stream from the camera to the video so it can render the frames
        video.srcObject = camera_stream;
    } catch (ex) {
        return cleanup(ex);
    }
}

function stop() {
    go_live_el.disabled = true;
    hls_worker.end();
}
