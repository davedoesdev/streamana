import { GlCanvas } from './gl-canvas.js';
import {
    get_default_config_from_url,
    Streamer
} from './streamer.js';
import shader from './shader.js';
import {
    supported_video_configs,
    max_video_config,
} from './resolution.js';

import empty_video_url from './empty-video.js';
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
const error_msg_el = document.getElementById('error-msg');
const error_alert_el_parent = error_alert_el.parentNode;
const error_alert_el_nextSibling = error_alert_el.nextSibling;
error_alert_el_parent.removeChild(error_alert_el);

const ffmpeg_lib_url_el = document.getElementById('ffmpeg-lib-url');
const initial_ffmpeg_lib_url = (localStorage.getItem('streamana-ffmpeg-lib-url') || '').trim();
if (initial_ffmpeg_lib_url) {
    ffmpeg_lib_url_el.value = initial_ffmpeg_lib_url;
}
ffmpeg_lib_url_el.addEventListener('change', function () {
    localStorage.setItem('streamana-ffmpeg-lib-url', this.value.trim());
    set_ingestion();
});

const zoom_video_el = document.getElementById('zoom-video');
zoom_video_el.checked = !!localStorage.getItem('streamana-zoom-video');
zoom_video_el.addEventListener('change', function () {
    localStorage.setItem('streamana-zoom-video', this.checked ? 'true' : '');
});

const lock_portrait_el = document.getElementById('lock-portrait');
lock_portrait_el.checked = !!localStorage.getItem('streamana-lock-portrait');
lock_portrait_el.addEventListener('change', function () {
    localStorage.setItem('streamana-lock-portrait', this.checked ? 'true' : '');
});

const greyscale_el = document.getElementById('greyscale');
greyscale_el.checked = !!localStorage.getItem('streamana-greyscale');
greyscale_el.addEventListener('change', function () {
    localStorage.setItem('streamana-greyscale', this.checked ? 'true' : '');
});

let facing_mode = localStorage.getItem('streamana-facing-mode') || 'user';

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

const mic_el = document.getElementById('mic');
const mic_icon_el = document.getElementById('mic-icon');
if (!!localStorage.getItem('streamana-mic-on')) {
    mic_icon_el.classList.remove('off');
}
mic_el.addEventListener('click', function () {
    mic_icon_el.classList.toggle('off');
});
function mic_save() {
    localStorage.setItem('streamana-mic-on', mic_icon_el.classList.contains('off') ? '' : 'true');
}
mic_el.addEventListener('click', mic_save);

const camera_el = document.getElementById('camera');
const camera_icon_el = document.getElementById('camera-icon');
if (!!localStorage.getItem('streamana-camera-on')) {
    camera_icon_el.classList.remove('off');
}
camera_el.addEventListener('click', function () {
    camera_icon_el.classList.toggle('off');
});
function camera_save() {
    localStorage.setItem('streamana-camera-on', camera_icon_el.classList.contains('off') ? '' : 'true');
}
camera_el.addEventListener('click', camera_save);

const camera_swap_el = document.getElementById('camera-swap');

const ingestion_url_el = document.getElementById('ingestion-url');
const protocol_hls_el = document.getElementById('protocol-hls');
const protocol_dash_el = document.getElementById('protocol-dash');
const request_post_el = document.getElementById('request-post');
const request_put_el = document.getElementById('request-put');
const request_cors_el = document.getElementById('request-cors');
const request_no_cors_el = document.getElementById('request-no-cors');
const request_same_origin_el = document.getElementById('request-same-origin');
const resolution_el = document.getElementById('resolution');
const prefer_mediarecorder_el = document.getElementById('prefer-mediarecorder');
const prefer_webcodecs_el = document.getElementById('prefer-webcodecs');

if (localStorage.getItem('streamana-request-method') === 'PUT') {
    request_put_el.checked = true;
    request_no_cors_el.disabled = true;
} else {
    request_post_el.checked = true;
}

switch (localStorage.getItem('streamana-request-mode')) {
    case 'cors':
        request_cors_el.checked = true;
        break;
    case 'same-origin':
        request_same_origin_el.checked = true;
        break;
    default:
        request_no_cors_el.checked = true;
        request_put_el.disabled = true;
        break;
}

function request_save() {
    localStorage.setItem(`streamana-${this.name}`, this.value);
    request_put_el.disabled = request_no_cors_el.checked;
    request_no_cors_el.disabled = request_put_el.checked;
}
request_put_el.addEventListener('change', request_save);
request_post_el.addEventListener('change', request_save);
request_cors_el.addEventListener('change', request_save);
request_no_cors_el.addEventListener('change', request_save);
request_same_origin_el.addEventListener('change', request_save);

function encoder_preference_save() {
    localStorage.setItem('streamana-encoder-preference', this.value);
}
prefer_mediarecorder_el.addEventListener('change', encoder_preference_save);
prefer_webcodecs_el.addEventListener('change', encoder_preference_save);

if (localStorage.getItem('streamana-encoder-preference') === 'webcodecs') {
    prefer_webcodecs_el.checked = true;
} else {
    prefer_mediarecorder_el.checked = true;
}

const poster_el = document.getElementById('poster');

let streamer_config;
let video_config;
const video_configs = new Map();

function set_ingestion_protocol(protocol) {
    if (protocol === 'dash') {
        protocol_hls_el.checked = false;
        protocol_dash_el.checked = true;
        ffmpeg_lib_url_el.placeholder = protocol_dash_el.value;
    } else {
        protocol_hls_el.checked = true;
        protocol_dash_el.checked = false;
        ffmpeg_lib_url_el.placeholder = protocol_hls_el.value;
    }
}

set_ingestion_protocol(localStorage.getItem('streamana-ingestion-protocol'));

protocol_hls_el.addEventListener('change', function () {
    ffmpeg_lib_url_el.placeholder = protocol_hls_el.value;
    set_ingestion();
});

protocol_dash_el.addEventListener('change', function () {
    ffmpeg_lib_url_el.placeholder = protocol_dash_el.value;
    set_ingestion();
});

resolution_el.addEventListener('change', function () {
    video_config = video_configs.get(this.value);
    localStorage.setItem('streamana-resolution', JSON.stringify({
        width: video_config.width,
        height: video_config.height,
        ratio: video_config.ratio
    }));
});

const busy_el = document.getElementById('busy');

async function set_ingestion() {
    busy_el.classList.remove('d-none');

    try {
        const ffmpeg_lib_url = ffmpeg_lib_url_el.value.trim() ||
                               ffmpeg_lib_url_el.placeholder.trim();

        const protocol = streamer_config ? streamer_config.protocol : null;
        streamer_config = get_default_config_from_url(ffmpeg_lib_url);

        set_ingestion_protocol(streamer_config.protocol);
        localStorage.setItem('streamana-ingestion-protocol', streamer_config.protocol);

        if (ffmpeg_lib_url_el.value.trim()) {
            protocol_hls_el.disabled = true;
            protocol_dash_el.disabled = true;
        } else {
            protocol_hls_el.disabled = false;
            protocol_dash_el.disabled = false;
        }

        if (streamer_config.protocol !== protocol) {
            ingestion_url_el.value = (localStorage.getItem(
                streamer_config.protocol === 'dash' ?
                    'streamana-dash-ingestion-url' :
                    'streamana-hls-ingestion-url') || '').trim();
        }

        video_config = null;
        let preferred_resolution = localStorage.getItem('streamana-resolution');
        if (preferred_resolution) {
            video_config = await max_video_config({
                ...JSON.parse(preferred_resolution),
                ...streamer_config.video,
                ...streamer_config.webcodecs.video
            }, true);
        }
        if (!video_config) {
            video_config =  await max_video_config({
                width: 1280,
                height: 720,
                ratio: 16/9,
                ...streamer_config.video,
                ...streamer_config.webcodecs.video
            }, true);
        }

        const configs = (await supported_video_configs({
            ...streamer_config.video,
            ...streamer_config.webcodecs.video
        }, true)).filter(c => c.ratio >= 1);

        resolution_el.innerHTML = '';

        for (let config of configs) {
            const option = document.createElement('option');
            option.innerHTML = `${config.width}x${config.height} &mdash; ${config.label}`;
            option.selected = video_config && (config.label === video_config.label);
            resolution_el.appendChild(option);
            video_configs.set(option.innerText, config);
        }
    } finally {
        busy_el.classList.add('d-none');
    }
}

await set_ingestion();

document.body.classList.remove('d-none');
document.documentElement.classList.remove('busy');

let streamer, audio_context;

async function start() {
    const ingestion_url = ingestion_url_el.value.trim();
    if (!ingestion_url) {
        console.error('No ingestion URL');

        error_msg_el.innerText = "Please enter an ingestion URL";
        error_alert_el_parent.insertBefore(error_alert_el, error_alert_el_nextSibling);
        error_alert_el.classList.add('show');

        go_live_el.checked = false;
        return;
    }
    localStorage.setItem(
        streamer_config.protocol === 'dash' ? 'streamana-dash-ingestion-url' :
                                              'streamana-hls-ingestion-url',
        ingestion_url);

    if (!video_config) {
        console.error('No video config');
        go_live_el.checked = false;
        return;
    }

    const ffmpeg_lib_url = ffmpeg_lib_url_el.value.trim() ||
                           ffmpeg_lib_url_el.placeholder.trim();

    const method = request_put_el.checked ? request_put_el.value : request_post_el.value;
    const mode = request_cors_el.checked ? request_cors_el.value :
                 request_same_origin_el.checked ? request_same_origin_el.value :
                 request_no_cors_el.value;

    go_live_el.disabled = true;
    ingestion_url_el.disabled = true;
    ingestion_url_el.parentNode.classList.add('d-none');
    ffmpeg_lib_url_el.disabled = true;
    lock_portrait_el.disabled = true;
    zoom_video_el.disabled = true;
    resolution_el.disabled = true;
    protocol_hls_el.disabled = true;
    protocol_dash_el.disabled = true;
    request_post_el.disabled = true;
    request_put_el.disabled = true;
    request_cors_el.disabled = true;
    request_no_cors_el.disabled = true;
    request_same_origin_el.disabled = true;
    prefer_mediarecorder_el.disabled = true;
    prefer_webcodecs_el.disabled = true;
    waiting_el.classList.remove('d-none');
    mic_el.removeEventListener('click', mic_save);
    camera_el.removeEventListener('click', camera_save);

    collapse_nav();

    canvas_el_parent.removeChild(canvas_el);
    canvas_el = canvas_proto.cloneNode();
    canvas_el.classList.add('invisible');
    canvas_el_parent.appendChild(canvas_el);

    if (error_alert_el.parentNode) {
        error_alert_el_parent.removeChild(error_alert_el);
    }

    // get video config aspect ratio
    console.log(`video config resolution: ${video_config.width}x${video_config.height}`);
    const ar_config = video_config.ratio;
    const ar_config_inv = 1/ar_config;

    const zoom_video = zoom_video_el.checked;
    const lock_portrait = /*screen.orientation.type.startsWith('portrait') &&*/ lock_portrait_el.checked;
    let video_el, video_track, silence, audio_source, audio_dest, gl_canvas, canvas_stream, done = false;

    function cleanup(err) {
        if (err) {
            console.error(err);
        }
        if (done) {
            return;
        }
        done = true;
        mic_el.removeEventListener('click', media_toggle);
        if (!!localStorage.getItem('streamana-mic-on')) {
            mic_icon_el.classList.remove('off');
        } else {
            mic_icon_el.classList.add('off');
        }
        mic_el.addEventListener('click', mic_save);
        camera_el.removeEventListener('click', media_toggle);
        if (!!localStorage.getItem('streamana-camera-on')) {
            camera_icon_el.classList.remove('off');
        } else {
            camera_icon_el.classList.add('off');
        }
        camera_el.addEventListener('click', camera_save);
        greyscale_el.removeEventListener('change', greyscale);
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
            error_msg_el.innerText = typeof err === 'string' ? err : err.message || err.detail;
            error_alert_el_parent.insertBefore(error_alert_el, error_alert_el_nextSibling);
            error_alert_el.classList.add('show');
        }
        if (audio_source) {
            if (audio_source.mediaStream) {
                for (let track of audio_source.mediaStream.getAudioTracks()) {
                    track.stop();
                }
            }
            audio_source.disconnect();
        }
        if (audio_dest) {
            if (audio_dest.stream) {
                for (let track of audio_dest.stream.getAudioTracks()) {
                    track.stop();
                }
            }
            audio_dest.disconnect();
        }
        if (silence) {
            silence.stop();
        }
        if (audio_context) {
            // Chrome doesn't GC AudioContexts so reuse a single instance.
            audio_context.suspend();
        }
        if (video_track) {
            video_track.stop();
        }
        if (gl_canvas) {
            gl_canvas.destroy();
        }
        if (canvas_stream) {
            for (let track of canvas_stream.getTracks()) {
                track.stop();
            }
        }
        if (streamer) {
            streamer.end(!!err);
            streamer = null;
        }

        go_live_el.checked = false;
        go_live_el.disabled = false;
        ingestion_url_el.disabled = false;
        ingestion_url_el.parentNode.classList.remove('d-none');
        ffmpeg_lib_url_el.disabled = false;
        lock_portrait_el.disabled = false;
        zoom_video_el.disabled = false;
        resolution_el.disabled = false;
        protocol_hls_el.disabled = ffmpeg_lib_url_el.value.trim();
        protocol_dash_el.disabled = ffmpeg_lib_url_el.value.trim();;
        request_post_el.disabled = false;
        request_put_el.disabled = request_no_cors_el.checked;
        request_cors_el.disabled = false;
        request_no_cors_el.disabled = request_put_el.checked;
        request_same_origin_el.disabled = false;
        prefer_mediarecorder_el.disabled = false;
        prefer_webcodecs_el.disabled = false;
        waiting_el.classList.add('d-none');
        canvas_el.classList.add('d-none');
    }

    function update() {
        // update the canvas
        if (!video_track) {
            gl_canvas.onLoop();
        } else if ((video_el.videoWidth > 0) &&
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
                    if (ar_video < ar_config_inv) {
                        if (ar_parent >= ar_video) {
                            height = canvas_el_parent.offsetHeight * ar_config_inv;
                            width = canvas_el_parent.offsetHeight;
                        } else {
                            height = canvas_el_parent.parentNode.offsetWidth / (video_config.width * ar_video / video_config.height);
                            width = canvas_el_parent.parentNode.offsetWidth / ar_video;
                        }
                    } else if (ar_parent >= ar_video) {
                        height = canvas_el_parent.offsetHeight * ar_video;
                        width = canvas_el_parent.offsetHeight / (video_config.height / ar_video / video_config.width);
                    } else {
                        height = canvas_el_parent.parentNode.offsetWidth;
                        width = canvas_el_parent.parentNode.offsetWidth / ar_config_inv;
                    }
                } else if (ar_parent >= ar_config_inv) {
                    height = canvas_el_parent.offsetHeight * ar_config_inv;
                    width = canvas_el_parent.offsetHeight;
                } else {
                    height = canvas_el_parent.parentNode.offsetWidth;
                    width = canvas_el_parent.parentNode.offsetWidth / ar_config_inv;
                }
            } else if (zoom_video) {
                if (ar_video < ar_config) {
                    if (ar_parent >= ar_video) {
                        width = canvas_el_parent.offsetHeight * ar_config;
                        height = canvas_el_parent.offsetHeight;
                    } else {
                        width = canvas_el_parent.parentNode.offsetWidth / (video_config.height * ar_video / video_config.width);
                        height = canvas_el_parent.parentNode.offsetWidth / ar_video;
                    }
                } else if (ar_parent >= ar_video) {
                    width = canvas_el_parent.offsetHeight * ar_video;
                    height = canvas_el_parent.offsetHeight / (video_config.width / ar_video / video_config.height);
                } else {
                    width = canvas_el_parent.parentNode.offsetWidth;
                    height = canvas_el_parent.parentNode.offsetWidth / ar_config;
                }
            } else if (ar_parent >= ar_config) {
                width = canvas_el_parent.offsetHeight * ar_config;
                height = canvas_el_parent.offsetHeight;
            } else {
                width = canvas_el_parent.parentNode.offsetWidth;
                height = canvas_el_parent.parentNode.offsetWidth / ar_config;
            }
            canvas_el.style.width = `${width}px`;
            canvas_el.style.height = `${height}px`;
        }
    }

    async function start_media(requested_facing_mode) {
        mic_el.removeEventListener('click', media_toggle);
        camera_el.removeEventListener('click', media_toggle);
        camera_swap_el.removeEventListener('click', about_face);

        async function finish() {
            await streamer.start();
            mic_el.addEventListener('click', media_toggle);
            camera_el.addEventListener('click', media_toggle);
            camera_swap_el.addEventListener('click', about_face);
        }

        const need_audio = !mic_icon_el.classList.contains('off');
        const need_video = !camera_icon_el.classList.contains('off');

        stop_media(need_audio, need_video && (requested_facing_mode === facing_mode));

        if (!need_audio && !need_video) {
            return await finish();
        }

        const camera_video_constraints = {
            width: video_config.width,
            height: video_config.height,
            frameRate: {
                ideal: streamer_config.video.framerate,
                max: streamer_config.video.framerate
            },
            facingMode: requested_facing_mode
        };

        let media_stream;
        try {
            media_stream = await navigator.mediaDevices.getUserMedia({
                audio: need_audio,
                video: need_video ? camera_video_constraints : false
            });
        } catch (ex) {
            console.warn(`Failed to get user media (need_audio=${need_audio} need_video=${need_video})`);
            console.error(ex);
            if (need_audio && need_video) {
                console.warn("Retrying with only video");
                try {
                    media_stream = await navigator.mediaDevices.getUserMedia({
                        audio: false,
                        video: camera_video_constraints
                    });
                } catch (ex) {
                    console.warn('Failed to get user video, retrying with only audio');
                    console.error(ex);
                    try {
                        media_stream = await navigator.mediaDevices.getUserMedia({
                            audio: true,
                            video: false
                        });
                    } catch (ex) {
                        console.warn('Failed to get user audio');
                        console.error(ex);
                    }
                }
            }
        }

        function set_media(audio_tracks, video_tracks) {
            stop_media(false, false);

            if (need_audio) {
                if (audio_tracks.length > 0) {
                    audio_source.disconnect();
                    audio_source = audio_dest.context.createMediaStreamSource(media_stream);
                    audio_source.connect(audio_dest);
                } else {
                    console.warn("No audio present, using silence");
                    mic_icon_el.classList.add('off');
                }
            }

            if (need_video) {
                if (video_tracks.length > 0) {
                    video_track = video_tracks[0];
                    facing_mode = video_track.getSettings().facingMode || 'user';
                    localStorage.setItem('streamana-facing-mode', facing_mode);
                    gl_canvas.setUniform('u_active', true);
                } else {
                    console.warn("No video present, using blank frames");
                    camera_icon_el.classList.add('off');
                }
            }

            finish();
        }

        if (!media_stream) {
            return set_media([], []);
        }

        // wait for stream to load (must come after gl_canvas.setTexture() since it
        // registers a loadeddata handler which then registers a play handler)
        video_el.addEventListener('loadeddata', function () {
            try {
                console.log(`video resolution: ${this.videoWidth}x${this.videoHeight}`);

                // start the stream
                this.play();

                set_media(media_stream.getAudioTracks(), media_stream.getVideoTracks());
            } catch (ex) {
                cleanup(ex);
            }
        }, { once: true });

        // pass the stream from the camera to the video so it can render the frames
        video_el.srcObject = media_stream;
    }

    function stop_media(need_audio, need_video) {
        if ((audio_source !== silence) && !need_audio) {
            if (audio_source.mediaStream) {
               for (let track of audio_source.mediaStream.getAudioTracks()) {
                    track.stop();
                }
            }
            audio_source.disconnect();
            audio_source = silence;
            audio_source.connect(audio_dest);
        }

        if (video_track && !need_video) {
            video_track.stop();
            video_track = null;
            gl_canvas.setUniform('u_active', false);
        }
    }

    function about_face() {
        start_media(facing_mode == 'user' ? 'environment' : 'user');
    }

    function media_toggle() {
        start_media(facing_mode);
    }

    function greyscale() {
        gl_canvas.setUniform('u_greyscale', this.checked);
    }

    try {
        if (!audio_context) {
            audio_context = new AudioContext();
        }

        try {
            audio_context.resume();
        } catch {
            // Safari requires us to create and resume an AudioContext
            // in the click handler and doesn't track async calls.
            audio_context.close();
            audio_context = new AudioContext();
            audio_context.resume();
        }

        // create video element which will be used for grabbing the frames to
        // write to a canvas so we can apply webgl shaders
        // also used to get the native video dimensions
        video_el = document.createElement('video');
        video_el.muted = true;
        video_el.playsInline = true;
        video_el.crossOrigin = "anonymous";

        // Safari on iOS requires us to play() in the click handler and doesn't
        // track async calls. So we play a blank video first. After that, the video
        // element is blessed for script-driven playback.
        video_el.src = empty_video_url;
        await video_el.play();

        canvas_el.addEventListener('webglcontextlost', cleanup);

        // set canvas dimensions to same as video config so its gets all the output
        canvas_el.width = video_config.width;
        canvas_el.height = video_config.height;

        // use glsl-canvas to make managing webgl stuff easier
        gl_canvas = new GlCanvas(canvas_el, {
            fragmentString: shader
        });

        gl_canvas.on('error', cleanup);

        // tell canvas to use frames from video
        gl_canvas.setTexture('u_texture', video_el);

        // tell shader whether to greyscale
        gl_canvas.setUniform('u_greyscale', greyscale_el.checked);
        greyscale_el.addEventListener('change', greyscale);

        // tell shader camera hasn't started
        gl_canvas.setUniform('u_active', false);

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
        canvas_stream = canvas_el.captureStream(streamer_config.video.framerate);

        // add audio to canvas stream
        audio_dest = audio_context.createMediaStreamDestination();
        canvas_stream.addTrack(audio_dest.stream.getAudioTracks()[0]);

        // Note: createBufferSource is supposed to be used to create silence
        // but it doesn't keep the page active if it's hidden.
        // Use createConstantSource instead. Since this is a constant value,
        // it won't generate something that changes (such as a sine or sawtooth
        // waveform) and so is inaudible. This passes the browser's silence
        // detection, which must just check for zero values.
        // Note: WebAudio destination stream output is bugged on Safari:
        // https://bugs.webkit.org/show_bug.cgi?id=173863
        // https://bugs.webkit.org/show_bug.cgi?id=198284
        //silence = audio_dest.context.createBufferSource();
        silence = audio_dest.context.createConstantSource();
        silence.start();
        audio_source = silence;
        audio_source.connect(audio_dest);

        // Stream from the canvas stream to the ingestion URL
        streamer = new Streamer(canvas_stream,
                                audio_context,
                                ingestion_url,
                                streamer_config,
                                lock_portrait,
                                { method, mode },
                                prefer_webcodecs_el.checked,
                                poster_el.contentWindow);
        streamer.addEventListener('run', () => console.log('Streamer running'));
        streamer.addEventListener('exit', ev => {
            const msg = `Streamer exited with status ${ev.detail.code}`;
            if (ev.detail.code === 0) {
                console.log(msg);
                cleanup();
            } else {
                cleanup(msg);
            }
        });
        streamer.addEventListener('error', cleanup);
        streamer.addEventListener('start', function () {
            if (done) {
                this.end(true);
            }
            waiting_el.classList.add('d-none');
            camera_swap_el.classList.remove('d-none');
            canvas_el.classList.remove('invisible');
            go_live_el.disabled = false;
            update();
        });
        streamer.addEventListener('update', update);

        await start_media(facing_mode);
    } catch (ex) {
        return cleanup(ex);
    }
}

function stop() {
    go_live_el.disabled = true;
    streamer.end();
}
