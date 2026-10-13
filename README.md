# Trendline Scale

A personal iOS weight tracker inspired by Happy Scale. It smooths daily weigh-ins into a trend line so water-weight swings don't hide real progress.

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
- Fully offline

## Get the app
Every push to `main` builds an unsigned `TrendlineScale.ipa` with GitHub Actions and attaches it to a new release under **Releases**.
Install it with a signing tool such as Sideloadly or AltStore. Free Apple IDs need re-signing every 7 days.

## Project layout
- `ios/www/index.html` — the app's interface and logic
- `ios/Sources/` — the native Swift shell (storage and share sheet)
- `ios/project.yml` — XcodeGen project spec
