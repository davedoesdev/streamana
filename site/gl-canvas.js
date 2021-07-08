// Use glsl-canvas to make managing webgl stuff easier.
import importUMD from './import-umd.js';
const { Canvas } = await importUMD('./glsl-canvas.min.js');

export class GlCanvas extends Canvas {
    constructor(canvas_el) {
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
        }));
    }
    // Allow rendering loop to be driven externally (e.g. by the audio encoder)
    // to avoid requestAnimationFrame (or indeed setInterval) throttling.
    onLoop() {
        this.checkRender();
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
    }
}
