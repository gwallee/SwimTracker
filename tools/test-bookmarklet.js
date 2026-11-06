// Offline test: runs the built bookmarklet on a fake Data Hub page. Every request is
// answered by mocks below; nothing reaches the real site.
// Usage: node tools/test-bookmarklet.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const html = fs.readFileSync(path.join(__dirname, '..', 'install.html'), 'utf8');
const href = html.match(/<a id="bm" href="([^"]*)"/)[1]
  .replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const code = decodeURIComponent(href.slice('javascript:'.length));
const html2 = html.match(/<a id="bm2" href="([^"]*)"/)[1].replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const capCode = decodeURIComponent(html2.slice('javascript:'.length));
const APP = 'https://gwallee.github.io/SwimTracker/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
let failMeet = true;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const seen = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.href.startsWith(APP)) {        // serve the dashboard from this checkout
      const rel = decodeURIComponent(u.pathname.slice('/SwimTracker/'.length)) || 'index.html';
      const f = path.join(__dirname, '..', rel);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    if (u.hostname === 'swim.example') return route.fulfill({ status: 200, contentType: 'text/html', body:
      '<!doctype html><h1>Tidal Waves vs Sharks 6/14/2026</h1><table><tr><th>Event</th><th>Name</th><th>Time</th></tr>' +
      '<tr><td>Boys 9-10 25 Yard Freestyle</td><td>Swimmer, Test</td><td>18.50</td></tr></table>' });
    if (u.hostname !== 'data.usaswimming.org') return route.abort();
    seen.push({ path: u.pathname, headers: route.request().headers() });
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/GetMember/M123')) return json({ firstName: 'Test', lastName: 'Swimmer', shortName: 'Test Swimmer' });
    if (u.pathname.endsWith('/GetBestTimesForMember/M123')) return json([{ event: '50 FR SCY', time: '30.12' }]);
    if (u.pathname.endsWith('/GetSwimmerTimeStandards/M123')) return json([{ standard: 'B' }]);
    if (u.pathname.endsWith('/GetSwimmerMeets/M123')) return json([{ meetId: 11, meetName: 'A', minDate: '2025-09-01T00:00:00', maxDate: '2025-09-01T00:00:00' }, { meetId: 22, meetName: 'B', minDate: '2025-10-01T00:00:00', maxDate: '2025-10-01T00:00:00' }]);
    if (u.pathname.endsWith('/GetSwimmerMeetTimes/M123/11')) return json([{ swimTimeId: 1, eventCode: '50 FR SCY', swimTime: '30.12' }]);
    if (u.pathname.endsWith('/GetSwimmerMeetTimes/M123/22')) return failMeet ? route.fulfill({ status: 500, body: 'boom' }) : json([{ swimTimeId: 2, eventCode: '50 FR SCY', swimTime: '29.50' }]);
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body>athlete page</body>' });
  });
  await page.goto('https://data.usaswimming.org/search/athlete/M123/meets');
  await page.evaluate(() => localStorage.setItem('deviceId', 'DEV-1'));
  await page.evaluate(code);
  await page.waitForFunction(() => /Done/.test(document.querySelector('#st-status')?.textContent || ''), null, { timeout: 10000 });
  const out = JSON.parse(await page.$eval('textarea', t => t.value));
  const status = await page.$eval('#st-status', e => e.textContent);

  // Clean pull: the button goes straight to SwimTracker, which adds the swims.
  failMeet = false;
  await page.evaluate(code);
  await page.waitForURL(u => u.href.startsWith(APP), { timeout: 10000 });
  await page.waitForFunction(() => /Added from the button/.test(document.getElementById('importMsg')?.textContent || ''), null, { timeout: 10000 });
  const added = await page.textContent('#importMsg');
  const hashGone = !(await page.evaluate(() => location.hash));
  const swims = await page.$eval('.tiles', e => e.innerText);
  // Capture on a results page adds its rows to the same swimmer.
  await page.goto('https://swim.example/results');
  await page.evaluate(capCode);
  await page.waitForURL(u => u.href.startsWith(APP), { timeout: 10000 });
  await page.waitForFunction(() => /Capture from/.test(document.getElementById('importMsg')?.textContent || ''), null, { timeout: 10000 });
  const capMsg = await page.textContent('#importMsg');
  const events = await page.$$eval('.chips button', b => b.map(x => x.textContent));
  await browser.close();

  const api = seen.filter(s => s.path.startsWith('/api/'));
  const fail = [];
  const check = (ok, msg) => { if (!ok) fail.push(msg); };
  check(out.memberId === 'M123', 'memberId');
  check(out.member && out.member.firstName === 'Test', 'member');
  check(Array.isArray(out.bestTimes) && out.bestTimes.length === 1, 'bestTimes');
  check(out.meetTimes['11'] && out.meetTimes['11'][0].swimTime === '30.12', 'meet 11 times');
  check(out.meetTimes['22'] === null, 'meet 22 failure recorded as null');
  check(out.errors.length === 1 && /meet 2 of 2: 500/.test(out.errors[0]), 'error list: ' + JSON.stringify(out.errors));
  check(Array.isArray(out.timeStandards), 'timeStandards');
  check(api.length >= 6, 'request count ' + api.length);
  check(api.every(s => s.headers['device-id'] === 'DEV-1' && s.headers['x-csrf'] === '1'), 'headers use the page device id');
  check(/Done with 1 problem/.test(status), 'status: ' + status);
  check(/Test Swimmer: 2 new swims/.test(added), 'added from link: ' + added);
  check(hashGone, 'data removed from the address bar');
  check(/Swims\s+2/.test(swims), 'dashboard shows 2 swims: ' + swims);
  check(/1 swim\(s\) read, 1 new/.test(capMsg), 'capture added: ' + capMsg);
  check(events.some(e => /^25 Free/.test(e)), 'captured 25 Free on the dashboard: ' + events);
  if (fail.length) { console.error('FAIL\n' + fail.join('\n')); process.exit(1); }
  console.log('ok: pull reports failures; a clean pull and a capture go straight into the dashboard');
})().catch(e => { console.error(e); process.exit(1); });
