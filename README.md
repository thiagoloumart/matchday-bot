# ⚽ matchday-bot

**Your football team in a WhatsApp group.** Live goals, cards and results, the league table, the next match and the day's news, posted automatically with the voice of a real fan. Any team, in Portuguese or English.

[🇧🇷 Leia em português](README.pt-BR.md)

```
🥅 WE OPEN THE SCORING!

Arsenal 1 x 0 Leeds United

⚽ Saka, 23'
```

It has run in production since June 2026 for a Brazilian fan group (Fortaleza EC): **534 messages** so far, including **92** daily good-morning posts.

## What the group gets

| When | Message |
|---|---|
| Every morning | Good morning + today's match or the next one + league position + top 3 headlines |
| Afternoon and evening | News roundup (skipped while a match is on) + good night |
| 15 min before kick-off | "It's matchday!" with competition, venue, time and first-leg score |
| Live | Kick-off, every goal (with drama: *equaliser*, *we turned it around*), cards, VAR, missed penalties, half time, extra time, shoot-out |
| Full time | Win / draw / loss, then the updated table and the next fixture |
| Daily | Welcome for new members (one message, everyone tagged) + an invite to share the group |

All times are drawn at random inside a window each day, so it doesn't feel robotic.

## Set up in 2 minutes

```bash
git clone https://github.com/thiagoloumart/matchday-bot && cd matchday-bot
npm install
npm run setup
```

The setup wizard asks:

1. **Language**: Portuguese or English.
2. **Team**: pick the league (Brasileirão A/B/C, Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, MLS…), type the team name and it finds the team on ESPN. It also suggests the cups to follow.
3. **Fan voice**: nickname ("GOOOAL FOR THE *GUNNERS*!"), what to call the fans, emoji, colours, chant/hashtag.
4. **Your WhatsApp**, through your own [Evolution API](https://github.com/EvolutionAPI/evolution-api):
   - checks the URL and key, and that the instance is **connected**;
   - **lists the groups** the bot's number is in, so you just pick one (no hunting for group IDs);
   - checks that the bot **is in the group** and **can post there**. If only admins can send and the bot isn't an admin, it stops and tells you what to fix;
   - grabs the **invite link** automatically when the bot is an admin;
   - sends a **test message** to your own number.
5. **Optional**: a news web page for the team, and an AI-written daily wrap.

Everything is saved to `.env` (readable only by you) with `DRY_RUN=true`. Then:

```bash
npm run demo    # every message type, with your team
npm run once    # one real cycle, logging only
# happy? set DRY_RUN=false in .env
npm start       # or: pm2 start ecosystem.config.js
```

## How it works

```
ESPN (fixtures, live events, table) ─┐
Google News RSS (headlines)          ├─► detect new events ─► write the message (PT/EN) ─► queue ─► WhatsApp group
                                     │         │
                                     │   SQLite: what was already sent
                                     └─► optional: news page (PT/EN, SEO) + AI daily wrap
```

- **Free data, no keys**: ESPN's public API and Google News RSS.
- **Never sends twice**: every event has a stable key in SQLite, so a restart never repeats a goal.
- **Adaptive polling**: every 15 s during a match, every 15 min otherwise.
- **Can't post in the wrong place**: a destination lock only allows the configured group (and your number for tests).
- **Warns you when it goes blind**: if ESPN stops answering for about an hour, you get a private message, and another one when it recovers. This came from a real incident: the source once blocked the bot for 5 hours and nobody noticed.
- **Anti-flood**: minimum delay between messages.
- `tools/wa-msg.js` lists recent messages and deletes one for everyone if something goes out wrong.

## Options

Every setting is in [`.env.example`](.env.example). The most useful ones:

| Setting | What it does |
|---|---|
| `LEAGUES` | ESPN competition codes to follow, e.g. `eng.1,eng.fa,uefa.champions` |
| `NEWS_QUERY` | Google News search. Quotes for an exact name, `OR` for alternatives, `-women` to exclude |
| `MORNING_WINDOW`, `AFTERNOON_WINDOW`, `NIGHT_WINDOW` | Hour ranges for the daily posts, e.g. `7-9` |
| `CARDS_YELLOW`, `EVENTS_HALFTIME`… | Turn individual live events on or off |
| `PAGE_ENABLED` | Generates a static news page (PT/EN, archive by date, sitemap, team colours) |
| `EDITORIAL_ENABLED` | A 3-block daily wrap written by AI (needs the [Claude Code](https://claude.com/claude-code) CLI) |

**Football only.** ESPN has other sports, but the live events (goals, cards, penalties) are football-specific.

**Stack:** Node.js 20+ (built-in `fetch`), SQLite (`better-sqlite3`), Evolution API for WhatsApp. No framework.

## How it was built

AI-native: I wrote the spec from a real fan group's day-to-day, directed coding agents to build it, and turned my own team's bot into a template anyone can run. Code comments are in Portuguese.

---

Thiago Lourenço Martins · [LinkedIn](https://www.linkedin.com/in/thiago-lourenco-martins) · [loumart.com.br](https://loumart.com.br)
