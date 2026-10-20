"use strict";
/* ---------- native bridge ---------- */
let backupInfo = null;
window.__native = function(event, p){
  p = p || {};
  if (event === "health-samples") mergeHealth(p.samples || [], p.error, p.own || []);
  else if (event === "health-status"){ if (p.available === false){ S.settings.healthRead = false; S.settings.healthWrite = false; save(); toast("Apple Health is not available on this device."); if (tab === "settings") render(); } else syncHealth(true); }
  else if (event === "reminder-denied"){ S.settings.remind = false; save(); toast("Notifications are off for Trendline. Turn them on in iOS Settings."); if (tab === "settings") render(); }
  else if (event === "backup-info"){ const changed = JSON.stringify(p) !== JSON.stringify(backupInfo); backupInfo = p; if (changed && tab === "settings") render(); }
  else if (event === "foreground"){ syncHealth(false); checkUpdate(false); scheduleReminder(); if (tab !== "settings") render(); }
  else if (event === "toast") toast(p.text || "");
  else if (event === "text-size"){ document.documentElement.style.fontSize = p.px + "px"; if (tab === "progress" && !document.querySelector(".scrim")) render(); }
  else if (event === "http-result"){ const w = httpWait[p.id]; if (w){ delete httpWait[p.id]; p.error ? w.reject(new Error(p.error)) : w.resolve(p); } }
  else if (event === "lock-result"){
    if (p.ok){ S.settings.lock = !!p.enabled; save(); toast(p.enabled ? "Face ID lock is on" : "Face ID lock is off"); haptic("success"); }
    else toast(p.reason === "unavailable" ? "Set up Face ID or a passcode on this iPhone first." : "Face ID was not confirmed.");
    if (tab === "settings") render();
  }
  else if (event === "state"){
    try{
      const d = JSON.parse(p.json);
      if (d && Array.isArray(d.entries)) upgrade(d);
      if (d && Array.isArray(d.entries) && JSON.stringify(d) !== JSON.stringify(S)){
        S.entries = d.entries; S.settings = {...DEFAULTS, ...(d.settings || {})}; normalize(); sortEntries();
        if (!document.querySelector(".scrim")) render();
        checkCelebrate(false);
      }
    }catch(e){}
  }
};
function stamp(d){ return `${d.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}, ${d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`; }
function backupText(){
  if (!backupInfo || !backupInfo.last) return "No automatic backup yet. One is saved the next time something changes.";
  return `Last saved ${stamp(new Date(backupInfo.last))} · ${backupInfo.count} weekly cop${backupInfo.count === 1 ? "y" : "ies"} kept.`;
}
function folderText(){
  const b = backupInfo;
  if (!b) return "";
  if (!b.folder) return "Pick a folder in iCloud Drive. A copy goes there after every change, so your data survives a revoked certificate or deleting the app.";
  if (b.folderError) return "⚠︎ " + b.folderError;
  if (!b.folderLast) return "No copy yet.";
  const d = new Date(b.folderLast), old = Date.now() - d.getTime() > 7 * DAY;
  return `${old ? "⚠︎ " : ""}Last copy ${stamp(d)}`;
}

/* ---------- Apple Health ---------- */
function syncHealth(full){
  if (!NATIVE || !S.settings.healthRead) return;
  let since = (!full && S.settings.healthSince) ? fromDnum(dnum(S.settings.healthSince) - 7) : "2000-01-01";
  if (S.settings.healthFrom && since < S.settings.healthFrom) since = S.settings.healthFrom;
  nativeCmd("healthRead", { since });
}
let connectPending = false;
// samples: first weight of each day from other apps and scales. own: weights this app saved to Health.
function mergeHealth(samples, error, own){
  if (error){ toast("Could not read from Apple Health."); connectPending = false; return; }
  const ignore = new Set(S.settings.healthIgnore || []);
  let added = 0, changed = 0;
  // Weigh-ins this app saved to Health earlier but no longer has (after a reinstall or "Erase all data"): bring them back.
  // Days you deleted in the app are in the ignore list and stay deleted.
  const ownByDay = {};
  for (const [t, kg] of own || []){ const d = localDate(t); if (!ownByDay[d] || t > ownByDay[d].t) ownByDay[d] = { t, kg }; }
  for (const [d, w] of Object.entries(ownByDay)){
    if (ignore.has(d) || (S.settings.healthFrom && d < S.settings.healthFrom) || !(w.kg > 20 && w.kg < 400)) continue;
    if (S.entries.some(e => e.date === d) || samples.some(x => x.date === d && x.kg)) continue;
    S.entries.push({ id: "r" + d, date: d, kg: w.kg, note: "", t: w.t, restored: true }); added++;
  }
  for (const smp of samples){
    if (!smp || !smp.date || ignore.has(smp.date) || (S.settings.healthFrom && smp.date < S.settings.healthFrom)) continue;
    if (!(smp.kg > 20 && smp.kg < 400)) continue;
    let ex = S.entries.find(e => e.date === smp.date);
    if (!ex){ ex = { id: "h" + smp.date, date: smp.date, kg: smp.kg, note: "", src: "health" }; if (smp.t) ex.t = smp.t; S.entries.push(ex); added++; continue; }
    if (smp.t && !ex.t) ex.t = smp.t;
    else if (ex.src === "health" && (Math.abs(ex.kg - smp.kg) > 0.005 || (smp.t && ex.t !== smp.t))){ ex.kg = smp.kg; if (smp.t) ex.t = smp.t; delete ex.outlier; delete ex.reviewed; changed++; }
  }
  S.settings.healthSince = todayStr();
  sortEntries(); detectOutliers(); save();
  if (added || changed){
    render(); scheduleReminder();
    if (added) toast(`Added ${added} weigh-in${added > 1 ? "s" : ""} from Apple Health`);
    checkCelebrate(added > 3);
  } else {
    if (connectPending) toast(S.settings.healthFrom ? `Apple Health connected ✓ No weigh-ins since ${fmtDate(S.settings.healthFrom)} yet.` : "Apple Health connected ✓ No new weigh-ins.");
    render();
  }
  connectPending = false;
}
function connectHealth(){
  // Connecting imports every weigh-in already in Apple Health; "Import from" in Settings can limit it later.
  S.settings.healthRead = true; S.settings.healthFrom = null; save(); connectPending = true;
  nativeCmd("healthAuthorize", { write: S.settings.healthWrite });
  if (S.settings.notifyWeigh !== false) nativeCmd("notifyAuth");
  toast("Checking Apple Health…");
}
function scheduleReminder(){
  if (!NATIVE) return;
  const [h, m] = (S.settings.remindTime || "07:30").split(":").map(Number);
  let body = "Step on the scale before breakfast.";
  if (S.entries.length){ const r = computeTrend(); if (r.length) body = `Your trend is ${fw(r[r.length-1].trend)} ${U()}. Step on the scale before breakfast.`; }
  nativeCmd("reminder", { enabled: !!S.settings.remind, hour: isNaN(h) ? 7 : h, minute: isNaN(m) ? 30 : m, weighedToday: S.entries.some(e => e.date === todayStr()), body });
}

/* ---------- updates ---------- */
const REPO = "husain-313/Weight-tracker";
let latestRelease = null;
const buildOf = s => { const m = String(s || "").match(/\((\d+)\)|build[- ](\d+)/i); return m ? +(m[1] || m[2]) : 0; };
async function checkUpdate(manual){
  if (!NATIVE) return;
  if (!manual && Date.now() - (S.settings.updateChecked || 0) < 6*3600e3) return;
  try{
    const r = await http({ url: `https://api.github.com/repos/${REPO}/releases/latest`, headers: { "Accept": "application/vnd.github+json", "User-Agent": "Trendline" } });
    S.settings.updateChecked = Date.now(); save();
    if (r.status !== 200){ if (manual) toast("Couldn't check for updates right now."); return; }
    const d = JSON.parse(r.body), asset = (d.assets || []).find(a => /\.ipa$/i.test(a.name));
    const mine = buildOf(window.__APP_VERSION__), theirs = buildOf(d.tag_name);
    latestRelease = { name: d.name || d.tag_name, build: theirs, notes: d.body || "", url: asset ? asset.browser_download_url : d.html_url, page: d.html_url };
    if (theirs > mine){ if (manual || S.settings.updateSeen !== theirs) openUpdate(); if (tab === "settings") render(); }
    else if (manual) toast("You have the latest version");
  }catch(e){ if (manual) toast("Couldn't check for updates right now."); }
}
function openUpdate(){
  const u = latestRelease; if (!u) return;
  S.settings.updateSeen = u.build; save(); haptic("light");
  const notes = u.notes.split(/\n+/).filter(l => l.trim() && !/^Unsigned IPA|^Built with/.test(l)).join("\n");
  const sh = openSheet(`<div class="sheet-h"><button class="link" data-x>Later</button><h2>Update available</h2><span style="width:52px"></span></div>
    <div class="empty" style="padding:6px 0;gap:8px;display:flex;flex-direction:column"><div class="ring">${ICON.scale}</div><h2 style="font-size:1.1765rem">${esc(u.name.replace(/\s*\(build \d+\)/i, ""))}</h2>
      <p class="lbl">You have ${esc(window.__APP_VERSION__ || "an older version")}</p></div>
    <p class="note sel" style="white-space:pre-line;color:var(--fg)">${esc(notes)}</p>
    <button class="btn primary" id="uDl">Download update</button>
    <button class="btn" id="uCp">Copy download link</button>
    <p class="note" style="font-size:0.7647rem">Then install it with Signulous like before, keeping the same bundle ID so your data stays.</p>`);
  sh.querySelector("#uDl").onclick = () => { nativeCmd("openURL", { url: u.url }); haptic("light"); };
  sh.querySelector("#uCp").onclick = () => { nativeCmd("copy", { text: u.url }); haptic("success"); toast("Link copied"); };
}
let httpSeq = 0;
const httpWait = {};
function http(req){
  return new Promise((resolve, reject) => {
    if (!NATIVE) return reject(new Error("This works in the iPhone app"));
    const id = ++httpSeq; httpWait[id] = { resolve, reject };
    nativeCmd("http", { id, method: req.method || "GET", url: req.url, headers: req.headers || {}, body: req.body });
    setTimeout(() => { if (httpWait[id]){ delete httpWait[id]; reject(new Error("timed out")); } }, 35000);
  });
}
