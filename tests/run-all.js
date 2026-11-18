// 依序執行所有 *.test.js，任何一個失敗就以非 0 結束。
const { readdirSync } = require('fs');
const { spawnSync } = require('child_process');
let failed = 0, passed = 0;
for (const f of readdirSync(__dirname).filter(n => n.endsWith('.test.js')).sort()) {
  const r = spawnSync(process.execPath, [require('path').join(__dirname, f)], { encoding: 'utf8' });
  const lines = (r.stdout || '').split('\n');
  const p = lines.filter(l => l.startsWith('PASS')).length;
  const bad = lines.filter(l => l.startsWith('FAIL'));
  passed += p; failed += bad.length + (r.status && !bad.length ? 1 : 0);
  console.log(`${bad.length || r.status ? 'FAIL' : 'ok  '} ${f} (${p} passed)`);
  bad.forEach(l => console.log('   ' + l));
  if (r.status && !bad.length) console.log((r.stderr || '').split('\n').slice(0, 5).join('\n'));
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
