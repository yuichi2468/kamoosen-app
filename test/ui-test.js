// 画面の動作確認: モックの Apps Script を HTTP で立て、ブラウザで操作する
// 実行: node test/ui-test.js [スクリーンショット保存先]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadGas } = require('./gas-mock');

const out = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(out, { recursive: true });
const g = loadGas();
g.setup();
const names = ['王者', '青木', '石田', '上野', '江藤', '大西', '加藤', '木村', '工藤', '小林', '佐藤', '鈴木'];
names.forEach((n, i) => g.__sheets.players.appendRow([i === 0 ? 'A' : 'P' + String(i).padStart(2, '0'), n, i === 0 ? '' : (i <= 3 ? 1525 : ''), i === 0 ? 1800 : '', true, i === 5 || i === 7 ? 'TRUE' : '']));
// 過去の試合を何件か作る
const seed = [[['P01'], ['P02'], 2, 1], [['P03', 'P04'], ['P05', 'P06'], 0, 2], [['P01'], ['A'], 2, 0], [['P07', 'P08', 'P09'], ['P10'], 2, 1], [['P02'], ['P03'], 1, 2]];
seed.forEach(([a, b, l1, l2]) => {
  let r = g.api('start', { team1: a, team2: b }); if (!r.ok) throw new Error(r.error);
  g.__advance(15 * 60000);
  r = g.api('result', { match_id: r.data.matches[0].id, team1_legs: l1, team2_legs: l2 }); if (!r.ok) throw new Error(r.error);
});

// 個人戦を1投ごとに記録した試合（個人戦の成績の表示用）: 工藤 vs 小林、工藤の2-0
{
  const N = p => ({ kind: 'normal', points: p }), X = { kind: 'miss' };
  const tl = [N(6), N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(8), X, N(5), X, N(5), X];
  let r = g.api('start', { team1: ['P08'], team2: ['P09'], scoring: 'throws', first_team: 1, device: 'seed' }); if (!r.ok) throw new Error(r.error);
  const mid = r.data.matches.find(m => m.status === 'playing').id;
  g.__advance(10 * 60000);
  r = g.api('sync', { match_id: mid, throws: tl, leg_orders: [], base_rev: 0, device: 'seed' }); if (!r.ok) throw new Error(r.error);
}

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let slow = 0; // 送信中の表示を確認するため、応答を遅らせる（ミリ秒）
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const b = JSON.parse(body); const r = g.api(b.action, b.payload);
      setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(r)); }, slow);
    }); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html.replace("var API_URL = '';", "var API_URL = '/api';"));
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('table');
  await page.screenshot({ path: path.join(out, '1_ranking.png'), fullPage: true });

  await page.click('nav button[data-tab=play]');
  await page.click('button.b1[data-id=P04]');
  await page.click('button.b1[data-id=P11]');
  await page.click('button.b2[data-id=A]');
  await page.waitForSelector('.preview');
  const preview = await page.textContent('.preview');
  await page.screenshot({ path: path.join(out, '2_start.png'), fullPage: true });
  await page.click('[data-opt=scoring][data-v=manual]');
  await page.click('#startBtn');
  await page.waitForSelector('[data-result]');
  const card = page.locator('.match').first();
  await card.locator('[data-f=legs1]').selectOption('2');
  await card.locator('[data-f=legs2]').selectOption('1');
  await card.locator('[data-f=score1]').fill('100');
  await card.locator('[data-f=score2]').fill('87');
  await page.screenshot({ path: path.join(out, '3_result.png'), fullPage: true });
  await page.evaluate(() => document.querySelector('[data-result]').scrollIntoView({ block: 'center' })); // 上部の固定タブに隠れないように
  slow = 1500;
  await page.click('[data-result]');
  await page.waitForSelector('#sendNotice:not([hidden])');
  await page.screenshot({ path: path.join(out, '3b_sending.png') });
  await page.waitForSelector('#sendNotice[hidden]', { state: 'attached', timeout: 10000 });
  slow = 0;
  await page.waitForFunction(() => !document.querySelector('[data-result]'));
  await page.click('nav button[data-tab=me]');
  await page.selectOption('#meView', 'P04');
  await page.waitForSelector('.tiles');
  if (await page.isVisible('svg.chart')) throw new Error('折りたたみが最初から開いている');
  await page.click('details[data-sec=chart] summary');
  await page.waitForSelector('svg.chart');
  await page.screenshot({ path: path.join(out, '4_me.png'), fullPage: true });
  await page.click('nav button[data-tab=log]');
  await page.screenshot({ path: path.join(out, '5_log.png'), fullPage: true });
  await page.click('#adminBtn');
  await page.fill('#adminKey', 'change-me');
  await page.click('#adminLogin');
  await page.waitForSelector('#adminRecalc');
  await page.screenshot({ path: path.join(out, '6_admin.png'), fullPage: true });

  // ---- 1投ごとの記録（個人の投擲順あり） ----
  await page.click('nav button[data-tab=play]');
  await page.click('button.b1[data-id=P05]');
  await page.click('button.b2[data-id=P07]');
  if (!(await page.textContent('#main')).includes('個人戦なので')) throw new Error('個人戦の表示がない');
  await page.screenshot({ path: path.join(out, '7a_start_solo.png'), fullPage: true });
  await page.click('button.b1[data-id=P06]');
  await page.check('#useOrder');
  await page.click('[data-up=P06]'); // 大西と加藤の順番を入れ替え
  await page.screenshot({ path: path.join(out, '7_start_throws.png'), fullPage: true });
  slow = 1500;
  await page.click('#startBtn');
  await page.waitForSelector('#sendNotice:not([hidden])');
  await page.screenshot({ path: path.join(out, '7b_start_sending.png') });
  await page.waitForSelector('.points');
  if (!(await page.isHidden('#sendNotice'))) throw new Error('開始後も注意が消えていない');
  slow = 0;
  const throwPins = async (pt) => { await page.click('[data-pt="' + pt + '"]'); await page.click('#okThrow'); };
  const miss = () => page.click('#missThrow');
  // 1本目: チーム1（加藤→大西）が 12,12,12,12,2 で 50。チーム2（木村）は 1 ずつ
  await throwPins(12); await throwPins(1); await throwPins(12); await throwPins(1);
  await throwPins(3); await miss();                // 3点、ミス
  await page.screenshot({ path: path.join(out, '8_scoring.png'), fullPage: true });
  {
    const rows = await page.$$eval('.sctwrap.live .sct tbody tr', r => r.map(x => [...x.children].map(c => c.className + ':' + c.innerText.replace(/\s+/g, ' ').trim())));
    console.log('live score table:', JSON.stringify(rows));
    if (rows.length !== 3 || !rows[2][4].startsWith('tot c-m1')) throw new Error('試合中のスコア表がおかしい: ' + JSON.stringify(rows));
  }
  await page.setViewportSize({ width: 375, height: 667 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const undoBottom = await page.evaluate(() => document.querySelector('#undoThrow').getBoundingClientRect().bottom);
  await page.screenshot({ path: path.join(out, '8a_scoring_375x667.png') });
  if (undoBottom > 667) throw new Error('375×667 で1画面に収まっていない: ' + undoBottom);
  console.log('375x667: 1投戻す の下端', Math.round(undoBottom));
  await page.setViewportSize({ width: 390, height: 844 });
  const next1 = await page.textContent('.nextbar');
  await page.waitForTimeout(1500);
  const saved = await page.textContent('.card .row .muted');
  const srvThrows = g.api('state').data.matches.find(m => m.scoring === 'throws').throws.length;
  if (saved.trim() !== '保存済み' || srvThrows !== 6) throw new Error('途中保存されていない: ' + saved + ' / ' + srvThrows);
  await throwPins(12); await throwPins(1); await throwPins(9); // 12+12+3+12 = 39 → +9 = 48
  await throwPins(3); await throwPins(2); // 48+2 = 50
  await page.waitForSelector('#legStart');
  await page.click('[data-dup=P05]'); // 2本目は大西を1番目に
  await page.screenshot({ path: path.join(out, '9_leg2_setup.png'), fullPage: true });
  await page.click('#legStart');
  await page.waitForSelector('.points');
  const next2 = await page.textContent('.nextbar');
  // 2セット目: チーム2先攻。チーム1が3連続ミス → チーム2 の勝ち（1-1）
  await miss(); await miss(); await throwPins(1); await miss(); await throwPins(1); await miss();
  await page.waitForSelector('.firstpick');
  await page.click('[data-dfirst="1"]');
  await page.screenshot({ path: path.join(out, '9b_leg3_setup.png'), fullPage: true });
  await page.click('#legStart');
  await page.waitForSelector('.points');
  // 3セット目: チーム1先攻。チーム2が3連続ミス → チーム1 の勝ち（2-1）
  await throwPins(1); await miss(); await throwPins(1); await miss(); await throwPins(1); await miss();
  await page.waitForSelector('#confirmEnd');
  await page.screenshot({ path: path.join(out, '10_finish.png'), fullPage: true });
  {
    const titles = await page.$$eval('.sctitle', x => x.map(y => y.textContent));
    const outs = await page.$$eval('.sct td.c-out', x => x.length);
    console.log('finish tables:', titles.join(' / '), 'out cells:', outs);
    if (titles.length !== 3 || outs !== 2) throw new Error('試合終了のスコア表がおかしい');
  }
  slow = 2000;
  await page.click('#confirmEnd');
  await page.waitForSelector('#sendNotice:not([hidden])');
  await page.screenshot({ path: path.join(out, '10b_sending.png'), fullPage: true });
  slow = 0;
  await page.waitForFunction(() => !document.querySelector('#confirmEnd') && !document.querySelector('.points'));
  await page.waitForTimeout(300);
  const fin = g.api('state').data.matches.find(m => m.scoring === 'throws');
  console.log('next1:', next1.replace(/\s+/g, ' '), '| next2:', next2.replace(/\s+/g, ' '));
  console.log('throws match:', fin.status, fin.legs1 + '-' + fin.legs2, 'scores', fin.score1, fin.score2, 'legs', JSON.stringify(fin.leg_scores));
  console.log('stats P06:', JSON.stringify(g.api('state').data.throw_stats.P06));
  await page.click('nav button[data-tab=me]');
  await page.selectOption('#meView', 'P06');
  await page.screenshot({ path: path.join(out, '11_me_stats.png'), fullPage: true });

  await page.click('nav button[data-tab=awards]');
  await page.waitForSelector('.award');
  {
    const chk = await page.evaluate(() => [...document.querySelectorAll('.award')].map(a => ({
      vis: [...a.querySelectorAll(':scope > .arow .arank')].map(x => x.textContent),
      hidden: [...a.querySelectorAll('details.amore .arank')].map(x => x.textContent),
      open: !!a.querySelector('details.amore[open]') })));
    console.log('award layout:', JSON.stringify(chk.slice(0, 4)));
    for (const c of chk.slice(0, -1)) { if (c.vis.some(r => r !== '1位') || c.open) throw new Error('award fold NG ' + JSON.stringify(c)); }
  }
  await page.screenshot({ path: path.join(out, '12_awards.png'), fullPage: true });
  await page.click('details.amore summary');
  await page.screenshot({ path: path.join(out, '12b_awards_open.png'), fullPage: true });
  await page.click('.award a[data-me]');
  await page.waitForSelector('.award-b');
  await page.screenshot({ path: path.join(out, '13_me_badge.png') });
  await page.click('nav button[data-tab=me]');
  await page.selectOption('#meView', 'P08');
  await page.click('details[data-sec=bonus] summary');
  await page.click('details[data-sec=singles] summary');
  await page.waitForSelector('.ebrow');
  await page.click('details[data-sec=recent] summary');
  const order = await page.$$eval('details.sec', d => d.map(x => x.dataset.sec).join(','));
  if (order !== 'bonus,throws,singles,chart,singles_count,recent') throw new Error('並びが違う: ' + order);
  await page.click('[data-eblist=opponents]');
  await page.waitForSelector('.eblist');
  await page.screenshot({ path: path.join(out, '14_me_singles_bonus.png'), fullPage: true });
  await page.selectOption('#meView', 'P07');
  const hc = await page.$$eval('details[data-sec=bonus] .ebrow', r => r.map(x => x.textContent));
  if (!hc.some(x => x.includes('ハンデ（1回生）') && x.includes('+30pt'))) throw new Error('ハンデ行が無い: ' + hc);
  console.log('P07 bonus rows:', hc.join(' | '));
  await page.screenshot({ path: path.join(out, '15_me_rookie_bonus.png'), fullPage: true });
  const hp = await page.$eval('.heroproj', x => x.textContent);
  if (!hp.includes('+30') || hp.includes('見込み')) throw new Error('1回生ハンデの表示: ' + hp);
  await page.selectOption('#meView', 'A');
  const aSecs = await page.$$eval('details.sec', d => d.map(x => x.dataset.sec).join(','));
  console.log('A sections:', aSecs);
  if (!aSecs.includes('singles')) throw new Error('A に個人戦の成績が無い');
  await page.screenshot({ path: path.join(out, '16_me_A.png'), fullPage: true });
  await page.click('nav button[data-tab=rank]');
  const heads = await page.$$eval('table.rktable th', x => x.map(y => y.textContent).join(','));
  if (heads !== '順位,名前,レート,ボーナス,合計,試合数,チーム戦') throw new Error('ランキングの列: ' + heads);
  const rk = await page.$$eval('table.rktable tbody tr', rows => rows.map(r => [...r.children].map(c => c.innerText.replace(/\s+/g, ' ').trim())));
  console.log('ranking rows:', JSON.stringify(rk.slice(0, 4)));
  for (let i = 1; i < rk.length; i++) if (Number(rk[i][4]) > Number(rk[i - 1][4])) throw new Error('合計順でない');
  if (!rk.some(r => r[3] === '+30')) throw new Error('ボーナス+30が無い'); if (rk.some(r => r.join().includes('見込み'))) throw new Error('見込みが残っている');
  await page.screenshot({ path: path.join(out, '17_rank_proj.png'), fullPage: true });
  await page.click('nav button[data-tab=log]');
  await page.click('[data-sct]');
  await page.waitForSelector('.sctitle');
  const htitles = await page.$$eval('.sctitle', x => x.map(y => y.textContent));
  console.log('history tables:', htitles.join(' / '));
  await page.screenshot({ path: path.join(out, '18_log_score.png'), fullPage: true });
  await page.click('[data-scback]');
  if (!(await page.$('nav button[data-tab=log].on'))) throw new Error('戻るで履歴タブに戻らない');
  // 個人ページの直近の試合から開いて、元の位置に戻る
  await page.click('nav button[data-tab=me]');
  await page.selectOption('#meView', 'P08');
  const sl = await page.$('details[data-sec=recent] .sclink');
  if (!sl) throw new Error('直近の試合にスコア表リンクが無い');
  await sl.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  const y0 = await page.evaluate(() => window.scrollY);
  await sl.click();
  await page.waitForSelector('.sctitle');
  await page.screenshot({ path: path.join(out, '19_me_score.png'), fullPage: true });
  await page.click('[data-scback]');
  const y1 = await page.evaluate(() => window.scrollY);
  console.log('score screen back scroll:', y0, '->', y1);
  if (Math.abs(y1 - y0) > 2) throw new Error('元の位置に戻らない');
  const st = g.api('state').data;
  const p4 = st.players.find(p => p.id === 'P04');
  console.log('preview:', preview.replace(/\s+/g, ' '));
  console.log('P04 rating after win vs A team:', p4.rating, 'A:', st.players.find(p => p.id === 'A').rating);
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); server.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
