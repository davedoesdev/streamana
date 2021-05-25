// Use glsl-canvas to make managing webgl stuff easier.
import importUMD from './import-umd.js';
const { Canvas } = await importUMD('./glsl-canvas.min.js');

export class InvisibleGlCanvas extends Canvas {
    constructor(document) {
        // Create a canvas for doing webgl
        const canvas = document.createElement('canvas');

        // Because it won't be visible, client dimensions are zero so we
        // need to substitute actual dimensions instead.
        super(new Proxy(canvas, {
            get: function (target, name, receiver) {
              if (name === 'getBoundingClientRect') {
                return () => new DOMRect(0, 0, target.width, target.height);
              }
              if (name === 'clientWidth') {
                return target.width;
              }
              if (name === 'clientHeight') {
                return target.height;
              }
              const r = target[name];
              return typeof r === 'function' ? r.bind(target) : r;
            },
            set: function (target, name, value) {
              target[name] = value;
              return true;
            }
        }));
    }

    // Use setInterval instead of requestAnimation frame so video continues
    // even when tab is hidden
    onLoop() {
        this.checkRender();
        this.siId = setInterval(() => this.checkRender(), 33);
    }
    destroy() {
        clearInterval(this.siId);
        super.destroy();
    }
}

