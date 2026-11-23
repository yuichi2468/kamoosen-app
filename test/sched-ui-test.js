// 日程タブの動作確認: モックの Apps Script を HTTP で立て、ブラウザで操作する（日程調整 設計書）
// 実行: node test/sched-ui-test.js [スクリーンショット保存先]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadGas } = require('./gas-mock');

const out = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(out, { recursive: true });
const T0 = Date.parse('2026-11-25T10:30:00+09:00'); // サーバーの時計（11/25(水) 10時台）
const g = loadGas({ now: T0 - 3 * 3600000 });
g.setup();
const names = ['王者', '青木', '石田', '上野', '江藤', '大西', '加藤'];
names.forEach((n, i) => g.__sheets.players.appendRow([i === 0 ? 'A' : 'P' + String(i).padStart(2, '0'), n, '', i === 0 ? 1800 : '', true, '']));
const ok = r => { if (!r.ok) throw new Error(r.error); return r; };
const set = (pid, d, hs, o = {}) => ok(g.api('schedSet', Object.assign({ player_id: pid, items: hs.map(h => ({ date: d, hour: h })), device: 'seed' }, o)));
// 自分（青木）は前に参加。前回閉じたのはその直後
set('P01', '2026-11-25', [18, 19], { place: ['高原'] });
set('P01', '2026-11-26', [12]);
const closedAt = T0 - 2 * 3600000;
g.__setNow(T0 - 3600000);
// 閉じたあとに、ほかの人が参加（青木の参加している 11/25 18・19時台、11/26 12時台 → 新着4件）
set('P02', '2026-11-25', [18, 19, 20], { place: ['高原', '飛鳥井'], format: 'チーム戦', comment: '18時半ごろ着きます' });
set('P03', '2026-11-25', [18], { place: ['その他', '鴨川南'], place_other: '体育館' });
set('P03', '2026-11-25', [10, 11]);
set('P04', '2026-11-25', [10, 11], { format: '個人戦' });
set('P05', '2026-11-28', [14, 15, 16]);
set('P06', '2026-11-29', [14, 15]);
set('P02', '2026-11-26', [12]);
g.__setNow(T0);
// いま試合中の人（上野）
ok(g.api('start', { team1: ['P04'], team2: ['P05'], device: 'seed' }));

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const b = JSON.parse(body); const r = g.api(b.action, b.payload);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(r));
    }); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(html.replace("var API_URL = '';", "var API_URL = '/api';"));
});
const fail = m => { throw new Error(m); };
const slotsOf = pid => g.api('schedule').data.slots.filter(x => x.p === pid);
const keys = list => list.map(x => x.d.slice(5) + ' ' + x.h).sort();
const cell = (d, h) => '#schGrid td[data-sd="' + d + '"][data-sh="' + h + '"]';

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(c => { if (!localStorage.getItem('kamo_sched_closed')) localStorage.setItem('kamo_sched_closed', String(c)); }, closedAt);
  await page.goto(url);
  await page.waitForSelector('table');
  await page.click('nav button[data-tab=sched]');
  await page.waitForSelector('#schMe');
  await page.screenshot({ path: path.join(out, 's1_pick_me.png') });
  await page.selectOption('#schMe', 'P01');
  await page.waitForSelector('#schGrid');

  // 時間割: スマホは3日分。人数・自分の枠・新着の点・過ぎたマス・試合中（案B）
  if ((await page.$$('#schGrid thead th')).length !== 4) fail('スマホで3日分になっていない');
  if ((await page.textContent(cell('2026-11-25', 18))).trim() !== '3') fail('人数が違う: ' + await page.textContent(cell('2026-11-25', 18)));
  if (!(await page.$(cell('2026-11-25', 18) + '.mine .ndot'))) fail('自分の枠・新着の点が無い');
  if (!(await page.$(cell('2026-11-25', 9) + '.past'))) fail('過ぎたマスが灰色でない');
  // 試合中は江藤（参加済み）と大西（試合開始で自動追加。日程調整 設計書 16章）の2人
  if (!/^3試合中2/.test((await page.textContent(cell('2026-11-25', 10))).trim())) fail('いまのマスに試合中が出ない: ' + await page.textContent(cell('2026-11-25', 10)));
  if ((await page.textContent('[data-snew]')).trim() !== '新着 4件') fail('新着の件数: ' + await page.textContent('[data-snew]'));
  await page.screenshot({ path: path.join(out, 's2_grid.png'), fullPage: true });

  // 絞り込みには「絞り込み」の文字が付く
  if ((await page.textContent('.schfilter .schflabel')).trim() !== '絞り込み') fail('絞り込みのラベルが無い');
  // 新着 → 新着の一覧（マスごとにまとめて全部）。名前の前に緑の「新」
  await page.click('[data-snew]');
  await page.waitForSelector('.schsheet');
  if (!/新着 4件/.test(await page.textContent('.schsh'))) fail('新着の一覧が開かない: ' + await page.textContent('.schsh'));
  if ((await page.$$('.schsheet .newb')).length !== 4) fail('一覧に新着が全部出ない');
  const heads = await page.$$eval('.schsheet .schngh', l => l.map(x => x.textContent));
  if (heads.length !== 3 || !/^11\/25\(水\) 18時台/.test(heads[0]) || !/^11\/25\(水\) 19時台/.test(heads[1]) || !/^11\/26\(木\) 12時台/.test(heads[2])) fail('一覧のまとめ方: ' + JSON.stringify(heads));
  if (!/18時半/.test(await page.textContent('.schsheet'))) fail('一覧にひとことが出ない');
  await page.screenshot({ path: path.join(out, 's3a_news.png') });
  // 一覧のマスの見出し → そのマスの詳細。名前の前に緑の「新」。指定のある項目だけ枠で出す
  await page.click('.schsheet .schngh >> nth=0');
  await page.waitForSelector('[data-snewback]');
  if (!/11\/25\(水\) 18時台/.test(await page.textContent('.schsh'))) fail('一覧からマスが開かない');
  if ((await page.$$('.schsheet .newb')).length !== 2) fail('「新」が2人に付いていない');
  const det = await page.textContent('.schsheet');
  if (!/高原・飛鳥井/.test(det) || !/チーム戦/.test(det) || !/18時半/.test(det) || !/その他: 体育館・鴨川南|鴨川南・その他: 体育館/.test(det)) fail('詳細の項目: ' + det);
  const boxes = await page.$$eval('.schsheet .schbox', l => l.length);
  if (boxes !== 3) fail('指定のある項目だけ出ていない: ' + boxes);
  if (!/場所高原・飛鳥井\s*形式チーム戦\s*ひとこと18時半ごろ着きます/.test(await page.$eval('.schsheet .schpf >> nth=1', e => e.textContent).catch(() => ''))) fail('場所・形式・ひとことが1つの枠にない'); // 青木 高原 / 石田 チーム戦・高原飛鳥井・ひとこと / 上野? → 石田(P02)3 + 青木1 + 上野(P03)1
  await page.screenshot({ path: path.join(out, 's3_detail_new.png') });
  // 戻ると一覧のまま。閉じると全部「見た」扱い
  await page.click('[data-snewback]');
  if ((await page.$$('.schsheet .schngh')).length !== 3) fail('一覧に戻れない');
  await page.click('.schsheet .schx');
  if (await page.$('#schGrid .ndot')) fail('一覧を見たのに新着の点が残る');
  if (await page.$('[data-snew]')) fail('一覧を見たのに新着が残る');
  // 標準は「時間を選んで参加」。操作の注意書きは時間割の上
  if ((await page.getAttribute('[data-smode="pick"]', 'class')) !== 'on') fail('最初が「時間を選んで参加」になっていない');
  const hintBox = await page.locator('.schhint').boundingBox(), gridBox = await page.locator('#schGrid').boundingBox();
  if (!(hintBox.y < gridBox.y)) fail('注意書きが時間割の上にない');
  // タップで複数選択（詳細は開かない）→ 下の「参加登録」でまとめて登録
  for (const [d, h] of [['2026-11-26', 18], ['2026-11-26', 19], ['2026-11-26', 20], ['2026-11-27', 9]]) await page.click(cell(d, h));
  if (await page.$('.schsheet')) fail('タップで詳細が開いてしまう');
  if ((await page.$$('#schGrid td.sel')).length !== 4) fail('タップで選べない');
  await page.click(cell('2026-11-27', 9));
  if ((await page.$$('#schGrid td.sel')).length !== 3) fail('もう一度タップで外れない');
  await page.click(cell('2026-11-27', 9));
  await page.click(cell('2026-11-25', 9)); // 過ぎた時間は選べない（参加者を見せる）
  if ((await page.$$('#schGrid td.sel')).length !== 4) fail('過ぎた時間が選べてしまう');
  await page.click('.schsheet .schx');
  if (!/4時間を選択中/.test(await page.textContent('.schbar'))) fail('選択中の表示: ' + await page.textContent('.schbar'));
  await page.screenshot({ path: path.join(out, 's4a_pick.png') });
  await page.click('[data-sselgo]');
  await page.waitForSelector('.schsellist');
  const sl = await page.textContent('.schsellist');
  if (!/11\/26\(木\) 18〜20時台/.test(sl) || !/11\/27\(金\) 9時台/.test(sl)) fail('選んだ時間の表示: ' + sl);
  if (await page.$('[data-splace="どこでも"].on') === null) fail('最初は「どこでも」になっていない');
  await page.click('[data-splace="高原"]');
  await page.click('[data-splace="飛鳥井"]');
  if (await page.$('[data-splace="どこでも"].on')) fail('場所を選んでも「どこでも」が外れない');
  await page.click('[data-sformat="個人戦"]');
  await page.fill('#schComment', '初めてです');
  await page.click('[data-splace="その他"]');
  await page.fill('#schOther', '公園');
  if ((await page.inputValue('#schComment')) !== '初めてです') fail('場所を選ぶとひとことが消える');
  await page.screenshot({ path: path.join(out, 's4_join_form.png') });
  await page.click('[data-ssave]');
  await page.waitForSelector('.schsheet', { state: 'detached' });
  const j = slotsOf('P01').filter(x => (x.d === '2026-11-26' && x.h >= 18) || (x.d === '2026-11-27' && x.h === 9));
  if (j.length !== 4 || j.some(x => x.place !== '高原,飛鳥井,その他' || x.other !== '公園' || x.format !== '個人戦' || x.comment !== '初めてです')) fail('参加の内容: ' + JSON.stringify(j));
  if (!(await page.$(cell('2026-11-26', 19) + '.mine'))) fail('参加したマスが自分の枠にならない');
  if (await page.$('.schbar')) fail('登録したのに選択が残る');

  // 「参加者を見る」に切り替えると、タップで詳細。2回目は「新」が出ない
  await page.click('[data-smode="view"]');
  if (!/参加者が見られます/.test(await page.textContent('.schhint'))) fail('参加者を見るの注意書き');
  await page.click(cell('2026-11-25', 18));
  await page.waitForSelector('.schsheet');
  if (await page.$('.schsheet .newb')) fail('2回目にも「新」が出る');
  await page.click('.schsheet .schx');
  // 編集: 「どこでも」を押すと他が外れる。範囲を狭めると外した時間は取り消し
  await page.click(cell('2026-11-26', 19));
  await page.click('[data-sedit]');
  await page.waitForSelector('#schFrom');
  if ((await page.inputValue('#schFrom')) !== '18' || (await page.inputValue('#schTo')) !== '20') fail('編集のまとまりが 18〜20 になっていない');
  await page.click('[data-splace="どこでも"]');
  if ((await page.$$('.schchip.on')).length !== 1) fail('「どこでも」で他が外れない');
  await page.selectOption('#schTo', '19');
  await page.click('[data-ssave]');
  await page.waitForSelector('.schsheet', { state: 'detached' });
  const e2 = slotsOf('P01').filter(x => x.d === '2026-11-26' && x.h >= 18);
  if (e2.length !== 2 || e2.some(x => x.place !== 'どこでも' || x.format !== '個人戦')) fail('編集の結果: ' + JSON.stringify(e2));
  // 参加をやめる（詳細から1時間）
  await page.click(cell('2026-11-26', 19));
  await page.click('[data-sleave]');
  await page.waitForSelector('.schsheet', { state: 'detached' });
  if (slotsOf('P01').some(x => x.d === '2026-11-26' && x.h === 19)) fail('参加をやめられない');
  // 選んだ時間の参加をまとめてやめる（2回押す）
  await page.click('[data-smode="pick"]');
  await page.click(cell('2026-11-26', 18)); await page.click(cell('2026-11-27', 9));
  await page.click('[data-sselleave]');
  if (!/もう一度/.test(await page.textContent('[data-sselleave]'))) fail('取り消しの確認が出ない');
  await page.click('[data-sselleave]');
  await page.waitForSelector('.schbar', { state: 'detached' });
  if (slotsOf('P01').some(x => (x.d === '2026-11-26' && x.h === 18) || (x.d === '2026-11-27' && x.h === 9))) fail('まとめて参加をやめられない');

  // 長押ししてなぞる（スマホ）: 11/27 9〜12時台を選ぶだけ。登録画面は自動では出ず、選び終わってから「参加登録」
  await page.click('[data-sday="3"]');
  await page.waitForSelector(cell('2026-11-28', 9));
  await page.click('[data-sday="-3"]');
  await page.waitForSelector(cell('2026-11-27', 9));
  const center = async sel => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const a = await center(cell('2026-11-27', 9)), z = await center(cell('2026-11-27', 12));
  const touch = (type, p) => page.evaluate(([type, p, sel]) => {
    const el = type === 'touchstart' ? document.querySelector(sel) : document.elementFromPoint(p.x, p.y) || document.body;
    const t = new Touch({ identifier: 1, target: el, clientX: p.x, clientY: p.y });
    el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
  }, [type, p, cell('2026-11-27', 9)]);
  await touch('touchstart', a);
  await page.waitForTimeout(500);
  await touch('touchmove', { x: a.x, y: (a.y + z.y) / 2 });
  await touch('touchmove', z);
  if ((await page.$$('#schGrid td.drag')).length !== 4) fail('なぞった範囲が4マスにならない: ' + (await page.$$('#schGrid td.drag')).length);
  await page.screenshot({ path: path.join(out, 's5_drag.png') });
  await touch('touchend', z);
  if ((await page.$$('#schGrid td.sel')).length !== 4) fail('なぞった範囲が選択にならない');
  await page.waitForTimeout(1000);
  if (await page.$('.schsheet')) fail('なぞったあとに登録画面が自動で出る');
  await page.click('[data-sselgo]');
  await page.waitForSelector('.schsellist', { timeout: 2000 });
  if (!/11\/27\(金\) 9〜12時台/.test(await page.textContent('.schsellist'))) fail('なぞった範囲で開かない: ' + await page.textContent('.schsellist'));
  await page.click('[data-sclose].btn'); // 戻ると選択は残る
  if ((await page.$$('#schGrid td.sel')).length !== 4) fail('戻ると選択が消える');
  await page.click('[data-sselclear]');
  if ((await page.$$('#schGrid td.sel')).length !== 0) fail('選択を外せない');
  // 長押しせずに動かすと選ばない（スクロール）
  await touch('touchstart', a);
  await touch('touchmove', z);
  await touch('touchend', z);
  await page.waitForTimeout(800);
  if (await page.$('.schsheet') || (await page.$$('#schGrid td.sel')).length) fail('長押しなしでなぞると選ばれてしまう');

  // まとめて追加: 土日 × 18〜20時台（参加済みは飛ばす）
  await page.click('[data-sbulk]');
  await page.waitForSelector('.schdays');
  if ((await page.$$('.schday[disabled]')).length !== 1) fail('過ぎた日（11/24）が選べてしまう');
  await page.click('[data-sq="we"]');
  await page.selectOption('#sbFrom', '18');
  await page.selectOption('#sbTo', '20');
  const pv = await page.textContent('.schsheet .preview');
  if (!/4日 × 3時間 → 12マス/.test(pv)) fail('まとめて追加の件数: ' + pv);
  await page.screenshot({ path: path.join(out, 's6_bulk.png') });
  await page.click('[data-sbsave]');
  await page.waitForSelector('.schsheet', { state: 'detached' });
  if (slotsOf('P01').filter(x => ['2026-11-28', '2026-11-29', '2026-12-05', '2026-12-06'].includes(x.d)).length !== 12) fail('まとめて追加されていない');

  // 絞り込み: 場所「鴨川南」→ 11/25 18時台は「どこでも」以外の高原の人が外れる
  await page.selectOption('#schPlace', '鴨川南');
  if ((await page.textContent(cell('2026-11-25', 18))).trim() !== '1') fail('場所の絞り込み: ' + await page.textContent(cell('2026-11-25', 18)));
  await page.selectOption('#schPlace', '');
  await page.selectOption('#schFormat', '個人戦');
  if ((await page.textContent(cell('2026-11-25', 18))).trim() !== '2') fail('形式の絞り込み: ' + await page.textContent(cell('2026-11-25', 18)));
  await page.selectOption('#schFormat', '');
  await page.check('#schMineOnly');
  if ((await page.textContent(cell('2026-11-25', 20))).trim() !== '') fail('自分のみで、自分のいないマスが消えない');
  if ((await page.textContent(cell('2026-11-25', 18))).trim() !== '3') fail('自分のみで、自分のマスの数が変わる');
  await page.uncheck('#schMineOnly');

  // 案A: このメンバーで試合を始める（3人 → 選手選びで上に出す）
  await page.click('[data-smode="view"]');
  await page.click(cell('2026-11-25', 18));
  await page.click('[data-splay]');
  await page.waitForSelector('.schcands');
  await page.click('[data-teampick="1"]');
  await page.waitForSelector('.tpsec');
  const firstRows = await page.$$eval('.tplist .tprow .tpname', l => l.slice(0, 3).map(x => x.textContent));
  if (firstRows.sort().join() !== ['上野', '石田', '青木'].sort().join()) fail('参加者が上に出ない: ' + firstRows);
  await page.screenshot({ path: path.join(out, 's7_play_cands.png') });
  await page.click('#tpBack');
  // 2人なら 1vs1 でそのまま入る（11/26 12時台: 青木・石田）
  await page.click('nav button[data-tab=sched]');
  await page.waitForSelector('#schGrid');
  await page.click(cell('2026-11-26', 12));
  await page.click('[data-splay]');
  await page.waitForSelector('.schcands');
  const t1 = await page.textContent('[data-teampick="1"]'), t2 = await page.textContent('[data-teampick="2"]');
  if (!/青木/.test(t1) || !/石田/.test(t2)) fail('2人で1vs1に入らない: ' + t1 + ' / ' + t2);
  await page.screenshot({ path: path.join(out, 's8_play_pair.png') });

  // 広い画面は7日分
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.click('nav button[data-tab=sched]');
  await page.waitForSelector('#schGrid');
  if ((await page.$$('#schGrid thead th')).length !== 8) fail('広い画面で7日分になっていない');
  await page.screenshot({ path: path.join(out, 's9_wide.png'), fullPage: true });
  // パソコン: マウスでなぞる（11/30 14〜16時台）。「参加者を見る」でも、なぞると選択になる（登録画面は出ない）
  await page.waitForSelector(cell('2026-11-30', 14));
  const m0 = await center(cell('2026-11-30', 14)), m1 = await center(cell('2026-11-30', 16));
  await page.mouse.move(m0.x, m0.y); await page.mouse.down(); await page.mouse.move(m1.x, m1.y, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(1000);
  if (await page.$('.schsheet')) fail('マウスでなぞったあとに登録画面が自動で出る');
  if ((await page.getAttribute('[data-smode="pick"]', 'class')) !== 'on') fail('なぞると「時間を選んで参加」にならない');
  if ((await page.$$('#schGrid td.sel')).length !== 3) fail('マウスでなぞった範囲が選択にならない');
  await page.click('[data-sselgo]');
  await page.waitForSelector('.schsellist');
  if (!/11\/30\(月\) 14〜16時台/.test(await page.textContent('.schsellist'))) fail('マウスでなぞった範囲: ' + await page.textContent('.schsellist'));
  await page.click('[data-sclose].btn');
  await page.click('[data-sselclear]');

  // 運営画面で日程タブを非表示にすると、タブが消える（日程タブを開いていたらランキングに戻る）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('nav button[data-tab=sched]');
  await page.waitForSelector('#schGrid');
  // 持ち物（モルックのセット）: 登録画面のボタン → 時間割の ●・詳細の「セットあり N人」・絞り込み（設計書 15章）
  if ((await page.getAttribute('[data-smode="pick"]', 'class')) !== 'on') await page.click('[data-smode="pick"]');
  if (await page.$(cell('2026-11-25', 18) + ' .gdot')) fail('セットの無いマスに ● が出る');
  await page.click(cell('2026-11-27', 13)); await page.click(cell('2026-11-27', 14));
  await page.click('[data-sselgo]');
  await page.waitForSelector('[data-sgear="set"]');
  if ((await page.textContent('[data-sgear="set"][data-son="1"]')).trim() !== 'セットあり' || (await page.textContent('[data-sgear="set"][data-son="0"]')).trim() !== 'セットなし') fail('セットあり／なしの文言');
  if (!(await page.$('[data-sgear="set"][data-son="0"].on'))) fail('最初が「セットなし」になっていない');
  await page.click('[data-sgear="set"][data-son="1"]');
  if (!(await page.$('[data-sgear="set"][data-son="1"].on')) || await page.$('[data-sgear="set"][data-son="0"].on')) fail('「セットあり」を選べない');
  await page.click('[data-sgear="set"][data-son="0"]');
  if (!(await page.$('[data-sgear="set"][data-son="0"].on'))) fail('「セットなし」に戻せない');
  await page.click('[data-sgear="set"][data-son="1"]');
  await page.screenshot({ path: path.join(out, 's11_gear_form.png') });
  await page.click('[data-ssave]');
  await page.waitForSelector(cell('2026-11-27', 13) + ' .gdot');
  if (slotsOf('P01').filter(x => x.d === '2026-11-27').map(x => x.gear).join() !== 'set,set') fail('セットありが保存されない');
  await page.screenshot({ path: path.join(out, 's12_gear_grid.png'), fullPage: true });
  await page.click('[data-smode="view"]');
  await page.click(cell('2026-11-27', 13));
  await page.waitForSelector('.schsheet');
  if (!/セットあり 1人/.test(await page.textContent('.schgearn'))) fail('詳細に「セットあり N人」が出ない');
  if (!/セットあり/.test(await page.textContent('.schsheet .schpf'))) fail('参加者の枠に「セットあり」が出ない');
  await page.click('.schsheet .schx');
  // 試合開始で自動追加された人には「試合で追加」、セットのいないマスには「いません」（設計書 16章）
  await page.click(cell('2026-11-25', 10));
  await page.waitForSelector('.schsheet');
  if (!/大西[\s\S]*試合で追加/.test(await page.textContent('.schsheet'))) fail('「試合で追加」が出ない: ' + await page.textContent('.schsheet'));
  if ((await page.$$('.schsheet .schvia')).length !== 1) fail('「試合で追加」は自動で入った人だけ');
  if (!/セットを持っていく人がいません/.test(await page.textContent('.schsheet'))) fail('セットのいないマスの表示');
  await page.screenshot({ path: path.join(out, 's13_auto_join.png') });
  await page.click('.schsheet .schx');
  await page.check('#schGearOnly');
  if ((await page.textContent(cell('2026-11-25', 18))).trim() !== '') fail('セットありで絞っても、セットの無いマスに数字が出る');
  if (!/^1/.test((await page.textContent(cell('2026-11-27', 13))).trim())) fail('セットありで絞ると、セットのあるマスの数字が消える');
  await page.uncheck('#schGearOnly');
  await page.click('[data-smode="pick"]');

  const key = g.__sheets.settings.data.find(r => r[0] === 'admin_key')[1];
  await page.click('#adminBtn');
  await page.fill('#adminKey', String(key));
  await page.click('#adminLogin');
  await page.waitForSelector('#schedToggle');
  await page.screenshot({ path: path.join(out, 's10_admin_toggle.png'), fullPage: true });
  // 試合開始で日程に自動追加: する／しない
  await page.click('#schedAutoToggle');
  await page.waitForSelector('#schedAutoToggle[data-on="0"]');
  if (g.api('state').data.settings.sched_auto_join !== false) fail('自動追加を「しない」にできない');
  await page.click('#schedAutoToggle');
  await page.waitForSelector('#schedAutoToggle[data-on="1"]');
  await page.click('#schedToggle');
  await page.waitForSelector('#schedToggle[data-on="0"]');
  if (await page.isVisible('nav button[data-tab=sched]')) fail('非表示にしても日程タブが出ている');
  await page.click('#schedToggle');
  await page.waitForSelector('#schedToggle[data-on="1"]');
  if (!(await page.isVisible('nav button[data-tab=sched]'))) fail('表示に戻しても日程タブが出ない');
  ok(g.api('adminSetting', { admin_key: key, key: 'sched_visible', value: false }));
  await page.click('nav button[data-tab=sched]');
  await page.waitForSelector('#schGrid');
  await page.reload(); await page.waitForSelector('table');
  if (await page.isVisible('nav button[data-tab=sched]')) fail('読み込み直しても日程タブが出ている');

  console.log('page errors:', errors.length ? errors : 'none');
  console.log('日程の画面テスト: OK');
  await browser.close(); server.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
