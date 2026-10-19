"use strict";
/* ---------- celebrations ---------- */
function reachedMilestones(){
  const rows = computeTrend(); if (!rows.length) return [];
  const t = rows[rows.length-1].trend, dir = goalDir();
  return milestones().filter(m => dir < 0 ? t <= m + 0.001 : t >= m - 0.001);
}
function checkCelebrate(silent){
  if (S.settings.goal == null || !S.entries.length) return;
  const reached = reachedMilestones();
  const done = new Set((S.settings.celebrated || []).map(x => Number(x).toFixed(2)));
  const fresh = reached.filter(m => !done.has(m.toFixed(2)));
  if (S.settings.celebrated == null) silent = true;
  if (!fresh.length){ if (S.settings.celebrated == null){ S.settings.celebrated = []; save(); } return; }
  S.settings.celebrated = [...(S.settings.celebrated || []), ...fresh]; save();
  if (silent) return;
  const best = fresh[fresh.length-1], isGoal = Math.abs(best - S.settings.goal) < 0.01;
  showCelebration(isGoal, best);
}
function resetCelebrations(){ S.settings.celebrated = null; checkCelebrate(true); }
function showCelebration(isGoal, value){
  haptic("success");
  const el = document.createElement("div"); el.className = "celebrate";
  const dir = goalDir() < 0 ? "below" : "above";
  el.innerHTML = `<canvas></canvas><div class="cel-card" role="dialog" aria-modal="true">
    <div class="cel-ring">${isGoal ? ICON.flag : ICON.check}</div>
    <h2>${isGoal ? "Goal reached" : "Milestone reached"}</h2>
    <div class="num">${fw(value)} <span style="font-size:1.1765rem;color:var(--muted)">${U()}</span></div>
    <p>${isGoal ? "Your trend weight reached your goal. Set the next one whenever you're ready." : `Your trend weight is now ${dir} ${fw(value)} ${U()}.`}</p>
    <button class="btn primary" id="celOk">${isGoal ? "Done" : "Keep going"}</button></div>`;
  document.body.appendChild(el);
  const close = () => { el.remove(); };
  el.querySelector("#celOk").onclick = close;
  el.addEventListener("click", ev => { if (ev.target === el) close(); });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // a light shower of paper in the app's own colours
  const cv = el.querySelector("canvas"), dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  cv.width = W*dpr; cv.height = H*dpr; const c = cv.getContext("2d"); c.scale(dpr, dpr);
  const cols = [css("--trend"), css("--goal"), css("--surface"), css("--dot")];
  const ps = Array.from({length: 70}, () => ({ x: W/2 + (Math.random()-.5)*80, y: H*0.38, vx: (Math.random()-.5)*9, vy: -Math.random()*11 - 4, s: 5 + Math.random()*5, r: Math.random()*6, vr: (Math.random()-.5)*0.25, c: cols[(Math.random()*cols.length)|0] }));
  let frames = 0;
  (function tick(){
    if (!el.isConnected || frames++ > 200) return;
    c.clearRect(0, 0, W, H);
    for (const p of ps){ p.vy += 0.3; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = p.c; c.globalAlpha = Math.max(0, 1 - frames/200); c.fillRect(-p.s/2, -p.s/4, p.s, p.s/2); c.restore(); }
    requestAnimationFrame(tick);
  })();
}
