# Trendline Scale

A personal weight tracker inspired by Happy Scale. It smooths daily weigh-ins into a trend line so water-weight swings don't hide real progress.

**Open it:** https://husain-313.github.io/Weight-tracker/

## Features
- Smoothed trend weight (exponential moving average that respects gaps between weigh-ins)
- Weekly rate, 7 / 30 / 90-day and all-time change
- Chart with weigh-ins, trend line and goal line (tap to inspect a day)
- Goal progress, milestones and predicted finish date
- Weekly and monthly reports
- Logbook grouped by month, with notes
- BMI from your height
- kg or lb, light / dark theme
- Backup and restore (.json), CSV export, CSV import (works with Happy Scale exports)
- Works offline and installs to the home screen

## Install on iPhone
Open the link in **Safari** → Share → **Add to Home Screen**.

Data is stored on the device only. Export a backup from Settings now and then.

## iOS app (IPA)
Every push to `main` builds an unsigned `TrendlineScale.ipa` with GitHub Actions and attaches it to a new release under **Releases**.
Install it with a signing tool such as Sideloadly or AltStore using your Apple ID. Free Apple IDs need re-signing every 7 days.
The iOS app stores data in a file inside the app, and backups open the iOS share sheet.
