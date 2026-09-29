'use strict';
// Pagina de noticias do time (opcional, PAGE_ENABLED=true): PT/EN + arquivo de datas + SEO
// (hreflang, JSON-LD, breadcrumb, sitemap) + mobile-first. Agregador de manchetes + texto
// ORIGINAL do dia (opcional, editorial.js). Cores e nomes vem do perfil do time.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const log = require('./logger');
const format = require('./format');
const news = require('./sources/news');
const espn = require('./sources/espn');
const standings = require('./sources/standings');
const editorial = require('./editorial');

const T = config.team;
const ORIGIN = (config.pageUrl || '').replace(/\/+$/, '');
const CREST = `https://a.espncdn.com/i/teamlogos/soccer/500/${T.espnId}.png`;
const OG_IMG = CREST;
const ROOT = path.dirname(config.pageOutput);
const LANGS = ['pt', 'en'];
const LOCALE = { pt: 'pt-BR', en: 'en-GB' };
const C1 = config.pageColor1, C2 = config.pageColor2;
const rgb = (hex) => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(','); };
const ORD = { pt: (n) => `${n}º`, en: (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); } };
const WDL = { pt: ['V', 'E', 'D'], en: ['W', 'D', 'L'] };

const S = {
  pt: { brand: T.groupName, eyebrow: 'Edição diária', title: T.groupName,
    subPrefix: 'Próximo jogo:', subNone: `Tudo do ${T.name}, todo dia`, resumo: 'Resumo do dia',
    latest: `Últimas do ${T.nick}`, nextGame: 'Próximo jogo', inLeague: 'Na tabela', points: 'pontos',
    home: '🏠 em casa', away: '✈️ fora de casa', readMore: 'ler matéria', archiveH: 'Edições anteriores',
    byline: 'Redação', updated: 'Atualizado em', home2: 'Início', today: 'Hoje', press: 'Imprensa',
    aggregator: 'Agregador de notícias · cada matéria abre no veículo de origem', empty: `Sem novidades no momento. Volte mais tarde! ${T.emoji}`,
    ctaH: `${T.emoji} Entre no grupo ${T.groupName}`, ctaP: `Jogos ao vivo, gols e as notícias do ${T.name} direto no seu WhatsApp.`, ctaBtn: 'Entrar no grupo →',
    metaTitle: `Notícias do ${T.name} — tudo do ${T.nick}, todo dia`,
    metaDesc: (st) => `Notícias do ${T.name}: resumo do dia, jogos, resultados, tabela e as principais manchetes.${st ? ` ${st.rank}º com ${st.points} pts.` : ''}` },
  en: { brand: T.groupName, eyebrow: 'Daily edition', title: T.groupName,
    subPrefix: 'Next match:', subNone: `Everything about ${T.name}, every day`, resumo: 'Daily wrap',
    latest: `Latest on ${T.name}`, nextGame: 'Next match', inLeague: 'In the table', points: 'points',
    home: '🏠 home', away: '✈️ away', readMore: 'read article', archiveH: 'Past editions',
    byline: 'Newsroom', updated: 'Updated at', home2: 'Home', today: 'Today', press: 'Press',
    aggregator: 'News aggregator · each article opens on its original source', empty: `No fresh news right now. Check back later! ${T.emoji}`,
    ctaH: `${T.emoji} Join the ${T.groupName} group`, ctaP: `Live matches, goals and ${T.name} news straight to your WhatsApp.`, ctaBtn: 'Join the group →',
    metaTitle: `${T.name} News — everything about the ${T.nick}, every day`,
    metaDesc: (st) => `${T.name} news: daily wrap, matches, results, league table and the main headlines.${st ? ` ${ORD.en(st.rank)} with ${st.points} pts.` : ''}` },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmt(lang, iso, opts) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: config.timezone, ...opts }).format(d);
}
function nowLabel(lang) { return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: config.timezone, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date()); }
function nowTime(lang) { return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
function dateLabelFromYmd(lang, ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}
function todayYmd() { return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }

// caminho relativo da pagina por (lang, ymd?, isArchive)
function pagePath(lang, ymd, isArchive) {
  const base = isArchive ? `/${ymd}/` : `/`;
  return lang === 'pt' ? base : `${base}${lang}/`;
}

function editorialBlocks(blocks, S0) {
  if (!blocks || !blocks.length) return '';
  return `<section class="ed" aria-label="${esc(S0.resumo)}">
    <div class="eyebrow">${esc(S0.resumo)}</div>
    ${blocks.map((b) => `<div class="edblock"><h2>${esc(b.header)}</h2><p>${esc(b.text)}</p></div>`).join('\n')}
  </section>`;
}
function spotlight(data, lang, S0) {
  const next = data.nextMatch;
  if (!next && !data.standing) return '';
  const s = next ? format.sides(next) : null;
  const dia = next ? fmt(lang, next.kickoffUtc, { day: '2-digit', month: '2-digit' }) : '';
  const hora = next ? format.kickoffLocal(next.kickoffUtc) : '';
  const last = data.lastResult ? format.sides(data.lastResult) : null;
  return `<section class="spot glass" aria-label="${esc(S0.nextGame)}"><div class="spot-grid">
    ${next ? `<div class="spot-col"><span class="eyebrow">${esc(S0.nextGame)}</span>
      <strong class="spot-team">${s.teamIsHome ? `${esc(T.name)} <i>×</i> ${esc(s.opp)}` : `${esc(s.opp)} <i>×</i> ${esc(T.name)}`}</strong>
      <span class="spot-when">${dia} · ${hora}h</span><span class="spot-meta">${esc(next.competition || '')} · ${s.teamIsHome ? S0.home : S0.away}</span></div>` : ''}
    ${data.standing && data.standing.rank != null ? `<div class="spot-col"><span class="eyebrow">${esc(S0.inLeague)}</span>
      <strong class="spot-num">${ORD[lang](data.standing.rank)}</strong><span class="spot-when">${data.standing.points} ${esc(S0.points)}</span>
      <span class="spot-meta">${data.standing.wins}${WDL[lang][0]} ${data.standing.ties}${WDL[lang][1]} ${data.standing.losses}${WDL[lang][2]}${last ? ` · ${last.teamScore}×${last.oppScore}` : ''}</span></div>` : ''}
  </div></section>`;
}
function newsList(items, lang, S0) {
  if (!items.length) return `<p class="empty">${esc(S0.empty)}</p>`;
  return `<ol class="feed">` + items.map((n) => {
    const iso = n.ts ? new Date(n.ts).toISOString() : null;
    const when = iso ? fmt(lang, iso, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const open = n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener nofollow" class="fcard glass">` : `<div class="fcard glass">`;
    const close = n.link ? `</a>` : `</div>`;
    return `<li>${open}<div class="fhead"><span class="badge">${esc(n.source || S0.press)}</span>${when ? `<time class="when" datetime="${esc(iso)}">${when}</time>` : ''}</div>
      <h3>${esc(n.title)}</h3>${n.link ? `<span class="read">${esc(S0.readMore)} <i>→</i></span>` : ''}${close}</li>`;
  }).join('\n') + `</ol>`;
}
function archiveStrip(lang, ymd, isArchive, archiveDates, S0) {
  const others = archiveDates.filter((d) => d !== ymd).slice(0, 14);
  if (!others.length && !isArchive) return '';
  const chips = others.map((d) => `<a class="chip" href="${pagePath(lang, d, true)}">${fmt(lang, d + 'T12:00:00Z', { day: '2-digit', month: '2-digit' })}</a>`).join('');
  const live = isArchive ? `<a class="chip live" href="${pagePath(lang, null, false)}">● ${esc(S0.today)}</a>` : '';
  return `<nav class="archive" aria-label="${esc(S0.archiveH)}"><span class="archive-h">${esc(S0.archiveH)}</span><div class="chips">${live}${chips}</div></nav>`;
}

function jsonLd(lang, data, ctx, S0) {
  const url = ORIGIN + pagePath(lang, ctx.ymd, ctx.isArchive);
  const items = (data.news || []).slice(0, 8).map((n, i) => ({ '@type': 'ListItem', position: i + 1, name: n.title, url: n.link || url }));
  const crumbs = [
    { '@type': 'ListItem', position: 1, name: S0.home2, item: ORIGIN + '/' },
  ];
  if (ctx.isArchive) crumbs.push({ '@type': 'ListItem', position: 2, name: ctx.dateLabelStr, item: url });
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', '@id': ORIGIN + '/#website', url: ORIGIN + '/', name: T.groupName, inLanguage: LOCALE[lang] },
    { '@type': 'NewsMediaOrganization', '@id': ORIGIN + '/#org', name: T.groupName, url: ORIGIN + '/', logo: CREST },
    { '@type': 'SportsTeam', name: T.name, alternateName: T.nick, sport: 'Association football' },
    { '@type': 'CollectionPage', '@id': url + '#page', url, name: S0.metaTitle, description: S0.metaDesc(data.standing), inLanguage: LOCALE[lang], isPartOf: { '@id': ORIGIN + '/#website' }, publisher: { '@id': ORIGIN + '/#org' }, dateModified: new Date().toISOString(), mainEntity: { '@type': 'ItemList', itemListElement: items } },
    { '@type': 'BreadcrumbList', itemListElement: crumbs },
  ] });
}

function renderPage(lang, data, ctx) {
  const S0 = S[lang];
  const blocks = (data.editorial && data.editorial[lang]) || [];
  const url = ORIGIN + pagePath(lang, ctx.ymd, ctx.isArchive);
  const alts = LANGS.map((l) => `<link rel="alternate" hreflang="${LOCALE[l].toLowerCase()}" href="${ORIGIN + pagePath(l, ctx.ymd, ctx.isArchive)}">`).join('\n')
    + `\n<link rel="alternate" hreflang="x-default" href="${ORIGIN + pagePath('pt', ctx.ymd, ctx.isArchive)}">`;
  const subtitle = data.nextMatch
    ? (() => { const s = format.sides(data.nextMatch); const d = fmt(lang, data.nextMatch.kickoffUtc, { day: '2-digit', month: '2-digit' }); return `${S0.subPrefix} ${s.teamIsHome ? `${esc(T.name)} x ${esc(s.opp)}` : `${esc(s.opp)} x ${esc(T.name)}`} · ${d}`; })()
    : S0.subNone;
  const dateBadge = ctx.isArchive ? ctx.dateLabelStr : nowLabel(lang);
  const langSw = LANGS.map((l) => `<a class="${l === lang ? 'active' : ''}" href="${pagePath(l, ctx.ymd, ctx.isArchive)}" hreflang="${LOCALE[l].toLowerCase()}">${l.toUpperCase()}</a>`).join('');
  return `<!DOCTYPE html>
<html lang="${LOCALE[lang]}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(S0.metaTitle)}</title>
<meta name="description" content="${esc(S0.metaDesc(data.standing))}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
${alts}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(T.groupName)}">
<meta property="og:title" content="${esc(S0.metaTitle)}">
<meta property="og:description" content="${esc(S0.metaDesc(data.standing))}">
<meta property="og:image" content="${OG_IMG}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="${LOCALE[lang].replace('-', '_')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(S0.metaTitle)}">
<meta name="twitter:description" content="${esc(S0.metaDesc(data.standing))}">
<meta name="twitter:image" content="${OG_IMG}">
<meta name="theme-color" content="#070a12">
<link rel="icon" href="${CREST}">
<link rel="apple-touch-icon" href="${OG_IMG}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;700;800&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<script type="application/ld+json">${jsonLd(lang, data, ctx, S0)}</script>
<style>
:root{--red:${C1};--red-rgb:${rgb(C1)};--blue:${C2};--blue-rgb:${rgb(C2)};--display:'Sora',system-ui,sans-serif;--sans:'Manrope',system-ui,sans-serif;--mono:'JetBrains Mono',monospace}
:root[data-theme="dark"]{--bg:#070a12;--bg-2:#0c1020;--text:#f3f5fa;--muted:#9aa3b8;--muted-2:#6a7185;--hair:rgba(255,255,255,.10);--glass:rgba(255,255,255,.045);--glass-2:rgba(255,255,255,.08)}
:root[data-theme="light"]{--bg:#eef1f7;--bg-2:#ffffff;--text:#10141f;--muted:#525a6e;--muted-2:#828a9c;--hair:rgba(10,20,50,.12);--glass:rgba(255,255,255,.6);--glass-2:rgba(255,255,255,.82)}
*{margin:0;padding:0;box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{font-family:var(--sans);background:var(--bg);color:var(--text);font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:inherit;text-decoration:none}img{max-width:100%}
.wrap{max-width:760px;margin:0 auto;padding:0 18px}
.bgfx{position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
.bgfx .glow{position:absolute;border-radius:50%;filter:blur(95px);opacity:.6}
.bgfx .g1{width:80vw;height:80vw;max-width:760px;max-height:760px;top:-30vw;left:50%;transform:translateX(-50%);background:radial-gradient(circle,rgba(var(--red-rgb),.42),transparent 62%)}
.bgfx .g2{width:60vw;height:60vw;bottom:-16vw;left:-16vw;background:radial-gradient(circle,rgba(var(--blue-rgb),.34),transparent 60%)}
.bgfx .g3{width:55vw;height:55vw;top:46vh;right:-18vw;background:radial-gradient(circle,rgba(var(--red-rgb),.20),transparent 60%)}
#bar{position:fixed;top:0;left:0;height:3px;width:0;z-index:90;background:var(--red);box-shadow:0 0 12px rgba(var(--red-rgb),.85)}
.nav{position:sticky;top:max(10px,env(safe-area-inset-top));z-index:50;margin:12px auto 0;max-width:760px;padding:0 14px}
.cap{display:flex;align-items:center;gap:.5rem;background:var(--glass);backdrop-filter:blur(22px) saturate(160%);-webkit-backdrop-filter:blur(22px) saturate(160%);border:1px solid var(--hair);border-radius:999px;padding:.4rem .5rem;box-shadow:0 8px 30px -12px rgba(0,0,0,.6)}
.cap .brand{display:flex;align-items:center;gap:.45rem;font-family:var(--display);font-weight:700;font-size:.9rem;padding:.15rem .35rem;min-width:0}
.cap .brand span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cap .brand img{width:22px;height:22px;flex:none}
.cap .sp{margin-left:auto;display:flex;align-items:center;gap:.3rem;flex:none}
.langsw{display:flex;gap:.15rem}.langsw a{font:700 .7rem var(--mono);color:var(--muted);padding:.3rem .5rem;border-radius:999px;opacity:.7}
.langsw a.active{opacity:1;color:var(--text);background:var(--glass-2);border:1px solid var(--hair)}
.tgl{display:grid;place-items:center;width:34px;height:34px;border-radius:999px;background:var(--glass-2);border:1px solid var(--hair);color:var(--muted);cursor:pointer;font-size:1rem}
.crumb{font:600 .74rem var(--mono);color:var(--muted-2);padding:14px 0 0;display:flex;gap:.4rem;flex-wrap:wrap}
.crumb a{color:var(--muted)}.crumb a:hover{color:var(--red)}
.hero{padding:30px 0 4px;text-align:center}
.chip-logo{width:88px;height:88px;margin:0 auto 1.3rem;border-radius:24px;background:var(--glass);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid var(--hair);display:grid;place-items:center;padding:14px;box-shadow:0 1px 0 rgba(255,255,255,.08) inset,0 24px 60px -22px rgba(0,0,0,.7),0 0 60px -12px rgba(var(--red-rgb),.5)}
.chip-logo img{width:100%;height:100%;object-fit:contain}
.eyebrow{font:700 .7rem var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--red);display:block}
.hero h1{font-family:var(--display);font-weight:800;font-size:clamp(2.5rem,11vw,4.4rem);line-height:1;letter-spacing:-.035em;margin:.7rem 0 .4rem;background:linear-gradient(115deg,var(--text) 42%,var(--red));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero .sub{color:var(--muted);font-weight:500;font-size:.98rem}
.metas{display:flex;gap:.45rem;justify-content:center;flex-wrap:wrap;margin-top:1.1rem}
.metas span{font:600 .74rem var(--mono);color:var(--muted);background:var(--glass);border:1px solid var(--hair);border-radius:999px;padding:.32rem .75rem;backdrop-filter:blur(10px)}
.byline{display:flex;align-items:center;justify-content:center;gap:.5rem;margin-top:1rem;color:var(--muted);font-size:.84rem;flex-wrap:wrap}
.byline .av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,var(--red),var(--blue));color:#fff;font-weight:800;font-size:.78rem}
.stripe{height:5px;width:160px;border-radius:3px;margin:1.4rem auto 0;background:linear-gradient(90deg,var(--blue) 33%,var(--red) 33% 66%,var(--text) 66%)}
.glass{background:var(--glass);backdrop-filter:blur(22px) saturate(150%);-webkit-backdrop-filter:blur(22px) saturate(150%);border:1px solid var(--hair);border-radius:24px;box-shadow:0 1px 0 rgba(255,255,255,.07) inset,0 30px 60px -30px rgba(0,0,0,.6)}
.sheet{max-width:780px;margin:22px auto 0;padding:32px clamp(18px,5vw,52px) 38px;background:var(--bg-2);border:1px solid var(--hair);border-radius:30px;box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 60px 130px -55px rgba(0,0,0,.85)}
.ed{margin-top:.5rem}.edblock{margin-top:1.5rem}
.edblock h2{font-family:var(--display);font-weight:700;font-size:clamp(1.4rem,5.2vw,1.95rem);letter-spacing:-.02em;line-height:1.14}
.edblock h2::before{content:"";display:inline-block;width:24px;height:3px;border-radius:2px;background:var(--red);vertical-align:middle;margin-right:.55rem;transform:translateY(-.3em)}
.edblock p{margin-top:.55rem;opacity:.92;font-size:1.04rem}
.ed>.eyebrow{margin-bottom:.3rem}
.spot{margin-top:2.2rem;padding:1.6rem;position:relative;overflow:hidden}
.spot::before{content:"";position:absolute;inset:0;background:radial-gradient(120% 100% at 0 0,rgba(var(--red-rgb),.16),transparent 55%),radial-gradient(120% 100% at 100% 100%,rgba(var(--blue-rgb),.16),transparent 55%);pointer-events:none}
.spot-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.1rem;position:relative}
.spot-col{display:flex;flex-direction:column;gap:.22rem}
.spot-team{font-family:var(--display);font-weight:700;font-size:1.15rem;line-height:1.15}.spot-team i{color:var(--muted);font-style:normal}
.spot-num{font-family:var(--display);font-weight:800;font-size:2.8rem;line-height:1}.spot-num em{font-style:normal;font-size:1.3rem;color:var(--muted)}
.spot-when{font:700 .98rem var(--mono);color:var(--red)}.spot-meta{font-size:.8rem;color:var(--muted)}
.sec-h{font:700 .7rem var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin:2.6rem 0 1.1rem;display:flex;align-items:center;gap:.55rem}
.sec-h::before{content:"";width:24px;height:3px;border-radius:2px;background:linear-gradient(90deg,var(--red),var(--blue))}
.feed{list-style:none;counter-reset:f}.feed li{counter-increment:f;margin-bottom:.9rem}
.fcard{display:block;padding:1.2rem 1.3rem;position:relative;transition:transform .15s ease,box-shadow .15s ease}
.fcard::after{content:counter(f,decimal-leading-zero);position:absolute;top:1.2rem;right:1.3rem;font:700 .78rem var(--mono);color:var(--muted-2);opacity:.7}
.fcard:hover{transform:translateY(-3px);box-shadow:0 20px 44px -24px rgba(0,0,0,.7)}
.fhead{display:flex;align-items:center;gap:.55rem;margin-bottom:.55rem}
.badge{font:700 .64rem var(--mono);letter-spacing:.04em;text-transform:uppercase;padding:.2rem .55rem;border-radius:6px;background:rgba(var(--red-rgb),.13);color:var(--red);border:1px solid rgba(var(--red-rgb),.3)}
.when{font:500 .7rem var(--mono);color:var(--muted)}
.fcard h3{font-family:var(--display);font-weight:600;font-size:1.08rem;line-height:1.32;padding-right:1.8rem}
.read{display:inline-block;margin-top:.65rem;color:var(--red);font-weight:700;font-size:.83rem}.read i{font-style:normal;transition:transform .15s}.fcard:hover .read i{transform:translateX(4px)}
.empty{color:var(--muted);padding:.5rem 0}
.archive{margin-top:2.4rem;border-top:1px solid var(--hair);padding-top:1.3rem}
.archive-h{font:700 .68rem var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--muted-2);display:block;margin-bottom:.7rem}
.chips{display:flex;gap:.45rem;overflow-x:auto;padding-bottom:.3rem;-webkit-overflow-scrolling:touch}
.chip{flex:none;font:700 .76rem var(--mono);color:var(--muted);background:var(--glass);border:1px solid var(--hair);border-radius:999px;padding:.4rem .8rem}
.chip:hover{color:var(--text);border-color:var(--red)}.chip.live{color:var(--red);border-color:rgba(var(--red-rgb),.4)}
.cta{margin:2.4rem 0 0;padding:1.8rem;text-align:center;position:relative;overflow:hidden}
.cta::before{content:"";position:absolute;inset:0;background:radial-gradient(120% 120% at 50% 0,rgba(16,185,129,.20),transparent 60%);pointer-events:none}
.cta h2{font-family:var(--display);font-weight:700;font-size:1.3rem;position:relative}
.cta p{color:var(--muted);margin:.45rem 0 1.1rem;font-size:.92rem;position:relative}
.cta a{position:relative;display:inline-flex;align-items:center;gap:.5rem;background:linear-gradient(135deg,#16c46a,#0c9450);color:#fff;font-weight:700;padding:.85rem 1.7rem;border-radius:999px;box-shadow:0 14px 32px -12px rgba(16,185,129,.6);min-height:48px}
footer{text-align:center;color:var(--muted);font-size:.78rem;padding:2.2rem 18px calc(3rem + env(safe-area-inset-bottom))}
.fnav{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-bottom:.9rem}
.fnav a{color:var(--muted);font-weight:600;font-size:.84rem}.fnav a:hover{color:var(--red)}
footer .upd{font:500 .74rem var(--mono);color:var(--muted)}
footer a{color:var(--blue);font-weight:600}
footer .hash{margin-top:.5rem;font-family:var(--display);font-weight:800;background:linear-gradient(115deg,var(--blue),var(--red));-webkit-background-clip:text;background-clip:text;color:transparent}
@media(max-width:540px){.sheet{margin-top:14px;border-radius:22px;padding:24px 17px 30px}.spot-grid{grid-template-columns:1fr;gap:1.2rem}.cap .brand span{max-width:34vw}}
</style>
</head>
<body>
<div id="bar"></div>
<div class="bgfx"><div class="glow g1"></div><div class="glow g2"></div><div class="glow g3"></div></div>

<nav class="nav" aria-label="Topo"><div class="cap">
  <div class="brand"><img src="${CREST}" alt="${esc(T.name)}" width="22" height="22"><span>${esc(S0.brand)}</span></div>
  <div class="sp"><div class="langsw">${langSw}</div>
    <button class="tgl" onclick="(function(r){var n=r.getAttribute('data-theme')==='dark'?'light':'dark';r.setAttribute('data-theme',n);try{localStorage.setItem('matchday-theme',n)}catch(e){}})(document.documentElement)" aria-label="theme">◐</button>
  </div>
</div></nav>

<header class="hero"><div class="wrap">
  <div class="chip-logo"><img src="${CREST}" alt="${esc(T.name)}" width="88" height="88"></div>
  <span class="eyebrow">${esc(S0.eyebrow)}</span>
  <h1>${esc(S0.title)}</h1>
  <p class="sub">${subtitle}</p>
  <div class="metas"><span>📅 ${esc(dateBadge)}</span>${data.standing ? `<span>🏆 ${ORD[lang](data.standing.rank)} · ${data.standing.points} pts</span>` : ''}</div>
  <div class="byline"><span class="av">${esc(T.emoji)}</span> ${esc(S0.byline)}${T.hashtag ? ` · ${esc(T.hashtag)}` : ''}</div>
  <div class="stripe"></div>
</div></header>

<main class="sheet">
  <nav class="crumb" aria-label="breadcrumb"><a href="${pagePath(lang, null, false)}">${esc(S0.home2)}</a>${ctx.isArchive ? ` › <span>${esc(ctx.dateLabelStr)}</span>` : ''}</nav>
  ${editorialBlocks(blocks, S0)}
  ${spotlight(data, lang, S0)}
  <div class="sec-h">${esc(S0.latest)}</div>
  ${newsList(data.news, lang, S0)}
  ${archiveStrip(lang, ctx.ymd, ctx.isArchive, ctx.archiveDates, S0)}
  <section class="cta glass">
    <h2>${esc(S0.ctaH)}</h2><p>${esc(S0.ctaP)}</p>
    <a href="${esc(config.groupInviteUrl)}" target="_blank" rel="noopener">${esc(S0.ctaBtn)}</a>
  </section>
</main>

<footer>
  <nav class="fnav" aria-label="Rodapé"><a href="${pagePath(lang, null, false)}">${esc(S0.home2)}</a><a href="${esc(config.groupInviteUrl)}" target="_blank" rel="noopener">WhatsApp</a></nav>
  <div class="upd">${esc(S0.updated)} ${nowTime(lang)} · ${esc(nowLabel(lang))}</div>
  <div style="margin-top:.45rem">${esc(S0.aggregator)}</div>
  <div class="hash">${esc([T.hashtag, T.colors].filter(Boolean).join(' '))}</div>
</footer>
<script>(function(){try{var t=localStorage.getItem('matchday-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}
var b=document.getElementById('bar');addEventListener('scroll',function(){var h=document.documentElement;b.style.width=(h.scrollTop/(h.scrollHeight-h.clientHeight||1)*100)+'%'},{passive:true})})();</script>
</body>
</html>`;
}

// ---------- dados + escrita ----------
async function buildData() {
  const [items, standing, nextMatch, lastResult] = await Promise.all([
    news.fetchNews(12).catch((e) => { log.warn(`page news: ${e.message}`); return []; }),
    standings.fetchTeamStanding().catch(() => null),
    espn.fetchNextMatch().catch(() => null),
    espn.fetchLastResult().catch(() => null),
  ]);
  const data = { news: news.freshOnly(items, 72).slice(0, 8), standing, nextMatch, lastResult };
  data.editorial = await editorial.getEditorial(data).catch((e) => { log.warn(`editorial: ${e.message}`); return { pt: [], en: [] }; });
  return data;
}

function listArchiveDates() {
  try {
    return fs.readdirSync(ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  } catch { return []; }
}
function writeFile(rel, html) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html);
}
function writeSitemap(dates) {
  // cada <url> traz os alternates hreflang das línguas (SEO i18n)
  const entry = (ymd, isArchive, freq, prio) => {
    const alts = LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${LOCALE[l].toLowerCase()}" href="${ORIGIN + pagePath(l, ymd, isArchive)}"/>`).join('');
    return LANGS.map((l) => `  <url><loc>${ORIGIN + pagePath(l, ymd, isArchive)}</loc><changefreq>${freq}</changefreq><priority>${prio}</priority>${alts}</url>`).join('\n');
  };
  const urls = [entry(null, false, 'hourly', '0.9'), ...dates.map((d) => entry(d, true, 'monthly', '0.5'))];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
}

let lastWrite = 0;
async function refresh(force = false) {
  if (!config.pageEnabled) return false;
  const now = Date.now();
  if (!force && lastWrite && now - lastWrite < config.pageRefreshMinMs) return false;
  try {
    const data = await buildData();
    const ymd = todayYmd();
    const dates = Array.from(new Set([ymd, ...listArchiveDates()])).sort().reverse();
    for (const lang of LANGS) {
      const dateLabelStr = dateLabelFromYmd(lang, ymd);
      const latest = renderPage(lang, data, { ymd, isArchive: false, archiveDates: dates, dateLabelStr });
      writeFile(lang === 'pt' ? 'index.html' : `${lang}/index.html`, latest);
      const dated = renderPage(lang, data, { ymd, isArchive: true, archiveDates: dates, dateLabelStr });
      writeFile(lang === 'pt' ? `${ymd}/index.html` : `${ymd}/${lang}/index.html`, dated);
    }
    writeSitemap(dates);
    lastWrite = now;
    log.info(`pagina gerada: PT/EN + arquivo ${ymd} (${data.news.length} notícias, ${(data.editorial && data.editorial.pt || []).length} blocos)`);
    return true;
  } catch (e) {
    log.error(`falha ao gerar pagina: ${e.message}`);
    return false;
  }
}

module.exports = { refresh, renderPage, buildData };
