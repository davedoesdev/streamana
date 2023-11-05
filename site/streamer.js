import { UpdateLimiter } from './update-limiter.js';
import { MuxReceiver } from './mux-receiver.js';

const key_frame_interval = 3;

export function get_default_config_from_url(ffmpeg_lib_url) {
    const protocol = ffmpeg_lib_url.indexOf('worker-dash') >= 0 ? 'dash' : 'hls';
    return {
        ffmpeg_lib_url,
        protocol,
        video: {
            bitrate: 2500 * 1000,
            framerate: 30
        },
        audio: {
            bitrate: 128 * 1000
        },
        media_recorder: {
            video: {
                codec: protocol === 'dash' ? 'vp9' : 'H264',
            },
            audio: {
                codec: 'opus'
            },
            webm: true,
            mp4: false // requires ffmpeg-worker-hls.js or ffmpeg-worker-dash.js
                       // to be configured with MP4 support (which is not the default)
        },
        webcodecs: {
            video: {
                ...(protocol === 'dash' ? {
                    codec: 'vp09.00.10.08.01'
                } : {
                    codec: 'avc1.42E01E' /*'avc1.42001E'*/,
                    avc: { format: 'annexb' }
                })
            },
            audio: {
                codec: 'opus' /*'pcm'*/,
            },
            webm_muxer: {
                video: {
                    codec: protocol === 'dash' ? 'V_VP9' : 'V_MPEG4/ISO/AVC'
                },
                audio: {
                    codec: 'A_OPUS',
                    bit_depth: 0 // 32 for pcm */
                }
            }
        },
        ffmpeg: {
            video: {
                codec: protocol === 'dash' ? 'libvpx-vp9' : 'libx264'
            },
            audio: {
                codec: protocol === 'dash' ? 'libopus' : 'aac'
            }
        }
    };
}

export class Streamer extends EventTarget {
    constructor(stream, audio_context, base_url, config, rotate, request_options, prefer_webcodecs, poster) {
        super();
        this.stream = stream;
        this.audio_context = audio_context;
        this.base_url = base_url;
        this.config = config;
        if (rotate) {
            this.ffmpeg_metadata = ['-metadata:s:v:0', 'rotate=-90'];
        } else {
            this.ffmpeg_metadata = [];
        }
        this.request_options = request_options;
        this.update_event = new CustomEvent('update');
        this.sending = false;
        this.started = false;
        this.prefer_webcodecs = prefer_webcodecs;
        this.poster = poster;
    }

    async start() {
        if (this.started) {
            return;
        }

        const mrcfg = this.config.media_recorder;

        const mp4 = async () => {
            if (mrcfg.mp4) {
                // try MediaRecorder MP4 - this should work on Safari MacOS and iOS,
                // producing H.264 video and AAC audio
                await this.media_recorder('video/mp4');
                console.log("Using MediaRecorder MP4 (H264,aac)");
            } else {
                throw new Error('no supported encoding methods');
            }
        };

        const webcodecs = async () => {
            const wccfg = this.config.webcodecs;
            if (wccfg) {
                try {
                    // try WebCodecs - this should work on Chrome including Android
                    await this.webcodecs();
                    console.log("Using WebCodecs");
                } catch (ex) {
                    console.warn(ex);
                    await mp4();
                }
            } else {
                await mp4();
            }
        };

        if (mrcfg.webm && !this.prefer_webcodecs) {
            try {
                // try MediaRecorder WebM - this should work on Chrome Linux and Windows
                const codecs = `${mrcfg.video.codec},${mrcfg.audio.codec}`;
                await this.media_recorder(`video/webm;codecs=${codecs}`);
                console.log(`Using MediaRecorder WebM (${codecs})`);
            } catch (ex) {
                console.warn(ex);
                await webcodecs();
            }
        } else {
            await webcodecs();
        }

        this.started = true;
    }

    async start_dummy_processor() {
        // use a persistent audio generator to trigger updates to avoid setInterval throttling
        await this.audio_context.audioWorklet.addModule('./dummy-worklet.js');
        this.dummy_processor = new AudioWorkletNode(this.audio_context, 'dummy-processor', {
            processorOptions: {
                update_rate: this.config.video.framerate
            }
        });
        this.dummy_processor.onerror = onerror;
        this.dummy_processor.onprocessorerror = onerror;
        this.dummy_processor.port.onmessage = () => this.dispatchEvent(this.update_event);
        this.dummy_processor.connect(this.audio_context.destination);
    }

    stop_dummy_processor() {
        this.dummy_processor.port.postMessage({ type: 'stop' });
        this.dummy_processor.disconnect();
    }

    receiver_args(video_codec, audio_codec) {
        return {
            ffmpeg_lib_url: this.config.ffmpeg_lib_url,
            ffmpeg_args: [
                //'-loglevel', 'debug',
                '-i', '/work/stream1',
                '-map', '0:v',
                '-map', '0:a',
                '-c:v', video_codec === this.config.ffmpeg.video.codec ||
                        video_codec === 'copy' ?
                        'copy' : // pass through the video data (no decoding or encoding)
                        this.config.ffmpeg.video.codec, // re-encode video
                '-b:v', this.config.video.bitrate.toString(), // set video bitrate
                ...this.ffmpeg_metadata,
                '-c:a', audio_codec === this.config.ffmpeg.audio.codec ||
                        audio_codec === 'copy' ?
                        'copy' : // pass through the audio data
                        this.config.ffmpeg.audio.codec, // re-encode audio
                '-b:a', this.config.audio.bitrate.toString() // set audio bitrate
            ],
            base_url: 'postMessage:', //this.base_url,
            protocol: this.config.protocol,
            protocol_args: [],
            request_options: this.request_options
        };
    }

    async media_recorder(mimeType) {
        const onerror = this.onerror.bind(this);

        // set up video recording from the stream
        // note we don't start recording until ffmpeg has started (below)
        const recorder = new MediaRecorder(this.stream, {
            mimeType,
            videoBitsPerSecond: this.config.video.bitrate,
            audioBitsPerSecond: this.config.audio.bitrate
        });
        recorder.onerror = onerror;

        recorder.onstop = () => {
            if (this.receiver) {
                this.receiver.end({ force: false });
            }
        };

        // push encoded data into the ffmpeg worker
        recorder.ondataavailable = async event => {
            if (this.receiver) {
                this.receiver.muxed_data(await event.data.arrayBuffer(),
                                         { name: 'stream1' });
            }
        };

        await this.start_dummy_processor();

        let video_codec, audio_codec;
        if (recorder.mimeType === 'video/mp4') {
            video_codec = 'libx264';
            audio_codec = 'aac';
        } else {
            switch (this.config.media_recorder.video.codec.toLowerCase()) {
                case 'av1':
                    video_codec = 'libaom-av1';
                    break;

                case 'h264':
                    video_codec = 'libx264';
                    break;

                case 'vp8':
                    video_codec = 'libvpx';
                    break;

                case 'vp9':
                    video_codec = 'libvpx-vp9';
                    break;

                default:
                    video_codec = null;
                    break;
            }

            switch (this.config.media_recorder.audio.codec.toLowerCase()) {
                case 'flac':
                    audio_codec = 'flac';
                    break;

                case 'mp3':
                    audio_codec = 'libmp3lame';
                    break;

                case 'opus':
                    audio_codec = 'libopus';
                    break;

                case 'vorbis':
                    audio_codec = 'libvorbis';
                    break;

                case 'pcm':
                    audio_codec = 'f32le';
                    break;

                default:
                    if (this.config.media_recorder.audio.codec.toLowerCase().startsWith('mp4a')) {
                        audio_codec = 'aac';
                    } else {
                        audio_codec = null;
                    }
                    break;
            }
        }

        // start the ffmpeg worker
        this.receiver = new MuxReceiver();
        this.receiver.addEventListener('message', e => {
            const msg = e.detail;
            switch (msg.type) {
                case 'ready':
                    this.receiver.start(this.receiver_args(video_codec, audio_codec));
                    break;

                case 'error':
                    onerror(msg.detail);
                    break;

                case 'start-stream':
                    // start recording; produce data every second, we'll be chunking it anyway
                    recorder.start(1000);
                    this.dispatchEvent(new CustomEvent('start'));
                    break;

                case 'sending':
                    this.sending = true;
                    break;

                case 'exit':
                    this.receiver = null;
                    if (recorder.state !== 'inactive') {
                        recorder.stop();
                    }
                    this.stop_dummy_processor();
                    if ((msg.code === 'force-end') && !this.sending) {
                        msg.code = 0;
                    }
                    this.dispatchEvent(new CustomEvent(msg.type, { detail: { code: msg.code } }));
                    break;

                case 'upload':
                    msg.url = this.base_url + msg.url.split(':')[1];
                    this.poster.postMessage(msg, '*', msg.transfer);
                    break;
            }
        });
    }

    async webcodecs() {
        const onerror = this.onerror.bind(this);

        const video_track = this.stream.getVideoTracks()[0];
        const video_readable = (new MediaStreamTrackProcessor(video_track)).readable;
        const video_settings = video_track.getSettings();

        const audio_track = this.stream.getAudioTracks()[0];
        const audio_readable = (new MediaStreamTrackProcessor(audio_track)).readable;
        const audio_settings = audio_track.getSettings();

        await this.start_dummy_processor();

        let num_exits = 0;

        const relay_data = ev => {
            const msg = ev.data;
            switch (msg.type) {
                case 'error':
                    onerror(msg.detail);
                    break;

                case 'exit':
                    if (++num_exits === 2) {
                        this.worker.postMessage({
                            type: 'end'
                        });
                    }
                    break;

                case 'audio-data':
                case 'video-data':
                    this.worker.postMessage(msg, [msg.data]);
                    break;
            }
        };

        const video_worker = new Worker('./encoder-worker.js');
        video_worker.onerror = onerror;
        video_worker.onmessage = relay_data;

        const audio_worker = new Worker('./encoder-worker.js');
        audio_worker.onerror = onerror;
        audio_worker.onmessage = relay_data;

        this.worker = new Worker('./webm-worker.js');
        this.worker.onerror = onerror;
        this.worker.onmessage = e => {
            const msg = e.data;
            switch (msg.type) {
                case 'start-stream':
                    video_worker.postMessage({
                        type: 'start',
                        readable: video_readable,
                        key_frame_interval,
                        config: {
                            ...this.config.video,
                            ...this.config.webcodecs.video,
                            latencyMode: 'realtime',
                            width: video_settings.width,
                            height: video_settings.height,
                        },
                    }, [video_readable]);
                    
                    audio_worker.postMessage({
                        type: 'start',
                        audio: true,
                        readable: audio_readable,
                        config: {
                            ...this.config.audio,
                            ...this.config.webcodecs.audio,
                            sampleRate: audio_settings.sampleRate,
                            numberOfChannels: audio_settings.channelCount,
                        },
                    }, [audio_readable]);

                    this.dispatchEvent(new CustomEvent('start'));
                    break;

                case 'error':
                    onerror(msg.detail);
                    break;

                case 'sending':
                    this.sending = true;
                    break;

                case 'exit':
                    this.worker.terminate();
                    this.worker = null;
                    video_worker.terminate();
                    audio_worker.terminate();
                    this.stop_dummy_processor();
                    if ((msg.code === 'force-end') && this.was_not_sending) {
                        msg.code = 0;
                    }
                    this.dispatchEvent(new CustomEvent(msg.type, { detail: { code: msg.code } }));
                    break;

                case 'upload':
                    msg.url = this.base_url + msg.url.split(':')[1];
                    this.poster.postMessage(msg, '*', msg.transfer);
                    break;
            }
        };

        let video_codec;
        switch (this.config.webcodecs.webm_muxer.video.codec) {
            case 'V_AV1':
                video_codec = 'libaom-av1';
                break;

            case 'V_MPEG4/ISO/AVC':
                video_codec = 'libx264';
                break;

            case 'V_VP8':
                video_codec = 'libvpx';
                break;

            case 'V_VP9':
                video_codec = 'libvpx-vp9';
                break;

            default:
                video_codec = null;
                break;
        }

        let audio_codec;
        switch (this.config.webcodecs.webm_muxer.audio.codec) {
            case 'A_FLAC':
                audio_codec = 'flac';
                break;

            case 'A_MPEG/L3':
                audio_codec = 'libmp3lame';
                break;

            case 'A_OPUS':
                audio_codec = 'libopus';
                break;

            case 'A_VORBIS':
                audio_codec = 'libvorbis';
                break;

            case 'A_PCM/FLOAT/IEEE':
                audio_codec = 'f32le';
                break;

            default:
                if (this.config.webcodecs.webm_muxer.audio.codec.startsWith('A_AAC')) {
                    audio_codec = 'aac';
                } else {
                    audio_codec = null;
                }
                break;
        }

        this.worker.postMessage({
            type: 'start',
            webm_metadata: {
                max_cluster_duration: BigInt(1000000000),
                video: {
                    width: video_settings.width,
                    height: video_settings.height,
                    frame_rate: this.config.video.framerate,
                    codec_id: this.config.webcodecs.webm_muxer.video.codec
                },
                audio: {
                    sample_rate: audio_settings.sampleRate,
                    channels: audio_settings.channelCount,
                    bit_depth: this.config.webcodecs.webm_muxer.audio.bit_depth,
                    codec_id: this.config.webcodecs.webm_muxer.audio.codec
                }
            },
            webm_receiver: './mux-receiver.js',
            webm_receiver_data: { name: 'stream1' },
            ...this.receiver_args(video_codec, audio_codec)
        });
    }

    end(force) {
        this.was_not_sending = !this.sending;
        force = force || this.was_not_sending;
        if (force) {
            if (this.receiver) {
                this.receiver.end({ force });
            } else if (this.worker) {
                this.worker.postMessage({
                    type: 'end',
                    force
                });
            }
        } else {
            for (let track of this.stream.getTracks()) {
                track.stop();
            }
        }
    }

    onerror(e) {
        if (this.receiver || this.worker) {
            this.dispatchEvent(new CustomEvent('error', { detail: e }));
        }
    };
}
