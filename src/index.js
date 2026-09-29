'use strict';
// Orquestrador do matchday-bot. Foco: o time configurado (config.team).
//  - varre ESPN (todas as ligas de LEAGUES) em [ontem, hoje, amanha]
//  - detecta lances (gol/cartao/inicio/fim) -> formata (perspectiva da torcida) -> envia
//  - bom dia diario (noticias + proximo jogo + tabela) · pos-jogo (tabela + proximo)
const config = require('./config');
const log = require('./logger');
const dbmod = require('./db');
const espn = require('./sources/espn');
const news = require('./sources/news');
const standings = require('./sources/standings');
const detector = require('./detector');
const format = require('./format');
const t = require('./i18n');
const evolution = require('./evolution');
const welcome = require('./welcome');
const page = require('./page');

const ONCE = process.argv.includes('--once');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- helpers de tempo (fuso configurado) ----------
function localYmd(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d).replace(/-/g, '');
}
function localHour() {
  return parseInt(new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, hour: '2-digit', hour12: false,
  }).format(new Date()), 10);
}
// minuto do dia (0..1439) no fuso configurado
function localMinuteOfDay() {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  let h = +p.find((x) => x.type === 'hour').value; if (h === 24) h = 0;
  const m = +p.find((x) => x.type === 'minute').value;
  return h * 60 + m;
}
// hash deterministico (sem Math.random) -> jitter do horario estavel por dia/slot
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
  return h >>> 0;
}
// minuto-alvo de hoje p/ um slot: sorteado dentro da janela, MESMO valor o dia todo
// (estavel a restart) e diferente a cada dia. window=[h1,h2].
function targetMinute(name, window, ymd) {
  const [h1, h2] = window;
  const startMin = h1 * 60;
  const span = Math.max(1, (h2 - h1) * 60);
  return startMin + (hashStr(`${ymd}:${name}`) % span);
}
const NIGHT_CUTOFF_HOUR = 5;
function slateYmd(kickoffUtc) {
  if (!kickoffUtc) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date(kickoffUtc));
  const pick = (t) => parts.find((p) => p.type === t).value;
  let y = +pick('year'), mo = +pick('month'), da = +pick('day');
  let h = +pick('hour'); if (h === 24) h = 0;
  if (h < NIGHT_CUTOFF_HOUR) {
    const prev = new Date(Date.UTC(y, mo - 1, da) - 86400000);
    y = prev.getUTCFullYear(); mo = prev.getUTCMonth() + 1; da = prev.getUTCDate();
  }
  return `${y}${String(mo).padStart(2, '0')}${String(da).padStart(2, '0')}`;
}

function dedupById(snaps) {
  const map = new Map();
  for (const s of snaps) if (!map.has(s.matchId)) map.set(s.matchId, s);
  return [...map.values()];
}

async function fetchFortDays(days) {
  const out = [];
  let okAny = false;
  for (const d of days) {
    try {
      const snaps = await espn.fetchFortDay(d);
      out.push(...snaps);
      okAny = true;
    } catch (e) {
      dbmod.health.fail('espn', e.message);
      log.warn(`ESPN dia ${d} falhou: ${e.message}`);
    }
  }
  if (okAny) dbmod.health.ok('espn');
  return dedupById(out);
}

function dispatch(text, tag) {
  if (text) evolution.enqueue(text, tag);
}

function momentEnabled(kind) {
  switch (kind) {
    case 'yellow': return config.cardsEnabled && config.cardsYellow;
    case 'red': return config.cardsEnabled;
    case 'pen-missed':
    case 'pen-saved': return config.eventsPenalty;
    case 'halftime':
    case 'second-half': return config.eventsHalftime;
    case 'et-start':
    case 'et-end':
    case 'shootout': return config.eventsExtraTime;
    default: return false;
  }
}

// escolhe autor do gol a partir dos keyEvents
function pickScorer(ke, scoringTeam, teamNewScore) {
  const goals = (ke && ke.goals) || [];
  if (!goals.length) return null;
  const sideGoals = goals.filter((g) => g.team === scoringTeam);
  const pick = sideGoals[teamNewScore - 1] || sideGoals[sideGoals.length - 1] || null;
  return pick ? { scorer: pick.scorer, minute: pick.minute, kind: pick.kind } : null;
}

async function processMatch(snap) {
  const prev = dbmod.state.get(snap.matchId);
  const night = slateYmd(snap.kickoffUtc);
  const stale = night && night < slateYmd(new Date().toISOString());

  const finishingNow = snap.status === 'finished' && (!prev || prev.status !== 'finished');
  let ke = null;
  if (!stale && (snap.status === 'live' || finishingNow)) {
    ke = await espn.fetchKeyEvents(snap._league, snap._espnId, snap._homeId, snap._awayId);
  }
  let keGoals = null;
  if (ke && Array.isArray(ke.goals)) {
    const home = ke.goals.filter((g) => g.team === 'home').length;
    const away = ke.goals.filter((g) => g.team === 'away').length;
    const reliable = ke.goals.every((g) => g.team === 'home' || g.team === 'away');
    keGoals = { home, away, reliable };
  }

  const { events, next, effective } = detector.detect(snap, new Date(), keGoals);

  let sent = 0, finishedNow = false;
  for (const ev of events) {
    if (dbmod.events.alreadySent(ev.key)) continue;
    if (stale) { dbmod.events.markSent(ev.key); continue; }
    let text = null;
    if (ev.type === 'preview') text = format.preview(effective, await idaDoConfronto(effective));
    else if (ev.type === 'kickoff') text = format.kickoff(effective);
    else if (ev.type === 'finished') text = format.finished(effective);
    else if (ev.type === 'disallowed') text = format.disallowed(effective, ev.voidTeam);
    else if (ev.type === 'goal') {
      const teamNewScore = ev.scoringTeam === 'home' ? effective.homeScore : effective.awayScore;
      const info = pickScorer(ke, ev.scoringTeam, teamNewScore) || {};
      text = format.goal(effective, ev.scoringTeam, { ...info, drama: ev.drama });
    }
    if (text) {
      dispatch(text, `${ev.type}:${snap.matchId}`);
      dbmod.events.markSent(ev.key);
      sent++;
      if (ev.type === 'finished') finishedNow = true;
    }
  }

  // momentos (cartao/penalti/intervalo/2oT/prorrogacao). Baseline a prova de restart.
  if (ke && ke.moments && !stale) {
    const baseKey = `${snap.matchId}:moments_baselined`;
    const baselined = dbmod.events.alreadySent(baseKey);
    for (const m of ke.moments) {
      const key = `${snap.matchId}:m:${m.id}`;
      if (dbmod.events.alreadySent(key)) continue;
      if (!baselined || !momentEnabled(m.kind)) { dbmod.events.markSent(key); continue; }
      const text = format.moment(effective, m);
      if (text) { dispatch(text, `${m.kind}:${snap.matchId}`); sent++; }
      dbmod.events.markSent(key);
    }
    if (!baselined) dbmod.events.markSent(baseKey);
  }

  dbmod.state.upsert(next);

  // pos-jogo: tabela + proximo desafio (1x por jogo, logo apos o "fim")
  if (finishedNow && !stale) {
    const key = `posjogo:${snap.matchId}`;
    if (!dbmod.events.alreadySent(key)) {
      let st = null, nx = null;
      try { st = await standings.fetchTeamStanding(); } catch (e) { log.warn(`standings: ${e.message}`); }
      try { nx = await espn.fetchNextMatch(); } catch (e) { log.warn(`nextMatch: ${e.message}`); }
      const text = format.posJogo(st, nx);
      if (text) { dispatch(text, `posjogo:${snap.matchId}`); sent++; }
      dbmod.events.markSent(key);
      await page.refresh(true); // atualiza o site na hora com o resultado novo
    }
  }

  return { sent, live: effective.status === 'live', finishedNow, matchId: snap.matchId };
}

function newsKey(title) {
  return 'news:' + String(title).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '').slice(0, 48);
}

// manchetes frescas ainda nao postadas (NAO marca; o caller marca ao postar de fato)
async function freshUnseen(limit) {
  if (!config.newsEnabled) return [];
  let items;
  try { items = await news.fetchNews(15); } catch (e) { log.warn(`news: ${e.message}`); return []; }
  const pool = news.freshOnly(items, config.newsMaxAgeHours);
  const out = [];
  for (const n of pool) {
    if (out.length >= limit) break;
    if (dbmod.events.alreadySent(newsKey(n.title))) continue;
    out.push(n);
  }
  return out;
}
function markNews(items) {
  for (const n of items) dbmod.events.markSent(newsKey(n.title));
}
// slots de conteudo: horario SORTEADO por dia dentro de cada janela (anti-robotico)
const SLOTS = [
  { name: 'manha', window: config.morningWindow, kind: 'bomdia' },
  { name: 'tarde', window: config.afternoonWindow, kind: 'giro' },
  { name: 'noite', window: config.nightWindow, kind: 'noite' },
];

// BOM DIA: saudacao + noticias + proximo jogo + tabela + boas-vindas + convite.
async function fireBomDia(todayMatches) {
  const chosenNews = await freshUnseen(3);
  let standing = null, next = null;
  try { standing = await standings.fetchTeamStanding(); } catch (e) { log.warn(`standings: ${e.message}`); }
  const today = localYmd(0);
  const todayMatch = (todayMatches || []).find((s) => slateYmd(s.kickoffUtc) === today && s.status !== 'finished');
  if (!todayMatch) {
    try { next = await espn.fetchNextMatch(); } catch (e) { log.warn(`nextMatch: ${e.message}`); }
  }
  markNews(chosenNews);
  dispatch(format.bomDia({ news: chosenNews, standing, next, todayMatch }), 'bomdia');
  welcome.postWelcome(); // boas-vindas (se houver gente nova) + convite diario
  log.info(`bom dia enfileirado${todayMatch ? ' (dia de jogo)' : ''} | ${chosenNews.length} manchete(s)`);
}

const LATE_GRACE_MIN = 60; // tolerancia depois do fim da janela (catch-up p/ jogo/queda)

// Agendador por janela: cada slot dispara no minuto sorteado do dia. Notícia pausa em jogo.
// Slot cuja janela ja passou (ex.: subir o bot às 17h) é pulado, não disparado atrasado.
async function maybeSlots(snaps, gameWindow) {
  const ymd = localYmd(0);
  const mnow = localMinuteOfDay();
  for (const slot of SLOTS) {
    const key = `slot:${slot.name}:${ymd}`;
    if (dbmod.events.alreadySent(key)) continue;
    const windowEnd = slot.window[1] * 60 + LATE_GRACE_MIN;
    if (mnow > windowEnd) { dbmod.events.markSent(key); continue; } // janela vencida: pula hoje (sem atrasado)
    if (mnow < targetMinute(slot.name, slot.window, ymd)) continue; // ainda nao deu o horario sorteado

    if (slot.kind === 'bomdia') {
      await fireBomDia(snaps);
      dbmod.events.markSent(key);
    } else if (slot.kind === 'giro') {
      if (gameWindow) { dbmod.events.markSent(key); log.info('giro tarde pulado (janela de jogo)'); continue; }
      const picked = await freshUnseen(4);
      if (picked.length < 2) continue; // sem novidade: tenta no proximo ciclo (até vencer a janela)
      dispatch(format.giro(picked, t.afternoon, t.moreTonight()), 'giro:tarde');
      markNews(picked);
      dbmod.events.markSent(key);
      log.info(`giro tarde enfileirado (${picked.length} manchetes)`);
    } else if (slot.kind === 'noite') {
      if (gameWindow) continue; // jogo rolando à noite: adia a boa-noite até o jogo acabar
      const picked = await freshUnseen(4);
      if (picked.length >= 2) {
        dispatch(format.giro(picked, t.night, format.boaNoiteTail()), 'giro:noite');
        markNews(picked);
        log.info(`giro+boa-noite enfileirado (${picked.length} manchetes)`);
      } else {
        dispatch(format.boaNoite(), 'boanoite'); // boa-noite sempre vai, mesmo sem notícia
        log.info('boa-noite enfileirada (sem notícia nova)');
      }
      dbmod.events.markSent(key);
    }
  }
}

async function cycle() {
  const days = [localYmd(-1), localYmd(0), localYmd(1)];
  const snaps = await fetchFortDays(days);

  let liveCount = 0, sentCount = 0;
  for (const s of snaps) {
    try {
      const r = await processMatch(s);
      sentCount += r.sent;
      if (r.live) liveCount++;
    } catch (err) {
      log.error(`processMatch ${s.matchId}: ${err.message}`);
    }
  }

  // "janela de jogo": ao vivo ou prestes a comecar -> notícia se cala (não atropela o lance)
  const now = Date.now();
  const gameWindow = liveCount > 0 || snaps.some((s) => {
    if (s.status !== 'scheduled' || !s.kickoffUtc) return false;
    const mins = (new Date(s.kickoffUtc).getTime() - now) / 60000;
    return mins <= 90 && mins >= -30;
  });

  await welcome.trackMembers();      // rastreia quem entrou (throttle interno 1x/min)
  await maybeSlots(snaps, gameWindow);
  await page.refresh();              // regenera a pagina do site (throttle interno ~20min)

  const rows = dbmod.health.all();
  const health = rows.map((h) => `${h.source}:${h.consecutive_fail ? 'FALHA' + h.consecutive_fail : 'ok'}`).join(' ');
  avisaFonteMorta(rows);
  log.info(`ciclo: ${snaps.length} jogo(s) do ${config.team.name} | ${liveCount} ao vivo | ${sentCount} eventos | fontes[${health || 'espn:?'}]`);
  return { liveCount, snaps };
}

// Jogo anterior contra o MESMO adversario (ida de mata-mata) -> contexto no preview.
// Null quando o ultimo jogo foi contra outro time.
async function idaDoConfronto(snap) {
  try {
    const ultimo = await espn.fetchLastResult();
    if (!ultimo || ultimo.matchId === snap.matchId) return null;
    const adversario = (s) => format.sides(s).opp;
    const adv = adversario(snap);
    return adv && adversario(ultimo) === adv ? ultimo : null;
  } catch { return null; }
}

// Alarme de fonte morta. Em 04/08/26 a ESPN passou a barrar o User-Agent do bot e
// ele ficou 5h sem saber de jogo nenhum, publicando so noticia — em silencio, sem
// ninguem perceber. Agora avisa o dono no privado e avisa de novo quando volta.
const FALHAS_ATE_AVISAR = 4; // ~1h no poll ocioso de 15min
const avisado = new Set();
function avisaFonteMorta(rows) {
  for (const h of rows) {
    if (h.consecutive_fail >= FALHAS_ATE_AVISAR && !avisado.has(h.source)) {
      avisado.add(h.source);
      alertOwner(`⚠️ *matchday-bot CEGO*\nFonte \`${h.source}\` falhou ${h.consecutive_fail}x seguidas — sem jogo/placar/tabela, so noticia.\n\n${String(h.last_error || '').slice(0, 180)}`);
    } else if (h.consecutive_fail === 0 && avisado.has(h.source)) {
      avisado.delete(h.source);
      alertOwner(`✅ *matchday-bot recuperado* — fonte \`${h.source}\` voltou a responder.`);
    }
  }
}
// avisa o dono no privado (WHATSAPP_TEST_NUMBER); sem numero, fica so no log
function alertOwner(msg) {
  log.warn(msg.replace(/\*/g, ''));
  if (!config.whatsappTestNumber || config.dryRun) return;
  evolution.postText(config.whatsappTestNumber, msg).catch((e) => log.warn(`falha ao avisar o dono: ${e.message}`));
}

// scheduler adaptativo: ao vivo -> rapido; jogo prestes a comecar/recem-iniciado -> rapido; senao idle
let lastLiveTs = 0;
function nextDelay(liveCount, snaps) {
  if (liveCount > 0) return config.pollLiveMs;
  if (!snaps.length) return config.pollIdleMs; // sem jogo do time na janela = idle (1 time so)
  if (lastLiveTs && Date.now() - lastLiveTs < 12 * 60000) return config.pollLiveMs;
  const now = Date.now();
  const active = snaps.some((s) => {
    if (s.status !== 'scheduled' || !s.kickoffUtc) return false;
    const mins = (new Date(s.kickoffUtc).getTime() - now) / 60000;
    return mins <= 60 && mins >= -30;
  });
  return active ? config.pollLiveMs : config.pollIdleMs;
}

async function main() {
  log.info(`matchday-bot iniciando | time=${config.team.name} (${config.team.espnId}) | lang=${config.lang} | DRY_RUN=${config.dryRun} | destino=${config.sendTarget || '(nenhum)'} | ligas=${config.leagues.join(',')} | tz=${config.timezone}`);
  if (ONCE) {
    const { snaps } = await cycle();
    await evolution.flush();
    log.info(`--once concluido (${snaps.length} jogo(s)). Encerrando.`);
    process.exit(0);
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let result = { liveCount: 0, snaps: [] };
    try { result = await cycle(); } catch (e) { log.error(`ciclo falhou: ${e.message}`); }
    if (result.liveCount > 0) lastLiveTs = Date.now();
    const delay = nextDelay(result.liveCount, result.snaps);
    log.debug(`proximo ciclo em ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  }
}

process.on('SIGINT', () => { log.info('SIGINT, saindo'); process.exit(0); });
process.on('SIGTERM', () => { log.info('SIGTERM, saindo'); process.exit(0); });

main().catch((e) => { log.error('fatal:', e.stack || e.message); process.exit(1); });
