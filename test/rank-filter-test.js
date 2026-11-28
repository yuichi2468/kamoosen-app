// レート推移の日ごとの増減・絞り込みの入力・ランキングの並び替えの確認
// 実行: node test/rank-filter-test.js [スクリーンショット保存先]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadGas } = require('./gas-mock');

const out = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(out, { recursive: true });
const g = loadGas();
g.setup();
const names = ['王者', '青木', '石田', '上野', '江藤', '大西', '加藤', '木村', '工藤'];
names.forEach((n, i) => g.__sheets.players.appendRow([i === 0 ? 'A' : 'P' + String(i).padStart(2, '0'), n, '', i === 0 ? 1800 : '', true, i === 5 ? 'TRUE' : '']));
const play = (a, b, l1, l2) => {
  let r = g.api('start', { team1: a, team2: b }); if (!r.ok) throw new Error(r.error);
  g.__advance(15 * 60000);
  r = g.api('result', { match_id: r.data.matches.find(m => m.status === 'playing').id, team1_legs: l1, team2_legs: l2 }); if (!r.ok) throw new Error(r.error);
};
// 1日目: 青木 2勝、2日目: 青木 1敗1勝、3日目: 青木 1敗
play(['P01'], ['P02'], 2, 0); play(['P01'], ['P03'], 2, 1); play(['P05'], ['P06'], 2, 0);
g.__advance(24 * 3600000);
play(['P01'], ['P04'], 0, 2); play(['P01', 'P07'], ['P02', 'P08'], 2, 0);
g.__advance(24 * 3600000);
play(['P01'], ['P06'], 1, 2);

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const b = JSON.parse(body); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(g.api(b.action, b.payload)));
    }); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  let h = html.replace("var API_URL = '';", "var API_URL = '/api';");
  if (req.url.indexOf('/watch/') === 0) h = h.replace(/^var VIEW_ONLY = false;/m, 'var VIEW_ONLY = true;');
  res.end(h);
});
const fail = m => { throw new Error(m); };

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const errors = [];
  for (const watch of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url + (watch ? 'watch/' : ''));
    await page.waitForSelector('.rktable');
    const tag = watch ? '観戦用' : '参加者用';
    // ランキングの並び替え
    const col = i => page.$$eval('.rktable tbody tr', (rs, i) => rs.map(r => (r.children[i].querySelector('b') || r.children[i]).textContent.trim()), i);
    const tot0 = (await col(4)).map(Number);
    if (tot0.some((v, i) => i && v > tot0[i - 1])) fail(tag + ': 最初が合計順でない');
    await page.click('[data-rksort=rating]');
    const rt = (await col(2)).map(Number);
    if (rt.some((v, i) => i && v > rt[i - 1])) fail(tag + ': レート順になっていない ' + rt);
    if (await page.$('.rktable tr.cut')) fail(tag + ': レート順で太線が出ている');
    if (!watch) await page.screenshot({ path: path.join(out, 'ランキング_レート順.png'), fullPage: true });
    await page.click('[data-rksort=total]');
    if ((await col(4)).map(Number).join() !== tot0.join()) fail(tag + ': 合計順に戻らない');
    console.log(tag, 'rank sort ok, rating order:', rt.join(','));

    // 個人タブ: 絞り込みの入力欄が作り直されない（日本語入力の変換中も）
    await page.click('#tabs button[data-tab=me]');
    await page.waitForSelector('#meFilter');
    await page.evaluate(() => { window.__f = document.getElementById('meFilter'); });
    await page.focus('#meFilter');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'あお', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.insertText', { text: '青' });
    await page.keyboard.type('木');
    const st = await page.evaluate(() => ({ same: window.__f === document.getElementById('meFilter'), focus: document.activeElement === window.__f, v: window.__f.value,
      opts: [...document.querySelectorAll('#meView option')].map(o => o.textContent) }));
    if (!st.same || !st.focus) fail(tag + ': 入力欄が作り直された');
    if (st.v !== '青木' || st.opts.length !== 2 || !/青木/.test(st.opts[1])) fail(tag + ': 絞り込みの結果がおかしい ' + JSON.stringify(st));
    console.log(tag, 'meFilter ok:', JSON.stringify(st));
    await page.selectOption('#meView', 'P01');
    await page.waitForSelector('.hero');
    await page.evaluate(() => { const d = document.querySelector('details[data-sec=chart]'); d.open = true; });
    const rows = await page.$$eval('.daydelta tbody tr', rs => rs.map(r => [...r.children].map(c => c.textContent.trim())));
    console.log(tag, 'day rows:', JSON.stringify(rows));
    if (rows.length !== 3) fail(tag + ': 日ごとの行が3日分でない');
    if (!/^-/.test(rows[0][2]) || !/^\+/.test(rows[2][2]) || rows[0][1] !== '1' || rows[1][1] !== '2' || rows[2][1] !== '2') fail(tag + ': 日ごとの増減がおかしい');
    const hist = await page.evaluate(() => S.history.P01);
    if (+rows[0][3] !== hist[hist.length - 1].rating) fail(tag + ': その日の終わりのレートが違う');
    const sum = rows.reduce((a, r) => a + Number(r[2].replace('±', '')), 0);
    if (Math.abs(sum - (hist[hist.length - 1].rating - (hist[0].rating - hist[0].delta))) > 0.01) fail(tag + ': 増減の合計が全体の変動と合わない');
    if (!watch) { const el = await page.$('details[data-sec=chart]'); await el.screenshot({ path: path.join(out, 'レート推移_日ごとの増減.png') }); }
    if (watch) continue;
    // 選手選び: 絞り込みの入力欄が作り直されない
    await page.click('#tabs button[data-tab=play]');
    await page.click('[data-teampick="1"]');
    await page.waitForSelector('#filter');
    await page.evaluate(() => { window.__t = document.getElementById('filter'); });
    await page.focus('#filter');
    await cdp.send('Input.imeSetComposition', { text: 'い', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.insertText', { text: '石' });
    const tp = await page.evaluate(() => ({ same: window.__t === document.getElementById('filter'), focus: document.activeElement === window.__t,
      rows: [...document.querySelectorAll('.tprow .tpname')].map(x => x.textContent) }));
    if (!tp.same || !tp.focus || tp.rows.join() !== '石田') fail('選手選びの絞り込みがおかしい ' + JSON.stringify(tp));
    await page.click('[data-tp=P02]');
    if (!(await page.$eval('[data-tp=P02]', b => b.classList.contains('on')))) fail('絞り込み後に選べない');
    console.log('team pick filter ok:', JSON.stringify(tp));
  }
  console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
  await browser.close(); server.close();
  if (errors.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
