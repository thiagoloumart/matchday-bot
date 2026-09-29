'use strict';
// Helpers comuns: fetch com timeout, fabrica do MatchSnapshot canonico.

// UA de navegador: em 04/08/2026 a ESPN passou a devolver 403 (Access Denied)
// pra User-Agent nao-navegador, o que cegou o bot pros jogos. Nao mexer.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchJson(url, { timeoutMs = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json', ...headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status} em ${url} :: ${body.slice(0, 120)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, { timeoutMs = 20000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// MatchSnapshot canonico. Campos ausentes => null.
function newSnapshot(partial = {}) {
  return {
    matchId: null,
    homeTeam: null,
    awayTeam: null,
    homeScore: null,
    awayScore: null,
    status: 'unknown', // scheduled | live | finished | unknown
    phase: null,
    kickoffUtc: null,
    competition: null, // nome amigavel da liga
    stadium: null,
    city: null,
    teamSide: null, // 'home' | 'away' — qual lado e o time configurado
    source: null,
    ...partial,
  };
}

module.exports = { fetchJson, fetchText, newSnapshot };
