// Builds the bookmarklets in bookmarklet/ and writes them into install.html.
// Usage: node tools/build.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const BOOKMARKLETS = [
  { id: 'bm', file: 'bookmarklet/pull.js' },        // USA Swimming Data Hub
  { id: 'bm2', file: 'bookmarklet/capture.js' },    // any page with times tables (SwimTopia)
];
// Where the buttons send data. Override for testing: SWIMTRACKER_URL=http://... node tools/build.js
const APP_URL = process.env.SWIMTRACKER_URL || 'https://gwallee.github.io/SwimTracker/';
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function build(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8')
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))           // full-line comments only
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n');
  return 'javascript:' + encodeURIComponent(src.split('__SWIMTRACKER_URL__').join(APP_URL));
}

const htmlPath = path.join(root, 'install.html');
let html = fs.readFileSync(htmlPath, 'utf8');
for (const b of BOOKMARKLETS) {
  const href = esc(build(b.file));
  const a = new RegExp('(<a id="' + b.id + '" href=")[^"]*(")');
  const ta = new RegExp('(<textarea id="' + b.id + 'code"[^>]*>)[\\s\\S]*?(</textarea>)');
  if (!a.test(html) || !ta.test(html)) throw new Error('placeholders for ' + b.id + ' not found in install.html');
  html = html.replace(a, (m, p1, p2) => p1 + href + p2).replace(ta, (m, p1, p2) => p1 + href + p2);
  console.log(b.id, b.file, href.length, 'chars');
}
fs.writeFileSync(htmlPath, html);
