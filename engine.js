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
    st.orders[st.leg - 1] = o || (st.orders[st.leg - 2] || [teams[0].slice(), teams[1].slice()]);
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
