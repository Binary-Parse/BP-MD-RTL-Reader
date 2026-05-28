const c = require('../coverage/node/coverage-final.json');
const cwd = process.cwd();
function pct(arr) {
  if (!arr.length) return 'n/a';
  return (arr.filter(x => x > 0).length / arr.length * 100).toFixed(1);
}
for (const k of Object.keys(c)) {
  const f = c[k];
  const sk = Object.values(f.s || {});
  const fk = Object.values(f.f || {});
  const bk = Object.values(f.b || {}).flat();
  const rel = k.replace(cwd, '').replace(/^[\\/]/, '');
  console.log(`${rel} | stmts=${pct(sk)}% (${sk.filter(x=>x>0).length}/${sk.length}) funcs=${pct(fk)}% (${fk.filter(x=>x>0).length}/${fk.length}) branches=${pct(bk)}% (${bk.filter(x=>x>0).length}/${bk.length})`);
}
