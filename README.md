# SwimTracker

Track a swimmer's times from the USA Swimming Data Hub in one place.

## How it works (so far)

1. **Pull, after each meet.** A bookmarklet (`bookmarklet/pull.js`) runs on the swimmer's page at
   `data.usaswimming.org/search/athlete/<memberId>` in your own browser. It uses the page's own
   device id and makes the same read-only requests the page makes, for that one swimmer only,
   with a pause between requests. It saves a `swimtracker-<memberId>-<date>.json` file.
2. **Import** (next): the dashboard reads those files: PRs, progression, time standards.

Data Hub endpoints used (`/api/times/swims`, undocumented; read from the site's own scripts):
`TimesSearch/GetMember/{id}`, `TimesSearch/GetBestTimesForMember/{id}`,
`TimesSearch/GetSwimmerMeets/{id}`, `TimesSearch/GetSwimmerMeetTimes/{id}/{meetId}`.

## Develop

- `node tools/build.js` builds the bookmarklet into `index.html` (install page).
- `node tools/test-bookmarklet.js` runs it on a mocked Data Hub page (Playwright; no real requests).
