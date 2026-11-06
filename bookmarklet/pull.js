// SwimTracker pull — runs as a bookmarklet on a USA Swimming Data Hub athlete page
// (https://data.usaswimming.org/search/athlete/<memberId>/...). It runs in your own
// browser, uses the page's own device id and makes the same read-only requests the
// page makes, for this one swimmer only. Result: a JSON file you import into SwimTracker.
(async () => {
  const VERSION = 1;
  const BASE = '/api/times/swims';
  // Stay gentle: one swimmer, a handful of meets.
  const MAX_MEETS = 60;
  const DELAY_MS = 300;

  const m = location.pathname.match(/\/search\/athlete\/([^/?#]+)/);
  if (location.hostname !== 'data.usaswimming.org' || !m) {
    alert('SwimTracker: sign in to data.usaswimming.org (free USA Swimming account), open the swimmer\'s page\n(Search → athlete → his name), then tap this bookmark again.');
    return;
  }
  const memberId = decodeURIComponent(m[1]);
  const deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    alert('SwimTracker: the page has not finished loading. Wait a moment and tap again.');
    return;
  }

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:12px;z-index:2147483647;background:#fff;color:#111;' +
    'font:14px system-ui,sans-serif;border:2px solid #0b5ea8;border-radius:10px;padding:14px;' +
    'display:flex;flex-direction:column;gap:10px;box-shadow:0 8px 30px rgba(0,0,0,.35)';
  box.innerHTML = '<b style="font-size:16px">SwimTracker pull</b><div id="st-status">Starting…</div>';
  document.body.appendChild(box);
  const status = t => { box.querySelector('#st-status').textContent = t; };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const get = async path => {
    const res = await fetch(BASE + path, { headers: { 'Device-Id': deviceId, 'X-CSRF': '1' }, credentials: 'include' });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText + ' on ' + path);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  };
  const errors = [];
  const tryGet = async (label, path) => {
    status('Reading ' + label + '…');
    try { return await get(path); } catch (e) { errors.push(label + ': ' + e.message); return null; }
  };

  const out = { kind: 'swimtracker-pull', version: VERSION, source: 'data.usaswimming.org',
    pulledAt: new Date().toISOString(), memberId, pageUrl: location.href };
  out.member = await tryGet('swimmer', '/TimesSearch/GetMember/' + encodeURIComponent(memberId));
  out.bestTimes = await tryGet('best times', '/TimesSearch/GetBestTimesForMember/' + encodeURIComponent(memberId));
  out.meets = await tryGet('meets', '/TimesSearch/GetSwimmerMeets/' + encodeURIComponent(memberId));

  // Meet list shape is not confirmed yet: find each item's meet id by key name.
  const list = Array.isArray(out.meets) ? out.meets
    : (out.meets && typeof out.meets === 'object' && Object.values(out.meets).find(Array.isArray)) || [];
  const meetIdOf = it => {
    if (!it || typeof it !== 'object') return null;
    const k = Object.keys(it).find(k => /^meet_?id$/i.test(k)) || Object.keys(it).find(k => /meet.*id$/i.test(k));
    return k ? it[k] : null;
  };
  const ids = [...new Set(list.map(meetIdOf).filter(v => v !== null && v !== undefined))].slice(0, MAX_MEETS);
  out.meetTimes = {};
  for (let i = 0; i < ids.length; i++) {
    await sleep(DELAY_MS);
    out.meetTimes[ids[i]] = await tryGet('meet ' + (i + 1) + ' of ' + ids.length,
      '/TimesSearch/GetSwimmerMeetTimes/' + encodeURIComponent(memberId) + '/' + encodeURIComponent(ids[i]));
  }
  if (list.length && !ids.length) errors.push('meets: could not find a meet id field in ' + JSON.stringify(Object.keys(list[0] || {})));
  out.errors = errors;

  const json = JSON.stringify(out, null, 1);
  const name = 'swimtracker-' + memberId.replace(/[^A-Za-z0-9_-]/g, '') + '-' + out.pulledAt.slice(0, 10) + '.json';
  status((errors.length ? 'Done with ' + errors.length + ' problem(s). ' : 'Done. ') +
    ids.length + ' meet(s), ' + (json.length / 1024).toFixed(0) + ' KB. Save the file, then import it into SwimTracker.');

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const btn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:8px 12px;border-radius:6px;border:1px solid #0b5ea8;background:#0b5ea8;color:#fff;font:inherit';
    b.onclick = fn; row.appendChild(b); return b;
  };
  btn('Save file', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  });
  const copyBtn = btn('Copy', async () => {
    try { await navigator.clipboard.writeText(json); copyBtn.textContent = 'Copied'; }
    catch { ta.select(); document.execCommand('copy'); copyBtn.textContent = 'Copied'; }
  });
  btn('Close', () => box.remove());
  box.appendChild(row);
  if (errors.length) {
    const e = document.createElement('pre');
    e.style.cssText = 'margin:0;color:#a00;white-space:pre-wrap;font-size:12px';
    e.textContent = errors.join('\n'); box.appendChild(e);
  }
  const ta = document.createElement('textarea');
  ta.value = json; ta.readOnly = true;
  ta.style.cssText = 'flex:1;min-height:120px;font:11px ui-monospace,monospace';
  box.appendChild(ta);
})();
