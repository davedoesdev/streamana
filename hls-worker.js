export class HlsWorker extends EventTarget {
    constructor(stream_url) {
        super();
        this.worker = new Worker('ffmpeg.js/ffmpeg-worker-hls.js');
        this.worker.onmessage = e => {
            const msg = e.data;
            switch (msg.type) {
                case 'ready':
                    this.worker.postMessage({
                        type: 'run',
                        arguments: [
                            '-i', '-', // our worker will simulate stdin
                            '-f', 'hls', // use hls encoder
                            '-c:v', 'copy', // pass through the video data (h264, no decoding or encoding)
                            '-c:a', 'aac',  // re-encode audio as AAC-LC
                            '-b:a', '128k', // set audio bitrate
                            '-hls_time', '2', // 2 second HLS chunks
                            '-hls_segment_type', 'mpegts', // MPEG2-TS muxer
                            '-hls_list_size', '2', // two chunks in the list at a time
                            '/outbound/output.m3u8' // path to media playlist file in virtual FS,
                                                    // must be under /outbound
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
                        data: stream_url
                    });
                    break;
                case 'exit':
                    this.worker.terminate();
                    break;
            }
            this.dispatchEvent(new CustomEvent(msg.type, { detail: msg.data }));
        };
    }

    write(data) {
        this.worker.postMessage({
            type: 'video-data',
            data
        }, [data]);
    }

    end() {
        this.worker.postMessage({
            type: 'video-ended'
        });
    }
}
