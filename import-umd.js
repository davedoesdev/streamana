// https://stackoverflow.com/a/64721256
export default async url => {
    const r = await fetch(url);
    const src = await r.text();
    const f = new Function('module', 'exports', src);
    const module = { exports: {} };
    f.call(module, module, module.exports);
    return module.exports;
};
