// Gurmukhi "consonant skeleton" used to match speech-to-text output against Gurbani.
// Vowel signs, nasal marks and addak are dropped, sound-alike letters are merged,
// and every independent vowel becomes one marker (V). Each kept sound is written as
// one ASCII character so lines can be stored compactly.
(function (root) {
  const MERGE = {
    0x0A19: 0x0A28, 0x0A1E: 0x0A28, 0x0A23: 0x0A28, // ਙ ਞ ਣ -> ਨ
    0x0A2F: 0x0A1C, // ਯ -> ਜ
    0x0A35: 0x0A2C, // ਵ -> ਬ
    0x0A33: 0x0A32, 0x0A36: 0x0A38, 0x0A59: 0x0A16, 0x0A5A: 0x0A17,
    0x0A5B: 0x0A1C, 0x0A5E: 0x0A2B,
  };
  const CONS = [0x0A15,0x0A16,0x0A17,0x0A18,0x0A1A,0x0A1B,0x0A1C,0x0A1D,0x0A1F,0x0A20,
    0x0A21,0x0A22,0x0A24,0x0A25,0x0A26,0x0A27,0x0A28,0x0A2A,0x0A2B,0x0A2C,0x0A2D,0x0A2E,
    0x0A30,0x0A32,0x0A38,0x0A39,0x0A5C];
  const LETTERS = 'kKgGcCjJtTdDqQwWnpPbBmrlshR';
  const CODE = {};
  CONS.forEach((c, i) => { CODE[c] = LETTERS[i]; });
  const VOWEL = 'V';

  function isVowelCarrier(cp) {
    return (cp >= 0x0A05 && cp <= 0x0A14) || cp === 0x0A72 || cp === 0x0A73;
  }

  // Returns an array of word skeletons (strings) for a Unicode Gurmukhi text.
  function words(text) {
    if (!text) return [];
    const s = text.normalize('NFD');
    const out = [];
    let cur = '';
    for (const ch of s) {
      let cp = ch.codePointAt(0);
      if (MERGE[cp]) cp = MERGE[cp];
      if (CODE[cp]) { cur += CODE[cp]; continue; }
      if (isVowelCarrier(cp)) { if (cur[cur.length - 1] !== VOWEL) cur += VOWEL; continue; }
      if (cp >= 0x0A00 && cp <= 0x0A7F && !(cp >= 0x0A66 && cp <= 0x0A6F)) continue; // signs
      // anything else (space, danda, digits, punctuation, latin) separates words
      if (cur) { out.push(cur); cur = ''; }
    }
    if (cur) out.push(cur);
    return out;
  }

  const api = { words, LETTERS, VOWEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Skeleton = api;
})(typeof self !== 'undefined' ? self : this);
