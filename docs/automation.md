# Weekly Report Automation (Drive + Apps Script + Vercel)

## 1) Apps Script (weekly aggregation)

1. Create a Google Apps Script project.
2. Enable the Advanced Drive Service (Apps Script editor: Services -> Drive API).
3. Paste the script from `scripts/apps-script/weekly-report.gs`.
4. Update the config:
   - `CONFIG.folderId`: Drive folder ID for `내 드라이브/보건소 환자보고`
   - `CONFIG.reportSpreadsheetId`: Google Sheet ID where weekly rows will be saved
   - `CONFIG.reportSheetName`: default is `weekly_reports`
5. Add a time trigger:
   - Function: `runWeeklyReport`
   - Schedule: weekly, Tuesday 01:00 (Asia/Seoul)

The script converts each Excel file to a temporary Sheet, reads D column ages,
aggregates Mon-Sat of the previous week, and writes one row per week.

### Required file names
- `YYYY-MM-DD_총환자수.xlsx`
- `YYYY-MM-DD_발열환자수.xlsx`

## 2) Google Sheet schema

The script writes these headers to `weekly_reports`:

- `week_start`
- `week_end`
- `total_visit`
- `total_fever`
- `overall_ratio`
- `groups_json`
- `missing_days`
- `created_at`

`groups_json` stores the age-group breakdown used by the app.

## 3) Vercel API (private Sheets access)

Create a Google service account with access to the report Sheet and set the
following environment variables on Vercel:

- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY` (use literal `\n` for line breaks)
- `GOOGLE_SHEETS_ID`
- `GOOGLE_SHEETS_TAB` (optional, default: `weekly_reports`)

Share the report Sheet with the service account email (read access is enough).

## 4) Frontend configuration

By default the app reads `/api/reports` on the same host.
For local development, you can set an explicit endpoint:

- `VITE_REPORTS_ENDPOINT=https://<your-deployed-host>/api/reports`

