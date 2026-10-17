# Trendline

A personal iOS weight tracker. It smooths daily weigh-ins into a trend line so water-weight swings don't hide real progress.

## Features
- **Trend weight** with this week's change, smoothed so water-weight swings don't hide real progress
- **Weight chart** (1M, 3M, 6M, 1Y, All) with tap-to-inspect, milestone lines and the goal line
- **Fast weigh-ins:** starts at your last weight; tap +/−, drag the number sideways or type it
- **Goal and milestones** on a progress bar, with a celebration when you pass each one
- **Prediction:** the day your trend reaches your goal at your current pace, plus your weekly commitment
- **History** grouped by month: each weigh-in against the trend, tap to edit, swipe to delete with undo
- **Apple Health:** imports weigh-ins from a smart scale in the background, notifies you with weight and trend, and can save your entries back to Health
- **Daily reminder**, skipped on days you've already weighed in
- **Face ID lock** and light/dark themes
- **Backups:** automatic copies in Files › On My iPhone › Trendline › Backups, an optional backup folder in iCloud Drive that survives a revoked signing certificate, manual backup/restore and CSV export

## Get the app
Every push to `main` builds an unsigned `TrendlineScale.ipa` with GitHub Actions and attaches it to a new release under **Releases**.
Install it with a signing service such as Signulous, keeping the same bundle ID so your data carries over.

## Project layout
- `ios/www/index.html` — the app's interface and logic
- `ios/Sources/TrendlineApp.swift` — native shell: storage, backups, Apple Health, background sync, notifications, Face ID, haptics, sharing, update check
- `ios/project.yml` — XcodeGen project spec
- `.github/workflows/ios.yml` — builds the IPA and publishes a release
