'use strict';
// Boas-vindas a novos membros (1x/dia de manhã, num balão só, marcando @ quem
// entrou desde a véspera) + convite diário "chama os amigos" (funil).
// trackMembers(): roda todo ciclo (throttle) só detectando quem entrou.
// postWelcome(): chamado pela janela da manhã -> posta os 2 balões (idempotente/dia).
const config = require('./config');
const log = require('./logger');
const dbmod = require('./db');
const evolution = require('./evolution');
const t = require('./i18n');

function localYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// saudações (rotacionam por dia, pra não ficar robótico) — textos em i18n.js
const GREET = t.greet();
const WELCOME_BODY = t.welcomeBody();

function welcomeText(pending, idx) {
  const greet = GREET[idx % GREET.length];
  const mentions = pending.map((p) => `@${p.phone}`).join(' ');
  return [greet, mentions, '', WELCOME_BODY].join('\n');
}

// Convite diário "chama os amigos" (funil). Rotaciona pra nunca repetir no dia seguinte.
const INVITES = t.invites();
function inviteText(idx) {
  return INVITES[idx % INVITES.length].replace('{url}', config.inviteUrl);
}

let lastCheck = 0;

// Detecta novos membros (roda todo ciclo, mas só consulta a API no máximo 1x/min).
async function trackMembers() {
  if (!config.welcomeEnabled) return;
  const group = config.whatsappGroupJid;
  if (!group) return;
  const now = Date.now();
  if (now - lastCheck < 60000) return;
  lastCheck = now;

  let parts;
  try {
    parts = await evolution.fetchParticipants(group);
  } catch (e) {
    log.warn(`welcome: fetchParticipants falhou: ${e.message}`);
    return;
  }
  if (!parts.length) return;

  const firstRun = dbmod.members.count() === 0;
  for (const p of parts) {
    if (!p.phoneJid) continue;
    if (dbmod.members.isKnown(p.phoneJid)) continue;
    dbmod.members.add(p.phoneJid, p.phone);
    if (firstRun || p.phone === config.botNumber) continue; // baseline e o proprio bot nao saudam
    dbmod.members.addPending(p.phoneJid, p.phone);
  }
  if (firstRun) log.info(`welcome: baseline de ${parts.length} membros (sem marcar)`);
}

// Posta boas-vindas (se houver gente nova) + convite diário. Idempotente por dia.
// Chamado pela janela da manhã (junto do bom dia).
function postWelcome() {
  const group = config.whatsappGroupJid;
  if (!group) return;
  const ymd = localYmd();

  // --- Balão 1: boas-vindas (só quando há gente nova pra marcar) ---
  if (config.welcomeEnabled) {
    const wkey = `welcomeday:${ymd}`;
    if (!dbmod.events.alreadySent(wkey)) {
      const pending = dbmod.members.listPending();
      dbmod.events.markSent(wkey); // marca mesmo vazio (não reprocessa hoje)
      if (pending.length) {
        const idx = parseInt(dbmod.meta.get('welcome_variant') || '0', 10);
        evolution.enqueue(welcomeText(pending, idx), `welcome:${pending.length}`, group, pending.map((p) => p.jid));
        dbmod.members.clearPending();
        dbmod.meta.set('welcome_variant', String((idx + 1) % GREET.length));
        log.info(`welcome: ${pending.length} novo(s) saudado(s)`);
      }
    }
  }

  // --- Balão 2: convite (TODO DIA, mesmo sem gente nova) ---
  if (config.inviteEnabled && config.inviteUrl) {
    const ikey = `inviteday:${ymd}`;
    if (!dbmod.events.alreadySent(ikey)) {
      dbmod.events.markSent(ikey);
      const ivar = parseInt(dbmod.meta.get('invite_variant') || '0', 10);
      evolution.enqueue(inviteText(ivar), 'invite', group);
      dbmod.meta.set('invite_variant', String((ivar + 1) % INVITES.length));
      log.info(`convite diário enviado (variante ${ivar % INVITES.length})`);
    }
  }
}

module.exports = { trackMembers, postWelcome, welcomeText, inviteText, INVITES, GREET };
