# Trendline

Personal iOS weight tracker, installed by re-signing the IPA with Signulous (not App Store).
See README.md for features and project layout.

## Workflow rules

- After finishing any change, commit and push automatically without asking.
- Once the GitHub Actions build passes, publish it as a release so the in-app updater finds it.
- Ask first only before deleting user data or making changes that cannot be undone
  (for example force-pushing, deleting branches, tags or releases, or a data migration that drops fields).

## Builds and releases

- `.github/workflows/ios.yml` builds an unsigned IPA on pushes to the branches it lists.
  Pushes to `main` publish a release automatically; other branches only upload the `TrendlineScale-ipa` artifact.
- To release a branch build: `gh run download <run-id> -n TrendlineScale-ipa`, then
  `gh release create build-<run number> TrendlineScale.ipa --target <commit sha> --title "Trendline <version> (build <run number>)" --notes-file <notes> --latest`.
  Use the same notes format as the workflow's "Write release notes" step.
- The updater compares build numbers (`build-N` tag vs. the app's build), so the tag must be the run number.
- When merging a branch that was already released into `main`, put `[skip ci]` in the merge commit message
  so `main` doesn't publish a duplicate release.
- Bump `MARKETING_VERSION` in `ios/project.yml` and the version in the workflow's release notes and release name together.

## Data

- Saved state has a `schema` version (`SCHEMA` in `ios/www/index.html`). When its shape changes,
  bump `SCHEMA` and add a `MIGRATIONS[old]` step; backups from a newer schema are refused on restore.
- Git commits use the identity `Claude <noreply@anthropic.com>` (no global git identity is set on this machine).
