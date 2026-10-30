/* Cronometro corsa — GPS, fasce di ritmo, storico e record. Tutto resta sul telefono. */
(function(){
"use strict";
var VERSION = "2.3";

/* ============================ utilità ============================ */
var $ = function(id){ return document.getElementById(id); };
function now(){ return Date.now(); }
function P(m,s){ return m*60+(s||0); }
function pad(n){ return (n<10?"0":"")+n; }
function fmtT(ms){ var s=Math.max(0,Math.floor(ms/1000)), h=Math.floor(s/3600), m=Math.floor(s%3600/60), r=s%60;
  return (h? h+":"+pad(m) : m)+":"+pad(r); }
function fmtP(sec){ if(sec==null||!isFinite(sec)||sec<=0||sec>1500) return "—"; sec=Math.round(sec); return Math.floor(sec/60)+":"+pad(sec%60); }
function fmtKm(m, dec){ return (m/1000).toFixed(dec==null?2:dec).replace(".",","); }
function sayP(sec){ sec=Math.round(sec); var m=Math.floor(sec/60), s=sec%60; return s===0 ? m+" netti" : (s<10 ? m+" e zero "+s : m+" e "+s); }
function sayT(ms){ var s=Math.round(ms/1000), h=Math.floor(s/3600), m=Math.floor(s%3600/60), r=s%60, a=[];
  if(h) a.push(h+(h===1?" ora":" ore")); if(m) a.push(m+(m===1?" minuto":" minuti")); if(r) a.push(r+" secondi");
  return a.join(" e "); }
function parseP(txt){ var m=String(txt).trim().replace(/[.,']/,":").match(/^(\d{1,2}):(\d{1,2})$/); if(!m) return null;
  var v=(+m[1])*60+(+m[2]); return (+m[2])<60 && v>=150 && v<=900 ? v : null; }
function parseT(txt){ var p=String(txt).trim().replace(/[.,]/g,":").split(":").map(Number); if(p.some(isNaN)) return null;
  if(p.length===2) return (p[0]*60+p[1])*1000; if(p.length===3) return (p[0]*3600+p[1]*60+p[2])*1000; return null; }
function isoDay(ms){ var d=new Date(ms); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
var GG=["dom","lun","mar","mer","gio","ven","sab"], MM=["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];
function dataLunga(ms){ var d=new Date(ms); return GG[d.getDay()]+" "+d.getDate()+" "+MM[d.getMonth()]+" "+d.getFullYear()+" · "+pad(d.getHours())+":"+pad(d.getMinutes()); }
function dataBreve(ms){ var d=new Date(ms); return GG[d.getDay()]+" "+d.getDate()+" "+MM[d.getMonth()]; }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function hav(a,b){ var R=6371008.8, k=Math.PI/180, dLa=(b[0]-a[0])*k, dLo=(b[1]-a[1])*k;
  var x=Math.sin(dLa/2)*Math.sin(dLa/2)+Math.cos(a[0]*k)*Math.cos(b[0]*k)*Math.sin(dLo/2)*Math.sin(dLo/2);
  return 2*R*Math.asin(Math.min(1,Math.sqrt(x))); }
function lsGet(k){ try{ var r=localStorage.getItem(k); return r? JSON.parse(r) : null; }catch(e){ return null; } }
function lsSet(k,v){ try{ if(v===null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

/* ============================ sedute del piano ============================ */
/* ogni blocco: n nome, t time|dist|open, v durata in s o distanza in m, k warm|work|rec|cool,
   lo = il passo più veloce ammesso, hi = il più lento (secondi al km, null = nessun limite) */
function T(n,min,k,lo,hi){ return {n:n,t:"time",v:min*60,k:k,lo:lo==null?null:lo,hi:hi==null?null:hi}; }
function D(n,m,k,lo,hi){ return {n:n,t:"dist",v:m,k:k,lo:lo==null?null:lo,hi:hi==null?null:hi}; }
function O(n,k,lo,hi){ return {n:n,t:"open",v:0,k:k,lo:lo==null?null:lo,hi:hi==null?null:hi}; }
var WARM = function(min){ return T("Riscaldamento",min,"warm",P(6,10),null); };
var COOL = function(min){ return T("Defaticamento",min,"cool",P(6,10),null); };
function rip(n,first,rest){
  var a=[WARM(15)];
  for(var i=1;i<=n;i++){ var p=i===1?first:rest; a.push(D("Ripetuta "+i+" di "+n,1000,"work",p-5,p+5)); if(i<n) a.push(T("Recupero",2,"rec")); }
  a.push(COOL(10)); return a;
}
function medio(min){ return [WARM(12), T("Medio "+min+"′",min,"work",P(5,25),P(5,35)), COOL(13)]; }
function finale(km,fin){ return [D("Lungo · "+km+" km",km*1000,"work",P(6,20),null), D("Finale · "+fin+" km",fin*1000,"work",P(5,45),P(5,55))]; }
function tkm(n,p){ return D("Test · km "+n,1000,"work",p-4,p+4); }
var PRESETS = [
 {id:"libero", nome:"Corsa libera", corto:"Corsa libera", kind:"libero"},
 {id:"rip5", nome:"Ripetute 5 × 1000 m · prima a 5:10, poi 5:05", corto:"Ripetute 5 × 1000 m", kind:"rip", segs:rip(5,P(5,10),P(5,5))},
 {id:"rip6", nome:"Ripetute 6 × 1000 m · prima a 5:10, poi 5:05", corto:"Ripetute 6 × 1000 m", kind:"rip", segs:rip(6,P(5,10),P(5,5))},
 {id:"rip6f", nome:"Ripetute 6 × 1000 m · prima a 5:00, poi 4:55", corto:"Ripetute 6 × 1000 m", kind:"rip", segs:rip(6,P(5,0),P(4,55))},
 {id:"rip4", nome:"Ripetute 4 × 1000 m a 4:55", corto:"Ripetute 4 × 1000 m", kind:"rip", segs:rip(4,P(4,55),P(4,55))},
 {id:"fac30", nome:"Facile 30′", corto:"Facile", kind:"facile", segs:[T("Facile",30,"work",P(6,10),null)]},
 {id:"lento30", nome:"Corsa lenta 30′", corto:"Corsa lenta", kind:"facile", segs:[T("Lenta",30,"work",P(6,20),null)]},
 {id:"fac38", nome:"Facile 38′", corto:"Facile", kind:"facile", segs:[T("Facile",38,"work",P(6,10),null)]},
 {id:"fac40", nome:"Facile 40′", corto:"Facile", kind:"facile", segs:[T("Facile",40,"work",P(6,10),null)]},
 {id:"med2x10", nome:"Medio spezzato 2 × 10′ a 5:30", corto:"Medio 2 × 10′", kind:"medio",
   segs:[WARM(12), T("Medio 1 di 2",10,"work",P(5,25),P(5,35)), T("Recupero",3,"rec"), T("Medio 2 di 2",10,"work",P(5,25),P(5,35)), COOL(11)]},
 {id:"med20", nome:"Medio continuo 20′ a 5:30", corto:"Medio 20′", kind:"medio", segs:medio(20)},
 {id:"med15", nome:"Medio corto 15′ al ritmo dei 10 km", corto:"Medio corto 15′", kind:"medio",
   segs:[WARM(12), T("Ritmo 10 km · 15′",15,"work",P(5,20),P(5,30)), COOL(10)]},
 {id:"med25", nome:"Medio continuo 25′ a 5:30", corto:"Medio 25′", kind:"medio", segs:medio(25)},
 {id:"lungo10", nome:"Lungo facile 10 km", corto:"Lungo facile 10 km", kind:"lungo", segs:[D("Lungo · 10 km",10000,"work",P(6,20),null)]},
 {id:"lungo12", nome:"Lungo 12 km, nessun finale", corto:"Lungo 12 km", kind:"lungo", segs:[D("Lungo · 12 km",12000,"work",P(6,20),null)]},
 {id:"lungo12f", nome:"Lungo 12 km, ultimi 2 a 5:50", corto:"Lungo 12 km con finale", kind:"lungo", segs:finale(10,2)},
 {id:"lungo13f", nome:"Lungo 13 km, ultimi 3 a 5:50", corto:"Lungo 13 km con finale", kind:"lungo", segs:finale(10,3)},
 {id:"test5", nome:"Test 5 km · 5:05, poi 5:00, ultimo libero", corto:"Test 5 km", kind:"test5",
   segs:[T("Riscaldamento e allunghi",10,"warm"), tkm(1,P(5,5)), tkm(2,P(5,0)), tkm(3,P(5,0)), tkm(4,P(5,0)), D("Test · km 5, quello che resta",1000,"work"), COOL(10)]},
 {id:"test10", nome:"Test 10 km a ritmo costante", corto:"Test 10 km", kind:"test10",
   segs:[T("Riscaldamento e allunghi",10,"warm"), D("Test · 10 km",10000,"work",P(5,20),P(5,30)), COOL(5)]}
];
var BY = {}; PRESETS.forEach(function(p){ BY[p.id]=p; });
var OGGI_PIANO = {"2026-10-20":"rip5","2026-10-21":"fac38","2026-10-23":"med2x10","2026-10-24":"lungo12","2026-10-25":"lungo12",
 "2026-10-27":"rip6","2026-10-28":"fac40","2026-10-30":"med20","2026-10-31":"lungo12f","2026-11-01":"lungo12f",
 "2026-11-03":"rip6f","2026-11-04":"fac40","2026-11-06":"med25","2026-11-07":"lungo13f","2026-11-08":"lungo13f",
 "2026-11-10":"rip4","2026-11-11":"fac30","2026-11-13":"test5","2026-11-14":"lungo10","2026-11-15":"lungo10",
 "2026-11-17":"med15","2026-11-18":"lento30","2026-11-20":"test10"};
var CHIPS = [["Facile",P(6,10),P(6,30)],["Lungo",P(6,20),P(6,35)],["Medio",P(5,25),P(5,35)],
             ["Ritmo 10 km",P(5,25),P(5,35)],["Ripetute",P(4,55),P(5,5)],["Nessuna",null,null]];

function targetTxt(s){
  if(!s || (s.lo==null && s.hi==null)) return "libero";
  if(s.lo!=null && s.hi!=null) return fmtP(s.lo)+"–"+fmtP(s.hi);
  return s.lo!=null ? "non sotto "+fmtP(s.lo) : "non sopra "+fmtP(s.hi);
}
function targetSay(s){
  if(s.lo!=null && s.hi!=null) return "Fra "+sayP(s.lo)+" e "+sayP(s.hi);
  if(s.lo!=null) return "Non sotto "+sayP(s.lo);
  if(s.hi!=null) return "Non sopra "+sayP(s.hi);
  return "";
}
function lenTxt(s){
  if(s.t==="time") return Math.round(s.v/60)+"′";
  if(s.t==="dist") return s.v>=2000 ? String(s.v/1000).replace(".",",")+" km" : s.v+" m";
  return "a piacere";
}
function band(s,p,extra){
  if(!s || p==null || (s.lo==null && s.hi==null)) return "none";
  var e = extra||0; p = Math.round(p);
  if(s.lo!=null && p < s.lo - e) return "fast";
  if(s.hi!=null && p > s.hi + e) return "slow";
  return "ok";
}

/* ============================ impostazioni ============================ */
var SET_KEY = "cc-settings";
var S = Object.assign({voce:true, km:true, vib:true, auto:true, free:{lo:P(6,0), hi:P(6,20)}}, lsGet(SET_KEY)||{});
function saveSet(){ lsSet(SET_KEY, S); }
var SEL = {id:"libero", shift:0, over:{}, open:-1};

function buildSegs(){
  var pr = BY[SEL.id];
  if(pr.kind==="libero") return [O("Corsa libera","work",S.free.lo,S.free.hi)];
  return pr.segs.map(function(s,i){
    var c = JSON.parse(JSON.stringify(s));
    if(c.k==="work"){ if(c.lo!=null) c.lo += SEL.shift; if(c.hi!=null) c.hi += SEL.shift; }
    if(SEL.over[i]){ c.lo = SEL.over[i].lo; c.hi = SEL.over[i].hi; }
    return c;
  });
}
function boundRow(i, key, s){
  var on = s[key]!=null, v = on ? fmtP(s[key]) : "—";
  var lab = key==="lo" ? "Avvisa se più veloce di" : "Avvisa se più lento di";
  return "<div class='bound'><label class='chk'><input type='checkbox' "+(on?"checked":"")+" onchange='App.bTog("+i+",\""+key+"\",this.checked)'>"+lab+"</label>"+
    "<div class='stepper'><button onclick='App.bStep("+i+",\""+key+"\",-5)' "+(on?"":"disabled")+" aria-label='5 secondi più veloce'>&minus;5</button>"+
    "<input value='"+v+"' "+(on?"":"disabled")+" inputmode='numeric' onchange='App.bSet("+i+",\""+key+"\",this.value)' aria-label='passo'>"+
    "<button onclick='App.bStep("+i+",\""+key+"\",5)' "+(on?"":"disabled")+" aria-label='5 secondi più lento'>+5</button></div></div>";
}
function renderSetup(){
  var pr = BY[SEL.id], free = pr.kind==="libero";
  $("selPreset").value = SEL.id;
  $("freeBox").style.display = free ? "block" : "none";
  $("shiftBox").style.display = free ? "none" : "flex";
  $("shiftV").innerHTML = (SEL.shift>0?"+":SEL.shift<0?"&minus;":"")+Math.abs(SEL.shift)+"&Prime;";
  $("freeChips").innerHTML = CHIPS.map(function(c,i){
    var on = c[1]===S.free.lo && c[2]===S.free.hi;
    return "<button aria-pressed='"+on+"' onclick='App.chip("+i+")'>"+c[0]+(c[1]?" "+fmtP(c[1])+"–"+fmtP(c[2]):"")+"</button>"; }).join("");
  var segs = buildSegs(), h = "";
  segs.forEach(function(s,i){
    var open = free || SEL.open===i;
    h += "<div class='seg'><div class='segHead' onclick='App.segOpen("+i+")'><span class='sn'>"+esc(s.n)+"</span><span class='sv'>"+lenTxt(s)+
      "</span><span class='tg "+(s.k==="work"?"work":"")+((s.lo==null&&s.hi==null)?" free":"")+"'>"+targetTxt(s)+"</span></div>";
    if(open) h += "<div class='rangeEd'>"+boundRow(i,"lo",s)+boundRow(i,"hi",s)+"</div>";
    h += "</div>";
  });
  $("plan").innerHTML = h;
  $("optVoce").checked=S.voce; $("optKm").checked=S.km; $("optVib").checked=S.vib; $("optAuto").checked=S.auto;
}
function setBound(i, key, val){
  var segs = buildSegs(), s = segs[i]; if(!s) return;
  s[key] = val;
  if(s.lo!=null && s.hi!=null && s.lo > s.hi){ if(key==="lo") s.hi = s.lo; else s.lo = s.hi; }
  if(BY[SEL.id].kind==="libero"){ S.free = {lo:s.lo, hi:s.hi}; saveSet(); }
  else SEL.over[i] = {lo:s.lo, hi:s.hi};
  renderSetup();
}

/* ============================ archivio (IndexedDB) ============================ */
var DB = null, METAS = [], DB_OK = true;
function dbOpen(){
  return new Promise(function(res){
    try{
      var r = indexedDB.open("cronometro-corsa", 1);
      r.onupgradeneeded = function(){ var d=r.result; d.createObjectStore("meta",{keyPath:"id"}); d.createObjectStore("track",{keyPath:"id"}); };
      r.onsuccess = function(){ DB=r.result; res(true); };
      r.onerror = function(){ DB_OK=false; res(false); };
    }catch(e){ DB_OK=false; res(false); }
  });
}
function dbReq(store, mode, fn){
  return new Promise(function(res, rej){
    if(!DB){ res(null); return; }
    var tx = DB.transaction(store, mode), q = fn(tx.objectStore(store)), out = null;
    if(q) q.onsuccess = function(){ out = q.result; };
    tx.oncomplete = function(){ res(out); }; tx.onerror = function(){ rej(tx.error); };
  });
}
function dbAll(store){ return dbReq(store,"readonly",function(o){ return o.getAll(); }); }
function dbGet(store,id){ return dbReq(store,"readonly",function(o){ return o.get(id); }); }
function dbPut(store,obj){ return dbReq(store,"readwrite",function(o){ return o.put(obj); }); }
function dbDel(store,id){ return dbReq(store,"readwrite",function(o){ return o.delete(id); }); }
function loadMetas(){ return dbAll("meta").then(function(a){ METAS = (a||[]).sort(function(x,y){ return y.start-x.start; }); }); }

/* ============================ record ============================ */
var DISTS = [[1000,"1 km"],[2000,"2 km"],[5000,"5 km"],[10000,"10 km"]];
/* miglior tempo su una distanza D lungo la serie (t ms in movimento, d metri), con interpolazione */
function bestEffort(t, d, D){
  if(!t || t.length<2 || d[d.length-1] < D) return null;
  var best = null, j = 0;
  for(var i=1;i<d.length;i++){
    if(d[i] < D) continue;
    var target = d[i]-D;
    while(j+1<d.length && d[j+1] <= target) j++;
    var ts = (j+1<d.length && d[j+1]>d[j]) ? t[j] + (target-d[j])/(d[j+1]-d[j])*(t[j+1]-t[j]) : t[j];
    var dur = t[i]-ts;
    if(dur>0 && (best===null || dur<best)) best = dur;
  }
  return best===null ? null : Math.round(best);
}
function bestFromSplits(splits, dist, moving, D){
  var out = null;
  if(Math.abs(dist-D) <= D*0.01 && moving) return moving;
  var n = D/1000;
  if(splits && splits.length>=n){
    for(var i=0;i+n<=splits.length;i++){ var s=0; for(var k=i;k<i+n;k++) s+=splits[k]; if(out===null||s<out) out=s; }
  }
  return out;
}
function ranks(){
  var r = {};
  DISTS.forEach(function(dd){
    var D = dd[0];
    r[D] = METAS.filter(function(m){ return m.best && m.best[D]; }).sort(function(a,b){ return a.best[D]-b.best[D]; });
  });
  r.longest = METAS.slice().sort(function(a,b){ return b.dist-a.dist; });
  return r;
}
function badgesFor(m, R){
  var b = [];
  DISTS.forEach(function(dd){
    var i = R[dd[0]].indexOf(m);
    if(i===0) b.push("<span class='badge'>Record "+dd[1]+"</span>");
    else if(i>0 && i<3) b.push("<span class='badge s'>"+(i+1)+"° "+dd[1]+"</span>");
  });
  if(R.longest[0]===m) b.push("<span class='badge'>Corsa più lunga</span>");
  if(m.src!=="app") b.push("<span class='badge imp'>"+(m.src==="manual"?"inserita a mano":"importata")+"</span>");
  return b.join("");
}

/* ============================ GPS ============================ */
var GPS = {acc:null, t:0, err:null, dop:null}, WATCH = null;
var ERR = {
 1:"Il permesso di posizione è negato. In Chrome: tocca il lucchetto accanto all'indirizzo, poi Autorizzazioni, Posizione, Consenti. Controlla anche che la Localizzazione del telefono sia attiva.",
 2:"Posizione non disponibile: attiva la Localizzazione del telefono e riprova all'aperto.",
 3:"Il GPS non risponde ancora. All'aperto il primo segnale può richiedere un minuto."
};
function gpsUi(){
  var a = GPS.acc, cls="", txt="GPS spento";
  if(WATCH!==null){
    if(GPS.err){ cls="bad"; txt="GPS non disponibile"; }
    else if(a==null || now()-GPS.t>15000){ cls="mid"; txt="Attendo il segnale…"; }
    else if(a<=10){ cls="ok"; txt="GPS ottimo · ±"+Math.round(a)+" m"; }
    else if(a<=20){ cls="ok"; txt="GPS buono · ±"+Math.round(a)+" m"; }
    else if(a<=30){ cls="mid"; txt="GPS debole · ±"+Math.round(a)+" m"; }
    else { cls="bad"; txt="GPS scarso · ±"+Math.round(a)+" m"; }
  }
  var full = txt;
  $("gpsDot").className = "gpsDot "+cls; $("gpsTxt").textContent = full;
  var g = $("rsGps"); g.className = "rsGps "+cls; g.textContent = txt.replace("Attendo il segnale…","GPS: attesa");
}
function gpsStart(){
  if(WATCH!==null) return true;
  if(!("geolocation" in navigator)){ gpsFail("Questo browser non offre il GPS alla pagina."); return false; }
  GPS.err = null; $("gpsErr").style.display = "none";
  WATCH = navigator.geolocation.watchPosition(onFix, function(e){
    if(e.code===3){ GPS.err=null; gpsUi(); return; }
    gpsFail(ERR[e.code] || ("Errore GPS: "+e.message));
  }, {enableHighAccuracy:true, maximumAge:0, timeout:30000});
  gpsUi(); return true;
}
function gpsStop(){ if(WATCH!==null){ try{ navigator.geolocation.clearWatch(WATCH); }catch(e){} } WATCH=null; GPS.acc=null; gpsUi(); }
function gpsFail(msg){ GPS.err=msg; var e=$("gpsErr"); e.textContent=msg; e.style.display="block"; gpsUi(); if(CR) $("rsWarn").textContent=msg; }
setInterval(gpsUi, 3000);

/* ============================ corsa ============================ */
var CR = null, TICK = null, WAKE = null, AC = null, LIVE_KEY = "cc-live";
function cur(){ return CR && CR.segs[CR.seg]; }
function fresh(){
  var pr = BY[SEL.id], t = now();
  return {pid:pr.id, nome:pr.corto, kind:pr.kind, segs:buildSegs(), start:t, running:true, paused:false, auto:false, moved:false,
    activeMs:0, lastTick:t, lastMoveW:t, dist:0, anchor:null, mvA:null, buf:[], lastFixW:0, ev:[],
    seg:0, segStartMs:0, segStartD:0, segRes:[], kmNext:1000, kmSplits:[], kmLastMs:0,
    al:{state:"none",n:0,last:0,warned:false,lastCheck:0}, cue:{}, lastSave:0, hiddenAt:0, gaps:0,
    srT:[0], srD:[0], rt:[], dop:false,
    opt:{voce:S.voce, vib:S.vib, km:S.km, auto:S.auto}};
}
function tick(){
  if(!CR) return;
  var t = now();
  if(CR.running && !CR.paused && !CR.auto) CR.activeMs += Math.max(0, t-CR.lastTick);
  CR.lastTick = t;
  /* pausa automatica: fix recenti che dicono "fermo" da oltre 6 secondi (senza fix non si ferma nulla) */
  if(CR.running && !CR.paused && !CR.auto && CR.opt.auto && t-GPS.t < 4000 && t-CR.lastMoveW > 6000){
    CR.auto = true;
    if(CR.moved) say("In pausa.");
  }
}
function pushEv(){
  CR.ev.push({ms:CR.activeMs, d:CR.dist});
  var cut = CR.activeMs-180000; while(CR.ev.length>2 && CR.ev[0].ms<cut) CR.ev.shift();
}
/* Distanza dai punti GPS, come Strava: media degli ultimi 5 punti, poi un nuovo punto conta quando ti sei
   spostato di almeno 5 m (di più se il segnale è impreciso). Al banco, sulla corsa vera del 29 ottobre e su un
   rettilineo con vari tipi di rumore, l'errore resta fra -1,5% e +1,4%. La velocità Doppler del telefono NON si usa:
   sui dati veri leggeva l'11% in meno del reale. */
function onFix(pos){
  var c = pos.coords, t = now();
  GPS.acc = c.accuracy; GPS.t = t; GPS.err = null;
  var spd = (c.speed!=null && !isNaN(c.speed) && c.speed>=0) ? c.speed : null;
  if(spd!=null) GPS.dop = true; else if(GPS.dop===null) GPS.dop = false;
  gpsUi();
  if(!CR || !CR.running) return;
  tick();
  if(CR.paused){ CR.anchor=null; CR.mvA=null; CR.buf=[]; return; }
  if(c.accuracy > 30) return;
  var ll = [c.latitude, c.longitude], lr = [Math.round(ll[0]*1e5)/1e5, Math.round(ll[1]*1e5)/1e5];
  /* movimento: spostamento reale di almeno 6 m, oppure velocità chiaramente da corsa */
  if(!CR.mvA) CR.mvA = {ll:ll, w:t};
  var moving = hav(CR.mvA.ll, ll) >= 6 || (spd!=null && spd >= 1.5);
  if(moving){
    CR.mvA = {ll:ll, w:t}; CR.lastMoveW = t;
    if(!CR.moved && CR.dist===0 && CR.opt.auto){
      /* il tempo parte dal primo passo: l'attesa del segnale non conta */
      CR.activeMs = 0; CR.segStartMs = 0; CR.kmLastMs = 0; CR.srT = [0]; CR.srD = [0]; CR.ev = []; CR.lastTick = t;
      if(CR.anchor) CR.anchor.ms = 0;
    }
    if(CR.auto){ CR.auto = false; CR.lastTick = t; CR.resumeMs = CR.activeMs; if(CR.moved) say("Si riparte."); }
    CR.moved = true;
  }
  if(!CR.auto && (!CR.rtLast || hav(CR.rtLast, lr) >= 5)){ CR.rt.push([Math.round((t-CR.start)/1000), lr[0], lr[1]]); CR.rtLast = lr; }
  /* media mobile degli ultimi 5 punti: azzerata dopo pause e buchi del segnale */
  if(!CR.buf || (CR.lastFixW && t-CR.lastFixW > 8000)) CR.buf = [];
  CR.lastFixW = t;
  CR.buf.push(ll); if(CR.buf.length > 5) CR.buf.shift();
  var sm = [0,0]; CR.buf.forEach(function(q){ sm[0]+=q[0]; sm[1]+=q[1]; }); sm = [sm[0]/CR.buf.length, sm[1]/CR.buf.length];
  if(CR.auto){ CR.anchor = {ll:sm, w:t, ms:CR.activeMs}; return; }
  if(!CR.anchor){ CR.anchor = {ll:sm, w:t, ms:CR.activeMs}; pushEv(); return; }
  var d = hav(CR.anchor.ll, sm), gap = (t-CR.anchor.w)/1000;
  if(gap>0 && gap<10 && hav(CR.anchor.ll, ll)/gap > 12) { CR.buf.pop(); return; }  /* salto del segnale */
  if(d < Math.max(5, Math.min(12, c.accuracy*0.5))) return;      /* fermo o rumore */
  if(gap > 8 && d/gap > 7.5){ CR.anchor = {ll:sm, w:t, ms:CR.activeMs}; return; } /* dopo una sospensione, tratto non plausibile */
  addDist(d, CR.anchor.ms, CR.activeMs);
  CR.anchor = {ll:sm, w:t, ms:CR.activeMs};
  pushEv();
  var n = CR.srT.length-1;
  if(CR.dist - CR.srD[n] >= 10 || CR.activeMs - CR.srT[n] >= 30000){ CR.srT.push(Math.round(CR.activeMs)); CR.srD.push(Math.round(CR.dist*10)/10); }
}
function addDist(d, msA, msB){
  var d0 = CR.dist, d1 = d0+d;
  while(d1 >= CR.kmNext){
    var ms = msA + (CR.kmNext-d0)/d*(msB-msA), split = ms-CR.kmLastMs;
    CR.kmSplits.push(Math.round(split)); CR.kmLastMs = ms; CR.lastKmAt = now();
    var s = cur(), quiet = (CR.kind==="rip"||CR.kind==="medio"||CR.kind==="test5") && s && s.k==="work";
    if(CR.opt.km && !quiet) say("Chilometro "+(CR.kmNext/1000)+". "+sayP(split/1000)+".");
    CR.kmNext += 1000;
  }
  var s2 = cur();
  while(s2 && s2.t==="dist" && d1 >= CR.segStartD+s2.v){
    var end = CR.segStartD+s2.v, msE = msA + (end-d0)/d*(msB-msA);
    nextSeg(msE, end); s2 = cur();
  }
  CR.dist = d1;
}
/* passo su finestra mobile, dai punti di avanzamento esatti */
function rolling(W, from){
  var nowMs = CR.activeMs, cut = Math.max(nowMs-W*1000, from||0);
  var ev = CR.ev.filter(function(x){ return x.ms>=cut; });
  if(ev.length<2) return null;
  var a = ev[0], b = ev[ev.length-1], dd = b.d-a.d, dt = (b.ms-a.ms)/1000;
  if(nowMs-b.ms > 12000 || dt < W*0.4 || dd < 25) return null;
  return dt/dd*1000;
}

/* voce, suoni, vibrazione */
var VOICE = null;
function pickVoice(){ if(!window.speechSynthesis) return; var vs = speechSynthesis.getVoices()||[]; VOICE = vs.filter(function(v){ return /^it/i.test(v.lang); })[0]||null; }
if(window.speechSynthesis){ pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(t){
  if(!CR || !CR.opt.voce || !window.speechSynthesis) return;
  try{ var u = new SpeechSynthesisUtterance(t); u.lang="it-IT"; u.rate=1.05; if(VOICE) u.voice=VOICE; speechSynthesis.speak(u); }catch(e){}
}
function beep(n){
  try{ if(!AC) return;
    for(var i=0;i<(n||1);i++){ var o=AC.createOscillator(), g=AC.createGain(), t0=AC.currentTime+i*0.22;
      o.frequency.value=880; o.connect(g); g.connect(AC.destination);
      g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(0.35,t0+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t0+0.16);
      o.start(t0); o.stop(t0+0.18); } }catch(e){}
}
function vib(p){ if(CR && CR.opt.vib && navigator.vibrate){ try{ navigator.vibrate(p); }catch(e){} } }

/* blocchi */
function annuncia(s){
  var txt = s.n.replace(/ · /g,", ").replace(/′/g," minuti");
  if(s.t==="time" && !/minuti/.test(txt)) txt += ". "+Math.round(s.v/60)+" minuti";
  if(s.t==="dist" && s.v<2000) txt += ". "+s.v+" metri";
  var ts = targetSay(s); if(ts) txt += ". "+ts; else if(s.k==="rec") txt += ", piano";
  say(txt+".");
}
function nextSeg(endMs, endD){
  var s = cur();
  var r = {n:s.n, k:s.k, t:s.t, lo:s.lo, hi:s.hi, d:Math.round(endD-CR.segStartD), ms:Math.round(endMs-CR.segStartMs)};
  CR.segRes.push(r);
  if(s.k==="work" && r.d>50){
    var pace = r.ms/1000/(r.d/1000);
    if(s.t==="dist" && s.v<=1000) say("Fatto. "+sayP(pace)+".");
    else if(s.t!=="open") say("Fine blocco. Media "+sayP(pace)+".");
  }
  CR.seg++; CR.segStartMs=endMs; CR.segStartD=endD; CR.cue={}; CR.al={state:"none",n:0,last:0,warned:false,lastCheck:0};
  if(CR.seg >= CR.segs.length){
    CR.segs.push(O("Fuori programma","cool"));
    beep(3); vib([300,120,300,120,300]);
    if(CR.kind==="test5"){ var t5 = CR.segRes.filter(function(x){ return /^Test/.test(x.n); }).reduce(function(a,x){ return a+x.ms; },0);
      if(t5) say("Test finito. Cinque chilometri in "+sayT(t5)+"."); }
    say("Programma finito. Ferma il cronometro quando vuoi.");
  } else { beep(2); vib([250,100,250]); annuncia(cur()); }
}
function cues(){
  var s = cur(); if(!s) return;
  if(s.t==="time"){ var rem = s.v*1000-(CR.activeMs-CR.segStartMs);
    if(rem<=10500 && rem>0 && !CR.cue.t10 && s.v>=60){ CR.cue.t10=1; say("Dieci secondi."); } }
  else if(s.t==="dist"){ var remD = CR.segStartD+s.v-CR.dist;
    if(remD<=100 && remD>0 && !CR.cue.d100 && s.v>=800){ CR.cue.d100=1; say("Cento metri."); } }
}
function checkAlert(){
  var s = cur(), t = now();
  if(!s || (s.lo==null && s.hi==null) || CR.auto) return;
  if(t-CR.al.lastCheck < 10000) return;
  CR.al.lastCheck = t;
  var from = Math.max(CR.segStartMs, CR.resumeMs||0);
  if((CR.activeMs-from)/1000 < 45) return;
  var p = rolling(60, from+5000), st = band(s, p, 3);
  if(st==="none") return;
  if(st===CR.al.state) CR.al.n++; else { if(st!=="ok" && CR.al.state!=="ok" && CR.al.state!=="none") CR.al.count = 0; CR.al.state=st; CR.al.n=1; }
  if(st!=="ok" && CR.al.n>=2 && t-CR.al.last > (CR.al.count>=2 ? 120000 : 60000)){
    vib(st==="fast" ? [120,80,120,80,120] : [400]);
    say((st==="fast"?"Troppo veloce. ":"Troppo lento. ")+sayP(p)+".");
    CR.al.last = t; CR.al.warned = true; CR.al.count = (CR.al.count||0)+1;
  } else if(st==="ok" && CR.al.warned && CR.al.n>=2){ say("Ritmo giusto."); CR.al.warned = false; CR.al.count = 0; }
}

/* schermo di corsa */
function renderRun(){
  if(!CR) return;
  var s = cur(), inMs = CR.activeMs-CR.segStartMs, inD = CR.dist-CR.segStartD;
  var realTot = CR.segs.filter(function(x){ return x.n!=="Fuori programma"; }).length;
  $("rsSeg").textContent = s.n;
  $("rsIdx").textContent = (s.n==="Fuori programma"||realTot<2) ? "" : (Math.min(CR.seg+1,realTot)+" di "+realTot);
  var prog = 0, main, mainL;
  if(s.t==="time"){ prog = inMs/(s.v*1000); main = fmtT(s.v*1000-inMs+999); mainL = "al cambio"; }
  else if(s.t==="dist"){ var rem = Math.max(0, s.v-inD); prog = inD/s.v;
    main = rem>=2000 ? fmtKm(rem) : Math.round(rem)+" m"; mainL = rem>=2000 ? "km alla fine del blocco" : "alla fine del blocco"; }
  else { main = fmtT(CR.activeMs); mainL = "tempo"; }
  if(!CR.moved && CR.auto){ mainL = "parti quando vuoi"; }
  $("rsMain").textContent = main; $("rsMainL").textContent = CR.paused ? "in pausa" : mainL;
  $("rsBar").style.width = Math.max(0,Math.min(100,prog*100))+"%";
  var p = CR.auto ? null : rolling(30, Math.max(CR.segStartMs, CR.resumeMs||0)), st = band(s, p);
  $("rsPace").textContent = fmtP(p);
  $("rsPaceBox").className = "rsPace "+(st==="none"?"":st);
  $("rsTarget").textContent = (s.lo==null && s.hi==null) ? "nessuna fascia di ritmo" :
    (st==="fast"?"troppo veloce · ":st==="slow"?"troppo lento · ":st==="ok"?"nel ritmo · ":"fascia ")+targetTxt(s);
  $("rsDist").textContent = fmtKm(CR.dist);
  $("rsTime").textContent = fmtT(CR.activeMs);
  if(CR.segs.length===1 || s.n==="Fuori programma"){ $("rsAvg").textContent = CR.dist>50 ? fmtP(CR.activeMs/CR.dist) : "—"; $("rsAvgL").textContent = "passo medio"; }
  else { $("rsAvg").textContent = inD>50 ? fmtP(inMs/inD) : "—"; $("rsAvgL").textContent = "passo del blocco"; }
  var nk = CR.kmSplits.length;
  $("rsLastKm").textContent = nk ? fmtP(CR.kmSplits[nk-1]/1000) : "—";
  $("rsLastKmL").textContent = nk ? "km "+nk : "ultimo km";
  var nx = CR.segs[CR.seg+1];
  $("rsNext").textContent = nx && nx.n!=="Fuori programma" ? "Poi: "+nx.n+" · "+lenTxt(nx)+((nx.lo!=null||nx.hi!=null)?" · "+targetTxt(nx):"") : "";
  $("rsPause").textContent = CR.paused ? "Riprendi" : "Pausa";
  $("rsPause").classList.toggle("paused", CR.paused);
  $("rsSkip").disabled = s.n==="Fuori programma";
  var rs = $("runScreen"); rs.classList.toggle("paused", CR.paused); rs.classList.toggle("auto", CR.auto && !CR.paused && CR.moved);
}
function loop(){
  if(!CR || !CR.running) return;
  tick();
  if(!CR.paused && !CR.auto){
    var s = cur();
    while(s && s.t==="time" && CR.activeMs-CR.segStartMs >= s.v*1000){ nextSeg(CR.segStartMs+s.v*1000, CR.dist); s = cur(); }
    cues(); checkAlert();
  }
  if(now()-CR.lastSave > 5000) saveLive();
  renderRun();
}
function saveLive(){
  if(!CR) return; CR.lastSave = now();
  var o = {}; for(var k in CR){ if(k!=="anchor" && k!=="mvA" && k!=="ev" && k!=="buf") o[k]=CR[k]; }
  o.savedAt = now(); lsSet(LIVE_KEY, o);
}
async function wake(){
  try{ if("wakeLock" in navigator && document.visibilityState==="visible") WAKE = await navigator.wakeLock.request("screen"); }catch(e){ WAKE = null; }
  if(!WAKE && CR) $("rsWarn").textContent = "Il telefono potrebbe spegnere lo schermo: alza lo spegnimento automatico a 10 minuti.";
}
function audioOn(){ try{ AC = AC || new (window.AudioContext||window.webkitAudioContext)(); if(AC.state==="suspended") AC.resume(); }catch(e){ AC = null; } }
function enterRun(){
  document.body.setAttribute("data-run","1");
  try{ history.pushState({run:1}, "", "#corsa"); }catch(e){}
  wake();
  if(TICK) clearInterval(TICK);
  TICK = setInterval(loop, 500);
  renderRun();
}
function start(){
  if(CR && CR.running) return;
  S.voce=$("optVoce").checked; S.km=$("optKm").checked; S.vib=$("optVib").checked; S.auto=$("optAuto").checked; saveSet();
  if(!gpsStart()) return;
  audioOn();
  CR = fresh();
  $("rsWarn").textContent = (GPS.acc==null || GPS.acc>20) ? "Segnale GPS ancora in arrivo: la distanza parte dal primo punto buono." : "";
  $("resumeBox").style.display = "none";
  enterRun();
  beep(1); vib([200]);
  if(window.speechSynthesis){ try{ speechSynthesis.cancel(); }catch(e){} }
  say("Si parte."); annuncia(cur());
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function(){});
}
function pause(){
  if(!CR) return; tick();
  CR.paused = !CR.paused; CR.anchor = null; CR.mvA = null; CR.buf = []; CR.lastTick = now(); CR.lastMoveW = now(); CR.auto = false;
  say(CR.paused ? "Pausa." : "Si riparte."); saveLive(); renderRun();
}
function skip(){
  if(!CR || CR.paused) return; var s = cur(); if(!s || s.n==="Fuori programma") return;
  tick(); nextSeg(CR.activeMs, CR.dist); renderRun();
}
var armT = null;
function stopTap(){
  var b = $("rsStop");
  if(b.classList.contains("armed")){ clearTimeout(armT); b.classList.remove("armed"); b.textContent="Stop"; stop(); return; }
  b.classList.add("armed"); b.textContent = "Conferma";
  armT = setTimeout(function(){ b.classList.remove("armed"); b.textContent="Stop"; }, 3000);
}
function nomeDefault(start, kind, corto){
  if(kind!=="libero") return corto;
  var h = new Date(start).getHours();
  return h<11 ? "Corsa mattutina" : h<15 ? "Corsa dell'ora di pranzo" : h<18 ? "Corsa pomeridiana" : h<22 ? "Corsa serale" : "Corsa notturna";
}
function stop(){
  if(!CR) return; tick();
  var s = cur();
  if(s && CR.segs.length>1 && CR.activeMs-CR.segStartMs > (s.n==="Fuori programma" ? 30000 : 5000)){
    CR.segRes.push({n:s.n==="Fuori programma"?s.n:s.n+" (interrotto)", k:s.k, t:s.t, lo:s.lo, hi:s.hi,
      d:Math.round(CR.dist-CR.segStartD), ms:Math.round(CR.activeMs-CR.segStartMs)});
  }
  CR.running = false;
  if(TICK) clearInterval(TICK); TICK = null;
  if(WAKE){ try{ WAKE.release(); }catch(e){} WAKE = null; }
  gpsStop();
  var c = CR;
  document.body.removeAttribute("data-run"); lock(false);
  lsSet(LIVE_KEY, null);
  if(c.dist < 100){
    CR = null; location.replace("#rec");
    alert("Corsa troppo breve: meno di 100 metri, non l'ho salvata.");
    return;
  }
  var n = c.srT.length-1;
  if(c.srT[n] < c.activeMs){ c.srT.push(Math.round(c.activeMs)); c.srD.push(Math.round(c.dist*10)/10); }
  var best = {};
  DISTS.forEach(function(dd){ best[dd[0]] = bestEffort(c.srT, c.srD, dd[0]); });
  var id = "a"+c.start, end = now();
  var meta = {id:id, start:c.start, end:end, nome:nomeDefault(c.start, c.kind, c.nome), kind:c.kind, dist:Math.round(c.dist),
    moving:Math.round(c.activeMs), elapsed:end-c.start, kmSplits:c.kmSplits, segRes:(c.segs.length>1 ? c.segRes : []),
    gaps:c.gaps, dop:c.dop, src:"app", best:best, sforzo:null, fiato:null, gambe:null, note:""};
  var prima = ranks(), nuovi = [];
  DISTS.forEach(function(dd){ var D=dd[0]; if(best[D] && (!prima[D][0] || best[D] < prima[D][0].best[D])) nuovi.push(dd[1]); });
  if(!prima.longest[0] || meta.dist > prima.longest[0].dist) nuovi.push("corsa più lunga");
  CR = c; say("Corsa salvata. "+fmtKm(c.dist).replace(",", " virgola ")+" chilometri."+(nuovi.length ? " Nuovo record: "+nuovi.join(", ")+"." : ""));
  CR = null;
  Promise.all([dbPut("meta", meta), dbPut("track", {id:id, t:c.srT, d:c.srD, rt:c.rt})]).then(loadMetas).then(function(){
    location.replace("#a/"+id);
  }).catch(function(){ alert("Non sono riuscito a salvare la corsa nel telefono."); });
}
function lock(on){ $("rsLockLayer").classList.toggle("on", !!on); }
(function(){
  var L = $("rsLockLayer"), hs = 0, hi = null;
  function endHold(){ clearInterval(hi); hi=null; $("rsHoldBar").style.width="0"; }
  L.addEventListener("pointerdown", function(e){ e.preventDefault(); hs=now();
    hi = setInterval(function(){ var f=(now()-hs)/2000; $("rsHoldBar").style.width=Math.min(100,f*100)+"%"; if(f>=1){ endHold(); lock(false); } }, 50); });
  ["pointerup","pointercancel","pointerleave"].forEach(function(ev){ L.addEventListener(ev, endHold); });
  L.addEventListener("contextmenu", function(e){ e.preventDefault(); });
})();
document.addEventListener("visibilitychange", function(){
  if(!CR || !CR.running) return;
  if(document.visibilityState==="hidden"){ CR.hiddenAt = now(); saveLive(); }
  else { var gap = CR.hiddenAt ? now()-CR.hiddenAt : 0; CR.hiddenAt = 0;
    if(gap > 8000){ CR.gaps++; $("rsWarn").textContent = "La pagina è rimasta sospesa per "+fmtT(gap)+": quel tratto è stimato in linea retta."; }
    wake(); loop(); }
});
window.addEventListener("beforeunload", function(e){ if(CR && CR.running){ saveLive(); e.preventDefault(); e.returnValue=""; } });

/* corsa interrotta */
function offerResume(){
  var o = lsGet(LIVE_KEY);
  if(!o || !o.savedAt || now()-o.savedAt > 3*3600*1000){ lsSet(LIVE_KEY, null); return; }
  var t = new Date(o.start);
  $("resumeBox").innerHTML = "<b>C'è una corsa interrotta</b>, partita alle "+pad(t.getHours())+":"+pad(t.getMinutes())+": "+fmtKm(o.dist)+" km in "+fmtT(o.activeMs)+"."+
    "<div class='acts' style='margin-top:10px'><button class='primary' onclick='App.resume()'>Riprendi</button><button onclick='App.closeLive()'>Salvala così</button><button onclick='App.dropLive()'>Elimina</button></div>";
  $("resumeBox").style.display = "block";
}
function resume(){
  var o = lsGet(LIVE_KEY); if(!o) return;
  CR = o; CR.running=true; CR.paused=true; CR.auto=false; CR.anchor=null; CR.mvA=null; CR.buf=[]; CR.ev=[]; CR.lastTick=now(); CR.lastMoveW=now(); CR.hiddenAt=0;
  CR.opt = {voce:S.voce, vib:S.vib, km:S.km, auto:S.auto};
  $("resumeBox").style.display = "none";
  gpsStart(); audioOn(); enterRun();
  $("rsWarn").textContent = "Corsa ripresa in pausa: tocca Riprendi quando riparti.";
}
function closeLive(){
  var o = lsGet(LIVE_KEY); if(!o) return;
  CR = o; CR.running=true; CR.paused=true; CR.lastTick=now(); CR.opt={voce:false,vib:false,km:false,auto:false};
  $("resumeBox").style.display = "none"; stop();
}
function dropLive(){ lsSet(LIVE_KEY, null); $("resumeBox").style.display = "none"; }

/* ============================ attività ============================ */
function weekStart(ms){ var d=new Date(ms); d.setHours(0,0,0,0); var g=(d.getDay()+6)%7; d.setDate(d.getDate()-g); return d.getTime(); }
function renderAct(){
  var t = now(), ws = weekStart(t), m0 = new Date(t); m0.setDate(1); m0.setHours(0,0,0,0);
  var wk = METAS.filter(function(m){ return m.start>=ws; }), mo = METAS.filter(function(m){ return m.start>=m0.getTime(); });
  var sum = function(a){ return a.reduce(function(x,m){ return x+m.dist; },0); };
  $("totals").innerHTML = "<div><div class='v'>"+fmtKm(sum(wk),1)+"</div><div class='l'>km questa settimana · "+wk.length+(wk.length===1?" corsa":" corse")+"</div></div>"+
    "<div><div class='v'>"+fmtKm(sum(mo),1)+"</div><div class='l'>km questo mese</div></div>"+
    "<div><div class='v'>"+fmtKm(sum(METAS),0)+"</div><div class='l'>km in tutto · "+METAS.length+" corse</div></div>";
  /* ultime 10 settimane */
  var W = 10, bars = [], mx = 1;
  for(var i=W-1;i>=0;i--){ var a = ws - i*7*864e5, b = a+7*864e5;
    var km = METAS.filter(function(m){ return m.start>=a && m.start<b; }).reduce(function(x,m){ return x+m.dist; },0)/1000;
    bars.push([a,km]); mx = Math.max(mx, km); }
  var svg = "<svg viewBox='0 0 600 132' role='img' aria-label='Chilometri nelle ultime dieci settimane'>";
  bars.forEach(function(b,i){ var x = 8+i*59, h = b[1]/mx*76, y = 102-h, d = new Date(b[0]);
    svg += "<rect x='"+x+"' y='"+y+"' width='44' height='"+Math.max(h,1)+"' rx='3' fill='"+(i===W-1?"#A8630F":"#1F6B72")+"' opacity='"+(i===W-1?1:.75)+"'/>"+
      "<text x='"+(x+22)+"' y='"+(y-5)+"' text-anchor='middle' font-size='17' fill='#17252C' font-weight='600'>"+(b[1]?b[1].toFixed(0):"")+"</text>"+
      "<text x='"+(x+22)+"' y='122' text-anchor='middle' font-size='14' fill='#4E5F66'>"+d.getDate()+"/"+(d.getMonth()+1)+"</text>"; });
  $("weeks").innerHTML = svg+"</svg>";
  var R = ranks();
  $("actList").innerHTML = METAS.length ? METAS.map(function(m){
    return "<button class='act' onclick='location.hash=\"#a/"+m.id+"\"'><div class='ah'><span class='an'>"+esc(m.nome)+"</span><span class='ad'>"+dataBreve(m.start)+"</span></div>"+
      "<div class='am'><div><b>"+fmtKm(m.dist)+"</b><span>km</span></div><div><b>"+(m.dist>50?fmtP(m.moving/m.dist):"—")+"</b><span>/km</span></div><div><b>"+fmtT(m.moving)+"</b><span>tempo</span></div></div>"+
      "<div class='badges'>"+badgesFor(m,R)+"</div></button>";
  }).join("") : "<div class='card hint'>Nessuna corsa ancora.</div>";
  $("m-data").value = isoDay(t);
}
function addManual(){
  var d = $("m-data").value, km = parseFloat(String($("m-km").value).replace(",",".")), ms = parseT($("m-tempo").value);
  if(!d || !km || !ms){ alert("Servono data, distanza e tempo."); return; }
  var start = new Date(d+"T18:00:00").getTime(), dist = Math.round(km*1000), best = {};
  DISTS.forEach(function(dd){ best[dd[0]] = bestFromSplits(null, dist, ms, dd[0]); });
  var meta = {id:"m"+start+"_"+Math.round(Math.random()*1e4), start:start, end:start+ms, nome:$("m-nome").value.trim()||"Corsa", kind:"libero",
    dist:dist, moving:ms, elapsed:ms, kmSplits:[], segRes:[], src:"manual", best:best, sforzo:null, fiato:null, gambe:null, note:""};
  dbPut("meta", meta).then(loadMetas).then(function(){ $("m-km").value=""; $("m-tempo").value=""; $("m-nome").value=""; $("manualBox").open=false; renderAct(); });
}

/* dettaglio */
function svgRoute(rt){
  if(!rt || rt.length<2) return "";
  var lat0 = rt[0][1]*Math.PI/180, pts = rt.map(function(p){ return [p[2]*Math.cos(lat0), -p[1]]; });
  var xs = pts.map(function(p){ return p[0]; }), ys = pts.map(function(p){ return p[1]; });
  var x0=Math.min.apply(null,xs), x1=Math.max.apply(null,xs), y0=Math.min.apply(null,ys), y1=Math.max.apply(null,ys);
  var W=600, pad=24, dx=Math.max(x1-x0,1e-6), dy=Math.max(y1-y0,1e-6), H=Math.max(200, Math.min(420, W*dy/dx));
  var sc = Math.min((W-2*pad)/dx, (H-2*pad)/dy), ox=(W-dx*sc)/2, oy=(H-dy*sc)/2;
  var xy = pts.map(function(p){ return [(ox+(p[0]-x0)*sc).toFixed(1), (oy+(p[1]-y0)*sc).toFixed(1)]; });
  var a = xy[0], b = xy[xy.length-1];
  return "<svg viewBox='0 0 "+W+" "+H.toFixed(0)+"' role='img' aria-label='Percorso'><polyline points='"+xy.map(function(p){ return p.join(","); }).join(" ")+
    "' fill='none' stroke='#A8630F' stroke-width='4' stroke-linejoin='round' stroke-linecap='round'/>"+
    "<circle cx='"+a[0]+"' cy='"+a[1]+"' r='7' fill='#2E9E62' stroke='#fff' stroke-width='2'/><circle cx='"+b[0]+"' cy='"+b[1]+"' r='7' fill='#17252C' stroke='#fff' stroke-width='2'/></svg>";
}
function tAtD(t, d, x){
  for(var i=1;i<d.length;i++){ if(d[i]>=x){ var f = d[i]>d[i-1] ? (x-d[i-1])/(d[i]-d[i-1]) : 0; return t[i-1]+f*(t[i]-t[i-1]); } }
  return t[t.length-1];
}
function svgPace(tr, avg){
  if(!tr || !tr.t || tr.t.length<4) return "";
  var tot = tr.d[tr.d.length-1]; if(tot < 400) return "";
  var step = tot > 8000 ? 200 : 100, pts = [];
  for(var x=step; x<=tot; x+=step){ var p = (tAtD(tr.t,tr.d,x)-tAtD(tr.t,tr.d,x-step))/step; pts.push([x, p]); }
  var sm = pts.map(function(p,i){ var a=pts.slice(Math.max(0,i-1), i+2); return [p[0], a.reduce(function(s,q){ return s+q[1]; },0)/a.length]; });
  var vals = sm.map(function(p){ return p[1]; }).filter(function(v){ return v>150 && v<900; });
  if(!vals.length) return "";
  var lo = Math.max(150, Math.min.apply(null, vals)-15), hi = Math.min(600, Math.max(avg+60, lo+60));
  var W=600, H=200, L=58, B=28, sx=function(x){ return L+(x/tot)*(W-L-6); }, sy=function(v){ v=Math.max(lo,Math.min(hi,v)); return 8+(v-lo)/(hi-lo)*(H-B-8); };
  var line = sm.map(function(p,i){ return (i?"L":"M")+sx(p[0]).toFixed(1)+","+sy(p[1]).toFixed(1); }).join(" ");
  var area = line+" L"+sx(sm[sm.length-1][0]).toFixed(1)+","+(H-B)+" L"+sx(sm[0][0]).toFixed(1)+","+(H-B)+"Z";
  var g = "<svg viewBox='0 0 "+W+" "+H+"' role='img' aria-label='Passo lungo il percorso'><path d='"+area+"' fill='#1F6B72' opacity='.18'/>"+
    "<path d='"+line+"' fill='none' stroke='#1F6B72' stroke-width='3' stroke-linejoin='round'/>"+
    "<line x1='"+L+"' x2='"+(W-6)+"' y1='"+sy(avg).toFixed(1)+"' y2='"+sy(avg).toFixed(1)+"' stroke='#A8630F' stroke-dasharray='7 5' stroke-width='2'/>";
  [lo, (lo+hi)/2, hi].forEach(function(v){ g += "<text x='"+(L-6)+"' y='"+(sy(v)+6).toFixed(1)+"' text-anchor='end' font-size='17' fill='#4E5F66'>"+fmtP(v)+"</text>"; });
  var kstep = tot>12000 ? 2000 : 1000;
  for(var k=kstep; k<tot; k+=kstep) g += "<text x='"+sx(k).toFixed(1)+"' y='"+(H-6)+"' text-anchor='middle' font-size='16' fill='#4E5F66'>"+(k/1000)+"</text>";
  return g+"</svg>";
}
function splitsTable(m){
  var sp = m.kmSplits||[]; if(!sp.length) return "";
  var rows = sp.map(function(s,i){ return [String(i+1), s/1000]; });
  var rest = m.dist - sp.length*1000;
  if(rest >= 50 && m.src==="app"){ var used = sp.reduce(function(a,b){ return a+b; },0); rows.push([fmtKm(rest), (m.moving-used)/1000/(rest/1000)]); }
  var fast = Math.min.apply(null, rows.map(function(r){ return r[1]; })), slow = Math.max.apply(null, rows.map(function(r){ return r[1]; }));
  var h = "<table class='tbl'><tr><th>Km</th><th>Passo</th><th></th></tr>";
  rows.forEach(function(r){
    var w = slow>fast ? 35+65*(slow-r[1])/(slow-fast) : 100;
    h += "<tr><td>"+r[0]+"</td><td><b>"+fmtP(r[1])+"</b></td><td class='bar'><i class='"+(r[1]===fast?"best":"")+"' style='width:"+w.toFixed(0)+"%'></i></td></tr>";
  });
  return h+"</table>";
}
function segTable(m){
  if(!m.segRes || !m.segRes.length) return "";
  var h = "<div class='scroll'><table class='tbl'><tr><th>Blocco</th><th>Tempo</th><th>km</th><th>Passo</th><th>Fascia</th></tr>";
  m.segRes.forEach(function(x){
    var pc = x.d>50 ? x.ms/x.d : null, st = band(x, pc);
    h += "<tr><td>"+esc(x.n)+"</td><td>"+fmtT(x.ms)+"</td><td>"+fmtKm(x.d)+"</td><td class='"+(st==="none"?"":st)+"'>"+fmtP(pc)+"</td><td class='tgc'>"+targetTxt(x)+"</td></tr>";
  });
  return h+"</table></div>";
}
function feelSel(id, lab, v){
  var o = "<option value=''>—</option>"; for(var i=1;i<=10;i++) o += "<option "+(v==i?"selected":"")+">"+i+"</option>";
  return "<div><label for='"+id+"'>"+lab+"</label><select id='"+id+"' onchange='App.feel()'>"+o+"</select></div>";
}
var CUR_ID = null, CUR_TRACK = null;
function renderDet(id){
  var m = METAS.filter(function(x){ return x.id===id; })[0];
  if(!m){ $("det").innerHTML = "<div class='card hint'>Attività non trovata.</div>"; return; }
  CUR_ID = id; CUR_TRACK = null;
  var R = ranks(), bestRows = "";
  DISTS.forEach(function(dd){ var v = m.best && m.best[dd[0]]; if(v){ var i = R[dd[0]].indexOf(m);
    bestRows += "<tr><td>"+dd[1]+"</td><td><b>"+fmtT(v)+"</b></td><td>"+fmtP(v/dd[0])+" /km</td><td class='tgc'>"+(i===0?"record":(i+1)+"°")+"</td></tr>"; } });
  var h = "<div class='dHead'><div class='dn'>"+esc(m.nome)+"</div><div class='dd'>"+dataLunga(m.start)+"</div><div class='badges'>"+badgesFor(m,R)+"</div></div>"+
    "<div class='card'><div class='stats'>"+
    "<div><div class='v'>"+fmtKm(m.dist)+" km</div><div class='l'>distanza</div></div>"+
    "<div><div class='v'>"+(m.dist>50?fmtP(m.moving/m.dist):"—")+" /km</div><div class='l'>passo medio</div></div>"+
    "<div><div class='v'>"+fmtT(m.moving)+"</div><div class='l'>tempo in movimento</div></div>"+
    (m.src==="app" ? "<div><div class='v'>"+fmtT(m.elapsed)+"</div><div class='l'>tempo trascorso</div></div>" : "")+
    "</div></div>"+
    "<div id='detMap'></div><div id='detChart'></div>"+
    (m.kmSplits && m.kmSplits.length ? "<div class='card'><h3>Intertempi</h3>"+splitsTable(m)+"</div>" : "")+
    (m.segRes && m.segRes.length ? "<div class='card'><h3>Blocchi</h3>"+segTable(m)+"</div>" : "")+
    (bestRows ? "<div class='card'><h3>Migliori tempi in questa corsa</h3><table class='tbl'>"+bestRows+"</table></div>" : "")+
    "<div class='card'><h3>Com'è andata</h3>"+
    "<div style='margin-bottom:10px'><label for='f-nome'>Nome</label><input id='f-nome' value='"+esc(m.nome)+"' onchange='App.feel()'></div>"+
    "<div class='feel'>"+feelSel("f-sforzo","Sforzo",m.sforzo)+feelSel("f-fiato","Fiato",m.fiato)+feelSel("f-gambe","Gambe",m.gambe)+"</div>"+
    "<div style='margin-top:10px'><label for='f-note'>Note</label><textarea id='f-note' onchange='App.feel()' placeholder='Sensazioni, meteo, percorso'>"+esc(m.note||"")+"</textarea></div></div>"+
    (m.gaps ? "<div class='warn'>La pagina è stata sospesa "+m.gaps+(m.gaps===1?" volta":" volte")+": in quei tratti la distanza è stimata in linea retta, quindi leggermente per difetto.</div>" : "")+
    "<div class='acts' style='margin-bottom:16px'><button class='primary' onclick='App.copy()'>Copia il riepilogo</button>"+
    (m.src==="app" ? "<button onclick='App.gpx()'>Esporta GPX</button>" : "")+
    "<button class='danger' id='delBtn' onclick='App.del()'>Elimina</button></div><p class='hint' id='copyMsg'></p>";
  $("det").innerHTML = h;
  if(m.src==="app") dbGet("track", id).then(function(tr){
    if(CUR_ID!==id || !tr) return; CUR_TRACK = tr;
    var r = svgRoute(tr.rt), c = svgPace(tr, m.moving/m.dist);
    if(r) $("detMap").innerHTML = "<div class='card map' style='padding:0'>"+r+"</div>";
    if(c) $("detChart").innerHTML = "<div class='card chart'><h3>Passo</h3>"+c+"<p class='hint' style='margin:4px 0 0'>Linea tratteggiata: passo medio. Più in alto vuol dire più veloce.</p></div>";
  });
}
function feel(){
  var m = METAS.filter(function(x){ return x.id===CUR_ID; })[0]; if(!m) return;
  m.nome = $("f-nome").value.trim() || m.nome;
  ["sforzo","fiato","gambe"].forEach(function(k){ var v = $("f-"+k).value; m[k] = v ? +v : null; });
  m.note = $("f-note").value;
  dbPut("meta", m).then(function(){ document.querySelector(".dHead .dn").textContent = m.nome; });
}
function summaryText(m){
  var L = [dataLunga(m.start)+" · "+m.nome, fmtKm(m.dist)+" km in "+fmtT(m.moving)+(m.dist>50?" · "+fmtP(m.moving/m.dist)+" /km":"")+(m.src==="app"?" · trascorso "+fmtT(m.elapsed):"")];
  (m.segRes||[]).forEach(function(x){ L.push(x.n+": "+fmtT(x.ms)+" · "+fmtKm(x.d)+" km · "+(x.d>50?fmtP(x.ms/x.d):"—")+((x.lo!=null||x.hi!=null)?" (fascia "+targetTxt(x)+")":"")); });
  if(m.kmSplits && m.kmSplits.length) L.push("Km: "+m.kmSplits.map(function(s){ return fmtP(s/1000); }).join(" · "));
  var f = []; if(m.sforzo) f.push("sforzo "+m.sforzo); if(m.fiato) f.push("fiato "+m.fiato); if(m.gambe) f.push("gambe "+m.gambe);
  if(f.length) L.push(f.join(", ")); if(m.note) L.push(m.note);
  return L.join("\n");
}
function copy(){
  var m = METAS.filter(function(x){ return x.id===CUR_ID; })[0]; if(!m) return;
  var t = summaryText(m), msg = $("copyMsg"), ta = $("copyTxt");
  if(!ta){ ta = document.createElement("textarea"); ta.id="copyTxt"; ta.readOnly=true; ta.style.cssText="min-height:150px;font-size:.78rem;margin-bottom:8px"; msg.parentNode.insertBefore(ta, msg); }
  ta.value = t; ta.focus(); ta.select();
  var ok = false; try{ ok = document.execCommand("copy"); }catch(e){}
  if(!ok && navigator.clipboard) navigator.clipboard.writeText(t).then(function(){ msg.textContent="Copiato: incollalo in chat."; }, function(){});
  msg.textContent = ok ? "Copiato: incollalo in chat." : "Se non si è copiato da solo, tieni premuto sul testo e scegli Copia.";
}
function download(name, text, type){
  var a = document.createElement("a"), url = URL.createObjectURL(new Blob([text], {type:type}));
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1000);
}
function gpx(){
  var m = METAS.filter(function(x){ return x.id===CUR_ID; })[0], tr = CUR_TRACK;
  if(!m || !tr || !tr.rt || tr.rt.length<2){ alert("Questa corsa non ha un percorso registrato."); return; }
  var pts = tr.rt.map(function(p){ return "<trkpt lat='"+p[1]+"' lon='"+p[2]+"'><time>"+new Date(m.start+p[0]*1000).toISOString()+"</time></trkpt>"; }).join("\n");
  download("corsa-"+isoDay(m.start)+".gpx", "<?xml version='1.0' encoding='UTF-8'?>\n<gpx version='1.1' creator='Cronometro corsa' xmlns='http://www.topografix.com/GPX/1/1'>\n<trk><name>"+
    esc(m.nome)+"</name><type>running</type><trkseg>\n"+pts+"\n</trkseg></trk></gpx>\n", "application/gpx+xml");
}
var delT = null;
function del(){
  var b = $("delBtn");
  if(!b.classList.contains("armed")){ b.classList.add("armed"); b.textContent="Tocca ancora per eliminare"; delT=setTimeout(function(){ b.classList.remove("armed"); b.textContent="Elimina"; }, 3000); return; }
  clearTimeout(delT);
  Promise.all([dbDel("meta", CUR_ID), dbDel("track", CUR_ID)]).then(loadMetas).then(function(){ location.replace("#act"); });
}

/* ============================ record ============================ */
function renderPR(){
  var R = ranks(), h = "";
  DISTS.forEach(function(dd){
    var a = R[dd[0]];
    if(!a.length){ h += "<div class='pr empty'><div class='pd'>"+dd[1]+"</div><div class='pv'>—</div><div class='pw'>ancora nessun tempo</div></div>"; return; }
    var b = a[0];
    h += "<button class='pr' onclick='location.hash=\"#a/"+b.id+"\"'><div class='pd'>"+dd[1]+"</div><div class='pv'>"+fmtT(b.best[dd[0]])+"</div>"+
      "<div class='pp'>"+fmtP(b.best[dd[0]]/dd[0])+" /km</div><div class='pw'>"+dataBreve(b.start)+" · "+esc(b.nome)+"</div>"+
      (a.length>1 ? "<div class='top3'>"+a.slice(1,3).map(function(x,i){ return "<div><span>"+(i+2)+"° "+dataBreve(x.start)+"</span><b>"+fmtT(x.best[dd[0]])+"</b></div>"; }).join("")+"</div>" : "")+
      "</button>";
  });
  var L = R.longest;
  h += L.length ? "<button class='pr' onclick='location.hash=\"#a/"+L[0].id+"\"'><div class='pd'>Corsa più lunga</div><div class='pv'>"+fmtKm(L[0].dist)+" km</div>"+
    "<div class='pp'>"+fmtT(L[0].moving)+" · "+fmtP(L[0].moving/L[0].dist)+" /km</div><div class='pw'>"+dataBreve(L[0].start)+" · "+esc(L[0].nome)+"</div></button>"
    : "<div class='pr empty'><div class='pd'>Corsa più lunga</div><div class='pv'>—</div></div>";
  $("prGrid").innerHTML = h;
  var km = METAS.reduce(function(a,m){ return a+m.dist; },0), ms = METAS.reduce(function(a,m){ return a+m.moving; },0);
  $("prTot").innerHTML = "<div><div class='v'>"+METAS.length+"</div><div class='l'>corse</div></div><div><div class='v'>"+fmtKm(km,1)+"</div><div class='l'>km</div></div>"+
    "<div><div class='v'>"+fmtT(ms)+"</div><div class='l'>di corsa</div></div>";
}

/* ============================ backup ============================ */
function exportAll(){
  Promise.all([dbAll("meta"), dbAll("track")]).then(function(r){
    download("cronometro-backup-"+isoDay(now())+".json", JSON.stringify({app:"cronometro-corsa", v:1, esportato:new Date().toISOString(), meta:r[0], track:r[1]}), "application/json");
    $("bkMsg").textContent = "Backup scaricato: "+r[0].length+" corse.";
  });
}
function importFile(f){
  var rd = new FileReader();
  rd.onload = function(){
    try{ var o = JSON.parse(rd.result); if(o.app!=="cronometro-corsa" || !o.meta) throw 0;
      Promise.all(o.meta.map(function(m){ return dbPut("meta", m); }).concat((o.track||[]).map(function(t){ return dbPut("track", t); })))
        .then(loadMetas).then(function(){ $("bkMsg").textContent = "Backup caricato: "+o.meta.length+" corse."; });
    }catch(e){ $("bkMsg").textContent = "Il file non è un backup del cronometro."; }
  };
  rd.readAsText(f);
}
function renderSet(){
  var t = "Versione "+VERSION+" · "+METAS.length+" corse salvate"+(DB_OK?"":" · archivio non disponibile in questo browser");
  $("storeInfo").textContent = t;
  if(navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function(e){
    $("storeInfo").textContent = t+" · spazio usato "+(e.usage/1048576).toFixed(1)+" MB"; });
}

/* ============================ storico di partenza ============================ */
/* le uscite registrate dal 15 settembre: distanza, tempo e, dove noti, i parziali al km */
var SEED = [
 ["2026-09-15","Rientro: 5 × (4′ + 1′)",4.48,"29:58"],["2026-09-16","6 × 1′ a 5:00",4.60,"29:00"],["2026-09-18","Corsa continua",6.00,"37:12"],
 ["2026-09-20","Lento",6.62,"45:02"],["2026-09-25","Lungo con finale veloce",7.00,"41:36"],["2026-09-27","Lento",8.00,"50:40"],
 ["2026-09-29","Progressiva 30 + 8",6.30,"38:10"],["2026-09-30","8 × 200 m in pista",5.20,"35:30"],["2026-10-03","Lungo",7.40,"45:14"],
 ["2026-10-04","Deejay Ten, 10 km",10.00,"58:13"],["2026-10-06","Facile",5.10,"30:00"],["2026-10-07","Facile",4.40,"28:00"],
 ["2026-10-09","Test 5 km",5.00,"26:08",[327,323,313,311,289]],["2026-10-11","Lungo lento",10.10,"64:00"],
 ["2026-10-13","4 × 1000 m",8.90,"54:00"],["2026-10-14","Facile",5.59,"35:07"],["2026-10-16","Primo medio",6.80,"40:23"],
 ["2026-10-17","Lungo 11 km",11.00,"68:52"],
 ["2026-10-20","5 × 5′ sotto la pioggia",9.00,"54:41",[373,386,351,355,355,351,339,341,431],"20:05"],
 ["2026-10-21","Facile",6.04,"38:24",[385,385,379,377,382,380],"19:25"],
 ["2026-10-24","Medio spezzato 2 × 10′",8.28,"49:02",[377,376,332,351,344,332,362,360],"11:35"],
 ["2026-10-25","Lungo al lago di Comabbio",12.50,"1:18:47",[433,369,395,366,379,476,369,383,362,351,357,334],"11:31"],
 ["2026-10-27","6 × 5′",10.70,"1:00:34",[366,364,336,351,341,295,340,345,340,331],"18:45"]
];
function seed(){
  if(lsGet("cc-seeded") || METAS.length) return Promise.resolve();
  var ops = SEED.map(function(s){
    var start = new Date(s[0]+"T"+(s[5]||"18:30")+":00").getTime(), ms = parseT(s[3]), dist = Math.round(s[2]*1000);
    var sp = (s[4]||[]).map(function(x){ return x*1000; }), best = {};
    DISTS.forEach(function(dd){ best[dd[0]] = bestFromSplits(sp, dist, ms, dd[0]); });
    return dbPut("meta", {id:"s"+s[0], start:start, end:start+ms, nome:s[1], kind:"libero", dist:dist, moving:ms, elapsed:ms,
      kmSplits:sp, segRes:[], src:"import", best:best, sforzo:null, fiato:null, gambe:null, note:""});
  });
  return Promise.all(ops).then(function(){ lsSet("cc-seeded", true); return loadMetas(); });
}

/* ============================ navigazione ============================ */
var TITLES = {rec:"Registra", act:"Attività", det:"", pr:"Record", set:"Altro"};
function route(){
  if(CR && CR.running){ try{ history.pushState({run:1}, "", "#corsa"); }catch(e){} $("rsWarn").textContent = "Per uscire ferma prima il cronometro."; return; }
  var h = location.hash.replace(/^#/,"") || "rec", v = h, id = null;
  if(h.indexOf("a/")===0){ v = "det"; id = h.slice(2); }
  if(TITLES[v]===undefined) v = "rec";
  document.body.setAttribute("data-view", v);
  $("topTitle").textContent = TITLES[v];
  $("backBtn").hidden = v!=="det";
  $("topSub").textContent = v==="rec" ? dataBreve(now()) : "";
  document.querySelectorAll(".tabbar button").forEach(function(b){ b.setAttribute("aria-current", (b.dataset.v===v || (v==="det" && b.dataset.v==="act")) ? "true" : "false"); });
  if(v==="rec") renderSetup();
  if(v==="act") renderAct();
  if(v==="det") renderDet(id);
  if(v==="pr") renderPR();
  if(v==="set") renderSet();
  window.scrollTo(0,0);
}
window.addEventListener("hashchange", route);
window.addEventListener("popstate", function(){ if(CR && CR.running) route(); });

/* ============================ avvio ============================ */
window.App = {
  go:function(v){ location.hash = "#"+v; },
  gpsTest:function(){ gpsStart(); },
  oggi:function(){ SEL.id = OGGI_PIANO[isoDay(now())] || "libero"; SEL.shift=0; SEL.over={}; SEL.open=-1; renderSetup(); },
  shift:function(d){ SEL.shift = Math.max(-30, Math.min(30, SEL.shift+d)); renderSetup(); },
  chip:function(i){ var c = CHIPS[i]; S.free = {lo:c[1], hi:c[2]}; saveSet(); renderSetup(); },
  segOpen:function(i){ if(BY[SEL.id].kind==="libero") return; SEL.open = SEL.open===i ? -1 : i; renderSetup(); },
  bStep:function(i,k,d){ var s = buildSegs()[i]; if(s && s[k]!=null) setBound(i, k, Math.max(150, Math.min(900, s[k]+d))); },
  bSet:function(i,k,v){ var p = parseP(v); if(p==null){ renderSetup(); return; } setBound(i, k, p); },
  bTog:function(i,k,on){ var s = buildSegs()[i]; if(!s) return;
    var def = k==="lo" ? (s.hi!=null ? s.hi-20 : P(6,0)) : (s.lo!=null ? s.lo+20 : P(6,20)); setBound(i, k, on ? def : null); },
  start:start, pause:pause, skip:skip, stopTap:stopTap, lock:lock,
  resume:resume, closeLive:closeLive, dropLive:dropLive,
  addManual:addManual, feel:feel, copy:copy, gpx:gpx, del:del, exportAll:exportAll
};
(function(){
  var sel = $("selPreset"), groups = {libero:"Libera", rip:"Ripetute", facile:"Facile", medio:"Medio", lungo:"Lungo", test5:"Test", test10:"Test"}, h="", g="";
  PRESETS.forEach(function(p){ var gn = groups[p.kind]; if(gn!==g){ if(g) h+="</optgroup>"; h+="<optgroup label='"+gn+"'>"; g=gn; }
    h += "<option value='"+p.id+"'>"+esc(p.nome)+"</option>"; });
  sel.innerHTML = h+"</optgroup>";
  sel.addEventListener("change", function(){ SEL.id = sel.value; SEL.shift=0; SEL.over={}; SEL.open=-1; renderSetup(); });
  ["optVoce","optKm","optVib","optAuto"].forEach(function(id){ $(id).addEventListener("change", function(){
    S.voce=$("optVoce").checked; S.km=$("optKm").checked; S.vib=$("optVib").checked; S.auto=$("optAuto").checked; saveSet(); }); });
  $("impFile").addEventListener("change", function(){ if(this.files[0]) importFile(this.files[0]); this.value=""; });
  SEL.id = OGGI_PIANO[isoDay(now())] || "libero";
  if(location.hash==="#corsa") history.replaceState(null, "", "#rec");
  gpsUi();
  dbOpen().then(loadMetas).then(seed).then(function(){ route(); offerResume(); });
  if("serviceWorker" in navigator) window.addEventListener("load", function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
})();
window.__app = {state:function(){ return CR; }, metas:function(){ return METAS; }, bestEffort:bestEffort, rolling:function(w){ return CR?rolling(w):null; }};
})();
