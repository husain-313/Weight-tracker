"use strict";
/* ---------- settings ---------- */
// Settings pages: [id, title, icon, shown in the browser too]
const SET_PAGES = [["goal", "Weight goal", "goal", true], ["units", "Units & trend", "scale", true], ["health", "Apple Health", "heart", false],
  ["remind", "Reminder", "bell", false], ["lock", "Face ID", "lock", false], ["look", "Appearance", "moon", true],
  ["backup", "Backup & data", "folder", true], ["about", "About & updates", "info", false]];
function renderSettings(){
  const s = S.settings, bk = backupInfo || {};
  // rows that aren't on the open page are missing, so their handlers attach to nothing
  const none = { addEventListener(){} }, $ = sel => view.querySelector(sel) || none;
  // a row label with its icon
  const lab = (ic, k, h) => `<span class="k wi">${ico(ic[0])}<span>${k}${h ? `<span class="h">${h}</span>` : ""}</span></span>`;
  const tgl = (ic, id, on, k, h) => `<label class="item">${lab(ic, k, h)}<input type="checkbox" class="tg" id="${id}" ${on ? "checked" : ""}></label>`;
  const inp = (ic, id, k, val, ph, h) => `<label class="item">${lab(ic, k, h)}<input id="${id}" class="num" inputmode="decimal" value="${val}" placeholder="${ph}"></label>`;
  const update = latestRelease && latestRelease.build > buildOf(window.__APP_VERSION__);
  let html = "";
  if (!setPage){
    const val = { goal: s.goal == null ? "Not set" : `${fw(s.goal)} ${U()}`, units: s.unit === "kg" ? "Kilograms" : "Pounds",
      health: s.healthRead ? "On" : "Off", remind: s.remind ? (s.remindTime || "07:30") : "Off", lock: s.lock ? "On" : "Off",
      look: { auto: "Match iPhone", light: "Light", dark: "Dark" }[s.theme], backup: bk.folder ? esc(bk.folder) : "",
      about: update ? `<span style="color:var(--trend)">Update available</span>` : "" };
    html = `<div class="list" style="margin-top:6px">${SET_PAGES.filter(p => p[3] || NATIVE).map(([id, t, ic]) =>
      `<button class="item nav" data-page="${id}">${lab([ic], t)}<span class="val">${val[id]}${CHEV}</span></button>`).join("")}</div>
      <p class="footer">Trendline${window.__APP_VERSION__ ? " " + esc(window.__APP_VERSION__) : ""}</p>`;
  }
  else if (setPage === "goal") html = `<div class="list">
      ${inp(["goal"], "sg", "Goal weight", s.goal == null ? "" : toU(s.goal).toFixed(1), U())}
      ${inp(["start"], "ss", "Starting weight", s.start == null ? "" : toU(s.start).toFixed(1), S.entries[0] ? fw(S.entries[0].kg) : U(), "Defaults to your first weigh-in")}
      ${inp(["steps"], "sm", "Milestone every", s.step == null ? "" : toU(s.step).toFixed(1), U() === "lb" ? "5.0" : "2.0")}
      ${inp(["calendar"], "sc", "Weekly commitment", s.commit == null ? "" : toU(s.commit).toFixed(2), `${U()}/wk`)}
    </div>
    <p class="group-f">Milestones split the way to your goal into smaller steps. Your commitment is the weekly pace you aim for, used for a second goal date.</p>`;
  else if (setPage === "units") html = `<div class="list">
      <label class="item">${lab(["scale"], "Units")}<select id="su"><option value="kg" ${s.unit === "kg" ? "selected" : ""}>Kilograms</option><option value="lb" ${s.unit === "lb" ? "selected" : ""}>Pounds</option></select></label>
      <label class="item">${lab(["wave"], "Trend smoothing", "Heavier smoothing ignores daily swings more but reacts slower")}
        <select id="sa"><option value="0.2" ${s.smooth == 0.2 ? "selected" : ""}>Light</option><option value="0.1" ${s.smooth == 0.1 ? "selected" : ""}>Standard</option><option value="0.05" ${s.smooth == 0.05 ? "selected" : ""}>Heavy</option></select></label>
    </div>
    <p class="group-f">The trend is an exponentially smoothed moving average: each weigh-in moves it part of the way, so one heavy or light day barely shifts it.</p>`;
  else if (setPage === "health") html = `<div class="list">
      ${tgl(["heart"], "hr", s.healthRead, "Import weigh-ins", "Weight from your smart scale or other apps")}
      ${tgl(["save"], "hw", s.healthWrite, "Save weigh-ins to Health", "Weights you log here are added to Apple Health")}
      ${s.healthRead ? `<label class="item">${lab(["calendar"], "Import from", s.healthFrom ? "Older readings in Apple Health are ignored" : "All readings in Apple Health are imported")}<input type="date" id="hf" value="${s.healthFrom || ""}" max="${todayStr()}"></label>` : ""}
      ${s.healthRead && s.healthFrom ? `<button class="item" id="hfAll">${lab(["refresh"], "Import all weigh-ins", "Bring in everything in Apple Health, not just from this date")}</button>` : ""}
      ${s.healthRead ? tgl(["bell"], "hn", s.notifyWeigh !== false, "Notify after each weigh-in", "Weight and trend as soon as your scale syncs") : ""}
      ${s.healthRead ? `<button class="item" id="hs">${lab(["refresh"], "Check now")}<span class="val">${s.healthSince ? "Last " + fmtDate(s.healthSince) : "Not yet"}</span></button>` : ""}
    </div>`;
  else if (setPage === "remind") html = `<div class="list">
      ${tgl(["bell"], "rm", s.remind, "Remind me to weigh in", "Skipped on days you've already weighed in")}
      <label class="item">${lab(["clock"], "Time")}<input type="time" id="rt" value="${s.remindTime || "07:30"}" ${s.remind ? "" : "disabled"}></label>
    </div>`;
  else if (setPage === "lock") html = `<div class="list">${tgl(["lock"], "lk", s.lock, "Lock with Face ID", "Asks for Face ID or your passcode when you open the app")}</div>`;
  else if (setPage === "look") html = `<div class="list">
      <label class="item">${lab(["moon"], "Theme")}<select id="st"><option value="auto" ${s.theme === "auto" ? "selected" : ""}>Match iPhone</option><option value="light" ${s.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${s.theme === "dark" ? "selected" : ""}>Dark</option></select></label>
    </div>`;
  else if (setPage === "backup") html = `<div class="list">
      ${NATIVE ? `<button class="item" id="bf">${lab(["folder"], "Backup folder", esc(folderText()))}<span class="val" style="color:var(--${bk.folder && !bk.folderError ? "trend" : "muted"})">${bk.folder ? esc(bk.folder) : "Choose"}</span></button>
      <button class="item action" id="bn">Back up now</button>` : ""}
      <button class="item action" id="bx">Export backup</button>
      <button class="item action" id="bc">Export spreadsheet (CSV)</button>
      <button class="item action" id="bi">Restore from backup</button>
    </div>
    <p class="group-f">${NATIVE ? esc(backupText()) + " Automatic backups are in the Files app: On My iPhone › Trendline › Backups." : "Your data stays on this device. Export a backup now and then."}</p>
    ${NATIVE && bk.folder ? `<div class="list"><button class="item action" id="bfr">Stop copying to ${esc(bk.folder)}</button></div>` : ""}
    <div class="list" style="margin-top:8px"><button class="item danger" id="bd">Erase all data</button></div>`;
  else if (setPage === "about") html = `<div class="list">
      <div class="item">${lab(["info"], "Version")}<span class="val">${esc(window.__APP_VERSION__ || "—")}</span></div>
      ${bk.bundle ? `<div class="item">${lab(["tag"], "Bundle ID")}<span class="val" style="font-size:0.7647rem">${esc(bk.bundle)}</span></div>` : ""}
      ${update ? `<button class="item action" id="upOpen">Update to ${esc(latestRelease.name.replace(/\s*\(build \d+\)/i, ""))}</button>` : ""}
      <button class="item action" id="upChk">Check for updates</button></div>`;
  view.innerHTML = html;
  view.querySelectorAll("[data-page]").forEach(b => b.onclick = () => { setPage = b.dataset.page; haptic("selection"); window.scrollTo(0, 0); render(true); });

  const num = (id, cb) => $(id).addEventListener("change", e => { const raw = e.target.value.trim().replace(",", "."), v = raw === "" ? null : parseFloat(raw); if (raw !== "" && (isNaN(v) || v <= 0)){ toast("Enter a number above zero"); return; } cb(v); save(); haptic("light"); toast("Saved"); });
  num("#sg", v => setGoal(v == null ? null : fromU(v)));
  num("#ss", v => { S.settings.start = v == null ? null : fromU(v); resetCelebrations(); });
  num("#sm", v => { S.settings.step = v == null ? null : fromU(v); resetCelebrations(); });
  num("#sc", v => S.settings.commit = v == null ? null : fromU(v));
  $("#su").onchange = e => { S.settings.unit = e.target.value; save(); haptic("light"); render(); };
  $("#sa").onchange = e => { S.settings.smooth = parseFloat(e.target.value); save(); resetCelebrations(); haptic("light"); };
  $("#st").onchange = e => { S.settings.theme = e.target.value; save(); applyTheme(); render(); };
  $("#bx").onclick = () => exportFile(`trendline-backup-${todayStr()}.json`, JSON.stringify(S, null, 1), "application/json");
  $("#bc").onclick = () => { const rows = computeTrend(); exportFile(`trendline-${todayStr()}.csv`, "Date,Weight (kg),Trend (kg),Note\n" + rows.map(r => `${r.date},${r.kg.toFixed(2)},${r.trend.toFixed(2)},"${(r.note || "").replace(/"/g, '""')}"`).join("\n"), "text/csv"); };
  $("#bi").onclick = pickRestore;
  const bd = $("#bd"); let armed = false;
  bd.onclick = () => { if (!armed){ armed = true; bd.textContent = "Tap again to erase everything"; haptic("warning"); return; }
    const keepLock = S.settings.lock; S = { schema:SCHEMA, entries:[], settings:{...DEFAULTS, lock: keepLock} }; normalize(); save(); applyTheme(); scheduleReminder(); setTab("progress"); toast("All data erased"); };
  if (NATIVE){
    $("#hr").onchange = e => { if (e.target.checked) connectHealth(); else { S.settings.healthRead = false; save(); } haptic("light"); render(); };
    $("#hw").onchange = e => { S.settings.healthWrite = e.target.checked; save(); haptic("light"); if (e.target.checked) nativeCmd("healthAuthorize", { write: true }); };
    const hn = $("#hn"); if (hn) hn.onchange = e => { S.settings.notifyWeigh = e.target.checked; save(); haptic("light"); if (e.target.checked) nativeCmd("notifyAuth"); };
    const hf = $("#hf"); if (hf) hf.onchange = e => {
      const v = e.target.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      const older = S.settings.healthFrom && v < S.settings.healthFrom;
      S.settings.healthFrom = v;
      const removed = pruneBeforeFrom();
      S.settings.healthIgnore = S.settings.healthIgnore.filter(d => d >= v);
      save(); haptic("light"); resetCelebrations(); render();
      if (older) syncHealth(true);
      toast(removed ? `Removed ${removed} older Apple Health weigh-in${removed > 1 ? "s" : ""}` : `Importing from ${fmtDate(v)}`);
    };
    const hfAll = $("#hfAll"); if (hfAll) hfAll.onclick = () => { S.settings.healthFrom = null; save(); haptic("light"); resetCelebrations(); render(); connectPending = true; syncHealth(true); toast("Importing all weigh-ins from Apple Health…"); };
    const hs = $("#hs"); if (hs) hs.onclick = () => { syncHealth(true); toast("Checking Apple Health…"); };
    $("#rm").onchange = e => { S.settings.remind = e.target.checked; save(); haptic("light"); scheduleReminder(); render(); if (e.target.checked) toast(`Reminder set for ${S.settings.remindTime}`); };
    $("#rt").onchange = e => { if (!e.target.value) return; S.settings.remindTime = e.target.value; save(); scheduleReminder(); toast(`Reminder set for ${e.target.value}`); };
    $("#lk").onchange = e => { const want = e.target.checked; e.target.checked = S.settings.lock; nativeCmd("lockSet", { enabled: want }); };
    $("#bf").onclick = () => { haptic("light"); nativeCmd("chooseBackupFolder"); };
    $("#bn").onclick = () => { haptic("light"); nativeCmd("backupNow"); };
    const bfr = $("#bfr"); if (bfr) bfr.onclick = () => { haptic("light"); nativeCmd("removeBackupFolder"); toast("Stopped copying to the folder"); };
    $("#upChk").onclick = () => { haptic("light"); toast("Checking…"); checkUpdate(true); };
    const uo = $("#upOpen"); if (uo) uo.onclick = openUpdate;
    nativeCmd("backupInfo");
  }
}

/* ---------- backup ---------- */
function exportFile(name, text, type){
  haptic("light");
  if (NATIVE && window.webkit.messageHandlers.share){ window.webkit.messageHandlers.share.postMessage({ name, text }); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function pickRestore(){
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = async () => { const f = inp.files[0]; if (!f) return; restoreBackup(await f.text()); };
  inp.click();
}
function restoreBackup(text){
  let d; try{ d = JSON.parse(text); }catch(e){ d = null; }
  if (!d || !Array.isArray(d.entries)){ toast("That file isn't a Trendline backup."); haptic("warning"); return; }
  if ((d.schema || 1) > SCHEMA){ toast("This backup is from a newer Trendline. Update the app first."); haptic("warning"); return; }
  upgrade(d);
  let added = 0, updated = 0;
  for (const e of d.entries){
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !(e.kg > 20 && e.kg < 400)) continue;
    const ex = S.entries.find(x => x.date === e.date);
    if (ex){ Object.assign(ex, e, { id: ex.id }); updated++; } else { S.entries.push({ ...e, id: e.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7) }); added++; }
  }
  if (d.settings){ const keep = { lock: S.settings.lock }; S.settings = { ...DEFAULTS, ...d.settings, ...keep }; }
  normalize(); sortEntries(); save(); applyTheme(); scheduleReminder(); checkCelebrate(true); render(); haptic("success");
  toast(`Restored: ${added} new, ${updated} updated`);
}
function loadDemo(){
  const end = dnum(todayStr()); let w = 86;
  for (let i = 120; i >= 0; i--){ if (Math.random() < 0.15) continue; w += -0.06 + (Math.random() - .5)*0.15; const noise = (Math.random() - .5)*1.2;
    S.entries.push({ id: "demo" + i, date: fromDnum(end - i), kg: Math.round((w + noise)*10)/10, note: i === 60 ? "Demo data" : "" }); }
  S.settings.goal = 78; S.settings.goalSince = fromDnum(end - 120); S.settings.commit = 0.5;
  sortEntries(); resetCelebrations(); save(); render(true); toast("Demo data loaded. Erase it in Settings.");
}
