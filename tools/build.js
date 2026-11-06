// Builds the bookmarklet from bookmarklet/pull.js and writes it into index.html.
// Usage: node tools/build.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const src = fs.readFileSync(path.join(root, 'bookmarklet/pull.js'), 'utf8')
  .split('\n')
  .filter(l => !/^\s*\/\//.test(l))           // full-line comments only
  .map(l => l.trim())
  .filter(Boolean)
  .join('\n');
const href = 'javascript:' + encodeURIComponent(src);

const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const next = html
  .replace(/(<a id="bm" href=")[^"]*(")/, '$1' + esc(href) + '$2')
  .replace(/(<textarea id="bmcode"[^>]*>)[\s\S]*?(<\/textarea>)/, '$1' + esc(href) + '$2');
if (next === html && !html.includes(esc(href))) throw new Error('placeholders not found in index.html');
fs.writeFileSync(htmlPath, next);
console.log('bookmarklet', href.length, 'chars → index.html');
