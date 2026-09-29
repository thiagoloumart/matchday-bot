'use strict';
// Detector: sobre o snapshot RECONCILIADO, decide eventos idempotentes (§8).
// Puro: nao envia nem grava. Devolve { events, next }.
//  - events: [{ type, key, scoringTeam? }]  (orquestrador checa sent_events)
//  - next:   estado a persistir (placar monotonico durante o jogo)
const config = require('./config');
const dbmod = require('./db');

function n0(v) {
  return v == null ? 0 : v;
}

// Resolve o placar de UM lado a partir do bruto da ESPN vs baseline.
//  - subiu      -> gol (aceita sempre, rapido)
//  - caiu       -> candidato a ANULACAO (VAR): so aceita a queda se os keyEvents
//                  CONFIRMAREM (contagem estrutural <= bruto E confiavel). Sem
//                  confirmacao, segura no baseline (anti-glitch: soluco da ESPN
//                  nao "desmarca" um gol legitimo).
//  - igual/null -> mantem baseline.
// keCount: nº de gols desse lado nos keyEvents (ou null). keReliable: keyEvents
// integros (todos os gols com lado identificado).
function resolveSide(raw, base, keCount, keReliable) {
  if (raw == null) return { val: base, voided: false };
  if (raw > base) return { val: raw, voided: false };
  if (raw < base) {
    if (keReliable && keCount != null && keCount <= raw) return { val: raw, voided: true };
    return { val: base, voided: false };
  }
  return { val: base, voided: false };
}

// snap: MatchSnapshot reconciliado. now: Date. keGoals: {home,away,reliable}|null
// (contagem de gols por lado dos keyEvents da ESPN, p/ confirmar anulacao).
function detect(snap, now = new Date(), keGoals = null) {
  const cid = snap.matchId;
  const prev = dbmod.state.get(cid);
  const isFirst = !prev;
  const events = [];

  // placar de referencia (o ultimo que demos por valido).
  let baseHome = prev ? n0(prev.home_score) : 0;
  let baseAway = prev ? n0(prev.away_score) : 0;

  let curHome = baseHome;
  let curAway = baseAway;
  let voidTeam = null; // lado que teve gol anulado neste ciclo (home/away)
  if (snap.status === 'finished') {
    // ao encerrar, aceita o placar final exato da ESPN (corrige anulacao tardia)
    curHome = snap.homeScore == null ? baseHome : snap.homeScore;
    curAway = snap.awayScore == null ? baseAway : snap.awayScore;
  } else if (snap.status === 'live') {
    const reliable = !!(keGoals && keGoals.reliable);
    const rH = resolveSide(snap.homeScore, baseHome, keGoals && keGoals.home, reliable);
    const rA = resolveSide(snap.awayScore, baseAway, keGoals && keGoals.away, reliable);
    curHome = rH.val; curAway = rA.val;
    if (rH.voided) voidTeam = 'home';
    if (rA.voided) voidTeam = 'away';
  }
  // scheduled/unknown: mantem baseline (nao mexe em placar fora do jogo).

  // ---------- PREVIEW (futuro; ok ja na 1a observacao) ----------
  if (snap.status === 'scheduled' && snap.kickoffUtc) {
    const mins = (new Date(snap.kickoffUtc).getTime() - now.getTime()) / 60000;
    const sent = prev && prev.preview_sent;
    if (mins > 0 && mins <= config.previewLeadMinutes && !sent) {
      events.push({ type: 'preview', key: `${cid}:preview` });
    }
  }

  // ---------- transicoes (exigem baseline anterior) ----------
  if (!isFirst) {
    // KICKOFF: scheduled -> live
    if (prev.status === 'scheduled' && snap.status === 'live') {
      events.push({ type: 'kickoff', key: `${cid}:kickoff` });
    }

    // GOAL: placar reconciliado subiu (em jogo vivo ou recem-encerrado)
    if (snap.status === 'live' || snap.status === 'finished') {
      const dHome = curHome - baseHome;
      const dAway = curAway - baseAway;
      if (dHome > 0 || dAway > 0) {
        // quem marcou: o lado que subiu (se ambos, o de maior delta)
        let scoringTeam = null;
        if (dHome > 0 && dAway > 0) scoringTeam = dHome >= dAway ? 'home' : 'away';
        else if (dHome > 0) scoringTeam = 'home';
        else scoringTeam = 'away';
        // drama: o que esse gol significou (placar antes x depois + historico)
        const trailedHome = (prev && prev.home_trailed) || baseHome < baseAway;
        const trailedAway = (prev && prev.away_trailed) || baseAway < baseHome;
        let drama = null;
        if (curHome === curAway) {
          drama = 'equalizer'; // empatou
        } else {
          const afterLeader = curHome > curAway ? 'home' : 'away';
          const beforeLeader = baseHome > baseAway ? 'home' : baseAway > baseHome ? 'away' : 'tie';
          if (afterLeader === scoringTeam && beforeLeader !== scoringTeam) {
            const scorerTrailed = scoringTeam === 'home' ? trailedHome : trailedAway;
            if (scorerTrailed) drama = 'comeback'; // estava atras e assumiu -> VIRADA
            else if (baseHome === 0 && baseAway === 0) drama = 'opener';
            else drama = 'lead'; // desempatou sem ter ficado atras
          }
        }
        events.push({ type: 'goal', key: `${cid}:goal:${curHome}-${curAway}`, scoringTeam, drama });
      }
    }

    // DISALLOWED: placar baixou durante o jogo, confirmado pelos keyEvents (VAR).
    // Chave de-para => unica por transicao; nao reenvia a mesma anulacao.
    if (snap.status === 'live' && voidTeam) {
      events.push({
        type: 'disallowed',
        key: `${cid}:void:${baseHome}-${baseAway}>${curHome}-${curAway}`,
        voidTeam,
      });
    }

    // FINISHED: virou finished tendo sido visto antes
    if (snap.status === 'finished' && (prev.status === 'live' || prev.status === 'scheduled')) {
      events.push({ type: 'finished', key: `${cid}:finished` });
    }
  }

  // proximos flags (visibilidade; idempotencia real fica em sent_events)
  const next = {
    canonical_id: cid,
    home_score: curHome,
    away_score: curAway,
    status: snap.status === 'unknown' && prev ? prev.status : snap.status,
    phase: snap.phase || (prev && prev.phase) || null,
    preview_sent: (prev && prev.preview_sent) || events.some((e) => e.type === 'preview') ? 1 : 0,
    kickoff_sent: (prev && prev.kickoff_sent) || events.some((e) => e.type === 'kickoff') ? 1 : 0,
    finished_sent: (prev && prev.finished_sent) || events.some((e) => e.type === 'finished') ? 1 : 0,
    home_trailed: ((prev && prev.home_trailed) || curHome < curAway) ? 1 : 0,
    away_trailed: ((prev && prev.away_trailed) || curAway < curHome) ? 1 : 0,
    last_source: snap.source || 'reconciled',
  };

  // expoe o placar efetivo p/ o formatter (ja monotonico)
  const effective = { ...snap, homeScore: curHome, awayScore: curAway };
  return { events, next, effective };
}

module.exports = { detect };
