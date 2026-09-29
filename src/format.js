'use strict';
// Formatter na PERSPECTIVA do time configurado (a torcida). Texto com personalidade:
// negrito, emoji marcador, emocao. Placar sempre "Time x Adversario". Textos em i18n.js.
const config = require('./config');
const t = require('./i18n');

const TEAM = config.team.name;
const TEAM_RE = new RegExp(TEAM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

function fmtLocal(iso, opts) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(t.locale, { timeZone: config.timezone, ...opts }).format(d);
}
function kickoffLocal(iso) {
  return fmtLocal(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
}
function dateLocal(iso) {
  return fmtLocal(iso, { day: '2-digit', month: '2-digit' });
}
function weekdayLocal(iso) {
  return fmtLocal(iso, { weekday: 'long' });
}

// resolve os lados a partir do snapshot (teamSide pode vir null -> tenta pelo nome)
function sides(snap) {
  let teamIsHome = snap.teamSide === 'home';
  if (!snap.teamSide) teamIsHome = TEAM_RE.test(snap.homeTeam || '');
  const opp = (teamIsHome ? snap.awayTeam : snap.homeTeam) || t.opponent;
  const teamScore = (teamIsHome ? snap.homeScore : snap.awayScore) ?? 0;
  const oppScore = (teamIsHome ? snap.awayScore : snap.homeScore) ?? 0;
  return { teamIsHome, opp, teamScore, oppScore };
}
function placar(snap) {
  const { opp, teamScore, oppScore } = sides(snap);
  return `${TEAM} ${teamScore} x ${oppScore} ${opp}`;
}
function confronto(snap) {
  const { teamIsHome, opp } = sides(snap);
  return teamIsHome ? `${TEAM} x ${opp}` : `${opp} x ${TEAM}`;
}
function mando(snap) {
  return sides(snap).teamIsHome ? t.home : t.away;
}
function ctxLine(snap) {
  const parts = [];
  if (snap.competition) parts.push(snap.competition);
  const local = [snap.stadium, snap.city].filter(Boolean).join(', ');
  if (local) parts.push(local);
  return parts.join(' · ');
}
function minLabel(minute) {
  return minute ? `${String(minute).replace(/'+$/, '')}'` : '';
}
// rodapé "leia tudo no site" — só se a página estiver ligada
function leiaMais() {
  return config.pageEnabled && config.pageUrl ? t.readMore(config.pageUrl) : null;
}
function relTime(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `~${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) { const m = mins % 60; return m ? `~${h}h${String(m).padStart(2, '0')}` : `~${h}h`; }
  // dias pelo CALENDARIO local, nao por horas: jogo de amanha 21h visto as 8h de
  // hoje sao ~37h e virava "em 2 dias" no arredondamento.
  const d = diasDeCalendario(iso);
  return d === 1 ? t.tomorrow : t.inDays(d);
}

// diferenca em dias de calendario (fuso do bot) entre hoje e a data do jogo
function diasDeCalendario(iso) {
  const ymd = (dt) => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(dt);
  const dias = (s) => Date.UTC(...s.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n))) / 86400000;
  return Math.round(dias(ymd(new Date(iso))) - dias(ymd(new Date())));
}

// linha do proximo jogo (usada no bom dia e no pos-jogo)
function nextLine(next) {
  if (!next) return null;
  const { teamIsHome, opp } = sides(next);
  const k = kickoffLocal(next.kickoffUtc);
  const d = dateLocal(next.kickoffUtc);
  const rel = relTime(next.kickoffUtc);
  const vs = teamIsHome ? `🏠 ${TEAM} x ${opp}` : `✈️ ${opp} x ${TEAM}`;
  const when = [d, k && (config.lang === 'pt' ? `${k}h` : k)].filter(Boolean).join(' ');
  return `${vs}${next.competition ? ` (${next.competition})` : ''} — *${when}*${rel ? ` · ${rel}` : ''}`;
}

// linha da posicao na tabela
function tableLine(st) {
  if (!st || st.rank == null) return null;
  const [W, D, L] = t.wdl;
  const camp = [st.wins != null && `${st.wins}${W}`, st.ties != null && `${st.ties}${D}`, st.losses != null && `${st.losses}${L}`].filter(Boolean).join('-');
  const pts = st.points != null ? `${st.points} ${t.points}` : '';
  const tail = [pts, camp && `(${camp})`].filter(Boolean).join(' ');
  return `${t.rank(st.rank, st.league)}${tail ? ` — ${tail}` : ''}`;
}

// ---------- mensagens ----------

// Bom dia diario. ctx: { news:[{title,source}], next, standing, todayMatch }
function bomDia(ctx = {}) {
  const lines = [t.goodMorning()];
  if (ctx.todayMatch) {
    const k = kickoffLocal(ctx.todayMatch.kickoffUtc);
    lines.push('', t.matchToday(confronto(ctx.todayMatch), k, ctx.todayMatch.competition, mando(ctx.todayMatch)));
  } else if (ctx.next) {
    lines.push('', `${t.nextMatch} ${nextLine(ctx.next)}`);
  }
  const tl = tableLine(ctx.standing);
  if (tl) lines.push('', tl);
  const news = (ctx.news || []).slice(0, 3);
  if (news.length) {
    lines.push('', t.onRadar());
    for (const n of news) lines.push(`• ${n.title}${n.source ? ` _(${n.source})_` : ''}`);
    const lm = leiaMais();
    if (lm) lines.push('', lm);
  }
  lines.push('', t.signOffMorning());
  return lines.join('\n');
}

// Giro de noticias: boletim de manchetes (tarde / noite). tail rotativo/boa-noite.
function giro(news, label, tail) {
  const items = (news || []).slice(0, 4);
  if (!items.length) return null;
  const lines = [t.roundup(label), ''];
  for (const n of items) lines.push(`• ${n.title}${n.source ? ` _(${n.source})_` : ''}`);
  const lm = leiaMais();
  if (lm) lines.push('', lm);
  if (tail) lines.push('', tail);
  return lines.join('\n');
}

// Rodapé de boa-noite (vai colado no último giro do dia).
function boaNoiteTail() {
  return t.goodNightTail();
}
// Boa-noite sozinha (quando não há notícia nova pro giro da noite).
function boaNoite() {
  return t.goodNight();
}

// Aviso de que o jogo vai comecar (T-15).
function preview(snap, ida) {
  const lines = [t.matchDay(), '', `*${confronto(snap)}*`];
  const ctx = ctxLine(snap);
  if (ctx) lines.push('', ctx);
  const k = kickoffLocal(snap.kickoffUtc);
  if (k) lines.push('', t.startsAt(k, mando(snap)));
  if (ida) lines.push('', `${t.firstLeg} ${placar(ida)}`);
  lines.push('', t.letsGo());
  return lines.join('\n');
}

function kickoff(snap) {
  const lines = [t.kickoff, '', `*${confronto(snap)}*`];
  const bits = [snap.competition, snap.stadium].filter(Boolean);
  if (bits.length) lines.push('', bits.join(' · '));
  return lines.join('\n');
}

function dramaLine(drama) {
  return t.drama[drama] ? t.drama[drama]() : null;
}

// scoringTeam: 'home' | 'away'. goalInfo: {scorer, minute, kind, drama}
function goal(snap, scoringTeam, goalInfo = {}) {
  const { teamIsHome } = sides(snap);
  const weScored = scoringTeam === (teamIsHome ? 'home' : 'away');
  const min = goalInfo.minute ? `, ${minLabel(goalInfo.minute)}` : '';
  const lines = [];
  if (weScored) {
    if (goalInfo.kind === 'own') {
      lines.push(t.ourOwnGoal(), '', `*${placar(snap)}*`);
    } else {
      lines.push(dramaLine(goalInfo.drama) || t.ourGoal(), '', `*${placar(snap)}*`);
      const tag = goalInfo.kind === 'penalty' ? t.penaltyTag : '';
      if (goalInfo.scorer) lines.push('', `⚽ ${goalInfo.scorer}${tag}${min}`);
    }
  } else if (goalInfo.kind === 'own') {
    lines.push(t.theirOwnGoal, '', `*${placar(snap)}*`);
  } else {
    lines.push(t.theirGoal, '', `*${placar(snap)}*`);
    if (goalInfo.scorer) lines.push('', `${goalInfo.scorer}${min}`);
  }
  return lines.join('\n');
}

function finished(snap) {
  const { teamScore, oppScore } = sides(snap);
  let head = t.fullTime;
  if (teamScore > oppScore) head = t.win();
  else if (teamScore < oppScore) head = t.loss;
  else head = t.draw;
  const lines = [head, '', `*${placar(snap)}*`];
  const ctx = ctxLine(snap);
  if (ctx) lines.push('', ctx);
  return lines.join('\n');
}

// pos-jogo: tabela + proximo desafio (mensagem separada, logo apos o "fim")
function posJogo(standing, next) {
  const lines = [];
  const tl = tableLine(standing);
  if (tl) lines.push(tl);
  if (next) lines.push('', `${t.nextChallenge} ${nextLine(next)}`);
  if (!lines.length) return null;
  return lines.join('\n');
}

function disallowed(snap, voidTeam) {
  const { teamIsHome } = sides(snap);
  const oursVoided = voidTeam === (teamIsHome ? 'home' : 'away');
  const lines = [t.var];
  lines.push(oursVoided ? t.varOurs() : t.varTheirs);
  lines.push('', `*${placar(snap)}*`);
  return lines.join('\n');
}

function card(snap, c) {
  const { teamIsHome } = sides(snap);
  const ours = c.team === (teamIsHome ? 'home' : 'away');
  const who = c.player || '—';
  const min = minLabel(c.minute);
  const alvo = ours ? TEAM : t.opponentLower;
  if (c.kind === 'red') {
    return `${t.red} (${alvo})\n\n${who}${min ? ` · ${min}` : ''}\n\n${confronto(snap)}`;
  }
  return `${t.yellow} (${alvo}) — ${who}${min ? ` · ${min}` : ''}`;
}

function moment(snap, m) {
  const min = minLabel(m.minute);
  switch (m.kind) {
    case 'yellow':
    case 'red':
      return card(snap, { kind: m.kind, team: m.team, player: m.player, minute: m.minute });
    case 'pen-missed':
    case 'pen-saved': {
      const { teamIsHome } = sides(snap);
      const ours = m.team === (teamIsHome ? 'home' : 'away');
      return `${t.penMissed(m.kind === 'pen-saved', t.penWho(ours))}${m.player ? ` (${m.player})` : ''}${min ? ` · ${min}` : ''}\n\n*${placar(snap)}*`;
    }
    case 'halftime':
      return `${t.halftime}\n\n*${placar(snap)}*`;
    case 'second-half':
      return `${t.secondHalf}\n\n*${placar(snap)}*`;
    case 'et-start':
      return `${t.etStart}\n\n*${placar(snap)}*`;
    case 'et-end':
      return `${t.etEnd}\n\n*${placar(snap)}*`;
    case 'shootout':
      return `${t.shootout}\n\n${confronto(snap)}`;
    default:
      return null;
  }
}

module.exports = {
  bomDia, giro, boaNoite, boaNoiteTail, preview, kickoff, goal, finished, posJogo, disallowed, card, moment,
  kickoffLocal, dateLocal, weekdayLocal, placar, confronto, sides, nextLine, tableLine,
};

// --- demo: `node src/format.js --demo` (usa o time do .env; mostra todas as mensagens) ---
if (require.main === module && process.argv.includes('--demo')) {
  const en = config.lang === 'en';
  const base = {
    homeTeam: TEAM, awayTeam: 'Rival FC', teamSide: 'home',
    competition: en ? 'League' : 'Campeonato', stadium: en ? 'Home Stadium' : 'Estádio', city: en ? 'City' : 'Cidade',
    kickoffUtc: new Date(Date.now() + 3 * 3600e3).toISOString(),
  };
  const next = { homeTeam: 'Other United', awayTeam: TEAM, teamSide: 'away', competition: base.competition, kickoffUtc: new Date(Date.now() + 7 * 86400e3).toISOString() };
  const standing = { rank: 4, points: 21, played: 13, wins: 6, ties: 3, losses: 4, league: base.competition };
  const news = [{ title: en ? 'Coach praises the performance and looks ahead' : 'Técnico elogia atuação e projeta sequência', source: en ? 'Sports Daily' : 'Jornal do Esporte' }];
  const show = (label, txt) => console.log(`--- ${label} ---\n${txt}\n`);
  show('GOOD MORNING (matchday)', bomDia({ news, standing, todayMatch: base }));
  show('GOOD MORNING (no match)', bomDia({ news, standing, next }));
  show('PREVIEW', preview(base));
  show('KICK-OFF', kickoff(base));
  show('OUR GOAL', goal({ ...base, homeScore: 1, awayScore: 0 }, 'home', { scorer: 'Player 9', minute: "23'", drama: 'opener' }));
  show('THEIR GOAL', goal({ ...base, homeScore: 1, awayScore: 1 }, 'away', { scorer: 'Striker 11', minute: "55'" }));
  show('RED CARD', card({ ...base, homeScore: 1, awayScore: 1 }, { kind: 'red', team: 'away', player: 'Defender 4', minute: "61'" }));
  show('FULL TIME (win)', finished({ ...base, homeScore: 2, awayScore: 1 }));
  show('AFTER THE MATCH', posJogo(standing, next));
  show('GOOD NIGHT', boaNoite());
}
