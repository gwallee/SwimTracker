// SwimTracker capture: saves the tables on the page you are looking at (for example a
// SwimTopia athlete or meet-results page) so SwimTracker can import them. Reads only what
// is already on screen; makes no requests.
(() => {
  const clean = t => String(t || '').replace(/\s+/g, ' ').trim();
  const tables = [...document.querySelectorAll('table')].map((t, i) => {
    const rows = [...t.rows].map(r => [...r.cells].map(c => clean(c.innerText)));
    let heading = '';
    for (let el = t; el && !heading; el = el.parentElement) {
      let p = el.previousElementSibling;
      while (p && !heading) { if (/^H[1-6]$/.test(p.tagName) || /title|header|heading/i.test(p.className)) heading = clean(p.innerText); p = p.previousElementSibling; }
    }
    return { index: i, heading: heading.slice(0, 200), rows: rows.filter(r => r.some(Boolean)) };
  }).filter(t => t.rows.length);
  // Some sites lay results out with div grids instead of tables: keep the visible text too.
  const main = document.querySelector('main, #main, .main, #content, .content') || document.body;
  const out = {
    kind: 'swimtracker-capture', version: 1, site: location.hostname, url: location.href,
    title: document.title, capturedAt: new Date().toISOString(),
    headings: [...document.querySelectorAll('h1,h2,h3')].map(e => clean(e.innerText)).filter(Boolean).slice(0, 40),
    tables, text: tables.length ? '' : clean(main.innerText).slice(0, 60000)
  };
  const json = JSON.stringify(out, null, 1);
  const host = location.hostname.replace(/^www\./, '').split('.')[0];
  const name = 'swimtracker-capture-' + host + '-' + out.capturedAt.slice(0, 10) + '.json';

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:12px;z-index:2147483647;background:#fff;color:#111;' +
    'font:14px system-ui,sans-serif;border:2px solid #0b5ea8;border-radius:10px;padding:14px;' +
    'display:flex;flex-direction:column;gap:10px;box-shadow:0 8px 30px rgba(0,0,0,.35)';
  const title = document.createElement('b');
  title.textContent = 'SwimTracker capture';
  const msg = document.createElement('div');
  msg.textContent = tables.length
    ? 'Found ' + tables.length + ' table(s), ' + tables.reduce((n, t) => n + t.rows.length, 0) + ' rows. Save the file and import it into SwimTracker.'
    : 'No tables on this page; saved the page text instead. If the times are not on screen, open the page that lists them and try again.';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const btn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:8px 12px;border-radius:6px;border:1px solid #0b5ea8;background:#0b5ea8;color:#fff;font:inherit';
    b.onclick = fn; row.appendChild(b); return b;
  };
  const ta = document.createElement('textarea');
  ta.value = json; ta.readOnly = true;
  ta.style.cssText = 'flex:1;min-height:120px;font:11px ui-monospace,monospace';
  btn('Save file', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  });
  const copyBtn = btn('Copy', async () => {
    try { await navigator.clipboard.writeText(json); } catch { ta.select(); document.execCommand('copy'); }
    copyBtn.textContent = 'Copied';
  });
  btn('Close', () => box.remove());
  box.append(title, msg, row, ta);
  document.body.appendChild(box);
})();
