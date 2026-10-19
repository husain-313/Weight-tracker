"use strict";
/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const view = $("#view");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const ICON = {
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
  pencil:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  flag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  heart:'<svg viewBox="0 0 24 24" fill="currentColor" aria-label="Apple Health"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/></svg>',
  scale:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 9.5a5 5 0 0 1 8 0M12 9.5l1.5-2"/></svg>',
  chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  bksp:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 5H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8.5L3 12z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/></svg>',
  arrow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>'
};
const CHEV = ICON.chev, BKSP = ICON.bksp;
// Down, up or sideways arrow for a change in weight.
const arrowIcon = d => ICON.arrow.replace("<svg ", `<svg style="transform:rotate(${d == null || Math.abs(d) < 0.05 ? -90 : d > 0 ? 180 : 0}deg)" `);
// Line icons for settings rows.
const sv = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const SET_ICON = {
  goal: ICON.flag,
  start: sv('<circle cx="7" cy="12" r="2.5"/><path d="M10 12h9M15 8l4 4-4 4"/>'),
  steps: sv('<path d="M4 19h5v-5h5V9h6"/>'),
  calendar: sv('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  scale: ICON.scale,
  wave: sv('<path d="M3 14c3-6 6-6 9 0s6 6 9 0"/>'),
  heart: ICON.heart.replace(' aria-label="Apple Health"', ""),
  save: sv('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
  bell: sv('<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  refresh: sv('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
  clock: sv('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
  folder: sv('<path d="M3.5 7a2 2 0 0 1 2-2H10l2 2h6.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  moon: sv('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  lock: sv('<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  info: sv('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
  tag: sv('<path d="M4 12V5a1 1 0 0 1 1-1h7l8 8-8 8z"/><circle cx="8.5" cy="8.5" r="1.3"/>')
};
const ico = name => `<span class="ic">${SET_ICON[name]}</span>`;

/* ---------- theme ---------- */
function applyTheme(){
  const root = document.documentElement, t = S.settings.theme;
  if (t === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
  nativeCmd("theme", { mode: t });
}

/* ---------- sheets ---------- */
function openSheet(inner){
  document.querySelectorAll(".scrim").forEach(s => s.remove());
  const el = document.createElement("div"); el.className = "scrim";
  el.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${inner}</div>`;
  document.body.appendChild(el);
  const sh = el.querySelector(".sheet");
  el.addEventListener("click", ev => { if (ev.target === el) closeSheet(); });
  sh.querySelectorAll("[data-x]").forEach(b => b.onclick = closeSheet);
  let y0 = null, dy = 0;
  sh.addEventListener("touchstart", ev => { if (sh.scrollTop > 0 || (ev.target.closest("input,select,textarea,button") && !ev.target.closest(".grab"))){ y0 = null; return; } y0 = ev.touches[0].clientY; dy = 0; sh.style.transition = "none"; }, { passive:true });
  sh.addEventListener("touchmove", ev => { if (y0 == null) return; dy = Math.max(0, ev.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; }, { passive:true });
  sh.addEventListener("touchend", () => { if (y0 == null) return; y0 = null; sh.style.transition = ""; if (dy > 110) closeSheet(); else sh.style.transform = ""; });
  return sh;
}
function closeSheet(){
  const s = document.querySelector(".scrim:not(.closing)"); if (!s) return;
  s.classList.add("closing"); s.querySelector(".sheet").style.transform = "translateY(100%)";
  if (document.activeElement) document.activeElement.blur();
  setTimeout(() => s.remove(), 240);
}

/* ---------- toast ---------- */
let toastT;
function toast(msg, action){
  let t = $(".toast"); if (!t){ t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ""}`; t.hidden = false;
  if (action) t.querySelector("button").onclick = () => { t.hidden = true; action.fn(); };
  clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, action ? 4500 : 2600);
}
