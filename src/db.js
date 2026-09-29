'use strict';
// SQLite (better-sqlite3, sincrono). Estado por jogo, idempotencia e log de envios.
// Failsafe: WAL + chaves estaveis => restart do PM2 nao duplica nem perde evento.
// Versao enxuta do db do copa-bot (1 time so: sem xref/openfootball/welcome).
const Database = require('better-sqlite3');
const config = require('./config');
const log = require('./logger');

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

-- estado por jogo (maquina de estado do detector)
CREATE TABLE IF NOT EXISTS match_state (
  canonical_id TEXT PRIMARY KEY,
  home_score INTEGER, away_score INTEGER,
  status TEXT, phase TEXT,
  preview_sent INTEGER DEFAULT 0,
  kickoff_sent INTEGER DEFAULT 0,
  finished_sent INTEGER DEFAULT 0,
  home_trailed INTEGER DEFAULT 0,
  away_trailed INTEGER DEFAULT 0,
  updated_at TEXT, last_source TEXT
);

-- idempotencia de eventos (gol/cartao/bom-dia/pos-jogo/noticia...)
CREATE TABLE IF NOT EXISTS sent_events (
  event_key TEXT PRIMARY KEY,
  sent_at TEXT
);

-- telemetria de saude por fonte
CREATE TABLE IF NOT EXISTS source_health (
  source TEXT PRIMARY KEY,
  last_ok TEXT,
  last_error TEXT,
  consecutive_fail INTEGER DEFAULT 0
);

-- log de mensagens enviadas (guarda key.id p/ apagar-pra-todos via API)
CREATE TABLE IF NOT EXISTS sent_messages (
  wa_id      TEXT PRIMARY KEY,
  remote_jid TEXT,
  from_me    INTEGER DEFAULT 1,
  tag        TEXT,
  text       TEXT,
  sent_at    TEXT
);

-- membros do grupo ja vistos (p/ boas-vindas a quem entra)
CREATE TABLE IF NOT EXISTS group_members (
  jid TEXT PRIMARY KEY,   -- phoneNumber JID (554...@s.whatsapp.net)
  phone TEXT,
  seen_at TEXT
);

-- fila de novos a saudar (boas-vindas em lote, 1x/dia)
CREATE TABLE IF NOT EXISTS pending_welcome (
  jid TEXT PRIMARY KEY,
  phone TEXT,
  added_at TEXT
);
`);

// ---------- meta ----------
const _metaGet = db.prepare('SELECT v FROM meta WHERE k = ?');
const _metaSet = db.prepare(
  'INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
);
const meta = {
  get: (k) => _metaGet.get(k)?.v ?? null,
  set: (k, v) => _metaSet.run(k, String(v)),
};

// ---------- sent_events (idempotencia) ----------
const _evtHas = db.prepare('SELECT 1 FROM sent_events WHERE event_key = ?');
const _evtAdd = db.prepare(
  'INSERT OR IGNORE INTO sent_events (event_key, sent_at) VALUES (?, ?)'
);
const events = {
  alreadySent: (key) => !!_evtHas.get(key),
  markSent: (key) => _evtAdd.run(key, new Date().toISOString()).changes > 0,
};

// ---------- match_state ----------
const _stateGet = db.prepare('SELECT * FROM match_state WHERE canonical_id = ?');
const _stateUpsert = db.prepare(`
  INSERT INTO match_state
    (canonical_id, home_score, away_score, status, phase,
     preview_sent, kickoff_sent, finished_sent, home_trailed, away_trailed,
     updated_at, last_source)
  VALUES
    (@canonical_id, @home_score, @away_score, @status, @phase,
     @preview_sent, @kickoff_sent, @finished_sent, @home_trailed, @away_trailed,
     @updated_at, @last_source)
  ON CONFLICT(canonical_id) DO UPDATE SET
     home_score=excluded.home_score, away_score=excluded.away_score,
     status=excluded.status, phase=excluded.phase,
     preview_sent=excluded.preview_sent, kickoff_sent=excluded.kickoff_sent,
     finished_sent=excluded.finished_sent,
     home_trailed=excluded.home_trailed, away_trailed=excluded.away_trailed,
     updated_at=excluded.updated_at, last_source=excluded.last_source
`);
const state = {
  get: (cid) => _stateGet.get(cid) || null,
  upsert: (row) =>
    _stateUpsert.run({
      preview_sent: 0, kickoff_sent: 0, finished_sent: 0,
      home_trailed: 0, away_trailed: 0, phase: null,
      ...row,
      updated_at: new Date().toISOString(),
    }),
};

// ---------- source_health ----------
const _healthUpsertOk = db.prepare(`
  INSERT INTO source_health (source, last_ok, last_error, consecutive_fail)
  VALUES (?, ?, NULL, 0)
  ON CONFLICT(source) DO UPDATE SET last_ok=excluded.last_ok, consecutive_fail=0
`);
const _healthUpsertFail = db.prepare(`
  INSERT INTO source_health (source, last_ok, last_error, consecutive_fail)
  VALUES (?, NULL, ?, 1)
  ON CONFLICT(source) DO UPDATE SET
    last_error=excluded.last_error,
    consecutive_fail=source_health.consecutive_fail + 1
`);
const _healthGet = db.prepare('SELECT * FROM source_health WHERE source = ?');
const _healthAll = db.prepare('SELECT * FROM source_health');
const health = {
  ok: (source) => _healthUpsertOk.run(source, new Date().toISOString()),
  fail: (source, err) => _healthUpsertFail.run(source, String(err).slice(0, 300)),
  get: (source) => _healthGet.get(source) || null,
  all: () => _healthAll.all(),
};

// ---------- sent_messages (apagar-para-todos via API) ----------
const _smAdd = db.prepare(
  `INSERT OR IGNORE INTO sent_messages (wa_id, remote_jid, from_me, tag, text, sent_at)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const _smRecent = db.prepare(
  'SELECT wa_id, remote_jid, from_me, tag, text, sent_at FROM sent_messages ORDER BY sent_at DESC LIMIT ?'
);
const _smGet = db.prepare('SELECT wa_id, remote_jid, from_me, tag, text, sent_at FROM sent_messages WHERE wa_id = ?');
const _smDel = db.prepare('DELETE FROM sent_messages WHERE wa_id = ?');
const sentMsgs = {
  add: (waId, remoteJid, tag, text) => {
    if (!waId) return;
    _smAdd.run(waId, remoteJid || null, 1, tag || null, (text || '').slice(0, 200), new Date().toISOString());
  },
  recent: (limit = 15) => _smRecent.all(limit),
  get: (waId) => _smGet.get(waId),
  remove: (waId) => _smDel.run(waId),
};

// ---------- group_members (boas-vindas) ----------
const _memHas = db.prepare('SELECT 1 FROM group_members WHERE jid = ?');
const _memAdd = db.prepare('INSERT OR IGNORE INTO group_members (jid, phone, seen_at) VALUES (?, ?, ?)');
const _memCount = db.prepare('SELECT COUNT(*) c FROM group_members');
const _pendAdd = db.prepare('INSERT OR IGNORE INTO pending_welcome (jid, phone, added_at) VALUES (?, ?, ?)');
const _pendList = db.prepare('SELECT jid, phone FROM pending_welcome ORDER BY added_at');
const _pendClear = db.prepare('DELETE FROM pending_welcome');
const members = {
  isKnown: (jid) => !!_memHas.get(jid),
  add: (jid, phone) => _memAdd.run(jid, phone || null, new Date().toISOString()),
  count: () => _memCount.get().c,
  addPending: (jid, phone) => _pendAdd.run(jid, phone || null, new Date().toISOString()),
  listPending: () => _pendList.all(),
  clearPending: () => _pendClear.run(),
};

log.debug('db pronto em', config.dbPath);

module.exports = { db, meta, events, state, health, sentMsgs, members };
