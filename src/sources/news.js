'use strict';
// Noticias do time via Google News RSS (gratis, sem chave), no idioma configurado.
// Devolve itens recentes [{ title, source, pubDate, ts }] ja limpos.
const config = require('./../config');
const { fetchText } = require('./base');

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

// titulo do Google News vem "Manchete - Fonte"; separa a fonte
function splitTitleSource(rawTitle, rawSource) {
  let title = decode(rawTitle);
  const source = decode(rawSource);
  if (source && title.endsWith(` - ${source}`)) {
    title = title.slice(0, -(` - ${source}`).length).trim();
  } else {
    const i = title.lastIndexOf(' - ');
    if (i > 20) title = title.slice(0, i).trim();
  }
  return { title, source };
}

// ruido que nao interessa a torcida: burocracia + apostas + lixo estrangeiro/estatistico
const BLOCK = new RegExp([
  // burocratico
  'edital', 'convoca[çc]', 'conselho deliberativo', 'assembleia', 'estatut',
  'balan[çc]o', 'demonstra[çc]', 'presta[çc][ãa]o de contas', 'nota de pesar',
  'nota oficial', 'comunicado oficial', 's[óo]cio[- ]torcedor.*(plano|mensalidade)', 'elei[çc]',
  // apostas / odds / palpite
  '\\bodds?\\b', 'palpite', 'progn[óo]stico', '\\baposta', '\\bbet\\b', 'melhores odds', 'odds scanner',
  // lixo estrangeiro / transfermarkt / estatistico / base
  'aufstellung', 'spieltag', 'detailed squad', 'detailed view', '\\bgallery\\b', '\\bsquad\\b', '» melhores',
  '\\bu-?20\\b', '\\bu-?17\\b', '\\bu-?23\\b', 'sub-?20', 'sub-?17', 'record vs', 'head-?to-?head', '\\bh2h\\b', 'line-?ups',
].join('|'), 'i');

function isNoise(title) {
  if (BLOCK.test(title)) return true;
  // titulo "vazio" que e so o nome do clube (landing pages tipo Transfermarkt)
  if (title.trim().toLowerCase().startsWith(config.team.name.toLowerCase()) && title.trim().length <= config.team.name.length + 20) return true;
  if (title.replace(/[^a-zA-ZÀ-ÿ]/g, '').length < 12) return true;
  return false;
}

async function fetchNews(limit = 8) {
  const q = encodeURIComponent(config.newsQuery);
  const url = `https://news.google.com/rss/search?q=${q}&${config.lang === 'en' ? 'hl=en-GB&gl=GB&ceid=GB:en' : 'hl=pt-BR&gl=BR&ceid=BR:pt-419'}`;
  const xml = await fetchText(url);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  const out = [];
  for (const m of items) {
    const b = m[1];
    const rawTitle = (b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const rawSource = (b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '';
    const pub = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const link = decode((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || ''); // link do Google News (resolve no navegador)
    const { title, source } = splitTitleSource(rawTitle, rawSource);
    if (!title || isNoise(title)) continue;
    const ts = pub ? Date.parse(pub) : 0;
    out.push({ title, source, link, pubDate: pub, ts: Number.isFinite(ts) ? ts : 0 });
  }
  // mais recentes primeiro
  out.sort((a, b) => b.ts - a.ts);
  return dedupeSimilar(out).slice(0, limit);
}

// tokens significativos de um titulo (sem acento, sem stopwords curtas)
function tokenize(title) {
  return String(title).toLowerCase().normalize('NFD').replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/).filter((w) => w.length > 3);
}
// remove manchetes quase-iguais (mesma materia em 2 veiculos). Mantem a 1a (mais recente).
function dedupeSimilar(items) {
  const kept = [];
  for (const it of items) {
    const t = new Set(tokenize(it.title));
    const dup = kept.some((k) => {
      const kt = new Set(tokenize(k.title));
      const inter = [...t].filter((w) => kt.has(w)).length;
      const uni = new Set([...t, ...kt]).size || 1;
      return inter / uni >= 0.5; // >=50% de sobreposicao => mesma materia
    });
    if (!dup) kept.push(it);
  }
  return kept;
}

// itens frescos (publicados nas ultimas N horas)
function freshOnly(items, maxAgeHours = 36) {
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  return items.filter((n) => n.ts && n.ts >= cutoff);
}

module.exports = { fetchNews, dedupeSimilar, freshOnly };
