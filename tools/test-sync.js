// Sync test against a mocked GitHub API (no real requests). Two browsers: "Dad" with a
// read/write token and "Grandma" with a read-only token, sharing one private repo.
// Usage: node tools/test-sync.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const S = require('../js/store.js');

const APP = 'https://gwallee.github.io/SwimTracker/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const repo = { empty: true, file: null, sha: 0, puts: 0, failNextPut: 0 };

function pullFor(meets) {   // synthetic swimmer, one swim per meet
  const p = { kind: 'swimtracker-pull', version: 2, pulledAt: '2026-0' + meets.length + '-01T00:00:00Z', memberId: 'X1',
    member: { memberId: 'X1', shortName: 'Test Swimmer', clubName: 'Club' }, bestTimes: [], meets: [], meetTimes: {}, errors: [] };
  meets.forEach((m, i) => {
    p.meets.push({ meetId: i + 1, meetName: 'Meet ' + (i + 1), minDate: m.date + 'T00:00:00', maxDate: m.date + 'T00:00:00', meetType: 'Open' });
    p.meetTimes[i + 1] = [{ swimTimeId: 100 + i, eventCode: '50 FR SCY', swimTime: m.time }];
  });
  return p;
}

async function route(r) {
  const req = r.request();
  const u = new URL(req.url());
  if (u.href.startsWith(APP)) {
    const f = path.join(__dirname, '..', decodeURIComponent(u.pathname.slice('/SwimTracker/'.length)) || 'index.html');
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  }
  if (u.hostname !== 'api.github.com') return r.abort();
  const token = (req.headers().authorization || '').replace('Bearer ', '');
  const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body),
    headers: { 'access-control-allow-origin': '*' } });
  if (!['rw', 'ro'].includes(token)) return json(401, { message: 'Bad credentials' });
  if (u.pathname === '/repos/gwallee/SwimTracker-data')
    return json(200, { full_name: 'gwallee/SwimTracker-data', private: true, permissions: { push: token === 'rw', pull: true } });
  if (u.pathname === '/repos/gwallee/SwimTracker-data/contents/store.json') {
    if (req.method() === 'GET') return repo.file ? json(200, { content: Buffer.from(repo.file).toString('base64'), sha: 's' + repo.sha }) : json(404, { message: 'Not Found' });
    if (req.method() === 'PUT') {
      if (token !== 'rw') return json(403, { message: 'Resource not accessible by personal access token' });
      const b = JSON.parse(req.postData());
      if (repo.empty && b.branch) return json(404, { message: 'Branch main not found' });
      if (repo.failNextPut) { repo.failNextPut--; repo.sha++; return json(409, { message: 'conflict' }); }
      if ((repo.file ? 's' + repo.sha : undefined) !== b.sha) return json(409, { message: 'sha mismatch' });
      repo.file = Buffer.from(b.content, 'base64').toString('utf8'); repo.sha++; repo.empty = false; repo.puts++;
      return json(repo.puts === 1 ? 201 : 200, { content: { sha: 's' + repo.sha } });
    }
  }
  return json(404, { message: 'Not Found' });
}

async function device(browser, store) {
  const ctx = await browser.newContext();
  await ctx.route('**/*', route);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  if (store) await page.addInitScript(s => { if (!localStorage.getItem('swimtracker.v1')) localStorage.setItem('swimtracker.v1', s); }, JSON.stringify(store));
  await page.goto(APP);
  page.errs = errs;
  return page;
}
async function connect(page, token) {
  await page.click('#syncBtn');
  await page.fill('#syToken', token);
  await page.click('#sySave');
  await page.waitForFunction(() => /Synced|View only|problem|not/i.test(document.getElementById('syncMsg').textContent.split('\n').pop()), null, { timeout: 10000 });
  const msg = await page.textContent('#syncMsg');
  await page.click('#syncDlg button[value=cancel]');
  return msg;
}
const swimsTile = page => page.$eval('.tiles', e => (e.innerText.match(/Swims\s+(\d+)/) || [])[1]);
const remoteSwims = () => repo.file ? Object.keys(JSON.parse(repo.file).swimmers.X1.swims).length : 0;

(async () => {
  const fail = [];
  const check = (ok, msg) => { if (!ok) fail.push(msg); };
  const browser = await chromium.launch();

  const dadStore = S.empty(); S.merge(dadStore, pullFor([{ date: '2025-09-01', time: '40.00' }, { date: '2025-10-01', time: '39.00' }]));
  const dad = await device(browser, dadStore);
  const m1 = await connect(dad, 'rw');
  check(/can add times/.test(m1), 'dad connects read/write: ' + m1);
  check(remoteSwims() === 2, 'first sync creates the file in the empty repo with 2 swims (got ' + remoteSwims() + ')');

  const grandma = await device(browser, null);
  const bad = await connect(grandma, 'nope');
  check(/not accepted/.test(bad), 'bad token explained: ' + bad);
  const m2 = await connect(grandma, 'ro');
  check(/view only/.test(m2), 'grandma connects view-only: ' + m2);
  check(await swimsTile(grandma) === '2', 'grandma sees 2 swims');

  // Dad adds a meet; a conflicting save is retried after merging.
  repo.failNextPut = 1;
  await dad.click('#importBtn');
  await dad.fill('#paste', JSON.stringify(pullFor([{ date: '2025-09-01', time: '40.00' }, { date: '2025-10-01', time: '39.00' }, { date: '2025-11-01', time: '38.50' }])));
  await dad.click('#doImport');
  await dad.waitForFunction(() => /^Synced/.test(document.getElementById('syncStatus').textContent), null, { timeout: 10000 });
  check(remoteSwims() === 3, 'new meet saved after a conflict retry (remote has ' + remoteSwims() + ')');
  await dad.click('#importDlg button[value=cancel]');

  await grandma.reload();
  await grandma.waitForFunction(() => /View only/.test(document.getElementById('syncStatus').textContent), null, { timeout: 10000 });
  check(await swimsTile(grandma) === '3', 'grandma sees the new meet after reopening');
  const putsBefore = repo.puts;
  await grandma.reload();
  await grandma.waitForFunction(() => /View only/.test(document.getElementById('syncStatus').textContent), null, { timeout: 10000 });
  check(repo.puts === putsBefore, 'view-only device never writes');

  await dad.click('#syncBtn'); await dad.click('#syOff'); await dad.click('#syncDlg button[value=cancel]');
  check(await dad.evaluate(() => !JSON.parse(localStorage.getItem('swimtracker.sync') || '{}').token), 'turn off removes the token');
  check(!dad.errs.length && !grandma.errs.length, 'page errors: ' + dad.errs.concat(grandma.errs).join('; '));
  await browser.close();

  if (fail.length) { console.error('FAIL\n' + fail.join('\n')); process.exit(1); }
  console.log('ok: read/write device saves (empty repo, conflict retry), view-only device loads and never writes');
})().catch(e => { console.error(e); process.exit(1); });
