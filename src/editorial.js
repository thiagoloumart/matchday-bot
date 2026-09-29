'use strict';
// "Texto do dia" ORIGINAL (não cara de IA) em PT/EN, gerado pelo Claude Code CLI local
// (`claude -p`). Opcional: EDITORIAL_ENABLED=true. 3 blocos com cabeçalho, voz de torcedor.
// Cache 1x/dia no db.
const { execFile } = require('child_process');
const config = require('./config');
const log = require('./logger');
const dbmod = require('./db');
const format = require('./format');

const T = config.team;

function localYmd() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function dateLabel() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, weekday: 'long', day: '2-digit', month: 'long' }).format(new Date());
}

function buildPrompt(data) {
  const lines = [];
  if (data.standing && data.standing.rank != null) {
    const st = data.standing;
    lines.push(`- Table: ${st.rank} in ${st.league}, ${st.points} points (W${st.wins} D${st.ties} L${st.losses} in ${st.played} games)`);
  }
  if (data.lastResult) {
    const s = format.sides(data.lastResult);
    lines.push(`- Last match: ${T.name} ${s.teamScore} x ${s.oppScore} ${s.opp} (${s.teamScore > s.oppScore ? 'win' : s.teamScore < s.oppScore ? 'loss' : 'draw'})`);
  }
  if (data.nextMatch) {
    const s = format.sides(data.nextMatch);
    const dia = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, day: '2-digit', month: '2-digit' }).format(new Date(data.nextMatch.kickoffUtc));
    lines.push(`- Next match: ${s.teamIsHome ? `${T.name} x ${s.opp} (home)` : `${s.opp} x ${T.name} (away)`}, on ${dia}, ${data.nextMatch.competition}`);
  }
  const heads = (data.news || []).slice(0, 7).map((n) => `  • ${n.title} (${n.source})`).join('\n');

  const main = config.lang === 'en' ? 'English' : 'Brazilian Portuguese';
  const other = config.lang === 'en' ? 'Brazilian Portuguese' : 'English';
  return `You are the editor of "${T.groupName}", a fan news page about ${T.name} (nickname: ${T.nick}; fans: ${T.fans}). Write TODAY'S WRAP (${dateLabel()}).

Use EXACTLY 3 short blocks. Each block: a "header" of 2 to 4 words and a "text" of 2 to 3 sentences (40 to 65 words), in the voice of a fan-journalist: direct, with personality and opinion, anchored in the facts below. Write like a person, NOT like an AI: no clichés such as "in this article", "stay tuned", "it is worth noting" or "in the world of football".

The 3 blocks, in this order: 1) Where the team stands (table/form/last match); 2) Eyes on the next match; 3) The day's roundup (what the headlines say).

TODAY'S FACTS:
${lines.join('\n')}

TODAY'S HEADLINES:
${heads || '  (no fresh headlines)'}

Write the 3 blocks in ${main}, then translate them NATURALLY (not literally) into ${other}, keeping the same fan voice.

Reply ONLY with valid JSON, no markdown:
{"pt":[{"header":"","text":""},{"header":"","text":""},{"header":"","text":""}],"en":[...same 3...]}`;
}

function callClaude(prompt) {
  return new Promise((resolve) => {
    execFile('claude', ['-p', prompt], { timeout: 120000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (err) { log.warn(`editorial: claude CLI falhou: ${err.message}`); return resolve(null); }
      resolve(stdout || '');
    });
  });
}

function cleanArr(a) {
  return Array.isArray(a) ? a.filter((b) => b && b.header && b.text).slice(0, 3) : [];
}
function parseObj(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) s = m[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const o = JSON.parse(s.slice(start, end + 1));
    const out = { pt: cleanArr(o.pt), en: cleanArr(o.en) };
    if (!out.pt.length && !out.en.length) return null;
    if (!out.en.length) out.en = out.pt;
    if (!out.pt.length) out.pt = out.en;
    return out;
  } catch { return null; }
}

const EMPTY = { pt: [], en: [] };

// Devolve {pt:[],en:[]} (cache 1x/dia). force regenera.
async function getEditorial(data, force = false) {
  if (!config.editorialEnabled) return EMPTY;
  const ymd = localYmd();
  const key = `editorial:${ymd}`;
  if (!force) {
    const cached = dbmod.meta.get(key);
    if (cached) { try { const o = JSON.parse(cached); if (o && o.pt) return o; } catch { /* regenera */ } }
  }
  const obj = parseObj(await callClaude(buildPrompt(data)));
  if (obj) {
    dbmod.meta.set(key, JSON.stringify(obj));
    log.info(`editorial gerado pelo claude (pt:${obj.pt.length} en:${obj.en.length})`);
    return obj;
  }
  const prev = dbmod.meta.get(key);
  if (prev) { try { const o = JSON.parse(prev); if (o && o.pt) return o; } catch { /* nada */ } }
  return EMPTY;
}

module.exports = { getEditorial, buildPrompt };
