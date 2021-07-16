// Use glsl-canvas to make managing webgl stuff easier.
import importUMD from './import-umd.js';
import { UpdateLimiter } from './update-limiter.js';
const { Canvas } = await importUMD('./glsl-canvas.min.js');

export class GlCanvas extends Canvas {
    constructor(canvas_el, options) {
        super(new Proxy(canvas_el, {
            get: (target, name, receiver) => {
                if (name === 'getBoundingClientRect') {
                  return () => new DOMRect(0, 0, target.width, target.height);
                }
                if (name === 'clientWidth') {
                  return Math.ceil(target.width / this.devicePixelRatio);
                }
                if (name === 'clientHeight') {
                  return Math.ceil(target.height / this.devicePixelRatio);
                }
                const r = target[name];
                return typeof r === 'function' ? r.bind(target) : r;
            },
            set: (target, name, value) => {
                if ((name !== 'width') && (name !== 'height')) {
                    target[name] = value;
                }
                return true;
            }
        }), options);
        this.update_limiter = new UpdateLimiter();
    }
    // Allow rendering loop to be driven externally (e.g. by the audio encoder)
    // to avoid requestAnimationFrame (or indeed setInterval) throttling.
    onLoop() {
        if (this.update_limiter.check()) {
            const now = Date.now();
            this.checkRender();
            // Make sure we don't hog the main thread. Software rendering will take
            // a lot of time (100-200ms). Alternatively, We could use createImageBitmap,
            // post the ImageBitMap to a worker and use texImage2D (via glsl-canvas)
            // to write it to an OffScreenCanvas (use canvas_el.transferControlToOffscreen).
            // However, it'd still be using software rendering and the fps would be tiny.
            // Better to "support" only hardware rendering (or very fast CPUs!), where
            // time to render each frame is only 1ms max.
            this.update_limiter.threshold = (Date.now() - now) * 2;
        }
    }
    // Prevent errors after destruction
    destroy() {
        super.destroy();
        this.uniforms = {
            createTexture() {
                return {};
            },
            create() {}
        };
        this.textures = {};
        this.buffers = {
            values: {}
        };
    }
}
