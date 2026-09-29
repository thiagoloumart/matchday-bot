'use strict';
// Carrega .env e expoe a configuracao tipada. Falha cedo se algo essencial faltar.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function int(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}
function str(name, def = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}
function bool(name, def) {
  const v = (process.env[name] || '').toLowerCase();
  if (v === '') return def;
  return v === 'true' || v === '1' || v === 'yes';
}
function list(name, def = []) {
  const v = str(name);
  if (!v) return def;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
// "7-9" -> [7, 9] (janela de horas p/ sorteio do horario)
function win(name, def) {
  const v = str(name);
  const m = v.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return def;
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

const config = {
  // idioma das mensagens e da pagina: 'pt' ou 'en'
  lang: str('BOT_LANGUAGE', 'pt') === 'en' ? 'en' : 'pt',

  // o time (preenchido pelo `npm run setup`)
  team: {
    espnId: str('TEAM_ESPN_ID'),
    name: str('TEAM_NAME'),            // "Fortaleza" / "Arsenal"
    nick: str('TEAM_NICK'),            // "Leão" / "Gunners" (vira "GOL DO LEÃO!")
    fans: str('TEAM_FANS'),            // "Tricolor" / "Gooners" (vira "Bom dia, Tricolor!")
    emoji: str('TEAM_EMOJI', '⚽'),
    colors: str('TEAM_COLORS'),        // "🔴🔵⚪"
    hashtag: str('TEAM_HASHTAG'),      // "#BoraLeão"
    groupName: str('GROUP_NAME'),      // nome do grupo/pagina: "Notícias do Leão"
  },

  // fontes ESPN
  espnSiteBase: str('ESPN_SITE_BASE', 'https://site.api.espn.com/apis/site/v2/sports/soccer'),
  espnV2Base: str('ESPN_V2_BASE', 'https://site.api.espn.com/apis/v2/sports/soccer'),
  leagues: list('LEAGUES'),            // ex.: bra.2,bra.copa_do_brazil  /  eng.1,eng.fa
  tableLeague: str('TABLE_LEAGUE'),    // liga da tabela de classificacao (padrao: a 1a de LEAGUES)

  // noticias (Google News RSS)
  newsEnabled: bool('NEWS_ENABLED', true),
  newsQuery: str('NEWS_QUERY'),        // padrao: "<TEAM_NAME>" futebol / football
  newsMaxAgeHours: int('NEWS_MAX_AGE_HOURS', 48),

  // janelas (horario sorteado por dia, anti-robotico)
  morningWindow: win('MORNING_WINDOW', [7, 9]),
  afternoonWindow: win('AFTERNOON_WINDOW', [12, 15]),
  nightWindow: win('NIGHT_WINDOW', [20, 22]),

  // boas-vindas + convite
  welcomeEnabled: bool('WELCOME_ENABLED', true),
  inviteEnabled: bool('INVITE_ENABLED', true),
  inviteUrl: str('INVITE_URL'),          // link que o convite diario divulga (grupo ou pagina)

  // pagina de noticias no site (opcional)
  pageEnabled: bool('PAGE_ENABLED', false),
  pageOutput: str('PAGE_OUTPUT', path.join(__dirname, '..', 'site', 'index.html')),
  pageUrl: str('PAGE_URL'),            // ex.: https://meutime.meusite.com.br
  pageRefreshMinMs: int('PAGE_REFRESH_MIN_MS', 1200000), // regenera no máximo a cada 20min
  groupInviteUrl: str('GROUP_INVITE_URL'),
  pageColor1: str('PAGE_COLOR_1', '#e1261c'), // cor principal do time (hex)
  pageColor2: str('PAGE_COLOR_2', '#1f5cff'), // cor secundaria (hex)

  // resumo do dia escrito por IA (opcional; exige o Claude Code CLI instalado)
  editorialEnabled: bool('EDITORIAL_ENABLED', false),

  // evolution
  evolutionBaseUrl: str('EVOLUTION_BASE_URL'),
  evolutionInstance: str('EVOLUTION_INSTANCE'),
  evolutionApiKey: str('EVOLUTION_APIKEY'),
  whatsappGroupJid: str('WHATSAPP_GROUP_JID'),
  whatsappTestNumber: str('WHATSAPP_TEST_NUMBER'),
  botNumber: str('BOT_NUMBER'),        // numero da propria instancia (nao se da boas-vindas)

  // toggles de lances
  cardsEnabled: bool('CARDS_ENABLED', true),
  cardsYellow: bool('CARDS_YELLOW', true),
  eventsPenalty: bool('EVENTS_PENALTY', true),
  eventsHalftime: bool('EVENTS_HALFTIME', true),
  eventsExtraTime: bool('EVENTS_EXTRATIME', true),

  // comportamento
  timezone: str('TIMEZONE', 'America/Sao_Paulo'),
  pollLiveMs: int('POLL_LIVE_MS', 15000),
  pollIdleMs: int('POLL_IDLE_MS', 900000),
  previewLeadMinutes: int('PREVIEW_LEAD_MINUTES', 15),
  sendMinDelayMs: int('SEND_MIN_DELAY_MS', 6000),
  dryRun: bool('DRY_RUN', true),
  logLevel: str('LOG_LEVEL', 'info'),

  // caminhos
  dbPath: path.join(__dirname, '..', 'data', 'matchday.db'),
};

if (!config.tableLeague) config.tableLeague = config.leagues[0] || '';
if (!config.newsQuery && config.team.name) config.newsQuery = `"${config.team.name}" ${config.lang === 'en' ? 'football' : 'futebol'}`;
// apelido/torcida caem no nome do time quando nao configurados
for (const k of ['nick', 'fans', 'groupName']) if (!config.team[k]) config.team[k] = config.team.name;

// Destino de envio: grupo se houver JID, senao numero de teste.
config.sendTarget = config.whatsappGroupJid || config.whatsappTestNumber || '';

// TRAVA DE DESTINO (allowlist). O bot SO pode enviar pro grupo configurado
// (ou pro numero de teste, p/ o --test). Qualquer outro destino e recusado em
// evolution.js. Na duvida (sem JID de grupo), o sendTarget ja cai no numero de
// teste (particular) — nunca num grupo errado.
config.allowedTargets = [config.whatsappGroupJid, config.whatsappTestNumber].filter(Boolean);

module.exports = config;
