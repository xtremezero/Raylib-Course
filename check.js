/* check.js — headless deck validation (Node, no browser needed).
   Loads framework + every chapter file exactly like index.html does,
   then reports slide counts and integrity. Run:  node check.js */
'use strict';
const path = require('path');

global.window = undefined;           // framework guards DOM access until boot
require('./js/framework.js');

for (let i = 1; i <= 14; i++) {
  const f = path.join(__dirname, 'js', 'ch' + String(i).padStart(2, '0') + '.js');
  try { require(f); }
  catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') { console.log(`ch${i}: (not written yet)`); continue; }
    console.error(`ch${i}: LOAD ERROR → ${e.message}`);
    process.exitCode = 1;
  }
}

const D = globalThis.DECK;
if (!D || !D.slides.length) { console.error('No slides loaded.'); process.exit(1); }

let n = 0, issues = 0;
const perCh = {};
for (const s of D.slides) {
  n++;
  const ch = perCh[s.ch] || (perCh[s.ch] = { count: 0, first: n, last: n, title: '' });
  ch.count++; ch.last = n;
  if (!D.chapterByNum[s.ch]) { console.error(`slide ${n}: unknown chapter ${s.ch}`); issues++; }
  if (s.type === 'content') {
    if (!s.title) { console.error(`slide ${n}: content slide missing title`); issues++; }
    const len = String(s.body || '').length;
    if (len < 80) { console.error(`slide ${n}: suspiciously short body (${len}) "${s.title}"`); issues++; }
    if (/undefined/.test(s.body) && !/fsanitize|undefined reference/.test(s.body)) {
      console.error(`slide ${n}: contains "undefined" → helper arg bug ("${s.title}")`); issues++;
    }
    if (/\[object Object\]/.test(s.body)) { console.error(`slide ${n}: [object Object] leak ("${s.title}")`); issues++; }
  }
}
console.log('\n=== Chapters ===');
for (const m of D.chapters) {
  const c = perCh[m.num] || { count: 0 };
  console.log(`Ch${String(m.num).padStart(2, '0')}  ${String(c.count).padStart(3)} slides  ${m.tag.padEnd(14)} "${m.title}"`);
}
console.log(`\nTOTAL: ${D.slides.length} slides | code blocks: ${globalThis.__CODE.length} | issues: ${issues}`);
if (issues) process.exitCode = 1;
