'use strict';
// Adaptador ESPN para UM time (config.team.espnId). API publica, sem chave.
//  - {league}/scoreboard?dates=YYYYMMDD -> jogos do dia; filtramos o do time
//  - {league}/summary?event=ID          -> gols/cartoes/momentos (keyEvents)
//  - {league}/teams/{id}                -> proximo jogo (nextEvent)
const config = require('../config');
const { fetchJson, newSnapshot } = require('./base');

const SOURCE = 'espn';
const TEAM_ID = String(config.team.espnId);

// codigo ESPN -> nome exibido. O setup (tools/setup.js) usa a mesma lista.
const COMP_NAMES = {
  'bra.1': 'Série A', 'bra.2': 'Série B', 'bra.3': 'Série C',
  'bra.copa_do_brazil': 'Copa do Brasil',
  'conmebol.libertadores': 'Libertadores', 'conmebol.sudamericana': 'Sul-Americana',
  'eng.1': 'Premier League', 'eng.2': 'Championship', 'eng.fa': 'FA Cup', 'eng.league_cup': 'League Cup',
  'esp.1': 'LaLiga', 'ita.1': 'Serie A', 'ger.1': 'Bundesliga', 'fra.1': 'Ligue 1', 'por.1': 'Primeira Liga',
  'uefa.champions': 'Champions League', 'uefa.europa': 'Europa League',
  'arg.1': 'Liga Profesional', 'usa.1': 'MLS',
};
function compName(league) {
  return COMP_NAMES[league] || league;
}

function mapStatus(state) {
  if (state === 'pre') return 'scheduled';
  if (state === 'in') return 'live';
  if (state === 'post') return 'finished';
  return 'unknown';
}
function mapPhase(name, shortDetail) {
  const n = (name || '').toUpperCase();
  if (n.includes('HALFTIME')) return 'HT';
  if (n.includes('FIRST_HALF')) return '1H';
  if (n.includes('SECOND_HALF')) return '2H';
  if (n.includes('FIRST_EXTRA')) return 'ET1';
  if (n.includes('SECOND_EXTRA')) return 'ET2';
  if (n.includes('SHOOTOUT') || n.includes('PENALT')) return 'PEN';
  if (n.includes('FULL_TIME') || n.includes('FINAL')) return 'FT';
  if (n.includes('SCHEDULED')) return 'PRE';
  return shortDetail || null;
}
// score na ESPN as vezes e string (scoreboard) ou objeto (schedule/team). Normaliza.
function toInt(v) {
  if (v && typeof v === 'object') v = v.displayValue ?? v.value;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function snapshotFromEvent(ev, league) {
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home') || competitors[0] || {};
  const away = competitors.find((c) => c.homeAway === 'away') || competitors[1] || {};
  const st = (ev.status && ev.status.type) || (comp.status && comp.status.type) || {};
  const venue = comp.venue || {};
  const homeId = (home.team && String(home.team.id)) || null;
  const awayId = (away.team && String(away.team.id)) || null;
  const teamSide = homeId === TEAM_ID ? 'home' : awayId === TEAM_ID ? 'away' : null;

  return newSnapshot({
    matchId: String(ev.id),
    homeTeam: (home.team && home.team.displayName) || null,
    awayTeam: (away.team && away.team.displayName) || null,
    homeScore: toInt(home.score),
    awayScore: toInt(away.score),
    status: mapStatus(st.state),
    phase: mapPhase(st.name, st.shortDetail),
    kickoffUtc: ev.date || null,
    competition: compName(league),
    stadium: venue.fullName || null,
    city: (venue.address && venue.address.city) || null,
    teamSide,
    source: SOURCE,
    _league: league,
    _espnId: String(ev.id),
    _homeId: homeId,
    _awayId: awayId,
    _statusName: st.name || null,
    _shortDetail: st.shortDetail || null,
  });
}

function isFort(snap) {
  return snap._homeId === TEAM_ID || snap._awayId === TEAM_ID;
}

// Busca os jogos do time num dia (YYYYMMDD), varrendo todas as ligas.
async function fetchFortDay(dateYmd) {
  const out = [];
  for (const league of config.leagues) {
    const url = `${config.espnSiteBase}/${league}/scoreboard?dates=${dateYmd}`;
    let data;
    try {
      data = await fetchJson(url);
    } catch (e) {
      const err = new Error(`scoreboard ${league} ${dateYmd}: ${e.message}`);
      err.league = league;
      throw err;
    }
    for (const ev of data.events || []) {
      const snap = snapshotFromEvent(ev, league);
      if (isFort(snap)) out.push(snap);
    }
  }
  return out;
}

// --- keyEvents (gols + momentos) ---
function parseScorer(text) {
  if (!text) return null;
  const m = text.match(/\.\s*([A-Z][^.()]{1,40}?)\s*\(/);
  return m ? m[1].trim() : null;
}
function goalKind(tt) {
  if (tt === 'own-goal') return 'own';
  if (tt.includes('penalty')) return 'penalty';
  if (tt.includes('header')) return 'header';
  if (tt.includes('volley')) return 'volley';
  return 'normal';
}
function momentKind(tt) {
  if (tt === 'yellow-card') return 'yellow';
  if (tt === 'red-card') return 'red';
  if (tt === 'halftime') return 'halftime';
  if (tt === 'start-2nd-half') return 'second-half';
  if (tt.includes('extra-time')) return tt.includes('start') ? 'et-start' : tt.includes('end') ? 'et-end' : null;
  if (tt.includes('shootout')) return 'shootout';
  if (tt.includes('penalty')) {
    if (tt.includes('miss')) return 'pen-missed';
    if (tt.includes('sav')) return 'pen-saved';
    return null;
  }
  return null;
}

// summary e league-scoped. Devolve { goals:[...], moments:[...] } ou null.
async function fetchKeyEvents(league, espnId, homeId, awayId) {
  try {
    const url = `${config.espnSiteBase}/${league}/summary?event=${espnId}`;
    const data = await fetchJson(url);
    const arr = data.keyEvents || [];
    const side = (id) => {
      const s = String(id || '');
      return s && String(homeId) === s ? 'home' : s && String(awayId) === s ? 'away' : null;
    };
    const goals = [];
    const moments = [];
    for (const k of arr) {
      const teamSide = side(k.team && k.team.id);
      const minute = (k.clock && k.clock.displayValue) || null;
      const athlete = (k.participants && k.participants[0] && k.participants[0].athlete && k.participants[0].athlete.displayName)
        || ((k.athletesInvolved || [])[0] || {}).displayName || null;
      const tt = (k.type && k.type.type) || '';
      if (k.scoringPlay === true) {
        goals.push({ id: k.id, team: teamSide, scorer: athlete || parseScorer(k.text), minute, kind: goalKind(tt) });
        continue;
      }
      const mk = momentKind(tt);
      if (mk) moments.push({ id: k.id, kind: mk, team: teamSide, player: athlete, minute });
    }
    return { goals, moments };
  } catch {
    return null;
  }
}

// Ultimo resultado do time (jogo finalizado mais recente). Devolve snapshot ou null.
async function fetchLastResult() {
  const out = [];
  for (const league of config.leagues) {
    try {
      const data = await fetchJson(`${config.espnSiteBase}/${league}/teams/${TEAM_ID}/schedule`);
      for (const ev of data.events || []) {
        const snap = snapshotFromEvent(ev, league);
        if (isFort(snap) && snap.status === 'finished' && snap.kickoffUtc) out.push(snap);
      }
    } catch { /* liga sem schedule */ }
  }
  out.sort((a, b) => new Date(b.kickoffUtc) - new Date(a.kickoffUtc)); // mais recente primeiro
  return out[0] || null;
}

// Proximo jogo do time (o mais cedo entre as ligas). Devolve snapshot ou null.
async function fetchNextMatch() {
  const candidates = [];
  for (const league of config.leagues) {
    try {
      const data = await fetchJson(`${config.espnSiteBase}/${league}/teams/${TEAM_ID}`);
      const ne = data.team && data.team.nextEvent;
      if (Array.isArray(ne)) {
        for (const ev of ne) {
          const snap = snapshotFromEvent(ev, league);
          if (isFort(snap) && snap.kickoffUtc && snap.status !== 'finished') candidates.push(snap);
        }
      }
    } catch { /* liga sem proximo jogo / fora de temporada */ }
  }
  candidates.sort((a, b) => new Date(a.kickoffUtc) - new Date(b.kickoffUtc));
  return candidates[0] || null;
}

module.exports = {
  COMP_NAMES, compName, SOURCE, fetchFortDay, fetchKeyEvents, fetchNextMatch, fetchLastResult, snapshotFromEvent, isFort, compName };
