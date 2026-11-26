// 実行: node test/test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadGas } = require('./gas-mock');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ' + name); } catch (e) { fail++; console.log('  NG  ' + name + '\n      ' + e.message); } }
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m);

const G = loadGas();
const cfg = { win_base: 24, win_coef: 0.06, loss_base: 20, loss_coef: 0.05, min_gain: 10, min_loss: 10, initial_rating: 1500 };

console.log('■ レート式（要項の例）');
t('1500 vs 1500 で勝ち +24 / 負け -20', () => eq(G.computeDelta(1500, 1500, cfg), { gain: 24, loss: 20 }));
t('1600 が 1400 に勝つ: +12 / -10', () => eq(G.computeDelta(1600, 1400, cfg), { gain: 12, loss: 10 }));
t('1400 が 1600 に勝つ: +36 / -30', () => eq(G.computeDelta(1400, 1600, cfg), { gain: 36, loss: 30 }));
t('四捨五入: 差 25 → 24-1.5=22.5 → 23', () => eq(G.computeDelta(1525, 1500, cfg).gain, 23));
t('四捨五入: 負け 20+0.5=20.5 → 21', () => eq(G.computeDelta(1500, 1510, cfg).loss, 20 + 1)); // 20+(1510-1500)*0.05=20.5

console.log('■ 下限 ±10');
t('勝ちは最低+10（1800 が 1500 に勝つ: 式は+6）', () => eq(G.computeDelta(1800, 1500, cfg).gain, 10));
t('負けは最低-10（1500 が 1800 に負ける: 式は-5）', () => eq(G.computeDelta(1800, 1500, cfg).loss, 10));
t('1300 が 1800 に負けても増えない（-10）', () => eq(G.computeDelta(1800, 1300, cfg).loss, 10));
t('境界: 勝ち 差241 → 9.54→10、差242→9.48→下限10', () => { eq(G.computeDelta(1741, 1500, cfg).gain, 10); eq(G.computeDelta(1742, 1500, cfg).gain, 10); eq(G.computeDelta(1700, 1500, cfg).gain, 12); });

console.log('■ チーム戦・A固定・順番');
const players = [
  { player_id: 'A', name: '王者', fixed_rating: 1800, initial_rating: '' },
  { player_id: 'p1', name: 'あ', initial_rating: '' },
  { player_id: 'p2', name: 'い', initial_rating: 1525 },
  { player_id: 'p3', name: 'う', initial_rating: '' },
  { player_id: 'p4', name: 'え', initial_rating: '' },
];
const T = s => Date.parse(s);
t('初期レート: 空欄は1500、入力値はそのまま', () => {
  const r = G.computeRatings(players, [], cfg);
  eq([r.ratings.p1, r.ratings.p2, r.ratings.A], [1500, 1525, 1800]);
});
t('1vs3 平均で計算し全員に同額（人数補正なし）', () => {
  const ps = [{ player_id: 'x', name: 'x', initial_rating: 1700 }, { player_id: 'a', name: 'a', initial_rating: 1500 }, { player_id: 'b', name: 'b', initial_rating: 1450 }, { player_id: 'c', name: 'c', initial_rating: 1400 }];
  const m = [{ match_id: 'm1', started_at: T('2026-11-25T10:00:00+09:00'), team1_ids: 'x', team2_ids: 'a,b,c', winner: 2, status: 'done' }];
  const r = G.computeRatings(ps, m, cfg);
  // 平均 1700 vs 1450、3人側勝ち: +24+250*0.06=39 / -(20+250*0.05)=-32.5→-33
  eq([r.ratings.x, r.ratings.a, r.ratings.b, r.ratings.c], [1667, 1539, 1489, 1439]);
  eq(r.stats.a, { matches: 1, team_matches: 1, wins: 1, losses: 0 });
});
t('A は1800固定で変動せず、相手は通常計算（1500がAに勝つと+42）', () => {
  const m = [{ match_id: 'm1', started_at: 1, team1_ids: 'p1', team2_ids: 'A', winner: 1, status: 'done' }];
  const r = G.computeRatings(players, m, cfg);
  eq([r.ratings.p1, r.ratings.A], [1542, 1800]);
});
t('A に負けると最低 -10', () => {
  const m = [{ match_id: 'm1', started_at: 1, team1_ids: 'p1', team2_ids: 'A', winner: 2, status: 'done' }];
  eq(G.computeRatings(players, m, cfg).ratings.p1, 1490);
});
t('A を含むチームは A を1800として平均', () => {
  const m = [{ match_id: 'm1', started_at: 1, team1_ids: 'A,p1', team2_ids: 'p3,p4', winner: 1, status: 'done' }];
  const r = G.computeRatings(players, m, cfg); // 平均1650 vs 1500 → +15 / -(20-7.5)=12.5→13
  eq([r.ratings.A, r.ratings.p1, r.ratings.p3], [1800, 1515, 1487]);
});
t('参考レート: 1500 に負けた A は、1800 から変動した場合 -35（公式は1800のまま）', () => {
  const m = [{ match_id: 'm1', started_at: 1, team1_ids: 'p1', team2_ids: 'A', winner: 1, status: 'done' }];
  const r = G.computeRatings(players, m, cfg);
  eq([r.ratings.A, r.virtual.A, r.ratings.p1], [1800, 1765, 1542]); // -(20+300*0.05)=-35
  eq(r.virtualHistory.A, [{ match_id: 'm1', at: 1, delta: -35, rating: 1765 }]);
  eq(r.history.A[0].delta, 0);
});
t('参考レートは前の試合の参考レートで次を計算し、組んだ試合では味方・相手の計算にも参考レートを使う', () => {
  // m1: A が p1 に負け → 参考1765。m2: A(参考1765) が p3 に負け → -(20+265*0.05)=-33.25→-33 → 1732
  const ms = [
    { match_id: 'm1', started_at: 1, team1_ids: 'p1', team2_ids: 'A', winner: 1, status: 'done' },
    { match_id: 'm2', started_at: 2, team1_ids: 'p3', team2_ids: 'A', winner: 1, status: 'done' },
    { match_id: 'm3', started_at: 3, team1_ids: 'A,p1', team2_ids: 'p4,p2', winner: 1, status: 'done' },
  ];
  const r = G.computeRatings(players, ms, cfg);
  // m1・m2（1vs1）は固定1800で計算。m3（A が p1 と組む）は A を参考1732 として平均:
  // (1732+1542)/2=1637 vs (1500+1525)/2=1512.5 → 差124.5 → 勝ち +24-7.47=16.53→17 / 負け -(20-6.225)=-13.775→-14
  eq([r.ratings.A, r.ratings.p1, r.ratings.p3, r.ratings.p4, r.ratings.p2], [1800, 1559, 1542, 1486, 1511]);
  eq(r.deltas.m3, { team1: 17, team2: -14, avg1: 1637, avg2: 1512.5 });
  eq(r.virtualHistory.A.map(x => x.rating).slice(0, 2), [1765, 1732]);
  eq(r.virtual.A, 1749); // 参考レートも同じ平均で +17
});
t('鴨王が1人のチーム（1人vs複数）は、参考レートが下がっていても固定レートで計算', () => {
  const ms = [
    { match_id: 'm1', started_at: 1, team1_ids: 'p1', team2_ids: 'A', winner: 1, status: 'done' }, // A 参考 1765
    { match_id: 'm2', started_at: 2, team1_ids: 'A', team2_ids: 'p3,p4', winner: 2, status: 'done' },
  ];
  const r = G.computeRatings(players, ms, cfg);
  // m2: 1800 vs 1500 → p3,p4 勝ち +24+18=42
  eq(r.deltas.m2, { team1: -35, team2: 42, avg1: 1800, avg2: 1500 });
  eq([r.ratings.A, r.ratings.p3, r.ratings.p4], [1800, 1542, 1542]);
  // 参考レートは 1765 vs 1500 で -(20+265*0.05)=-33.25→-33
  eq(r.virtual.A, 1732);
});
t('鴨王が組んだチームの相手も、鴨王の参考レートで出した平均と比べて計算', () => {
  const ms = [
    { match_id: 'm1', started_at: 1, team1_ids: 'p1', team2_ids: 'A', winner: 1, status: 'done' }, // A 参考 1765
    { match_id: 'm2', started_at: 2, team1_ids: 'p3,p4', team2_ids: 'A,p2', winner: 1, status: 'done' },
  ];
  const r = G.computeRatings(players, ms, cfg);
  // m2: 1500 vs (1765+1525)/2=1645 → p3,p4 勝ち +24+8.7=32.7→33 / A側 -(20+7.25)=-27.25→-27
  eq(r.deltas.m2, { team1: 33, team2: -27, avg1: 1500, avg2: 1645 });
  eq([r.ratings.A, r.ratings.p2, r.ratings.p3], [1800, 1498, 1533]);
  eq(r.virtual.A, 1738);
});
t('参考レートの開始値を設定すると、その値から変動する（公式は変わらない）', () => {
  const m = [{ match_id: 'm1', started_at: 1, team1_ids: 'p1', team2_ids: 'A', winner: 1, status: 'done' }];
  const r = G.computeRatings(players, m, Object.assign({}, cfg, { virtual_initial_rating: 1500 }));
  // 1500 同士 → A は -20
  eq([r.ratings.A, r.virtual.A, r.ratings.p1], [1800, 1480, 1542]);
  eq(G.computeRatings(players, m, Object.assign({}, cfg, { virtual_initial_rating: '' })).virtual.A, 1765);
});
t('参考レートはレート固定の人だけ', () => {
  const r = G.computeRatings(players, [], cfg);
  eq(Object.keys(r.virtual), ['A']); eq(r.virtual.A, 1800);
});
t('開始時刻順に計算（入力順が逆でも同じ）', () => {
  const m1 = { match_id: 'm1', started_at: T('2026-11-25T10:00:00+09:00'), team1_ids: 'p1', team2_ids: 'p3', winner: 1, status: 'done' };
  const m2 = { match_id: 'm2', started_at: T('2026-11-25T11:00:00+09:00'), team1_ids: 'p1', team2_ids: 'p4', winner: 2, status: 'done' };
  const a = G.computeRatings(players, [m1, m2], cfg), b = G.computeRatings(players, [m2, m1], cfg);
  // m1: p1 +24 → 1524. m2: p4(1500) が p1(1524) に勝つ: +24+1.44=25.44→25 / p1 -(20+1.2)=-21.2→-21
  eq([a.ratings.p1, a.ratings.p4], [1503, 1525]);
  eq(a.ratings, JSON.parse(JSON.stringify(b.ratings)));
});
t('void と playing は計算に入らない', () => {
  const m = [{ match_id: 'm1', started_at: 1, team1_ids: 'p1', team2_ids: 'p3', winner: 1, status: 'void' }, { match_id: 'm2', started_at: 2, team1_ids: 'p1', team2_ids: 'p3', winner: '', status: 'playing' }];
  eq(G.computeRatings(players, m, cfg).ratings.p1, 1500);
});

console.log('■ 入力チェック');
const scfg = Object.assign({}, cfg, { start_at: T('2026-11-24T07:00:00+09:00'), end_at: T('2026-12-07T21:00:00+09:00'), max_team_size: 4, max_singles_vs_same: 3 });
const now = T('2026-11-25T10:00:00+09:00');
t('開始前・締切後は開始不可', () => {
  assert(G.validateStart(['p1'], ['p3'], players, [], scfg, T('2026-11-24T06:59:00+09:00')));
  assert(G.validateStart(['p1'], ['p3'], players, [], scfg, T('2026-12-07T21:00:00+09:00')));
  assert.strictEqual(G.validateStart(['p1'], ['p3'], players, [], scfg, T('2026-12-07T20:59:59+09:00')), null);
});
t('5人チーム・同じ人が両チームは不可', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map(id => ({ player_id: id, name: id }));
  assert(G.validateStart(['a', 'b', 'c', 'd', 'e'], ['p1'], players.concat(many), [], scfg, now));
  assert(G.validateStart(['p1'], ['p1'], players, [], scfg, now));
});
t('同一相手の1vs1は3試合まで（Aも対象、チーム戦は対象外）', () => {
  const ms = [1, 2, 3].map(i => ({ match_id: 'm' + i, started_at: i, team1_ids: 'p1', team2_ids: 'A', winner: 1, status: 'done' }));
  assert(G.validateStart(['A'], ['p1'], players, ms, scfg, now));
  assert.strictEqual(G.validateStart(['A', 'p3'], ['p1'], players, ms, scfg, now), null);
  ms[2].status = 'void';
  assert.strictEqual(G.validateStart(['A'], ['p1'], players, ms, scfg, now), null);
});
t('試合中の人は新しい試合を始められない', () => {
  const ms = [{ match_id: 'm1', started_at: 1, team1_ids: 'p1', team2_ids: 'p3', status: 'playing' }];
  assert(G.validateStart(['p1'], ['p4'], players, ms, scfg, now));
});
t('結果は2本先取', () => {
  assert.strictEqual(G.validateResult(2, 1), null);
  assert.strictEqual(G.validateResult(0, 2), null);
  assert(G.validateResult(2, 2)); assert(G.validateResult(1, 1)); assert(G.validateResult(3, 0));
});

console.log('■ 順位表');
t('参加条件未達は通過圏外、A は順位表に出ない、上位8名に印', () => {
  const ps = [{ player_id: 'A', name: 'A', fixed_rating: 1800 }];
  for (let i = 0; i < 10; i++) ps.push({ player_id: 'q' + i, name: 'q' + i, initial_rating: 1600 - i * 10 });
  const res = G.computeRatings(ps, [], cfg);
  // 全員の試合数を条件以上にしたことにする（q0 だけ未達）
  Object.keys(res.stats).forEach(k => { res.stats[k] = { matches: 20, team_matches: 5, wins: 0, losses: 0 }; });
  res.stats.q0 = { matches: 19, team_matches: 5, wins: 0, losses: 0 };
  const rows = G.buildRanking(ps, res, {}, { min_matches: 20, min_team_matches: 5, qualify_count: 8 });
  eq(rows.length, 10);
  eq(rows[0].player_id, 'q0'); eq(rows[0].qualify_zone, false);
  eq(rows.filter(r => r.qualify_zone).map(r => r.player_id), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
});
t('最低条件の既定は 15試合・うちチーム戦 5試合（settings が空欄のとき）', () => {
  const ps = [{ player_id: 'a', name: 'a', initial_rating: 1500 }, { player_id: 'b', name: 'b', initial_rating: 1500 }, { player_id: 'c', name: 'c', initial_rating: 1500 }];
  const res = G.computeRatings(ps, [], cfg);
  res.stats.a = { matches: 15, team_matches: 5, wins: 0, losses: 0 };
  res.stats.b = { matches: 14, team_matches: 5, wins: 0, losses: 0 };
  res.stats.c = { matches: 15, team_matches: 4, wins: 0, losses: 0 };
  const rows = G.buildRanking(ps, res, {}, {});
  const el = {}; rows.forEach(r => { el[r.player_id] = r.eligible; });
  eq(el, { a: true, b: false, c: false });
});

t('同点の並び: 合計→レート→試合数', () => {
  const ps = [{ player_id: 'a', name: 'a', initial_rating: 1500 }, { player_id: 'b', name: 'b', initial_rating: 1510 }, { player_id: 'c', name: 'c', initial_rating: 1500 }];
  const res = G.computeRatings(ps, [], cfg);
  res.stats.a.matches = 25; res.stats.c.matches = 22;
  const rows = G.buildRanking(ps, res, { a: 10 }, { min_matches: 0, min_team_matches: 0, qualify_count: 8 });
  eq(rows.map(r => r.player_id), ['b', 'a', 'c']); // 合計は a=1500+10, b=1510 で同点 → レートが高い b が上。c は合計で下
});

console.log('■ スプレッドシート連携（モック）');
t('初期設定 → 開始 → 結果 → 確認 → ランキングシート', () => {
  const g = loadGas();
  g.setup();
  const sh = g.__sheets;
  sh.players.appendRow(['A', '王者', '', 1800, true]);
  sh.players.appendRow(['p1', 'あ', '', '', true]);
  sh.players.appendRow(['p2', 'い', 1550, '', true]);
  sh.players.appendRow(['p3', 'う', '', '', true]);
  // 記録者の選択なしで開始できる（端末記号だけ log に残る）
  let r = g.api('start', { team1: ['p1'], team2: ['p2'], device: 'abc123' });
  eq(r.ok, true, r.error);
  const mid = r.data.matches[0].id;
  r = g.api('result', { match_id: mid, team1_legs: 2, team2_legs: 2}); eq(r.ok, false);
  g.__advance(20 * 60000);
  r = g.api('result', { match_id: mid, team1_legs: 2, team2_legs: 1, team1_score: 95, team2_score: 80});
  eq(r.ok, true, r.error);
  eq(r.data.players.find(p => p.id === 'p1').rating, 1527); // 24+50*0.06=27
  eq(r.data.players.find(p => p.id === 'p2').rating, 1527); // -(20+50*0.05)=-22.5→-23
  eq(sh.log.data.some(row => row[1] === 'start' && row[2] === '端末abc123'), true);
  r = g.api('confirm', { match_id: mid }); eq(r.ok, false); // 確認機能はなくなった
  const rk = sh.ranking.data;
  eq(rk[0][0], 'rank'); eq(rk.length, 4); // 見出し + 3人（A は除外）
  const mrow = sh.matches.data[1];
  eq([mrow[13], mrow[14]], [27, -23]);
  // 運営: 無効化と復元
  r = g.api('adminVoid', { admin_key: 'x', match_id: mid }); eq(r.ok, false);
  r = g.api('adminVoid', { admin_key: 'change-me', match_id: mid }); eq(r.ok, true, r.error);
  eq(r.data.players.find(p => p.id === 'p1').rating, 1500);
  r = g.api('adminRestore', { admin_key: 'change-me', match_id: mid }); eq(r.data.players.find(p => p.id === 'p1').rating, 1527);
  // 開始取り消し
  r = g.api('start', { team1: ['p3'], team2: ['A']}); eq(r.ok, true, r.error);
  r = g.api('cancel', { match_id: r.data.matches[0].id}); eq(r.ok, true, r.error);
  eq(r.data.matches[0].status, 'void');
  // 締切
  g.__setNow(Date.parse('2026-12-07T21:00:00+09:00'));
  r = g.api('start', { team1: ['p3'], team2: ['A']}); eq(r.ok, false); eq(r.error, '試合開始の締切を過ぎています');
});
t('参考レートの表示は運営画面から切り替えられる（settings に行が無くても足す）', () => {
  const g = loadGas();
  g.setup();
  g.__sheets.players.appendRow(['A', '王者', '', 1800, true]);
  g.__sheets.players.appendRow(['p1', 'あ', '', '', true]);
  let r = g.api('start', { team1: ['p1'], team2: ['A'] }); eq(r.ok, true, r.error);
  r = g.api('result', { match_id: r.data.matches[0].id, team1_legs: 2, team2_legs: 0 }); eq(r.ok, true, r.error);
  let a = r.data.players.find(p => p.id === 'A');
  eq([a.rating, a.virtual_rating, r.data.settings.virtual_rating_visible], [1800, 1765, true]);
  eq(r.data.virtual_history.A.length, 1);
  // 既存のシートで行が無い場合も、運営画面から切り替えると行が足される
  const st = g.__sheets.settings;
  const i = st.data.findIndex(row => row[0] === 'virtual_rating_visible'); st.data.splice(i, 1);
  r = g.api('adminSetting', { admin_key: 'x', key: 'virtual_rating_visible', value: false }); eq(r.ok, false);
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'admin_key', value: false }); eq(r.ok, false);
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'virtual_rating_visible', value: false }); eq(r.ok, true, r.error);
  a = r.data.players.find(p => p.id === 'A');
  eq([a.rating, a.virtual_rating === undefined ? null : a.virtual_rating, r.data.settings.virtual_rating_visible, r.data.virtual_history], [1800, null, false, {}]);
  eq(st.data.filter(row => row[0] === 'virtual_rating_visible').map(row => row[1]), [false]);
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'virtual_rating_visible', value: true }); eq(r.ok, true, r.error);
  eq(r.data.players.find(p => p.id === 'A').virtual_rating, 1765);
  eq(st.data.filter(row => row[0] === 'virtual_rating_visible').map(row => row[1]), [true]);
  // 開始値: 0〜5000 の整数だけ。空欄で固定レートに戻る
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'virtual_initial_rating', value: '15.5' }); eq(r.ok, false);
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'virtual_initial_rating', value: '9999' }); eq(r.ok, false);
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'virtual_initial_rating', value: '1500' }); eq(r.ok, true, r.error);
  eq([r.data.settings.virtual_initial_rating, r.data.players.find(p => p.id === 'A').virtual_rating, r.data.players.find(p => p.id === 'A').rating], [1500, 1480, 1800]);
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'virtual_initial_rating', value: '' }); eq(r.ok, true, r.error);
  eq([r.data.settings.virtual_initial_rating, r.data.players.find(p => p.id === 'A').virtual_rating], [null, 1765]);
  // 参考合計: 参考レート＋ボーナス、最低試合数（空欄なら min_matches=15）
  a = r.data.players.find(p => p.id === 'A');
  eq([a.virtual_total.total, a.virtual_total.bonus, a.virtual_total.matches, a.virtual_total.min, a.virtual_total.eligible, r.data.settings.virtual_min_matches],
     [1765 + r.data.extra_bonus.A.total, r.data.extra_bonus.A.total, 1, 15, false, 15]);
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'virtual_min_matches', value: '1.5' }); eq(r.ok, false);
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'virtual_min_matches', value: '1' }); eq(r.ok, true, r.error);
  a = r.data.players.find(p => p.id === 'A');
  eq([a.virtual_total.min, a.virtual_total.eligible, r.data.settings.virtual_min_matches, r.data.settings.virtual_min_matches_raw], [1, true, 1, 1]);
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'virtual_min_matches', value: '' }); eq(r.ok, true, r.error);
  eq(r.data.players.find(p => p.id === 'A').virtual_total.min, 15);
  // 参考レートを隠すと、参考合計と鴨王のボーナスも出さない
  r = g.api('adminSetting', { admin_key: 'change-me', key: 'virtual_rating_visible', value: false }); eq(r.ok, true, r.error);
  a = r.data.players.find(p => p.id === 'A');
  eq([a.virtual_total === undefined, r.data.extra_bonus.A === undefined, r.data.extra_bonus.p1 !== undefined], [true, true, true]);
});
t('締切前に開始した試合は 21:00 以降も結果入力できる', () => {
  const g = loadGas({ now: Date.parse('2026-12-07T20:59:00+09:00') });
  g.setup();
  g.__sheets.players.appendRow(['p1', 'あ', '', '', true]);
  g.__sheets.players.appendRow(['p2', 'い', '', '', true]);
  let r = g.api('start', { team1: ['p1'], team2: ['p2']}); eq(r.ok, true, r.error);
  g.__setNow(Date.parse('2026-12-07T21:20:00+09:00'));
  r = g.api('result', { match_id: r.data.matches[0].id, team1_legs: 1, team2_legs: 2}); eq(r.ok, true, r.error);
});

console.log('■ 1投ごとのスコア計算');
const N = (...pins) => ({ kind: 'normal', pins });
const MISS = { kind: 'miss' }, FOUL = { kind: 'foul' };
const M1 = { team1: ['a'], team2: ['b'], first_team: 1, use_order: false };
// チーム1が 12,12,12,12 → 48、チーム2 は 1 ずつ。最後に 2 で 50
const legWin1 = [N(12), N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(2)];
t('得点は 1〜12 の点数をそのまま使う（範囲外はエラー）', () => {
  const st = G.molkkyReplay(M1, [{ kind: 'normal', points: 7 }, { kind: 'normal', points: 12 }]);
  eq([st.scores[0], st.scores[1]], [7, 12]);
  assert(G.molkkyReplay(M1, [{ kind: 'normal', points: 13 }]).error);
  assert(G.molkkyReplay(M1, [{ kind: 'normal', points: 0 }]).error);
});
t('得点: 1本ならその数字、2本以上は本数', () => {
  const st = G.molkkyReplay(M1, [N(7), N(1, 2, 3)]);
  eq([st.scores[0], st.scores[1]], [7, 3]);
});
t('ちょうど50で本を取り、2本目は1本目の後攻チームが先攻', () => {
  const st = G.molkkyReplay(M1, legWin1);
  eq([st.legsWon[0], st.legsWon[1], st.leg, st.nextTeam], [1, 0, 2, 2]);
  eq(st.legScores[0], [50, 4]);
});
t('50を超えたら25に戻る', () => {
  const st = G.molkkyReplay(M1, [N(12), N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(5)]);
  eq(st.scores[0], 25); eq(st.log[8].event, 'bust');
});
t('3回連続ミスで失格、相手は50点・失格したチームは0点（ファウルもミス）', () => {
  const st = G.molkkyReplay(M1, [N(10), N(7), N(3), MISS, N(4), FOUL, N(2), MISS]);
  eq(st.log[7].score_after, 0);
  eq([st.legsWon[0], st.legsWon[1]], [1, 0]);
  eq(st.legScores[0], [50, 0]);
  eq(st.log[7].event, 'out');
});
t('得点すると連続ミスは0に戻る', () => {
  const st = G.molkkyReplay(M1, [MISS, N(1), MISS, N(1), N(2), N(1), MISS]);
  eq(st.misses[0], 1);
});
t('1-1 なら3本目の先攻が決まるまで投げられない／総得点の高い方が選ぶ', () => {
  // 1本目: チーム1が 50-4。2本目（チーム2先攻）: チーム2が 50、チーム1は 1x4=4
  const leg2 = [N(12), N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(2)];
  const st = G.molkkyReplay(M1, legWin1.concat(leg2));
  eq([st.legsWon[0], st.legsWon[1], st.needSetup, st.needFirst], [1, 1, true, true]);
  eq([st.totals[0], st.totals[1], st.leg3Chooser], [54, 54, 0]); // 同点→ドローショット
  const bad = G.molkkyReplay(M1, legWin1.concat(leg2, [N(3)]));
  assert(bad.error);
  const ok = G.molkkyReplay(Object.assign({}, M1, { leg3_first: 2 }), legWin1.concat(leg2, [N(3)]));
  eq([ok.error, ok.scores[1]], [null, 3]);
});
t('2-0 で試合終了、それ以降の投擲はエラー', () => {
  const leg2 = [N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(2)]; // 2本目はチーム2先攻、チーム1が50
  const st = G.molkkyReplay(M1, legWin1.concat(leg2));
  eq([st.finished, st.winner, st.legsWon[0], st.legsWon[1]], [true, 1, 2, 0]);
  assert(G.molkkyReplay(M1, legWin1.concat(leg2, [N(1)])).error);
});
t('個人の投擲順: チームごとに独立して回る（1vs3）', () => {
  const m = { team1: ['a'], team2: ['x', 'y', 'z'], first_team: 2, use_order: true };
  const st = G.molkkyReplay(m, [N(1), N(1), N(1), N(1), N(1)]);
  eq(st.log.map(r => r.player), ['x', 'a', 'y', 'a', 'z']);
  eq(st.nextPlayer, 'a');
});
t('個人の投擲順: 2本目は選び直すまで投げられず、選んだ順の1番目から', () => {
  const m = { team1: ['a', 'b'], team2: ['x', 'y'], first_team: 1, use_order: true };
  const st = G.molkkyReplay(m, legWin1);
  eq([st.needSetup, st.needOrder, st.needFirst], [true, true, false]);
  eq(st.orders[1], [['a', 'b'], ['x', 'y']]); // 前の本の順番が初期値
  const m2 = Object.assign({}, m, { leg_orders: [null, [['b', 'a'], ['y', 'x']]] });
  const st2 = G.molkkyReplay(m2, legWin1.concat([N(1), N(1), N(1)]));
  eq(st2.log.slice(9).map(r => r.player), ['y', 'b', 'x']); // 2本目はチーム2先攻
});
t('投擲順なしなら2本目は自動で始まる', () => {
  const st = G.molkkyReplay(M1, legWin1.concat([N(1)]));
  eq([st.error, st.log[9].team, st.log[9].player], [null, 2, '']);
});
t('個人戦（投擲順あり）は2セット目の投擲順の選び直しが不要で、投げた人が記録される', () => {
  const m = { team1: ['a'], team2: ['b'], first_team: 1, use_order: true };
  const st = G.molkkyReplay(m, legWin1.concat([N(1)]));
  eq([st.error, st.needSetup, st.log[0].player, st.log[9].player], [null, false, 'a', 'b']);
});
t('個人戦は use_order を送らなくても投擲成績を記録する設定で始まる', () => {
  const g = loadGas(); g.setup();
  ['p1', 'p2'].forEach((id, i) => g.__sheets.players.appendRow([id, '選手' + i, '', '', true]));
  const r = g.api('start', { team1: ['p1'], team2: ['p2'], scoring: 'throws', first_team: 1, device: 'd' });
  eq([r.ok, r.data.matches[0].use_order], [true, true]);
});
t('個人成績の集計（無効試合は除外）', () => {
  const rows = [
    { match_id: 'm1', player_id: 'a', kind: 'normal', points: 12, event: '' },
    { match_id: 'm1', player_id: 'a', kind: 'miss', points: 0, event: '' },
    { match_id: 'm1', player_id: 'a', kind: 'normal', points: 2, event: 'win' },
    { match_id: 'm2', player_id: 'a', kind: 'normal', points: 9, event: '' },
    { match_id: 'm1', player_id: '', kind: 'normal', points: 5, event: '' }];
  const x = G.computeThrowStats(rows, { m1: true });
  eq(JSON.parse(JSON.stringify(x)), { a: { throws: 3, points: 14, misses: 1, wins: 1, busts: 0, hits: 2, hit_rate: 66.7 } });
});
t('投擲順はチームのメンバーの並べ替えでなければならない', () => {
  assert.strictEqual(G.validateLegOrders([null, [['b', 'a'], ['x']]], ['a', 'b'], ['x']), null);
  assert(G.validateLegOrders([null, [['a', 'c'], ['x']]], ['a', 'b'], ['x']));
});

console.log('■ 特別賞');
{
  const pl = [['A', '王者', '', 1800, true, ''], ['p1', 'P1', '', '', true, ''], ['p2', 'P2', '', '', true, 'TRUE'], ['p3', 'P3', '', '', true, ''], ['p4', 'P4', '', '', true, 'TRUE']]
    .map(r => ({ player_id: r[0], name: r[1], initial_rating: r[2], fixed_rating: r[3], active: r[4], rookie: r[5] }));
  let n = 0;
  const M = (t1, t2, l1, l2, s1, s2, extra) => Object.assign({ match_id: 'm' + (++n), started_at: 1000 + n, team1_ids: t1, team2_ids: t2, team1_legs: l1, team2_legs: l2,
    team1_score: s1 === undefined ? '' : s1, team2_score: s2 === undefined ? '' : s2, winner: l1 > l2 ? 1 : 2, status: 'done', scoring: 'manual' }, extra || {});
  const ms = [M('p1', 'p2', 2, 0, 100, 30), M('p1', 'A', 2, 1, 140, 120), M('p1,p3', 'p2,p4', 2, 0, 100, 40), M('p2', 'p3', 0, 2), M('p4', 'p1', 2, 1, 130, 110),
    M('p2', 'p3', 2, 0, 0, 0, { status: 'void' })];
  const c = Object.assign({}, cfg, { min_matches: 3, min_team_matches: 1, memorial_step: 2 });
  const res = G.computeRatings(pl, ms, c);
  const rk = G.buildRanking(pl, res, {}, c);
  const aw = G.computeAwards(pl, ms, res, rk, c);
  const get = k => aw.awards.find(a => a.key === k).entries.map(e => [e.rank, e.player_id, e.value]);
  t('横綱賞は廃止', () => eq(aw.awards.some(a => a.key === 'yokozuna'), false));
  t('ジャイキリ賞: 格上に勝った最大レート差。王者との試合は数えない', () => eq(get('giantkill'), [[1, 'p4', 104]]));
  t('レート差の賞は試合当時のレートを出す', () => {
    eq(aw.awards.find(a => a.key === 'giantkill').entries[0].detail.replace(/^\S+ /, ''), 'vs P1 2-1（当時のレート 1482 vs 1586）');
    eq(aw.awards.find(a => a.key === 'kamonegi').entries[1].detail.includes('当時のレート・チーム平均 1490 vs 1532.5'), true);
  });
  t('カモネギ賞: 格上に挑んで負けた最大レート差（チームは平均）', () => eq(get('kamonegi'), [[1, 'p2', 59], [2, 'p4', 42.5]]));
  t('連勝王: 開始順の最長連勝。無効試合は数えない', () => eq(get('streak'), [[1, 'p1', 3], [2, 'p3', 2], [3, 'p4', 1]]));
  t('暫定の印: 最低条件 未達の人だけ provisional', () => eq(aw.awards.find(a => a.key === 'mvp').entries.map(e => e.provisional), [false, false, true]));
  t('MVP賞: 最低条件を満たした人の勝率（王者は対象外）', () => eq(get('mvp'), [[1, 'p1', 75], [2, 'p2', 0], [3, 'p3', 100]])); // 最低条件を満たした人が先、未達の人は暫定として続く
  t('平均得点王: 得点のある試合だけで 1セットあたり', () => eq(get('avgscore'), [[1, 'p1', 45], [2, 'p2', 17.5], [3, 'p3', 50]])); // p1: 450点/10セット、p2: 70点/4セット
  t('ルーキー賞: 1回生を、最低条件を満たした人から順位順に', () => eq(get('rookie').map(x => x[1]), ['p2', 'p4']));
  t('ジェットコースター賞: 最高と最低の差', () => eq(get('coaster')[0], [1, 'p1', 86]));
  t('メモリアル賞: 大会全体の通し番号の区切りの勝者', () => eq(aw.memorial.entries.map(e => [e.n, e.ids]), [[2, ['p1']], [4, ['p3']]]));
  t('平均得点王: 1投ごとの記録はセット終了時の得点（3ミス失格は0点）', () => {
    const N = p => ({ kind: 'normal', points: p }), X = { kind: 'miss' };
    // 1セット目: p1 が 12x4+2=50 で取る（p2 は 1,1,1,1 → 4）。2セット目（p2 先攻）: p2 が3連続ミスで失格 → p2 0点、p1 50点
    const tl = [N(12), N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(2), X, N(5), X, N(5), X];
    const m = M('p1', 'p2', 2, 0, 100, 4, { scoring: 'throws', first_team: 1, use_order: true, throws_json: '', throwList: tl, legOrders: [] });
    const c2 = Object.assign({}, cfg, { min_matches: 1, min_team_matches: 0 });
    const r2 = G.computeRatings(pl, [m], c2);
    const a2 = G.computeAwards(pl, [m], r2, G.buildRanking(pl, r2, {}, c2), c2);
    eq(a2.awards.find(a => a.key === 'avgscore').entries.map(e => [e.player_id, e.value]), [['p1', 50], ['p2', 2]]);
  });
}

console.log('■ 社交王・開拓王・追加ボーナス・個人戦の成績');
{
  const pl = ['A', 'p1', 'p2', 'p3', 'p4', 'p5'].map(id => ({ player_id: id, name: id.toUpperCase(), initial_rating: '', fixed_rating: id === 'A' ? 1800 : '', active: true, rookie: '' }));
  let n = 0;
  const M = (t1, t2, w, extra) => Object.assign({ match_id: 'b' + (++n), started_at: 1000 + n, team1_ids: t1, team2_ids: t2, team1_legs: w === 1 ? 2 : 0, team2_legs: w === 1 ? 0 : 2, team1_score: '', team2_score: '', winner: w, status: 'done', scoring: 'manual' }, extra || {});
  const ms = [M('p1,p2', 'p3,p4', 1), M('p1,p3', 'p2,A', 1), M('p1,p3', 'p4,p5', 2), M('p1', 'p2', 1), M('p1', 'p3', 1), M('p1', 'A', 2), M('p1', 'p4', 1, { status: 'void' })];
  const c = Object.assign({}, cfg, { min_matches: 1, min_team_matches: 0, bonus_wins_step: 2, bonus_wins_pt: 10,
    bonus_partner_tiers: '1:5,2:15,all:100', bonus_opponent_tiers: '2:5,3:35,all:100', result_deadline: 5000 });
  const res = G.computeRatings(pl, ms, c);
  const aw = G.computeAwards(pl, ms, res, G.buildRanking(pl, res, {}, c), c);
  const get = k => aw.awards.find(a => a.key === k).entries.map(e => [e.rank, e.player_id, e.value]);
  t('社交王: 王者は対象外、3位まで同順位で並ぶ', () => { assert(!get('social').some(x => x[1] === 'A')); assert(get('social').every(x => x[0] === 1)); });
  t('社交王の人数（同じ人は1人、王者と組んでも数える）', () => { const m = Object.fromEntries(aw.awards.find(a => a.key === 'social').entries.map(e => [e.player_id, e.value])); eq([m.p1, m.p2, m.p3], [2, 2, 2]); });
  t('開拓王: 個人戦の相手の人数（無効試合は除く、王者も数える）', () => eq(get('pioneer')[0], [1, 'p1', 3]));
  const ex = G.computeExtraBonus(pl, ms, res, c, 4000);
  t('追加ボーナス: 到達した区分だけ（合計ではない）', () => {
    // p1: 勝ち4（m1,m2,m4,m5）→ 2区切り ×10 = 20。組んだ p2,p3 = 2人 → 15。戦った p2,p3,A = 3人 → 35
    eq([ex.p1.wins, ex.p1.wins_pt, ex.p1.partners, ex.p1.partners_pt, ex.p1.opponents, ex.p1.opponents_pt, ex.p1.total], [4, 20, 2, 15, 3, 35, 70]);
    eq(ex.p1.applied, false);
    eq(ex.p1.fixed, false);
  });
  t('鴨王（レート固定）にも同じ計算で追加ボーナスが付く（順位表には入らない）', () => {
    // A: m2（p2 と組んで負け）、m6（p1 に勝ち）→ 勝ち1 → 0pt。組んだ p2 = 1人 → 5。戦った p1 = 1人 → 0
    eq([ex.A.fixed, ex.A.wins, ex.A.wins_pt, ex.A.partners, ex.A.partners_pt, ex.A.opponents, ex.A.opponents_pt, ex.A.total], [true, 1, 0, 1, 5, 1, 0, 5]);
    const rk = G.buildRanking(pl, res, G.mergeBonus_({}, ex), c);
    assert(!rk.some(r => r.player_id === 'A'));
  });
  t('鴨王の参考合計 = 参考レート + ボーナス（手動も含む）。最低試合数は空欄なら min_matches', () => {
    const bm = G.mergeBonus_({ A: 7 }, ex);
    let vt = G.computeVirtualTotals(res, bm, Object.assign({}, c, { min_matches: 3 })).A;
    eq([vt.virtual_rating, vt.bonus, vt.total, vt.matches, vt.min, vt.eligible], [res.virtual.A, 12, res.virtual.A + 12, 2, 3, false]);
    vt = G.computeVirtualTotals(res, bm, Object.assign({}, c, { min_matches: 3, virtual_min_matches: 2 })).A;
    eq([vt.min, vt.eligible], [2, true]);
    vt = G.computeVirtualTotals(res, bm, Object.assign({}, c, { virtual_min_matches: '' })).A;
    eq(vt.min, 1);
    eq(Object.keys(G.computeVirtualTotals(res, bm, c)), ['A']);
  });
  t('追加ボーナス: 全員と組んだ／戦ったら all の区分', () => {
    const ms2 = ['p2', 'p3', 'p4', 'p5', 'A'].map(o => M('p1', o, 1));
    const r2 = G.computeRatings(pl, ms2, c);
    const e2 = G.computeExtraBonus(pl, ms2, r2, c, 4000);
    eq([e2.p1.opponents, e2.p1.opponents_pt, e2.p1.opponents_next], [5, 100, null]);
  });
  t('追加ボーナス: 予選中も見込みとして合計に入り、締切後は確定（applied）', () => {
    const ex2 = G.computeExtraBonus(pl, ms, res, c, 6000);
    const rk = G.buildRanking(pl, res, G.mergeBonus_({ p1: 3 }, ex2), c);
    const r1 = rk.find(r => r.player_id === 'p1');
    eq([ex2.p1.applied, r1.bonus, r1.total - r1.rating], [true, 73, 73]);
    const rk0 = G.buildRanking(pl, res, G.mergeBonus_({}, ex), c);
    eq([ex.p1.applied, rk0.find(r => r.player_id === 'p1').bonus], [false, 70]);
  });
  t('ハンデボーナス: 1回生は +30、合計に入る、0 でなし', () => {
    const plR = pl.map(p => p.player_id === 'p2' ? Object.assign({}, p, { rookie: '○' }) : p);
    const e1 = G.computeExtraBonus(plR, ms, res, c, 4000);
    eq([e1.p2.rookie, e1.p2.rookie_pt, e1.p2.total - ex.p2.total, e1.p1.rookie_pt], [true, 30, 30, 0]);
    const e2 = G.computeExtraBonus(plR, ms, res, c, 6000);
    const rk = G.buildRanking(plR, res, G.mergeBonus_({}, e2), c);
    eq(rk.find(r => r.player_id === 'p2').bonus, e2.p2.total);
    const rk0 = G.buildRanking(plR, res, G.mergeBonus_({}, e1), c);
    eq(rk0.find(r => r.player_id === 'p2').bonus, e1.p2.total); // 予選中も見込みで合計に入る
    const e3 = G.computeExtraBonus(plR, ms, res, Object.assign({}, c, { bonus_rookie_pt: 0 }), 6000);
    eq(e3.p2.rookie_pt, 0);
  });
  t('個人ページの成績: 勝率3種・平均得点・最長/現在の連勝（無効試合は除く）', () => {
    const pf = G.computeProfiles(pl, ms);
    // p1: チーム戦 m1勝 m2勝 m3負、個人戦 m4勝 m5勝 m6負 → 最長2連勝（m1,m2 / m4,m5）、最後は負けで現在0
    eq([pf.p1.s_w, pf.p1.s_n, pf.p1.t_w, pf.p1.t_n, pf.p1.best, pf.p1.cur], [2, 3, 2, 3, 2, 0]);
    eq(pf.p1.avg, null); // 得点の記録なし
  });
  t('組んだ人・戦った相手の一覧（回数つき）と、まだの人', () => {
    eq(ex.p1.partner_list, { p2: 1, p3: 2 });
    eq(ex.p1.opponent_list, { p2: 1, p3: 1, A: 1 });
    eq(ex.p1.opponent_not.slice().sort(), ['p4', 'p5']);
  });
  t('個人戦の成績: ブレイク・上がりターン・先攻/後攻取得率（3ミス失格はターン数に入れない）', () => {
    const N = p => ({ kind: 'normal', points: p }), X = { kind: 'miss' };
    // 1セット目 p1 先攻: p1 6,12,12,12,8 で 50（5投）、p2 1,1,1,1。2セット目 p2 先攻: p2 ミス3回で失格 → p1 が取る
    const tl = [N(6), N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(8), X, N(5), X, N(5), X];
    const m = M('p1', 'p2', 1, { scoring: 'throws', first_team: 1, use_order: true, throwList: tl, legOrders: [] });
    const x = G.computeSinglesStats([m, M('p1,p2', 'p3,p4', 1, { scoring: 'throws', throwList: tl, legOrders: [] })]);
    eq([x.p1.break_avg, x.p1.break_sets, x.p1.finish_turns_avg, x.p1.finish_sets, x.p1.first_won + '/' + x.p1.first_sets, x.p1.second_won + '/' + x.p1.second_sets], [6, 1, 5, 1, '1/1', '1/1']);
    eq([x.p2.break_avg, x.p2.first_rate, x.p2.second_rate, x.p2.finish_turns_avg], [0, 0, 0, null]);
    // 上がれなかったセット: p2 は1セット目 4点、2セット目 3ミス失格で0点 → 平均 2.0。p1 は取られたセットなし
    eq([x.p2.lose_avg, x.p2.lose_sets, x.p1.lose_avg], [2, 2, null]);
    eq([x.p1.hits + '/' + x.p1.throws, x.p1.hit_rate, x.p2.hits + '/' + x.p2.throws, x.p2.hit_rate], ['7/7', 100, '4/7', 57.1]); // 個人戦のヒット率
    assert.strictEqual(x.p3, undefined); // チーム戦は数えない
  });
}

console.log('■ 1投ごとの記録（シート連携・モック）');
t('開始 → 投擲の送信 → 2本目の順番 → 自動で結果登録・レート・個人成績', () => {
  const g = loadGas();
  g.setup();
  const sh = g.__sheets;
  ['p1', 'p2', 'p3'].forEach((id, i) => sh.players.appendRow([id, '選手' + i, '', '', true]));
  let r = g.api('start', { team1: ['p1', 'p2'], team2: ['p3'], scoring: 'throws', use_order: true, first_team: 1, device: 'dev1' });
  eq(r.ok, true, r.error);
  const mid = r.data.matches[0].id;
  eq([r.data.matches[0].scoring, r.data.matches[0].use_order, r.data.matches[0].rev], ['throws', true, 0]);
  const leg1 = [N(12), N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(2)];
  r = g.api('sync', { match_id: mid, throws: leg1.slice(0, 4), leg_orders: [], base_rev: 0, device: 'dev1' }); eq(r.ok, true, r.error);
  // 別の端末からは送れない（引き継ぎなら可）
  r = g.api('sync', { match_id: mid, throws: leg1.slice(0, 5), leg_orders: [], base_rev: 1, device: 'dev2' }); eq(r.ok, false); assert(/^SCORER:/.test(r.error));
  r = g.api('sync', { match_id: mid, throws: leg1.slice(0, 5), leg_orders: [], base_rev: 0, device: 'dev1' }); eq(r.ok, false); assert(/^REV:/.test(r.error));
  r = g.api('sync', { match_id: mid, throws: leg1, leg_orders: [], base_rev: 1, device: 'dev1' }); eq(r.ok, true, r.error);
  { const mt = g.api('matchThrows', { match_id: mid }); eq([mt.ok, JSON.stringify(mt.data.throws) === JSON.stringify(leg1)], [true, true]); // 履歴のスコア表用（読み取り）
    eq(g.api('matchThrows', { match_id: 'nope' }).ok, false); }
  { // 観戦（読み取りのみ）: 記録中の端末の rev・記録者を変えない（設計書 第21章）
    const before = JSON.stringify(sh.matches.data);
    const w = g.api('watch', { match_id: mid, device: 'dev2' });
    eq([w.ok, w.data.match.status, w.data.match.rev, w.data.match.scorer, w.data.match.throws.length], [true, 'playing', 2, '端末dev1', leg1.length]);
    eq(JSON.stringify(sh.matches.data), before);
    eq(g.api('watch', { match_id: 'nope' }).ok, false); }
  // 2本目の順番を決めずに投げるとエラー
  r = g.api('sync', { match_id: mid, throws: leg1.concat([N(1)]), leg_orders: [], base_rev: 2, device: 'dev1' }); eq(r.ok, false);
  // メンバーと合わない順番はエラー
  r = g.api('sync', { match_id: mid, throws: leg1, leg_orders: [null, [['p1', 'p3'], ['p2']]], base_rev: 2, device: 'dev1' }); eq(r.ok, false);
  const leg2 = [N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(12), N(1), N(2)];
  r = g.api('sync', { match_id: mid, throws: leg1.concat(leg2), leg_orders: [null, [['p2', 'p1'], ['p3']]], base_rev: 2, device: 'dev1', takeover: false });
  eq(r.ok, true, r.error);
  const m = r.data.matches.find(x => x.id === mid);
  eq([m.status, m.winner, m.legs1, m.legs2, m.score1, m.score2], ['done', 1, 2, 0, 100, 9]);
  eq(r.data.players.find(p => p.id === 'p1').rating, 1524);
  eq(m.leg_scores, [[50, 4], [50, 5]]);
  // throws シートと個人成績
  eq(sh.throws.getLastRow() - 1, 19);
  const p2 = r.data.throw_stats.p2, p1 = r.data.throw_stats.p1;
  // 1本目 p1,p2,p1,p2,p1 (12,12,12,12,2) / 2本目は p2 から: p2,p1,p2,p1,p2 (12,12,12,12,2)
  eq([p1.throws, p1.points, p1.wins, p2.throws, p2.wins], [5, 50, 1, 5, 1]);
  // 運営が無効化すると個人成績から外れる
  r = g.api('adminVoid', { admin_key: 'change-me', match_id: mid }); eq(r.ok, true, r.error);
  assert.strictEqual(r.data.throw_stats.p1, undefined);
});
t('点数で送った投擲もサーバーで同じように計算される', () => {
  const g = loadGas(); g.setup();
  ['p1', 'p2'].forEach(id => g.__sheets.players.appendRow([id, id, '', '', true]));
  let r = g.api('start', { team1: ['p1'], team2: ['p2'], scoring: 'throws', device: 'd' });
  const mid = r.data.matches[0].id;
  r = g.api('sync', { match_id: mid, throws: [{ kind: 'normal', points: 9 }, { kind: 'miss' }, { kind: 'normal', points: 11 }], leg_orders: [], base_rev: 0, device: 'd' });
  eq(r.ok, true, r.error);
  eq(r.data.matches[0].throws, [{ kind: 'normal', points: 9 }, { kind: 'miss' }, { kind: 'normal', points: 11 }]);
  r = g.api('sync', { match_id: mid, throws: [{ kind: 'normal', points: 15 }], leg_orders: [], base_rev: 1, device: 'd' });
  eq(r.ok, false);
});
t('1投ごとの試合を途中で「結果だけ入力」に切り替えられる', () => {
  const g = loadGas();
  g.setup();
  ['p1', 'p2'].forEach(id => g.__sheets.players.appendRow([id, id, '', '', true]));
  let r = g.api('start', { team1: ['p1'], team2: ['p2'], scoring: 'throws', first_team: 2, device: 'd' });
  const mid = r.data.matches[0].id;
  r = g.api('sync', { match_id: mid, throws: [N(5), N(6)], leg_orders: [], base_rev: 0, device: 'd' }); eq(r.ok, true, r.error);
  r = g.api('result', { match_id: mid, team1_legs: 1, team2_legs: 2, device: 'd' }); eq(r.ok, true, r.error);
  const m = r.data.matches.find(x => x.id === mid);
  eq([m.status, m.scoring, m.winner], ['done', 'manual', 2]);
  eq(g.__sheets.throws.getLastRow(), 1); // 途中までの投擲は個人成績に入れない
});
t('古いシートに setup をもう一度実行すると足りない列が追加される', () => {
  const g = loadGas();
  g.__sheets.matches = undefined;
  const ss = g.SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.insertSheet('matches');
  old.getRange(1, 1, 1, 3).setValues([['match_id', 'started_at', 'confirmed_by']]);
  g.setup();
  const head = g.__sheets.matches.data[0].filter(String);
  assert(head.includes('throws_json') && head.includes('leg_orders') && head.includes('confirmed_by'));
  assert(g.__sheets.throws && g.__sheets.player_stats);
});
t('古い形の player_stats（平均点・ミス率）は再計算でヒット率の形に置き換わる', () => {
  const g = loadGas(); g.setup();
  const ps = g.__sheets.player_stats;
  ps.clearContents();
  ps.getRange(1, 1, 2, 10).setValues([['player_id', 'name', 'throws', 'points', 'avg_points', 'misses', 'miss_rate', 'wins', 'busts', 'updated_at'], ['x', 'X', 4, 20, 5, 1, 25, 0, 0, '']]);
  eq(g.api('state').data.throw_stats.x.hit_rate, 75); // 古い形のままでも画面にはヒット率が出る
  g.recalc();
  eq(ps.data[0].filter(String), JSON.parse(JSON.stringify(g.HEADERS.player_stats)));
  assert(ps.data[0].includes('hit_rate') && !ps.data[0].includes('avg_points'));
});
t('列が5つしかない players シート（CSV取り込み）でも setup で rookie 列が足される', () => {
  const g = loadGas();
  const pl = g.SpreadsheetApp.getActiveSpreadsheet().insertSheet('players');
  pl.__maxCols = 5;
  pl.getRange(1, 1, 1, 5).setValues([['player_id', 'name', 'initial_rating', 'fixed_rating', 'active']]);
  g.setup();
  eq(g.__sheets.players.data[0], ['player_id', 'name', 'initial_rating', 'fixed_rating', 'active', 'rookie']);
  eq(pl.__inserted, 1);
});
t('Code.gs と index.html の点数計算は同じコード', () => {
  const re = /\/\* ENGINE START[\s\S]*?\/\* ENGINE END \*\//;
  const a = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8').match(re)[0];
  const b = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(re)[0];
  eq(a === b, true);
});

console.log('■ 画面に返す値（google.script.run で渡せる形か）');
// google.script.run は Date・NaN などを含むと null を返す。返り値にそれらが無いことを確かめる
function badValues(v, p, out) {
  if (v instanceof Date || (v && Object.prototype.toString.call(v) === '[object Date]')) out.push(p + ' は日付');
  else if (typeof v === 'number' && !isFinite(v)) out.push(p + ' は ' + v);
  else if (typeof v === 'function') out.push(p + ' は関数');
  else if (v && typeof v === 'object') Object.keys(v).forEach(k => badValues(v[k], p + '.' + k, out));
  return out;
}
t('試合開始・試合中・結果入力・1投ごとの記録のどの返り値にも Date / NaN が無い', () => {
  const g = loadGas();
  g.setup();
  ['p1', 'p2', 'p3', 'p4'].forEach(id => g.__sheets.players.appendRow([id, id, '', '', true]));
  const all = [];
  let r = g.api('start', { team1: ['p1'], team2: ['p2'], device: 'd' }); eq(r.ok, true, r.error); all.push(r);
  all.push(g.api('state'));
  r = g.api('start', { team1: ['p3'], team2: ['p4'], scoring: 'throws', use_order: true, device: 'd' }); eq(r.ok, true, r.error); all.push(r);
  const tid = r.data.matches[0].id, mid = r.data.matches[1].id;
  all.push(g.api('sync', { match_id: tid, throws: [N(3)], leg_orders: [], base_rev: 0, device: 'd' }));
  all.push(g.api('result', { match_id: mid, team1_legs: 2, team2_legs: 0, device: 'd' }));
  all.push(g.api('start', { team1: ['p1'], team2: ['p1'], device: 'd' })); // エラーの返り値も
  const bad = all.reduce((acc, x, i) => badValues(x, 'call' + i, acc), []);
  eq(bad, []);
});


console.log('■ 日程調整');
{
  const mk = () => {
    const g = loadGas({ now: Date.parse('2026-11-25T10:30:00+09:00') });
    g.setup();
    ['p1', 'p2', 'p3'].forEach(id => g.__sheets.players.appendRow([id, id, '', '', true]));
    g.__sheets.players.appendRow(['px', 'px', '', '', false]);
    return g;
  };
  const S = (g, a, p) => { const r = g.api(a, Object.assign({ device: 'dev1' }, p)); return r; };
  t('期間は start_at〜end_at の14日、時間帯は 7〜20時台、場所は3つ', () => {
    const g = mk(); const r = g.api('schedule');
    eq(r.ok, true, r.error);
    eq([r.data.dates.length, r.data.dates[0], r.data.dates[13], r.data.day_start, r.data.day_end], [14, '2026-11-24', '2026-12-07', 7, 20]);
    eq(r.data.places, ['高原', '鴨川南', '飛鳥井']);
  });
  t('参加すると1マス1行。同じマスにもう一度参加しても1件のまま（上書き）', () => {
    const g = mk();
    let r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }, { date: '2026-11-25', hour: 19 }], place: ['飛鳥井', '高原'], format: 'チーム戦', comment: 'よろしく' });
    eq(r.ok, true, r.error);
    eq(r.data.slots.length, 2);
    eq([r.data.slots[0].place, r.data.slots[0].format, r.data.slots[0].comment], ['高原,飛鳥井', 'チーム戦', 'よろしく']);
    const c0 = r.data.slots[0].c;
    g.__advance(60000);
    r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }], place: [], format: 'どちらでも' });
    eq(r.data.slots.length, 2);
    const s18 = r.data.slots.find(x => x.h === 18);
    eq([s18.place, s18.format, s18.comment, s18.c === c0, s18.u > c0], ['どこでも', 'どちらでも', '', true, true]);
    eq(r.data.result, { added: 0, updated: 1, removed: 0, skipped: 0 });
  });
  t('取り消しと、編集で外した時間の取り消し', () => {
    const g = mk();
    S(g, 'schedSet', { player_id: 'p1', items: [18, 19, 20].map(h => ({ date: '2026-11-26', hour: h })) });
    let r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-26', hour: 18 }], remove: [18, 19, 20].map(h => ({ date: '2026-11-26', hour: h })), format: '個人戦' });
    eq(r.ok, true, r.error);
    eq(r.data.slots.map(x => [x.h, x.format]), [[18, '個人戦']]);
    r = S(g, 'schedLeave', { player_id: 'p1', items: [{ date: '2026-11-26', hour: 18 }] });
    eq(r.data.slots.length, 0);
    eq(g.__sheets.schedule.data.slice(1).filter(row => row.some(v => v !== '')).length, 0);
  });
  t('まとめて追加: 参加済みは既定で飛ばし、上書きを選ぶと上書き', () => {
    const g = mk();
    S(g, 'schedSet', { player_id: 'p2', items: [{ date: '2026-11-27', hour: 9 }], comment: '前' });
    const items = ['2026-11-27', '2026-11-28'].flatMap(d => [9, 10].map(h => ({ date: d, hour: h })));
    let r = S(g, 'schedSet', { player_id: 'p2', items, comment: '後', skip_existing: true });
    eq(r.data.result, { added: 3, updated: 0, removed: 0, skipped: 1 });
    eq(r.data.slots.find(x => x.d === '2026-11-27' && x.h === 9).comment, '前');
    r = S(g, 'schedSet', { player_id: 'p2', items, comment: '後', skip_existing: false });
    eq(r.data.result, { added: 0, updated: 4, removed: 0, skipped: 0 });
  });
  t('ほかの人の参加には影響しない', () => {
    const g = mk();
    S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }] });
    S(g, 'schedSet', { player_id: 'p2', items: [{ date: '2026-11-25', hour: 18 }] });
    const r = S(g, 'schedLeave', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }] });
    eq(r.data.slots.map(x => x.p), ['p2']);
  });
  t('入力チェック: 過ぎた時間・期間外・時間外・どこでも＋他・その他の空欄・形式・ひとこと101字・参加中でない人', () => {
    const g = mk();
    const bad = (p, msg) => { const r = S(g, 'schedSet', Object.assign({ player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }] }, p)); eq(r.ok, false); assert.ok(r.error.includes(msg), r.error); };
    bad({ items: [{ date: '2026-11-25', hour: 9 }] }, '過ぎた時間');
    bad({ items: [{ date: '2026-12-08', hour: 9 }] }, '期間外');
    bad({ items: [{ date: '2026-11-26', hour: 21 }] }, '時間割の外');
    bad({ place: ['どこでも', '高原'] }, '同時に選べません');
    bad({ place: ['その他'] }, '「その他」の場所');
    bad({ place: ['体育館'] }, '選択肢にありません');
    bad({ format: '3人戦' }, '希望形式');
    bad({ comment: 'あ'.repeat(101) }, '100文字');
    bad({ player_id: 'px' }, '参加中ではない');
    bad({ player_id: 'zz' }, '選手が見つかりません');
    // いまの時間（10時台）は参加できる
    eq(S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 10 }] }).ok, true);
  });
  t('その他は自由入力を保存。数式に見える文字はそのまま返る', () => {
    const g = mk();
    const r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }], place: ['その他', '鴨川南'], place_other: '=体育館', comment: '+1' });
    eq(r.ok, true, r.error);
    eq([r.data.slots[0].place, r.data.slots[0].other, r.data.slots[0].comment], ['鴨川南,その他', '=体育館', '+1']);
    assert.ok(String(g.__sheets.schedule.data[1][4]).startsWith("'"));
  });
  t('上限: 1回200時間まで、1人400時間まで', () => {
    const g = mk();
    const all = g.api('schedule').data.dates.slice(2).flatMap(d => Array.from({ length: 14 }, (_, i) => ({ date: d, hour: 7 + i }))); // 11/26〜 12日×14時間=168
    let r = S(g, 'schedSet', { player_id: 'p1', items: all, remove: all.slice(0, 40).map(x => ({ date: x.date, hour: x.hour + 0 })) });
    eq(r.ok, false); assert.ok(r.error.includes('200'), r.error);
    eq(S(g, 'schedSet', { player_id: 'p1', items: all }).ok, true);
    // 1人の上限は、テストでは小さくして試す（400 → 170）
    g.SCHED_MAX_PER_PLAYER = 170;
    r = S(g, 'schedSet', { player_id: 'p1', items: [11, 12, 13].map(h => ({ date: '2026-11-25', hour: h })) });
    eq(r.ok, false); assert.ok(r.error.includes('170時間まで'), r.error);
    eq(S(g, 'schedSet', { player_id: 'p1', items: [11, 12].map(h => ({ date: '2026-11-25', hour: h })) }).ok, true);
    eq(S(g, 'schedSet', { player_id: 'p2', items: all }).ok, true); // ほかの人は別に数える
  });
  t('schedule シートが無くても（setup 前の版のシート）、初めての参加でシートを作る', () => {
    const g = mk();
    delete g.__sheets.schedule;
    eq(g.api('schedule').data.slots, []);
    const r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }] });
    eq(r.ok, true, r.error);
    eq(r.data.slots.length, 1);
  });
  t('運営画面で日程タブを非表示にできる（非表示のあいだは登録できない。登録済みは残る）', () => {
    const g = mk();
    S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }] });
    eq(g.api('state').data.settings.sched_visible, true);
    const key = g.api('state').ok && g.__sheets.settings.data.find(r => r[0] === 'admin_key')[1];
    let r = g.api('adminSetting', { admin_key: key, key: 'sched_visible', value: false });
    eq(r.ok, true, r.error);
    eq(r.data.settings.sched_visible, false);
    r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 19 }] });
    eq(r.ok, false); assert.ok(r.error.includes('非表示'), r.error);
    eq(S(g, 'schedLeave', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }] }).ok, false);
    eq(g.api('schedule').data.slots.length, 1);
    r = g.api('adminSetting', { admin_key: key, key: 'sched_visible', value: true });
    eq(r.data.settings.sched_visible, true);
    eq(S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 19 }] }).ok, true);
  });
  t('シートに日付が Date で入っていても読める', () => {
    const g = mk();
    S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }] });
    g.__sheets.schedule.data[1][1] = new Date('2026-11-25T00:00:00+09:00');
    const r = g.api('schedule');
    eq(r.data.slots[0].d, '2026-11-25');
    eq(badValues(r, 'schedule', []), []);
  });
  t('持ち物（モルックのセット）を保存・上書きでき、未知の項目は断る', () => {
    const g = mk();
    eq(g.api('schedule').data.gear, [{ key: 'set', label: 'モルックのセット' }]);
    let r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }], gear: ['set'] });
    eq(r.ok, true, r.error);
    eq(r.data.slots[0].gear, 'set');
    r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }, { date: '2026-11-25', hour: 19 }], gear: [], skip_existing: true });
    eq(r.data.slots.map(x => x.gear), ['set', '']); // 参加済みは飛ばすのでそのまま
    r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }] });
    eq(r.data.slots.find(x => x.h === 18).gear, '');
    r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }], gear: ['car'] });
    eq(r.ok, false); assert.ok(r.error.includes('持ち物'), r.error);
    g.__sheets.settings.appendRow(['sched_gear', 'set:セット,judge:審判できる', '']);
    r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }], gear: ['judge', 'set', 'set'] });
    eq(r.data.slots.find(x => x.h === 18).gear, 'set,judge');
  });
  t('gear・via 列の無い古い schedule シートでも、書き込むと列が足される', () => {
    const g = mk();
    g.__sheets.schedule.data[0] = g.__sheets.schedule.data[0].slice(0, 10);
    const r = S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 18 }], gear: ['set'] });
    eq(r.ok, true, r.error);
    eq(g.__sheets.schedule.data[0].slice(10), ['gear', 'via']);
    eq(g.api('schedule').data.slots[0].gear, 'set');
  });

  // 試合開始で自動追加（日程調整 設計書 16章）
  const slotsOf = g => g.api('schedule').data.slots.map(x => [x.p, x.d, x.h, x.via || '']).sort((a, b) => String(a).localeCompare(String(b)));
  t('試合を始めると、未登録の人だけいまのマスに自動で入る（登録済みはそのまま）', () => {
    const g = mk();
    S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-25', hour: 10 }], comment: 'いる' });
    const r = g.api('start', { team1: ['p1'], team2: ['p2', 'p3'], device: 'd' });
    eq(r.ok, true, r.error);
    const mid = r.data.matches[0].id;
    eq(slotsOf(g), [['p1', '2026-11-25', 10, ''], ['p2', '2026-11-25', 10, 'match:' + mid], ['p3', '2026-11-25', 10, 'match:' + mid]]);
    const s = g.api('schedule').data.slots.find(x => x.p === 'p2');
    eq([s.place, s.format, s.comment, s.gear], ['どこでも', 'どちらでも', '', '']);
    eq(g.api('schedule').data.slots.find(x => x.p === 'p1').comment, 'いる');
    assert.ok(g.__sheets.log.data.some(row => row[1] === 'schedAuto'));
  });
  t('時間割の外（21時台）・日程非表示・自動追加OFFのときは入れない', () => {
    let g = mk();
    g.__setNow(Date.parse('2026-11-25T06:30:00+09:00')); // 7時台より前（試合は開始できる）
    g.__sheets.settings.data.find(r => r[0] === 'start_at')[1] = new Date('2026-11-24T06:00:00+09:00');
    eq(g.api('start', { team1: ['p1'], team2: ['p2'], device: 'd' }).ok, true);
    eq(slotsOf(g), []);
    g = mk();
    g.api('adminSetting', { admin_key: 'change-me', key: 'sched_visible', value: false });
    eq(g.api('start', { team1: ['p1'], team2: ['p2'], device: 'd' }).ok, true);
    eq(g.api('schedule').data.slots, []);
    g = mk();
    const r = g.api('adminSetting', { admin_key: 'change-me', key: 'sched_auto_join', value: false });
    eq(r.data.settings.sched_auto_join, false);
    eq(g.api('start', { team1: ['p1'], team2: ['p2'], device: 'd' }).ok, true);
    eq(slotsOf(g), []);
  });
  t('400マスに達している人には入れない', () => {
    const g = mk();
    S(g, 'schedSet', { player_id: 'p1', items: [{ date: '2026-11-30', hour: 9 }] }); // シートと列を作る
    const sh = g.__sheets.schedule, head = sh.data[0];
    for (let i = 1; i < 400; i++) sh.appendRow(head.map(h => ({ player_id: 'p1', date: '2026-11-' + (26 + i % 4), hour: 7 + (i % 14), place: 'どこでも', format: 'どちらでも' })[h] ?? ''));
    eq(g.api('start', { team1: ['p1'], team2: ['p2'], device: 'd' }).ok, true);
    eq(slotsOf(g).filter(x => x[2] === 10 && x[1] === '2026-11-25').map(x => x[0]), ['p2']);
  });
  t('時間をまたいで終わったら、終わった時間のマスにも入る（結果入力・1投ごと）', () => {
    const g = mk();
    g.__setNow(Date.parse('2026-11-25T10:50:00+09:00'));
    let r = g.api('start', { team1: ['p1'], team2: ['p2'], device: 'd' });
    const mid = r.data.matches[0].id;
    r = g.api('start', { team1: ['p3'], team2: ['p1', 'p2'], device: 'd' }); // 同時に試合中でもよい
    g.__setNow(Date.parse('2026-11-25T11:10:00+09:00'));
    eq(g.api('result', { match_id: mid, team1_legs: 2, team2_legs: 1, device: 'd' }).ok, true);
    eq(slotsOf(g).filter(x => x[2] === 11).map(x => x[0] + ' ' + x[3]), ['p1 match:' + mid, 'p2 match:' + mid]);
  });
  t('同じ時間のうちに終わったら、次のマスには入れない', () => {
    const g = mk();
    const r = g.api('start', { team1: ['p1'], team2: ['p2'], device: 'd' });
    g.__advance(20 * 60000);
    g.api('result', { match_id: r.data.matches[0].id, team1_legs: 2, team2_legs: 0, device: 'd' });
    eq(slotsOf(g).map(x => x[2]), [10, 10]);
  });
  t('開始を取り消すと自動で入れた参加は消え、本人が編集したものと元からの参加は残る', () => {
    const g = mk();
    S(g, 'schedSet', { player_id: 'p3', items: [{ date: '2026-11-25', hour: 10 }] });
    const r = g.api('start', { team1: ['p1', 'p3'], team2: ['p2'], device: 'd' });
    const mid = r.data.matches[0].id;
    S(g, 'schedSet', { player_id: 'p2', items: [{ date: '2026-11-25', hour: 10 }], comment: 'まだいます' }); // 編集で via が外れる
    eq(g.api('cancel', { match_id: mid, device: 'd' }).ok, true);
    eq(slotsOf(g), [['p2', '2026-11-25', 10, ''], ['p3', '2026-11-25', 10, '']]);
  });
  t('日程の書き込みで失敗しても、試合の開始は成功する', () => {
    const g = mk();
    const orig = g.__sheets.schedule.getRange;
    g.__sheets.schedule.getRange = function (a) { if (typeof a === 'number' && a > 1) throw new Error('boom'); return orig.apply(this, arguments); };
    const r = g.api('start', { team1: ['p1'], team2: ['p2'], device: 'd' });
    eq(r.ok, true, r.error);
    eq(r.data.matches[0].status, 'playing');
    assert.ok(g.__sheets.log.data.some(row => row[1] === 'schedAutoError'));
  });
}

console.log('■ 画面側の式がサーバーと一致');
t('index.html の computeDelta と Code.gs の結果が同じ', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const src = html.match(/function roundHalfUp[\s\S]*?\nfunction computeDelta[\s\S]*?\n}\n/)[0];
  const f = new Function(src + '; return computeDelta;')();
  for (let a = 1200; a <= 1900; a += 7) for (let b = 1200; b <= 1900; b += 11) {
    assert.deepStrictEqual(f(a, b, cfg), JSON.parse(JSON.stringify(G.computeDelta(a, b, cfg))), a + ' vs ' + b);
  }
});

console.log(`\n${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail ? 1 : 0);
