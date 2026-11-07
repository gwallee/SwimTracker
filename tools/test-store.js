// Store regression with synthetic data (no real swimmer data in the repo).
// Usage: node tools/test-store.js
const S = require('../js/store.js');
const fail = [];
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail.push(msg + ': got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); };

eq(S.toSecs('1:43.61'), 103.61, 'toSecs m:ss');
eq(S.toSecs('55.27'), 55.27, 'toSecs ss');
eq(S.toSecs('DQ'), null, 'toSecs DQ');
eq(S.fmtSecs(103.61), '1:43.61', 'fmtSecs');
eq(S.fmtSecs(60.8), '1:00.80', 'fmtSecs pad');
eq(S.eventName('50 BK SCY'), '50 Back SCY', 'eventName');

const pull = {
  kind: 'swimtracker-pull', version: 1, pulledAt: '2026-01-10T00:00:00Z', memberId: 'X1',
  member: { memberId: 'X1', shortName: 'Test Swimmer', clubName: 'Club' },
  bestTimes: [{ eventCode: '50 FR SCY', swimTime: '40.00', swimDate: '2025-10-05T00:00:00' }],
  meets: [
    { meetId: 1, meetName: 'Fall', minDate: '2025-09-01T00:00:00', maxDate: '2025-09-01T00:00:00', meetType: 'Open', courseCode: 'SCY' },
    { meetId: 2, meetName: 'Two day', minDate: '2025-10-04T00:00:00', maxDate: '2025-10-05T00:00:00', meetType: 'Open', courseCode: 'SCY' },
  ],
  meetTimes: {
    1: [{ swimTimeId: 10, eventCode: '50 FR SCY', swimTime: '42.50', timeDrop: null, finishPosition: 3 },
        { swimTimeId: 11, eventCode: '100 FR SCY', swimTime: '1:35.00', timeDrop: null }],
    2: [{ swimTimeId: 20, eventCode: '50 FR SCY', swimTime: '40.00', timeDrop: -2.5 },
        { swimTimeId: 21, eventCode: '100 FR SCY', swimTime: '1:36.10', timeDrop: 1.1 }],
  },
  errors: [],
};
const st = S.empty();
const r1 = S.merge(st, pull);
eq(r1.added, 4, 'first merge adds 4');
eq(S.merge(st, pull).added, 0, 're-merge adds nothing');
const sw = st.swimmers.X1;
eq(sw.swims['20'].date, '2025-10-05', 'multi-day meet uses best-time date');
eq(sw.swims['21'].date, '2025-10-04', 'multi-day meet falls back to start date');
const a = S.analyze(sw);
eq(a.events.map(e => e.event), ['50 FR SCY', '100 FR SCY'], 'events in distance order');
eq(a.events[0].best.time, '40.00', '50 best');
eq(a.events[1].best.time, '1:35.00', '100 best kept when later swim slower');
eq(a.swims.find(s => s.id === '20').change, -2.5, 'change vs earlier best');
eq(a.swims.find(s => s.id === '21').pb, false, 'slower swim is not a PB');
eq(a.meets[0].name, 'Two day', 'meets newest first');

// Capture of a summer-league style page (layout is a stand-in until a real SwimTopia capture arrives).
eq(S.eventFromText('Boys 9-10 50 Yard Freestyle', 'SCY'), '50 FR SCY', 'event text yards');
eq(S.eventFromText('Boys 9-10 25 Meter Backstroke', 'SCY'), '25 BK SCM', 'event text meters');
eq(S.eventFromText('Mixed 200 Medley Relay', 'SCY'), null, 'relay skipped');
eq(S.eventFromText('100 IM', 'SCM'), '100 IM SCM', 'IM default course');
eq(S.dateFromText('6/14/2026'), '2026-06-14', 'date m/d/y');
const cap = {
  kind: 'swimtracker-capture', version: 1, site: 'tidalwaves.swimtopia.com', title: 'Results', capturedAt: '2026-07-01T00:00:00Z',
  headings: ['Tidal Waves vs Sharks 6/14/2026'],
  tables: [{ heading: 'Tidal Waves vs Sharks 6/14/2026', rows: [
    ['Event', 'Name', 'Place', 'Time'],
    ['Boys 9-10 25 Yard Freestyle', 'Swimmer, Test', '2', '18.50'],
    ['Boys 9-10 25 Yard Freestyle', 'Other, Kid', '1', '17.00'],
    ['Boys 9-10 50 Yard Backstroke', 'Swimmer, Test', '4', 'DQ'],
    ['Boys 9-10 100 Yard Freestyle Relay', 'Swimmer, Test', '1', '1:20.00'],
  ] }],
};
const c = S.mergeCapture(st, 'X1', cap);
eq([c.found, c.added], [1, 1], 'capture reads only this swimmer, skips DQ and relay');
eq(S.mergeCapture(st, 'X1', cap).added, 0, 'capture re-import adds nothing');
const a2 = S.analyze(st.swimmers.X1);
eq(a2.events.map(e => e.event), ['25 FR SCY', '50 FR SCY', '100 FR SCY'], '25 free joins the event list');
eq(S.parseCapture({ tables: [{ rows: [['a', 'b']] }] }).notes[0], 'No table with Event and Time columns was found on that page.', 'unrecognized page note');

// Snapshot replacement: a newer complete pull replaces the USA Swimming swims, keeps captures.
const snap = S.empty();
S.merge(snap, pull);                                   // pulledAt 2026-01-10, swims 10, 11, 20, 21
S.mergeCapture(snap, 'X1', cap);                       // + one captured swim
const corrected = JSON.parse(JSON.stringify(pull));
corrected.pulledAt = '2026-02-01T00:00:00Z';
corrected.meetTimes[2] = [{ swimTimeId: 20, eventCode: '50 FR SCY', swimTime: '40.10', timeDrop: -2.4 }];   // 21 gone, 20 corrected
const rr = S.merge(snap, corrected);
const ids = Object.keys(snap.swimmers.X1.swims).sort();
eq([rr.added, rr.removed], [0, 1], 'newer pull: nothing new, one swim removed');
eq(ids.filter(k => !k.startsWith('cap-')), ['10', '11', '20'], 'snapshot replaced');
eq(ids.filter(k => k.startsWith('cap-')).length, 1, 'captured swim kept');
eq(snap.swimmers.X1.swims['20'].time, '40.10', 'corrected time replaces the old one');
eq(S.merge(snap, pull).older, true, 'older pull ignored');
eq(Object.keys(snap.swimmers.X1.swims).length, 4, 'older pull changed nothing');
const partial = JSON.parse(JSON.stringify(corrected));
partial.pulledAt = '2026-03-01T00:00:00Z'; partial.meetTimes[1] = null; partial.errors = ['meet 1 of 2: 500'];
eq(S.merge(snap, partial).removed, 0, 'partial pull removes nothing');
eq(Object.keys(snap.swimmers.X1.swims).length, 4, 'partial pull keeps meet 1 swims');
eq(snap.swimmers.X1.snapshotAt, '2026-02-01T00:00:00Z', 'partial pull does not move the snapshot');

// Sync between devices: the newer snapshot wins in both directions; captures are unioned.
const oldDev = S.empty(); S.merge(oldDev, pull);
const newDev = JSON.parse(JSON.stringify(snap));
const m1 = JSON.parse(JSON.stringify(oldDev)); S.mergeStores(m1, newDev);
const m2 = JSON.parse(JSON.stringify(newDev)); S.mergeStores(m2, oldDev);
eq(Object.keys(m1.swimmers.X1.swims).sort(), Object.keys(m2.swimmers.X1.swims).sort(), 'merge order does not matter');
eq(!!m1.swimmers.X1.swims['21'], false, 'removed swim does not come back from an older device');
eq(m1.swimmers.X1.swims['20'].time, '40.10', 'older device takes the corrected time');
eq(S.mergeStores(JSON.parse(JSON.stringify(m2)), oldDev).changed, false, 'older device brings nothing new');

if (fail.length) { console.error('FAIL\n' + fail.join('\n')); process.exit(1); }
console.log('ok: store merge, analyze and capture parsing');
