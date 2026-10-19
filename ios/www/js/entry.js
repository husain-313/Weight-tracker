"use strict";
// Weigh-in sheet: starts at the last weight, so saving straight away or a couple of taps is enough.
// The number can also be dragged sideways (0.1 per step) or tapped to type.
function openEntry(entry){
  const last = S.entries[S.entries.length-1];
  const startVal = entry ? toU(entry.kg) : last ? toU(last.kg) : (U() === "lb" ? 170 : 75);
  const sh = openSheet(`
    <div class="sheet-h"><button class="link" data-x>Cancel</button><h2>${entry ? "Edit weigh-in" : "New weigh-in"}</h2><button class="link strong" id="es">Save</button></div>
    <div class="datebar"><button type="button" class="dnav" id="dprev" aria-label="Previous day">${CHEV.replace("<svg ", '<svg style="transform:rotate(180deg)" ')}</button>
      <label class="dlab"><span id="dtx"></span><input type="date" id="ed" value="${entry ? entry.date : todayStr()}" max="${todayStr()}" aria-label="Date"></label>
      <button type="button" class="dnav" id="dnext" aria-label="Next day">${CHEV}</button></div>
    <label class="wbox"><span class="k">Weight</span><input id="ew" inputmode="none" readonly autocomplete="off" value="${startVal.toFixed(1)}" aria-label="Weight in ${U()}"><span class="u">${U()}</span></label>
    <div class="list">
      <label class="item"><span class="k">Note</span><input id="en" maxlength="140" value="${esc(entry?.note || "")}" placeholder="Optional" style="width:60%"></label>
    </div>
    <p class="err" id="ee" hidden></p>
    <div class="btns">${entry ? `<button type="button" class="btn danger" id="edel">Delete</button>` : ""}<button class="btn primary" id="es2">${entry ? "Save" : "Add weigh-in"}</button></div>
    <div class="pad" id="pad">${["1","2","3","4","5","6","7","8","9",".","0","del"].map(k => `<button type="button" data-k="${k}" aria-label="${k === "del" ? "Delete digit" : k}">${k === "del" ? BKSP : k}</button>`).join("")}</div>`);
  const w = sh.querySelector("#ew");
  const read = () => parseFloat(w.value.replace(",", "."));
  // Typing on the pad replaces the number on the first key, then adds digits (one decimal at most).
  let fresh = true;
  sh.querySelectorAll("#pad button").forEach(b => b.onclick = () => {
    const k = b.dataset.k; let v = fresh ? "" : w.value; fresh = false;
    if (k === "del") v = v.slice(0, -1);
    else if (k === "."){ if (!v.includes(".")) v = (v || "0") + "."; }
    else if (!(v.includes(".") && v.split(".")[1].length >= 1) && v.replace(".", "").length < 4) v = (v === "0" ? "" : v) + k;
    w.value = v; haptic("selection");
  });
  // Date: arrows step a day, tapping the date opens the picker.
  const ed = sh.querySelector("#ed");
  const showDate = () => {
    const d = ed.value, t = todayStr(), y = fromDnum(dnum(t) - 1);
    sh.querySelector("#dtx").textContent = d === t ? `Today, ${fmtDate(d)}` : d === y ? `Yesterday, ${fmtDate(d)}` : `${WD[parts(d).wd]}, ${fmtDate(d)}`;
    sh.querySelector("#dnext").disabled = d >= t;
  };
  const stepDay = n => { const v = fromDnum(dnum(ed.value) + n); if (v > todayStr()) return; ed.value = v; showDate(); haptic("selection"); };
  sh.querySelector("#dprev").onclick = () => stepDay(-1); sh.querySelector("#dnext").onclick = () => stepDay(1);
  ed.addEventListener("change", () => { if (!/^\d{4}-\d{2}-\d{2}$/.test(ed.value) || ed.value > todayStr()) ed.value = todayStr(); showDate(); });
  showDate();
  if (entry) sh.querySelector("#edel").onclick = () => { closeSheet(); deleteEntry(entry); };
  const submit = () => {
    const v = read(), date = sh.querySelector("#ed").value, note = sh.querySelector("#en").value.trim(), err = sh.querySelector("#ee");
    const kg = fromU(v);
    if (isNaN(v) || kg < 20 || kg > 400){ err.hidden = false; err.textContent = `Enter a weight between ${toU(20).toFixed(0)} and ${toU(400).toFixed(0)} ${U()}.`; haptic("warning"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)){ err.hidden = false; err.textContent = "Pick a date."; return; }
    if (entry && entry.date !== date && S.settings.healthWrite) nativeCmd("healthDelete", { date: entry.date });
    if (entry) S.entries = S.entries.filter(e => e.id !== entry.id);
    const same = S.entries.find(e => e.date === date), kgR = Math.round(kg*1000)/1000;
    const when = date === todayStr() ? Date.now() : null;
    if (same){ same.kg = kgR; same.note = note || same.note || ""; delete same.src; if (!same.t && when) same.t = when; }
    else { const ne = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date, kg: kgR, note };
      if (entry && entry.date === date && entry.t) ne.t = entry.t; else if (when) ne.t = when;
      S.entries.push(ne); }
    { const mine = S.entries.find(x => x.date === date); if (mine){ delete mine.outlier; delete mine.keep; delete mine.reviewed; } }
    sortEntries(); detectOutliers(); save(); closeSheet(); haptic("success"); render();
    const flagged = S.entries.find(x => x.date === date && x.outlier);
    toast(flagged ? "Saved. This weigh-in looks unusual, check it on Progress." : same ? "Updated that day's weigh-in" : "Saved");
    if (S.settings.healthWrite) nativeCmd("healthWrite", { date, kg: kgR });
    scheduleReminder(); checkCelebrate(false);
  };
  sh.querySelector("#es").onclick = submit; sh.querySelector("#es2").onclick = submit;
}
function numberSheet({ title, intro, label, value, placeholder, onSave, onClear }){
  const sh = openSheet(`<div class="sheet-h"><button class="link" data-x>Cancel</button><h2>${title}</h2><span style="width:52px"></span></div>
    ${intro ? `<p class="note">${intro}</p>` : ""}
    <div class="wbig"><input id="nv" class="num" inputmode="decimal" autocomplete="off" value="${value ?? ""}" placeholder="${placeholder}" aria-label="${label}"></div>
    <div style="text-align:center;color:var(--muted);margin-top:-10px;font-weight:600">${label}</div>
    <p class="err" id="ne" hidden></p>
    <button class="btn primary" id="ns">Save</button>
    ${onClear && value != null && value !== "" ? `<button class="btn" id="nc">Remove</button>` : ""}`);
  const i = sh.querySelector("#nv"); setTimeout(() => { i.focus(); i.select(); }, 350);
  sh.querySelector("#ns").onclick = () => { const v = parseFloat(i.value.replace(",", ".")); if (isNaN(v) || v <= 0){ const e = sh.querySelector("#ne"); e.hidden = false; e.textContent = "Enter a number above zero."; haptic("warning"); return; } onSave(v); closeSheet(); haptic("success"); render(); };
  const c = sh.querySelector("#nc"); if (c) c.onclick = () => { onClear(); closeSheet(); render(); };
}
function openCommit(){
  numberSheet({ title: "Weekly commitment", intro: `The pace you plan to ${goalDir() < 0 ? "lose" : "gain"} each week. The prediction shows when it would get you to your goal.`,
    label: `${U()} per week`, value: S.settings.commit ? toU(S.settings.commit).toFixed(2) : "", placeholder: U() === "lb" ? "1.0" : "0.5",
    onSave: v => { S.settings.commit = fromU(v); save(); }, onClear: () => { S.settings.commit = null; save(); } });
}
function openGoalSheet(){
  const rows = computeTrend();
  numberSheet({ title: "Goal weight", intro: "Your trend weight is measured against this goal. Starting weight and milestones are in Settings.", label: U(),
    value: S.settings.goal != null ? toU(S.settings.goal).toFixed(1) : "", placeholder: rows.length ? fw(rows[rows.length-1].trend) : "70.0",
    onSave: v => { setGoal(fromU(v)); checkCelebrate(true); }, onClear: () => setGoal(null) });
}
function setGoal(kg){
  const changed = kg !== S.settings.goal; S.settings.goal = kg;
  if (changed){ S.settings.goalSince = kg == null ? null : todayStr(); resetCelebrations(); }
  save();
}
