"use strict";
/* ---------- the math ---------- */
// Exponentially smoothed trend that respects gaps between weigh-ins.
const counts = e => !e.ignored && !(e.outlier && !e.keep);
function computeTrend(){
  const a = S.settings.smooth; let t = null, prev = null;
  return S.entries.filter(counts).map(e => {
    const n = dnum(e.date);
    if (t === null) t = e.kg; else { const f = 1 - Math.pow(1 - a, Math.max(1, n - prev)); t += f * (e.kg - t); }
    prev = n; return { ...e, n, trend: t };
  });
}
function trendAt(rows, n){
  if (!rows.length || n < rows[0].n) return null;
  if (n >= rows[rows.length-1].n) return rows[rows.length-1].trend;
  for (let i = 1; i < rows.length; i++) if (rows[i].n >= n){ const A = rows[i-1], B = rows[i]; return A.trend + (n - A.n)/((B.n - A.n) || 1)*(B.trend - A.trend); }
  return null;
}
// least-squares slope (kg/day) of the trend over the last `days` days
function slope(rows, days){
  if (rows.length < 2) return null;
  const end = rows[rows.length-1].n;
  const pts = rows.filter(r => r.n >= end - days);
  if (pts.length < 2 || pts[pts.length-1].n - pts[0].n < 6) return null;
  const mx = pts.reduce((s,p) => s + p.n, 0)/pts.length, my = pts.reduce((s,p) => s + p.trend, 0)/pts.length;
  let num = 0, den = 0; for (const p of pts){ num += (p.n-mx)*(p.trend-my); den += (p.n-mx)**2; }
  return den ? num/den : null;
}
// Change in trend over the last `days`, or null when a long gap makes the comparison meaningless.
function changeOver(rows, days){
  const last = rows[rows.length-1], target = last.n - days;
  if (rows[0].n > target) return null;
  let i0 = 0; for (let i = 0; i < rows.length; i++) if (rows[i].n <= target) i0 = i;
  for (let i = i0 + 1; i < rows.length; i++) if (rows[i].n - rows[i-1].n > 21) return null;
  const b = trendAt(rows, target); return b == null ? null : last.trend - b;
}
// Flags a weigh-in that is far from the trend (someone else on the scale, clothes, a big meal) until you confirm it.
function detectOutliers(){
  const a = S.settings.smooth; let t = null, prev = null, changed = false;
  for (const e of S.entries){
    if (e.ignored) continue;
    const n = dnum(e.date);
    if (t !== null && !e.keep && !e.reviewed){
      const lim = Math.max(2, t*0.025), recent = n - prev <= 7;
      const out = recent && Math.abs(e.kg - t) > lim;
      if (!!e.outlier !== out){ e.outlier = out; changed = true; }
      if (!out && dnum(todayStr()) - n > 3 && !e.reviewed){ e.reviewed = true; changed = true; }
    }
    if (e.outlier && !e.keep) continue;
    if (t === null) t = e.kg; else { const f = 1 - Math.pow(1 - a, Math.max(1, n - prev)); t += f*(e.kg - t); }
    prev = n;
  }
  return changed;
}
function startWeight(){ return S.settings.start ?? (S.entries[0] ? S.entries[0].kg : null); }
function goalDir(){ const g = S.settings.goal, st = startWeight(); if (g == null || st == null) return -1; return g < st ? -1 : 1; }
function tone(delta){ if (delta == null || Math.abs(delta) < 0.05) return "flat"; return Math.sign(delta) === goalDir() ? "good" : "bad"; }
const arrow = d => d == null || Math.abs(d) < 0.05 ? "→" : d > 0 ? "↑" : "↓";
function milestones(){
  const g = S.settings.goal, st = startWeight(); if (g == null || st == null) return [];
  const step = S.settings.step ?? (U() === "lb" ? 5/LB : 2); const dir = Math.sign(g - st) || -1; const out = [];
  for (let w = st + dir*step; (dir < 0 ? w > g + 0.01 : w < g - 0.01) && out.length < 200; w += dir*step) out.push(Math.round(w*1000)/1000);
  out.push(g); return out;
}
const goalReached = t => { const g = S.settings.goal; return g != null && (Math.abs(t - g) < 0.05 || (goalDir() < 0 ? t <= g : t >= g)); };
// Day the trend reaches the goal at `perDay`, or null when it isn't heading there.
function etaFor(perDay, left, lastN){
  if (!perDay || Math.sign(perDay) !== -Math.sign(left) || Math.abs(perDay) < 0.0005) return null;
  const d = Math.round(Math.abs(left/perDay));
  return d > 3650 ? { far:true } : { date: fromDnum(lastN + d), days: d };
}
const inTime = d => d < 60 ? `In ${d} day${d === 1 ? "" : "s"}` : d < 730 ? `In about ${Math.round(d/7)} weeks` : `In about ${Math.round(d/30.4)} months`;
