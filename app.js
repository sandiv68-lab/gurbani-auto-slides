(() => {
'use strict';
const $ = id => document.getElementById(id);
const MODEL = 'models/gemini-3.5-transcribe-live';
const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const ROTATE_MS = 9 * 60 * 1000; // sessions last max 10 minutes
const SRC_NAME = { 1: ['Sri Guru Granth Sahib Ji', 'Ang'], 2: ['Sri Dasam Granth', 'Ang'], 3: ['Vaaran Bhai Gurdas Ji', 'Vaar'],
  4: ['Kabit Bhai Gurdas Ji', 'Kabit'], 12: ['Sri Dasam Granth', 'Ang'], 5: ['Bhai Nand Lal Ji', 'Ghazal'], 6: ['Bhai Nand Lal Ji', 'Page'], 7: ['Bhai Nand Lal Ji', 'Page'], 8: ['Bhai Nand Lal Ji', 'Page'] };

// ---------- settings ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('gas.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gas.' + k, JSON.stringify(v)); } catch {} },
};
const S = {
  key: store.get('key', ''), tr: store.get('tr', true), tl: store.get('tl', true), pa: store.get('pa', false),
  next: store.get('next', false), dark: store.get('dark', false), blank: store.get('blank', false),
  size: store.get('size', 1), follow: store.get('follow', false), mode: store.get('mode', 'kirtan'), lang: store.get('lang', 'pa-IN'), vad: store.get('vad', 'manual'), debug: store.get('debug', true),
  rows: store.get('rows', null),
  srcs: store.get('srcs', { src1: true, src3: true, src2: true, src5: true }),
};
if (!S.rows) S.rows = [{ k: 'gur', on: true }, { k: 'tr', on: S.tr }, { k: 'tl', on: S.tl }, { k: 'pa', on: S.pa }];
const ROW_NAME = { gur: 'Gurmukhi', tl: 'Romanised (English letters)', tr: 'English translation', pa: 'Punjabi translation' };
function save() { for (const k in S) store.set(k, S[k]); }
const firstRow = () => (S.rows.find(r => r.on) || { k: 'gur' }).k;
const needPa = () => S.rows.some(r => r.on && r.k === 'pa');

// ---------- logging ----------
const logLines = [];
function log(msg) {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  logLines.unshift(t + '  ' + msg); logLines.length = Math.min(logLines.length, 8);
  $('dbgLog').textContent = logLines.join('\n');
}

// ---------- worker / engine ----------
const V = window.APP_V || '1';
const worker = new Worker('worker.js?v=' + V);
let reqId = 0; const pending = new Map();
worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result); };
const call = (type, ...args) => new Promise((resolve, reject) => { const id = ++reqId; pending.set(id, { resolve, reject }); worker.postMessage({ id, type, args }); });
const lettersApi = (sets, o) => call('letters', sets, o);
const engineApi = {
  search: (w, o) => call('search', w, o),
  scoreShabad: (w, s) => call('scoreShabad', w, s),
  weight: w => { let n = 0; for (const c of GEngine.encode(w)) n += c === 28 ? 1 : 2; return n; },
};
let META = null, tracker = null;

// ---------- content chunks ----------
const chunks = new Map(), paChunks = new Map();
function loadChunk(map, dir, i) {
  if (!map.has(i)) map.set(i, fetch(`data/${dir}/${i}.json?v=${V}`).then(r => r.json()).catch(e => { map.delete(i); throw e; }));
  return map.get(i);
}
async function getLine(globalLine) {
  if (globalLine < 0 || !META) return null;
  let s = shabadOf(globalLine);
  const ci = Math.floor(s / META.chunk);
  const c = await loadChunk(chunks, 'c', ci);
  const lines = c[s % META.chunk];
  const off = globalLine - META.start[s];
  let pa = null;
  if (needPa()) { try { pa = (await loadChunk(paChunks, 'p', ci))[s % META.chunk][off]; } catch {} }
  return { s, off, lines, line: lines[off], pa };
}
function shabadOf(l) { // binary search on META.start
  let lo = 0, hi = META.start.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (META.start[mid] <= l) lo = mid; else hi = mid - 1; }
  return lo;
}
async function shabadWords(s) {
  const c = await loadChunk(chunks, 'c', Math.floor(s / META.chunk));
  const set = new Set();
  for (const L of c[s % META.chunk]) for (const w of L[0].replace(/[;,.।॥0-9੦-੯]/g, ' ').split(/\s+/)) if (w.length > 1) set.add(w);
  return [...set].slice(0, 100);
}

// ---------- rendering ----------
function vishraamHTML(text) {
  return text.split(/\s+/).filter(Boolean).map(w => {
    const esc = w.replace(/[;,.]+$/, '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    if (/;$/.test(w)) return `<span class="v-heavy">${esc}</span>`;
    if (/,$/.test(w)) return `<span class="v-light">${esc}</span>`;
    return esc;
  }).join(' ');
}
const escapeHTML = t => (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
let shown = -1, renderToken = 0, blanked = false, userBlank = false;
function rowText(k, line, pa) { return k === 'gur' ? line[0] : k === 'tl' ? line[2] : k === 'tr' ? line[3] : pa; }
function rowHTML(k, text, big) {
  const html = (k === 'gur' || k === 'tl') ? vishraamHTML(text) : escapeHTML(text);
  const script = (k === 'gur' || k === 'pa') ? 'gs' : 'lat';
  return `<div class="${big ? 'big' : 'small'} ${script}${k === 'tl' ? ' tlrow' : ''}">${html}</div>`;
}
function fitSlide() { // shrink text until everything fits on screen
  const slide = $('slide'); let f = 1;
  document.documentElement.style.setProperty('--fit', 1);
  while (f > 0.45 && slide.scrollHeight > slide.clientHeight + 2) { f -= 0.07; document.documentElement.style.setProperty('--fit', f.toFixed(2)); }
}
async function render(globalLine, force) {
  if (globalLine === shown && !force) return;
  shown = globalLine; const tok = ++renderToken;
  const slide = $('slide');
  if (globalLine < 0) { return; }
  const d = await getLine(globalLine);
  if (tok !== renderToken || !d) return;
  let html = '', first = true;
  for (const r of S.rows) {
    if (!r.on) continue;
    const t = rowText(r.k, d.line, d.pa);
    if (!t) { if (first) first = false; continue; }
    html += rowHTML(r.k, t, first); first = false;
  }
  if (S.next && d.lines[d.off + 1]) { const nk = firstRow(); const nt = rowText(nk, d.lines[d.off + 1], null) || d.lines[d.off + 1][0]; html += `<div class="next ${nk === 'gur' || nk === 'pa' ? 'gs' : ''}">${(nk === 'gur' || nk === 'tl') ? vishraamHTML(nt) : escapeHTML(nt)}</div>`; }
  if (userBlank) { slide.innerHTML = ''; }
  else { slide.innerHTML = html; fitSlide(); }
  blanked = false;
  $('nextShabadChip').classList.toggle('on', !userBlank && d.off === d.lines.length - 1 && shabadOf(globalLine) + 1 < META.start.length);
}
window.addEventListener('resize', () => { if (!userBlank && shown >= 0) fitSlide(); });
function applyLook() {
  document.body.classList.toggle('dark', S.dark);
  document.documentElement.style.setProperty('--scale', S.size);
  document.querySelector('meta[name=theme-color]').content = S.dark ? '#0e1013' : '#eef5f3';
  $('debug').classList.toggle('on', S.debug);
  document.body.classList.toggle('dbg', S.debug);
}

const ICON_FIND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/></svg>';
const ICON_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="7.5" y="2" width="9" height="12" rx="4.5" fill="currentColor" fill-opacity=".25"/><line x1="7.5" y1="6" x2="16.5" y2="6"/><line x1="7.5" y1="8.5" x2="16.5" y2="8.5"/><line x1="7.5" y1="11" x2="16.5" y2="11"/><path d="M5 11.5a7 7 0 0 0 14 0"/><line x1="12" y1="18.5" x2="12" y2="21.5"/><line x1="8" y1="21.5" x2="16" y2="21.5"/></svg>';
let lastSnap = null;
const SHORT = { 1: 'SGGS', 2: 'Dasam', 12: 'Dasam', 3: 'Bhai Gurdas', 4: 'Bhai Gurdas', 5: 'Nand Lal', 6: 'Nand Lal', 7: 'Nand Lal', 8: 'Nand Lal' };
const where = s => `${SHORT[META.src[s]] || ''} · ${(SRC_NAME[META.src[s]] || ['', 'Page'])[1]} ${META.page[s]}`;
function setStatus() {
  const st = $('status');
  const fb = $('findBtn');
  fb.className = running ? 'btn listening' : 'btn primary';
  document.body.classList.toggle('listening', running);
  fb.innerHTML = running ? ICON_MIC : ICON_FIND;
  fb.title = running ? 'Listening… tap to cancel' : 'Find the shabad';
  if (running) {
    if (!ready) { st.innerHTML = `<span class="dot search"></span>Connecting…`; return; }
    if (S.follow && lastSnap && lastSnap.mode === 'locked' && curShabad >= 0) { st.innerHTML = `<span class="dot locked"></span><b>Following</b> ${where(curShabad)}`; return; }
    st.innerHTML = `<span class="dot search"></span><b>Listening</b> finding the shabad…`; return;
  }
  if (connError) { st.innerHTML = `<span class="dot err"></span>${escapeHTML(connError)}`; return; }
  if (curShabad >= 0) { st.innerHTML = `<span class="dot locked"></span><b>${where(curShabad)}</b>`; return; }
  st.innerHTML = `<span class="dot off"></span>Ready`;
}

// ---------- candidates strip ----------
let curShabad = -1, foundCands = [];
function distinctCands(cands, n = 3) {
  const out = [], seen = new Set();
  for (const r of cands || []) { if (seen.has(r.shabad) || r.score < 0.45) continue; seen.add(r.shabad); out.push(r); if (out.length === n) break; }
  return out;
}
async function showCands(list, label, chosen) {
  const box = $('cands');
  if (!list.length) { box.innerHTML = ''; return; }
  const k = firstRow(), gs = (k === 'gur' || k === 'pa');
  const items = await Promise.all(list.map(async r => { const d = await getLine(r.line).catch(() => null); const t = d ? (rowText(k, d.line, d.pa) || d.line[0]) : ''; return { r, text: t.replace(/[;,.]/g, '').split(/\s+/).slice(0, gs ? 5 : 6).join(' ') }; }));
  box.innerHTML = `<span class="chip lbl">${label}</span>` + items.map(({ r, text }, i) =>
    `<button class="chip${r.shabad === chosen ? ' on' : ''}" data-i="${i}">${r.shabad === chosen ? '✓ ' : ''}<span class="${gs ? 'g' : ''}">${escapeHTML(text)}</span> · ${escapeHTML(where(r.shabad))}</button>`).join('') +
    (label === 'Found:' ? '<button class="chip" id="candClose">✕</button>' : '');
  box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => chooseShabad(items[+b.dataset.i].r));
  const c = $('candClose'); if (c) c.onclick = () => { box.innerHTML = ''; };
}
function chooseShabad(r) {
  if (running && !S.follow) stopListening();
  curShabad = r.shabad;
  if (tracker) { tracker.mode = 'locked'; tracker.shabad = r.shabad; tracker.line = r.line; tracker.ev.clear(); }
  goLine(r.line);
  if (foundCands.length) showCands(foundCands, 'Found:', r.shabad);
  setStatus();
}

// ---------- paath: make up for the delay ----------
let lastAheadHeard = -1, lastAheadK = -1;
async function aheadOf(heard, wasFinal) {
  if (S.mode !== 'paath') return { line: heard, k: 0 };
  const sec = chunkLen() / 16000;
  const wps = finalsHist.length ? Math.min(5, Math.max(1, finalsHist.slice(-3).reduce((a, b) => a + b, 0) / (Math.min(3, finalsHist.length) * sec))) : 2.5;
  const delay = (wasFinal ? (Date.now() - lastChunkEnd) / 1000 : 1.5) + 0.5;
  const d = await getLine(heard);
  const words = L => L[0].replace(/[;,.॥।0-9੦-੯]/g, ' ').split(/\s+/).filter(Boolean).length;
  let budget = delay * wps - words(d.line) / 2, k = 0;
  while (k < 3 && d.lines[d.off + k + 1] && budget >= words(d.lines[d.off + k + 1]) / 2) { budget -= words(d.lines[d.off + k + 1]); k++; }
  if (heard !== lastAheadHeard || k !== lastAheadK) log(`Paath: +${k} line${k === 1 ? '' : 's'} ahead (delay ${delay.toFixed(1)}s, ${wps.toFixed(1)} words/s)`);
  lastAheadHeard = heard; lastAheadK = k;
  return { line: heard + k, k };
}

// ---------- navigation ----------
function shabadEnd(s) { return s + 1 < META.start.length ? META.start[s + 1] : META.total; }
function goLine(l) {
  if (!META || l < 0) return;
  curShabad = shabadOf(l);
  if (tracker) tracker.line = l;
  render(l);
  $('rahaoBtn').disabled = !rahaoGroups(curShabad).length;
  $('linesBtn').disabled = false;
  if ($('linesSheet').classList.contains('on')) drawLines();
}
function toggleBlank(v) {
  userBlank = v === undefined ? !userBlank : v;
  $('blankBtn').classList.toggle('on', userBlank);
  $('blankBtn').textContent = userBlank ? 'Show' : 'Blank';
  render(shown, true);
}
const HEADING = /^(ਪਉੜੀ|ਸਲੋਕੁ?|ਸਲੋਕ|ਮਹਲਾ|ਮਃ|ਛੰਤ|ਪਦਾ)[\s੦-੯॥।]*(ਮਃ|ਮਹਲਾ)?[\s੦-੯॥।]*$/;
async function goShabad(d) {
  if (curShabad < 0) return;
  const s = curShabad + d; if (s < 0 || s >= META.start.length) return;
  const first = await getLine(META.start[s]);
  let off = 0; while (off < first.lines.length - 1 && HEADING.test(first.lines[off][0].trim())) off++;
  curShabad = s; goLine(META.start[s] + off); setStatus();
}
function step(d) {
  if (userBlank) { toggleBlank(false); return; }
  if (shown < 0 || !META) return;
  const s = shabadOf(shown), n = shown + d;
  if (n >= META.start[s] && n < shabadEnd(s)) goLine(n);
}
function rahaoGroups(s) { // start line of each block of consecutive rahao lines
  const out = [];
  for (let l = META.start[s]; l < shabadEnd(s); l++) if (rahaoSet.has(l) && !rahaoSet.has(l - 1)) out.push(l);
  return out;
}
function goRahao() {
  if (curShabad < 0) return;
  const g = rahaoGroups(curShabad); if (!g.length) return;
  const inGroup = rahaoSet.has(shown);
  let target = g[0];
  if (inGroup) { const cur = g.filter(x => x <= shown).pop(); const i = g.indexOf(cur); target = g[(i + 1) % g.length]; }
  goLine(target);
}
async function drawLines() {
  if (curShabad < 0) return;
  const d = await getLine(META.start[curShabad]);
  const k = firstRow() === 'tl' ? 'tl' : 'gur';
  $('linesTitle').textContent = where(curShabad);
  const NUM = /[॥।]\s*([੦-੯0-9]+)\s*[॥।]?\s*$/;
  const G2A = t => t.replace(/[੦-੯]/g, c => c.charCodeAt(0) - 0x0A66);
  const base = META.start[curShabad];
  const ends = d.lines.map(L => NUM.test(L[0]));
  const isR = i => rahaoSet.has(base + i);
  const blocks = []; // [startIndex, endIndex]
  d.lines.forEach((L, i) => { if (i === 0 || ends[i - 1] || isR(i) !== isR(i - 1)) blocks.push([i, i]); else blocks[blocks.length - 1][1] = i; });
  const label = ([a, b]) => { if (isR(a)) return 'Rahao'; const m = d.lines[b][0].match(NUM); return m ? G2A(m[1]) : ''; };
  const showDiv = ends.filter(Boolean).length >= 2;
  let html = '';
  blocks.forEach(blk => {
    const lab = label(blk);
    if (showDiv && lab) html += `<div class="div">— ${lab} —</div>`;
    for (let i = blk[0]; i <= blk[1]; i++) {
      const g = base + i, L = d.lines[i];
      html += `<div class="ln${g === shown ? ' cur' : ''}" data-l="${g}" style="${k === 'tl' ? "font-family:'Open Sans',sans-serif" : ''}">${escapeHTML((rowText(k, L, null) || L[0]).replace(/[;,.]/g, ''))}${isR(i) ? '<span class="rh">RAHAO</span>' : ''}</div>`;
    }
  });
  $('linesList').innerHTML = html;
  $('linesList').querySelectorAll('.ln').forEach(el => el.onclick = () => { goLine(+el.dataset.l); $('linesSheet').classList.remove('on'); });
  const cur = $('linesList').querySelector('.cur'); if (cur) cur.scrollIntoView({ block: 'center' });
}
let rahaoSet = new Set();

// ---------- transcript ----------
let finalText = '', interimText = '', lastProcessed = '', nInterim = 0, nFinal = 0, nWords = 0;
function onTranscript(kind, text) {
  if (!text) return;
  if (kind === 'final') { finalText = (finalText + ' ' + text).slice(-1200); interimText = ''; nFinal++; const nw = text.trim().split(/\s+/).length; nWords += nw; finalsHist.push(nw); if (finalsHist.length > 4) finalsHist.shift(); }
  else { interimText = text; nInterim++; }
  $('dbgCount').textContent = `Received ${nFinal} finished + ${nInterim} live updates · ${nWords} words`;
  const full = (finalText + ' ' + interimText).trim();
  $('dbgText').innerHTML = escapeHTML(finalText.slice(-320)) + ' <i>' + escapeHTML(interimText) + '</i>';
  if (!/[\u0A00-\u0A7F]/.test(text)) log('Not Gurmukhi: ' + text.slice(0, 60));
}
let busy = false, lastFinalCount = 0, lastNote = '';
async function tick() {
  if (!tracker || busy || !running) return;
  const full = (finalText + ' ' + interimText).trim();
  const isFinal = nFinal !== lastFinalCount;
  if (full === lastProcessed && !isFinal) return;
  lastProcessed = full; lastFinalCount = nFinal; busy = true;
  try {
    const words = Skeleton.words(full).slice(-40);
    const snap = await tracker.update(words, Date.now(), { final: isFinal, katha: GTracker.isKatha(full) });
    lastSnap = snap;
    if (snap.note && snap.note !== lastNote) log(snap.note);
    lastNote = snap.note;
    if (snap.mode === 'search' && snap.note && snap.note.startsWith('lost') && S.blank && !blanked) {
      $('slide').innerHTML = ''; shown = -1; blanked = true;
    }
    if (running && snap.mode !== 'locked') showCands(distinctCands(snap.candidates), 'Possible:', -1);
    if (snap.mode === 'locked' && snap.line >= 0) {
      if (snap.shabad !== lockedShabad) {
        lockedShabad = snap.shabad; vocabShabad = -1;
        log(`Found: ${META.id[snap.shabad]} (${where(snap.shabad)})`);
        const others = distinctCands(snap.candidates).filter(r => r.shabad !== snap.shabad);
        foundCands = [{ shabad: snap.shabad, line: snap.line, score: 1 }, ...others].slice(0, 3);
        showCands(foundCands, 'Found:', snap.shabad);
      }
      const heard = snap.line, wasFinal = isFinal;
      if (!S.follow) stopListening();
      const a = await aheadOf(heard, wasFinal);
      goLine(a.line);
      if (tracker) tracker.line = heard;
    }
    const c = (snap.candidates || []).slice(0, 3).map(r => `${(SRC_NAME[META.src[r.shabad]] || ['?'])[1]} ${META.page[r.shabad]}:${r.score.toFixed(2)}`).join('  ');
    $('dbgState').textContent = `Mode: ${snap.mode === 'locked' ? 'following' : 'searching'}${snap.shabad >= 0 ? ' · shabad ' + META.id[snap.shabad] : ''}${c ? ' · top: ' + c : ''}`;
    const top = (snap.candidates || [])[0];
    if (snap.mode !== 'locked' && top) getLine(top.line).then(d => { if (d) $('dbgGuess').innerHTML = `Best guess (${top.score.toFixed(2)}): <span class="t">${escapeHTML(d.line[0])}</span>`; });
    else $('dbgGuess').textContent = '';
    setStatus();
  } catch (e) { log('Match error: ' + e.message); }
  busy = false;
}
setInterval(tick, 500);
let lockedShabad = -1, vocabShabad = -1;

// ---------- Gemini Live ----------
let manualRejected = false, chunkSamples = 0;
const chunkLen = () => 16000 * (S.mode === 'paath' ? 4 : 6);
let lastChunkEnd = 0; const finalsHist = [];
let running = false, ready = false, connError = '', active = null, rotateTimer = null, reconnectDelay = 1000;
function authParam(key) { return 'key=' + encodeURIComponent(key); }

function openSession(vocab, manual = !manualRejected) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}?${authParam(S.key)}`);
    let settled = false;
    const t = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error('No answer from Google (timeout)')); } }, 15000);
    ws.onopen = () => {
      const tc = { mode: 'VERBATIM' };
      tc.languageCodes = S.lang ? [S.lang] : [];
      if (vocab && vocab.length) tc.customVocabulary = vocab;
      const setup = { model: MODEL, generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: tc };
      if (manual) setup.realtimeInputConfig = { automaticActivityDetection: { disabled: true } };
      ws.send(JSON.stringify({ setup }));
    };
    ws.onmessage = async ev => {
      let msg;
      try { msg = JSON.parse(ev.data instanceof Blob ? await ev.data.text() : ev.data); } catch { return; }
      if (msg.setupComplete && !settled) { settled = true; clearTimeout(t); ws._manual = manual; resolve(ws); return; }
      const sc = msg.serverContent;
      if (sc) {
        if (sc.interimInputTranscription && ws === active) onTranscript('interim', sc.interimInputTranscription.text);
        if (sc.inputTranscription) onTranscript('final', sc.inputTranscription.text);
      }
      if (msg.goAway && ws === active) { log('Google asked to reconnect'); rotate(); }
      if (msg.error) log('Google error: ' + JSON.stringify(msg.error).slice(0, 160));
    };
    ws.onerror = () => {};
    ws.onclose = ev => {
      clearTimeout(t);
      const why = ev.reason || ('code ' + ev.code);
      if (!settled) { settled = true; reject(new Error(why)); return; }
      if (ws === active && running) {
        log('Connection closed: ' + why);
        ready = false; setStatus();
        setTimeout(() => { if (running && ws === active) rotate(); }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      }
    };
  });
}

async function rotate() {
  if (!running) return;
  clearTimeout(rotateTimer);
  let vocab = null;
  if (lockedShabad >= 0) { try { vocab = await shabadWords(lockedShabad); vocabShabad = lockedShabad; } catch {} }
  try {
    let ws;
    try { ws = await openSession(vocab); }
    catch (e) {
      if (!manualRejected && !/key|API|permission|auth/i.test(e.message)) {
        manualRejected = true; log('Chunk mode refused (' + e.message + ') — using Google auto mode');
        ws = await openSession(vocab, false);
      } else throw e;
    }
    if (!running) { ws.close(); return; }
    const old = active; active = ws; ready = true; connError = ''; reconnectDelay = 1000;
    chunkSamples = 0;
    if (ws._manual) { ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } })); lastChunkEnd = Date.now(); log(`Listening in ${chunkLen() / 16000}-second chunks (${S.mode})`); }
    if (old && old.readyState === WebSocket.OPEN) {
      try { old.send(JSON.stringify(old._manual ? { realtimeInput: { activityEnd: {} } } : { realtimeInput: { audioStreamEnd: true } })); } catch {}
      setTimeout(() => { try { old.close(); } catch {} }, 3000);
    }
    rotateTimer = setTimeout(rotate, ROTATE_MS);
    setStatus();
  } catch (e) {
    log('Connect failed: ' + e.message);
    connError = 'Connection failed: ' + e.message;
    ready = false; setStatus();
    if (running) setTimeout(rotate, reconnectDelay), reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  }
}

function sendPCM(int16) {
  if (!active || !ready || active.readyState !== WebSocket.OPEN) return;
  const bytes = new Uint8Array(int16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  active.send(JSON.stringify({ realtimeInput: { audio: { data: btoa(bin), mimeType: 'audio/pcm;rate=16000' } } }));
  if (active._manual) {
    chunkSamples += int16.length;
    if (chunkSamples >= chunkLen()) {
      chunkSamples = 0; lastChunkEnd = Date.now();
      active.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
      active.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
    }
  }
}

// ---------- audio ----------
const WORKLET = `
class PCM extends AudioWorkletProcessor {
  constructor(){ super(); this.buf = new Int16Array(1600); this.n = 0; this.ratio = sampleRate / 16000; this.pos = 0; this.sum = 0; this.cnt = 0; }
  process(inputs){
    const ch = inputs[0] && inputs[0][0]; if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.pos += 1; this.sum += ch[i]; this.cnt++;
      if (this.pos >= this.ratio) { this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.sum / this.cnt)); this.sum = 0; this.cnt = 0;
        this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('pcm16', PCM);`;
let ctx = null, node = null, micStream = null, fileSrc = null, wakeLock = null;
async function setupAudio() {
  if (ctx) return;
  try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); }
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  node = new AudioWorkletNode(ctx, 'pcm16');
  node.port.onmessage = e => {
    const a = e.data; let sum = 0; for (let i = 0; i < a.length; i += 8) sum += (a[i] / 32768) ** 2;
    $('meter').firstChild.style.width = Math.min(100, Math.sqrt(sum / (a.length / 8)) * 400) + '%';
    sendPCM(a);
  };
}

let source = null; // 'mic' | 'file'
async function startAudio(fileBuffer) {
  await setupAudio();
  await ctx.resume();
  if (fileBuffer) {
    const audio = await ctx.decodeAudioData(fileBuffer);
    fileSrc = ctx.createBufferSource(); fileSrc.buffer = audio;
    fileSrc.connect(node); fileSrc.connect(ctx.destination);
    fileSrc.onended = () => { log('Recording finished'); if (source === 'file') { stopListening(); stopAudio(); } };
    fileSrc.start(); source = 'file'; $('fileStop').disabled = false;
  } else {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
    ctx.createMediaStreamSource(micStream).connect(node); source = 'mic';
  }
}
function stopAudio() {
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (fileSrc) { try { fileSrc.onended = null; fileSrc.stop(); } catch {} fileSrc = null; }
  if (node) { try { node.disconnect(); } catch {} }
  if (ctx) { ctx.close(); ctx = null; node = null; }
  source = null; $('fileStop').disabled = true;
  $('meter').firstChild.style.width = '0';
}
async function startListening() {
  if (!S.key) { openSettings(); $('keyResult').textContent = 'Add your key first.'; return; }
  if (!ctx) await startAudio();
  running = true; ready = false; connError = '';
  tracker.reset(); tracker.setSources(selectedSources());
  finalText = interimText = lastProcessed = ''; lockedShabad = -1; nInterim = nFinal = nWords = 0; lastFinalCount = 0; finalsHist.length = 0;
  $('dbgText').textContent = '—'; $('dbgGuess').textContent = ''; $('cands').innerHTML = ''; foundCands = [];
  try { wakeLock = wakeLock || await navigator.wakeLock.request('screen'); } catch {}
  setStatus();
  log(source === 'file' ? 'Finding (recording)' : 'Finding (microphone)');
  rotate();
}
function stopListening() {
  running = false; ready = false;
  clearTimeout(rotateTimer);
  if (active) { try { active.send(JSON.stringify(active._manual ? { realtimeInput: { activityEnd: {} } } : { realtimeInput: { audioStreamEnd: true } })); } catch {} const a = active; setTimeout(() => { try { a.close(); } catch {} }, 1500); active = null; }
  if (source === 'mic') stopAudio();
  setStatus();
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') { try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
});

// ---------- test key ----------
async function testKey() {
  S.key = $('keyInput').value.trim(); save();
  const out = $('keyResult');
  if (!S.key) { out.textContent = 'Paste a key first.'; out.className = 'note bad'; return; }
  out.textContent = 'Testing…'; out.className = 'note';
  try { const ws = await openSession(null); ws.close(); out.textContent = '✓ Key works — connected to Gemini.'; out.className = 'note ok'; if (META) $('loadMsg').textContent = 'Ready.'; }
  catch (e) { out.textContent = '✗ ' + e.message; out.className = 'note bad'; }
}

// ---------- UI ----------
function selectedSources() {
  const out = [];
  document.querySelectorAll('[data-src]').forEach(cb => { if (cb.checked) cb.dataset.src.split(',').forEach(x => out.push(+x)); });
  return out;
}
function openSettings() { $('settings').classList.add('on'); }
$('findBtn').onclick = () => {
  if (running) { stopListening(); log('Find cancelled'); return; }
  startListening().catch(e => { log('Find failed: ' + e.message); connError = e.message; stopListening(); });
};
$('slide').addEventListener('click', e => {
  const x = e.clientX / window.innerWidth;
  if (x < 1 / 3) step(-1); else if (x > 2 / 3) step(1);
});
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { step(1); e.preventDefault(); }
  else if (['ArrowLeft', 'PageUp'].includes(e.key)) { step(-1); e.preventDefault(); }
  else if (e.key === 'r' || e.key === 'R') goRahao();
  else if (e.key === 'b' || e.key === 'B' || e.key === '.') toggleBlank();
});
$('rahaoBtn').onclick = () => { if (userBlank) toggleBlank(false); goRahao(); };
$('blankBtn').onclick = () => toggleBlank();
$('nextShabadChip').onclick = e => { e.stopPropagation(); goShabad(1); };
$('linesBtn').onclick = () => { $('linesSheet').classList.add('on'); drawLines(); };
$('closeLines').onclick = () => $('linesSheet').classList.remove('on');
$('linesSheet').addEventListener('click', e => { if (e.target === $('linesSheet')) $('linesSheet').classList.remove('on'); });
$('setBtn').onclick = openSettings;
$('closeSet').onclick = () => { $('settings').classList.remove('on'); if (tracker) tracker.setSources(selectedSources()); render(shown, true); if (foundCands.length && $('cands').innerHTML) showCands(foundCands, 'Found:', curShabad); };
$('settings').addEventListener('click', e => { if (e.target === $('settings')) $('closeSet').onclick(); });
$('debugBtn').onclick = () => { S.debug = !S.debug; save(); applyLook(); };
$('testKey').onclick = testKey;
$('showKey').onclick = () => { const k = $('keyInput'); k.type = k.type === 'password' ? 'text' : 'password'; $('showKey').textContent = k.type === 'password' ? 'Show' : 'Hide'; };
$('keyInput').addEventListener('change', () => { S.key = $('keyInput').value.trim(); save(); if (S.key && META) $('loadMsg').textContent = 'Ready.'; });
$('fileBtn').onclick = () => $('fileInput').click();
$('fileStop').onclick = () => { stopListening(); stopAudio(); log('Recording stopped'); };
$('fileInput').onchange = async () => {
  const f = $('fileInput').files[0]; if (!f) return;
  $('settings').classList.remove('on');
  stopListening(); stopAudio();
  try { await startAudio(await f.arrayBuffer()); await startListening(); } catch (e) { log('File failed: ' + e.message); stopListening(); stopAudio(); }
  $('fileInput').value = '';
};
new ResizeObserver(() => document.documentElement.style.setProperty('--barH', $('bar').offsetHeight + 'px')).observe($('bar'));
const bind = (id, k, after) => { const el = $(id); if (el.type === 'checkbox') { el.checked = S[k]; el.onchange = () => { S[k] = el.checked; save(); applyLook(); after && after(); }; } else { el.value = S[k]; el.oninput = () => { S[k] = el.type === 'range' ? +el.value : el.value; save(); applyLook(); after && after(); }; } };
bind('optNext', 'next', () => render(shown, true)); bind('optFollow', 'follow'); bind('optDark', 'dark'); bind('optBlank', 'blank'); bind('optSize', 'size'); bind('optLang', 'lang');
document.querySelectorAll('[data-src]').forEach(cb => { cb.checked = cb.id in S.srcs ? S.srcs[cb.id] !== false : !cb.dataset.off; cb.onchange = () => { S.srcs[cb.id] = cb.checked; save(); }; });
function drawRowList() {
  $('rowList').innerHTML = S.rows.map((r, i) => `<div class="rowitem"><input type="checkbox" id="row_${r.k}" ${r.on ? 'checked' : ''}><label for="row_${r.k}">${ROW_NAME[r.k]}</label>
    <button class="btn" data-up="${i}" ${i === 0 ? 'disabled' : ''}>▲</button><button class="btn" data-dn="${i}" ${i === S.rows.length - 1 ? 'disabled' : ''}>▼</button></div>`).join('');
  S.rows.forEach(r => { $('row_' + r.k).onchange = e => { r.on = e.target.checked; save(); render(shown, true); }; });
  $('rowList').querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; [S.rows[i - 1], S.rows[i]] = [S.rows[i], S.rows[i - 1]]; save(); drawRowList(); render(shown, true); });
  $('rowList').querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { const i = +b.dataset.dn; [S.rows[i + 1], S.rows[i]] = [S.rows[i], S.rows[i + 1]]; save(); drawRowList(); render(shown, true); });
}
drawRowList();
$('findBtn').innerHTML = ICON_FIND;
$('keyInput').value = S.key;
applyLook();


// ---------- manual first-letter search ----------
const PAINTI = 'ੳਅੲਸਹਕਖਗਘਙਚਛਜਝਞਟਠਡਢਣਤਥਦਧਨਪਫਬਭਮਯਰਲਵੜ';
const PHON = { a: 'V', e: 'V', i: 'V', o: 'V', u: 'V', k: 'kK', q: 'k', g: 'gG', c: 'cC', j: 'jJ', z: 'j', y: 'j',
  t: 'qtQT', d: 'wdWD', n: 'n', p: 'pP', f: 'P', b: 'bB', v: 'b', w: 'b', m: 'm', r: 'rR', l: 'l', s: 's', h: 'h', x: 'K' };
const gChunks = new Map();
function querySets(q) {
  const out = [];
  for (const ch of q) {
    if (/\s/.test(ch)) continue;
    if (/[਀-੿]/.test(ch)) { const w = Skeleton.words(ch)[0]; if (w) out.push(w[0]); }
    else { const p = PHON[ch.toLowerCase()]; if (p) out.push(p); }
  }
  return out;
}
let qToken = 0;
async function runSearch() {
  const q = $('qInput').value, sets = querySets(q), tok = ++qToken, box = $('qResults');
  if (sets.length < 2) { box.innerHTML = `<div class="empty">Type the first letter of each word of a line — at least 2.<br>Gurmukhi letters (keypad below) or English letters on your phone keyboard: <b>m m l g</b> finds ਮੇਰਾ ਮਨੁ ਲੋਚੈ ਗੁਰ…</div>`; $('qCount').textContent = ''; return; }
  const r = await lettersApi(sets, { max: 40, sources: selectedSources(), startOnly: !$('qAny').checked });
  if (tok !== qToken) return;
  $('qCount').textContent = r.total ? `${r.total.toLocaleString()} found${r.total > 40 ? ' — showing 40' : ''}` : '';
  if (!r.total) { box.innerHTML = `<div class="empty">Nothing found.${$('qAny').checked ? '' : ' Try ticking “Match anywhere in the line”.'}</div>`; return; }
  const texts = await Promise.all(r.results.map(async x => {
    const ci = Math.floor(x.shabad / META.chunk);
    if (!gChunks.has(ci)) gChunks.set(ci, fetch(`data/g/${ci}.json?v=${V}`).then(res => res.json()));
    try { return (await gChunks.get(ci))[x.shabad % META.chunk][x.line - META.start[x.shabad]]; } catch { return ''; }
  }));
  if (tok !== qToken) return;
  box.innerHTML = r.results.map((x, i) => `<div class="res" data-i="${i}"><div class="g">${escapeHTML((texts[i] || '').replace(/[;,.]/g, ''))}</div><div class="w">${escapeHTML(where(x.shabad))}</div></div>`).join('');
  box.querySelectorAll('.res').forEach(el => el.onclick = () => {
    const x = r.results[+el.dataset.i];
    $('searchSheet').classList.remove('on');
    foundCands = []; $('cands').innerHTML = '';
    if (userBlank) toggleBlank(false);
    chooseShabad({ shabad: x.shabad, line: x.line });
    log(`Picked by search: ${where(x.shabad)}`);
  });
}
function openSearch() {
  $('searchSheet').classList.add('on');
  if (!$('kbd').childElementCount) {
    $('kbd').innerHTML = [...PAINTI].map(c => `<button data-c="${c}">${c}</button>`).join('');
    $('kbd').querySelectorAll('button').forEach(b => b.onclick = () => { $('qInput').value += b.dataset.c; runSearch(); });
  }
  runSearch();
}
$('typeBtn').onclick = openSearch;
function drawMode() { const b = $('modeBtn'); b.textContent = S.mode === 'paath' ? 'Paath' : 'Kirtan'; b.className = 'mode' + (S.mode === 'paath' ? ' paath' : ''); }
$('modeBtn').onclick = e => { e.stopPropagation(); S.mode = S.mode === 'paath' ? 'kirtan' : 'paath'; save(); drawMode(); log('Mode: ' + S.mode + (S.mode === 'paath' ? ' (4-second chunks, jumps ahead)' : ' (6-second chunks)')); };
drawMode();
$('closeSearch').onclick = () => $('searchSheet').classList.remove('on');
$('searchSheet').addEventListener('click', e => { if (e.target === $('searchSheet')) $('searchSheet').classList.remove('on'); });
$('qInput').addEventListener('input', runSearch);
$('qAny').onchange = runSearch;
$('qBack').onclick = () => { $('qInput').value = [...$('qInput').value.trimEnd()].slice(0, -1).join(''); runSearch(); };

// ---------- boot ----------
call('init').then(meta => {
  META = meta;
  tracker = new GTracker.Tracker(engineApi, meta, { lockEvidence: 0.9, immScore: 0.85, immRaw: 22 });
  tracker.setSources(selectedSources());
  $('loadMsg').textContent = S.key ? 'Ready.' : 'Ready. First, add your Gemini key in ⚙ Settings.';
  $('findBtn').disabled = false; rahaoSet = new Set(meta.rahao); setStatus();
  log(`Database loaded: ${meta.total.toLocaleString()} lines`);
}).catch(e => { $('loadMsg').textContent = 'Could not load the database: ' + e.message; });
})();
