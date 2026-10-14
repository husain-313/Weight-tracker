# Trendline

A personal iOS weight tracker. It smooths daily weigh-ins into a trend line so water-weight swings don't hide real progress.

## Features
- **Trend weight** with weekly rate and 7 / 30 / 90-day and all-time change
- **Weight chart** (7D, 30D, 90D, 1Y, All) with full-screen view and tap-to-inspect
- **Predictions:** finish dates from your weekly commitment, your current rate and your overall rate
- **Goal progress** with milestones and a celebration when you pass each one
- **Body composition:** body fat % and lean mass from Apple Health
- **Reports** by week or month, shareable as images
- **Logbook** grouped by month: swipe to delete with undo, choose columns
- **Apple Health:** imports weigh-ins from a smart scale in the background, notifies you with weight and trend, and can save your entries back to Health
- **Daily reminder**, skipped on days you've already weighed in
- **Face ID lock**, haptics, light/dark themes and accent colours
- **Optional AI food log:** write meals in Gulf Arabic or English. Gemini understands and translates, Groq checks the list, values come from a built-in table and USDA, and the app does the maths. Claude is an optional upgrade and Apple Intelligence works offline. Barcode scanning uses Open Food Facts. API keys stay in the iPhone Keychain.
- **Apple Watch:** Activity (steps, active energy, workouts), Fitness (resting heart rate, VO₂ max) and Energy balance (deficit from your trend, burn from the watch, estimated and logged intake)
- Rearrangeable Summary cards
- Automatic backups in Files › On My iPhone › Trendline › Backups, plus manual backup/restore and CSV export

## Get the app
Every push to `main` builds an unsigned `TrendlineScale.ipa` with GitHub Actions and attaches it to a new release under **Releases**.
Install it with a signing tool such as Sideloadly or AltStore. Free Apple IDs need re-signing every 7 days.

## Project layout
- `ios/www/index.html` — the app's interface and logic
- `ios/Sources/TrendlineApp.swift` — native shell: storage, backups, Apple Health, background sync, notifications, Face ID, haptics, sharing
- `ios/project.yml` — XcodeGen project spec
- `.github/workflows/ios.yml` — builds the IPA and publishes a release
