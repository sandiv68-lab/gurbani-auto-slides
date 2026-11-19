// Builds the app's data files from the Shabad OS export (raw/lines.jsonl).
const fs = require('fs');
const path = require('path');
const { toUnicode } = require('gurmukhi-utils');
const Skeleton = require('./app/skeleton.js');

const OUT = path.join(__dirname, 'app', 'data');
const CH = 100; // shabads per content chunk
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'c'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'p'), { recursive: true });

const shabads = fs.readFileSync(path.join(__dirname, 'raw', 'lines.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map(JSON.parse);

const index = [];
const meta = { id: [], src: [], page: [], start: [], rahao: [], chunk: CH, total: 0 };
let cChunk = [], pChunk = [];
const flush = (n) => {
  fs.writeFileSync(path.join(OUT, 'c', n + '.json'), JSON.stringify(cChunk));
  fs.writeFileSync(path.join(OUT, 'p', n + '.json'), JSON.stringify(pChunk));
  cChunk = []; pChunk = [];
};

shabads.forEach((sh, i) => {
  meta.id.push(sh.id); meta.src.push(sh.src); meta.page.push(sh.page);
  meta.start.push(index.length);
  const c = [], p = [];
  for (const [lid, ascii, type, translit, en, pa] of sh.lines) {
    const uni = toUnicode(ascii);
    if (type === 3) meta.rahao.push(index.length);
    index.push(Skeleton.words(uni).join(' '));
    c.push([uni, type, translit, en]);
    p.push(pa);
  }
  cChunk.push(c); pChunk.push(p);
  if (cChunk.length === CH) flush(Math.floor(i / CH));
});
if (cChunk.length) flush(Math.floor((shabads.length - 1) / CH));
meta.total = index.length;

fs.writeFileSync(path.join(OUT, 'index.txt'), index.join('\n'));
fs.writeFileSync(path.join(OUT, 'shabads.json'), JSON.stringify(meta));
console.log('shabads', shabads.length, 'lines', index.length, 'chunks', Math.ceil(shabads.length / CH));
