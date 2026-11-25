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
  // チームの枠をタップ → 選手を選ぶ → 確定（設計書 19.2）
  const pickTeam = async (t, ids, shot) => {
    await page.click('[data-teampick="' + t + '"]');
    await page.waitForSelector('.tplist');
    for (const id of ids) await page.click('[data-tp="' + id + '"]');
    if (shot) { await page.setViewportSize({ width: 375, height: 667 }); await page.screenshot({ path: path.join(out, shot) }); await page.setViewportSize({ width: 390, height: 844 }); }
    await page.click('#tpOk');
    await page.waitForSelector('[data-teampick]');
  };
  // 戻る（キャンセル）は反映しない
  await page.click('[data-teampick="1"]'); await page.click('[data-tp=P04]'); await page.click('#tpBack');
  if (!(await page.textContent('[data-teampick="1"]')).includes('タップして選手を選ぶ')) throw new Error('戻るで反映されている');
  await pickTeam(1, ['P04', 'P11'], '2a_team_pick.png');
  await pickTeam(2, ['A']);
  // 相手チームの人は選べない
  await page.click('[data-teampick="2"]');
  if (!(await page.isDisabled('[data-tp=P04]'))) throw new Error('相手チームの人が選べる');
  await page.click('#tpBack');
  await page.waitForSelector('.preview');
  if ((await page.textContent('.preview')).includes('勝てば')) throw new Error('増減の見込みが残っている');
  const preview = await page.textContent('.preview');
  await page.screenshot({ path: path.join(out, '2_start.png'), fullPage: true });
  await page.click('[data-opt=scoring][data-v=manual]');
  await page.click('#startBtn');
  await page.waitForSelector('[data-watch]');
  if (await page.$('[data-result],[data-cancel]')) throw new Error('試合を選ぶ前から操作ボタンが出ている');
  await page.click('[data-watch]');
  await page.waitForSelector('[data-result]');
  const card = page.locator('.match.ops').first();
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
  const ba = await page.$$eval('.hm .ba', x => x.map(y => [...y.children].map(c => c.textContent).join(' / ')));
  console.log('history before/after:', JSON.stringify(ba.slice(0, 4)));
  if (!ba.some(x => /1800（固定）/.test(x)) || !ba.some(x => /^\d+ → \d+$/.test(x))) throw new Error('変動前後のレートが出ていない');
  await page.screenshot({ path: path.join(out, '5_log.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.screenshot({ path: path.join(out, '5b_log_375.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#adminBtn');
  await page.fill('#adminKey', 'change-me');
  await page.click('#adminLogin');
  await page.waitForSelector('#adminRecalc');
  await page.screenshot({ path: path.join(out, '6_admin.png'), fullPage: true });

  // ---- 1投ごとの記録（個人の投擲順あり） ----
  await page.click('nav button[data-tab=play]');
  await pickTeam(1, ['P05']);
  await pickTeam(2, ['P07']);
  // 1vs1 が上限に達しているときだけ警告し、次へを押せない（設計書 19.1）
  if (await page.$('.warnbox')) throw new Error('上限前なのに警告が出ている');
  await page.evaluate(() => { S.singles['P05|P07'] = 3; render(); });
  if (!(await page.textContent('#main')).includes('上限の3試合に達しています') || !(await page.isDisabled('#nextStep'))) throw new Error('1vs1上限の警告が出ない');
  await page.evaluate(() => { delete S.singles['P05|P07']; render(); });
  await page.click('#nextStep'); // 画面2へ
  if (!(await page.textContent('#main')).includes('個人戦なので')) throw new Error('個人戦の表示がない');
  if (await page.$('#noOrder')) throw new Error('個人戦に「投擲順を入れない」が出ている');
  await page.screenshot({ path: path.join(out, '7a_start_solo.png'), fullPage: true });
  await page.click('#backStep');
  await pickTeam(1, ['P06']); // 大西に加藤を追加（選んだ順が投擲順）
  await page.click('#nextStep');
  if (!(await page.isDisabled('#startBtn'))) throw new Error('先攻を選ぶ前に試合開始が押せる');
  if (!(await page.$('.olist'))) throw new Error('投擲順が最初から出ていない');
  await page.check('#noOrder');
  if (await page.$('.olist')) throw new Error('入れないにしても投擲順が消えない');
  await page.uncheck('#noOrder');
  await page.click('[data-opt=first_team][data-v="1"]');
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
  const miss = () => page.click('#okThrow'); // 点数を選ばずに確定 = ミス
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
  {
    // 3セット目の準備: 得点ボードは出さず、総得点が高いチームが先攻に仮選択されている
    if (await page.$('.board')) throw new Error('3セット目の準備画面に得点ボードが出ている');
    const tot = (await page.textContent('.nextbar')).match(/総得点\s*(\d+)\s*-\s*(\d+)/);
    const want = +tot[1] > +tot[2] ? '1' : +tot[2] > +tot[1] ? '2' : null;
    const on = await page.$$eval('.firstpick button.on', x => x.map(y => y.dataset.dfirst));
    console.log('leg3 totals', tot[1], tot[2], 'preselected', on.join(','));
    if (on.join(',') !== (want || '')) throw new Error('3セット目の先攻の初期選択がおかしい: ' + on);
    if (want && await page.$eval('#legStart', b => b.disabled)) throw new Error('初期選択があるのに開始できない');
  }
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
  const aHero = await page.$eval('.hero', x => x.textContent);
  console.log('A hero:', aHero.replace(/\s+/g, ' '));
  if (!aHero.includes('1800') || !aHero.includes('変動した場合（参考）')) throw new Error('A の参考レートが無い: ' + aHero);
  if (!aSecs.includes('chart')) throw new Error('A に参考のレート推移が無い');
  const aChart = await page.$eval('details[data-sec=chart] summary', x => x.textContent);
  if (!aChart.includes('参考')) throw new Error('A のレート推移に参考の表示が無い: ' + aChart);
  await page.screenshot({ path: path.join(out, '16_me_A.png'), fullPage: true });
  // 運営画面で参考レートを非表示にすると、個人ページから消える
  await page.click('#adminBtn');
  await page.waitForSelector('#virtualToggle');
  if ((await page.getAttribute('#virtualToggle', 'data-on')) !== '1') throw new Error('参考レートの初期状態が表示中でない');
  await page.click('#virtualToggle');
  await page.waitForSelector('#virtualToggle[data-on="0"]');
  await page.screenshot({ path: path.join(out, '6b_admin_virtual_off.png'), fullPage: true });
  await page.click('nav button[data-tab=me]');
  await page.selectOption('#meView', 'A');
  const aHeroOff = await page.$eval('.hero', x => x.textContent);
  if (aHeroOff.includes('参考')) throw new Error('非表示にしても参考レートが出ている: ' + aHeroOff);
  if (await page.$('details[data-sec=chart]')) throw new Error('非表示にしても参考のレート推移が出ている');
  await page.click('#adminBtn');
  await page.click('#virtualToggle');
  await page.waitForSelector('#virtualToggle[data-on="1"]');
  // 開始値を 1500 にすると、個人ページに「1500 から」と出る。空欄に戻すと固定レートから
  await page.fill('#virtualStart', '1500');
  await page.click('#virtualStartSave');
  await page.waitForFunction(() => document.querySelector('#virtualStart') && document.querySelector('#virtualStart').value === '1500' && S.settings.virtual_initial_rating === 1500);
  await page.screenshot({ path: path.join(out, '6c_admin_virtual_start.png'), fullPage: true });
  await page.click('nav button[data-tab=me]');
  await page.selectOption('#meView', 'A');
  const aHero1500 = await page.$eval('.hero', x => x.textContent);
  console.log('A hero (start 1500):', aHero1500.replace(/\s+/g, ' '));
  if (!aHero1500.includes('1500 から')) throw new Error('開始値が反映されていない: ' + aHero1500);
  await page.click('#adminBtn');
  await page.fill('#virtualStart', '');
  await page.click('#virtualStartSave');
  await page.waitForFunction(() => S.settings.virtual_initial_rating === null);
  await page.click('nav button[data-tab=me]');
  await page.selectOption('#meView', 'A');
  await page.click('nav button[data-tab=rank]');
  const heads = await page.$$eval('table.rktable th', x => x.map(y => y.textContent).join(','));
  if (heads !== '順位,名前,レート,ボーナス,合計,試合数,チーム戦') throw new Error('ランキングの列: ' + heads);
  const rk = await page.$$eval('table.rktable tbody tr', rows => rows.map(r => [...r.children].map(c => c.innerText.replace(/\s+/g, ' ').trim())));
  console.log('ranking rows:', JSON.stringify(rk.slice(0, 4)));
  const raid = await page.$$eval('.card', cs => cs.map(c => c.textContent).filter(t => t.includes('レイドバトル')).join(''));
  if (!raid.includes('変動した場合のレート（参考）')) throw new Error('レイドバトルに参考レートが無い: ' + raid);
  for (let i = 1; i < rk.length; i++) if (Number(rk[i][4]) > Number(rk[i - 1][4])) throw new Error('合計順でない');
  if (!rk.some(r => r[3] === '+30')) throw new Error('ボーナス+30が無い'); if (rk.some(r => r.join().includes('見込み'))) throw new Error('見込みが残っている');
  await page.screenshot({ path: path.join(out, '17_rank_proj.png'), fullPage: true });
  await page.click('nav button[data-tab=log]');
  await page.setViewportSize({ width: 375, height: 667 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(3500); await page.screenshot({ path: path.join(out, '5c_log_sets_375.png') }); await page.setViewportSize({ width: 390, height: 844 });
  if (!(await page.$('.hmsetsc'))) throw new Error('セット得点が中央に無い');
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
  // 1投ごとの記録で始めた試合を途中で取り消す
  {
    let r = g.api('start', { team1: ['P10'], team2: ['P11'], scoring: 'throws', first_team: 1, device: 'other' }); if (!r.ok) throw new Error(r.error);
    const cmid = r.data.matches.find(m => m.status === 'playing' && m.team1[0] === 'P10').id;
    await page.reload(); await page.waitForSelector('table');
    await page.click('nav button[data-tab=play]');
    // 一覧には引き継ぎ・取り消しのボタンを出さない（設計書 第21章）
    if (await page.$('[data-take],[data-cancel],[data-score="' + cmid + '"]')) throw new Error('一覧に操作ボタンが出ている');
    // 観戦: タップするとスコア表が出て、記録中の端末の送信が自動で反映される。観戦しても記録者・rev は変わらない
    await page.screenshot({ path: path.join(out, '21b_playing_list.png') });
    await page.click('[data-watch="' + cmid + '"]');
    await page.waitForSelector('#watchBack');
    await page.waitForFunction(() => /観戦中/.test(document.body.textContent));
    const Nn = p => ({ kind: 'normal', points: p });
    let rr = g.api('sync', { match_id: cmid, throws: [Nn(7), Nn(3), Nn(9)], leg_orders: [], base_rev: 0, device: 'other' }); if (!rr.ok) throw new Error(rr.error);
    await page.waitForFunction(() => document.querySelectorAll('.sctwrap.live td.tot').length >= 3, null, { timeout: 12000 });
    const wb = (await page.textContent('.board')).replace(/\s+/g, ' ');
    if (!/16/.test(wb) || !/3/.test(wb)) throw new Error('観戦の得点が更新されない: ' + wb);
    await page.screenshot({ path: path.join(out, '22_watch.png'), fullPage: true });
    { const wm = g.api('state').data.matches.find(m => m.id === cmid); if (wm.rev !== 1 || wm.scorer !== '端末other') throw new Error('観戦で記録に影響した: ' + wm.rev + ' ' + wm.scorer); }
    // 引き継ぎは2回押す
    await page.click('[data-take]');
    await page.waitForSelector('[data-takeno]');
    await page.screenshot({ path: path.join(out, '23_watch_take.png'), fullPage: true });
    await page.click('[data-takeno]');
    if (await page.$('[data-takeno]')) throw new Error('引き継ぎの確認が閉じない');
    await page.click('[data-take]'); await page.click('[data-take]');
    await page.waitForSelector('.points');
    await page.click('[data-pt="5"]'); await page.click('#okThrow');
    if ((await page.textContent('#okThrow')).trim() !== '確定（ミス）') throw new Error('点数未選択の確定の表示がおかしい');
    await page.click('.cancelrow [data-cancel]');
    await page.waitForSelector('.cancelov');
    await page.screenshot({ path: path.join(out, '20_scoring_cancel.png') });
    await page.click('[data-cancelno]');   // やめる → 試合は続く
    if (await page.$('.cancelov')) throw new Error('やめるで閉じない');
    await page.click('.cancelrow [data-cancel]');
    const armed = await page.textContent('.cancelov [data-cancel]');
    if (!/もう一度/.test(armed)) throw new Error('取り消しの確認が出ない: ' + armed);
    await page.click('.cancelov [data-cancel]');
    await page.waitForSelector('.points', { state: 'detached' });
    await page.waitForTimeout(300);
    const cm = g.api('state').data.matches.find(m => m.id === cmid);
    console.log('canceled match status:', cm.status, cm.note);
    if (cm.status !== 'void') throw new Error('試合が取り消されていない');
    await page.screenshot({ path: path.join(out, '21_after_cancel.png'), fullPage: true });
  }
  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close(); server.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
