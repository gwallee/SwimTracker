# SwimTracker

Track a swimmer's times from the USA Swimming Data Hub (and summer-league pages such as
SwimTopia) in one place: best times, how each event has changed over time, and every meet.

## Use

1. **Install the buttons once** from `install.html`:
   - **SwimTracker pull**: on the swimmer's page at `data.usaswimming.org/search/athlete/<memberId>`
     (signed in with a free USA Swimming account). It runs in your own browser, uses the page's own
     device id and makes the same read-only requests the page makes, for that one swimmer, with a
     pause between requests. Then it adds them to SwimTracker (below).
   - **SwimTracker capture**: on any page that shows times in a table (SwimTopia athlete or meet
     results). It reads the tables already on screen (no requests of its own) and adds them the same way.
2. **After each meet**, tap the button. When it finishes it opens the dashboard as
   `<site>#add=<data>` (deflate + base64url) and the dashboard adds the swims, lists new best times
   and clears the link. The part after `#` is never sent to a server. If the pull had problems the
   button shows a panel with **Add to SwimTracker** / **Save file** (then **Import**).
   Importing again is safe: swims already stored are skipped. The site URL is built into the
   buttons (`tools/build.js`, `SWIMTRACKER_URL` to override).
3. **Dashboard** (`index.html`):
   - Tiles: meets, swims, best times at the last meet, biggest drop.
   - *Times over time*: **By event** (one event, faster = higher) or **By stroke** (pace per 25 so the
     25, 50 and 100 of a stroke share one chart, one marker shape per distance).
   - Best-times table (tap a row to chart it) and every meet with PB / NEW markers.

Data lives in the browser (localStorage). **Export** saves it all as one file; importing that file
on another device restores it. If `data/store.json` exists next to the page (an Export file), the
page loads it when the browser has nothing saved, which is how a shared copy could be published.
This repository is public, so don't commit swimmer data unless you mean to publish it.

Data Hub endpoints used (`/api/times/swims`, undocumented; read from the site's own scripts):
`TimesSearch/GetMember/{id}`, `TimesSearch/GetBestTimesForMember/{id}`,
`TimesSearch/GetSwimmerMeets/{id}`, `TimesSearch/GetSwimmerMeetTimes/{id}/{meetId}`.

## Sync (optional)

**Sync** in the dashboard keeps the data in `store.json` in a **private** GitHub repo
(default `gwallee/SwimTracker-data`) through the GitHub API, with a fine-grained token entered on
each device and kept only in that browser (`js/sync.js`).

- Read/write token (Contents: Read and write, that one repo): the device loads the synced copy on
  open and when the tab comes back, and saves whenever new swims arrive. Saves merge first, so two
  devices adding meets never lose each other's swims (a save that races another is merged and retried).
- Read-only token (Contents: Read-only): view only, for family. It never writes.
- Tokens expire (at most a year); make a new one and enter it again under Sync.

## Develop

Zero dependencies: plain HTML/CSS/JS (`index.html`, `css/app.css`, `js/store.js`, `js/sync.js`, `js/app.js`).

- `node tools/build.js` builds the bookmarklets (`bookmarklet/*.js`) into `install.html`.
- `node tools/test-store.js` checks merge, best times, drops and capture parsing (synthetic data).
- `node tools/test-sync.js` runs two devices (read/write and read-only) against a mocked GitHub API.
- `node tools/test-bookmarklet.js` runs both buttons on mocked pages and follows them into the dashboard (Playwright; no real requests).
- The capture importer recognizes tables by their header row (Event + Time required; Date, Meet,
  Place, Name optional). Its SwimTopia handling is a stand-in until a real capture is checked.
