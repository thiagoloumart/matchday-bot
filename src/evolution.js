'use strict';
// Envio WhatsApp via Evolution API. Fila com delay (anti-flood), DRY_RUN,
// retry leve em 429/5xx. POST /message/sendText/{instance} header apikey body {number,text}.
const config = require('./config');
const log = require('./logger');
const dbmod = require('./db');

const queue = [];
let draining = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// TRAVA DE DESTINO: rejeita qualquer alvo fora da allowlist (grupo configurado
// / numero de teste). Verifica o ID do grupo SEMPRE, antes de qualquer envio.
function assertTargetAllowed(target, tag) {
  if (config.allowedTargets.includes(target)) return true;
  log.error(`DESTINO BLOQUEADO (${tag || 'msg'}): "${target}" nao esta na allowlist [${config.allowedTargets.join(', ')}]. Envio ABORTADO.`);
  return false;
}

async function postText(target, text, mentioned = null, attempt = 1) {
  if (!assertTargetAllowed(target)) throw new Error(`destino bloqueado: ${target}`);
  const url = `${config.evolutionBaseUrl}/message/sendText/${config.evolutionInstance}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  const payload = { number: target, text };
  if (mentioned && mentioned.length) payload.mentioned = mentioned;
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', apikey: config.evolutionApiKey, 'X-Wa-Robot': 'matchday-bot' },
      body: JSON.stringify(payload),
    });
    const body = await res.text().catch(() => '');
    // 400 com "reading 'id'" = instancia do Evolution reconectando, nao payload
    // ruim. Sem retry isso ja custou o placar final de um jogo (Palmeiras 02/08).
    const instavel =
      res.status === 429 || res.status >= 500 || (res.status === 400 && /reading '?id'?/.test(body));
    if (instavel && attempt <= 3) {
      const wait = 5000 * attempt;
      log.warn(`evolution ${res.status}, retry ${attempt}/3 em ${wait}ms`);
      await sleep(wait);
      return postText(target, text, mentioned, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} :: ${body.slice(0, 160)}`);
    return body;
  } finally {
    clearTimeout(t);
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const { target, text, tag, mentioned } = queue.shift();
    if (config.dryRun) {
      log.info(`[DRY_RUN] -> ${target} (${tag})${mentioned ? ' @' + mentioned.length : ''}\n${text}\n`);
    } else {
      try {
        const body = await postText(target, text, mentioned);
        let waId = null, remoteJid = target;
        try { const j = JSON.parse(body); waId = j?.key?.id || null; remoteJid = j?.key?.remoteJid || target; } catch { /* nao-JSON */ }
        dbmod.sentMsgs.add(waId, remoteJid, tag, text);
        log.info(`enviado -> ${target} (${tag})${waId ? ' #' + waId : ''}`);
      } catch (e) {
        log.error(`falha envio (${tag}): ${e.message}`);
      }
      await sleep(config.sendMinDelayMs);
    }
  }
  draining = false;
}

// mentioned: array de JIDs (554...@s.whatsapp.net) p/ marcar (@) no grupo.
function enqueue(text, tag = 'msg', target = config.sendTarget, mentioned = null) {
  if (!target) {
    log.warn(`sem destino configurado; mensagem (${tag}) nao enfileirada`);
    return;
  }
  // TRAVA DE DESTINO: nao enfileira nada pra fora da allowlist (grupo configurado).
  if (!assertTargetAllowed(target, tag)) return;
  queue.push({ target, text, tag, mentioned });
  drain();
}

async function flush() {
  await drain();
  while (queue.length || draining) await sleep(200);
}

// DELETE /chat/deleteMessageForEveryone/{instance} — apaga PRA TODOS (janela do WhatsApp).
async function deleteForEveryone({ id, remoteJid, fromMe = true, participant }) {
  const url = `${config.evolutionBaseUrl}/chat/deleteMessageForEveryone/${config.evolutionInstance}`;
  const key = { id, remoteJid, fromMe };
  if (participant) key.participant = participant;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', apikey: config.evolutionApiKey },
    body: JSON.stringify(key),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`HTTP ${res.status} :: ${body.slice(0, 200)}`);
  return body;
}

// GET /group/participants/{instance}?groupJid=...  -> [{ id, phoneJid, phone, name }]
async function fetchParticipants(groupJid) {
  const url = `${config.evolutionBaseUrl}/group/participants/${config.evolutionInstance}?groupJid=${groupJid}`;
  const res = await fetch(url, { headers: { apikey: config.evolutionApiKey } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em participants`);
  const data = await res.json();
  const arr = (data && data.participants) || [];
  return arr.map((p) => ({
    id: p.id,
    phoneJid: p.phoneNumber || null, // 554...@s.whatsapp.net
    phone: (p.phoneNumber || '').split('@')[0] || null,
    name: p.name || null,
  }));
}

module.exports = { enqueue, flush, postText, deleteForEveryone, fetchParticipants };
