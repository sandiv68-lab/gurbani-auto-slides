// Decides which shabad and line to show, from a growing transcript.
// engine: object with async search(win, opts), scoreShabad(win, s), weight(win)
(function (root) {
  const DEFAULTS = {
    searchWords: 10,     // words used to identify a shabad
    followWords: 5,      // most recent words used to follow lines
    minSearchWeight: 16,
    lockEvidence: 1.0,
    lockMargin: 1.35,
    goodLine: 0.6,
    lostAfterMs: 45000,
    suffixW: 1.0,
    switchMisses: 1,
    switchEvidence: 1.4,
  };

  function similar(a, b) { // near-identical lines (same line printed in two places, small spelling differences)
    if (!a || !b) return false;
    if (a === b) return true;
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > Math.max(m, n) * 0.2) return false;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n) >= 0.8;
  }

  class Tracker {
    constructor(engine, meta, opts = {}) {
      this.e = engine; this.meta = meta;
      this.o = Object.assign({}, DEFAULTS, opts);
      this.rahao = new Set(meta.rahao);
      this.reset();
    }
    reset() {
      this.mode = 'search';
      this.shabad = -1; this.line = -1;
      this.ev = new Map();
      this.lastKey = ''; this.lastFinalKey = '';
      this.lastGood = 0;
      this.miss = 0;
      this.candidates = [];
    }
    setSources(src) { this.sources = src; }

    _decay(f) { for (const [k, v] of this.ev) { const n = v * f; if (n < 0.05) this.ev.delete(k); else this.ev.set(k, n); } }

    // Best and runner-up shabad by evidence. Shabads whose matching line is word-for-word the
    // same as the leader's (e.g. a salok that appears twice) do not count as rivals.
    _topTwo(exclude = -1, best = new Map()) {
      let a = [-1, 0];
      for (const [k, v] of this.ev) if (k !== exclude && v > a[1]) a = [k, v];
      const sig = best.get(a[0]) && best.get(a[0]).sig;
      let b = [-1, 0];
      for (const [k, v] of this.ev) {
        if (k === exclude || k === a[0]) continue;
        if (sig && best.get(k) && similar(best.get(k).sig, sig)) continue;
        if (v > b[1]) b = [k, v];
      }
      return [a, b];
    }

    // Global search step. Returns the shabad to lock on, or -1.
    async _searchStep(words, exclude = -1, final = true, need = this.o.lockEvidence) {
      const win = words.slice(-this.o.searchWords).join('');
      if (this.e.weight(win) < this.o.minSearchWeight) return { lock: -1 };
      const res = await this.e.search(win, { max: 12, sources: this.sources });
      this.candidates = res;
      const best = new Map();
      for (const r of res) if (r.score >= 0.55 && r.score > (best.get(r.shabad) || { score: 0 }).score) best.set(r.shabad, r);
      if (final) {
        this._decay(0.75);
        for (const [s, r] of best) this.ev.set(s, (this.ev.get(s) || 0) + r.score);
        const [a, b] = this._topTwo(exclude, best);
        if (a[0] >= 0 && a[1] >= need && a[1] >= this.o.lockMargin * b[1] && best.get(a[0])) return { lock: a[0], hit: best.get(a[0]) };
      }
      const r0 = res[0];
      if (r0 && r0.shabad !== exclude && r0.score >= 0.9 && r0.raw >= (exclude >= 0 ? 30 : 24)) {
        const rival = res.find(r => r.shabad !== r0.shabad && !similar(r.sig, r0.sig) && r.score >= r0.score - 0.12);
        if (!rival) return { lock: r0.shabad, hit: r0 };
      }
      return { lock: -1 };
    }

    async _bestLineIn(s, words) {
      let n = this.o.followWords, win;
      do { win = words.slice(-n).join(''); n++; } while (this.e.weight(win) < 10 && n <= words.length);
      const scores = await this.e.scoreShabad(win, s);
      let n2 = 3, win2;
      do { win2 = words.slice(-n2).join(''); n2++; } while (this.e.weight(win2) < 9 && n2 <= words.length);
      const sfx = win2 !== win ? await this.e.scoreShabad(win2, s) : scores;
      let best = null;
      scores.forEach((r, i) => { const f = sfx[i].raw >= 9 ? sfx[i].score * this.o.suffixW : 0; if (f > r.score) { r.score = f; r.raw = Math.max(r.raw, sfx[i].raw); } });
      for (const r of scores) {
        let adj = r.score;
        if (r.line === this.line) adj += 0.06;
        else if (r.line === this.line + 1) adj += 0.05;
        if (this.rahao.has(r.line)) adj += 0.03;
        r.adj = adj;
        if (!best || adj > best.adj) best = r;
      }
      const cur = scores.find(r => r.line === this.line);
      return { best, cur };
    }

    // Call with the full recent transcript (Unicode). Returns a state snapshot.
    async update(words, now = Date.now(), flags = {}) {
      const final = flags.final !== false, katha = !!flags.katha;
      const key = words.slice(-12).join(' ');
      if (key === this.lastKey && (!final || key === this.lastFinalKey)) return this.snapshot();
      this.lastKey = key;
      if (final) this.lastFinalKey = key;
      const recent = words.slice(-8);
      if (new Set(recent).size < 3 && recent.length >= 4) return this.snapshot('repetitive (simran?)');

      if (this.mode === 'search') {
        if (katha) return this.snapshot('talking (katha?) — not searching');
        const r = await this._searchStep(words, -1, final);
        if (r.lock >= 0) {
          this.mode = 'locked'; this.shabad = r.lock; this.line = -1; this.miss = 0; this.lastGood = now;
          const { best } = await this._bestLineIn(r.lock, words);
          this.line = best && best.score >= 0.4 ? best.line : r.hit.line;
          this.ev.clear();
        }
        return this.snapshot();
      }

      // locked
      const { best, cur } = await this._bestLineIn(this.shabad, words);
      let r = { lock: -1 }, other = null;
      if (final && !katha) { r = await this._searchStep(words, this.shabad, true, this.miss >= 2 ? this.o.lockEvidence : this.o.switchEvidence); other = this.candidates[0]; }
      const beaten = !!(other && other.score >= 0.75 && (!best || other.score - best.score >= 0.25));
      if (best && best.score >= this.o.goodLine && !beaten) {
        this.lastGood = now; this.miss = 0;
        if (best.line !== this.line && (!cur || best.adj > cur.adj + 0.08)) this.line = best.line;
      } else if (final) {
        this.miss++;
      }
      if (r.lock >= 0 && this.miss >= this.o.switchMisses && (!best || best.score < 0.5 || beaten)) {
        this.shabad = r.lock; this.miss = 0; this.lastGood = now; this.ev.clear();
        const b2 = await this._bestLineIn(r.lock, words);
        this.line = b2.best && b2.best.score >= 0.4 ? b2.best.line : r.hit.line;
        return this.snapshot('switched shabad');
      }
      if (now - this.lastGood > this.o.lostAfterMs) {
        this.mode = 'search'; this.ev.clear();
        return this.snapshot('lost — searching (slide kept)');
      }
      return this.snapshot();
    }

    snapshot(note) {
      return { mode: this.mode, shabad: this.shabad, line: this.line, candidates: this.candidates, note,
        evidence: [...this.ev].sort((a, b) => b[1] - a[1]).slice(0, 3) };
    }
  }

  // Everyday Punjabi words that (almost) never occur in Gurbani: a few of them close together means talking/katha.
  const KATHA = new Set('ਗੱਲ ਜਦੋਂ ਤੁਸੀਂ ਅਸੀਂ ਸਾਡੇ ਸਾਡਾ ਸਾਡੀ ਤੁਹਾਡੇ ਤੁਹਾਡਾ ਕਿਉਂਕਿ ਜਿਹੜਾ ਜਿਹੜੇ ਜਿਹੜੀ ਜਿਹਨੇ ਜਿਹਨਾਂ ਹੁੰਦਾ ਹੁੰਦੇ ਹੁੰਦੀ ਦੱਸਿਆ ਦੱਸਦੇ ਕਿੰਨੀ ਕਿੰਨਾ ਜਿਵੇਂ ਕਿਵੇਂ ਇੱਥੇ ਉੱਥੇ ਅੱਜ ਹੁਣ ਪਾਤਸ਼ਾਹ ਜਿਹਦੇ ਉਨ੍ਹਾਂ ਇਨ੍ਹਾਂ ਗਿਆ ਕਰਕੇ ਵੀ ਮਤਲਬ ਯਾਨੀ ਕਹਿੰਦੇ ਬਾਅਦ ਵਾਸਤੇ'.split(' '));
  function isKatha(text) {
    const w = (text || '').replace(/[^\u0A00-\u0A7F\s]/g, ' ').split(/\s+/).filter(Boolean).slice(-10);
    let n = 0; for (const x of w) if (KATHA.has(x)) n++;
    return n >= 2;
  }

  const api = { Tracker, isKatha };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GTracker = api;
})(typeof self !== 'undefined' ? self : this);
