// engine.js の中身を Code.gs と index.html に埋め込む（両方が同じ計算をするように）
// 実行: node test/build.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const engine = fs.readFileSync(path.join(root, 'engine.js'), 'utf8').trim();
const re = /\/\* ENGINE START[\s\S]*?\/\* ENGINE END \*\//;
for (const file of ['Code.gs', 'index.html']) {
  const p = path.join(root, file);
  let s = fs.readFileSync(p, 'utf8');
  if (re.test(s)) s = s.replace(re, () => engine);
  else if (s.includes('/* ENGINE PLACEHOLDER */')) s = s.replace('/* ENGINE PLACEHOLDER */', () => engine);
  else throw new Error(file + ' に埋め込み位置がありません');
  fs.writeFileSync(p, s);
  console.log('updated', file);
}
