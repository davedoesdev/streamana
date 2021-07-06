let ffmpeg_worker;
let ffmpeg_args;
let base_url;

function onerror(e) {
    if (ffmpeg_worker) {
        console.error(e);
        self.postMessage({
            type: 'error',
            detail: e
        });
    }
}

function ffmpeg_onmessage(e) {
    const msg = e.data;
    switch (msg.type) {
        case 'ready':
            this.postMessage({
                type: 'run',
                arguments: [
                    '-loglevel', 'debug',
                    ...ffmpeg_args,
                    '-f', 'hls', // use hls encoder
                    '-hls_time', '2', // 2 second HLS chunks
                    '-hls_segment_type', 'mpegts', // MPEG2-TS muxer
                    '-hls_list_size', '2', // two chunks in the list at a time
                    '-hls_flags', 'split_by_time',
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
        case 'error':
        case 'abort':
            onerror(msg.data);
            break;
        case 'start-stream':
            this.postMessage({
                type: 'base-url',
                data: base_url
            });
            self.postMessage(msg);
            break;
        case 'exit':
            ffmpeg_worker = null;
            self.postMessage({ type: msg.type, code: msg.data });
            break;
    }
}

onmessage = function (e) {
    const msg = e.data;
    switch (msg.type) {
        case 'start':
            ({ ffmpeg_args, base_url } = msg);
            ffmpeg_worker = new Worker(msg.ffmpeg_lib_url);
            ffmpeg_worker.onerror = onerror;
            ffmpeg_worker.onmessage = ffmpeg_onmessage;
            break;
        case 'end':
            if (ffmpeg_worker) {
                if (msg.force) {
                    ffmpeg_worker.terminate();
                    self.postMessage({
                        type: 'exit'
                    });
                } else {
                    ffmpeg_worker.postMessage({
                        type: 'stream-end'
                    });
                }
                ffmpeg_worker = null;
            }
            break;
        case 'muxed-data':
            if (ffmpeg_worker) {
                ffmpeg_worker.postMessage({
                    type: 'stream-data',
                    name: msg.name,
                    data: msg.data
                }, [msg.data]);
            }
            break;
    }
};

self.postMessage({ type: 'ready' });
