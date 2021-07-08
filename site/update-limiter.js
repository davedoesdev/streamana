export class UpdateLimiter {
    constructor(nps) {
        this.threshold = 1000/nps;
        this.last = 0;
    }

    check() {
        const now = Date.now();
        if ((now - this.last) >= this.threshold) {
            this.last = now;
            return true;
        }
        return false;
    }
}
