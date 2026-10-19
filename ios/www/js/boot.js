"use strict";
/* ---------- boot ---------- */
load(); applyTheme(); if (detectOutliers()) save();
syncTabbar(); render();
if (NATIVE){ syncHealth(false); scheduleReminder(); setTimeout(() => checkUpdate(false), 1500); }
checkCelebrate(S.settings.celebrated == null);
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { applyTheme(); render(); });
