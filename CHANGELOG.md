# Changelog

## 0.1.1 (2026-10-22)

- `installedInYear` reads `date_installed` as the Montana calendar date it
  is: the API encodes that date at 00:00 UTC, so its UTC date parts are the
  Montana date. 0.1.0 converted the instant to Montana time, which moved a
  1 January install into the year before. No station today is affected.
  This departs from the maintenance app, which reads the instant in the
  viewer's timezone. Summary output is unchanged.

## 0.1.0 (2026-10-22)

First port. Reporting and health from mesonet-status e479aac; maintenance
compliance from mesonet-maintenance 6fa1689. Summary schema 1.

Before first publication (D15):

- The summary has no maintenance section. The maintenance rules stay
  exported; the job no longer reads the maintenance feed.
- Percentages are floored, so 100 means every station. Counts unchanged.
- The job runs as a Lambda on EventBridge Scheduler (`terraform/`), not a
  GitHub Actions cron. `src/job.js` holds the fetch, check and serialize steps
  shared by the CLI and `lambda/handler.js`.
- `feedComplianceCounts` and every read of the feed's `compliance_state` are
  removed (D4 resolved; the field leaves the API in mesonet-db-rds #222).
  The app's rules are the definition of compliance.
- MIT licence.
