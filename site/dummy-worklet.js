import { UpdateLimiter } from './update-limiter.js';

class DummyProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super(options);
        this.stopped = false;
        this.port.onmessage = () => this.stopped = true;
        this.update_limiter = new UpdateLimiter(options.processorOptions.update_rate);
    }

    process() {
        if (this.stopped) {
            return false;
        }
        if (this.update_limiter.check()) {
            this.port.postMessage({ type: 'update' });
        }
        return true;
    }
}

registerProcessor('dummy-processor', DummyProcessor);
