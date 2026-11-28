/**
 * 鴨王戦 予選レート戦 — Google Apps Script
 *
 * スプレッドシートに紐づけて使うスクリプトです。
 *  - doGet  : アプリ画面（index.html）を返す。?api=state で JSON も返す
 *  - doPost : アプリからの記録（試合開始・結果入力など）を受け付ける
 *  - api    : 画面から google.script.run で呼ばれる窓口
 *  - setup  : 初回にシートを作る（メニュー「鴨王戦 > 初期設定」）
 *
 * レートはシートに保存せず、毎回 matches シートの全試合から再計算します。
 */

var SHEET = {
  players: 'players',
  matches: 'matches',
  settings: 'settings',
  ranking: 'ranking',
  bonus: 'bonus',
  log: 'log',
  throws: 'throws',
  player_stats: 'player_stats',
  awards: 'awards',
  extra_bonus: 'extra_bonus',
  schedule: 'schedule',
  stats: 'stats'
};

var HEADERS = {
  players: ['player_id', 'name', 'initial_rating', 'fixed_rating', 'active', 'rookie'],
  matches: ['match_id', 'started_at', 'ended_at', 'team1_ids', 'team2_ids',
            'team1_legs', 'team2_legs', 'team1_score', 'team2_score', 'winner',
            'status', 'started_by', 'entered_by',
            'delta_team1', 'delta_team2', 'note',
            'scoring', 'use_order', 'first_team', 'leg3_first', 'leg_orders', 'throws_json', 'rev', 'scorer'],
  settings: ['key', 'value', 'description'],
  ranking: ['rank', 'player_id', 'name', 'rating', 'bonus', 'total', 'matches',
            'team_matches', 'eligible', 'qualify_zone', 'updated_at'],
  bonus: ['player_id', 'points', 'reason'],
  log: ['at', 'action', 'by', 'detail'],
  throws: ['match_id', 'leg', 'seq', 'team', 'player_id', 'kind', 'pins', 'points', 'score_after', 'miss_streak', 'event'],
  player_stats: ['player_id', 'name', 'throws', 'hits', 'hit_rate', 'points', 'misses', 'wins', 'busts',
                 'break_avg', 'break_sets', 'finish_turns_avg', 'finish_sets',
                 'first_sets', 'first_won', 'first_rate', 'second_sets', 'second_won', 'second_rate',
                 'singles_throws', 'singles_hits', 'singles_hit_rate', 'lose_avg', 'lose_sets', 'updated_at'],
  awards: ['award', 'rank', 'player_id', 'name', 'value', 'detail', 'updated_at'],
  extra_bonus: ['player_id', 'name', 'wins', 'wins_pt', 'partners', 'partners_pt', 'opponents', 'opponents_pt', 'rookie_pt', 'total', 'applied', 'updated_at'],
  schedule: ['player_id', 'date', 'hour', 'place', 'place_other', 'format', 'comment', 'created_at', 'updated_at', 'device', 'gear', 'via'],
  // 全員のスタッツ（見るだけの表。1行目にグループ名、2行目に項目名を出す。全員のスタッツ 設計書）
  stats: ['順位', '名前', '合計', '8位との差', 'レート', 'ボーナス', '最低条件', '通過圏',
          '試合数', '勝利', '敗北', '勝率', '個人戦', '個人戦の勝利', '個人戦の勝率', 'チーム戦', 'チーム戦の勝利', 'チーム戦の勝率',
          '最長連勝', '現在の連勝', '1セット平均', '平均のセット数',
          '開始レート', '最高レート', '最低レート', '増減',
          '勝利数ボーナス', '組んだ人数', '組んだ人数ボーナス', '戦った相手', '戦った相手ボーナス', 'ハンデ',
          '2-0勝', '2-1勝', '1-2敗', '0-2敗', '個人戦のヒット率', '個人戦の投擲数', '平均ブレイク本数', '平均上がりターン数',
          '上がれなかったセットの平均得点', '先攻セット取得率', '後攻セット取得率',
          'ヒット率', '投擲数', '上がり', 'バースト',
          '参考レート', '参考合計', '更新日時']
};

/** stats シートの1行目（グループ名）。グループの最初の列に名前を出す */
var STATS_GROUPS = [['基本', 8], ['試合', 14], ['レート', 4], ['ボーナスの内訳', 6], ['個人戦の成績', 11], ['投擲成績（チーム戦も含む）', 4], ['鴨王（レート固定の人）', 2], ['', 1]];
/** stats シートで「58.3%」の形にする列（値は 0.583 のような割合） */
var STATS_PCT = ['勝率', '個人戦の勝率', 'チーム戦の勝率', '個人戦のヒット率', '先攻セット取得率', '後攻セット取得率', 'ヒット率'];

var DEFAULT_SETTINGS = [
  ['start_at', '2026-11-24T07:00:00+09:00', '予選の開始日時（この時刻より前は試合開始できない）'],
  ['end_at', '2026-12-07T21:00:00+09:00', '試合開始の締切（この時刻以降は試合開始できない）'],
  ['result_deadline', '2026-12-07T23:59:00+09:00', '結果入力の締切'],
  ['initial_rating', 1500, '初期レートが空欄の人のレート'],
  ['win_base', 24, '勝ちの基本値'],
  ['win_coef', 0.06, '勝ちの係数（相手平均−自分平均に掛ける）'],
  ['loss_base', 20, '負けの基本値'],
  ['loss_coef', 0.05, '負けの係数（自分平均−相手平均に掛ける）'],
  ['min_gain', 10, '勝ちの最低増分'],
  ['min_loss', 10, '負けの最低減分'],
  ['max_team_size', 4, '1チームの最大人数'],
  ['max_singles_vs_same', 3, '同一選手との1vs1の上限'],
  ['max_vs_fixed_solo', 5, '鴨王が1人のチーム（1vs1・鴨王1人vs複数。鴨王を固定レートで計算する試合）と対戦できる回数（1人あたり。鴨王がほかの人と組んだ試合は数えない）'],
  ['max_vs_fixed_singles', 3, 'そのうち鴨王との1vs1（個人戦）の上限（1人あたり）'],
  ['min_matches', 15, '参加条件: 最低試合数'],
  ['min_team_matches', 5, '参加条件: 最低チーム戦数'],
  ['qualify_count', 8, '順位戦に進む人数'],
  ['admin_key', 'change-me', '運営画面のパスワード（必ず変更してください）'],
  ['awards_visible', true, '特別賞をアプリに表示するか（FALSE で非表示。awards シートには常に出る）'],
  ['virtual_rating_visible', true, 'レート固定の人の「変動した場合」の参考レートをアプリに表示するか（FALSE で非表示。運営画面からも切り替えられる）'],
  ['virtual_initial_rating', '', '参考レートの開始値（空欄ならその人の固定レートから。運営画面からも変えられる）'],
  ['virtual_min_matches', '', 'レート固定の人の参考合計（参考レート＋ボーナス）の最低試合数（空欄なら min_matches と同じ。運営画面からも変えられる）'],
  ['memorial_step', 100, 'メモリアル賞の区切り（100 なら 100戦目・200戦目…）'],
  ['bonus_wins_step', 10, '追加ボーナス: 勝利数の区切り（10 なら 10勝・20勝…）'],
  ['bonus_wins_pt', 10, '追加ボーナス: 勝利数の1区切りあたりのポイント（20勝なら 2×10＝+20）'],
  ['bonus_partner_tiers', '5:5,10:15,20:30,30:45,all:100', '追加ボーナス: チーム戦で組んだ人数の区分（人数:ポイント。all は全員）'],
  ['bonus_opponent_tiers', '5:5,10:15,20:35,30:55,all:100', '追加ボーナス: 個人戦で戦った相手の人数の区分（人数:ポイント。all は全員）'],
  ['bonus_rookie_pt', 30, 'ハンデボーナス: 1回生（players の rookie 列）に予選終了後に加算するレート。0 でなし'],
  ['sched_visible', true, '日程タブをアプリに表示するか（FALSE で非表示。運営画面からも切り替えられる）'],
  ['sched_day_start', 7, '日程: 時間割の最初の時間帯（7 なら 7時台から）'],
  ['sched_day_end', 20, '日程: 時間割の最後の時間帯（20 なら 20時台まで）'],
  ['sched_places', '高原,鴨川南,飛鳥井', '日程: 希望場所の選択肢（カンマ区切り。「どこでも」「その他」は必ず出る）'],
  ['sched_gear', 'set:モルックのセット', '日程: 参加登録の「持ち物」のボタン（記号:表示名 のカンマ区切り。先頭の項目は時間割に ● で出る）'],
  ['sched_auto_join', true, '日程: 試合を始めたとき、日程に登録していない人をその時間に自動で追加するか（FALSE でしない。運営画面からも切り替えられる）']
];

/* =====================================================================
 *  純粋な計算部分（スプレッドシートに依存しない。テスト対象）
 * ===================================================================== */

/** 四捨五入（小数第1位を四捨五入して整数に。負の値は絶対値で丸める） */
function roundHalfUp_(v) {
  var x = Math.round(v * 1e6) / 1e6; // 0.06 などの浮動小数誤差を除く
  return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
}

/**
 * 勝ちチーム平均 winAvg、負けチーム平均 loseAvg から
 * { gain: 勝ち側の増分(正), loss: 負け側の減分(正) } を返す
 */
function computeDelta(winAvg, loseAvg, cfg) {
  cfg = cfg || {};
  var winBase = num_(cfg.win_base, 24), winCoef = num_(cfg.win_coef, 0.06);
  var lossBase = num_(cfg.loss_base, 20), lossCoef = num_(cfg.loss_coef, 0.05);
  var minGain = num_(cfg.min_gain, 10), minLoss = num_(cfg.min_loss, 10);
  var gain = roundHalfUp_(winBase + (loseAvg - winAvg) * winCoef);
  var loss = roundHalfUp_(lossBase + (loseAvg - winAvg) * lossCoef);
  return { gain: Math.max(minGain, gain), loss: Math.max(minLoss, loss) };
}

function num_(v, d) {
  if (v === '' || v === null || v === undefined) return d;
  var n = Number(v);
  return isNaN(n) ? d : n;
}

function toBool_(v) {
  if (v === true) return true;
  return String(v).toUpperCase() === 'TRUE';
}

function parseIds_(s) {
  if (Array.isArray(s)) return s.map(String).map(function (x) { return x.trim(); }).filter(String);
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; });
}

function toTime_(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return new Date(v).getTime();
}

function pairKey_(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

/**
 * 全試合からレートを再計算する
 * players: [{player_id, name, initial_rating, fixed_rating, active}]
 * matches: [{match_id, started_at, team1_ids, team2_ids, winner, status}]
 * 戻り値: { ratings, fixed, stats, deltas, history, singlesCount, virtual, virtualHistory }
 * virtual: レート固定の人が「ほかの人と同じように変動した場合」のレート（参考値）。
 *   固定レート（settings の virtual_initial_rating が入っていればその値）から始め、各試合で自分のチーム平均だけを参考レートに置き換えて増減を計算する。
 * レート固定の人が ほかの人と組んで出た試合（チームに味方がいる）は、公式の計算でもその人を参考レートとして平均を出す
 *   （味方・相手のレート変動に効く）。1vs1・1人vs複数では固定レートのまま。鴨王本人の公式レートはどちらでも変わらない。
 */
function virtualStart_(cfg) {
  var v = cfg && cfg.virtual_initial_rating;
  if (v === '' || v === null || v === undefined || isNaN(Number(v))) return null;
  return Number(v);
}

function computeRatings(players, matches, cfg) {
  cfg = cfg || {};
  var base = num_(cfg.initial_rating, 1500);
  var ratings = {}, fixed = {}, stats = {}, history = {}, virtual = {}, virtualHistory = {};
  var vStart = virtualStart_(cfg); // 参考レートの開始値（未設定なら null = 固定レートから）
  players.forEach(function (p) {
    var id = String(p.player_id);
    var fr = p.fixed_rating;
    if (fr !== '' && fr !== null && fr !== undefined && !isNaN(Number(fr))) fixed[id] = Number(fr);
    ratings[id] = fixed[id] !== undefined ? fixed[id] : num_(p.initial_rating, base);
    if (fixed[id] !== undefined) { virtual[id] = vStart !== null ? vStart : fixed[id]; virtualHistory[id] = []; }
    stats[id] = { matches: 0, team_matches: 0, wins: 0, losses: 0, solo_wins: 0, solo_losses: 0 }; // solo_*: 自分が1人のチームで出た試合（1vs1・1人vs複数）
    history[id] = [];
  });

  var done = matches.filter(function (m) { return m.status === 'done' && (m.winner == 1 || m.winner == 2); });
  done.sort(function (a, b) {
    var d = toTime_(a.started_at) - toTime_(b.started_at);
    return d !== 0 ? d : String(a.match_id).localeCompare(String(b.match_id));
  });

  var deltas = {};
  done.forEach(function (m) {
    var t1 = parseIds_(m.team1_ids), t2 = parseIds_(m.team2_ids);
    var all = t1.concat(t2);
    if (!t1.length || !t2.length || all.some(function (id) { return ratings[id] === undefined; })) {
      deltas[m.match_id] = { error: '不明な選手を含む' };
      return;
    }
    // 計算に使うレート: レート固定の人（鴨王）は、1人のチーム（1vs1・1人vs複数）なら固定レート、
    // ほかの人と組んだチームなら参考レート（試合前の値）を使う
    var vBefore = {};
    all.forEach(function (id) { if (fixed[id] !== undefined) vBefore[id] = virtual[id]; });
    var eff = function (id, team) { return fixed[id] !== undefined && team.length > 1 ? vBefore[id] : ratings[id]; };
    var avg = function (t) { return t.reduce(function (s, id) { return s + eff(id, t); }, 0) / t.length; };
    var a1 = avg(t1), a2 = avg(t2);
    var w = Number(m.winner);
    var d = w === 1 ? computeDelta(a1, a2, cfg) : computeDelta(a2, a1, cfg);
    var d1 = w === 1 ? d.gain : -d.loss, d2 = w === 1 ? -d.loss : d.gain;
    var isTeam = !(t1.length === 1 && t2.length === 1);
    // レート固定の人の参考レート: 自分を参考レートに置き換えたチーム平均で増減を計算する（公式の計算は変えない）
    var shadow = function (team, opp, won) {
      team.forEach(function (id) {
        if (fixed[id] === undefined) return;
        var own = team.reduce(function (s, x) { return s + (x === id ? vBefore[id] : eff(x, team)); }, 0) / team.length;
        var vd = computeDelta(won ? own : avg(opp), won ? avg(opp) : own, cfg);
        var dv = won ? vd.gain : -vd.loss;
        virtual[id] += dv;
        virtualHistory[id].push({ match_id: m.match_id, at: toTime_(m.started_at), delta: dv, rating: virtual[id] });
      });
    };
    shadow(t1, t2, w === 1);
    shadow(t2, t1, w === 2);
    var apply = function (team, delta, won) {
      team.forEach(function (id) {
        if (fixed[id] === undefined) ratings[id] += delta;
        stats[id].matches++;
        if (isTeam) stats[id].team_matches++;
        if (won) stats[id].wins++; else stats[id].losses++;
        if (team.length === 1) { if (won) stats[id].solo_wins++; else stats[id].solo_losses++; }
        history[id].push({ match_id: m.match_id, at: toTime_(m.started_at), delta: fixed[id] === undefined ? delta : 0, rating: ratings[id] });
      });
    };
    apply(t1, d1, w === 1);
    apply(t2, d2, w === 2);
    deltas[m.match_id] = { team1: d1, team2: d2, avg1: a1, avg2: a2 };
  });

  // 1vs1 の対戦回数（取り消し以外。試合中も数える）
  var singlesCount = {};
  matches.forEach(function (m) {
    if (m.status === 'void') return;
    var t1 = parseIds_(m.team1_ids), t2 = parseIds_(m.team2_ids);
    if (t1.length === 1 && t2.length === 1) {
      var k = pairKey_(t1[0], t2[0]);
      singlesCount[k] = (singlesCount[k] || 0) + 1;
    }
  });

  return { ratings: ratings, fixed: fixed, stats: stats, deltas: deltas, history: history, singlesCount: singlesCount,
           virtual: virtual, virtualHistory: virtualHistory, vsFixed: countVsFixed_(players, matches) };
}

/** players の中のレート固定の人（鴨王）の ID の集合 */
function fixedSet_(players) {
  var f = {};
  players.forEach(function (p) {
    var fr = p.fixed_rating;
    if (fr !== '' && fr !== null && fr !== undefined && !isNaN(Number(fr))) f[String(p.player_id)] = true;
  });
  return f;
}

/**
 * 鴨王が1人のチーム（1vs1・鴨王1人vs複数 ＝ 鴨王を固定レートで計算する試合）と対戦した回数を、相手側の選手ごとに数える。
 * 取り消し（void）以外を数える（試合中も数える）。鴨王がほかの人と組んだ試合は数えない。
 * 戻り値: { 選手ID: { solo: 合計, singles: うち1vs1 } }
 */
function countVsFixed_(players, matches) {
  var f = fixedSet_(players), out = {};
  matches.forEach(function (m) {
    if (m.status === 'void') return;
    var t1 = parseIds_(m.team1_ids), t2 = parseIds_(m.team2_ids);
    [[t1, t2], [t2, t1]].forEach(function (x) {
      var me = x[0], opp = x[1];
      if (!(me.length === 1 && f[me[0]])) return;
      opp.forEach(function (id) {
        if (f[id]) return;
        var c = out[id] || (out[id] = { solo: 0, singles: 0 });
        c.solo++;
        if (opp.length === 1) c.singles++;
      });
    });
  });
  return out;
}

/**
 * 順位表を作る。固定レートの選手（前回王者A）は予選免除なので除外。
 * 並び: 合計(レート+ボーナス) → 最終レート → 試合数 → 名前
 */
function buildRanking(players, result, bonusMap, cfg) {
  cfg = cfg || {};
  var minM = num_(cfg.min_matches, 15), minT = num_(cfg.min_team_matches, 5), q = num_(cfg.qualify_count, 8);
  bonusMap = bonusMap || {};
  var rows = players.filter(function (p) {
    return result.fixed[String(p.player_id)] === undefined && p.active !== false && String(p.active).toUpperCase() !== 'FALSE';
  }).map(function (p) {
    var id = String(p.player_id), st = result.stats[id];
    var bonus = bonusMap[id] || 0, rating = result.ratings[id];
    return {
      player_id: id, name: p.name, rating: rating, bonus: bonus, total: rating + bonus,
      matches: st.matches, team_matches: st.team_matches, wins: st.wins, losses: st.losses,
      eligible: st.matches >= minM && st.team_matches >= minT
    };
  });
  rows.sort(function (a, b) {
    return (b.total - a.total) || (b.rating - a.rating) || (b.matches - a.matches) || String(a.name).localeCompare(String(b.name));
  });
  var pos = 0, eligibleSeen = 0;
  rows.forEach(function (r, i) {
    var prev = rows[i - 1];
    if (!prev || prev.total !== r.total || prev.rating !== r.rating || prev.matches !== r.matches) pos = i + 1;
    r.rank = pos;
    if (r.eligible) { eligibleSeen++; r.qualify_zone = eligibleSeen <= q; } else { r.qualify_zone = false; }
  });
  // 同点で通過ラインをまたぐ場合はプレーオフ対象の印を付ける
  var elig = rows.filter(function (r) { return r.eligible; });
  if (elig.length > q) {
    var last = elig[q - 1], next = elig[q];
    if (last.total === next.total && last.rating === next.rating && last.matches === next.matches) {
      elig.forEach(function (r) {
        if (r.total === last.total && r.rating === last.rating && r.matches === last.matches) r.playoff = true;
      });
    }
  }
  return rows;
}

/* ---------------------------------------------------------------------
 *  特別賞（設計書 第10章）
 * --------------------------------------------------------------------- */
var AWARD_DEFS = [
  { key: 'mvp', name: 'MVP賞', desc: '勝率が最も高い人（最低条件を満たした人が対象。未達の人は暫定）' },
  { key: 'giantkill', name: 'ジャイキリ賞', desc: '格上に勝った試合の最大レート差（王者との試合は除く）' },
  { key: 'kamonegi', name: 'カモネギ賞', desc: '格上に挑んで負けた試合の最大レート差（王者との試合は除く）' },
  { key: 'avgscore', name: '平均得点王', desc: '1セットあたりの平均得点（最低条件を満たした人が対象。未達の人は暫定）' },
  { key: 'streak', name: '連勝王', desc: '最長連勝数' },
  { key: 'rookie', name: 'ルーキー賞', desc: '1回生の中で予選順位が最も高い人' },
  { key: 'coaster', name: 'ジェットコースター賞', desc: '予選中の最高レートと最低レートの差' },
  { key: 'social', name: '社交王', desc: 'チーム戦で組んだ人数（同じ人は1人と数える）' },
  { key: 'pioneer', name: '開拓王', desc: '個人戦で戦った相手の人数（同じ相手は1人と数える）' }
];

/**
 * 有効な試合から、選手ごとに「チーム戦で組んだ人」「個人戦で戦った相手」の集合を作る
 * 戻り値: { partners: {id: {相手id: true}}, opponents: {...} }
 */
function computeMeetings_(matches) {
  var partners = {}, opponents = {};
  var add = function (map, a, b) { var x = map[a] || (map[a] = {}); x[b] = (x[b] || 0) + 1; }; // 値は回数
  matches.forEach(function (m) {
    if (m.status !== 'done' || !(m.winner == 1 || m.winner == 2)) return;
    var t1 = parseIds_(m.team1_ids), t2 = parseIds_(m.team2_ids);
    if (t1.length === 1 && t2.length === 1) { add(opponents, t1[0], t2[0]); add(opponents, t2[0], t1[0]); return; }
    [t1, t2].forEach(function (t) { t.forEach(function (a) { t.forEach(function (b) { if (a !== b) add(partners, a, b); }); }); });
  });
  return { partners: partners, opponents: opponents };
}

/**
 * 個人ページの成績（設計書 第13章）。有効な試合を開始時刻順に見て、選手ごとに
 * 個人戦・チーム戦の勝ち/試合数、1セットあたりの平均得点の元（得点・セット数）、最長連勝・現在の連勝を数える。
 * 平均得点と連勝の数え方は特別賞（平均得点王・連勝王）と同じ。
 */
function computeProfiles(players, matches) {
  var out = {};
  var get = function (id) { return out[id] || (out[id] = { s_w: 0, s_n: 0, t_w: 0, t_n: 0, pts: 0, sets: 0, best: 0, cur: 0, w20: 0, w21: 0, l12: 0, l02: 0 }); };
  var done = matches.filter(function (m) { return m.status === 'done' && (m.winner == 1 || m.winner == 2); });
  done.sort(function (a, b) { return (toTime_(a.started_at) - toTime_(b.started_at)) || String(a.match_id).localeCompare(String(b.match_id)); });
  done.forEach(function (m) {
    var t1 = parseIds_(m.team1_ids), t2 = parseIds_(m.team2_ids), w = Number(m.winner);
    if (!t1.length || !t2.length) return;
    var single = t1.length === 1 && t2.length === 1, setPts = setPoints_(m);
    [[t1, 1], [t2, 2]].forEach(function (x) {
      x[0].forEach(function (id) {
        var o = get(id), won = w === x[1];
        if (single) { o.s_n++; if (won) o.s_w++; } else { o.t_n++; if (won) o.t_w++; }
        if (won) { o.cur++; if (o.cur > o.best) o.best = o.cur; } else o.cur = 0;
        if (setPts) { o.pts += setPts[x[1] - 1]; o.sets += setPts[2]; }
        // セット内訳（2セット先取）: 2-0勝・2-1勝・1-2敗・0-2敗。個人戦のみ（個人ページの「個人戦の成績」に出す）
        if (!single) return;
        var mine = num_(x[1] === 1 ? m.team1_legs : m.team2_legs, -1), theirs = num_(x[1] === 1 ? m.team2_legs : m.team1_legs, -1);
        if (won) { if (theirs === 0) o.w20++; else if (theirs === 1) o.w21++; }
        else { if (mine === 1) o.l12++; else if (mine === 0) o.l02++; }
      });
    });
  });
  Object.keys(out).forEach(function (id) {
    var o = out[id];
    o.wins = o.s_w + o.t_w; o.matches = o.s_n + o.t_n; o.losses = o.matches - o.wins;
    o.avg = o.sets ? Math.round(o.pts / o.sets * 100) / 100 : null;
  });
  return out;
}

/** 試合のセットごとの得点の合計 [チーム1, チーム2, セット数]。得点の記録がなければ null */
function setPoints_(m) {
  var l1 = num_(m.team1_legs, 0), l2 = num_(m.team2_legs, 0);
  if (m.scoring === 'throws' && m.throwList && m.throwList.length) {
    var ls = molkkyReplay(engineMatch_(m), m.throwList).legScores;
    return ls.length ? [ls.reduce(function (s, x) { return s + x[0]; }, 0), ls.reduce(function (s, x) { return s + x[1]; }, 0), ls.length] : null;
  }
  var has = function (v) { return v !== '' && v !== null && v !== undefined; };
  if (has(m.team1_score) && has(m.team2_score) && l1 + l2 > 0) return [num_(m.team1_score, 0), num_(m.team2_score, 0), l1 + l2];
  return null;
}

/** "5:5,10:15,all:100" を [{n:5, pt:5}, ..., {all:true, pt:100}] にする */
function parseTiers_(v, d) {
  var out = [];
  String(v === undefined || v === null || v === '' ? d : v).split(',').forEach(function (x) {
    var kv = x.split(':'); if (kv.length !== 2) return;
    var k = kv[0].trim().toLowerCase(), pt = Number(kv[1]);
    if (isNaN(pt)) return;
    if (k === 'all' || k === '全員') out.push({ all: true, pt: pt });
    else if (!isNaN(Number(k))) out.push({ n: Number(k), pt: pt });
  });
  return out.sort(function (a, b) { return (a.all ? 1e9 : a.n) - (b.all ? 1e9 : b.n); });
}

/** 到達した区分のポイント（区分ごとの合計ではない）と、次の区分 */
function tierPoint_(count, allReached, tiers, allCount) {
  var pt = 0, next = null;
  tiers.forEach(function (t) {
    var ok = t.all ? allReached : count >= t.n;
    if (ok) pt = t.pt;
    else if (!next) next = { need: t.all ? allCount : t.n, pt: t.pt, all: !!t.all };
  });
  return { pt: pt, next: next };
}

/** 追加ボーナス（設計書 第11章）。結果入力の締切を過ぎたら applied=true（ランキングの合計に加える）
 *  レート固定の人（鴨王）も同じ計算で出す（fixed=true）。公式の順位には入れず、参考合計（computeVirtualTotals）にだけ使う */
function computeExtraBonus(players, matches, res, cfg, now) {
  cfg = cfg || {};
  var step = Math.max(1, num_(cfg.bonus_wins_step, 10)), stepPt = num_(cfg.bonus_wins_pt, 10);
  var pTiers = parseTiers_(cfg.bonus_partner_tiers, '5:5,10:15,20:30,30:45,all:100');
  var oTiers = parseTiers_(cfg.bonus_opponent_tiers, '5:5,10:15,20:35,30:55,all:100');
  var rookiePt = num_(cfg.bonus_rookie_pt, 30);
  var deadline = toTime_(cfg.result_deadline);
  var applied = isFinite(deadline) && now >= deadline;
  var meet = computeMeetings_(matches);
  var active = players.filter(function (p) { return p.active !== false; }).map(function (p) { return String(p.player_id); });
  var out = {};
  players.forEach(function (p) {
    var id = String(p.player_id);
    if (p.active === false) return;
    var others = active.filter(function (x) { return x !== id; });
    var pa = meet.partners[id] || {}, op = meet.opponents[id] || {};
    var pc = Object.keys(pa).length, oc = Object.keys(op).length;
    var pAll = others.length > 0 && others.every(function (x) { return pa[x]; });
    var oAll = others.length > 0 && others.every(function (x) { return op[x]; });
    var w = (res.stats[id] || {}).wins || 0;
    var wp = Math.floor(w / step) * stepPt;
    var pt = tierPoint_(pc, pAll, pTiers, others.length), ot = tierPoint_(oc, oAll, oTiers, others.length);
    var rp = isRookie_(p) ? rookiePt : 0;
    out[id] = {
      wins: w, wins_pt: wp, wins_next: { need: (Math.floor(w / step) + 1) * step, pt: wp + stepPt },
      partners: pc, partners_pt: pt.pt, partners_next: pt.next,
      opponents: oc, opponents_pt: ot.pt, opponents_next: ot.next,
      partner_list: pa, opponent_list: op,
      partner_not: others.filter(function (x) { return !pa[x]; }), opponent_not: others.filter(function (x) { return !op[x]; }),
      rookie: isRookie_(p), rookie_pt: rp,
      everyone: others.length, total: wp + pt.pt + ot.pt + rp, applied: applied,
      fixed: res.fixed[id] !== undefined
    };
  });
  return out;
}

/** 参考合計の最低試合数（空欄なら予選の最低試合数 min_matches と同じ） */
function virtualMinMatches_(cfg) {
  var v = cfg && cfg.virtual_min_matches;
  if (v === '' || v === null || v === undefined || isNaN(Number(v))) return num_(cfg && cfg.min_matches, 15);
  return Number(v);
}

/**
 * レート固定の人（鴨王）の参考合計 = 参考レート + ボーナス（手動の bonus シート + 追加ボーナス）。
 * 公式のレート・順位表には使わない。試合数が最低試合数に届くまでは eligible=false（暫定）
 * 戻り値: { id: { virtual_rating, bonus, total, matches, min, eligible } }
 */
function computeVirtualTotals(res, bonusMap, cfg) {
  var out = {}, min = virtualMinMatches_(cfg);
  bonusMap = bonusMap || {};
  Object.keys(res.fixed).forEach(function (id) {
    var v = res.virtual[id], b = bonusMap[id] || 0, n = (res.stats[id] || {}).matches || 0;
    out[id] = { virtual_rating: v, bonus: b, total: v + b, matches: n, min: min, eligible: n >= min };
  });
  return out;
}

/**
 * 全員のスタッツの表（stats シート）の行を作る（全員のスタッツ 設計書）。数字はアプリの個人ページと同じ計算から出す。
 * 並び: ランキング順 → レート固定の人（鴨王）→ 不参加で試合の記録がある人。値は HEADERS.stats の順の配列
 * throwStats は computeThrowStats の結果（投擲成績）。now は更新日時
 */
function buildStatsRows(players, matches, res, ranking, extra, bonusMap, throwStats, cfg, now) {
  cfg = cfg || {}; extra = extra || {}; bonusMap = bonusMap || {}; throwStats = throwStats || {};
  var minM = num_(cfg.min_matches, 15), minT = num_(cfg.min_team_matches, 5), q = num_(cfg.qualify_count, 8);
  var profiles = computeProfiles(players, matches), singles = computeSinglesStats(matches);
  var vTotals = computeVirtualTotals(res, bonusMap, cfg);
  var line = ranking.length >= q ? ranking[q - 1].total : null; // 8位（qualify_count 位）の合計。ランキングの太線と同じ位置
  var blank = function (v) { return v === null || v === undefined || (typeof v === 'number' && !isFinite(v)) ? '' : v; };
  var ratio = function (w, n0) { return n0 ? Math.round(w / n0 * 10000) / 10000 : ''; };
  var pct = function (v) { return v === null || v === undefined || v === '' ? '' : Math.round(v * 10) / 1000; }; // 58.3 → 0.583
  var need = function (n0, t0, mM, mT) {
    var a = Math.max(0, mM - n0), b = Math.max(0, mT - t0);
    if (!a && !b) return '達成';
    if (!b) return 'あと' + a + '試合';
    if (a <= b) return 'あとチーム戦' + b + '試合';
    return 'あと' + a + '試合（うちチーム戦' + b + '）';
  };
  var rowOf = function (p, r, kind) {
    var id = String(p.player_id), fixed = res.fixed[id] !== undefined;
    var pf = profiles[id] || { s_w: 0, s_n: 0, t_w: 0, t_n: 0, wins: 0, losses: 0, matches: 0, avg: null, sets: 0, best: 0, cur: 0, w20: 0, w21: 0, l12: 0, l02: 0 };
    var eb = extra[id], ss1 = singles[id] || {}, ts = throwStats[id], st = res.stats[id] || { matches: 0, team_matches: 0 };
    var rating = res.ratings[id], hist = res.history[id] || [];
    var start = hist.length ? hist[0].rating - hist[0].delta : rating;
    var pts = [start].concat(hist.map(function (x) { return x.rating; }));
    var vt = vTotals[id];
    var head;
    if (r) head = [r.eligible ? r.rank : '暫定' + r.rank, p.name, r.total, line === null ? '' : r.total - line, rating, r.bonus,
                   need(st.matches, st.team_matches, minM, minT), r.qualify_zone ? '通過圏内' : (r.playoff ? 'プレーオフ' : '')];
    else head = [kind, p.name, '', '', rating, '', fixed && vt ? '（参考合計）' + (vt.eligible ? '達成' : 'あと' + (vt.min - vt.matches) + '試合') : '', ''];
    return head.concat([
      pf.matches, pf.wins, pf.losses, ratio(pf.wins, pf.matches),
      pf.s_n, pf.s_w, ratio(pf.s_w, pf.s_n), pf.t_n, pf.t_w, ratio(pf.t_w, pf.t_n),
      pf.best, pf.cur || '', blank(pf.avg), pf.avg === null ? '' : pf.sets,
      fixed ? '' : start, fixed ? '' : Math.max.apply(null, pts), fixed ? '' : Math.min.apply(null, pts), fixed ? '' : rating - start,
      eb ? eb.wins_pt : '', eb ? eb.partners : '', eb ? eb.partners_pt : '', eb ? eb.opponents : '', eb ? eb.opponents_pt : '', eb ? eb.rookie_pt : '',
      pf.w20, pf.w21, pf.l12, pf.l02,
      pct(ss1.hit_rate), blank(ss1.throws), blank(ss1.break_avg), blank(ss1.finish_turns_avg), blank(ss1.lose_avg), pct(ss1.first_rate), pct(ss1.second_rate),
      ts && ts.throws ? pct(ts.hit_rate) : '', ts ? ts.throws : '', ts ? ts.wins : '', ts ? ts.busts : '',
      fixed ? blank(res.virtual[id]) : '', fixed && vt ? vt.total : '',
      now
    ]);
  };
  var byId = {};
  players.forEach(function (p) { byId[String(p.player_id)] = p; });
  var out = ranking.map(function (r) { return rowOf(byId[r.player_id], r); });
  var inRank = {};
  ranking.forEach(function (r) { inRank[r.player_id] = true; });
  players.forEach(function (p) { var id = String(p.player_id); if (res.fixed[id] !== undefined) out.push(rowOf(p, null, '王者')); });
  players.forEach(function (p) {
    var id = String(p.player_id);
    if (inRank[id] || res.fixed[id] !== undefined || !((res.stats[id] || {}).matches > 0)) return;
    out.push(rowOf(p, null, '不参加'));
  });
  return out;
}

/** stats シートを書き直す。シートがなければ作る。見た目の設定に失敗しても再計算は止めない */
function writeStatsSheet_(rows) {
  var ss = ss_(), sh = ss.getSheetByName(SHEET.stats) || ss.insertSheet(SHEET.stats);
  var head = HEADERS.stats, w = head.length, g = [];
  STATS_GROUPS.forEach(function (x) { for (var i = 0; i < x[1]; i++) g.push(i === 0 ? x[0] : ''); });
  var out = [g, head].concat(rows);
  sh.clearContents();
  sh.getRange(1, 1, out.length, w).setValues(out);
  try {
    sh.getRange(1, 1, 2, w).setFontWeight('bold');
    sh.setFrozenRows(2);
    sh.setFrozenColumns(2);
    if (rows.length) {
      STATS_PCT.forEach(function (name) { sh.getRange(3, head.indexOf(name) + 1, rows.length, 1).setNumberFormat('0.0%'); });
      sh.getRange(3, w, rows.length, 1).setNumberFormat('yyyy/mm/dd hh:mm:ss');
    }
    var f = sh.getFilter();
    if (f) f.remove();
    sh.getRange(2, 1, out.length - 1, w).createFilter();
  } catch (e) { /* 見た目だけなので無視 */ }
}

/** players シートの rookie 列（TRUE・○・1）で1回生を判定する */
function isRookie_(p) {
  var v = String(p.rookie === undefined || p.rookie === null ? '' : p.rookie).trim();
  return toBool_(p.rookie) || v === '○' || v === '1';
}

/** 手動の bonus シートと追加ボーナス（ハンデ含む）を合わせる。予選中から合計に入れる（ボーナスは減らないため。設計書 第16章） */
function mergeBonus_(manual, extra) {
  var map = {};
  Object.keys(manual || {}).forEach(function (id) { map[id] = (map[id] || 0) + manual[id]; });
  Object.keys(extra || {}).forEach(function (id) { map[id] = (map[id] || 0) + extra[id].total; });
  return map;
}

/**
 * 個人戦（1対1）を1投ごとに記録した試合から、個人戦の成績を集計する（設計書 第12章）
 * break: 自分が先攻のセットの1投目の得点 / finish: 50点で取ったセットの自分の投擲数 / first・second: 先攻・後攻セットの取得
 */
function computeSinglesStats(matches) {
  var out = {};
  var get = function (id) { return out[id] || (out[id] = { break_sum: 0, break_sets: 0, finish_sum: 0, finish_sets: 0, first_sets: 0, first_won: 0, second_sets: 0, second_won: 0, throws: 0, hits: 0, lose_sum: 0, lose_sets: 0 }); };
  matches.forEach(function (m) {
    if (m.status !== 'done' || m.scoring !== 'throws' || !m.throwList || !m.throwList.length) return;
    var t1 = parseIds_(m.team1_ids), t2 = parseIds_(m.team2_ids);
    if (t1.length !== 1 || t2.length !== 1) return;
    var ids = [t1[0], t2[0]];
    var log = molkkyReplay(engineMatch_(m), m.throwList).log, legs = {};
    log.forEach(function (r) {
      (legs[r.leg] || (legs[r.leg] = [])).push(r);
      var me = get(ids[r.team - 1]); me.throws++; if (r.kind === 'normal') me.hits++; // 個人戦のヒット率
    });
    Object.keys(legs).forEach(function (k) {
      var L = legs[k], last = L[L.length - 1];
      if (last.event !== 'win' && last.event !== 'out') return; // 終わっていないセット
      var firstTeam = L[0].team, winner = last.event === 'win' ? last.team : 3 - last.team;
      var f = get(ids[firstTeam - 1]), sc = get(ids[2 - firstTeam]);
      f.break_sum += L[0].points; f.break_sets++;
      f.first_sets++; if (winner === firstTeam) f.first_won++;
      sc.second_sets++; if (winner !== firstTeam) sc.second_won++;
      // 上がれなかったセット（取られたセット）の、終わったときの自分の得点。3ミス失格は0点
      var loser = 3 - winner, lr = L.filter(function (r) { return r.team === loser; });
      var lo = get(ids[loser - 1]); lo.lose_sets++; lo.lose_sum += lr.length ? lr[lr.length - 1].score_after : 0;
      if (last.event === 'win') { var w = get(ids[winner - 1]); w.finish_sets++; w.finish_sum += L.filter(function (r) { return r.team === winner; }).length; }
    });
  });
  Object.keys(out).forEach(function (id) {
    var x = out[id];
    x.break_avg = x.break_sets ? Math.round(x.break_sum / x.break_sets * 100) / 100 : null;
    x.finish_turns_avg = x.finish_sets ? Math.round(x.finish_sum / x.finish_sets * 10) / 10 : null;
    x.first_rate = x.first_sets ? Math.round(x.first_won / x.first_sets * 1000) / 10 : null;
    x.second_rate = x.second_sets ? Math.round(x.second_won / x.second_sets * 1000) / 10 : null;
    x.lose_avg = x.lose_sets ? Math.round(x.lose_sum / x.lose_sets * 10) / 10 : null;
    x.hit_rate = x.throws ? Math.round(x.hits / x.throws * 1000) / 10 : null;
  });
  return out;
}

/** 値の大きい順に並べ、同じ値は同じ順位にして3位までを返す。same(a,b) が true なら同順位 */
function topRanks_(list, cmp, same) {
  list.sort(cmp);
  var out = [], rank = 0;
  for (var i = 0; i < list.length; i++) {
    if (i === 0 || !same(list[i - 1], list[i])) rank = i + 1;
    if (rank > 3) break;
    list[i].rank = rank;
    out.push(list[i]);
  }
  return out;
}

function shortDate_(t) {
  if (!isFinite(t)) return '';
  var d = new Date(t + 9 * 3600000); // 日本時間
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
}

/**
 * 特別賞を計算する。王者（レート固定の人）と参加中でない人は受賞の対象外。
 * 戻り値: { awards: [{key, name, desc, entries: [{rank, player_id, name, value, detail}]}], memorial: {step, entries: [{n, match_id, at, ids, names}]} }
 */
function computeAwards(players, matches, res, ranking, cfg) {
  cfg = cfg || {};
  var minM = num_(cfg.min_matches, 15), minT = num_(cfg.min_team_matches, 5), step = Math.max(1, num_(cfg.memorial_step, 100));
  var name = {}, target = {}, rookie = {};
  players.forEach(function (p) {
    var id = String(p.player_id);
    name[id] = String(p.name);
    target[id] = res.fixed[id] === undefined && p.active !== false;
    rookie[id] = isRookie_(p);
  });
  var names = function (ids) { return ids.map(function (id) { return name[id] || id; }).join('・'); };
  var done = matches.filter(function (m) { return m.status === 'done' && (m.winner == 1 || m.winner == 2) && res.deltas[m.match_id] && !res.deltas[m.match_id].error; });
  done.sort(function (a, b) { return (toTime_(a.started_at) - toTime_(b.started_at)) || String(a.match_id).localeCompare(String(b.match_id)); });

  var acc = {};
  Object.keys(target).forEach(function (id) {
    acc[id] = { gk: null, kn: null, pts: 0, sets: 0, cur: 0, best: 0 };
  });
  var memorial = [];
  done.forEach(function (m, idx) {
    var t1 = parseIds_(m.team1_ids), t2 = parseIds_(m.team2_ids), w = Number(m.winner), d = res.deltas[m.match_id];
    var l1 = num_(m.team1_legs, 0), l2 = num_(m.team2_legs, 0);
    var hasFixed = t1.concat(t2).some(function (id) { return res.fixed[id] !== undefined; });
    var at = toTime_(m.started_at);
    // セットごとの得点（1投ごとの記録はセット終了時の得点、結果入力は得点合計 ÷ セット数）
    var setPts = setPoints_(m);
    [[t1, 1, d.avg1, d.avg2, t2, l1, l2], [t2, 2, d.avg2, d.avg1, t1, l2, l1]].forEach(function (x) {
      var team = x[0], side = x[1], own = x[2], opp = x[3], won = w === side;
      var info = { match_id: m.match_id, at: at, vs: names(x[4]), legs: x[5] + '-' + x[6], own: Math.round(own * 10) / 10, opp: Math.round(opp * 10) / 10, team: team.length > 1 || x[4].length > 1 };
      team.forEach(function (id) {
        var a = acc[id];
        if (!a) return;
        if (won) { a.cur++; if (a.cur > a.best) a.best = a.cur; } else a.cur = 0;
        if (!hasFixed && own < opp) {
          var diff = Math.round((opp - own) * 10) / 10;
          if (won && (!a.gk || diff > a.gk.value)) a.gk = { value: diff, info: info };
          if (!won && (!a.kn || diff > a.kn.value)) a.kn = { value: diff, info: info };
        }
        if (setPts) { a.pts += setPts[side - 1]; a.sets += setPts[2]; }
      });
    });
    if ((idx + 1) % step === 0) {
      var wt = w === 1 ? t1 : t2;
      memorial.push({ n: idx + 1, match_id: m.match_id, at: at, ids: wt, names: names(wt) });
    }
  });

  var ids = Object.keys(target).filter(function (id) { return target[id]; });
  var st = function (id) { return res.stats[id] || { matches: 0, team_matches: 0, wins: 0, losses: 0 }; };
  var eligible = function (id) { return st(id).matches >= minM && st(id).team_matches >= minT; };
  var entry = function (id, value, detail, extra) { var e = { player_id: id, name: name[id], value: value, detail: detail || '' }; if (extra) for (var k in extra) e[k] = extra[k]; return e; };
  var desc = function (a, b) { return b.value - a.value; };
  var sameV = function (a, b) { return a.value === b.value; };
  var matchDetail = function (i) { return shortDate_(i.at) + ' vs ' + i.vs + ' ' + i.legs + '（当時のレート' + (i.team ? '・チーム平均' : '') + ' ' + i.own + ' vs ' + i.opp + '）'; };
  // 最低条件のある賞: 満たした人を先に並べ、未達の人も暫定として続ける
  var condCmp = function (a, b) { return (Number(b.eligible) - Number(a.eligible)) || (b.value - a.value) || ((b.wins || 0) - (a.wins || 0)); };
  var condSame = function (a, b) { return a.eligible === b.eligible && a.value === b.value && (a.wins || 0) === (b.wins || 0); };
  var condNote = function (id, text) { return eligible(id) ? text : '暫定（最低条件 未達）' + (text ? '・' + text : ''); };
  var out = {};

  out.mvp = topRanks_(ids.filter(function (id) { return st(id).matches > 0; }).map(function (id) {
    var s = st(id);
    return entry(id, Math.round(s.wins / s.matches * 1000) / 10, condNote(id, s.wins + '勝' + s.losses + '敗'), { wins: s.wins, eligible: eligible(id), frac: s.wins + '/' + s.matches });
  }), condCmp, condSame);
  out.giantkill = topRanks_(ids.filter(function (id) { return acc[id].gk; }).map(function (id) { return entry(id, acc[id].gk.value, matchDetail(acc[id].gk.info)); }), desc, sameV);
  out.kamonegi = topRanks_(ids.filter(function (id) { return acc[id].kn; }).map(function (id) { return entry(id, acc[id].kn.value, matchDetail(acc[id].kn.info)); }), desc, sameV);
  out.avgscore = topRanks_(ids.filter(function (id) { return acc[id].sets > 0; }).map(function (id) {
    return entry(id, Math.round(acc[id].pts / acc[id].sets * 100) / 100, condNote(id, acc[id].sets + 'セット・計' + acc[id].pts + '点'), { eligible: eligible(id) });
  }), condCmp, condSame);
  out.streak = topRanks_(ids.filter(function (id) { return acc[id].best > 0; }).map(function (id) { return entry(id, acc[id].best); }), desc, sameV);
  // ルーキー賞: 最低条件を満たした人を先に、ランキングの順位順
  var rk = {};
  (ranking || []).forEach(function (r) { rk[r.player_id] = r; });
  out.rookie = topRanks_(ids.filter(function (id) { return rookie[id] && rk[id]; }).map(function (id) {
    return entry(id, rk[id].rank, rk[id].eligible ? '' : '暫定（最低条件 未達）', { eligible: rk[id].eligible });
  }), function (a, b) { return (Number(b.eligible) - Number(a.eligible)) || (a.value - b.value); },
      function (a, b) { return a.eligible === b.eligible && a.value === b.value; });
  out.coaster = topRanks_(ids.filter(function (id) { return (res.history[id] || []).length; }).map(function (id) {
    var h = res.history[id], first = h[0].rating - h[0].delta, hi = first, lo = first;
    h.forEach(function (x) { if (x.rating > hi) hi = x.rating; if (x.rating < lo) lo = x.rating; });
    return entry(id, hi - lo, '最高' + hi + '・最低' + lo);
  }).filter(function (e) { return e.value > 0; }), desc, sameV);

  var meet = computeMeetings_(matches);
  var countOf = function (map, id) { return Object.keys(map[id] || {}).length; };
  out.social = topRanks_(ids.filter(function (id) { return countOf(meet.partners, id) > 0; }).map(function (id) { return entry(id, countOf(meet.partners, id)); }), desc, sameV);
  out.pioneer = topRanks_(ids.filter(function (id) { return countOf(meet.opponents, id) > 0; }).map(function (id) { return entry(id, countOf(meet.opponents, id)); }), desc, sameV);

  return {
    awards: AWARD_DEFS.map(function (a) {
      return { key: a.key, name: a.name, desc: a.desc, entries: out[a.key].map(function (e) { return { rank: e.rank, player_id: e.player_id, name: e.name, value: e.value, detail: e.detail, provisional: e.eligible === false, frac: e.frac }; }) };
    }),
    memorial: { step: step, entries: memorial }
  };
}

/**
 * 試合開始の入力チェック。問題があればエラーメッセージ、なければ null
 */
function validateStart(team1, team2, players, matches, cfg, now) {
  var maxSize = num_(cfg.max_team_size, 4), maxSingles = num_(cfg.max_singles_vs_same, 3);
  var startAt = toTime_(cfg.start_at), endAt = toTime_(cfg.end_at);
  if (!isNaN(startAt) && now < startAt) return '予選はまだ始まっていません';
  if (!isNaN(endAt) && now >= endAt) return '試合開始の締切を過ぎています';
  if (team1.length < 1 || team2.length < 1) return '各チーム1人以上を選んでください';
  if (team1.length > maxSize || team2.length > maxSize) return '1チームは' + maxSize + '人までです';
  var all = team1.concat(team2), seen = {};
  for (var i = 0; i < all.length; i++) {
    if (seen[all[i]]) return '同じ人が2回選ばれています';
    seen[all[i]] = true;
  }
  var byId = {};
  players.forEach(function (p) { byId[String(p.player_id)] = p; });
  for (var j = 0; j < all.length; j++) {
    var p = byId[all[j]];
    if (!p) return '登録されていない選手です: ' + all[j];
    if (p.active === false || String(p.active).toUpperCase() === 'FALSE') return '参加中ではない選手です: ' + p.name;
  }
  // 試合中の人は新しい試合を始められない
  var busy = {};
  matches.forEach(function (m) {
    if (m.status === 'playing') parseIds_(m.team1_ids).concat(parseIds_(m.team2_ids)).forEach(function (id) { busy[id] = true; });
  });
  for (var k = 0; k < all.length; k++) {
    if (busy[all[k]]) return byId[all[k]].name + ' さんは別の試合中です（先に結果を入力してください）';
  }
  if (team1.length === 1 && team2.length === 1) {
    var cnt = 0, key = pairKey_(team1[0], team2[0]);
    matches.forEach(function (m) {
      if (m.status === 'void') return;
      var a = parseIds_(m.team1_ids), b = parseIds_(m.team2_ids);
      if (a.length === 1 && b.length === 1 && pairKey_(a[0], b[0]) === key) cnt++;
    });
    if (cnt >= maxSingles) return 'この2人の1vs1はすでに' + maxSingles + '試合行っています';
  }
  // 鴨王が1人のチーム（固定レートで計算する試合）との対戦は1人あたり max_vs_fixed_solo 試合まで、うち1vs1は max_vs_fixed_singles 試合まで
  var fx = fixedSet_(players), maxSolo = num_(cfg.max_vs_fixed_solo, 5), maxFS = num_(cfg.max_vs_fixed_singles, 3);
  var vsF = null;
  var pairs = [[team1, team2], [team2, team1]];
  for (var q = 0; q < pairs.length; q++) {
    var me = pairs[q][0], opp = pairs[q][1];
    if (!(me.length === 1 && fx[me[0]])) continue;
    vsF = vsF || countVsFixed_(players, matches);
    for (var r = 0; r < opp.length; r++) {
      if (fx[opp[r]]) continue;
      var c = vsF[opp[r]] || { solo: 0, singles: 0 }, nm = byId[opp[r]].name;
      if (c.solo >= maxSolo) return nm + ' さんは鴨王が1人のチームとの対戦（1vs1・鴨王1人vs複数）がすでに' + maxSolo + '試合です（鴨王がほかの人と組む試合はできます）';
      if (opp.length === 1 && c.singles >= maxFS) return nm + ' さんは鴨王との1vs1がすでに' + maxFS + '試合です（鴨王1人vs複数、鴨王がほかの人と組む試合はできます）';
    }
  }
  return null;
}

/** 結果のチェック（2セット先取） */
function validateResult(legs1, legs2) {
  legs1 = Number(legs1); legs2 = Number(legs2);
  if (!(legs1 >= 0 && legs1 <= 2 && legs2 >= 0 && legs2 <= 2) || legs1 % 1 || legs2 % 1) return 'セット数は0〜2で入力してください';
  if (!((legs1 === 2) !== (legs2 === 2))) return 'どちらか一方が2セットになるよう入力してください';
  return null;
}

/* ENGINE START — 1投ごとのスコア計算（Code.gs と index.html に同じものが入る。編集は engine.js で行い、node test/build.js で反映） */
/**
 * 投擲の列を最初から再生して、試合の現在の状態を返す。
 * match: {
 *   team1, team2: [選手ID...]（1セット目の投擲順）, first_team: 1|2（1セット目の先攻）,
 *   use_order: 個人の投擲順を入れるか, leg3_first: 1|2|null（3セット目の先攻）,
 *   leg_orders: [[team1順, team2順], ...]（セットごとの投擲順。1セット目は省略可）
 * }
 * throws: [{ kind: 'normal'|'miss'|'foul', points: 1〜12 }]（投げた人・チームは順番から自動で決まる）
 *   points の代わりに pins: [倒れたピンの番号...] でも受け付ける（1本ならその数字、2本以上なら本数）
 */
function molkkyReplay(match, throws) {
  var first = Number(match.first_team) === 2 ? 2 : 1;
  var st = {
    leg: 1, legsWon: [0, 0], scores: [0, 0], misses: [0, 0], legScores: [], totals: [0, 0],
    legFirst: first, turn: first, playerIdx: [0, 0], finished: false, winner: null,
    needSetup: false, needFirst: false, needOrder: false, leg3Chooser: null,
    orders: [], log: [], error: null
  };
  var teams = [match.team1 || [], match.team2 || []];
  function orderFor(leg) {
    var lo = match.leg_orders && match.leg_orders[leg - 1];
    if (lo && lo[0] && lo[0].length && lo[1] && lo[1].length) return [lo[0].slice(), lo[1].slice()];
    if (leg === 1 || (teams[0].length <= 1 && teams[1].length <= 1)) return [teams[0].slice(), teams[1].slice()]; // 個人戦は選び直し不要
    return null;
  }
  function startLeg() {
    st.needSetup = st.needFirst = st.needOrder = false;
    st.scores = [0, 0]; st.misses = [0, 0]; st.playerIdx = [0, 0];
    if (st.leg === 1) st.legFirst = first;
    else if (st.leg === 2) st.legFirst = 3 - first; // 2セット目は1セット目の後攻チームが先攻
    else {
      // 3セット目: 2セット目終了時点の総得点が高いチームが先攻を選ぶ（同点はドローショット）
      st.leg3Chooser = st.totals[0] > st.totals[1] ? 1 : st.totals[1] > st.totals[0] ? 2 : 0;
      if (match.leg3_first === 1 || match.leg3_first === 2) st.legFirst = match.leg3_first;
      else { st.legFirst = null; st.needFirst = true; }
    }
    var o = orderFor(st.leg);
    if (match.use_order && st.leg > 1 && !o) st.needOrder = true; // 2セット目以降は投擲順を選び直す
    var prev = st.orders[st.leg - 2] || [teams[0].slice(), teams[1].slice()];
    if (!o && st.leg === 2) prev = [prev[0].slice().reverse(), prev[1].slice().reverse()]; // 2セット目のチーム内の投擲順は、1セット目の逆順を初期値にする
    st.orders[st.leg - 1] = o || prev;
    st.needSetup = st.needFirst || st.needOrder;
    st.turn = st.legFirst;
  }
  function nextPlayer(team) {
    if (!match.use_order) return '';
    var list = st.orders[st.leg - 1][team - 1];
    return list.length ? list[st.playerIdx[team - 1] % list.length] : '';
  }
  function endLeg(winTeam) {
    st.legsWon[winTeam - 1]++;
    st.legScores.push([st.scores[0], st.scores[1]]);
    st.totals[0] += st.scores[0]; st.totals[1] += st.scores[1];
    if (st.legsWon[winTeam - 1] >= 2) { st.finished = true; st.winner = winTeam; return; }
    st.leg++;
    startLeg();
  }
  startLeg();
  for (var i = 0; i < throws.length; i++) {
    var t = throws[i] || {};
    if (st.finished) { st.error = '試合はすでに終わっています（' + (i + 1) + '投目）'; break; }
    if (st.needSetup) { st.error = st.leg + 'セット目の' + (st.needFirst ? '先攻' : '投擲順') + 'が決まっていません'; break; }
    var team = st.turn, k = team - 1;
    var pins = (t.pins || []).map(Number).filter(function (p) { return p >= 1 && p <= 12 && p % 1 === 0; });
    var given = Number(t.points);
    var hasPoints = given >= 1 && given <= 12 && given % 1 === 0;
    if (t.kind === 'normal' && t.points !== undefined && t.points !== null && !hasPoints) { st.error = '得点は1〜12で入力してください（' + (i + 1) + '投目）'; break; }
    var kind = t.kind === 'foul' ? 'foul' : (t.kind === 'miss' || (!hasPoints && pins.length === 0) ? 'miss' : 'normal');
    if (kind !== 'normal' || hasPoints) pins = [];
    var seen = {};
    for (var j = 0; j < pins.length; j++) { if (seen[pins[j]]) { st.error = '同じピンが2回あります'; break; } seen[pins[j]] = 1; }
    if (st.error) break;
    var points = kind !== 'normal' ? 0 : hasPoints ? given : (pins.length === 1 ? pins[0] : pins.length);
    var rec = { leg: st.leg, team: team, player: nextPlayer(team), kind: kind, pins: pins, points: points, event: '' };
    if (kind === 'normal') {
      st.misses[k] = 0;
      var sc = st.scores[k] + points;
      if (sc > 50) { sc = 25; rec.event = 'bust'; } // 50を超えたらバースト（25点に戻る）
      st.scores[k] = sc;
      if (sc === 50) rec.event = 'win';
    } else {
      st.misses[k]++;
      if (st.misses[k] >= 3) { rec.event = 'out'; st.scores[k] = 0; } // 3回連続ミスで失格。失格したチームは0点
    }
    rec.score_after = st.scores[k]; rec.miss_streak = st.misses[k];
    st.log.push(rec);
    st.playerIdx[k]++;
    if (rec.event === 'win') endLeg(team);
    else if (rec.event === 'out') { st.scores[2 - team] = 50; endLeg(3 - team); } // 相手が3ミスなら自分たちは50点、相手は0点
    else st.turn = 3 - team;
  }
  st.nextTeam = st.finished || st.needSetup || st.error ? null : st.turn;
  st.nextPlayer = st.nextTeam ? nextPlayer(st.nextTeam) : '';
  return st;
}

/** 倒れたピンから得点を出す（1本ならその数字、2本以上なら本数） */
function molkkyPoints(pins) { return !pins || !pins.length ? 0 : pins.length === 1 ? Number(pins[0]) : pins.length; }
/* ENGINE END */

function parseJson_(v, d) {
  if (v === '' || v === null || v === undefined) return d;
  try { return JSON.parse(v); } catch (e) { return d; }
}

/** シートの試合行から engine 用の試合情報を作る */
function engineMatch_(m) {
  return { team1: parseIds_(m.team1_ids), team2: parseIds_(m.team2_ids), first_team: m.first_team,
           use_order: m.use_order, leg3_first: m.leg3_first, leg_orders: m.legOrders };
}

/** セットごとの投擲順が、各チームのメンバーの並べ替えになっているか確かめる */
function validateLegOrders(legOrders, team1, team2) {
  if (!Array.isArray(legOrders)) return '投擲順の形式が違います';
  var same = function (a, b) { return Array.isArray(a) && a.length === b.length && a.slice().sort().join(',') === b.slice().sort().join(','); };
  for (var i = 0; i < legOrders.length; i++) {
    var lo = legOrders[i];
    if (lo === null || lo === undefined) continue;
    if (!Array.isArray(lo) || !same(lo[0], team1) || !same(lo[1], team2)) return (i + 1) + 'セット目の投擲順がチームのメンバーと合いません';
  }
  return null;
}

/**
 * 投擲データから選手ごとの成績を集計する（個人の投擲順を入れた試合だけが対象）
 * rows: throws シートの行、doneIds: 有効な試合IDの集合
 */
function computeThrowStats(rows, doneIds) {
  var st = {};
  rows.forEach(function (r) {
    var id = String(r.player_id || '');
    if (!id || !doneIds[String(r.match_id)]) return;
    var x = st[id] || (st[id] = { throws: 0, points: 0, misses: 0, wins: 0, busts: 0 });
    x.throws++;
    x.points += num_(r.points, 0);
    if (r.kind === 'miss' || r.kind === 'foul') x.misses++;
    if (r.event === 'win') x.wins++;
    if (r.event === 'bust') x.busts++;
  });
  Object.keys(st).forEach(function (id) {
    var x = st[id];
    x.hits = x.throws - x.misses;
    x.hit_rate = x.throws ? Math.round(x.hits / x.throws * 1000) / 10 : 0; // ヒット率（%）= ミス以外の投擲の割合
  });
  return st;
}

/* =====================================================================
 *  スプレッドシート連携
 * ===================================================================== */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」がありません。メニューの「鴨王戦 > 初期設定」を実行してください');
  return sh;
}

/** シートを {列名: 値} の配列で読む。_row に行番号を入れる */
function readTable_(name) {
  var values = sheet_(name).getDataRange().getValues();
  if (values.length < 1) return [];
  var head = values[0].map(String);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    var o = { _row: r + 1 };
    head.forEach(function (h, i) { if (h) o[h] = row[i]; });
    out.push(o);
  }
  return out;
}

function readSettings_() {
  var cfg = {};
  readTable_(SHEET.settings).forEach(function (r) { cfg[String(r.key)] = r.value; });
  return cfg;
}

function readPlayers_() {
  return readTable_(SHEET.players).map(function (p) {
    p.player_id = String(p.player_id).trim();
    p.active = p.active === '' || p.active === undefined ? true : toBool_(p.active);
    return p;
  }).filter(function (p) { return p.player_id; });
}

function readMatches_() {
  return readTable_(SHEET.matches).map(function (m) {
    m.match_id = String(m.match_id);
    m.status = String(m.status || '').trim();
    m.scoring = String(m.scoring || '').trim() === 'throws' ? 'throws' : 'manual';
    m.use_order = toBool_(m.use_order);
    m.first_team = Number(m.first_team) === 2 ? 2 : 1;
    m.leg3_first = Number(m.leg3_first) === 1 || Number(m.leg3_first) === 2 ? Number(m.leg3_first) : null;
    m.rev = num_(m.rev, 0);
    m.scorer = String(m.scorer || '');
    m.throwList = parseJson_(m.throws_json, []);
    m.legOrders = parseJson_(m.leg_orders, []);
    return m;
  });
}

function readBonus_() {
  var map = {};
  try {
    readTable_(SHEET.bonus).forEach(function (b) {
      var id = String(b.player_id).trim();
      if (id) map[id] = (map[id] || 0) + num_(b.points, 0);
    });
  } catch (e) { /* bonus シートが無ければ 0 */ }
  return map;
}

function colIndex_(name, col) { return HEADERS[name].indexOf(col) + 1; }

function setCells_(name, row, obj) {
  var sh = sheet_(name);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  Object.keys(obj).forEach(function (k) {
    var c = head.indexOf(k);
    if (c >= 0) sh.getRange(row, c + 1).setValue(obj[k]);
  });
}

function appendObj_(name, obj) {
  var sh = sheet_(name);
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function log_(action, by, detail) {
  try { appendObj_(SHEET.log, { at: new Date(), action: action, by: by || '', detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); } catch (e) { /* ログ失敗は無視 */ }
}

/** 再計算して ranking シートと matches の delta 列を更新する */
function recalc() {
  var cfg = readSettings_(), players = readPlayers_(), matches = readMatches_(), bonus = readBonus_();
  var res = computeRatings(players, matches, cfg);
  var now = new Date();
  var extra = computeExtraBonus(players, matches, res, cfg, now.getTime());
  var rows = buildRanking(players, res, mergeBonus_(bonus, extra), cfg);

  // ranking シート
  var sh = sheet_(SHEET.ranking);
  sh.clearContents();
  var out = [HEADERS.ranking].concat(rows.map(function (r) {
    return [r.rank, r.player_id, r.name, r.rating, r.bonus, r.total, r.matches, r.team_matches,
            r.eligible ? '○' : '', r.qualify_zone ? '通過圏内' : (r.playoff ? 'プレーオフ' : ''), now];
  }));
  sh.getRange(1, 1, out.length, HEADERS.ranking.length).setValues(out);

  // matches の delta 列（確認用）
  var msh = sheet_(SHEET.matches);
  // 列の位置は見出しで探す（古いシートに列が多くてもずれないように）
  var mhead = msh.getRange(1, 1, 1, msh.getLastColumn()).getValues()[0].map(String);
  var c1 = mhead.indexOf('delta_team1') + 1;
  if (matches.length && c1 > 0 && mhead[c1] === 'delta_team2') {
    var lastRow = matches[matches.length - 1]._row;
    var vals = [];
    for (var r = 2; r <= lastRow; r++) vals.push(['', '']);
    matches.forEach(function (m) {
      var d = res.deltas[m.match_id];
      if (d && d.team1 !== undefined) vals[m._row - 2] = [d.team1, d.team2];
      else if (d && d.error) vals[m._row - 2] = [d.error, ''];
    });
    msh.getRange(2, c1, vals.length, 2).setValues(vals);
  }
  // 選手ごとの投擲成績（player_stats シート）。無効にした試合は除く
  var tsh = ss_().getSheetByName(SHEET.throws), psh = ss_().getSheetByName(SHEET.player_stats);
  if (tsh && psh) {
    var doneIds = {};
    matches.forEach(function (m) { if (m.status === 'done') doneIds[m.match_id] = true; });
    var ts = computeThrowStats(readTable_(SHEET.throws), doneIds), ss1 = computeSinglesStats(matches);
    psh.clearContents();
    var pout = [HEADERS.player_stats];
    var blank = function (v) { return v === null || v === undefined ? '' : v; };
    players.forEach(function (p) {
      var x = ts[p.player_id], y = ss1[p.player_id];
      if (!x && !y) return;
      x = x || { throws: 0, hits: 0, hit_rate: '', points: 0, misses: 0, wins: 0, busts: 0 };
      y = y || {};
      pout.push([p.player_id, p.name, x.throws, x.hits, x.throws ? x.hit_rate : '', x.points, x.misses, x.wins, x.busts,
                 blank(y.break_avg), blank(y.break_sets), blank(y.finish_turns_avg), blank(y.finish_sets),
                 blank(y.first_sets), blank(y.first_won), blank(y.first_rate), blank(y.second_sets), blank(y.second_won), blank(y.second_rate),
                 blank(y.throws), blank(y.hits), blank(y.hit_rate), blank(y.lose_avg), blank(y.lose_sets), now]);
    });
    psh.getRange(1, 1, pout.length, HEADERS.player_stats.length).setValues(pout);
  }
  // 全員のスタッツ（stats シート。見るだけの表）
  var tStats = ts || {};
  if (!ts && tsh) {
    var doneIds2 = {};
    matches.forEach(function (m) { if (m.status === 'done') doneIds2[m.match_id] = true; });
    tStats = computeThrowStats(readTable_(SHEET.throws), doneIds2);
  }
  writeStatsSheet_(buildStatsRows(players, matches, res, rows, extra, mergeBonus_(bonus, extra), tStats, cfg, now));
  // 追加ボーナス（extra_bonus シート）
  var esh = ss_().getSheetByName(SHEET.extra_bonus);
  if (esh) {
    var eout = [HEADERS.extra_bonus];
    players.forEach(function (p) {
      var e = extra[p.player_id];
      if (e) eout.push([p.player_id, p.name, e.wins, e.wins_pt, e.partners, e.partners_pt, e.opponents, e.opponents_pt, e.rookie_pt, e.total, e.applied ? '締切後' : '予選中', now]);
    });
    esh.clearContents();
    esh.getRange(1, 1, eout.length, HEADERS.extra_bonus.length).setValues(eout);
  }
  // 特別賞（awards シート）
  var ash = ss_().getSheetByName(SHEET.awards);
  if (ash) {
    var aw = computeAwards(players, matches, res, rows, cfg), aout = [HEADERS.awards];
    aw.awards.forEach(function (a) {
      a.entries.forEach(function (e) { aout.push([a.name, e.rank, e.player_id, e.name, e.value, e.detail, now]); });
    });
    aw.memorial.entries.forEach(function (e) { aout.push(['メモリアル賞', e.n + '戦目', e.ids.join(','), e.names, e.n, shortDate_(e.at), now]); });
    ash.clearContents();
    ash.getRange(1, 1, aout.length, HEADERS.awards.length).setValues(aout);
  }
  return { players: players, matches: matches, cfg: cfg, result: res, ranking: rows, bonus: bonus };
}

/* =====================================================================
 *  API（画面から呼ばれる）
 * ===================================================================== */

function api(action, payload) {
  var out;
  try {
    out = { ok: true, data: handle_(action, payload || {}) };
  } catch (e) {
    out = { ok: false, error: String(e && e.message ? e.message : e) };
  }
  // google.script.run は日付（Date）や NaN を含む値を画面に返せず、null になってしまう。
  // JSON を一度通して、画面に渡せる形（日付は文字列、NaN は null）にそろえる
  return JSON.parse(JSON.stringify(out));
}

function handle_(action, p) {
  if (action === 'state') return publicState_();
  if (action === 'matchThrows') { // 履歴タブのスコア表用（読み取りのみ。設計書 第17章）
    var mt = readMatches_().filter(function (x) { return x.match_id === String(p.match_id || ''); })[0];
    if (!mt) throw new Error('試合が見つかりません');
    return { throws: mt.scoring === 'throws' ? mt.throwList : [], leg_orders: mt.legOrders };
  }
  if (action === 'watch') { // 試合タブの観戦（読み取りのみ。ロックも書き込みもしないので、記録中の端末に影響しない。設計書 第21章）
    var wm = readMatches_().filter(function (x) { return x.match_id === String(p.match_id || ''); })[0];
    if (!wm) throw new Error('試合が見つかりません');
    return { now: Date.now(), match: { id: wm.match_id, status: wm.status, scoring: wm.scoring, rev: wm.rev, scorer: wm.scorer,
      team1: parseIds_(wm.team1_ids), team2: parseIds_(wm.team2_ids), first_team: wm.first_team, use_order: wm.use_order,
      leg3_first: wm.leg3_first, legs1: wm.team1_legs, legs2: wm.team2_legs, winner: wm.winner === '' ? null : Number(wm.winner),
      started_at: toTime_(wm.started_at), throws: wm.scoring === 'throws' ? wm.throwList : [], leg_orders: wm.legOrders } };
  }
  if (action === 'schedule') return scheduleState_(); // 日程タブ（読み取りのみ。日程調整 設計書）
  if (action === 'schedSet' || action === 'schedLeave') {
    var slock = LockService.getScriptLock();
    slock.waitLock(20000);
    try { return schedWrite_(action, p); } finally { slock.releaseLock(); }
  }
  var writeActions = { start: 1, result: 1, cancel: 1, sync: 1, adminVoid: 1, adminRestore: 1, adminRecalc: 1, adminCheck: 1, adminSetting: 1 };
  if (!writeActions[action]) throw new Error('不明な操作です: ' + action);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cfg = readSettings_(), players = readPlayers_(), matches = readMatches_();
    var now = Date.now();
    if (action.indexOf('admin') === 0) {
      if (String(p.admin_key || '') !== String(cfg.admin_key) || String(cfg.admin_key) === '') throw new Error('運営パスワードが違います');
      if (action === 'adminCheck') return { ok: true };
      if (action === 'adminRecalc') { recalc(); log_('adminRecalc', 'admin', ''); return publicState_(); }
      if (action === 'adminSetting') {
        var sk = String(p.key || '');
        if (!ADMIN_SETTINGS.hasOwnProperty(sk)) throw new Error('この設定は変更できません: ' + sk);
        var sv;
        if (ADMIN_SETTINGS[sk] === 'bool') sv = p.value === true || String(p.value).toUpperCase() === 'TRUE';
        else if (ADMIN_SETTINGS[sk] === 'count') {
          // 試合数: 空欄は「予選の最低試合数と同じ」。それ以外は 0〜500 の整数
          var rc = String(p.value === undefined || p.value === null ? '' : p.value).trim();
          if (rc === '') sv = '';
          else {
            sv = Number(rc);
            if (!/^\d+$/.test(rc) || sv > 500) throw new Error('試合数は 0〜500 の整数で入れてください');
          }
        } else {
          // レート: 空欄は「固定レートから」。それ以外は 0〜5000 の整数
          var raw = String(p.value === undefined || p.value === null ? '' : p.value).trim();
          if (raw === '') sv = '';
          else {
            sv = Number(raw);
            if (!/^-?\d+$/.test(raw) || sv < 0 || sv > 5000) throw new Error('レートは 0〜5000 の整数で入れてください');
          }
        }
        setSetting_(sk, sv);
        log_('adminSetting', 'admin', { key: sk, value: sv });
        return publicState_();
      }
      var m0 = findMatch_(matches, p.match_id);
      setCells_(SHEET.matches, m0._row, { status: action === 'adminVoid' ? 'void' : (m0.winner ? 'done' : 'playing'), note: p.note || m0.note || '' });
      log_(action, 'admin', { match_id: p.match_id, note: p.note || '' });
      recalc();
      return publicState_();
    }

    // 記録者は選ばない。誰の端末から操作したかだけ、端末ごとのランダムな記号で記録する
    var device = deviceLabel_(p.device);

    if (action === 'start') {
      var t1 = parseIds_(p.team1), t2 = parseIds_(p.team2);
      var err = validateStart(t1, t2, players, matches, cfg, now);
      if (err) throw new Error(err);
      var id = 'M' + Utilities.formatDate(new Date(now), 'Asia/Tokyo', 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
      var scoring = p.scoring === 'throws' ? 'throws' : 'manual';
      var row = { match_id: id, started_at: new Date(now), team1_ids: t1.join(','), team2_ids: t2.join(','), status: 'playing', started_by: device, scoring: scoring };
      if (scoring === 'throws') {
        if (!sheetExists_(SHEET.throws)) throw new Error('1投ごとの記録には throws シートが必要です。メニューの「鴨王戦 > 初期設定」をもう一度実行してください');
        row.use_order = p.use_order || (t1.length === 1 && t2.length === 1) ? 'TRUE' : 'FALSE'; // 個人戦は投擲成績を必ず記録
        row.first_team = Number(p.first_team) === 2 ? 2 : 1;
        row.throws_json = '[]'; row.leg_orders = '[]'; row.rev = 0; row.scorer = device;
      }
      appendObj_(SHEET.matches, row);
      schedAutoJoin_(t1.concat(t2), now, id, device); // 日程に登録していない人を、いまの時間に自動で追加（日程調整 設計書 16章）
      log_('start', device, { match_id: id, team1: t1, team2: t2, scoring: scoring, use_order: row.use_order === 'TRUE', first_team: row.first_team || '' });
      return publicState_();
    }

    var m = findMatch_(matches, p.match_id);

    if (action === 'cancel') {
      if (m.status !== 'playing') throw new Error('試合中の試合だけ取り消せます');
      setCells_(SHEET.matches, m._row, { status: 'void', note: '開始取り消し' });
      schedAutoRemove_(m.match_id, device);
      log_('cancel', device, { match_id: m.match_id });
      return publicState_();
    }

    if (action === 'result') {
      var dl = toTime_(cfg.result_deadline);
      if (!isNaN(dl) && now >= dl) throw new Error('結果入力の締切を過ぎています');
      if (m.status !== 'playing') throw new Error('この試合はすでに結果が入力されています');
      var e2 = validateResult(p.team1_legs, p.team2_legs);
      if (e2) throw new Error(e2);
      var winner = Number(p.team1_legs) === 2 ? 1 : 2;
      setCells_(SHEET.matches, m._row, {
        ended_at: new Date(now), team1_legs: Number(p.team1_legs), team2_legs: Number(p.team2_legs),
        team1_score: p.team1_score === '' || p.team1_score === undefined ? '' : Number(p.team1_score),
        team2_score: p.team2_score === '' || p.team2_score === undefined ? '' : Number(p.team2_score),
        winner: winner, status: 'done', entered_by: device, scoring: 'manual'
      });
      log_('result', device, { match_id: m.match_id, legs: [p.team1_legs, p.team2_legs], score: [p.team1_score, p.team2_score] });
      schedAutoOnEnd_(m, now, device);
      recalc();
      return publicState_();
    }
    if (action === 'sync') {
      if (m.status !== 'playing') throw new Error('この試合はすでに終わっています');
      if (m.scoring !== 'throws') throw new Error('この試合は1投ごとの記録ではありません');
      if (!p.takeover) {
        if (m.scorer && m.scorer !== device) throw new Error('SCORER:別の端末が記録中です');
        if (Number(p.base_rev) !== m.rev) throw new Error('REV:ほかの端末で記録が更新されています');
      }
      var list = (p.throws || []).map(function (t) {
        var o = { kind: t.kind === 'foul' ? 'foul' : t.kind === 'miss' ? 'miss' : 'normal' };
        if (o.kind !== 'normal') return o;
        if (t.points !== undefined && t.points !== null && t.points !== '') o.points = Number(t.points);
        else o.pins = (t.pins || []).map(Number);
        return o;
      });
      var leg3 = Number(p.leg3_first) === 1 || Number(p.leg3_first) === 2 ? Number(p.leg3_first) : null;
      var orders = (p.leg_orders || []).map(function (lo) { return lo ? [parseIds_(lo[0]), parseIds_(lo[1])] : null; });
      var em = engineMatch_(m); em.leg3_first = leg3; em.leg_orders = orders;
      var eo = validateLegOrders(orders, em.team1, em.team2);
      if (eo) throw new Error(eo);
      var st = molkkyReplay(em, list);
      if (st.error) throw new Error(st.error);
      var upd = { throws_json: JSON.stringify(list), leg_orders: JSON.stringify(orders), rev: m.rev + 1, scorer: device, leg3_first: leg3 || '' };
      if (st.finished) {
        var dl2 = toTime_(cfg.result_deadline);
        if (!isNaN(dl2) && now >= dl2) throw new Error('結果入力の締切を過ぎています');
        upd.ended_at = new Date(now);
        upd.team1_legs = st.legsWon[0]; upd.team2_legs = st.legsWon[1];
        upd.team1_score = st.totals[0]; upd.team2_score = st.totals[1];
        upd.winner = st.winner; upd.status = 'done'; upd.entered_by = device;
      }
      setCells_(SHEET.matches, m._row, upd);
      if (p.takeover && m.scorer && m.scorer !== device) log_('takeover', device, { match_id: m.match_id, from: m.scorer });
      if (st.finished) {
        var tsh = sheet_(SHEET.throws), seqInLeg = {};
        var rows = st.log.map(function (r) {
          seqInLeg[r.leg] = (seqInLeg[r.leg] || 0) + 1;
          return [m.match_id, r.leg, seqInLeg[r.leg], r.team, r.player, r.kind, r.pins.join(','), r.points, r.score_after, r.miss_streak, r.event];
        });
        if (rows.length) tsh.getRange(tsh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
        log_('result', device, { match_id: m.match_id, legs: st.legsWon, score: st.totals, throws: rows.length });
        schedAutoOnEnd_(m, now, device);
        recalc();
      }
      return publicState_();
    }
    throw new Error('不明な操作です');
  } finally {
    lock.releaseLock();
  }
}

function sheetExists_(name) { return !!ss_().getSheetByName(name); }

function findMatch_(matches, id) {
  for (var i = 0; i < matches.length; i++) if (matches[i].match_id === String(id)) return matches[i];
  throw new Error('試合が見つかりません: ' + id);
}

/** 端末の識別記号（記録者の特定はしない。log で操作元を追えるようにするだけ） */
function deviceLabel_(d) {
  d = String(d || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
  return d ? '端末' + d : '端末不明';
}

/** シートの回数のセル。表示形式が日付になっていて Date で読めたときも回数に戻す（スプレッドシートの日付は 1899/12/30 からの日数） */
function cellCount_(v) {
  if (v instanceof Date) return Math.round((v.getTime() - new Date(1899, 11, 30).getTime()) / 86400000);
  var x = Number(v);
  return v === '' || v === null || v === undefined || !isFinite(x) ? 0 : x;
}
function readThrowStats_() {
  var map = {};
  if (!sheetExists_(SHEET.player_stats)) return map;
  readTable_(SHEET.player_stats).forEach(function (r) {
    var id = String(r.player_id);
    map[id] = { throws: r.throws, hits: r.hits !== undefined && r.hits !== '' ? r.hits : r.throws - r.misses, points: r.points, misses: r.misses, hit_rate: r.hit_rate !== undefined && r.hit_rate !== '' ? r.hit_rate : (r.throws ? Math.round((1 - r.misses / r.throws) * 1000) / 10 : 0), wins: r.wins, busts: cellCount_(r.busts) };
  });
  return map;
}

// レート固定の人の参考レートを表示するか（未設定なら表示）
function virtualVisible_(cfg) {
  var v = cfg.virtual_rating_visible;
  return v === undefined || v === '' || v === null || toBool_(v) || v === 1;
}

// 運営画面から変えられる設定（ここにあるものだけ書き換えを許す）
var ADMIN_SETTINGS = { virtual_rating_visible: 'bool', virtual_initial_rating: 'rating', virtual_min_matches: 'count', sched_visible: 'bool', sched_auto_join: 'bool' };

// 日程タブを表示するか（未設定なら表示）
function schedVisible_(cfg) {
  var v = cfg.sched_visible;
  return v === undefined || v === '' || v === null || toBool_(v) || v === 1;
}

// 試合を始めたとき日程に自動で追加するか（未設定なら追加する）
function schedAutoOn_(cfg) {
  var v = cfg.sched_auto_join;
  return v === undefined || v === '' || v === null || toBool_(v) || v === 1;
}

/** settings シートの1項目を書き換える（無ければ行を足す） */
function setSetting_(key, value) {
  var row = readTable_(SHEET.settings).filter(function (r) { return String(r.key) === key; })[0];
  if (row) { setCells_(SHEET.settings, row._row, { value: value }); return; }
  var def = DEFAULT_SETTINGS.filter(function (r) { return r[0] === key; })[0];
  appendObj_(SHEET.settings, { key: key, value: value, description: def ? def[2] : '' });
}

function awardsVisible_(cfg) {
  var v = cfg.awards_visible;
  return v === undefined || v === '' || v === null || toBool_(v) || v === 1;
}

/** 画面に渡すデータ（運営パスワードは含めない） */
function publicState_() {
  var cfg = readSettings_(), players = readPlayers_(), matches = readMatches_(), bonus = readBonus_();
  var res = computeRatings(players, matches, cfg);
  var extra = computeExtraBonus(players, matches, res, cfg, Date.now());
  var bonusMap = mergeBonus_(bonus, extra);
  var ranking = buildRanking(players, res, bonusMap, cfg);
  var pubCfg = {};
  ['start_at', 'end_at', 'result_deadline', 'initial_rating', 'win_base', 'win_coef', 'loss_base', 'loss_coef',
   'min_gain', 'min_loss', 'max_team_size', 'max_singles_vs_same', 'max_vs_fixed_solo', 'max_vs_fixed_singles', 'min_matches', 'min_team_matches',
   'qualify_count', 'virtual_rating_visible',
   'bonus_wins_step', 'bonus_wins_pt', 'bonus_partner_tiers', 'bonus_opponent_tiers', 'bonus_rookie_pt'].forEach(function (k) { // bonus_* は観戦用ページのルールタブで使う
    var v = cfg[k];
    pubCfg[k] = v instanceof Date ? v.getTime() : v;
  });
  ['start_at', 'end_at', 'result_deadline'].forEach(function (k) { pubCfg[k] = toTime_(cfg[k]); });
  var showVirtual = virtualVisible_(cfg);
  pubCfg.virtual_rating_visible = showVirtual;
  pubCfg.virtual_initial_rating = virtualStart_(cfg);
  pubCfg.virtual_min_matches = virtualMinMatches_(cfg);
  pubCfg.virtual_min_matches_raw = cfg.virtual_min_matches === undefined || cfg.virtual_min_matches === null ? '' : cfg.virtual_min_matches;
  var vTotals = showVirtual ? computeVirtualTotals(res, bonusMap, cfg) : {};
  var pubExtra = {}; // 参考レートを隠しているときは、レート固定の人のボーナスも出さない
  Object.keys(extra).forEach(function (id) { if (showVirtual || !extra[id].fixed) pubExtra[id] = extra[id]; });
  pubCfg.sched_visible = schedVisible_(cfg);
  pubCfg.sched_auto_join = schedAutoOn_(cfg);
  return {
    now: Date.now(),
    settings: pubCfg,
    players: players.map(function (p) {
      return { id: p.player_id, name: String(p.name), rating: res.ratings[p.player_id], fixed: res.fixed[p.player_id] !== undefined,
               virtual_rating: showVirtual ? res.virtual[p.player_id] : undefined, // レート固定の人だけ。変動した場合の参考値（設定で非表示にできる）
               virtual_total: vTotals[p.player_id], // レート固定の人だけ。参考レート＋ボーナスと最低試合数の達成
               active: p.active !== false, stats: res.stats[p.player_id] };
    }),
    ranking: ranking,
    matches: matches.map(function (m) {
      var d = res.deltas[m.match_id] || {};
      return { id: m.match_id, started_at: toTime_(m.started_at), ended_at: toTime_(m.ended_at),
               team1: parseIds_(m.team1_ids), team2: parseIds_(m.team2_ids),
               legs1: m.team1_legs, legs2: m.team2_legs, score1: m.team1_score, score2: m.team2_score,
               winner: m.winner === '' ? null : Number(m.winner), status: m.status,
               started_by: String(m.started_by || ''), entered_by: String(m.entered_by || ''),
               delta1: d.team1, delta2: d.team2, note: String(m.note || ''),
               scoring: m.scoring, use_order: m.use_order, first_team: m.first_team, leg3_first: m.leg3_first,
               rev: m.rev, scorer: m.scorer,
               throws: m.status === 'playing' && m.scoring === 'throws' ? m.throwList : undefined,
               leg_orders: m.status === 'playing' && m.scoring === 'throws' ? m.legOrders : undefined,
               leg_scores: m.scoring === 'throws' && m.throwList.length ? molkkyReplay(engineMatch_(m), m.throwList).legScores : undefined };
    }).reverse(),
    throw_stats: readThrowStats_(),
    extra_bonus: pubExtra,
    singles_stats: computeSinglesStats(matches),
    profiles: computeProfiles(players, matches),
    awards: awardsVisible_(cfg) ? computeAwards(players, matches, res, ranking, cfg) : null,
    history: res.history,
    virtual_history: showVirtual ? res.virtualHistory : {},
    singles: res.singlesCount,
    vs_fixed: res.vsFixed // 鴨王が1人のチームと対戦した回数（選手ごと。{solo, singles}）
  };
}

/* =====================================================================
 *  日程調整（日程調整 設計書）
 *  1人1マス（日付×1時間）につき1行。時刻はすべて日本時間で扱う
 * ===================================================================== */

var SCHED_ANY_PLACE = 'どこでも', SCHED_OTHER = 'その他';
var SCHED_FORMATS = ['個人戦', 'チーム戦', 'どちらでも'];
var SCHED_MAX_PER_CALL = 200, SCHED_MAX_PER_PLAYER = 400, SCHED_COMMENT_MAX = 100, SCHED_OTHER_MAX = 20;
var JST_MS = 9 * 3600000;

/** 時刻 t（ミリ秒）の日本時間の日付 'yyyy-mm-dd' と時（0〜23） */
function jstParts_(t) {
  var d = new Date(t + JST_MS);
  var ds = d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  return { date: ds, hour: d.getUTCHours() };
}

/** 'yyyy-mm-dd' の hour 時台の始まりの時刻（ミリ秒） */
function slotStart_(date, hour) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(hour)) - JST_MS;
}

/** シートから読んだ日付（文字または Date）を 'yyyy-mm-dd' にそろえる */
function schedDate_(v) {
  if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') return jstParts_(v.getTime()).date;
  var s = String(v || '').trim().replace(/\//g, '-');
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : '';
}

/** 設定から、日程の期間（日付の一覧）と時間帯を出す */
function schedConfig_(cfg) {
  var from = num_(cfg.sched_day_start, 7), to = num_(cfg.sched_day_end, 20);
  var start = toTime_(cfg.start_at), end = toTime_(cfg.end_at);
  var dates = [];
  if (!isNaN(start) && !isNaN(end) && end > start) {
    var d0 = jstParts_(start).date, d1 = jstParts_(end - 1).date;
    for (var t = slotStart_(d0, 12); jstParts_(t).date <= d1 && dates.length < 60; t += 86400000) dates.push(jstParts_(t).date);
  }
  var places = String(cfg.sched_places === undefined || cfg.sched_places === null ? '高原,鴨川南,飛鳥井' : cfg.sched_places)
    .split(',').map(function (x) { return x.trim(); })
    .filter(function (x) { return x && x !== SCHED_ANY_PLACE && x !== SCHED_OTHER; });
  var gear = [], gseen = {};
  String(cfg.sched_gear === undefined || cfg.sched_gear === null ? 'set:モルックのセット' : cfg.sched_gear).split(',').forEach(function (x) {
    var m = /^\s*([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/.exec(x);
    if (m && !gseen[m[1]]) { gseen[m[1]] = 1; gear.push({ key: m[1], label: m[2] }); }
  });
  return { dates: dates, from: from, to: to, places: places, gear: gear };
}

/** 持ち物（gear）を検査してそろえる。list: 記号の配列。返り値は設定の順に並べたカンマ区切り */
function normSchedGear(list, gear) {
  list = (Array.isArray(list) ? list : String(list || '').split(',')).map(function (x) { return String(x).trim(); }).filter(String);
  var keys = gear.map(function (g) { return g.key; });
  list.forEach(function (x) { if (keys.indexOf(x) < 0) throw new Error('持ち物の項目が正しくありません: ' + x); });
  return keys.filter(function (k) { return list.indexOf(k) >= 0; }).join(',');
}

/** 希望場所を検査してそろえる。places: 画面で選んだもの（配列）。何もなければ「どこでも」 */
function normSchedPlace(list, other, places) {
  list = (Array.isArray(list) ? list : String(list || '').split(',')).map(function (x) { return String(x).trim(); }).filter(String);
  var seen = {}, out = [];
  list.forEach(function (x) { if (!seen[x]) { seen[x] = 1; out.push(x); } });
  if (!out.length) out = [SCHED_ANY_PLACE];
  if (out.indexOf(SCHED_ANY_PLACE) >= 0 && out.length > 1) throw new Error('「どこでも」はほかの場所と同時に選べません');
  out.forEach(function (x) {
    if (x !== SCHED_ANY_PLACE && x !== SCHED_OTHER && places.indexOf(x) < 0) throw new Error('希望場所が選択肢にありません: ' + x);
  });
  // 並びは選択肢の順にそろえる（同じ内容なら同じ文字になるように）
  var order = places.concat([SCHED_OTHER]);
  if (out[0] !== SCHED_ANY_PLACE) out.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
  var o = String(other || '').trim();
  if (out.indexOf(SCHED_OTHER) >= 0) {
    if (!o) throw new Error('「その他」の場所を入力してください');
    if (o.length > SCHED_OTHER_MAX) throw new Error('「その他」の場所は' + SCHED_OTHER_MAX + '文字までです');
  } else o = '';
  return { place: out.join(','), place_other: safeText_(o) };
}

/** 数式として解釈されないように（= + - @ で始まる文字の先頭に ' を付ける） */
function safeText_(s) { s = String(s || ''); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function unsafeText_(s) { s = String(s === undefined || s === null ? '' : s); return /^'[=+\-@]/.test(s) ? s.slice(1) : s; }

function readSchedule_() {
  if (!sheetExists_(SHEET.schedule)) return [];
  return readTable_(SHEET.schedule).map(function (r) {
    return { player_id: String(r.player_id).trim(), date: schedDate_(r.date), hour: Number(r.hour),
             place: String(r.place || SCHED_ANY_PLACE), place_other: unsafeText_(r.place_other),
             format: SCHED_FORMATS.indexOf(String(r.format)) >= 0 ? String(r.format) : 'どちらでも',
             comment: unsafeText_(r.comment), created_at: toTime_(r.created_at), updated_at: toTime_(r.updated_at), device: String(r.device || ''),
             gear: String(r.gear === undefined || r.gear === null ? '' : r.gear), via: String(r.via === undefined || r.via === null ? '' : r.via) };
  }).filter(function (r) { return r.player_id && r.date && !isNaN(r.hour); });
}

/** 日程タブに渡すデータ */
function scheduleState_() {
  var cfg = readSettings_(), sc = schedConfig_(cfg), inRange = {};
  sc.dates.forEach(function (d) { inRange[d] = 1; });
  return {
    now: Date.now(),
    dates: sc.dates, day_start: sc.from, day_end: sc.to, places: sc.places, gear: sc.gear,
    slots: readSchedule_().filter(function (r) { return inRange[r.date]; }).map(function (r) {
      var o = { p: r.player_id, d: r.date, h: r.hour, place: r.place, other: r.place_other, format: r.format, comment: r.comment, c: r.created_at, u: r.updated_at, gear: r.gear };
      if (r.via) o.via = r.via; // 試合を始めたときに自動で入った参加（'match:<match_id>'）
      return o;
    })
  };
}

/**
 * 参加の登録・取り消しの中身（シートに依存しない。テスト対象）
 * rows: 今の全参加。p: 画面から来た内容。返り値: { rows: 新しい全参加, added, updated, removed, skipped }
 *  schedSet:   p = { player_id, items: [{date, hour}], remove: [{date, hour}], place: [..], place_other, format, comment, gear: [..], skip_existing }
 *  schedLeave: p = { player_id, items: [{date, hour}] }
 */
function applySchedule(action, rows, p, players, cfg, now, device) {
  var sc = schedConfig_(cfg);
  var pid = String(p.player_id || '').trim();
  var pl = players.filter(function (x) { return x.player_id === pid; })[0];
  if (!pl) throw new Error('選手が見つかりません。名前を選び直してください');
  if (pl.active === false) throw new Error('参加中ではない選手です');
  function slots(list) {
    if (!Array.isArray(list)) return [];
    var seen = {}, out = [];
    list.forEach(function (it) {
      var d = schedDate_(it && it.date), h = Number(it && it.hour);
      if (!d || sc.dates.indexOf(d) < 0) throw new Error('期間外の日です: ' + (it && it.date));
      if (!(h % 1 === 0 && h >= sc.from && h <= sc.to)) throw new Error('時間割の外の時間です: ' + (it && it.hour) + '時台');
      if (slotStart_(d, h) + 3600000 <= now) throw new Error('過ぎた時間は変えられません（' + Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)) + ' ' + h + '時台）');
      var k = d + ' ' + h;
      if (!seen[k]) { seen[k] = 1; out.push({ date: d, hour: h, key: k }); }
    });
    return out;
  }
  var items = slots(p.items), remove = action === 'schedSet' ? slots(p.remove) : [];
  if (!items.length && !remove.length) throw new Error('時間が選ばれていません');
  if (items.length + remove.length > SCHED_MAX_PER_CALL) throw new Error('1回に変えられるのは' + SCHED_MAX_PER_CALL + '時間までです');
  var keyOf = function (r) { return r.player_id + '|' + r.date + ' ' + r.hour; };
  var index = {};
  rows.forEach(function (r, i) { index[keyOf(r)] = i; });
  var res = { added: 0, updated: 0, removed: 0, skipped: 0 };
  var out = rows.slice(), drop = {};
  if (action === 'schedLeave') {
    items.forEach(function (s) { var i = index[pid + '|' + s.key]; if (i !== undefined) { drop[i] = 1; res.removed++; } });
  } else {
    var place = normSchedPlace(p.place, p.place_other, sc.places);
    var format = String(p.format || 'どちらでも');
    if (SCHED_FORMATS.indexOf(format) < 0) throw new Error('希望形式が正しくありません: ' + format);
    var comment = String(p.comment || '').trim();
    if (comment.length > SCHED_COMMENT_MAX) throw new Error('ひとことは' + SCHED_COMMENT_MAX + '文字までです');
    var gear = normSchedGear(p.gear, sc.gear);
    var keep = {};
    items.forEach(function (s) { keep[s.key] = 1; });
    remove.forEach(function (s) {
      if (keep[s.key]) return;
      var i = index[pid + '|' + s.key]; if (i !== undefined) { drop[i] = 1; res.removed++; }
    });
    items.forEach(function (s) {
      var i = index[pid + '|' + s.key];
      // 本人が登録・編集したら、試合で自動に入った印（via）は外す
      var vals = { place: place.place, place_other: place.place_other, format: format, comment: safeText_(comment), gear: gear, via: '', updated_at: new Date(now), device: device };
      if (i !== undefined) {
        if (p.skip_existing) { res.skipped++; return; }
        var o = {}; Object.keys(out[i]).forEach(function (k) { o[k] = out[i][k]; });
        Object.keys(vals).forEach(function (k) { o[k] = vals[k]; });
        out[i] = o; res.updated++;
      } else {
        var n = { player_id: pid, date: s.date, hour: s.hour, created_at: new Date(now) };
        Object.keys(vals).forEach(function (k) { n[k] = vals[k]; });
        out.push(n); res.added++;
      }
    });
  }
  out = out.filter(function (r, i) { return !drop[i]; });
  var mine = out.filter(function (r) { return r.player_id === pid; }).length;
  if (mine > SCHED_MAX_PER_PLAYER) throw new Error('1人が参加できるのは' + SCHED_MAX_PER_PLAYER + '時間までです（いま' + (mine - res.added) + '時間）');
  res.rows = out;
  return res;
}

/** schedule シートを用意する（無ければ作り、足りない列は右端に足す）。返り値: [シート, 見出し] */
function schedSheet_() {
  if (!sheetExists_(SHEET.schedule)) { // setup を実行していなくても使えるように、初めての書き込みで作る
    var nsh = ss_().insertSheet(SHEET.schedule);
    nsh.getRange(1, 1, 1, HEADERS.schedule.length).setValues([HEADERS.schedule]).setFontWeight('bold');
    nsh.setFrozenRows(1);
  }
  var sh = sheet_(SHEET.schedule);
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  while (head.length && !head[head.length - 1]) head.pop();
  var missing = HEADERS.schedule.filter(function (h) { return head.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    head = head.concat(missing);
  }
  return [sh, head];
}

/** 書き戻し用に今の全参加を読む（数式よけの ' 付き・日時は Date のまま） */
function readScheduleRaw_() {
  return readSchedule_().map(function (r) {
    r.place_other = safeText_(r.place_other); r.comment = safeText_(r.comment);
    r.created_at = isNaN(r.created_at) ? '' : new Date(r.created_at); r.updated_at = isNaN(r.updated_at) ? '' : new Date(r.updated_at);
    return r;
  });
}

/** 全参加を書き直す（減った分の行は空にする） */
function writeScheduleRows_(sh, head, rows) {
  var oldLast = sh.getLastRow();
  var values = rows.map(function (r) { return head.map(function (h) { return r[h] === undefined || r[h] === null ? '' : r[h]; }); });
  sh.getRange('B:B').setNumberFormat('@');
  if (values.length) sh.getRange(2, 1, values.length, head.length).setValues(values);
  var extra = oldLast - 1 - values.length;
  if (extra > 0) sh.getRange(values.length + 2, 1, extra, head.length).setValues(Array.apply(null, Array(extra)).map(function () { return head.map(function () { return ''; }); }));
}

/** 参加の登録・取り消し（シートを書き換える） */
function schedWrite_(action, p) {
  var cfg = readSettings_(), players = readPlayers_();
  if (!schedVisible_(cfg)) throw new Error('日程は運営が非表示にしています');
  var device = deviceLabel_(p.device);
  var sh = schedSheet_(), before = readScheduleRaw_();
  var res = applySchedule(action, before, p, players, cfg, Date.now(), device);
  writeScheduleRows_(sh[0], sh[1], res.rows);
  var items = (p.items || []).map(function (it) { return schedDate_(it.date).slice(5) + ' ' + it.hour; });
  log_(action, device, { player_id: p.player_id, items: items.join(','), added: res.added, updated: res.updated, removed: res.removed, skipped: res.skipped });
  var st = scheduleState_();
  st.result = { added: res.added, updated: res.updated, removed: res.removed, skipped: res.skipped };
  return st;
}

/**
 * 試合を始めた（終わった）ときに、日程に登録していない人を時刻 t のマスに自動で入れる（シートに依存しない。テスト対象）
 * 入れられないマス（期間外・時間割の外）や、参加済み・400マスに達した人は黙って飛ばす。返り値: 足す行の配列
 */
function autoSchedule(rows, ids, t, cfg, players, matchId, device) {
  if (!schedVisible_(cfg) || !schedAutoOn_(cfg)) return [];
  var sc = schedConfig_(cfg), jp = jstParts_(t);
  if (sc.dates.indexOf(jp.date) < 0 || jp.hour < sc.from || jp.hour > sc.to) return [];
  var out = [], seen = {};
  (ids || []).forEach(function (id) {
    id = String(id);
    if (seen[id]) return; seen[id] = 1;
    var pl = players.filter(function (x) { return x.player_id === id; })[0];
    if (!pl || pl.active === false) return;
    var mine = rows.filter(function (r) { return r.player_id === id; });
    if (mine.some(function (r) { return r.date === jp.date && r.hour === jp.hour; })) return;
    if (mine.length >= SCHED_MAX_PER_PLAYER) return;
    out.push({ player_id: id, date: jp.date, hour: jp.hour, place: SCHED_ANY_PLACE, place_other: '', format: 'どちらでも', comment: '', gear: '',
               via: 'match:' + matchId, created_at: new Date(t), updated_at: new Date(t), device: device });
  });
  return out;
}

/** 試合の開始・終了で日程に自動で追加する。失敗しても試合の記録は止めない（呼ぶ側はロックの中） */
function schedAutoJoin_(ids, t, matchId, device) {
  try {
    var cfg = readSettings_();
    if (!schedVisible_(cfg) || !schedAutoOn_(cfg)) return 0;
    var add = autoSchedule(readSchedule_(), ids, t, cfg, readPlayers_(), matchId, device);
    if (!add.length) return 0;
    var sh = schedSheet_(), head = sh[1];
    var at = sh[0].getLastRow() + 1;
    sh[0].getRange('B:B').setNumberFormat('@');
    sh[0].getRange(at, 1, add.length, head.length).setValues(add.map(function (r) { return head.map(function (h) { return r[h] === undefined || r[h] === null ? '' : r[h]; }); }));
    log_('schedAuto', device, { match_id: matchId, items: add.map(function (r) { return r.player_id + ' ' + r.date.slice(5) + ' ' + r.hour; }).join(',') });
    return add.length;
  } catch (e) {
    log_('schedAutoError', device, { match_id: matchId, error: String(e && e.message ? e.message : e) });
    return 0;
  }
}

/** 開始取り消しのとき、その試合で自動に入れた参加（編集されていないもの）を消す */
function schedAutoRemove_(matchId, device) {
  try {
    if (!sheetExists_(SHEET.schedule)) return 0;
    var rows = readScheduleRaw_(), via = 'match:' + matchId;
    var keep = rows.filter(function (r) { return r.via !== via; });
    if (keep.length === rows.length) return 0;
    var sh = schedSheet_();
    writeScheduleRows_(sh[0], sh[1], keep);
    log_('schedAutoRemove', device, { match_id: matchId, removed: rows.length - keep.length });
    return rows.length - keep.length;
  } catch (e) {
    log_('schedAutoError', device, { match_id: matchId, error: String(e && e.message ? e.message : e) });
    return 0;
  }
}

/** 試合が終わったとき、終わった時刻のマスが始めたマスと違えば、そのマスにも入れる */
function schedAutoOnEnd_(m, now, device) {
  var st = toTime_(m.started_at);
  if (isNaN(st)) return;
  var a = jstParts_(st), b = jstParts_(now);
  if (a.date === b.date && a.hour === b.hour) return;
  schedAutoJoin_(parseIds_(m.team1_ids).concat(parseIds_(m.team2_ids)), now, m.match_id, device);
}

/* =====================================================================
 *  ウェブアプリの入口
 * ===================================================================== */

function doGet(e) {
  if (e && e.parameter && e.parameter.api) {
    return json_(api(e.parameter.api, {}));
  }
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('鴨王戦 予選レート戦')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 外部（GitHub Pages など）に置いた画面から使う場合の入口。Content-Type: text/plain で JSON を送る */
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'JSON が読めません' }); }
  return json_(api(body.action, body.payload));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================================
 *  スプレッドシートのメニューと初期設定
 * ===================================================================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('鴨王戦')
    .addItem('レート再計算', 'menuRecalc_')
    .addItem('初期設定（シート作成）', 'setup')
    .addToUi();
}

function menuRecalc_() {
  recalc();
  SpreadsheetApp.getActiveSpreadsheet().toast('レートを再計算しました');
}

/** 足りないシートを作り、見出しと設定の初期値を入れる。既存のデータは消さない */
function setup() {
  var ss = ss_();
  Object.keys(SHEET).forEach(function (k) {
    var name = SHEET[k];
    if (k === 'stats') return; // 見出しが2段なので、最後の recalc で作る
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEADERS[k].length).setValues([HEADERS[k]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else if (k !== 'ranking' && k !== 'player_stats' && k !== 'awards' && k !== 'extra_bonus') {
      // 既存のシートに足りない列を右端に追加する（アップデート時は setup をもう一度実行すればよい）
      var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
      var used = 0;
      head.forEach(function (h, i) { if (h) used = i + 1; });
      var missing = HEADERS[k].filter(function (h) { return head.indexOf(h) < 0; });
      if (missing.length) {
        // CSV から取り込んだシートなどは列の数が足りないことがあるので、先に列を増やす
        if (sh.getMaxColumns && sh.getMaxColumns() < used + missing.length) sh.insertColumnsAfter(sh.getMaxColumns(), used + missing.length - sh.getMaxColumns());
        sh.getRange(1, used + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
      }
    }
  });
  var st = ss.getSheetByName(SHEET.settings);
  if (st.getLastRow() <= 1) {
    var rows = DEFAULT_SETTINGS.map(function (r) {
      var v = r[1];
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) v = new Date(v);
      return [r[0], v, r[2]];
    });
    st.getRange(2, 1, rows.length, 3).setValues(rows);
  } else {
    // 新しく増えた設定項目だけ下に追加する（既存の値はそのまま）
    var have = st.getRange(1, 1, st.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); });
    var add = DEFAULT_SETTINGS.filter(function (r) { return have.indexOf(r[0]) < 0; });
    if (add.length) st.getRange(st.getLastRow() + 1, 1, add.length, 3).setValues(add);
  }
  // 日時列の表示形式
  ss.getSheetByName(SHEET.matches).getRange('B:C').setNumberFormat('yyyy/mm/dd hh:mm:ss');
  // 日程の日付は文字のまま保存する（日付に変換されないように）
  ss.getSheetByName(SHEET.schedule).getRange('B:B').setNumberFormat('@');
  ss.getSheetByName(SHEET.schedule).getRange('H:I').setNumberFormat('yyyy/mm/dd hh:mm:ss');
  // players の初期レート列の説明
  var pl = ss.getSheetByName(SHEET.players);
  pl.getRange('C1').setNote('空欄なら settings の initial_rating（1500）。前回参加者は 1500＋(前回最終−1500)/4（1500未満なら1500）を運営が入力');
  pl.getRange('D1').setNote('前回王者Aだけ 1800 を入力。この人のレートは変動せず、順位表にも出ません');
  pl.getRange('E1').setNote('TRUE で参加中。空欄も参加中として扱います');
  var rc = pl.getRange(1, 1, 1, pl.getLastColumn()).getValues()[0].map(String).indexOf('rookie');
  if (rc >= 0) pl.getRange(1, rc + 1).setNote('1回生は TRUE（ルーキー賞の対象）');
  recalc();
}
