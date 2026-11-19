(() => {
'use strict';
const $ = id => document.getElementById(id);
const MODEL = 'models/gemini-3.5-transcribe-live';
const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const ROTATE_MS = 9 * 60 * 1000; // sessions last max 10 minutes
const SRC_NAME = { 1: ['Sri Guru Granth Sahib Ji', 'Ang'], 2: ['Sri Dasam Granth', 'Ang'], 3: ['Vaaran Bhai Gurdas Ji', 'Vaar'],
  4: ['Kabit Bhai Gurdas Ji', 'Kabit'], 5: ['Bhai Nand Lal Ji', 'Ghazal'], 6: ['Bhai Nand Lal Ji', 'Page'], 7: ['Bhai Nand Lal Ji', 'Page'], 8: ['Bhai Nand Lal Ji', 'Page'] };

// ---------- settings ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('gas.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('gas.' + k, JSON.stringify(v)); } catch {} },
};
const S = {
  key: store.get('key', ''), tr: store.get('tr', true), tl: store.get('tl', true), pa: store.get('pa', false),
  next: store.get('next', false), dark: store.get('dark', false), blank: store.get('blank', false),
  size: store.get('size', 1), lang: store.get('lang', 'pa-IN'), vad: store.get('vad', 'manual'), debug: store.get('debug', true),
  srcs: store.get('srcs', { src1: true, src3: true, src2: true, src5: true }),
};
function save() { for (const k in S) store.set(k, S[k]); }

// ---------- logging ----------
const logLines = [];
function log(msg) {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  logLines.unshift(t + '  ' + msg); logLines.length = Math.min(logLines.length, 8);
  $('dbgLog').textContent = logLines.join('\n');
}

// ---------- worker / engine ----------
const worker = new Worker('worker.js');
let reqId = 0; const pending = new Map();
worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result); };
const call = (type, ...args) => new Promise((resolve, reject) => { const id = ++reqId; pending.set(id, { resolve, reject }); worker.postMessage({ id, type, args }); });
const engineApi = {
  search: (w, o) => call('search', w, o),
  scoreShabad: (w, s) => call('scoreShabad', w, s),
  weight: w => { let n = 0; for (const c of GEngine.encode(w)) n += c === 28 ? 1 : 2; return n; },
};
let META = null, tracker = null;

// ---------- content chunks ----------
const chunks = new Map(), paChunks = new Map();
function loadChunk(map, dir, i) {
  if (!map.has(i)) map.set(i, fetch(`data/${dir}/${i}.json`).then(r => r.json()).catch(e => { map.delete(i); throw e; }));
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
  if (S.pa) { try { pa = (await loadChunk(paChunks, 'p', ci))[s % META.chunk][off]; } catch {} }
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
let shown = -1, renderToken = 0, blanked = false;
async function render(globalLine, force) {
  if (globalLine === shown && !force) return;
  shown = globalLine; const tok = ++renderToken;
  const slide = $('slide');
  if (globalLine < 0) { return; }
  const d = await getLine(globalLine);
  if (tok !== renderToken || !d) return;
  const [gur, , tl, en] = d.line;
  let html = `<div class="gur">${vishraamHTML(gur)}</div>`;
  if (S.tr && en) html += `<div class="tr">${escapeHTML(en)}</div>`;
  if (S.pa && d.pa) html += `<div class="pa">${escapeHTML(d.pa)}</div>`;
  if (S.tl && tl) html += `<div class="tl">${vishraamHTML(tl)}</div>`;
  if (S.next && d.lines[d.off + 1]) html += `<div class="next">${vishraamHTML(d.lines[d.off + 1][0])}</div>`;
  slide.innerHTML = html;
  blanked = false;
}
function applyLook() {
  document.body.classList.toggle('dark', S.dark);
  document.documentElement.style.setProperty('--scale', S.size);
  document.querySelector('meta[name=theme-color]').content = S.dark ? '#0e1013' : '#eef5f3';
  $('debug').classList.toggle('on', S.debug);
}

let lastSnap = null;
function setStatus() {
  const st = $('status');
  if (!running) { st.innerHTML = `<span class="dot ${connError ? 'err' : 'off'}"></span>${connError ? escapeHTML(connError) : 'Not listening'}`; return; }
  if (!ready) { st.innerHTML = `<span class="dot search"></span>Connecting…`; return; }
  const snap = lastSnap;
  if (snap && snap.mode === 'locked' && snap.shabad >= 0) {
    const [name, unit] = SRC_NAME[META.src[snap.shabad]] || ['', 'Page'];
    const short = { 1: 'SGGS', 2: 'Dasam', 3: 'Bhai Gurdas', 4: 'Bhai Gurdas', 5: 'Nand Lal', 6: 'Nand Lal', 7: 'Nand Lal', 8: 'Nand Lal' }[META.src[snap.shabad]];
    st.innerHTML = `<span class="dot locked"></span><b>Following</b><br>${short} · ${unit} ${META.page[snap.shabad]}`;
  } else {
    st.innerHTML = `<span class="dot search"></span><b>Listening</b><br>finding the shabad…`;
  }
}

// ---------- transcript ----------
let finalText = '', interimText = '', lastProcessed = '', nInterim = 0, nFinal = 0, nWords = 0;
function onTranscript(kind, text) {
  if (!text) return;
  if (kind === 'final') { finalText = (finalText + ' ' + text).slice(-1200); interimText = ''; nFinal++; nWords += text.trim().split(/\s+/).length; }
  else { interimText = text; nInterim++; }
  $('dbgCount').textContent = `Received ${nFinal} finished + ${nInterim} live updates · ${nWords} words`;
  const full = (finalText + ' ' + interimText).trim();
  $('dbgText').innerHTML = escapeHTML(finalText.slice(-320)) + ' <i>' + escapeHTML(interimText) + '</i>';
  if (!/[਀-੿]/.test(text)) log('Not Gurmukhi: ' + text.slice(0, 60));
}
let busy = false;
async function tick() {
  if (!tracker || busy) return;
  const full = (finalText + ' ' + interimText).trim();
  if (full === lastProcessed) return;
  lastProcessed = full; busy = true;
  try {
    const words = Skeleton.words(full).slice(-40);
    const snap = await tracker.update(words);
    lastSnap = snap;
    if (snap.note) log(snap.note);
    if (snap.mode === 'search' && snap.note && snap.note.startsWith('lost') && S.blank && !blanked) {
      $('slide').innerHTML = ''; shown = -1; blanked = true;
    }
    if (snap.mode === 'locked' && snap.line >= 0) {
      if (snap.shabad !== lockedShabad) { lockedShabad = snap.shabad; vocabShabad = -1; log(`Locked: ${META.id[snap.shabad]} (${(SRC_NAME[META.src[snap.shabad]] || [''])[0]} ${META.page[snap.shabad]})`); }
      render(snap.line);
    }
    const c = (snap.candidates || []).slice(0, 3).map(r => `${(SRC_NAME[META.src[r.shabad]] || ['?'])[1]} ${META.page[r.shabad]}:${r.score.toFixed(2)}`).join('  ');
    $('dbgState').textContent = `Mode: ${snap.mode === 'locked' ? 'following' : 'searching'}${snap.shabad >= 0 ? ' · shabad ' + META.id[snap.shabad] : ''}${c ? ' · top: ' + c : ''}`;
    const top = (snap.candidates || [])[0];
    if (snap.mode !== 'locked' && top) getLine(top.line).then(d => { if (d) $('dbgGuess').innerHTML = `Best guess (${top.score.toFixed(2)}, needs about 0.6 to show): <span class="t">${escapeHTML(d.line[0])}</span>`; });
    else $('dbgGuess').textContent = '';
    setStatus();
  } catch (e) { log('Match error: ' + e.message); }
  busy = false;
}
setInterval(tick, 500);
let lockedShabad = -1, vocabShabad = -1;

// ---------- Gemini Live ----------
let manualRejected = false, chunkSamples = 0;
const CHUNK = 16000 * 6;
let running = false, ready = false, connError = '', active = null, rotateTimer = null, reconnectDelay = 1000;
function authParam(key) { return 'key=' + encodeURIComponent(key); }

function openSession(vocab, manual = S.vad === 'manual' && !manualRejected) {
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
      if (S.vad === 'manual' && !manualRejected && !/key|API|permission|auth/i.test(e.message)) {
        manualRejected = true; log('Chunk mode refused (' + e.message + ') — using Google auto mode');
        ws = await openSession(vocab, false);
      } else throw e;
    }
    if (!running) { ws.close(); return; }
    const old = active; active = ws; ready = true; connError = ''; reconnectDelay = 1000;
    chunkSamples = 0;
    if (ws._manual) { ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } })); log('Listening in 6-second chunks'); }
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
    if (chunkSamples >= CHUNK) {
      chunkSamples = 0;
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

async function start(fileBuffer) {
  if (!S.key) { openSettings(); $('keyResult').textContent = 'Add your key first.'; return; }
  await setupAudio();
  await ctx.resume();
  if (fileBuffer) {
    const audio = await ctx.decodeAudioData(fileBuffer);
    fileSrc = ctx.createBufferSource(); fileSrc.buffer = audio;
    fileSrc.connect(node); fileSrc.connect(ctx.destination);
    fileSrc.onended = () => { if (running) { log('Recording finished'); stop(); } };
    fileSrc.start();
  } else {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 } });
    ctx.createMediaStreamSource(micStream).connect(node);
  }
  running = true; ready = false; connError = '';
  tracker.reset(); tracker.setSources(selectedSources()); finalText = interimText = lastProcessed = ''; lockedShabad = -1; nInterim = nFinal = nWords = 0; $('dbgText').textContent = '—'; $('dbgGuess').textContent = '';
  $('startBtn').textContent = 'Stop'; $('startBtn').className = 'btn stop';
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  setStatus();
  log(fileBuffer ? 'Testing with recording' : 'Listening to microphone');
  rotate();
  scheduleHide();
}
function stop() {
  running = false; ready = false;
  clearTimeout(rotateTimer);
  if (active) { try { active.send(JSON.stringify(active._manual ? { realtimeInput: { activityEnd: {} } } : { realtimeInput: { audioStreamEnd: true } })); } catch {} const a = active; setTimeout(() => { try { a.close(); } catch {} }, 1500); active = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (fileSrc) { try { fileSrc.stop(); } catch {} fileSrc = null; }
  if (node) { try { node.disconnect(); } catch {} }
  if (ctx) { ctx.close(); ctx = null; node = null; }
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  $('startBtn').textContent = 'Start'; $('startBtn').className = 'btn primary';
  $('meter').firstChild.style.width = '0';
  showBar(); setStatus();
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && running && !wakeLock) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
  if (document.visibilityState === 'visible') wakeLock = wakeLock && !wakeLock.released ? wakeLock : null;
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
function openSettings() { $('settings').classList.add('on'); showBar(); }
let hideTimer = null;
function showBar() { $('bar').classList.remove('hidden'); clearTimeout(hideTimer); }
function scheduleHide() { clearTimeout(hideTimer); if (running) hideTimer = setTimeout(() => $('bar').classList.add('hidden'), 6000); }
$('slide').addEventListener('click', () => { if ($('bar').classList.contains('hidden')) { showBar(); scheduleHide(); } else if (running) $('bar').classList.add('hidden'); });
$('bar').addEventListener('click', () => { showBar(); scheduleHide(); });
$('startBtn').onclick = () => running ? stop() : start().catch(e => { log('Start failed: ' + e.message); connError = e.message; stop(); });
$('setBtn').onclick = openSettings;
$('closeSet').onclick = () => { $('settings').classList.remove('on'); if (tracker) tracker.setSources(selectedSources()); render(shown, true); };
$('settings').addEventListener('click', e => { if (e.target === $('settings')) $('closeSet').onclick(); });
$('debugBtn').onclick = () => { S.debug = !S.debug; save(); applyLook(); };
$('testKey').onclick = testKey;
$('showKey').onclick = () => { const k = $('keyInput'); k.type = k.type === 'password' ? 'text' : 'password'; $('showKey').textContent = k.type === 'password' ? 'Show' : 'Hide'; };
$('keyInput').addEventListener('change', () => { S.key = $('keyInput').value.trim(); save(); if (S.key && META) $('loadMsg').textContent = 'Ready.'; });
$('fileBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = async () => {
  const f = $('fileInput').files[0]; if (!f) return;
  $('settings').classList.remove('on');
  if (running) stop();
  try { await start(await f.arrayBuffer()); } catch (e) { log('File failed: ' + e.message); stop(); }
  $('fileInput').value = '';
};
$('prevBtn').onclick = () => { if (shown > 0 && META) { const s = shabadOf(shown); if (shown > META.start[s]) { tracker.line = shown - 1; render(shown - 1); } } };
$('nextBtn').onclick = () => { if (shown >= 0 && META) { const s = shabadOf(shown); const end = s + 1 < META.start.length ? META.start[s + 1] : META.total; if (shown + 1 < end) { tracker.line = shown + 1; render(shown + 1); } } };
const bind = (id, k, after) => { const el = $(id); if (el.type === 'checkbox') { el.checked = S[k]; el.onchange = () => { S[k] = el.checked; save(); applyLook(); after && after(); }; } else { el.value = S[k]; el.oninput = () => { S[k] = el.type === 'range' ? +el.value : el.value; save(); applyLook(); after && after(); }; } };
bind('optTr', 'tr', () => render(shown, true)); bind('optTl', 'tl', () => render(shown, true)); bind('optPa', 'pa', () => render(shown, true));
bind('optNext', 'next', () => render(shown, true)); bind('optDark', 'dark'); bind('optBlank', 'blank'); bind('optSize', 'size'); bind('optLang', 'lang'); bind('optVad', 'vad', () => { manualRejected = false; });
document.querySelectorAll('[data-src]').forEach(cb => { cb.checked = S.srcs[cb.id] !== false; cb.onchange = () => { S.srcs[cb.id] = cb.checked; save(); }; });
$('keyInput').value = S.key;
applyLook();

// ---------- boot ----------
call('init').then(meta => {
  META = meta;
  tracker = new GTracker.Tracker(engineApi, meta);
  tracker.setSources(selectedSources());
  $('loadMsg').textContent = S.key ? 'Ready.' : 'Ready. First, add your Gemini key in ⚙ Settings.';
  $('startBtn').disabled = false;
  log(`Database loaded: ${meta.total.toLocaleString()} lines`);
}).catch(e => { $('loadMsg').textContent = 'Could not load the database: ' + e.message; });
})();
