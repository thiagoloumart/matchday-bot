'use strict';
// Assistente de configuracao: `npm run setup`.
// Pergunta idioma e time (busca na ESPN), monta o perfil da torcida, conecta na sua
// Evolution API, lista os grupos do numero do bot, confere se o bot pode postar no
// grupo escolhido e grava tudo no .env (sempre em DRY_RUN=true). Sem dependencias.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '..', '.env');
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// ligas oferecidas no menu (codigo ESPN) + copas que costumam vir junto
const LEAGUES = [
  ['bra.1', 'Brasileirão Série A', ['bra.copa_do_brazil', 'conmebol.libertadores']],
  ['bra.2', 'Brasileirão Série B', ['bra.copa_do_brazil']],
  ['bra.3', 'Brasileirão Série C', ['bra.copa_do_brazil']],
  ['eng.1', 'Premier League', ['eng.fa', 'eng.league_cup', 'uefa.champions']],
  ['eng.2', 'EFL Championship', ['eng.fa', 'eng.league_cup']],
  ['esp.1', 'LaLiga', ['uefa.champions']],
  ['ita.1', 'Serie A (Italia)', ['uefa.champions']],
  ['ger.1', 'Bundesliga', ['uefa.champions']],
  ['fra.1', 'Ligue 1', ['uefa.champions']],
  ['por.1', 'Primeira Liga', ['uefa.champions']],
  ['arg.1', 'Liga Profesional (Argentina)', ['conmebol.libertadores']],
  ['usa.1', 'MLS', []],
];

const M = {
  pt: {
    intro: '\n⚽ matchday-bot — configuração\nVou fazer algumas perguntas e gravar tudo no .env. Enter aceita o valor entre [colchetes].\n',
    league: 'Em que liga o time joga?', other: 'outra (digitar o código ESPN)', leagueCode: 'Código ESPN da liga (ex.: bra.1, eng.1)',
    teamSearch: 'Nome do time', noTeam: 'Nenhum time com esse nome nessa liga. Tente de novo.', pickTeam: 'Qual deles?',
    extraLeagues: 'Competições acompanhadas (códigos ESPN, separados por vírgula)',
    profile: '\nAgora o jeito da torcida (aparece nas mensagens):',
    nick: 'Apelido do time (vira "GOL DO <APELIDO>!")', fans: 'Como chamar a torcida ("Bom dia, <torcida>!")',
    emoji: 'Emoji do time', colors: 'Emojis de cores (opcional, ex.: 🔴⚫)', hashtag: 'Grito/hashtag (opcional, ex.: #VamosTime)',
    groupName: 'Nome do grupo/página', groupNameDefault: (n) => `Notícias do ${n}`,
    news: 'Busca das notícias no Google News (aspas = termo exato; OR = alternativas)',
    color1: 'Cor principal da página (hex)', color2: 'Cor secundária da página (hex)',
    evo: '\nConexão com a sua Evolution API (o número de WhatsApp que vai postar):',
    evoUrl: 'URL da Evolution API (ex.: https://evolution.seudominio.com)', evoInstance: 'Nome da instância', evoKey: 'API key (global ou da instância)',
    evoFail: (e) => `Não consegui falar com a Evolution: ${e}. Confira URL, instância e chave.`,
    evoNotOpen: (s) => `A instância está "${s}", não "open". Conecte o WhatsApp dela (QR code) e rode o setup de novo.`,
    evoOk: (n) => `✅ Conectado. Número do bot: ${n || '(não informado)'}`,
    loadingGroups: 'Buscando os grupos em que esse número está (pode levar alguns segundos)...',
    noGroups: 'Esse número não está em nenhum grupo. Crie o grupo pelo WhatsApp do bot (ou adicione o bot nele) e rode de novo.',
    pickGroup: 'Em qual grupo o bot vai postar?', members: 'membros', onlyAdmins: 'só admins enviam',
    notMember: '⚠️  O número do bot não aparece como participante desse grupo. Adicione-o e rode de novo.',
    notAdminBlocked: '⛔ Nesse grupo só admins enviam mensagens e o bot NÃO é admin. Torne o bot admin e rode de novo.',
    notAdmin: '⚠️  O bot não é admin. Ele consegue postar, mas não vai conseguir pegar o link de convite nem apagar mensagens de outros.',
    groupOk: (s, a) => `✅ Grupo "${s}" validado${a ? ' (bot é admin)' : ''}.`,
    invite: 'Link de convite divulgado no convite diário', owner: 'Seu WhatsApp (DDI+DDD+número) para testes e alertas do bot',
    page: 'Gerar a página de notícias no site? (s/N)', pageUrl: 'Endereço público da página (ex.: https://meutime.meusite.com)',
    pageOut: 'Onde gravar o HTML', editorial: 'Resumo do dia escrito por IA? Exige o Claude Code instalado (s/N)',
    written: (p) => `\n✅ Configuração gravada em ${p} (DRY_RUN=true: nada é enviado até você mudar).`,
    testMsg: 'Mandar agora uma mensagem de teste para o SEU número? (S/n)', testText: (g) => `✅ matchday-bot configurado. Vou postar no grupo "${g}". Esta é só uma mensagem de teste.`,
    testOk: '✅ Mensagem de teste enviada. Confira seu WhatsApp.', testFail: (e) => `⚠️  Falhou o envio de teste: ${e}`,
    next: '\nPróximos passos:\n  npm run demo      # veja todas as mensagens com o seu time\n  npm run once      # 1 ciclo real em DRY_RUN (só mostra no log)\n  depois: DRY_RUN=false no .env e `npm start` (ou pm2 start ecosystem.config.js)\n',
    yes: /^s/i,
  },
  en: {
    intro: '\n⚽ matchday-bot — setup\nA few questions and everything is saved to .env. Press Enter to accept the value in [brackets].\n',
    league: 'Which league does the team play in?', other: 'other (type the ESPN code)', leagueCode: 'ESPN league code (e.g. eng.1, esp.1)',
    teamSearch: 'Team name', noTeam: 'No team with that name in this league. Try again.', pickTeam: 'Which one?',
    extraLeagues: 'Competitions to follow (ESPN codes, comma-separated)',
    profile: '\nNow the fan voice (used in the messages):',
    nick: 'Team nickname (becomes "GOOOAL FOR THE <NICKNAME>!")', fans: 'What to call the fans ("Good morning, <fans>!")',
    emoji: 'Team emoji', colors: 'Colour emojis (optional, e.g. 🔴⚪)', hashtag: 'Chant/hashtag (optional, e.g. #COYG)',
    groupName: 'Group/page name', groupNameDefault: (n) => `${n} Updates`,
    news: 'Google News search (quotes = exact phrase; OR = alternatives; -word excludes)',
    color1: 'Page main colour (hex)', color2: 'Page secondary colour (hex)',
    evo: '\nConnect your Evolution API (the WhatsApp number that will post):',
    evoUrl: 'Evolution API URL (e.g. https://evolution.yourdomain.com)', evoInstance: 'Instance name', evoKey: 'API key (global or instance)',
    evoFail: (e) => `Could not reach Evolution: ${e}. Check URL, instance and key.`,
    evoNotOpen: (s) => `The instance is "${s}", not "open". Connect its WhatsApp (QR code) and run setup again.`,
    evoOk: (n) => `✅ Connected. Bot number: ${n || '(not reported)'}`,
    loadingGroups: 'Fetching the groups this number is in (may take a few seconds)...',
    noGroups: "This number isn't in any group. Create the group from the bot's WhatsApp (or add the bot to it) and run again.",
    pickGroup: 'Which group will the bot post in?', members: 'members', onlyAdmins: 'admins only',
    notMember: "⚠️  The bot number isn't listed as a participant of that group. Add it and run again.",
    notAdminBlocked: '⛔ In this group only admins can send and the bot is NOT an admin. Make the bot an admin and run again.',
    notAdmin: "⚠️  The bot isn't an admin. It can post, but can't fetch the invite link or delete other people's messages.",
    groupOk: (s, a) => `✅ Group "${s}" validated${a ? ' (bot is admin)' : ''}.`,
    invite: 'Invite link shared in the daily invite', owner: 'Your WhatsApp (country code + number) for tests and bot alerts',
    page: 'Generate the news web page? (y/N)', pageUrl: 'Public URL of the page (e.g. https://myteam.mysite.com)',
    pageOut: 'Where to write the HTML', editorial: 'AI-written daily wrap? Requires Claude Code installed (y/N)',
    written: (p) => `\n✅ Configuration saved to ${p} (DRY_RUN=true: nothing is sent until you change it).`,
    testMsg: 'Send a test message to YOUR number now? (Y/n)', testText: (g) => `✅ matchday-bot is set up. I'll post in the group "${g}". This is just a test message.`,
    testOk: '✅ Test message sent. Check your WhatsApp.', testFail: (e) => `⚠️  Test send failed: ${e}`,
    next: '\nNext steps:\n  npm run demo      # see every message with your team\n  npm run once      # one real cycle in DRY_RUN (log only)\n  then: DRY_RUN=false in .env and `npm start` (or pm2 start ecosystem.config.js)\n',
    yes: /^y/i,
  },
};

// Fila de respostas: funciona digitando e tambem com respostas vindas de um pipe/script
// (rl.question perde as linhas que chegam antes da pergunta).
const rl = readline.createInterface({ input: process.stdin, terminal: false });
const queue = [];
let waiter = null, closed = false;
rl.on('line', (l) => { if (waiter) { const w = waiter; waiter = null; w(l); } else queue.push(l); });
rl.on('close', () => { closed = true; if (waiter) { const w = waiter; waiter = null; w(''); } });
function ask(q, def = '') {
  process.stdout.write(`${q}${def ? ` [${def}]` : ''}: `);
  return new Promise((r) => {
    const done = (a) => { if (!process.stdin.isTTY) process.stdout.write(`${a}\n`); r(a.trim() || def); };
    if (queue.length) done(queue.shift());
    else if (closed) done('');
    else waiter = done;
  });
}
async function choose(q, items) {
  items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}) ${it}`));
  for (;;) {
    const n = parseInt(await ask(q, '1'), 10);
    if (n >= 1 && n <= items.length) return n - 1;
  }
}
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hex = (c) => (c && /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : null);
const digits = (s) => String(s || '').replace(/\D/g, '');

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers }, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const lang = /^en/i.test(await ask('Language / Idioma (pt/en)', 'pt')) ? 'en' : 'pt';
  const m = M[lang];
  console.log(m.intro);

  // --- time ---
  const li = await choose(m.league, [...LEAGUES.map((l) => l[1]), m.other]);
  const league = li < LEAGUES.length ? LEAGUES[li][0] : await ask(m.leagueCode);
  const extras = li < LEAGUES.length ? LEAGUES[li][2] : [];
  const teams = (await getJson(`${ESPN}/${league}/teams`)).sports[0].leagues[0].teams.map((x) => x.team);
  let team;
  while (!team) {
    const q = norm(await ask(m.teamSearch));
    const hits = teams.filter((tm) => norm(`${tm.displayName} ${tm.shortDisplayName} ${tm.location}`).includes(q));
    if (!hits.length) { console.log(m.noTeam); continue; }
    team = hits.length === 1 ? hits[0] : hits[await choose(m.pickTeam, hits.map((h) => h.displayName))];
  }
  console.log(`→ ${team.displayName} (ESPN ${team.id})`);
  const leagues = (await ask(m.extraLeagues, [league, ...extras].join(','))).split(',').map((s) => s.trim()).filter(Boolean);

  // --- perfil da torcida ---
  console.log(m.profile);
  const name = team.shortDisplayName || team.displayName;
  const nick = await ask(m.nick, team.nickname || name);
  const fans = await ask(m.fans, name);
  const emoji = await ask(m.emoji, '⚽');
  const colors = await ask(m.colors);
  const hashtag = await ask(m.hashtag);
  const groupName = await ask(m.groupName, m.groupNameDefault(name));
  const full = team.displayName;
  const newsQuery = await ask(m.news, lang === 'en'
    ? `"${full}" football -women`
    : `"${full}" futebol${full === name ? '' : ` OR "${name}" futebol`}`);
  const color1 = await ask(m.color1, hex(team.color) || '#e1261c');
  const color2 = await ask(m.color2, hex(team.alternateColor) || '#1f5cff');

  // --- Evolution: conexao ---
  console.log(m.evo);
  const evoUrl = (await ask(m.evoUrl)).replace(/\/+$/, '');
  const instance = await ask(m.evoInstance);
  const apikey = await ask(m.evoKey);
  const H = { apikey };
  let botNumber = '';
  try {
    const st = await getJson(`${evoUrl}/instance/connectionState/${encodeURIComponent(instance)}`, H);
    const state = st && st.instance && st.instance.state;
    if (state !== 'open') { console.log(m.evoNotOpen(state)); return rl.close(); }
    const info = await getJson(`${evoUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`, H).catch(() => []);
    botNumber = digits((info[0] && (info[0].ownerJid || info[0].number)) || '');
    console.log(m.evoOk(botNumber));
  } catch (e) { console.log(m.evoFail(e.message)); return rl.close(); }

  // --- Evolution: grupo ---
  console.log(m.loadingGroups);
  const groups = await getJson(`${evoUrl}/group/fetchAllGroups/${encodeURIComponent(instance)}?getParticipants=false`, H);
  if (!groups.length) { console.log(m.noGroups); return rl.close(); }
  groups.sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
  const gi = await choose(m.pickGroup, groups.map((g) => `${g.subject} (${g.size || '?'} ${m.members}${g.announce ? `, ${m.onlyAdmins}` : ''})`));
  const group = groups[gi];
  const parts = (await getJson(`${evoUrl}/group/participants/${encodeURIComponent(instance)}?groupJid=${encodeURIComponent(group.id)}`, H)).participants || [];
  const me = parts.find((p) => digits((p.phoneNumber || p.id || '').split('@')[0]) === botNumber);
  const isAdmin = !!(me && me.admin);
  if (botNumber && !me) { console.log(m.notMember); return rl.close(); }
  if (group.announce && !isAdmin) { console.log(m.notAdminBlocked); return rl.close(); }
  if (!isAdmin) console.log(m.notAdmin);
  console.log(m.groupOk(group.subject, isAdmin));
  let inviteDefault = '';
  if (isAdmin) {
    const inv = await getJson(`${evoUrl}/group/inviteCode/${encodeURIComponent(instance)}?groupJid=${encodeURIComponent(group.id)}`, H).catch(() => null);
    inviteDefault = (inv && inv.inviteUrl) || '';
  }
  const inviteUrl = await ask(m.invite, inviteDefault);
  const owner = digits(await ask(m.owner));

  // --- pagina / IA (opcionais) ---
  const pageOn = m.yes.test(await ask(m.page, 'n'));
  const pageUrl = pageOn ? await ask(m.pageUrl) : '';
  const pageOut = pageOn ? await ask(m.pageOut, path.join(__dirname, '..', 'site', 'index.html')) : '';
  const editorialOn = pageOn && m.yes.test(await ask(m.editorial, 'n'));

  const env = {
    BOT_LANGUAGE: lang, TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone,
    TEAM_ESPN_ID: team.id, TEAM_NAME: name, TEAM_NICK: nick, TEAM_FANS: fans, TEAM_EMOJI: emoji,
    TEAM_COLORS: colors, TEAM_HASHTAG: hashtag, GROUP_NAME: groupName,
    LEAGUES: leagues.join(','), TABLE_LEAGUE: league, NEWS_QUERY: newsQuery,
    EVOLUTION_BASE_URL: evoUrl, EVOLUTION_INSTANCE: instance, EVOLUTION_APIKEY: apikey,
    WHATSAPP_GROUP_JID: group.id, WHATSAPP_TEST_NUMBER: owner, BOT_NUMBER: botNumber,
    INVITE_URL: inviteUrl, GROUP_INVITE_URL: inviteUrl,
    PAGE_ENABLED: String(pageOn), PAGE_URL: pageUrl, PAGE_OUTPUT: pageOut, PAGE_COLOR_1: color1, PAGE_COLOR_2: color2,
    EDITORIAL_ENABLED: String(editorialOn),
    DRY_RUN: 'true',
  };
  if (fs.existsSync(ENV_PATH)) fs.copyFileSync(ENV_PATH, `${ENV_PATH}.bak-${Date.now()}`);
  // aspas simples guardam o valor literal (ex.: busca com "aspas"); duplas quando ha ' no valor
  const q = (v) => (!/[\s#"']/.test(v) ? v : v.includes("'") ? `"${v}"` : `'${v}'`);
  fs.writeFileSync(ENV_PATH, Object.entries(env).map(([k, v]) => `${k}=${q(String(v ?? ''))}`).join('\n') + '\n');
  fs.chmodSync(ENV_PATH, 0o600); // tem a API key
  console.log(m.written(ENV_PATH));

  if (owner && !/^n/i.test(await ask(m.testMsg, lang === 'en' ? 'Y' : 'S'))) {
    try {
      const res = await fetch(`${evoUrl}/message/sendText/${encodeURIComponent(instance)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey, 'X-Wa-Robot': 'matchday-bot' },
        body: JSON.stringify({ number: owner, text: m.testText(group.subject) }), signal: AbortSignal.timeout(20000),
      });
      console.log(res.ok ? m.testOk : m.testFail(`HTTP ${res.status}`));
    } catch (e) { console.log(m.testFail(e.message)); }
  }
  console.log(m.next);
  rl.close();
}

main().catch((e) => { console.error(e); rl.close(); process.exitCode = 1; });
