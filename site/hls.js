import { UpdateLimiter } from './update-limiter.js';
import { MuxReceiver } from './mux-receiver.js';

const audioBitsPerSecond = 128 * 1000;
const videoBitsPerSecond = 2500 * 1000;
const key_frame_interval = 3;

export class HLS extends EventTarget {
    constructor(stream, base_url, ffmpeg_lib_url, frame_rate, portrait) {
        super();
        this.stream = stream;
        this.base_url = base_url;
        this.ffmpeg_lib_url = ffmpeg_lib_url;
        this.frame_rate = frame_rate;
        this.portrait = portrait;
        this.update_event = new CustomEvent('update');
    }

    async start() {
        // if audio isn't present, add a silent track
        if (this.stream.getAudioTracks().length === 0) {
            console.warn("No audio present, adding silence");
            const context = new AudioContext();
            // Note: createBufferSource is supposed to be used
            // to create silence but it doesn't keep the page active
            // if it's hidden. Use createConstantSource instead.
            // Since this is a constant value, it won't generate
            // something that changes (such as a sine or sawtooth
            // waveform) and so is inaudible. This passes the
            // browser's silence detection, which must just check
            // for zero values.
            // Note: WebAudio destination stream output is bugged
            // on Safari:
            // https://bugs.webkit.org/show_bug.cgi?id=173863
            // https://bugs.webkit.org/show_bug.cgi?id=198284
            //const silence = context.createBufferSource();
            const silence = context.createConstantSource();
            const dest = context.createMediaStreamDestination();
            silence.connect(dest);
            silence.start();
            this.stream.addTrack(dest.stream.getAudioTracks()[0]);
        }

        try {
            // first try WebM/H264 MediaRecorder - this should work on Chrome Linux and Windows
            await this.media_recorder('video/webm;codecs=H264');
            console.log("Using MediaRecorder WebM/h264");
        } catch (ex) {
            console.warn(ex);
            try {
                // next try WebCodecs - this should work on Chrome including Android
                this.webcodecs('avc1.42E01E' /*'avc1.42001E'*/,
                               'opus' /*'pcm'*/,
                               { avc: { format: 'annexb' } });
                console.log("Using WebCodecs");
            } catch (ex) {
                console.warn(ex);
                // finally try MP4 - this should work on Safari MacOS and iOS, producing H264
                // this assumes ffmpeg.js has been configured with MP4 support
                await this.media_recorder('video/mp4');
                console.log("Using MediaRecorder MP4");
            }
        }
    }

    async media_recorder(mimeType) {
        const onerror = this.onerror.bind(this);

        // set up video recording from the stream
        // note we don't start recording until ffmpeg has started (below)
        const recorder = new MediaRecorder(this.stream, {
            mimeType,
            audioBitsPerSecond,
            videoBitsPerSecond
        });
        recorder.onerror = onerror;

        // push encoded data into the ffmpeg worker
        recorder.ondataavailable = async event => {
            if (this.receiver) {
                this.receiver.muxed_data(await event.data.arrayBuffer(),
                                         { name: 'stream1' });
            }
        };

        // use a persistent audio generator to trigger updates to avoid setInterval throttling
        const context = new AudioContext();
        await context.audioWorklet.addModule('./dummy-worklet.js');
        const dummy_processor = new AudioWorkletNode(context, 'dummy-processor', {
            processorOptions: {
                update_rate: this.frame_rate
            }
        });
        dummy_processor.onerror = onerror;
        dummy_processor.onprocessorerror = onerror;
        dummy_processor.port.onmessage = () => this.dispatchEvent(this.update_event);
        dummy_processor.connect(context.destination);

        // start the ffmpeg worker
        this.receiver = new MuxReceiver();
        this.receiver.addEventListener('message', e => {
            const msg = e.detail;
            switch (msg.type) {
                case 'ready':
                    this.receiver.start({
                        ffmpeg_lib_url: this.ffmpeg_lib_url,
                        ffmpeg_args: [
                            '-i', '/work/stream1',
                            '-map', '0:v',
                            '-map', '0:a',
                            '-c:v', 'copy', // pass through the video data (h264, no decoding or encoding)
                            ...(recorder.mimeType === 'video/mp4' ?
                                ['-c:a', 'copy'] : // assume already AAC
                                ['-c:a', 'aac',  // re-encode audio as AAC-LC
                                 '-b:a', audioBitsPerSecond.toString()]) // set audio bitrate
                        ],
                        base_url: this.base_url
                    });
                    break;

                case 'error':
                    onerror(msg.detail);
                    break;

                case 'start-stream':
                    // start recording; produce data every second, we'll be chunking it anyway
                    recorder.start(1000);
                    this.dispatchEvent(new CustomEvent('start'));
                    break;

                case 'exit':
                    this.receiver = null;
                    if (recorder.state !== 'inactive') {
                        recorder.stop();
                    }
                    dummy_processor.port.postMessage({ type: 'stop' });
                    dummy_processor.disconnect();
                    context.suspend();
                    this.dispatchEvent(new CustomEvent(msg.type, { detail: { code: msg.code } }));
                    break;
            }
        });
    }

    webcodecs(video_codec, audio_codec, video_config, audio_config) {
        const onerror = this.onerror.bind(this);

        const video_track = this.stream.getVideoTracks()[0];
        const video_readable = (new MediaStreamTrackProcessor(video_track)).readable;
        const video_settings = video_track.getSettings();

        const audio_track = this.stream.getAudioTracks()[0];
        const audio_readable = (new MediaStreamTrackProcessor(audio_track)).readable;
        const audio_settings = audio_track.getSettings();

        const update_limiter = new UpdateLimiter(this.frame_rate);

        const relay_data = ev => {
            const msg = ev.data;
            switch (msg.type) {
                case 'error':
                    onerror(msg.detail);
                    break;

                case 'audio-data':
                    if (update_limiter.check()) {
                        this.dispatchEvent(this.update_event);
                    }
                    // falls through

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
                            codec: video_codec,
                            bitrate: videoBitsPerSecond,
                            width: video_settings.width,
                            height: video_settings.height,
                            ...video_config
                        },
                    }, [video_readable]);
                    
                    audio_worker.postMessage({
                        type: 'start',
                        audio: true,
                        readable: audio_readable,
                        config: {
                            codec: audio_codec,
                            bitrate: audioBitsPerSecond,
                            sampleRate: audio_settings.sampleRate,
                            numberOfChannels: audio_settings.channelCount,
                            ...audio_config
                        },
                    }, [audio_readable]);

                    this.dispatchEvent(new CustomEvent('start'));
                    break;

                case 'error':
                    onerror(msg.detail);
                    break;

                case 'exit':
                    this.worker.terminate();
                    this.worker = null;
                    video_worker.terminate();
                    audio_worker.terminate();
                    this.dispatchEvent(new CustomEvent(msg.type, { detail: { code: msg.code } }));
                    break;
            }
        };

        this.worker.postMessage({
            type: 'start',
            webm_metadata: {
                max_segment_duration: BigInt(1000000000),
                video: {
                    width: video_settings.width,
                    height: video_settings.height,
                    frame_rate: this.frame_rate,
                    codec_id: 'V_MPEG4/ISO/AVC'
                },
                audio: {
                    sample_rate: audio_settings.sampleRate,
                    channels: audio_settings.channelCount,
                    codec_id: 'A_OPUS'
                }
            },
            webm_receiver: './mux-receiver.js',
            webm_receiver_data: { name: 'stream1' },
            ffmpeg_lib_url: this.ffmpeg_lib_url,
            base_url: this.base_url,
            ffmpeg_args: [
                '-i', '/work/stream1',
                '-map', '0:v',
                '-map', '0:a',
                '-c:v', 'copy', // pass through the video data (h264, no decoding or encoding)
                ...(this.portrait ? ['-metadata:s:v:0', 'rotate=-90'] : []),
                '-c:a', 'aac',  // re-encode audio as AAC-LC
                '-b:a', audioBitsPerSecond.toString() // set audio bitrate
            ]
        });
    }

    end(force) {
        if (this.receiver) {
            this.receiver.end({ force });
        } else if (this.worker) {
            this.worker.postMessage({
                type: 'end',
                force
            });
        }
    }

    onerror(e) {
        if (this.receiver || this.worker) {
            this.dispatchEvent(new CustomEvent('error', { detail: e }));
        }
    };
}
