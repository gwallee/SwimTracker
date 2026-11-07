// SwimTracker data store: turns bookmarklet pulls into one merged record per swimmer.
// Pure functions; works in the browser (window.SwimStore) and Node (require).
(function (root) {
  const STROKES = { FR: 'Free', BK: 'Back', BR: 'Breast', FL: 'Fly', IM: 'IM' };
  const STROKE_ORDER = ['FR', 'BK', 'BR', 'FL', 'IM'];

  // "1:43.61" -> 103.61, "55.27" -> 55.27; null when not a time (DQ, NS, blank).
  function toSecs(t) {
    if (typeof t !== 'string') return null;
    const m = t.trim().match(/^(?:(\d+):)?(\d{1,2}(?:\.\d+)?)$/);
    return m ? (m[1] ? +m[1] * 60 : 0) + +m[2] : null;
  }
  function fmtSecs(s) {
    if (s == null || !isFinite(s)) return '';
    const cs = Math.round(s * 100);
    const min = Math.floor(cs / 6000), rest = (cs % 6000) / 100;
    return min ? min + ':' + rest.toFixed(2).padStart(5, '0') : rest.toFixed(2);
  }
  // "50 FR SCY" -> { distance: 50, stroke: 'FR', course: 'SCY' }
  function parseEvent(code) {
    const m = String(code || '').trim().match(/^(\d+)\s+([A-Z]+)\s+([A-Z]+)$/);
    return m ? { distance: +m[1], stroke: m[2], course: m[3] } : { distance: 0, stroke: '', course: '' };
  }
  function eventName(code) {
    const e = parseEvent(code);
    return e.distance ? e.distance + ' ' + (STROKES[e.stroke] || e.stroke) + ' ' + e.course : String(code);
  }
  function eventSortKey(code) {
    const e = parseEvent(code);
    const s = STROKE_ORDER.indexOf(e.stroke);
    return [e.course, s < 0 ? 9 : s, e.distance];
  }
  function compareEvents(a, b) {
    const x = eventSortKey(a), y = eventSortKey(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return 0;
  }
  const day = s => (s ? String(s).slice(0, 10) : '');

  function empty() { return { version: 1, swimmers: {} }; }

  // Validate a bookmarklet pull; returns an error message or ''.
  function checkPull(p) {
    if (!p || p.kind !== 'swimtracker-pull') return 'Not a SwimTracker pull file.';
    if (!p.memberId) return 'The pull has no member id.';
    if (!p.meetTimes || typeof p.meetTimes !== 'object') return 'The pull has no meet times.';
    return '';
  }

  // Merge one pull into the store (mutates and returns a summary of what changed).
  // Captured (SwimTopia etc.) swims and meets are kept apart from the USA Swimming snapshot.
  const isCap = key => String(key).startsWith('cap-');

  // A complete pull is a snapshot: it replaces the swimmer's USA Swimming swims and meets with
  // exactly what the Data Hub showed (captured swims are kept). A pull with errors is partial,
  // so it only adds. A pull older than the stored snapshot is ignored.
  function merge(store, pull) {
    const err = checkPull(pull);
    if (err) throw new Error(err);
    const id = pull.memberId;
    const sw = store.swimmers[id] || (store.swimmers[id] = { memberId: id, member: {}, meets: {}, swims: {}, pulls: [] });
    const pulledAt = pull.pulledAt || new Date().toISOString();
    if (sw.snapshotAt && pulledAt < sw.snapshotAt)
      return { memberId: id, added: 0, removed: 0, older: true, firstImport: false, newBests: [] };
    const partial = (pull.errors || []).length > 0 || Object.values(pull.meetTimes).some(v => !Array.isArray(v));
    const usasBefore = Object.keys(sw.swims).filter(k => !isCap(k));
    if (pull.member) sw.member = Object.assign({}, sw.member, pull.member);
    if (pull.timeStandards) sw.timeStandards = pull.timeStandards;   // raw, kept for the cuts view

    if (!partial) {
      for (const k of Object.keys(sw.swims)) if (!isCap(k)) delete sw.swims[k];
      for (const k of Object.keys(sw.meets)) if (!isCap(k)) delete sw.meets[k];
    }
    for (const m of Array.isArray(pull.meets) ? pull.meets : []) {
      if (m && m.meetId != null) sw.meets[m.meetId] = {
        meetId: m.meetId, name: String(m.meetName || '').trim(), type: m.meetType || '',
        season: m.season || '', start: day(m.minDate), end: day(m.maxDate), course: m.courseCode || ''
      };
    }
    // Best-time entries carry the exact swim date, which helps on multi-day meets.
    const bestDate = {};
    for (const b of Array.isArray(pull.bestTimes) ? pull.bestTimes : []) bestDate[b.eventCode + '|' + b.swimTime] = day(b.swimDate);

    const before = new Set(usasBefore);
    const added = [];
    for (const [meetId, rows] of Object.entries(pull.meetTimes)) {
      if (!Array.isArray(rows)) continue;
      const meet = sw.meets[meetId] || {};
      for (const r of rows) {
        if (!r || r.swimTimeId == null) continue;
        const ev = parseEvent(r.eventCode);
        const swim = {
          id: String(r.swimTimeId), meetId: String(meetId), event: r.eventCode, ...ev,
          time: r.swimTime, secs: toSecs(r.swimTime), standard: r.timeStandard || '',
          drop: typeof r.timeDrop === 'number' ? r.timeDrop : null, place: r.finishPosition ?? null,
          session: r.sessionName || '',
          date: (meet.start && meet.end && meet.start !== meet.end && bestDate[r.eventCode + '|' + r.swimTime]) || meet.start || ''
        };
        if (!before.has(swim.id)) added.push(swim.id);
        sw.swims[swim.id] = swim;
      }
    }
    sw.pulls.push({ pulledAt, swims: Object.values(pull.meetTimes).flat().length, errors: (pull.errors || []).length });
    if (!partial) sw.snapshotAt = pulledAt;
    const removed = partial ? 0 : usasBefore.filter(k => !sw.swims[k]).length;
    sw.pulls.sort((a, b) => (a.pulledAt < b.pulledAt ? -1 : 1));
    // Only real improvements on swims new to this browser; a first import reports a count instead.
    const pbs = before.size ? analyze(sw).swims.filter(s => s.pb && !s.first && added.includes(s.id)) : [];
    return { memberId: id, added: added.length, removed, partial, firstImport: !before.size,
      newBests: pbs.map(s => eventName(s.event) + ' ' + s.time + ' (' + (s.change < 0 ? '−' + Math.abs(s.change).toFixed(2) : '') + ')') };
  }

  // Derived views: swims in date order with pb flags, per-event bests, meets with their swims.
  function analyze(sw) {
    const swims = Object.values(sw.swims)
      .map(s => Object.assign({}, s))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    const best = {};
    for (const s of swims) {
      if (s.secs == null) continue;
      const prev = best[s.event];
      s.first = !prev;
      s.pb = !prev || s.secs < prev.secs;
      s.change = prev ? +(s.secs - prev.secs).toFixed(2) : null;   // vs best before this swim
      if (s.pb) best[s.event] = s;
    }
    const events = Object.keys(best).sort(compareEvents).map(code => {
      const list = swims.filter(s => s.event === code && s.secs != null);
      const last = list[list.length - 1];
      return { event: code, name: eventName(code), best: best[code], count: list.length, last, swims: list,
        bestMeet: sw.meets[best[code].meetId] || null };
    });
    const meets = Object.values(sw.meets)
      .map(m => Object.assign({}, m, { swims: swims.filter(s => s.meetId === String(m.meetId)).sort((a, b) => compareEvents(a.event, b.event)) }))
      .filter(m => m.swims.length)
      .sort((a, b) => (a.start < b.start ? 1 : -1));
    return { swims, events, meets };
  }

  // ---------- captured tables (SwimTopia and other result pages) ----------
  // "Boys 9-10 50 Yard Freestyle", "50 Free", "25 Y Back", "100 IM (SCM)" -> "50 FR SCY"
  const STROKE_WORDS = [[/free|fr\b/i, 'FR'], [/back|bk\b/i, 'BK'], [/breast|br\b/i, 'BR'], [/fly|butter|fl\b/i, 'FL'], [/\bi\.?m\b|medley/i, 'IM']];
  function eventFromText(text, defaultCourse) {
    const t = String(text || '');
    if (/relay/i.test(t)) return null;
    const dm = t.match(/\b(25|50|100|200|400|500|800|1000|1500|1650)\b/);
    const st = STROKE_WORDS.find(([re]) => re.test(t));
    if (!dm || !st) return null;
    const course = /\bLCM\b|long course/i.test(t) ? 'LCM' : /\bSCM\b|met(er|re)s?\b|\d\s*M\b/i.test(t) ? 'SCM'
      : /\bSCY\b|yards?\b|\d\s*Y\b/i.test(t) ? 'SCY' : defaultCourse;
    return dm[1] + ' ' + st[1] + ' ' + course;
  }
  function dateFromText(text) {
    const t = String(text || '');
    let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (m) return m[0];
    m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); }
    const d = Date.parse(t.replace(/(\d)(st|nd|rd|th)\b/, '$1'));
    return isNaN(d) ? '' : new Date(d).toISOString().slice(0, 10);
  }
  function hashId(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); }

  // Reads a capture into { meets, swims, skipped, notes } for one swimmer. Tables are recognized by
  // their header row: an Event column and a Time column are required; Date, Meet, Place, Name optional.
  function parseCapture(cap, opts) {
    opts = opts || {};
    const course = opts.course || 'SCY';
    const lastName = String(opts.lastName || '').toLowerCase();
    const res = { meets: {}, swims: [], skipped: 0, tables: 0, notes: [] };
    const pageDate = dateFromText((cap.headings || []).join(' ') + ' ' + (cap.title || ''));
    for (const t of cap.tables || []) {
      const hi = t.rows.findIndex(r => r.some(c => /^event/i.test(c)) && r.some(c => /time/i.test(c)));
      if (hi < 0) continue;
      const head = t.rows[hi].map(c => c.toLowerCase());
      const col = re => head.findIndex(c => re.test(c));
      const cEvent = col(/^event/), cTime = col(/^(final )?time$|result|final|swim time|^time/),
        cDate = col(/date/), cMeet = col(/meet/), cPlace = col(/^(place|pl|rank)/), cName = col(/name|swimmer|athlete/);
      if (cTime < 0) continue;
      res.tables++;
      const meetFromHeading = t.heading || (cap.headings || [])[0] || cap.title || '';
      for (const r of t.rows.slice(hi + 1)) {
        if (cName >= 0 && lastName && !String(r[cName] || '').toLowerCase().includes(lastName)) continue;
        const event = eventFromText(r[cEvent], course);
        const time = String(r[cTime] || '').replace(/[A-Za-z*]+$/, '').trim();
        const secs = toSecs(time);
        if (!event || secs == null) { if (r.some(Boolean)) res.skipped++; continue; }
        const date = (cDate >= 0 && dateFromText(r[cDate])) || dateFromText(meetFromHeading) || pageDate;
        if (!date) { res.skipped++; continue; }
        const meetName = (cMeet >= 0 && r[cMeet]) || meetFromHeading || cap.site;
        const meetId = 'cap-' + hashId(meetName + '|' + date);
        if (!res.meets[meetId]) res.meets[meetId] = { meetId, name: meetName, type: cap.site || 'Captured', season: '', start: date, end: date, course: event.split(' ')[2] };
        const place = cPlace >= 0 ? parseInt(r[cPlace], 10) : NaN;
        res.swims.push({ id: 'cap-' + hashId(date + '|' + event + '|' + time), meetId, event, ...parseEvent(event), time: fmtSecs(secs), secs,
          standard: '', drop: null, place: isNaN(place) ? null : place, session: '', date, source: cap.site || 'capture' });
      }
    }
    if (!res.tables) res.notes.push('No table with Event and Time columns was found on that page.');
    if (res.skipped) res.notes.push(res.skipped + ' row(s) could not be read (relays, DQ/NS, or no date).');
    return res;
  }
  function mergeCapture(store, memberId, cap, opts) {
    const sw = store.swimmers[memberId];
    if (!sw) throw new Error('Import a USA Swimming pull first, so the capture has a swimmer to attach to.');
    const r = parseCapture(cap, Object.assign({ lastName: (sw.member.shortName || sw.member.fullName || '').split(' ').pop() }, opts));
    Object.assign(sw.meets, r.meets);
    let added = 0;
    for (const s of r.swims) { if (!sw.swims[s.id]) added++; sw.swims[s.id] = s; }
    sw.pulls.push({ pulledAt: cap.capturedAt || new Date().toISOString(), swims: r.swims.length, errors: r.skipped, source: cap.site });
    return { memberId, added, found: r.swims.length, notes: r.notes };
  }

  // Union of two whole stores (this browser + the synced copy). Swims, meets and pulls are keyed,
  // so merging in either order gives the same result and nothing is ever dropped.
  function mergeStores(into, from) {
    if (!from || !from.swimmers) return { changed: false };
    let changed = false;
    for (const [id, sw] of Object.entries(from.swimmers)) {
      let cur = into.swimmers[id];
      if (!cur) { into.swimmers[id] = JSON.parse(JSON.stringify(sw)); changed = true; continue; }
      // USA Swimming part: the newer snapshot replaces the older one; equal (or none) = union.
      const a = cur.snapshotAt || '', b = sw.snapshotAt || '';
      for (const k of ['meets', 'swims']) {
        cur[k] = cur[k] || {};
        if (b > a) for (const key of Object.keys(cur[k])) if (!isCap(key) && !(sw[k] || {})[key]) { delete cur[k][key]; changed = true; }
        for (const [key, v] of Object.entries(sw[k] || {})) {
          if (!isCap(key) && a > b) continue;                       // older snapshot: ignore its USA Swimming data
          if (!cur[k][key] || (b > a && JSON.stringify(cur[k][key]) !== JSON.stringify(v))) { cur[k][key] = v; changed = true; }
        }
      }
      if (b > a) { cur.snapshotAt = b; changed = true; }
      cur.pulls = cur.pulls || [];
      const seen = new Set(cur.pulls.map(p => p.pulledAt + '|' + (p.source || '')));
      for (const p of sw.pulls || []) if (!seen.has(p.pulledAt + '|' + (p.source || ''))) { cur.pulls.push(p); changed = true; }
      cur.pulls.sort((a, b) => (a.pulledAt < b.pulledAt ? -1 : 1));
      const lastPull = s => (s.pulls && s.pulls.length ? s.pulls[s.pulls.length - 1].pulledAt : '');
      if (lastPull(sw) >= lastPull(cur)) {   // newer pull wins for profile fields
        if (sw.member) cur.member = Object.assign({}, cur.member, sw.member);
        if (sw.timeStandards) cur.timeStandards = sw.timeStandards;
      }
    }
    return { changed };
  }

  const api = { mergeStores, toSecs, fmtSecs, parseEvent, eventName, compareEvents, empty, checkPull, merge, analyze, STROKES,
    eventFromText, dateFromText, parseCapture, mergeCapture };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SwimStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
