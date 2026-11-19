// Search engine over the Gurbani skeleton index. Pure JS: runs in a Web Worker or Node.
(function (root) {
  const ALPHA = 'kKgGcCjJtTdDqQwWnpPbBmrlshRV';
  const A = ALPHA.length + 1; // codes 1..28
  const CODE = new Uint8Array(128);
  for (let i = 0; i < ALPHA.length; i++) CODE[ALPHA.charCodeAt(i)] = i + 1;
  const VCODE = CODE['V'.charCodeAt(0)];

  function encode(str) { // skeleton string (spaces allowed) -> Uint8Array of codes, no spaces
    const out = [];
    for (let i = 0; i < str.length; i++) { const c = CODE[str.charCodeAt(i)]; if (c) out.push(c); }
    return Uint8Array.from(out);
  }
  function weightOf(codes) { let w = 0; for (const c of codes) w += c === VCODE ? 1 : 2; return w; }

  // Smith-Waterman local alignment. Returns best raw score.
  function align(a, b) {
    const m = b.length; if (!a.length || !m) return 0;
    let prev = new Float32Array(m + 1), cur = new Float32Array(m + 1), best = 0;
    for (let i = 1; i <= a.length; i++) {
      const ai = a[i - 1];
      cur[0] = 0;
      for (let j = 1; j <= m; j++) {
        const bj = b[j - 1];
        const s = ai === bj ? (ai === VCODE ? 1 : 2) : (ai === VCODE || bj === VCODE ? -0.5 : -1);
        let v = prev[j - 1] + s;
        const up = prev[j] - 1, left = cur[j - 1] - 1;
        if (up > v) v = up; if (left > v) v = left; if (v < 0) v = 0;
        cur[j] = v; if (v > best) best = v;
      }
      const t = prev; prev = cur; cur = t;
    }
    return best;
  }

  class Engine {
    constructor(indexText, meta) {
      this.meta = meta;
      const rows = indexText.split('\n');
      this.n = rows.length;
      this.lines = rows.map(encode);
      this.first = rows.map(r => r.split(' ').map(w => w[0] || '').join(''));
      this.weights = Float32Array.from(this.lines.map(weightOf));
      // line -> shabad
      this.lineShabad = new Int32Array(this.n);
      const st = meta.start;
      for (let s = 0; s < st.length; s++) {
        const end = s + 1 < st.length ? st[s + 1] : this.n;
        for (let l = st[s]; l < end; l++) this.lineShabad[l] = s;
      }
      // trigram CSR index
      const T = A * A * A;
      const counts = new Uint32Array(T + 1);
      const tri = (c, i) => (c[i] * A + c[i + 1]) * A + c[i + 2];
      for (const c of this.lines) for (let i = 0; i + 2 < c.length; i++) counts[tri(c, i) + 1]++;
      for (let t = 1; t <= T; t++) counts[t] += counts[t - 1];
      this.offsets = counts.slice();
      this.post = new Int32Array(counts[T]);
      const fill = counts.slice();
      for (let l = 0; l < this.n; l++) {
        const c = this.lines[l];
        for (let i = 0; i + 2 < c.length; i++) this.post[fill[tri(c, i)]++] = l;
      }
      this.hits = new Uint16Array(this.n);
      this.tri = tri;
    }

    lineEnd(s) { return s + 1 < this.meta.start.length ? this.meta.start[s + 1] : this.n; }

    // Score one window against one line: {score 0..1, matched raw}
    scoreLine(win, wWeight, l) {
      const raw = align(win, this.lines[l]);
      const denom = Math.min(wWeight, this.weights[l]) || 1;
      const conf = Math.min(1, raw / 18); // short matches count for less
      return { score: (raw / denom) * conf, raw };
    }

    // Global search: best lines for a window string.
    search(winStr, opts = {}) {
      const max = opts.max || 10, srcOk = opts.sources;
      const win = encode(winStr), wW = weightOf(win);
      if (win.length < 4) return [];
      const touched = [];
      const seen = new Set();
      for (let i = 0; i + 2 < win.length; i++) {
        const t = this.tri(win, i);
        if (seen.has(t)) continue; seen.add(t);
        for (let k = this.offsets[t]; k < this.offsets[t + 1]; k++) {
          const l = this.post[k];
          if (this.hits[l] === 0) touched.push(l);
          if (this.hits[l] < 65535) this.hits[l]++;
        }
      }
      touched.sort((x, y) => this.hits[y] - this.hits[x]);
      const top = touched.slice(0, 120).filter(l => this.hits[l] >= 2);
      for (const l of touched) this.hits[l] = 0;
      const res = [];
      for (const l of top) {
        const s = this.lineShabad[l];
        if (srcOk && !srcOk.includes(this.meta.src[s])) continue;
        const r = this.scoreLine(win, wW, l);
        let score = r.score;
        if (this.meta.src[s] === 2 || this.meta.src[s] === 12) score *= 0.97; // Dasam Granth: break ties towards others
        res.push({ line: l, shabad: s, score, raw: r.raw, sig: String.fromCharCode.apply(null, this.lines[l]) });
      }
      res.sort((a, b) => b.score - a.score);
      return res.slice(0, max);
    }

    // Score every line of one shabad.
    scoreShabad(winStr, s) {
      const win = encode(winStr), wW = weightOf(win);
      const out = [];
      for (let l = this.meta.start[s]; l < this.lineEnd(s); l++) {
        const r = this.scoreLine(win, wW, l);
        out.push({ line: l, score: r.score, raw: r.raw });
      }
      return out;
    }

    weight(winStr) { return weightOf(encode(winStr)); }

    // First-letter search. sets: array of strings, each the allowed skeleton letters for one word.
    letters(sets, opts = {}) {
      const max = opts.max || 40, srcOk = opts.sources;
      if (!sets.length) return [];
      const body = sets.map(x => '[' + x + ']').join('');
      const reStart = new RegExp('^' + body), reAny = new RegExp(body);
      const rank = { 1: 0, 3: 1, 2: 2, 4: 3, 5: 4, 6: 4, 7: 4, 8: 4, 12: 5 };
      const out = [];
      for (let l = 0; l < this.n; l++) {
        const f = this.first[l];
        if (f.length < sets.length) continue;
        const start = reStart.test(f);
        if (!start && (opts.startOnly || !reAny.test(f))) continue;
        const s = this.lineShabad[l];
        if (srcOk && !srcOk.includes(this.meta.src[s])) continue;
        out.push({ line: l, shabad: s, start, r: (start ? 0 : 10) + (rank[this.meta.src[s]] ?? 6) });
      }
      out.sort((a, b) => a.r - b.r || a.line - b.line);
      return { total: out.length, results: out.slice(0, max) };
    }
  }

  const api = { Engine, encode, align };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GEngine = api;
})(typeof self !== 'undefined' ? self : this);
