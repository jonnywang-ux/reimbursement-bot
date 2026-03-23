# Reimbursement Bot

A Slack bot for Gunung Capital that processes expense receipts, generates Excel/PDF reports, and routes them through a 4-person HelloSign signing chain.

## How it works

1. @mention the bot in any Slack channel to start a session
2. Send receipt images or PDFs with descriptions in the thread (multiple files supported)
3. Say **done** when finished
4. The bot extracts data from each receipt using Claude vision, fetches MAS FX rates, and posts a summary table
5. Click **Approve & Generate Report** to generate the Excel/PDF report and submit to HelloSign
6. Signing chain: Jonny → Daniel → Pak Kimin → Yopi (CFO)
7. Say **status** in the thread at any time to check signing progress

## Setup

### 1. Clone and install

```bash
npm install
pip install pandas openpyxl
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

| Variable | Where to find it |
|---|---|
| `SLACK_BOT_TOKEN` | api.slack.com/apps → OAuth & Permissions → Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | api.slack.com/apps → Basic Information → Signing Secret |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `HELLOSIGN_API_KEY` | app.hellosign.com → Settings → Integrations → API |
| `SIGNER_*_EMAIL/NAME` | See signing chain below |

### 3. Configure your Slack app

In api.slack.com/apps, configure:

- **Bot Token Scopes:** `app_mentions:read`, `channels:history`, `files:read`, `reactions:write`, `chat:write`, `files:write`
- **Event Subscriptions:** Enable and subscribe to `app_mention` and `message.channels`
- **Interactivity:** Enable and set the Request URL to `https://your-domain.com/slack/events`
- **Event URL:** `https://your-domain.com/slack/events`

### 4. Run locally

```bash
npm run dev   # with nodemon (auto-restart)
npm start     # production
```

Use [ngrok](https://ngrok.com) or similar to expose your local port for Slack webhooks during development.

## Deploy to Railway

1. Push this repo to GitHub
2. Create a new Railway project and connect the repo
3. Railway auto-detects `nixpacks.toml` — it will install Node.js 20, Python 3.11, and LibreOffice
4. Add all environment variables from `.env.example` in Railway's Variables tab
5. Railway sets `PORT` automatically — no need to configure it

The `Procfile` (`web: node src/app.js`) is the fallback start command. `nixpacks.toml` takes precedence on Railway.

## FX rate source

Exchange rates follow company policy:

- **Primary:** MAS (Monetary Authority of Singapore) official rates, scraped from [eservices.mas.gov.sg](https://eservices.mas.gov.sg/Statistics/msb/ExchangeRates.aspx) for the expense date
- **Fallback:** [open.er-api.com](https://open.er-api.com) free API (flagged with ⚠️ *Fallback FX* in the summary)

If the expense date falls on a weekend or holiday, the most recent prior business day is used. The rate date is always shown in the report.

## Signing chain

All reimbursement reports are routed through HelloSign (Dropbox Sign) in this fixed order:

1. **Jonny** (submitter) — `SIGNER_1_EMAIL`
2. **Daniel** — `SIGNER_2_EMAIL`
3. **Pak Kimin** (boss) — `SIGNER_3_EMAIL`
4. **Yopi** (CFO) — `SIGNER_4_EMAIL`

Each signer receives an email from HelloSign. Signatures are collected sequentially. Use **status** in the Slack thread to check progress.

## Health check

```
GET /health
→ { "status": "ok", "uptime": 123.4 }
```
