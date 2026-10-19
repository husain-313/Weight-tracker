"use strict";
/* ---------- history ---------- */
function renderHistory(){
  const valid = computeTrend(), vIdx = new Map(valid.map((r, i) => [r.id, i]));
  const rows = S.entries.map(e => { const i = vIdx.get(e.id); return i == null ? { ...e, trend: null, excluded: true } : valid[i]; });
  const byMonth = new Map(); rows.forEach(r => { const k = r.date.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(r); });
  let html = `<p class="dateline">${S.entries.length} weigh-in${S.entries.length > 1 ? "s" : ""}</p>`;
  // lowest counted weigh-in of each month, to compare a month with the one before
  const lows = new Map(); valid.forEach(r => { const k = r.date.slice(0, 7), l = lows.get(k); if (!l || r.kg <= l.kg) lows.set(k, r); });
  [...byMonth.keys()].sort().reverse().forEach(k => {
    const [y, m] = k.split("-").map(Number);
    // trend change across the month: end of this month against the end of the previous one
    const inMonth = valid.filter(r => r.date.slice(0, 7) === k), before = valid.filter(r => r.date < k + "-01");
    const ch = inMonth.length ? inMonth[inMonth.length-1].trend - (before.length ? before[before.length-1].trend : inMonth[0].trend) : null;
    const chHtml = ch == null || (!before.length && inMonth.length < 2) ? "" : `<span class="num ${tone(ch)}">${arrow(ch)} ${Math.abs(toU(ch)).toFixed(1)} ${U()}</span>`;
    // the month in numbers: its low weigh-in, the trend's weekly pace, and the low against last month's
    let sum = "";
    const low = lows.get(k);
    if (low){
      const startN = before.length ? before[before.length-1].n : inMonth[0].n, days = inMonth[inMonth.length-1].n - startN;
      const perWk = ch != null && days >= 6 ? ch/days*7 : null;
      const prevK = [...lows.keys()].filter(x => x < k).sort().pop(), prev = prevK ? lows.get(prevK) : null, vs = prev ? low.kg - prev.kg : null;
      const chg = d => d == null ? "—" : `<span class="${tone(d)}">${arrow(d)} ${Math.abs(toU(d)).toFixed(1)}</span>`;
      sum = `<div class="msum">
        <div><span class="ml">Low weigh-in</span><b class="num">${fw(low.kg)}</b><small>${fmtDate(low.date)}</small></div>
        <div><span class="ml">Trend</span><b class="num">${chg(perWk)}</b><small>${U()} per week</small></div>
        <div><span class="ml">Low vs last month</span><b class="num">${chg(vs)}</b><small>${prev ? `${U()} from ${MON[parts(prev.date).m-1]}` : "First month"}</small></div></div>`;
    }
    html += `<section class="card month"><div class="month-h"><h3>${MONF[m-1]} ${y}</h3>${chHtml}</div>${sum}
      <div class="hhead hgrid"><span>Date</span><span>Recorded</span><span>Moving<br>average</span><span>Weekly<br>rate</span></div>`;
    byMonth.get(k).slice().reverse().forEach(r => {
      const p = parts(r.date);
      // change in trend over the 7 days up to this weigh-in
      const wk = r.excluded || !valid.length || valid[0].n > r.n - 7 ? null : r.trend - trendAt(valid, r.n - 7);
      const bits = []; if (r.ignored) bits.push("Ignored, not counted"); else if (r.excluded) bits.push("Unusual, check it on Progress");
      if (r.note) bits.push(esc(r.note));
      const df = wk == null ? "—" : Math.abs(wk) < 0.05 ? "0.0" : `${wk < 0 ? "↓" : "↑"} ${Math.abs(toU(wk)).toFixed(1)}`;
      html += `<div class="swipe"><button class="del" data-del="${esc(r.id)}">Delete</button>
        <button class="lrow hgrid ${r.excluded ? "out" : ""}" data-id="${esc(r.id)}">
          <span class="d"><b class="num">${pad(p.d)}</b><small>${WD[p.wd]}</small></span>
          <span class="w num">${fw(r.kg)}${r.src === "health" ? `<span class="hbadge" title="From Apple Health">${ICON.heart}</span>` : ""}</span>
          <span class="t num c">${r.excluded ? "—" : fw(r.trend)}</span>
          <span class="c"><span class="dfp num ${wk == null ? "" : tone(wk)}" aria-label="Trend change this week">${df}</span></span>
          ${bits.length ? `<span class="memo">${bits.join(" · ")}</span>` : ""}
        </button></div>${r.id === S.entries[0].id ? `<div class="started">You started!</div>` : ""}`;
    });
    html += `</section>`;
  });
  view.innerHTML = html;
  view.querySelectorAll(".lrow").forEach(b => b.onclick = () => {
    if (suppressClick) return;
    if (swipeOpen){ closeSwipe(); return; }
    openEntry(S.entries.find(e => e.id === b.dataset.id));
  });
  view.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { const e = S.entries.find(x => x.id === b.dataset.del); if (e) deleteEntry(e); });
}
// swipe left on a history row to reveal Delete
let sw = null, swipeOpen = null, suppressClick = false;
function closeSwipe(){ if (swipeOpen){ swipeOpen.style.transform = ""; swipeOpen = null; } }
view.addEventListener("touchstart", ev => {
  const row = ev.target.closest(".lrow"); if (!row){ if (!ev.target.closest(".del")) closeSwipe(); return; }
  sw = { row, x: ev.touches[0].clientX, y: ev.touches[0].clientY, dx: 0, active: false, base: row === swipeOpen ? -88 : 0 };
}, { passive:true });
view.addEventListener("touchmove", ev => {
  if (!sw) return;
  const dx = ev.touches[0].clientX - sw.x, dy = ev.touches[0].clientY - sw.y;
  if (!sw.active){
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)){ sw.active = true; if (swipeOpen && swipeOpen !== sw.row) closeSwipe(); sw.row.classList.add("dragging"); }
    else if (Math.abs(dy) > 10){ sw = null; return; } else return;
  }
  sw.dx = dx; sw.row.style.transform = `translateX(${Math.min(0, Math.max(-130, sw.base + dx))}px)`;
}, { passive:true });
view.addEventListener("touchend", () => {
  if (!sw) return; const { row, active, base, dx } = sw; sw = null; if (!active) return;
  row.classList.remove("dragging"); suppressClick = true; setTimeout(() => suppressClick = false, 60);
  if (base + dx < -44){ row.style.transform = "translateX(-88px)"; if (swipeOpen !== row) haptic("light"); swipeOpen = row; }
  else { row.style.transform = ""; if (swipeOpen === row) swipeOpen = null; }
});
function deleteEntry(entry){
  S.settings.healthIgnore = [...new Set([...S.settings.healthIgnore, entry.date])];
  if (entry.src !== "health" && S.settings.healthWrite) nativeCmd("healthDelete", { date: entry.date });
  S.entries = S.entries.filter(e => e !== entry); save(); haptic("warning"); swipeOpen = null; render(); scheduleReminder();
  toast("Weigh-in deleted", { label: "Undo", fn: () => {
    S.settings.healthIgnore = S.settings.healthIgnore.filter(d => d !== entry.date);
    if (entry.src !== "health" && S.settings.healthWrite) nativeCmd("healthWrite", { date: entry.date, kg: entry.kg });
    if (!S.entries.some(e => e.date === entry.date)) S.entries.push(entry);
    sortEntries(); save(); render(); scheduleReminder();
  }});
}
