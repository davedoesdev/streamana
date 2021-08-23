import { GlCanvas } from './gl-canvas.js';
import {
    HLS,
    video_encoder_codec,
    videoBitsPerSecond
} from './hls.js';
import shader from './greyscale-shader.js';
import {
    supported_video_encoder_configs,
    max_video_encoder_config,
} from './resolution.js';

const target_frame_rate = 30;

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

let canvas_el = document.getElementById('canvas');
const canvas_el_parent = canvas_el.parentNode;
const canvas_proto = canvas_el.cloneNode();
const waiting_el = document.getElementById('waiting');
const error_alert_el = document.getElementById('error-alert');
const error_alert_el_parent = error_alert_el.parentNode;
const error_alert_el_nextSibling = error_alert_el.nextSibling;
error_alert_el_parent.removeChild(error_alert_el);

const ffmpeg_lib_url_el = document.getElementById('ffmpeg-lib-url');
const initial_ffmpeg_lib_url = (localStorage.getItem('streamana-ffmpeg-lib-url') || '').trim();
if (initial_ffmpeg_lib_url) {
    ffmpeg_lib_url_el.value = initial_ffmpeg_lib_url;
}
ffmpeg_lib_url_el.addEventListener('input', function () {
    localStorage.setItem('streamana-ffmpeg-lib-url', this.value);
});

const zoom_video_el = document.getElementById('zoom-video');
zoom_video_el.checked = !!localStorage.getItem('streamana-zoom-video');
zoom_video_el.addEventListener('input', function () {
    localStorage.setItem('streamana-zoom-video', this.checked ? 'true' : '');
});

const lock_portrait_el = document.getElementById('lock-portrait');
lock_portrait_el.checked = !!localStorage.getItem('streamana-lock-portrait');
lock_portrait_el.addEventListener('input', function () {
    localStorage.setItem('streamana-lock-portrait', this.checked ? 'true' : '');
});

let facing_mode = localStorage.getItem('streamana-facing-mode') || 'user';

const reset_audio_el = document.getElementById('reset-audio');
reset_audio_el.checked = !!localStorage.getItem('streamana-reset-audio');
reset_audio_el.addEventListener('change', function () {
    localStorage.setItem('streamana-reset-audio', this.checked ? 'true' : '');
});

function collapse_nav() {
    const collapse = bootstrap.Collapse.getInstance(document.getElementById('navbarToggleExternalContent'));
    if (collapse) {
        collapse.hide();
    }
}

document.body.addEventListener('click', function (ev) {
    if ((ev.target === document.body) ||
        (ev.target === canvas_el_parent) ||
        (ev.target.parentNode === canvas_el_parent)) {
        collapse_nav();
    }
});

let video_encoder_config;
let preferred_resolution = localStorage.getItem('streamana-resolution');
if (preferred_resolution) {
    video_encoder_config = await max_video_encoder_config({
        ...JSON.parse(preferred_resolution),
        codec: video_encoder_codec,
        bitrate: videoBitsPerSecond
    });
}
if (!video_encoder_config) {
    video_encoder_config =  await max_video_encoder_config({
        width: 1280,
        height: 720,
        ratio: 16/9,
        codec: video_encoder_codec,
        bitrate: videoBitsPerSecond
    });
}
const resolution_el = document.getElementById('resolution');
const video_encoder_configs = new Map();
for (let config of (await supported_video_encoder_configs({
    codec: video_encoder_codec,
    bitrate: videoBitsPerSecond
})).filter(c => c.ratio >= 1)) {
    const option = document.createElement('option');
    option.innerHTML = `${config.width}x${config.height} &mdash; ${config.label}`;
    option.selected = config.label === video_encoder_config.label;
    resolution_el.appendChild(option);
    video_encoder_configs.set(option.innerText, config);
}
resolution_el.addEventListener('change', function (ev) {
    video_encoder_config = video_encoder_configs.get(this.value);
    localStorage.setItem('streamana-resolution', JSON.stringify({
        width: video_encoder_config.width,
        height: video_encoder_config.height,
        ratio: video_encoder_config.ratio
    }));
});

const camera_swap_el = document.getElementById('camera-swap');

let hls;

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
    ingestion_url_el.disabled = true;
    ingestion_url_el.parentNode.classList.add('d-none');
    ffmpeg_lib_url_el.disabled = true;
    lock_portrait_el.disabled = true;
    zoom_video_el.disabled = true;
    reset_audio_el.disabled = true;
    resolution_el.disabled = true;
    waiting_el.classList.remove('d-none');

    collapse_nav();

    canvas_el_parent.removeChild(canvas_el);
    canvas_el = canvas_proto.cloneNode();
    canvas_el.classList.add('invisible');
    canvas_el_parent.appendChild(canvas_el);

    if (error_alert_el.parentNode) {
        error_alert_el_parent.removeChild(error_alert_el);
    }

    // get aspect ratio of encoder
    console.log(`encoder resolution: ${video_encoder_config.width}x${video_encoder_config.height}`);
    const ar_encoder = video_encoder_config.ratio;
    const ar_encoder_inv = 1/ar_encoder;

    const zoom_video = zoom_video_el.checked;
    const lock_portrait = screen.orientation.type.startsWith('portrait') && lock_portrait_el.checked;
    let video_el, audio_source, audio_dest, gl_canvas, canvas_stream, camera_stream, done = false;

    function cleanup(err) {
        if (err) {
            console.error(err);
        }
        if (done) {
            return;
        }
        done = true;
        camera_swap_el.classList.add('d-none');
        camera_swap_el.removeEventListener('click', about_face);
        canvas_el_parent.classList.add('mx-auto');
        if (lock_portrait) {
            screen.orientation.unlock();
            if (document.fullscreenElement) {
                document.exitFullscreen();
            }
        }
        if (err) {
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
        if (hls) {
            hls.end(!!err);
        }
        go_live_el.checked = false;
        go_live_el.disabled = false;
        ingestion_url_el.disabled = false;
        ingestion_url_el.parentNode.classList.remove('d-none');
        ffmpeg_lib_url_el.disabled = false;
        lock_portrait_el.disabled = false;
        zoom_video_el.disabled = false;
        reset_audio_el.disabled = false;
        resolution_el.disabled = false;
        waiting_el.classList.add('d-none');
        canvas_el.classList.add('d-none');
    }

    function update() {
        // update the canvas
        if ((video_el.videoWidth > 0) &&
            (video_el.videoHeight > 0) &&
            gl_canvas.onLoop()) {
            // get aspect ratio of video
            const ar_video = video_el.videoWidth / video_el.videoHeight;

            // Note: we need to use canvas_el_parent.parentNode.offsetWidth
            // to take into account margins
            let width, height;
            const ar_parent = canvas_el_parent.parentNode.offsetWidth /
                              canvas_el_parent.offsetHeight;
            if (lock_portrait) {
                if (zoom_video) {
                    if (ar_video < ar_encoder_inv) {
                        if (ar_parent >= ar_video) {
                            height = canvas_el_parent.offsetHeight * ar_encoder_inv;
                            width = canvas_el_parent.offsetHeight;
                        } else {
                            height = canvas_el_parent.parentNode.offsetWidth / (video_encoder_config.width * ar_video / video_encoder_config.height);
                            width = canvas_el_parent.parentNode.offsetWidth / ar_video;
                        }
                    } else if (ar_parent >= ar_video) {
                        height = canvas_el_parent.offsetHeight * ar_video;
                        width = canvas_el_parent.offsetHeight / (video_encoder_config.height / ar_video / video_encoder_config.width);
                    } else {
                        height = canvas_el_parent.parentNode.offsetWidth;
                        width = canvas_el_parent.parentNode.offsetWidth / ar_encoder_inv;
                    }
                } else if (ar_parent >= ar_encoder_inv) {
                    height = canvas_el_parent.offsetHeight * ar_encoder_inv;
                    width = canvas_el_parent.offsetHeight;
                } else {
                    height = canvas_el_parent.parentNode.offsetWidth;
                    width = canvas_el_parent.parentNode.offsetWidth / ar_encoder_inv;
                }
            } else if (zoom_video) {
                if (ar_video < ar_encoder) {
                    if (ar_parent >= ar_video) {
                        width = canvas_el_parent.offsetHeight * ar_encoder;
                        height = canvas_el_parent.offsetHeight;
                    } else {
                        width = canvas_el_parent.parentNode.offsetWidth / (video_encoder_config.height * ar_video / video_encoder_config.width);
                        height = canvas_el_parent.parentNode.offsetWidth / ar_video;
                    }
                } else if (ar_parent >= ar_video) {
                    width = canvas_el_parent.offsetHeight * ar_video;
                    height = canvas_el_parent.offsetHeight / (video_encoder_config.width / ar_video / video_encoder_config.height);
                } else {
                    width = canvas_el_parent.parentNode.offsetWidth;
                    height = canvas_el_parent.parentNode.offsetWidth / ar_encoder;
                }
            } else if (ar_parent >= ar_encoder) {
                width = canvas_el_parent.offsetHeight * ar_encoder;
                height = canvas_el_parent.offsetHeight;
            } else {
                width = canvas_el_parent.parentNode.offsetWidth;
                height = canvas_el_parent.parentNode.offsetWidth / ar_encoder;
            }
            canvas_el.style.width = `${width}px`;
            canvas_el.style.height = `${height}px`;
            // TODO:
            // chrome inspect not working
            // select which camera to use (front/rear)?
            //   test fix for going small while rotating
            //   option to switch audio as well
            //     audio source has two channels even though media stream is mono - check what's recorded
            // allow select audio and video devices
            // mute option                +
            // hide camera option         |<- these input list along with audio and video devices?
            // audio/video source option  +
            // option to mix in >1 audio?
            // scheduling (e.g. pre-roll)?
            // loop? (e.g. off-air image or video loop?)
            // check behaviour when rotate phone
            //   chrome bug when rotate (sometimes half page doesn't render)
            // performance on mobile
            // a40 no buffers currently available in the reader queue
            // windows, android, iOS, find a mac to test
        }
    }

    async function start_camera(requested_facing_mode) {
        const camera_video_constraints = {
            width: video_encoder_config.width,
            height: video_encoder_config.height,
            frameRate: {
                ideal: target_frame_rate,
                max: target_frame_rate
            },
            facingMode: requested_facing_mode
        };

        try {
            camera_stream = await navigator.mediaDevices.getUserMedia({
                audio: !audio_source,
                video: camera_video_constraints
            });
        } catch (ex) {
            if (audio_source) {
                throw ex;
            }
            // retry in case audio isn't available
            console.warn("Failed to get user media, retrying without audio");
            camera_stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: camera_video_constraints
            });
        }

        const video_settings = camera_stream.getVideoTracks()[0].getSettings();
        facing_mode = video_settings.facingMode || 'user';
        localStorage.setItem('streamana-facing-mode', facing_mode);

        // wait for video to load (must come after gl_canvas.setTexture() since it
        // registers a loadeddata handler which then registers a play handler)
        video_el.addEventListener('loadeddata', async function () {
            try {
                console.log(`video resolution: ${this.videoWidth}x${this.videoHeight}`);

                // start the camera video
                this.play();

                if (!audio_source) {
                    if (camera_stream.getAudioTracks().length > 0) {
                        // add audio if present
                        audio_source = audio_dest.context.createMediaStreamSource(camera_stream);
                    } else {
                        console.warn("No audio present, adding silence");
                        // Note: createBufferSource is supposed to be used to create silence
                        // but it doesn't keep the page active if it's hidden.
                        // Use createConstantSource instead. Since this is a constant value,
                        // it won't generate something that changes (such as a sine or sawtooth
                        // waveform) and so is inaudible. This passes the browser's silence
                        // detection, which must just check for zero values.
                        // Note: WebAudio destination stream output is bugged on Safari:
                        // https://bugs.webkit.org/show_bug.cgi?id=173863
                        // https://bugs.webkit.org/show_bug.cgi?id=198284
                        //const silence = audio_dest.context.createBufferSource();
                        audio_source = audio_dest.context.createConstantSource();
                        audio_source.start();
                    }
                    audio_source.connect(audio_dest);
                }

                await hls.start();

                camera_swap_el.addEventListener('click', about_face);
            } catch (ex) {
                cleanup(ex);
            }
        }, { once: true });

        // pass the stream from the camera to the video so it can render the frames
        video_el.srcObject = camera_stream;
    }

    function about_face() {
        camera_swap_el.removeEventListener('click', about_face);

        if (camera_stream) {
            for (let track of camera_stream.getVideoTracks()) {
                track.stop();
            }
            if (reset_audio_el.checked) {
                for (let track of camera_stream.getAudioTracks()) {
                    track.stop();
                }
                audio_source.disconnect();
                audio_source = null;
            }
        }

        start_camera(facing_mode == 'user' ? 'environment' : 'user');
    }

    try {
        // create video element which will be used for grabbing the frames to
        // write to a canvas so we can apply webgl shaders
        // also used to get the native video dimensions
        video_el = document.createElement('video');
        video_el.muted = true;
        video_el.playsInline = true;

        // Safari on iOS requires us to play() in the click handler and doesn't
        // track async calls. So we play a blank video first. After that, the video
        // element is blessed for script-driven playback.
        video_el.src = 'empty.mp4';
        await video_el.play();

        canvas_el.addEventListener('webglcontextlost', cleanup);

        // set canvas dimensions to same as encoder so its gets all the output
        canvas_el.width = video_encoder_config.width;
        canvas_el.height = video_encoder_config.height;

        // use glsl-canvas to make managing webgl stuff easier
        gl_canvas = new GlCanvas(canvas_el, {
            // as an example, greyscale the stream
            fragmentString: shader
        });

        gl_canvas.on('error', cleanup);

        // tell canvas to use frames from video
        gl_canvas.setTexture('u_texture', video_el);

        // check whether we're locking portrait mode or zooming (display without bars)
        if (lock_portrait) {
            // rotate the canvas
            canvas_el.classList.add('rotate');
            canvas_el.classList.remove('mw-100', 'mh-100');
            canvas_el_parent.classList.remove('mx-auto');

            // lock to portrait mode
            try {
                await screen.orientation.lock('portrait');
            } catch (ex) {
                if (ex.name === 'SecurityError') {
                    if (!document.fullscreenElement) {
                        await document.documentElement.requestFullscreen();
                    }
                    await screen.orientation.lock('portrait');
                } else if (ex.name !== 'NotSupportedError') {
                    throw ex;
                }
            }
        } else if (zoom_video) {
            // we're going to remove the bars for local display only
            canvas_el.classList.add('zoom');
            canvas_el.classList.remove('mw-100', 'mh-100');
            canvas_el_parent.classList.remove('mx-auto');
        }

        // if we're locked to portrait mode, tell the shader to rotate the video
        gl_canvas.setUniform('u_rotate', lock_portrait);

        // capture video from the canvas
        // Note: Safari on iOS doesn't get any data, might be related to
        // https://bugs.webkit.org/show_bug.cgi?id=181663
        //const frame_rate = video_settings.frameRate;
        canvas_stream = canvas_el.captureStream(target_frame_rate);

        // add audio to canvas stream
        audio_dest = new AudioContext().createMediaStreamDestination();
        canvas_stream.addTrack(audio_dest.stream.getAudioTracks()[0]);

        // HLS from the canvas stream to the ingestion URL
        hls = new HLS(canvas_stream, ingestion_url, ffmpeg_lib_url, target_frame_rate, lock_portrait);
        hls.addEventListener('run', () => console.log('HLS running'));
        hls.addEventListener('exit', ev => {
            const msg = `HLS exited with status ${ev.detail.code}`;
            if (ev.detail.code === 0) {
                console.log(msg);
                cleanup();
            } else {
                cleanup(msg);
            }
        });
        hls.addEventListener('error', cleanup);
        hls.addEventListener('start', function () {
            if (done) {
                this.end(true);
            }
            waiting_el.classList.add('d-none');
            if (!lock_portrait) {
                camera_swap_el.classList.remove('d-none');
            }
            canvas_el.classList.remove('invisible');
            go_live_el.disabled = false;
            update();
        });
        hls.addEventListener('update', update);

        await start_camera(facing_mode);
    } catch (ex) {
        return cleanup(ex);
    }
}

function stop() {
    go_live_el.disabled = true;
    hls.end();
}
