"use strict";
/* ---------- tabs, top bar ---------- */
const TITLES = { progress:"Progress", history:"History", settings:"Settings" };
let tab = "progress", lastTab = "progress";
let setPage = null;  // the open settings page, or null for the list of pages
try{ const t = localStorage.getItem(KEY + ":tab"); if (t === "history" || t === "logbook") tab = "history"; }catch(e){}
let chartIntro = true;  // the chart draws itself in on launch, on a tab switch and on a range change
function setTab(t){
  if (t === tab){ window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (t === "settings"){ lastTab = tab; setPage = null; }
  else { try{ localStorage.setItem(KEY + ":tab", t); }catch(e){} }
  tab = t; haptic("selection"); chartIntro = true;
  syncTabbar(); window.scrollTo(0, 0); render(true);
}
function syncTabbar(){ document.querySelectorAll(".tabbar [role=tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab))); }
// Moves the pill behind the selected tab. The first placement doesn't animate.
function placePill(){
  const b = document.querySelector(`.tabbar [role=tab][data-tab="${tab}"]`), pill = $(".tab-pill");
  if (!b || !pill || !b.offsetWidth) return;
  pill.style.transform = `translateX(${b.offsetLeft}px)`; pill.style.width = b.offsetWidth + "px";
  if (!pill.classList.contains("ready")) requestAnimationFrame(() => pill.classList.add("ready"));
}
document.querySelectorAll(".tabbar [role=tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("#addBtn").addEventListener("click", () => { haptic("light"); openEntry(); });
const topbar = $("#topbar");
window.addEventListener("scroll", () => topbar.classList.toggle("scrolled", window.scrollY > 30), { passive:true });

function render(animate){
  closeSwipe();
  document.body.dataset.tab = tab;
  const page = tab === "settings" && setPage ? SET_PAGES.find(p => p[0] === setPage) : null;
  $("#tbTitle").textContent = page ? page[1] : TITLES[tab];
  const L = $("#tbLeft"), R = $("#tbRight"); L.innerHTML = ""; R.innerHTML = "";
  if (page){ L.innerHTML = `<button class="link back" id="tbBack">${CHEV}Settings</button>`; $("#tbBack").onclick = () => { setPage = null; haptic("selection"); window.scrollTo(0, 0); render(true); }; }
  else if (tab === "settings"){ L.innerHTML = `<button class="link strong" id="tbDone">Done</button>`; $("#tbDone").onclick = () => setTab(lastTab); }
  else { R.innerHTML = `<button class="icon-btn" id="tbGear" aria-label="Settings">${ICON.gear}</button>`; $("#tbGear").onclick = () => setTab("settings"); }
  if (tab === "settings") renderSettings();
  else if (!S.entries.length) renderEmpty();
  else if (tab === "progress") renderProgress();
  else renderHistory();
  if (animate){ view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter"); }
  topbar.classList.toggle("scrolled", window.scrollY > 30);
  placePill();
}

function renderEmpty(){
  view.innerHTML = `<section class="card empty">
    <div class="ring">${ICON.scale}</div>
    <h2>Start your trend</h2>
    <p>Weigh in each morning. Trendline smooths out the daily ups and downs and shows where you're really heading.</p>
    <div class="btns" style="width:100%;max-width:340px;flex-direction:column">
      <button class="btn primary" id="e1">Add a weigh-in</button>
      ${NATIVE ? (S.settings.healthRead
        ? `<button class="btn" id="e2" style="color:var(--trend)">✓ Apple Health connected</button><p class="lbl" style="margin:-4px 0 0">Importing weigh-ins from ${fmtDate(S.settings.healthFrom || todayStr())}. Tap to check again.</p>`
        : `<button class="btn" id="e2">Connect Apple Health</button>`) : ""}
    </div>
    <button class="link" id="e4">Restore a backup</button>
    <button class="link" id="e3" style="color:var(--muted);font-weight:500">Try with demo data</button>
  </section>`;
  $("#e1").onclick = () => openEntry();
  const e2 = $("#e2"); if (e2) e2.onclick = () => { if (S.settings.healthRead){ connectPending = true; syncHealth(true); toast("Checking Apple Health…"); } else connectHealth(); };
  $("#e3").onclick = loadDemo;
  $("#e4").onclick = pickRestore;
}
