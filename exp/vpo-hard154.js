// A26-hard154-v1: scattered ten-treasure environment, unchanged 1761/64/4 surrogate.
'use strict';
const A = require('./vpo-a25.js');
const D = require('./vpo-a25d.js');
const crypto = require('crypto');
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const score = v => A.dot(A.WSTAR, v);
const key = p => p.map(c => c.join(',')).join('|');
const NB = [[1,0],[-1,0],[0,1],[0,-1]];
// E is terminal, never an internal path node. Deterministic BFS tie order.
function trace(mz, from, to, avoid) {
  const q = [from], prev = new Map([[from.join(','), null]]), lava = new Set(mz.lava.map(c => c.join(',')));
  for (let h = 0; h < q.length; h++) {
    const c = q[h]; if (c[0] === to[0] && c[1] === to[1]) {
      const p = []; for(let k = c.join(','); k !== null; k = prev.get(k)) p.push(k.split(',').map(Number));
      return p.reverse();
    }
    for (const [dr,dc] of NB) {
      const r = c[0]+dr, col=c[1]+dc, k=r+','+col;
      if(r<0||r>=9||col<0||col>=9||mz.grid[r][col]===A.WALL||prev.has(k)) continue;
      if(r===mz.E[0]&&col===mz.E[1]&& !(r===to[0]&&col===to[1])) continue;
      if(avoid&&lava.has(k)) continue;
      prev.set(k,c.join(','));q.push([r,col]);
    }
  }
  return null;
}
// One shortest visit ordering per subset/last state per kernel. Not all possible paths.
function kernel(mz, avoid) {
  const items=mz.gold.concat(mz.diam), n=items.length, pts=[mz.S,...items,mz.E];
  const legs=pts.map(a=>pts.map(b=>trace(mz,a,b,avoid)));
  const size=(1<<n)*n, dist=new Float64Array(size).fill(Infinity), prev=new Int16Array(size).fill(-1);
  for(let j=0;j<n;j++) if(legs[0][j+1]) dist[(1<<j)*n+j]=legs[0][j+1].length-1;
  for(let mask=1;mask<(1<<n);mask++) for(let j=0;j<n;j++) {
    const idx=mask*n+j;if(!Number.isFinite(dist[idx]))continue;
    for(let k=0;k<n;k++) if(!(mask&(1<<k))&&legs[j+1][k+1]) {
      const next=(mask|(1<<k))*n+k, v=dist[idx]+legs[j+1][k+1].length-1;
      if(v<dist[next]) {dist[next]=v;prev[next]=j;}
    }
  }
  const pathAt=(mask,last)=>{
    const order=[];let m=mask,j=last;
    while(m) {order.push(j+1);const p=prev[m*n+j];m^=1<<j;j=p;}
    order.reverse();const out=[mz.S];let from=0;
    for(const dest of [...order,n+1]) {const leg=legs[from][dest];if(!leg)return null;out.push(...leg.slice(1));from=dest;}
    return out;
  };
  let all=Infinity;
  for(let j=0;j<n;j++) if(legs[j+1][n+1]) all=Math.min(all,dist[((1<<n)-1)*n+j]+legs[j+1][n+1].length-1);
  return {legs,dist,pathAt,all,n};
}
function makeMaze(seed) {
  const old=A.makeMaze(seed), rng=globalThis.RLA.rng.make(seed*17+154);
  const mz={...old,gold:[],diam:[],lava:[],nGold:5,nDiam:5,nLava:5,regime:'A26-hard154-v1'};
  const pool=[];
  for(let r=0;r<9;r++)for(let c=0;c<9;c++) {
    if(mz.grid[r][c]===A.WALL||[mz.S,mz.E].some(p=>p[0]===r&&p[1]===c))continue;
    if(trace(mz,mz.S,[r,c],false))pool.push([r,c]);
  }
  if(pool.length<15)throw Error('construction: fewer than15 eligible cells ID '+seed);
  const take=()=>pool.splice(rng.int(pool.length),1)[0];
  mz.gold=Array.from({length:5},take);mz.diam=Array.from({length:5},take);mz.lava=Array.from({length:5},take);
  const k=kernel(mz,false), direct=k.legs[0][11];
  if(!direct||!Number.isFinite(k.all)||k.all<=direct.length-1)throw Error('construction: invalid distance gap ID '+seed);
  mz.directLength=direct.length-1;mz.allLength=k.all;
  mz.budget=Math.floor(mz.directLength+0.55*(mz.allLength-mz.directLength));
  return mz;
}
const cache=new WeakMap();
function menu(mz) {
  if(cache.has(mz))return cache.get(mz);
  const paths=[],seen=new Set();
  const add=p=>{if(!p||p.length-1>mz.budget)return;const k=key(p);if(seen.has(k))return;const vec=A.replayVec(mz,p);if(!vec)return;seen.add(k);paths.push({path:p,vec,score:score(vec)});};
  for(const avoid of [false,true]) {
    const k=kernel(mz,avoid);add(k.legs[0][k.n+1]);
    for(let m=1;m<(1<<k.n);m++)for(let j=0;j<k.n;j++) if((m&(1<<j))&&k.legs[j+1][k.n+1]&&k.dist[m*k.n+j]+k.legs[j+1][k.n+1].length-1<=mz.budget) add(k.pathAt(m,j));
  }
  if(!paths.length)throw Error('empty finite menu ID '+mz.seed);
  const result={paths,top:Math.max(...paths.map(p=>p.score)),rewardVectors:[...new Set(paths.map(p=>JSON.stringify(p.vec)))].length,hash:hash(paths)};
  cache.set(mz,result);return result;
}
function plan(mz) {
  const paths=menu(mz).paths, out=[],seen=new Set();
  for(const dim of [1,2,null]) {
    const sorted=paths.slice().sort((a,b)=>(dim===null?0:b.vec[dim]-a.vec[dim])||b.score-a.score||a.path.length-b.path.length||key(a.path).localeCompare(key(b.path),'en'));
    const p=sorted[0].path,k=key(p);if(!seen.has(k)){seen.add(k);out.push(p);}
  }
  return out;
}
const buildBase=A.buildBaseWithPlanner(D.featuresA25d,D.FDIM,plan);
module.exports={...D,makeMaze,menu,plan,buildBase,trace,kernel,hash,score};
