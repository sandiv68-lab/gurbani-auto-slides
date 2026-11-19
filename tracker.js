// Decides which shabad and line to show, from a growing transcript.
// engine: object with async search(win, opts), scoreShabad(win, s), weight(win)
(function (root) {
  const DEFAULTS = {
    searchWords: 10,     // words used to identify a shabad
    followWords: 5,      // most recent words used to follow lines
    minSearchWeight: 16,
    lockEvidence: 1.6,
    lockMargin: 1.35,
    goodLine: 0.6,
    lostAfterMs: 45000,
    suffixW: 1.0,
  };

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
      this.lastKey = '';
      this.lastGood = 0;
      this.miss = 0;
      this.candidates = [];
    }
    setSources(src) { this.sources = src; }

    _decay(f) { for (const [k, v] of this.ev) { const n = v * f; if (n < 0.05) this.ev.delete(k); else this.ev.set(k, n); } }

    _topTwo(exclude = -1) {
      let a = [-1, 0], b = [-1, 0];
      for (const [k, v] of this.ev) {
        if (k === exclude) continue;
        if (v > a[1]) { b = a; a = [k, v]; } else if (v > b[1]) b = [k, v];
      }
      return [a, b];
    }

    // Global search step. Returns the shabad to lock on, or -1.
    async _searchStep(words, exclude = -1) {
      const win = words.slice(-this.o.searchWords).join('');
      if (this.e.weight(win) < this.o.minSearchWeight) return { lock: -1 };
      const res = await this.e.search(win, { max: 12, sources: this.sources });
      this.candidates = res;
      this._decay(0.75);
      const best = new Map();
      for (const r of res) if (r.score >= 0.55 && r.score > (best.get(r.shabad) || { score: 0 }).score) best.set(r.shabad, r);
      for (const [s, r] of best) this.ev.set(s, (this.ev.get(s) || 0) + r.score);
      const [a, b] = this._topTwo(exclude);
      if (a[0] >= 0 && a[1] >= this.o.lockEvidence && a[1] >= this.o.lockMargin * b[1]) return { lock: a[0], hit: best.get(a[0]) };
      const r0 = res[0];
      if (r0 && r0.shabad !== exclude && r0.score >= 0.9 && r0.raw >= 24) {
        const rival = res.find(r => r.shabad !== r0.shabad && r.score >= r0.score - 0.12);
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
    async update(words, now = Date.now()) {
      const key = words.slice(-12).join(' ');
      if (key === this.lastKey) return this.snapshot();
      this.lastKey = key;
      const recent = words.slice(-8);
      if (new Set(recent).size < 3 && recent.length >= 4) return this.snapshot('repetitive (simran?)');

      if (this.mode === 'search') {
        const r = await this._searchStep(words);
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
      if (best && best.score >= this.o.goodLine) {
        this.lastGood = now; this.miss = 0;
        if (best.line !== this.line && (!cur || best.adj > cur.adj + 0.08)) this.line = best.line;
      } else {
        this.miss++;
      }
      if (this.miss >= 2) {
        const r = await this._searchStep(words, this.shabad);
        if (r.lock >= 0 && (!best || best.score < 0.5)) {
          this.shabad = r.lock; this.miss = 0; this.lastGood = now; this.ev.clear();
          const b2 = await this._bestLineIn(r.lock, words);
          this.line = b2.best && b2.best.score >= 0.4 ? b2.best.line : r.hit.line;
          return this.snapshot('switched shabad');
        }
      } else this.candidates = [];
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

  const api = { Tracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GTracker = api;
})(typeof self !== 'undefined' ? self : this);
