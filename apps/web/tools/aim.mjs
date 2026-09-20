// Camera framing solver — the tool CameraRig's numbers were derived from.
//
// It replicates CameraRig's transform exactly (axis → aim lift → placement → perspective), so a
// framing can be designed against the HUD's clear window numerically and only then re-shot. Two
// framing bugs that survived several rounds of eyeballing were both caught by this and not by
// looking: the establishing camera standing ON the peninsula with Ocean Beach a full screen-height
// below the frame, and the incident camera stacking downtown at (960, 391) — dead centre behind the
// approval modal that opens in the same moment.
//
// `coverage()` ray-casts the whole clear window back onto the shoreline polygon and reports what
// the frame is actually made of (city / open water / sky). That is the number that separates a
// composition that reads from one with a large dead band above the coast.
//
// No dependencies — plain arithmetic, runs anywhere node does.
//
//   node .shots/aim.mjs <azimuthDeg> <dh> <h> <gx> <gz> [aimRatio] [fov]
//   node .shots/aim.mjs sweep                 -> scores a grid of azimuth/distance/height
//
// azimuth is the compass bearing the camera LOOKS along: 0 = north (-z), 90 = east (+x).
const LON_M = 88200, LAT_M = 110540, oLat = 37.76, oLon = -122.445;
const P = (la, lo) => [((lo - oLon) * LON_M) / 100, (-(la - oLat) * LAT_M) / 100];

const SHORE = [
  [37.8105,-122.4775],[37.8085,-122.464],[37.807,-122.445],[37.809,-122.426],[37.8085,-122.405],
  [37.8005,-122.3935],[37.7905,-122.386],[37.782,-122.387],[37.776,-122.389],[37.7705,-122.383],
  [37.76,-122.386],[37.748,-122.379],[37.735,-122.383],[37.723,-122.39],[37.708,-122.4],
  [37.708,-122.47],[37.708,-122.5045],[37.735,-122.509],[37.76,-122.5105],[37.785,-122.5115],
  [37.802,-122.51],[37.809,-122.49],
].map(([a,b]) => P(a,b));

const onLand = ([x,z]) => {
  let inside = false;
  for (let i=0, j=SHORE.length-1; i<SHORE.length; j=i++) {
    const [xi,zi]=SHORE[i], [xj,zj]=SHORE[j];
    if ((zi>z)!==(zj>z) && x < ((xj-xi)*(z-zi))/(zj-zi)+xi) inside=!inside;
  }
  return inside;
};

// Things a San Franciscan reads the city by. `must` = has to be on screen and unobstructed.
const PTS = [
  ["incident / St Germain", P(37.754,-122.452), "must"],
  ["Sutro Tower",           P(37.7552,-122.4528), "must"],
  ["downtown FiDi",         P(37.7915,-122.399), "must"],
  ["Salesforce",            P(37.7897,-122.3972), "must"],
  ["Transamerica",          P(37.7952,-122.4028), ""],
  ["Ferry Building",        P(37.7955,-122.3937), ""],
  ["City Hall",             P(37.7793,-122.4193), ""],
  ["Coit Tower",            P(37.8024,-122.4058), ""],
  ["GG Bridge S tower",     P(37.8072,-122.4752), "must"],
  ["GG Bridge N end",       P(37.8324,-122.4795), ""],
  ["Bay Bridge anchor",     P(37.7905,-122.386), ""],
  ["Bay Bridge E end",      P(37.8199,-122.3589), ""],
  ["GG Park W",             P(37.7695,-122.5105), "must"],
  ["GG Park E",             P(37.7695,-122.454), "must"],
  ["Presidio mid",          P(37.799,-122.4675), ""],
  ["Ocean Beach N",         P(37.785,-122.5115), "must"],
  ["Ocean Beach S",         P(37.735,-122.509), "must"],
  ["Lands End (NW)",        P(37.802,-122.51), ""],
  ["Fort Mason (N shore)",  P(37.807,-122.445), ""],
  ["Hunters Point (SE)",    P(37.735,-122.383), ""],
  ["Candlestick (SE)",      P(37.723,-122.39), ""],
];

const W=1920, H=1080, aspect=W/H;
// HUD: calls column, incident panel, action rail. The approval modal only covers the gate states.
const CLEAR = { x0:330, x1:1460, y0:48, y1:945 };
const MODAL = { x0:612, x1:1178, y0:285, y1:705 };

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const norm=a=>{const l=Math.hypot(...a);return [a[0]/l,a[1]/l,a[2]/l];};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

function solve(azDeg, dh, h, gx, gz, aimRatio, fov, groundY = 0) {
  const a = (azDeg*Math.PI)/180;
  const VIEW=[Math.sin(a),0,-Math.cos(a)];
  const target=[gx, groundY + dh*aimRatio, gz];
  const pos=[target[0]-VIEW[0]*dh, target[1]+h, target[2]-VIEW[2]*dh];
  const f=norm(sub(target,pos)), r=norm(cross(f,[0,1,0])), u=cross(r,f);
  const tanHalf=Math.tan((fov*Math.PI)/360);
  const projPt=([x,z])=>{
    const d=sub([x,0,z],pos), zc=dot(d,f);
    if(zc<=0) return null;
    return [((dot(d,r)/zc/(tanHalf*aspect))+1)/2*W, (1-dot(d,u)/zc/tanHalf)/2*H, zc];
  };
  const pitch=(Math.atan2(h,dh)*180)/Math.PI;
  const horizonY=H/2-(Math.atan2(h,dh)/((fov*Math.PI)/180))*H;
  return { VIEW, pos, target, projPt, pitch, horizonY };
}

const MARKET=[P(37.7946,-122.3945),P(37.7625,-122.435)];
const mdir=norm([MARKET[1][0]-MARKET[0][0],0,MARKET[1][1]-MARKET[0][1]]);


// What fraction of the HUD's clear window actually has city in it? Ray-cast every sample point
// back to the ground plane and test the shoreline polygon. This is the number that separates a
// framing that reads from one with a large dead band of open water and sky above the coast.
function coverage(S, fov){
  const tanHalf=Math.tan((fov*Math.PI)/360);
  let land=0, water=0, sky=0, total=0;
  for(let sy=CLEAR.y0; sy<=CLEAR.y1; sy+=9)
   for(let sx=CLEAR.x0; sx<=CLEAR.x1; sx+=9){
     total++;
     const ndcx=((sx/W)*2-1)*tanHalf*aspect, ndcy=(1-(sy/H)*2)*tanHalf;
     const f=norm(sub(S.target,S.pos)), r=norm(cross(f,[0,1,0])), u=cross(r,f);
     const dir=[f[0]+r[0]*ndcx+u[0]*ndcy, f[1]+r[1]*ndcx+u[1]*ndcy, f[2]+r[2]*ndcx+u[2]*ndcy];
     if(dir[1]>=-1e-6){ sky++; continue; }
     const t=-S.pos[1]/dir[1];
     if(t<=0||t>900){ sky++; continue; }
     const hit=[S.pos[0]+dir[0]*t, S.pos[2]+dir[2]*t];
     if(onLand(hit)) land++; else water++;
   }
  return { land: land/total*100, water: water/total*100, sky: sky/total*100 };
}

function report(azDeg, dh, h, gx, gz, aimRatio=0.22, fov=51, groundY=0) {
  const S=solve(azDeg,dh,h,gx,gz,aimRatio,fov,groundY);
  const camOnLand=onLand([S.pos[0],S.pos[2]]);
  const mAng=(Math.acos(Math.min(1,Math.abs(dot(mdir,S.VIEW))))*180)/Math.PI;
  console.log(`azimuth ${azDeg}deg  dh ${dh}  h ${h}  ground (${gx}, ${gz})  aimRatio ${aimRatio}  fov ${fov}`);
  console.log(`camera  (${S.pos.map(v=>v.toFixed(1)).join(", ")})  ${camOnLand?"*** ON LAND ***":"over water"}`);
  console.log(`pitch ${S.pitch.toFixed(1)}deg   horizon screen y ${S.horizonY.toFixed(0)}   Market vs view axis ${mAng.toFixed(0)}deg`);
  const cov = coverage(S, fov);
  console.log(`clear window: land ${cov.land.toFixed(0)}%   open water ${cov.water.toFixed(0)}%   sky ${cov.sky.toFixed(0)}%\n`);
  for (const [name,p,must] of PTS) {
    const q=S.projPt(p);
    if(!q){console.log(`${name.padEnd(24)} BEHIND CAMERA  ${must?"<<< MUST":""}`);continue;}
    const [sx,sy,zc]=q;
    const on=sx>=0&&sx<=W&&sy>=0&&sy<=H;
    const clear=sx>=CLEAR.x0&&sx<=CLEAR.x1&&sy>=CLEAR.y0&&sy<=CLEAR.y1;
    const inModal=sx>=MODAL.x0&&sx<=MODAL.x1&&sy>=MODAL.y0&&sy<=MODAL.y1;
    const tag=!on?"OFF-SCREEN":inModal?"under modal":clear?"clear":"under HUD";
    const warn=must&&(!on||!clear)?"  <<< MUST":"";
    console.log(`${name.padEnd(24)} (${sx.toFixed(0).padStart(5)},${sy.toFixed(0).padStart(5)})  dist ${zc.toFixed(0).padStart(3)}  ${tag}${warn}`);
  }
}

function score(azDeg,dh,h,gx,gz,aimRatio,fov){
  const S=solve(azDeg,dh,h,gx,gz,aimRatio,fov);
  if(onLand([S.pos[0],S.pos[2]])) return -1e9;
  if(S.horizonY<70||S.horizonY>330) return -1e9;
  let s=0, dt=null;
  for(const [name,p,must] of PTS){
    const q=S.projPt(p);
    if(!q){ if(must) return -1e9; continue; }
    const [sx,sy,zc]=q;
    const on=sx>=0&&sx<=W&&sy>=0&&sy<=H;
    const clear=sx>=CLEAR.x0&&sx<=CLEAR.x1&&sy>=CLEAR.y0&&sy<=CLEAR.y1;
    if(must&&(!on||!clear)) return -1e9;
    if(on) s+=2; if(clear) s+=3;
    if(name==="downtown FiDi") dt=zc;
  }
  // Market as a diagonal, and downtown close enough to have presence.
  const mAng=(Math.acos(Math.min(1,Math.abs(dot(mdir,S.VIEW))))*180)/Math.PI;
  s += mAng*0.35;
  if(dt) s += Math.max(0, 60 - Math.abs(dt-85)*0.9);
  return s;
}


if(process.argv[2]==="grid"){
  console.log("   az   dh    h   gx   gz | land% water%  sky% | missing must-haves");
  for(const az of [285,292.5,300,310,320,330])
   for(const dh of [55,65,75,85,95])
    for(const h of [20,26,32])
     for(const gx of [0,12,24])
      for(const gz of [-25,-12,0]){
        const S=solve(az,dh,h,gx,gz,0.22,51);
        if(onLand([S.pos[0],S.pos[2]])) continue;
        const miss=[];
        for(const [name,pt,must] of PTS){
          if(!must) continue;
          const q=S.projPt(pt);
          const ok=q&&q[0]>=CLEAR.x0&&q[0]<=CLEAR.x1&&q[1]>=CLEAR.y0&&q[1]<=CLEAR.y1;
          if(!ok) miss.push(name.split(" ")[0]);
        }
        const cov=coverage(S,51);
        if(miss.length>1||cov.land<42) continue;
        console.log(`${String(az).padStart(5)} ${String(dh).padStart(4)} ${String(h).padStart(4)} ${String(gx).padStart(4)} ${String(gz).padStart(4)} | ${cov.land.toFixed(0).padStart(5)} ${cov.water.toFixed(0).padStart(5)} ${cov.sky.toFixed(0).padStart(5)} | ${miss.join(",")||"none"}`);
      }
  process.exit(0);
}

if(process.argv[2]==="sweep"){
  const out=[];
  for(let az=0; az<360; az+=7.5)
   for(let dh=70; dh<=140; dh+=10)
    for(let h=20; h<=60; h+=6)
     for(let gx=-20; gx<=25; gx+=15)
      for(let gz=-35; gz<=10; gz+=15){
        const v=score(az,dh,h,gx,gz,0.22,51);
        if(v>-1e8) out.push([v,az,dh,h,gx,gz]);
      }
  out.sort((a,b)=>b[0]-a[0]);
  console.log(`${out.length} viable framings. Top 25:\n`);
  console.log("score   az    dh   h   gx   gz");
  for(const r of out.slice(0,25)) console.log(r.map((v,i)=>String(i===0?v.toFixed(1):v).padStart(i===0?6:5)).join(" "));
} else {
  const [az,dh,h,gx,gz,ar,fov,gy]=process.argv.slice(2).map(Number);
  report(az,dh,h,gx,gz,Number.isFinite(ar)?ar:0.22,Number.isFinite(fov)?fov:51,Number.isFinite(gy)?gy:0);
}
