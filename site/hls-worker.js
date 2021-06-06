const audioBitsPerSecond = 128 * 1000;
const videoBitsPerSecond = 2500 * 1000;

export class HlsWorker extends EventTarget {
    constructor(stream, ingestion_url, ffmpeg_lib_url) {
        super();

        let exited = false;
        onerror = e => {
            if (!exited) {
                this.dispatchEvent(new CustomEvent('error', { detail: e }));
            }
        };

        // if audio isn't present, add a silent track
        if (stream.getAudioTracks().length === 0) {
            console.warn("No audio present, adding silence");
            const context = new AudioContext({
                sampleRate: audioBitsPerSecond
            });
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
            stream.addTrack(dest.stream.getAudioTracks()[0]);
        }

        // we should use VideoEncoder and AudioEncoder
        // push data into worker, we'll need to be able to handle separate streams
        // have a /inbound and async read from 2 files on there via queues
        // - fd 3 and 4 should be
        // start by implementing this for current system
        // chrome supports mp4a.40.2  (AAC LC) and  avc1.42001E (H264)
        // so we can passthru both and don't need any codecs hopefully
        //console.log(stream.getVideoTracks()[0].width, stream.getVideoTracks()[1].height);

        // set up video recording from the stream
        // note we don't start recording until ffmpeg has started (below)
        let recorder;
        try {
            recorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=H264',
                audioBitsPerSecond,
                videoBitsPerSecond
            });
        } catch (ex) {
            // on Safari only MP4 is available, assume ffmpeg.js has been configured for it
            console.warn('Failed to record WebM, falling back to MP4');
            recorder = new MediaRecorder(stream, {
                mimeType: 'video/mp4',
                audioBitsPerSecond,
                videoBitsPerSecond
            });
        }
        recorder.onerror = onerror;

        // push encoded data into the ffmpeg worker
        recorder.ondataavailable = async event => {
            const data = await event.data.arrayBuffer();
            this.worker.postMessage({
                type: 'video-data',
                name: 'stream1',
                data
            }, [data]);
        };

        // start ffmpeg in a Web Worker
        this.worker = new Worker(ffmpeg_lib_url);
        this.worker.onerror = onerror;
        this.worker.onmessage = e => {
            const msg = e.data;
            switch (msg.type) {
                case 'ready':
                    this.worker.postMessage({
                        type: 'run',
                        arguments: [
                            '-i', '/work/stream1', // fd 3 in worker
                            '-f', 'hls', // use hls encoder
                            '-c:v', 'copy', // pass through the video data (h264, no decoding or encoding)
                            ...(recorder.mimeType === 'video/mp4' ?
                                ['-c:a', 'copy'] : // assume already AAC
                                ['-c:a', 'aac',  // re-encode audio as AAC-LC
                                 '-b:a', '128k']), // set audio bitrate
                            '-hls_time', '2', // 2 second HLS chunks
                            '-hls_segment_type', 'mpegts', // MPEG2-TS muxer
                            '-hls_list_size', '2', // two chunks in the list at a time
                            '/outbound/output.m3u8' // path to media playlist file in virtual FS,
                                                    // must be under /outbound
                        ],
                        MEMFS: [
                            { name: 'stream1' },
                            { name: 'stream2' }
                        ]
                    });
                    break;
                case 'stdout':
                    console.log(msg.data);
                    break;
                case 'stderr':
                    console.error(msg.data);
                    break;
                case 'start-video':
                    this.worker.postMessage({
                        type: 'base-url',
                        data: ingestion_url
                    });
                    // start recording; produce data every second, we'll be chunking it anyway
                    recorder.start(1000);
                    break;
                case 'exit':
                    exited = true;
                    this.worker.terminate();
                    if (recorder.state !== 'inactive') {
                        recorder.stop();
                    }
                    break;
            }
            this.dispatchEvent(new CustomEvent(msg.type, { detail: msg.data }));
        };
    }

    end() {
        this.worker.postMessage({
            type: 'video-ended'
        });
    }
}
