const V = new URLSearchParams(self.location.search).get('v') || '1';
importScripts('engine.js?v=' + V);
let eng = null;
self.onmessage = async (e) => {
  const { id, type, args } = e.data;
  try {
    let result;
    if (type === 'init') {
      const [idx, meta] = await Promise.all([
        fetch('data/index.txt?v=' + V).then(r => { if (!r.ok) throw new Error('index ' + r.status); return r.text(); }),
        fetch('data/shabads.json?v=' + V).then(r => { if (!r.ok) throw new Error('meta ' + r.status); return r.json(); }),
      ]);
      eng = new GEngine.Engine(idx, meta);
      result = meta;
    } else if (type === 'search') result = eng.search(args[0], args[1]);
    else if (type === 'scoreShabad') result = eng.scoreShabad(args[0], args[1]);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
