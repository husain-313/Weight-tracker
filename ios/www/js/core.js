"use strict";
/* ---------- state ---------- */
const KEY = "trendline-scale-v1";
const NATIVE = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.store);
const DEFAULTS = { unit:"kg", goal:null, start:null, step:null, commit:null, goalSince:null, celebrated:null, smooth:0.1, theme:"auto", chartRange:90,
  healthRead:false, healthWrite:false, healthSince:null, healthFrom:null, healthIgnore:[], notifyWeigh:true, remind:false, remindTime:"07:30",
  lock:false, updateSeen:null, updateChecked:0 };
// Saved-data format. Bump SCHEMA and add MIGRATIONS[old] when the shape of saved data changes.
const SCHEMA = 3;
const DROPPED_SETTINGS = ["models", "actRead", "dayMode", "dayCutoff", "dayStarts", "sleepAsked", "cards", "cols", "reportMode", "height", "accent", "haptics"];
const MIGRATIONS = {
  // 1: data from before versioning. Nothing to change.
  // 2: the redesign keeps weight only, so food, activity and body composition go.
  2: d => {
    delete d.food; delete d.foodCache; delete d.activity;
    for (const e of d.entries || []){ delete e.fat; delete e.lean; }
    const s = d.settings || {};
    for (const k of DROPPED_SETTINGS) delete s[k];
    if (s.chartRange === 7) s.chartRange = 30;
  }
};
let S = { schema:SCHEMA, entries:[], settings:{...DEFAULTS} };

function upgrade(d){
  for (let v = d.schema || 1; v < SCHEMA; v++) if (MIGRATIONS[v]) MIGRATIONS[v](d);
  d.schema = SCHEMA;
  return d;
}
function normalize(){
  const s = S.settings;
  if (!Array.isArray(s.healthIgnore)) s.healthIgnore = [];
  if (!RANGES.some(r => r[0] === s.chartRange)) s.chartRange = 90;
}
function load(){
  let migrated = false;
  try{
    const raw = (NATIVE && typeof window.__NATIVE_STATE__ === "string") ? window.__NATIVE_STATE__ : localStorage.getItem(KEY);
    if (raw){
      const d = JSON.parse(raw); migrated = (d.schema || 1) < SCHEMA; upgrade(d);
      S.entries = Array.isArray(d.entries) ? d.entries : []; S.settings = {...DEFAULTS, ...(d.settings || {})};
    }
  }catch(e){}
  normalize(); sortEntries();
  if (migrated) save();
}
function save(){
  const json = JSON.stringify(S);
  if (NATIVE){ try{ window.webkit.messageHandlers.store.postMessage(json); }catch(e){} }
  try{ localStorage.setItem(KEY, json); }catch(e){}
}
function sortEntries(){ S.entries.sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0); }
function nativeCmd(cmd, data){ if (!NATIVE || !window.webkit.messageHandlers.native) return; try{ window.webkit.messageHandlers.native.postMessage(Object.assign({cmd}, data || {})); }catch(e){} }
function haptic(kind){ nativeCmd("haptic", { kind }); }

/* ---------- dates & units ---------- */
const DAY = 864e5;
const pad = n => String(n).padStart(2,"0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const localDate = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const dnum = s => { const [y,m,d] = s.split("-").map(Number); return Date.UTC(y,m-1,d)/DAY; };
const fromDnum = n => { const d = new Date(n*DAY); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; };
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONF = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const WDF = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const parts = s => { const [y,m,d] = s.split("-").map(Number); return { y, m, d, wd: new Date(Date.UTC(y,m-1,d)).getUTCDay() }; };
const fmtDate = s => { const p = parts(s); return `${p.d} ${MON[p.m-1]} ${p.y}`; };
const longDate = s => { const p = parts(s); return `${p.d} ${MONF[p.m-1]} ${p.y}`; };
const LB = 2.2046226218;
const U = () => S.settings.unit;
const toU = kg => U() === "lb" ? kg*LB : kg;
const fromU = v => U() === "lb" ? v/LB : v;
const fw = kg => kg == null || isNaN(kg) ? "—" : toU(kg).toFixed(1);
const fd = kg => { if (kg == null || isNaN(kg)) return "—"; const v = toU(kg); if (Math.abs(v) < 0.05) return "0.0"; return (v > 0 ? "+" : "−") + Math.abs(v).toFixed(1); };
const NUMFONT = getComputedStyle(document.documentElement).getPropertyValue("--font-num").trim() || "system-ui";
