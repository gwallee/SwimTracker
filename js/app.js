// SwimTracker dashboard. One IIFE, state at top, render() rebuilds the page.
(() => {
  const S = window.SwimStore;
  const KEY = 'swimtracker.v1';
  const state = {
    store: S.empty(),
    memberId: null,
    view: 'event',        // 'event' = one event over time, 'stroke' = pace per 25 across distances
    event: null,
    stroke: null,
  };

  // ---------- storage (browser only; the page still works without it) ----------
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) state.store = JSON.parse(raw); } catch {}
    try { const ui = JSON.parse(localStorage.getItem(KEY + '.ui') || '{}'); Object.assign(state, pick(ui, ['memberId', 'view', 'event', 'stroke'])); } catch {}
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state.store)); } catch {}
    saveUi();
  }
  function saveUi() {
    try { localStorage.setItem(KEY + '.ui', JSON.stringify(pick(state, ['memberId', 'view', 'event', 'stroke']))); } catch {}
  }
  const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

  // Optional published data (data/store.json) when nothing is saved in this browser.
  async function loadPublished() {
    if (Object.keys(state.store.swimmers || {}).length) return;
    try {
      const r = await fetch('data/store.json', { cache: 'no-store' });
      if (r.ok) { state.store = await r.json(); render(); }
    } catch {}
  }

  // ---------- small DOM helper (text always via textContent) ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, text) {
    const el = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }

  const fmtDate = (d, opts) => d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const fmtChange = c => c == null ? '' : (c < 0 ? '−' + Math.abs(c).toFixed(2) : '+' + c.toFixed(2));
  const pbBadge = sw => sw.pb ? h('span', { class: 'pb', title: sw.first ? 'First time swimming this event' : 'Personal best' }, sw.first ? 'NEW' : 'PB') : null;

  // ---------- render ----------
  function swimmer() {
    const all = state.store.swimmers || {};
    const ids = Object.keys(all);
    if (!ids.length) return null;
    if (!all[state.memberId]) state.memberId = ids[0];
    return all[state.memberId];
  }

  function render() {
    const sw = swimmer();
    const main = document.getElementById('main');
    main.replaceChildren();
    document.getElementById('name').textContent = sw ? (sw.member.shortName || sw.member.fullName || 'Swimmer') : 'SwimTracker';
    const meta = document.getElementById('meta');
    meta.replaceChildren();
    if (!sw) {
      main.append(h('div', { class: 'card empty' },
        h('h2', null, 'No times yet'),
        h('p', { class: 'muted' }, 'Install the pull button, use it on the swimmer\'s USA Swimming Data Hub page, then import the saved file here.'),
        h('p', null, h('a', { class: 'btn', href: 'install.html' }, 'Set up the pull button'), ' ', h('button', { class: 'primary', onclick: openImport }, 'Import'))));
      return;
    }
    const a = S.analyze(sw);
    const lastPull = sw.pulls[sw.pulls.length - 1];
    meta.append([sw.member.clubName, sw.member.lscCode, sw.member.swimmerAge ? 'age ' + sw.member.swimmerAge : null]
      .filter(Boolean).join(' · ') + (lastPull ? ' · updated ' + fmtDate(lastPull.pulledAt.slice(0, 10)) : ''));

    const ids = Object.keys(state.store.swimmers);
    if (ids.length > 1) {
      main.append(h('div', { class: 'chips' }, ids.map(id => {
        const m = state.store.swimmers[id].member;
        return h('button', { class: 'chip' + (id === state.memberId ? ' on' : ''), onclick: () => { state.memberId = id; saveUi(); render(); } }, m.shortName || m.fullName || id);
      })));
    }

    main.append(tiles(a));
    main.append(chartCard(a));
    main.append(bestTable(a));
    main.append(meetList(a));
  }

  function tiles(a) {
    const last = a.meets[0];
    const lastBests = last ? last.swims.filter(x => x.pb).length : 0;
    const drops = a.swims.filter(x => x.pb && !x.first);
    const biggest = drops.reduce((b, x) => (!b || x.change < b.change ? x : b), null);
    const tile = (label, value, sub) => h('div', { class: 'tile' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
    return h('div', { class: 'tiles' },
      tile('Meets', String(a.meets.length), a.meets.length ? fmtDate(a.meets[a.meets.length - 1].start, { month: 'short', year: 'numeric' }) + ' – ' + fmtDate(a.meets[0].start, { month: 'short', year: 'numeric' }) : ''),
      tile('Swims', String(a.swims.length), a.events.length + ' events'),
      tile('Last meet', last ? lastBests + ' of ' + last.swims.length : '–', last ? 'best times · ' + fmtDate(last.start, { month: 'short', day: 'numeric' }) : ''),
      tile('Biggest drop', biggest ? fmtChange(biggest.change) + ' s' : '–', biggest ? S.eventName(biggest.event) + ' · ' + fmtDate(biggest.date, { month: 'short', year: 'numeric' }) : ''));
  }

  // ---------- chart card ----------
  const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)'];   // categorical slots 1-3 (validated all-pairs)
  const SHAPES = ['circle', 'square', 'diamond'];

  function chartCard(a) {
    const card = h('section', { class: 'card' });
    const strokes = [...new Set(a.events.map(e => e.best.stroke))];
    if (!a.events.some(e => e.event === state.event)) state.event = (a.events.slice().sort((x, y) => y.count - x.count)[0] || {}).event;
    if (!strokes.includes(state.stroke)) state.stroke = S.parseEvent(state.event).stroke || strokes[0];

    const tabs = h('div', { class: 'chips seg', role: 'tablist' },
      h('button', { class: 'chip' + (state.view === 'event' ? ' on' : ''), role: 'tab', onclick: () => { state.view = 'event'; saveUi(); render(); } }, 'By event'),
      h('button', { class: 'chip' + (state.view === 'stroke' ? ' on' : ''), role: 'tab', onclick: () => { state.view = 'stroke'; saveUi(); render(); } }, 'By stroke (all distances)'));
    card.append(h('div', { class: 'cardhead' }, h('h2', null, 'Times over time'), tabs));

    if (state.view === 'stroke') {
      card.append(h('div', { class: 'chips' }, strokes.map(st => h('button', {
        class: 'chip' + (st === state.stroke ? ' on' : ''), onclick: () => { state.stroke = st; saveUi(); render(); }
      }, S.STROKES[st] || st))));
      const evs = a.events.filter(e => e.best.stroke === state.stroke).sort((x, y) => x.best.distance - y.best.distance);
      const series = evs.map((e, i) => ({
        label: e.best.distance + ' ' + e.best.course, color: SERIES[i % 3], shape: SHAPES[i % 3],
        points: e.swims.map(x => ({ x: x.date, y: x.secs / (x.distance / 25), swim: x })),
      }));
      const n = series.reduce((t, x) => t + x.points.length, 0);
      card.append(h('p', { class: 'muted small' },
        'Pace per 25 (time ÷ number of 25s), so 25s, 50s and 100s of ' + (S.STROKES[state.stroke] || state.stroke) +
        ' share one chart. Longer races are naturally a little slower per 25, so compare each distance\'s own trend. Higher on the chart = faster. ' + n + ' swims.'));
      if (evs.length > 3) card.append(h('p', { class: 'muted small' }, 'Showing the three shortest distances.'));
      card.append(chart(series.slice(0, 3), { yLabel: 's per 25', yFmt: v => v.toFixed(1) + ' s', tipFmt: p => p.swim.time + ' (' + S.eventName(p.swim.event) + ') · ' + p.y.toFixed(2) + ' s per 25' }));
      card.append(historyTable(evs.flatMap(e => e.swims).sort((x, y) => (x.date < y.date ? 1 : -1)), true));
    } else {
      card.append(h('div', { class: 'chips' }, a.events.map(e => h('button', {
        class: 'chip' + (e.event === state.event ? ' on' : ''), onclick: () => { state.event = e.event; saveUi(); render(); }
      }, e.name.replace(/ (SCY|SCM|LCM)$/, '') + ' (' + e.count + ')'))));
      const e = a.events.find(x => x.event === state.event);
      if (!e) return card;
      card.append(h('p', { class: 'muted small' }, e.name + ' · best ' + e.best.time + ' · ' + e.count + ' swim' + (e.count === 1 ? '' : 's') + '. Higher on the chart = faster.'));
      if (e.count < 2) card.append(h('p', { class: 'muted small' }, 'Only one swim so far. Try "By stroke" to see it next to the other ' + (S.STROKES[e.best.stroke] || '') + ' distances.'));
      card.append(chart([{ label: e.name, color: SERIES[0], shape: 'circle', points: e.swims.map(x => ({ x: x.date, y: x.secs, swim: x })) }],
        { yFmt: v => S.fmtSecs(v), tipFmt: p => p.swim.time, single: true }));
      card.append(historyTable(e.swims.slice().reverse(), false));
    }
    return card;
  }

  // Line chart, time on x, seconds on y with faster (smaller) at the top.
  function chart(series, opt) {
    const wrap = h('div', { class: 'chart' });
    const pts = series.flatMap((sr, si) => sr.points.filter(p => p.x && p.y != null).map(p => Object.assign({ si, t: Date.parse(p.x + 'T12:00:00') }, p)));
    if (!pts.length) { wrap.append(h('p', { class: 'muted' }, 'No times to chart.')); return wrap; }
    const legend = series.length > 1 ? h('div', { class: 'legend' }, series.map(sr => h('span', null, markerSvg(sr.shape, sr.color), ' ' + sr.label))) : null;

    const draw = () => {
      const W = Math.max(300, Math.round(wrap.clientWidth || 600)), H = W < 480 ? 230 : 280;
      const m = { l: 52, r: 16, t: 14, b: 28 };
      let t0 = Math.min(...pts.map(p => p.t)), t1 = Math.max(...pts.map(p => p.t));
      if (t1 - t0 < 864e5 * 20) { t0 -= 864e5 * 30; t1 += 864e5 * 30; }
      const pad = (t1 - t0) * 0.04; t0 -= pad; t1 += pad;
      let y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
      const span = Math.max(y1 - y0, y0 * 0.04, 1);
      const step = niceStep(span / 4);
      y0 = Math.floor((y0 - span * 0.08) / step) * step; y1 = Math.ceil((y1 + span * 0.08) / step) * step;
      const X = t => m.l + (t - t0) / (t1 - t0) * (W - m.l - m.r);
      const Y = v => m.t + (v - y0) / (y1 - y0) * (H - m.t - m.b);      // faster (smaller) at the top
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Times over time chart' });

      for (let v = y0; v <= y1 + 1e-9; v += step) {
        svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
        svg.append(s('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, opt.yFmt(v)));
      }
      for (const tk of monthTicks(t0, t1, W)) {
        svg.append(s('text', { x: X(tk.t), y: H - 8, 'text-anchor': 'middle' }, tk.label));
      }
      series.forEach((sr, si) => {
        const p = pts.filter(q => q.si === si).sort((a, b) => a.t - b.t);
        if (p.length > 1) svg.append(s('polyline', { points: p.map(q => X(q.t) + ',' + Y(q.y)).join(' '), fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        for (const q of p) svg.append(marker(sr.shape, X(q.t), Y(q.y), sr.color, q.swim && q.swim.pb));
        if (opt.single) {   // direct label on the best swim
          const b = p.reduce((x, q) => (!x || q.y < x.y ? q : x), null);
          const right = X(b.t) > W - 90;
          svg.append(s('text', { class: 'lbl', x: X(b.t) + (right ? -10 : 10), y: Y(b.y) - 8, 'text-anchor': right ? 'end' : 'start' }, 'Best ' + b.swim.time));
        }
      });
      const cross = s('line', { y1: m.t, y2: H - m.b, stroke: 'var(--muted)', 'stroke-width': 1, visibility: 'hidden' });
      svg.append(cross);
      const hit = s('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' });
      svg.append(hit);
      const tip = document.getElementById('tip');
      const show = ev => {
        const r = svg.getBoundingClientRect();
        const px = (ev.clientX - r.left) * W / r.width;
        let best = null;
        for (const q of pts) if (!best || Math.abs(X(q.t) - px) < Math.abs(X(best.t) - px)) best = q;
        const same = pts.filter(q => q.t === best.t);
        cross.setAttribute('x1', X(best.t)); cross.setAttribute('x2', X(best.t)); cross.setAttribute('visibility', 'visible');
        tip.replaceChildren(h('div', { class: 'muted' }, fmtDate(best.x)),
          ...same.map(q => h('div', null, h('b', null, opt.tipFmt(q)), q.swim.change != null ? ' ' + fmtChange(q.swim.change) : '', pbBadge(q.swim))),
          h('div', { class: 'muted' }, (state.store.swimmers[state.memberId].meets[best.swim.meetId] || {}).name || ''));
        tip.hidden = false;
        const tx = Math.min(ev.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
        tip.style.left = Math.max(8, tx) + 'px'; tip.style.top = Math.max(8, ev.clientY - tip.offsetHeight - 12) + 'px';
      };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
      wrap.replaceChildren(...(legend ? [legend] : []), svg);
    };
    requestAnimationFrame(draw);
    let last = 0;
    new ResizeObserver(() => { const w = wrap.clientWidth; if (Math.abs(w - last) > 4) { last = w; draw(); } }).observe(wrap);
    return wrap;
  }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  function monthTicks(t0, t1, W) {
    const out = [], d = new Date(t0); d.setDate(1); d.setHours(12);
    const months = (t1 - t0) / (864e5 * 30.4);
    const every = Math.max(1, Math.ceil(months / Math.max(2, Math.floor(W / 80))));
    for (d.setMonth(d.getMonth() + 1); d.getTime() <= t1; d.setMonth(d.getMonth() + every)) {
      out.push({ t: d.getTime(), label: d.toLocaleDateString(undefined, d.getMonth() === 0 || !out.length ? { month: 'short', year: '2-digit' } : { month: 'short' }) });
    }
    return out;
  }
  // PB markers are filled; other swims are hollow. Both carry a 2px surface ring.
  function marker(shape, x, y, color, filled) {
    const fill = filled ? color : 'var(--surface)';
    const common = { fill, stroke: color, 'stroke-width': 2 };
    const g = s('g');
    const ring = { fill: 'none', stroke: 'var(--surface)', 'stroke-width': 2 };
    if (shape === 'square') { g.append(s('rect', { x: x - 6, y: y - 6, width: 12, height: 12, ...ring })); g.append(s('rect', { x: x - 4.5, y: y - 4.5, width: 9, height: 9, rx: 1.5, ...common })); }
    else if (shape === 'diamond') { const d = (r) => `M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`; g.append(s('path', { d: d(8), ...ring })); g.append(s('path', { d: d(6), ...common })); }
    else { g.append(s('circle', { cx: x, cy: y, r: 6.5, ...ring })); g.append(s('circle', { cx: x, cy: y, r: 4.5, ...common })); }
    return g;
  }
  function markerSvg(shape, color) {
    const svg = s('svg', { width: 14, height: 14, viewBox: '-7 -7 14 14', 'aria-hidden': 'true' });
    svg.append(marker(shape, 0, 0, color, true));
    return svg;
  }

  function historyTable(swims, showEvent) {
    const meets = state.store.swimmers[state.memberId].meets;
    return h('details', { class: 'hist' }, h('summary', null, 'All ' + swims.length + ' swim' + (swims.length === 1 ? '' : 's') + ' as a table'), h('div', { class: 'scroll' }, h('table', { class: 'small' },
      h('thead', null, h('tr', null, h('th', null, 'Date'), showEvent ? h('th', null, 'Event') : null, h('th', { class: 'wide' }, 'Meet'), h('th', { class: 'num' }, 'Time'), h('th', { class: 'num' }, 'vs best'), h('th', { class: 'num wide' }, 'Place'))),
      h('tbody', null, swims.map(x => h('tr', null,
        h('td', null, fmtDate(x.date, { month: 'short', day: 'numeric', year: '2-digit' })),
        showEvent ? h('td', null, S.eventName(x.event)) : null,
        h('td', { class: 'wide' }, (meets[x.meetId] || {}).name || ''),
        h('td', { class: 'num' }, x.time, pbBadge(x)),
        h('td', { class: 'num' }, fmtChange(x.change)),
        h('td', { class: 'num wide' }, x.place ?? '')))))));
  }

  function bestTable(a) {
    return h('section', { class: 'card' }, h('h2', null, 'Best times'),
      h('div', { class: 'scroll' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Event'), h('th', { class: 'num' }, 'Best'), h('th', null, 'When'), h('th', { class: 'num' }, 'Last swim'), h('th', { class: 'num wide' }, 'Swims'))),
        h('tbody', null, a.events.map(e => h('tr', {
          class: 'pick' + (state.view === 'event' && e.event === state.event ? ' on' : ''), tabindex: 0,
          onclick: () => { state.view = 'event'; state.event = e.event; saveUi(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        },
          h('td', null, e.name),
          h('td', { class: 'num' }, h('b', null, e.best.time)),
          h('td', null, fmtDate(e.best.date, { month: 'short', year: 'numeric' }), h('div', { class: 'muted small wide' }, e.bestMeet ? e.bestMeet.name : '')),
          h('td', { class: 'num' }, e.last.time, h('div', { class: 'muted small' }, e.last.id === e.best.id ? 'best' : fmtChange(+(e.last.secs - e.best.secs).toFixed(2)) + ' off best')),
          h('td', { class: 'num wide' }, e.count)))))),
      h('p', { class: 'muted small' }, 'Tap an event to chart it. USA Swimming lists every time so far as "Slower Than B"; time standards are coming next.'));
  }

  function meetList(a) {
    return h('section', { class: 'card' }, h('h2', null, 'Meets'),
      a.meets.map((m, i) => h('details', { class: 'meet', open: i === 0 },
        h('summary', null, h('h3', null, m.name)),
        h('div', { class: 'muted small' }, fmtDate(m.start) + (m.end && m.end !== m.start ? ' – ' + fmtDate(m.end) : '') + ' · ' + m.type + ' · ' + m.swims.filter(x => x.pb).length + ' of ' + m.swims.length + ' best times'),
        h('table', { class: 'small' }, h('tbody', null, m.swims.map(x => h('tr', null,
          h('td', null, S.eventName(x.event)),
          h('td', { class: 'num' }, x.time, pbBadge(x)),
          h('td', { class: 'num' }, fmtChange(x.change)),
          h('td', { class: 'num muted wide' }, x.place != null ? 'place ' + x.place : ''))))))));
  }

  // ---------- import / export ----------
  function openImport() {
    document.getElementById('importMsg').textContent = '';
    document.getElementById('paste').value = '';
    document.getElementById('file').value = '';
    document.getElementById('importDlg').showModal();
  }
  async function doImport(ev) {
    ev.preventDefault();
    const msg = document.getElementById('importMsg');
    const texts = [];
    for (const f of document.getElementById('file').files) texts.push(await f.text());
    const pasted = document.getElementById('paste').value.trim();
    if (pasted) texts.push(pasted);
    if (!texts.length) { msg.textContent = 'Pick a file or paste a pull first.'; return; }
    const lines = [];
    for (const t of texts) {
      try {
        const data = JSON.parse(t);
        if (data && data.swimmers) {           // an Export file: merge its swimmers
          for (const [id, sw] of Object.entries(data.swimmers)) {
            const cur = state.store.swimmers[id];
            if (!cur) state.store.swimmers[id] = sw;
            else { Object.assign(cur.meets, sw.meets); Object.assign(cur.swims, sw.swims); cur.pulls = cur.pulls.concat(sw.pulls || []); }
          }
          lines.push('Restored ' + Object.keys(data.swimmers).length + ' swimmer(s) from an export.');
          continue;
        }
        if (data && data.kind === 'swimtracker-capture') {
          const r = S.mergeCapture(state.store, state.memberId || Object.keys(state.store.swimmers)[0], data);
          lines.push('Capture from ' + data.site + ': ' + r.found + ' swim(s) read, ' + r.added + ' new.' +
            (r.notes.length ? '\n' + r.notes.join('\n') : '') +
            (!r.found ? '\nSend this file to Claude so the importer can learn this page\'s layout.' : ''));
          continue;
        }
        const r = S.merge(state.store, data);
        state.memberId = r.memberId;
        lines.push((data.member && data.member.shortName || r.memberId) + ': ' + r.added + ' new swim' + (r.added === 1 ? '' : 's') +
          (r.newBests.length ? '\nNew best times: ' + r.newBests.join(', ') : r.firstImport ? '' : '\nNo new best times this time.') +
          (data.errors && data.errors.length ? '\nThe pull reported ' + data.errors.length + ' problem(s): ' + data.errors.join('; ') : ''));
      } catch (e) { lines.push('Could not import: ' + e.message); }
    }
    save();
    render();
    msg.textContent = lines.join('\n\n');
    document.getElementById('file').value = '';
    document.getElementById('paste').value = '';
  }
  function doExport() {
    const blob = new Blob([JSON.stringify(state.store, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'swimtracker-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.append(a); a.click(); a.remove();
  }

  document.getElementById('importBtn').addEventListener('click', openImport);
  document.getElementById('exportBtn').addEventListener('click', doExport);
  document.getElementById('doImport').addEventListener('click', doImport);
  load();
  render();
  loadPublished();
})();
