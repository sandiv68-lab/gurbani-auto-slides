const fs=require('fs');const {Engine}=require('./app/engine.js');const {Tracker,isKatha}=require('./app/tracker.js');const S=require('./app/skeleton.js');
const meta=JSON.parse(fs.readFileSync('app/data/shabads.json'));const e=new Engine(fs.readFileSync('app/data/index.txt','utf8'),meta);
const api={search:async(w,o)=>e.search(w,o),scoreShabad:async(w,s)=>e.scoreShabad(w,s),weight:w=>e.weight(w)};
let seed=+(process.argv[2]||5);const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};const pick=a=>a[Math.floor(rnd()*a.length)];
const NOISE=+(process.argv[3]||1);const cache={};const lines=s=>{const c=Math.floor(s/100);cache[c]=cache[c]||JSON.parse(fs.readFileSync('app/data/c/'+c+'.json'));return cache[c][s%100];};
const SWAP=[['ਤ','ਟ'],['ਦ','ਡ'],['ਨ','ਣ'],['ਬ','ਭ'],['ਕ','ਖ'],['ਗ','ਘ'],['ਜ','ਝ'],['ਪ','ਫ'],['ਦ','ਧ'],['ਤ','ਥ']];
const sing=t=>{const o=[];for(let w of t.replace(/[;,.॥।0-9੦-੯]/g,' ').split(/\s+/).filter(Boolean)){if(rnd()<0.2*NOISE)continue;if(rnd()<0.15*NOISE){const[a,b]=pick(SWAP);w=rnd()<.5?w.replace(a,b):w.replace(b,a);}o.push(w);if(rnd()<0.05)o.push(w);}return o;};
(async()=>{const opts=JSON.parse(process.env.TOPTS||'{}');let ok=0,wrong=0,none=0;const used=[];
for(let k=0;k<150;k++){let s;do{s=Math.floor(rnd()*meta.id.length);}while(![1,1,1,3,2].includes(meta.src[s])||lines(s).length<4);
 const L=lines(s);const st=Math.floor(rnd()*L.length);const stream=[];for(let r=0;r<3;r++)for(let i=st;i<L.length;i++){stream.push(...sing(L[i][0]));stream.push(...sing(L[i][0]));}
 const tr=new Tracker(api,meta,opts);tr.setSources([1,2,3,4,5,6,7,8]);const w=[];let res=null;
 for(let i=0;i<Math.min(stream.length,80);i+=2){w.push(...S.words(stream[i]),...(stream[i+1]?S.words(stream[i+1]):[]));const fin=(i/2)%4===3;
  let snap=await tr.update(w.slice(-40),i*750,{final:fin});if(snap.mode==='locked'){res=[snap.shabad,i+2];break;}}
 if(!res)none++;else{ const same = res[0]===s || lines(res[0]).some(x=>x[0]===L[0][0]); if(same){ok++;used.push(res[1]);}else wrong++;}}
used.sort((a,b)=>a-b);console.log(JSON.stringify(opts),'correct',ok,'wrong',wrong,'notFound',none,'medianWords',used[used.length>>1],'p90',used[Math.floor(used.length*.9)]);})();
