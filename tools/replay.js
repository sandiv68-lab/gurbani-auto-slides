const fs=require('fs');const {Engine}=require('./app/engine.js');const {Tracker,isKatha}=require('./app/tracker.js');const S=require('./app/skeleton.js');
const meta=JSON.parse(fs.readFileSync('app/data/shabads.json'));const e=new Engine(fs.readFileSync('app/data/index.txt','utf8'),meta);
const api={search:async(w,o)=>e.search(w,o),scoreShabad:async(w,s)=>e.scoreShabad(w,s),weight:w=>e.weight(w)};
const get=(l)=>{const s=e.lineShabad[l];const c=JSON.parse(fs.readFileSync('app/data/c/'+Math.floor(s/100)+'.json'))[s%100];return c[l-meta.start[s]][0]};
const text=process.argv[2]; const srcs=(process.argv[3]||'1,2,3,4,5,6,7,8').split(',').map(Number);
(async()=>{const tr=new Tracker(api,meta);tr.setSources(srcs);const words=S.words(text);let now=0;const raw=text.split(/\s+/);
for(let i=2;i<=words.length;i+=2){now+=1500;const fin=(i/2)%4===0; let snap; for (let k=0;k<3;k++) snap=await tr.update(words.slice(0,i).slice(-40),now+k*300,{final: fin && k===2, katha:isKatha(raw.slice(0,i).join(' '))});
 console.log(String(i).padStart(3),raw.slice(Math.max(0,i-2),i).join(' ').padEnd(22),snap.mode.padEnd(6),snap.shabad>=0?meta.src[snap.shabad]+'/'+meta.page[snap.shabad]:'',snap.line>=0?get(snap.line).slice(0,40):'',snap.note||'', (snap.candidates[0]? 'top '+snap.candidates[0].score.toFixed(2)+' '+meta.src[snap.candidates[0].shabad]+'/'+meta.page[snap.candidates[0].shabad]:''));}})();
