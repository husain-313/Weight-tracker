"use strict";
/* ---------- progress ---------- */
function renderProgress(){
  const rows = computeTrend();
  let html = "";
  const odd = S.entries.filter(e => e.outlier && !e.keep && !e.ignored);
  for (const e of odd.slice(-3)){
    const before = rows.filter(r => r.date < e.date), t = before.length ? before[before.length-1].trend : null;
    html += `<section class="card" style="box-shadow:inset 0 0 0 1.5px var(--goal)"><div class="card-h"><h2>Check this weigh-in</h2></div>
      <p class="note"><b style="color:var(--fg)">${fmtDate(e.date)}: ${fw(e.kg)} ${U()}</b>${t != null ? `, ${fd(e.kg - t)} ${U()} from your trend of ${fw(t)}` : ""}. Someone else on the scale, clothes or a big meal can cause this. It isn't counted until you decide.</p>
      <div class="btns"><button class="btn" data-odd-keep="${esc(e.id)}">It's right, count it</button><button class="btn danger" data-odd-ignore="${esc(e.id)}">Ignore it</button></div></section>`;
  }
  if (rows.length) html += statsCard(rows) + goalCard(rows) + predictCard(rows) + chartCard();
  view.innerHTML = html;
  bindProgress(rows);
}
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
let goalShown = 0;  // share of the goal the bar last showed, so it grows from there
const agoText = n => { const d = dnum(todayStr()) - n; return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`; };
const RECENT = 10;  // days in the recent stats card
const recentRows = rows => { const last = rows[rows.length-1]; return rows.filter(r => r.n > last.n - RECENT); };
// Colours for "above" and "below" follow the goal: above the trend is red when you're losing, green when you're gaining.
const upDown = () => goalDir() > 0 ? [css("--good"), css("--bad")] : [css("--bad"), css("--good")];
// High, latest, trend and low over the last days, stacked beside a small chart of those days.
function statsCard(rows){
  const last = rows[rows.length-1], recent = recentRows(rows);
  let hi = recent[0], lo = recent[0];
  for (const r of recent){ if (r.kg >= hi.kg) hi = r; if (r.kg <= lo.kg) lo = r; }
  const gain = goalDir() > 0, wk = changeOver(rows, 7);
  const chg = wk == null ? "" : `<span class="chg ${tone(wk)} num">${arrowIcon(wk)}${Math.abs(toU(wk)).toFixed(1)} ${U()} this week</span>`;
  const tile = (cls, label, kg, sub) => `<div class="tile ${cls}"><span class="tl">${label}</span><span class="tv num">${fw(kg)}</span>${sub ? `<span class="ts">${sub}</span>` : ""}</div>`;
  return `<section class="card"><div class="card-h"><h2>Recent stats</h2>${chg}</div><div class="recent">
    <canvas id="mini" aria-label="Weigh-ins over the last ${RECENT} days"></canvas>
    <div class="tiles">${tile(gain ? "lo" : "hi", "High", hi.kg, agoText(hi.n))}${tile("la", "Latest", last.kg, "")}
    ${tile("tr", "Trend", last.trend, "")}${tile(gain ? "hi" : "lo", "Low", lo.kg, agoText(lo.n))}</div></div></section>`;
}
// The recent stats chart: one column per day, the weigh-ins as a thin line, the trend in blue,
// and the high and low as red and green lines along the top and bottom.
function paintMini(cv, rows){
  if (!cv) return;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W*dpr; cv.height = H*dpr; const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const recent = recentRows(rows), end = rows[rows.length-1].n, x0 = end - RECENT + 1;
  const prev = rows.filter(r => r.n < x0).slice(-1), all = [...prev, ...recent];
  const vals = recent.flatMap(r => [toU(r.kg), toU(r.trend)]);
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < .6){ const m = (hi + lo)/2; lo = m - .3; hi = m + .3; }
  const T = 6, B = 18, L = 2, Rp = 2, cw = (W - L - Rp)/RECENT;
  const X = n => L + (n - x0 + .5)*cw, Y = v => T + (hi - v)/(hi - lo)*(H - T - B);
  const [up, down] = upDown(), muted = css("--muted");
  c.strokeStyle = css("--line"); c.lineWidth = 1;
  for (let i = 0; i <= RECENT; i++){ const x = Math.round(L + i*cw) + .5; c.beginPath(); c.moveTo(x, T); c.lineTo(x, H - B); c.stroke(); }
  for (const [v, col] of [[hi, up], [lo, down]]){ c.strokeStyle = col; c.lineWidth = 2; c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(W - Rp, Y(v)); c.stroke(); }
  c.save(); c.beginPath(); c.rect(L, 0, W - L - Rp, H); c.clip();
  c.strokeStyle = muted; c.lineWidth = 1.5; c.lineJoin = "round"; c.beginPath();
  all.forEach((r, i) => i ? c.lineTo(X(r.n), Y(toU(r.kg))) : c.moveTo(X(r.n), Y(toU(r.kg)))); c.stroke();
  c.strokeStyle = css("--trend"); c.lineWidth = 2.5; c.lineCap = "round"; c.beginPath(); curve(c, all.map(r => [X(r.n), Y(toU(r.trend))])); c.stroke();
  c.restore();
  c.font = `700 11px ${NUMFONT}`; c.textAlign = "center"; c.fillStyle = muted;
  for (let n = x0; n <= end; n++) c.fillText(WD[parts(fromDnum(n)).wd].slice(0, 1), X(n), H - 4);
}
const RANGES = [[7,"7 Days"],[30,"30 Days"],[90,"90 Days"],[365,"365"],[0,"All"]];
function chartCard(){
  const R = S.settings.chartRange;
  return `<section class="card chart-card"><div class="card-h"><h2>Weight chart</h2></div>
    <div class="chart-wrap"><canvas id="chart" aria-label="Weight chart"></canvas><div class="tip" id="tip" hidden></div></div>
    <div class="seg" id="rng">${RANGES.map(([v,l]) => `<button data-r="${v}" aria-pressed="${R === v}">${l}</button>`).join("")}</div>
  </section>`;
}
function goalCard(rows){
  const last = rows[rows.length-1], g = S.settings.goal;
  if (g == null) return `<section class="card"><div class="card-h"><h2>Goal</h2></div>
    <p class="note">Set a goal weight to see your progress, milestones and the day you'll get there.</p>
    <button class="btn primary" id="glSet">Set a goal</button></section>`;
  const st = startWeight(), tot = st - g, dir = goalDir();
  const done = tot === 0 ? 1 : Math.max(0, Math.min(1, (st - last.trend)/tot));
  const left = last.trend - g, miles = milestones();
  const nextIdx = miles.findIndex(m => dir < 0 ? last.trend > m : last.trend < m);
  const marks = miles.length <= 40 ? miles.slice(0, -1).map(m => {
    const at = tot === 0 ? 1 : (st - m)/tot, on = dir < 0 ? last.trend <= m : last.trend >= m;
    return `<i class="mk ${on ? "on" : ""}" style="left:${at*100}%"></i>`;
  }).join("") : "";
  let next;
  if (goalReached(last.trend)) next = "You've reached your goal.";
  else if (nextIdx === miles.length - 1) next = `Next stop: your goal, ${Math.abs(toU(left)).toFixed(1)} ${U()} away`;
  else next = `Next milestone <b class="num" style="color:var(--fg)">${fw(miles[nextIdx])} ${U()}</b> · ${Math.abs(toU(last.trend - miles[nextIdx])).toFixed(1)} ${U()} away`;
  return `<section class="card"><div class="card-h"><h2>Goal ${fw(g)} ${U()}</h2><button class="mini-btn" id="glSet" aria-label="Edit goal">${ICON.pencil}</button></div>
    <div class="gline num">${Math.round(done*100)}% <small>· ${goalReached(last.trend) ? "done" : `${Math.abs(toU(left)).toFixed(1)} ${U()} to go`}</small></div>
    <div class="gbar" role="progressbar" aria-valuenow="${Math.round(done*100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${(calm() ? done : goalShown)*100}%" data-to="${done}"></span>${marks}</div>
    <div class="gends num"><span>${fw(st)}</span><span>${fw(g)}</span></div>
    <p class="note">${next}</p>
  </section>`;
}
function predictCard(rows){
  const g = S.settings.goal; if (g == null) return "";
  const last = rows[rows.length-1], left = last.trend - g, cur = slope(rows, 28), dir = goalDir();
  let main;
  if (goalReached(last.trend)) main = `<p class="pred-big">You're there</p><p class="note">Set a new goal in Settings when you're ready.</p>`;
  else if (cur == null) main = `<p class="pred-big muted">Not enough data yet</p><p class="note">A date appears after about a week of weigh-ins.</p>`;
  else {
    const e = etaFor(cur, left, last.n);
    if (!e) main = `<p class="pred-big muted">Not on pace yet</p><p class="note">Your trend isn't heading toward your goal right now. Keep weighing in, and the date appears once it does.</p>`;
    else if (e.far) main = `<p class="pred-big muted">More than 10 years away</p><p class="note">At your current pace of ${Math.abs(toU(cur*7)).toFixed(2)} ${U()} a week.</p>`;
    else { const p = parts(e.date);
      main = `<p class="lbl">You'll reach ${fw(g)} ${U()} around</p><p class="pred-day num">${p.d} ${MON[p.m-1]}</p>
      <p class="pred-sub num">${p.y} · ${inTime(e.days).replace(/^In/, "in")}</p>
      <p class="note">At your current pace of ${Math.abs(toU(cur*7)).toFixed(2)} ${U()} a week</p>`; }
  }
  let alt = "";
  if (!goalReached(last.trend)){
    if (S.settings.commit){
      const e = etaFor(S.settings.commit/7*dir, left, last.n);
      alt = `<div class="pred-alt"><span>At your commitment of ${toU(S.settings.commit).toFixed(2)} ${U()} a week</span><b class="num">${e && !e.far ? fmtDate(e.date) : "—"}</b></div>`;
    } else alt = `<button class="link" id="prSet" style="align-self:flex-start;font-size:0.8824rem">Set a weekly commitment</button>`;
  }
  return `<section class="card"><div class="card-h"><h2>Prediction</h2></div>${main}${alt}</section>`;
}
function bindProgress(rows){
  document.querySelectorAll("[data-odd-keep]").forEach(b => b.onclick = () => { const e = S.entries.find(x => x.id === b.dataset.oddKeep); if (!e) return; e.keep = true; e.outlier = false; e.reviewed = true; detectOutliers(); save(); haptic("success"); render(); toast("Counted"); });
  document.querySelectorAll("[data-odd-ignore]").forEach(b => b.onclick = () => { const e = S.entries.find(x => x.id === b.dataset.oddIgnore); if (!e) return; e.ignored = true; e.outlier = false; detectOutliers(); save(); haptic("warning"); render();
    toast("Ignored", { label: "Undo", fn: () => { delete e.ignored; e.keep = true; save(); render(); } }); });
  document.querySelectorAll("#rng button").forEach(b => b.onclick = () => { S.settings.chartRange = +b.dataset.r; save(); haptic("selection");
    document.querySelectorAll("#rng button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); mountChart($("#chart"), $("#tip"), rows, S.settings.chartRange, true); });
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on("glSet", openGoalSheet); on("prSet", openCommit);
  if ($("#chart")){ mountChart($("#chart"), $("#tip"), rows, S.settings.chartRange, chartIntro); chartIntro = false; }
  paintMini($("#mini"), rows);
  const gb = $(".gbar > span");
  if (gb){ const to = +gb.dataset.to; goalShown = to; requestAnimationFrame(() => requestAnimationFrame(() => { gb.style.width = to*100 + "%"; })); }
}

/* ---------- chart ---------- */
function niceStep(range, target){ const raw = range/target, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw/p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)*p; }
// Smooth curve through the points (monotone cubic, so it never overshoots into a bump the data doesn't have).
function curve(c, pts, cont){
  const n = pts.length; if (!n) return;
  if (cont) c.lineTo(pts[0][0], pts[0][1]); else c.moveTo(pts[0][0], pts[0][1]); if (n === 1) return;
  if (n === 2){ c.lineTo(pts[1][0], pts[1][1]); return; }
  const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i+1][1] - pts[i][1])/((pts[i+1][0] - pts[i][0]) || 1e-6));
  m[0] = d[0]; m[n-1] = d[n-2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i-1]*d[i] <= 0 ? 0 : (d[i-1] + d[i])/2;
  for (let i = 0; i < n - 1; i++){
    if (d[i] === 0){ m[i] = 0; m[i+1] = 0; continue; }
    const a = m[i]/d[i], b = m[i+1]/d[i], s = a*a + b*b;
    if (s > 9){ const t = 3/Math.sqrt(s); m[i] = t*a*d[i]; m[i+1] = t*b*d[i]; }
  }
  for (let i = 0; i < n - 1; i++){
    const [x0, y0] = pts[i], [x1, y1] = pts[i+1], h = (x1 - x0)/3;
    c.bezierCurveTo(x0 + h, y0 + m[i]*h, x1 - h, y1 - m[i+1]*h, x1, y1);
  }
}
// Draws the weight chart into context c at size W×H: the year and months along the top over alternating columns,
// a thin line from the trend to each weigh-in with the gap shaded, the blue trend curve, faint milestone lines
// and the dashed goal line. `prog` (0–1) reveals the curve from the left;
// `sel` is the weigh-in being inspected. Returns the x scale and visible rows for the tooltip.
function paintChart(c, W, H, allRows, R, prog, sel){
  const end = allRows[allRows.length-1].n;
  let rows = R ? allRows.filter(r => r.n > end - R) : allRows; if (!rows.length) rows = allRows.slice(-1);
  // A history shorter than the range fills the chart (at least a week wide) instead of hugging the right edge;
  // a little room after the last day keeps its dot whole.
  const x0 = Math.min(R ? Math.max(end - R, allRows[0].n - 1) : rows[0].n, end - 6);
  const x1 = end + Math.max(0.6, (end - x0)*0.02);
  const vals = rows.flatMap(r => [toU(r.kg), toU(r.trend)]); if (S.settings.goal != null && R === 0) vals.push(toU(S.settings.goal));
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi - lo < 1){ const m = (hi + lo)/2; lo = m - .5; hi = m + .5; }
  const st = niceStep(hi - lo, 4); lo = Math.floor(lo/st)*st; hi = Math.ceil(hi/st)*st;
  const L = 40, Rp = 8, T = 40, B = 8;
  const X = n => L + (n - x0)/(x1 - x0)*(W - L - Rp);
  const Y = v => T + (hi - v)/(hi - lo)*(H - T - B);
  const muted = css("--muted"), line = css("--line"), trend = css("--trend"), goal = css("--goal"), shade = css("--band");
  c.font = `600 11px ${NUMFONT}`; c.textBaseline = "middle";
  for (let v = lo; v <= hi + 1e-9; v += st){
    c.strokeStyle = line; c.lineWidth = 1; c.beginPath(); c.moveTo(L, Math.round(Y(v)) + .5); c.lineTo(W - Rp, Math.round(Y(v)) + .5); c.stroke();
    c.fillStyle = muted; c.textAlign = "right"; c.fillText(v.toFixed(st < 1 ? 1 : 0), L - 8, Y(v));
  }
  // Columns (days, weeks or months) shaded in turn, labelled along the top under the year.
  c.textAlign = "center"; c.textBaseline = "alphabetic";
  const span = x1 - x0, cols = [];
  if (span <= 10) for (let n = Math.floor(x0); n <= end; n++) cols.push([n - .5, n + .5, WD[parts(fromDnum(n)).wd].toUpperCase()]);
  else if (span <= 45){ for (let n = Math.floor(x0/7)*7; n <= x1; n += 7){ const p = parts(fromDnum(n + 3)); cols.push([n, n + 7, `${p.d} ${MON[p.m-1].toUpperCase()}`]); } }
  else {
    const every = span > 1500 ? 12 : span > 500 ? 3 : span > 200 ? 2 : 1, d0 = new Date(x0*DAY);
    let cur = new Date(Date.UTC(d0.getUTCFullYear(), Math.floor(d0.getUTCMonth()/every)*every, 1));
    while (cur.getTime()/DAY <= x1){
      const nx = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + every, 1));
      cols.push([cur.getTime()/DAY, nx.getTime()/DAY, every >= 12 ? String(cur.getUTCFullYear()) : MON[cur.getUTCMonth()].toUpperCase()]);
      cur = nx;
    }
  }
  c.font = `700 10px ${NUMFONT}`;
  cols.forEach(([a, b, label], i) => {
    const xa = Math.max(L, X(a)), xb = Math.min(W - Rp, X(b)); if (xb <= xa) return;
    if (i % 2 === 0){ c.fillStyle = shade; c.fillRect(xa, T, xb - xa, H - T - B); }
    const lx = (xa + xb)/2, tw = c.measureText(label).width;
    if (xb - xa > tw + 2 || cols.length <= 6){ c.fillStyle = muted; c.fillText(label, Math.max(L + tw/2, Math.min(W - Rp - tw/2, lx)), T - 8); }
  });
  const y0 = parts(fromDnum(Math.ceil(x0))).y, y1 = parts(fromDnum(end)).y;
  c.font = `700 13px ${NUMFONT}`; c.fillStyle = css("--fg"); c.fillText(y0 === y1 ? String(y1) : `${y0} – ${y1}`, L + (W - L - Rp)/2, 13);
  // milestones and goal, labelled at the right edge
  const g = S.settings.goal;
  if (g != null){
    c.font = `600 11px ${NUMFONT}`; c.textAlign = "right"; c.textBaseline = "bottom";
    const miles = milestones();
    for (const m of miles){
      const y = Y(toU(m)), isGoal = Math.abs(m - g) < 0.001;
      if (y < T || y > H - B) continue;
      c.strokeStyle = goal; c.globalAlpha = isGoal ? 1 : .35; c.lineWidth = isGoal ? 1.5 : 1;
      if (isGoal) c.setLineDash([5, 5]);
      c.beginPath(); c.moveTo(L, Math.round(y) + .5); c.lineTo(W - Rp, Math.round(y) + .5); c.stroke(); c.setLineDash([]);
      c.globalAlpha = isGoal ? 1 : .75; c.fillStyle = goal; c.fillText(isGoal ? `Goal ${fw(m)}` : fw(m), W - Rp - 2, y - 3);
      c.globalAlpha = 1;
    }
  }
  c.save(); c.beginPath(); c.rect(L, 0, W - L - Rp, H); c.clip();
  const firstIdx = allRows.indexOf(rows[0]); const lead = firstIdx > 0 ? [allRows[firstIdx-1], ...rows] : rows;
  const [up, down] = upDown();
  const pts = lead.map(r => [X(r.n), Y(toU(r.trend))]), wp = lead.map(r => [X(r.n), Y(toU(r.kg))]);
  c.save(); c.beginPath(); c.rect(L, 0, (W - L - Rp)*prog + 2, H); c.clip();
  // The gap between each weigh-in and the trend: red where the scale read above the trend, green below it.
  if (pts.length > 1){
    const band = () => { c.beginPath(); c.moveTo(wp[0][0], wp[0][1]); for (let i = 1; i < wp.length; i++) c.lineTo(wp[i][0], wp[i][1]); curve(c, pts.slice().reverse(), true); c.closePath(); };
    for (const [col, edge] of [[up, 0], [down, H]]){
      c.save(); c.beginPath(); curve(c, pts); c.lineTo(pts[pts.length-1][0] + 40, pts[pts.length-1][1]); c.lineTo(pts[pts.length-1][0] + 40, edge); c.lineTo(pts[0][0] - 40, edge); c.lineTo(pts[0][0] - 40, pts[0][1]); c.closePath(); c.clip();
      band(); c.fillStyle = col; c.globalAlpha = .4; c.fill(); c.globalAlpha = 1; c.restore();
    }
  }
  // a thin line from the trend to each weigh-in
  if (rows.length <= 400){ c.strokeStyle = trend; c.lineWidth = rows.length > 120 ? 1 : 1.5; c.lineCap = "round";
    for (const r of rows){ const x = X(r.n); c.beginPath(); c.moveTo(x, Y(toU(r.trend))); c.lineTo(x, Y(toU(r.kg))); c.stroke(); } }
  c.strokeStyle = trend; c.lineWidth = 3; c.lineJoin = "round"; c.lineCap = "round"; c.beginPath(); curve(c, pts); c.stroke();
  c.restore();
  const surface = css("--surface");
  if (prog >= 1){ const lr = rows[rows.length-1]; c.fillStyle = trend; c.beginPath(); c.arc(X(lr.n), Y(toU(lr.trend)), 5.5, 0, 7); c.fill(); c.strokeStyle = surface; c.lineWidth = 2; c.stroke(); }
  if (sel){
    // guide line, then the inspected weigh-in and its trend point, each ringed
    const x = Math.round(X(sel.n)) + .5;
    c.strokeStyle = muted; c.globalAlpha = .5; c.lineWidth = 1; c.beginPath(); c.moveTo(x, T); c.lineTo(x, H - B); c.stroke(); c.globalAlpha = 1;
    c.fillStyle = css("--fg"); c.beginPath(); c.arc(X(sel.n), Y(toU(sel.kg)), 5.5, 0, 7); c.fill(); c.strokeStyle = surface; c.lineWidth = 2.5; c.stroke();
    c.fillStyle = trend; c.beginPath(); c.arc(X(sel.n), Y(toU(sel.trend)), 4.5, 0, 7); c.fill(); c.stroke();
  }
  c.restore();
  return { X, rows };
}
// Mounts the chart on a canvas: optional draw-in, then press and drag to inspect a day.
function mountChart(cv, tip, allRows, R, intro){
  if (!cv) return;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W*dpr; cv.height = H*dpr; const c = cv.getContext("2d");
  let prog = intro && !calm() ? 0 : 1, sel = null, g = null;
  const draw = () => { c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H); g = paintChart(c, W, H, allRows, R, prog, sel); };
  draw();
  if (prog < 1){
    const t0 = performance.now();
    const step = now => {
      if (!cv.isConnected || prog >= 1) return;
      const p = Math.min(1, (now - t0)/550); prog = 1 - Math.pow(1 - p, 3); draw();
      if (p < 1) requestAnimationFrame(step); else prog = 1;
    };
    requestAnimationFrame(step);
  }
  const show = ev => {
    const rect = cv.getBoundingClientRect(), px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    let best = g.rows[0], bd = 1e9; for (const r of g.rows){ const d = Math.abs(g.X(r.n) - px); if (d < bd){ bd = d; best = r; } }
    if (best === sel && prog >= 1) return;
    if (best !== sel) haptic("selection");
    sel = best; prog = 1; draw();
    tip.hidden = false; tip.style.left = Math.max(80, Math.min(W - 80, g.X(best.n))) + "px";
    tip.innerHTML = `${fmtDate(best.date)} · <b class="num">${fw(best.kg)}</b> <span style="color:var(--muted)">trend <span class="num">${fw(best.trend)}</span></span>`;
  };
  cv.onpointerdown = show; cv.onpointermove = ev => { if (ev.pointerType === "mouse" || ev.buttons) show(ev); };
  cv.onpointerup = cv.onpointerleave = cv.onpointercancel = () => { tip.hidden = true; if (sel){ sel = null; draw(); } };
}
let resizeT; window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => {
  if (tab === "progress" && $("#chart")){ const rows = computeTrend(); if (rows.length){ mountChart($("#chart"), $("#tip"), rows, S.settings.chartRange); paintMini($("#mini"), rows); } }
  placePill();
}, 120); });
