// Offline test: runs the built bookmarklet on a fake Data Hub page. Every request is
// answered by mocks below; nothing reaches the real site.
// Usage: node tools/test-bookmarklet.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const href = html.match(/<a id="bm" href="([^"]*)"/)[1]
  .replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const code = decodeURIComponent(href.slice('javascript:'.length));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const seen = [];
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.hostname !== 'data.usaswimming.org') return route.abort();
    seen.push({ path: u.pathname, headers: route.request().headers() });
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname.endsWith('/GetMember/M123')) return json({ firstName: 'Test', lastName: 'Swimmer' });
    if (u.pathname.endsWith('/GetBestTimesForMember/M123')) return json([{ event: '50 FR SCY', time: '30.12' }]);
    if (u.pathname.endsWith('/GetSwimmerMeets/M123')) return json([{ meetId: 11, meetName: 'A' }, { meetId: 22, meetName: 'B' }]);
    if (u.pathname.endsWith('/GetSwimmerMeetTimes/M123/11')) return json([{ time: '30.12' }]);
    if (u.pathname.endsWith('/GetSwimmerMeetTimes/M123/22')) return route.fulfill({ status: 500, body: 'boom' });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body>athlete page</body>' });
  });
  await page.goto('https://data.usaswimming.org/search/athlete/M123/meets');
  await page.evaluate(() => localStorage.setItem('deviceId', 'DEV-1'));
  await page.evaluate(code);
  await page.waitForFunction(() => /Done/.test(document.querySelector('#st-status')?.textContent || ''), null, { timeout: 10000 });
  const out = JSON.parse(await page.$eval('textarea', t => t.value));
  const status = await page.$eval('#st-status', e => e.textContent);
  await browser.close();

  const api = seen.filter(s => s.path.startsWith('/api/'));
  const fail = [];
  const check = (ok, msg) => { if (!ok) fail.push(msg); };
  check(out.memberId === 'M123', 'memberId');
  check(out.member && out.member.firstName === 'Test', 'member');
  check(Array.isArray(out.bestTimes) && out.bestTimes.length === 1, 'bestTimes');
  check(out.meetTimes['11'] && out.meetTimes['11'][0].time === '30.12', 'meet 11 times');
  check(out.meetTimes['22'] === null, 'meet 22 failure recorded as null');
  check(out.errors.length === 1 && /meet 2 of 2: 500/.test(out.errors[0]), 'error list: ' + JSON.stringify(out.errors));
  check(api.length === 5, 'request count ' + api.length);
  check(api.every(s => s.headers['device-id'] === 'DEV-1' && s.headers['x-csrf'] === '1'), 'headers use the page device id');
  check(/Done with 1 problem/.test(status), 'status: ' + status);
  if (fail.length) { console.error('FAIL\n' + fail.join('\n')); process.exit(1); }
  console.log('ok: bookmarklet pulled member, best times, 2 meets (1 failure reported), ' + api.length + ' API requests');
})().catch(e => { console.error(e); process.exit(1); });
