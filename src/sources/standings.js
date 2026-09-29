'use strict';
// Tabela (classificacao) da liga principal via ESPN. Devolve a linha do time.
const config = require('./../config');
const { fetchJson } = require('./base');

const TEAM_ID = String(config.team.espnId);
// liga onde existe tabela de pontos corridos (Copa do Brasil e mata-mata)
const TABLE_LEAGUE = config.tableLeague;
const COMP_NAMES = require('./espn').COMP_NAMES;

function statVal(entry, name) {
  const s = (entry.stats || []).find((x) => x.name === name || x.type === name);
  if (!s) return null;
  const v = s.displayValue ?? s.value;
  return v == null ? null : v;
}

// { rank, points, played, wins, ties, losses } | null
async function fetchTeamStanding() {
  if (!TABLE_LEAGUE) return null;
  const url = `${config.espnV2Base}/${TABLE_LEAGUE}/standings`;
  const j = await fetchJson(url);
  const groups = j.children || (j.standings ? [j] : []);
  let entries = [];
  for (const g of groups) {
    const e = (g.standings && g.standings.entries) || [];
    if (e.length) entries = entries.concat(e);
  }
  const row = entries.find((e) => String(e.team?.id) === TEAM_ID);
  if (!row) return null;
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  return {
    rank: num(row.team?.rank ?? statVal(row, 'rank')),
    points: num(statVal(row, 'points')),
    played: num(statVal(row, 'gamesPlayed')),
    wins: num(statVal(row, 'wins')),
    ties: num(statVal(row, 'ties')),
    losses: num(statVal(row, 'losses')),
    league: COMP_NAMES[TABLE_LEAGUE] || TABLE_LEAGUE,
  };
}

module.exports = { fetchTeamStanding };
