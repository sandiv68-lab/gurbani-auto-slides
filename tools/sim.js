// Simulates noisy kirtan transcripts to measure the tracker.
const fs = require('fs');
const { Engine } = require('./app/engine.js');
const { Tracker } = require('./app/tracker.js');
const Skeleton = require('./app/skeleton.js');

const meta = JSON.parse(fs.readFileSync('app/data/shabads.json'));
const t0 = Date.now();
const eng = new Engine(fs.readFileSync('app/data/index.txt', 'utf8'), meta);
console.log('index built ms', Date.now() - t0);
const api = { search: async (w, o) => eng.search(w, o), scoreShabad: async (w, s) => eng.scoreShabad(w, s), weight: w => eng.weight(w) };

let seed = +(process.argv[2] || 7);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const chunkCache = {};
const shabadLines = s => {
  const ci = Math.floor(s / meta.chunk);
  chunkCache[ci] = chunkCache[ci] || JSON.parse(fs.readFileSync(`app/data/c/${ci}.json`));
  return chunkCache[ci][s % meta.chunk];
};
const SWAP = [['ਤ','ਟ'],['ਦ','ਡ'],['ਨ','ਣ'],['ਸ','ਸ਼'],['ਬ','ਭ'],['ਕ','ਖ'],['ਗ','ਘ'],['ਜ','ਝ'],['ਪ','ਫ'],['ਰ','ੜ'],['ਦ','ਧ'],['ਤ','ਥ']];
const NOISE = +(process.argv[3] || 1);
function asr(word) {
  if (rnd() < 0.12 * NOISE) { const [a, b] = pick(SWAP); word = rnd() < 0.5 ? word.replace(a, b) : word.replace(b, a); }
  return word;
}
function sing(text) {
  const out = [];
  for (const w of text.replace(/[;,.॥।0-9੦-੯]/g, ' ').split(/\s+/).filter(Boolean)) {
    if (rnd() < 0.15 * NOISE) continue;
    out.push(asr(w));
    if (rnd() < 0.05 * NOISE) out.push(w);
    if (rnd() < 0.04 * NOISE) out.push(pick(['ਜੀ', 'ਹੋ', 'ਮੇਰੇ']));
  }
  return out;
}

async function run(nShabads, srcs) {
  const tr = new Tracker(api, meta);
  tr.setSources([1, 2, 3, 4, 5, 6, 7, 8]);
  const stream = []; // [word, truthShabad, truthLine]
  const rahaoSet = new Set(meta.rahao);
  for (let k = 0; k < nShabads; k++) {
    let s;
    do { s = Math.floor(rnd() * meta.id.length); } while (!srcs.includes(meta.src[s]) || shabadLines(s).length < 4 || shabadLines(s).length > 30);
    const lines = shabadLines(s);
    const start = meta.start[s];
    const rIdx = lines.findIndex((_, i) => rahaoSet.has(start + i));
    const order = [];
    const firstSung = rIdx >= 0 && rnd() < 0.5 ? rIdx : 0;
    order.push(firstSung, firstSung);
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      if (i === rIdx) continue;
      order.push(i, i);
      if (rIdx >= 0 && rnd() < 0.4) order.push(rIdx);
    }
    for (const i of order) for (const w of sing(lines[i][0])) stream.push([w, s, start + i]);
    // gap: simran or katha
    if (rnd() < 0.5) for (let i = 0; i < 16; i++) stream.push(['ਵਾਹਿਗੁਰੂ', -1, -1]);
    else { const o = Math.floor(rnd() * meta.id.length); for (const L of shabadLines(o).slice(0, 2)) for (const w of sing(L[0])) stream.push([w, -2, -2]); for (let i=0;i<12;i++) stream.push([pick(['ਸਾਧ','ਸੰਗਤ','ਜੀ','ਗੁਰੂ','ਸਾਹਿਬ','ਕਹਿੰਦੇ','ਨੇ','ਕਿ','ਇਹ','ਸਾਡਾ','ਜੀਵਨ','ਹੈ']), -2, -2]); }
  }
  const stats = { lagOk: 0, steps: 0, onShabadSteps: 0, correctLine: 0, wrongShabad: 0, lockDelays: [], misses: 0 };
  let curTruth = -9, truthStartIdx = 0, locked = false, now = 0;
  const words = [];
  const hist = [];
  for (let i = 0; i < stream.length; i += 2) {
    for (const [w] of stream.slice(i, i + 2)) words.push(...Skeleton.words(w));
    now += 1500;
    const [, ts, tl] = stream[Math.min(i + 1, stream.length - 1)];
    if (ts !== curTruth) {
      if (curTruth >= 0 && !locked) stats.misses++;
      curTruth = ts; truthStartIdx = i; locked = false;
    }
    const snap = await tr.update(words.slice(-40), now);
    hist.push(tl);
    const txt = l => l >= 0 ? (shabadLines(eng.lineShabad[l])[l - meta.start[eng.lineShabad[l]]] || [''])[0] : '?';
    if (ts >= 0 && snap.shabad === ts && [hist.at(-1), hist.at(-2), hist.at(-3)].some(h => h !== undefined && h >= 0 && txt(h) === txt(snap.line))) stats.lagOk++;
    if (ts < 0) continue;
    stats.steps++;
    if (snap.shabad === ts) {
      if (!locked) { locked = true; stats.lockDelays.push(i - truthStartIdx); }
      stats.onShabadSteps++;
      if (snap.line === tl || (shabadLines(ts)[snap.line - meta.start[ts]] || [])[0] === shabadLines(ts)[tl - meta.start[ts]][0]) stats.correctLine++;
    } else if (snap.shabad >= 0 && snap.mode === 'locked' && locked === false && snap.shabad !== -1) {
      // still showing previous shabad or a wrong one
      stats.wrongShabad++;
    }
  }
  if (!locked) stats.misses++;
  const d = stats.lockDelays.sort((a, b) => a - b);
  return {
    shabads: nShabads, found: d.length,
    medianWordsToLock: d[Math.floor(d.length / 2)],
    p90WordsToLock: d[Math.floor(d.length * 0.9)],
    correctLineWhenOnShabad: (stats.correctLine / Math.max(1, stats.onShabadSteps)).toFixed(3),
    correctWithin3sLag: (stats.lagOk / Math.max(1, stats.onShabadSteps)).toFixed(3),
    overallCorrectLine: (stats.correctLine / stats.steps).toFixed(3),
    stepsShowingOtherShabad: (stats.wrongShabad / stats.steps).toFixed(3),
  };
}

(async () => {
  const t = Date.now();
  console.log('SGGS', await run(40, [1]));
  console.log('Vaaran/Dasam/NandLal', await run(25, [2, 3, 5]));
  console.log('ms', Date.now() - t);
})();
