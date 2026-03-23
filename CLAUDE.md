# Reimbursement Slack Bot

## Project overview

A Slack bot that processes expense receipts for Gunung Capital. Users @mention the bot in a Slack channel to start a session, send receipt images/PDFs with descriptions in a thread, and say "done". The bot extracts data using Claude's vision API, posts a summary for review, and on approval generates an Excel report (with original currency + USD + SGD columns), exports it to PDF, and submits it to HelloSign for a 4-person signing chain.

## Tech stack

- **Runtime:** Node.js 20+
- **Slack SDK:** @slack/bolt (Slack's official framework)
- **AI:** Anthropic Claude API (claude-sonnet-4-20250514) with vision for receipt extraction
- **FX rates:** MAS (Monetary Authority of Singapore) exchange rates — scrape eservices.mas.gov.sg, fallback to free API
- **Report generation:** Python 3 script (generate_report.py) called via child_process
- **Signing:** Dropbox Sign (HelloSign) API
- **PDF export:** libreoffice headless (xlsx → pdf conversion)
- **Hosting:** Railway

## Project structure
reimbursement-bot/
├── CLAUDE.md
├── package.json
├── .env.example
├── .gitignore
├── src/
│   ├── app.js                 # Entry point — Bolt app setup
│   ├── listeners/
│   │   ├── appMention.js      # Handles @bot mention — starts session
│   │   ├── message.js         # Handles thread messages — collects receipts
│   │   └── actions.js         # Handles button clicks (approve/edit)
│   ├── services/
│   │   ├── sessionManager.js  # Tracks active thread sessions
│   │   ├── receiptExtractor.js # Calls Claude API with vision
│   │   ├── fxRateService.js   # Fetches MAS exchange rates by date
│   │   ├── reportGenerator.js # Calls generate_report.py
│   │   └── helloSign.js       # Submits PDF to HelloSign
│   ├── utils/
│   │   ├── slackHelpers.js    # File download, message formatting
│   │   └── pdfConverter.js    # xlsx → pdf via libreoffice
│   └── config/
│       ├── skillPrompt.js     # The Manus skill as a system prompt
│       └── constants.js       # Signing chain, categories, etc.
├── scripts/
│   └── generate_report.py     # Budget Realization Excel/CSV generator
└── Procfile                   # Railway process config

## Architecture

### Flow
1. User @mentions bot in Slack channel
2. Bot replies in thread: "Ready — send me your receipts. Say 'done' when finished."
3. User sends receipt files + descriptions in the thread (multiple messages)
4. User says "done"
5. Bot processes each receipt: downloads file → calls Claude vision API → extracts structured JSON
6. Bot fetches MAS exchange rates for each receipt's date
7. Bot calculates USD and SGD amounts using MAS rates
8. Bot posts a summary table in the thread with approve/edit buttons
9. User clicks "Approve"
10. Bot runs generate_report.py → produces Excel (with original + USD + SGD) → converts to PDF
11. Bot submits PDF to HelloSign with 4-signer chain: Jonny → Daniel → Pak Kimin → Yopi (CFO)
12. Bot confirms submission in thread and tracks signing status

### Session management
- Sessions are keyed by Slack thread_ts (thread timestamp)
- A session stores: receipts array, status (collecting/processing/reviewing/approved), claimant name
- Sessions are in-memory for v1 (Map object)
- Session starts on @mention, ends on HelloSign submission

### Receipt extraction (Claude API)
- One API call per receipt for accuracy
- System prompt contains the full Manus skill extraction rules
- Images sent as base64 in the messages array
- Claude returns structured JSON per the skill schema
- Confidence < 0.8 → flag for user review in the summary

### FX rate logic (CRITICAL — company policy)
The company rule is:
- Use the MAS (Monetary Authority of Singapore) exchange rate
- The rate date follows the expense date (which is determined by the date selection rules below)
- The MAS rate is SGD per unit of foreign currency
- The bot must convert: original currency → SGD (using MAS rate) AND original currency → USD (using MAS SGD/USD rate)

Date selection rules for determining which date to use for the FX rate:
| Category | Date Priority |
|---|---|
| General (Meals, Transportation, Entertainment, Other) | Invoice issuance date → order date |
| Hotel | Departure/checkout date → invoice issuance date → order date |
| Flight Ticket | Travel start (departure) date → invoice issuance date → order date |

FX rate source (in priority order):
1. PRIMARY: Scrape MAS eservices page (https://eservices.mas.gov.sg/Statistics/msb/ExchangeRates.aspx) — download CSV for the target date
2. FALLBACK: Free exchange rate API (e.g. exchangerate.host or open.er-api.com) — with warning to user that this is not the official MAS rate

Conversion logic:
- For a RMB receipt dated 2026-01-15:
  1. Fetch MAS rate for 2026-01-15: SGD/CNY (e.g. 0.1850) and SGD/USD (e.g. 1.3400)
  2. totalAmountSGD = originalAmount × SGD/CNY rate
  3. totalAmountUSD = totalAmountSGD ÷ SGD/USD rate
- If the date falls on a weekend/holiday (no MAS rate), use the most recent prior business day
- Always display the MAS rate used and the date it was pulled from in the report

### HelloSign integration
- Uses Dropbox Sign API (v3)
- Creates a signature request with the PDF attached
- 4 signers in order: Jonny, Daniel, Pak Kimin, Yopi (CFO)
- Webhook callback for status updates (or polling as fallback)

## Environment variables — where to find each one

SLACK_BOT_TOKEN=xoxb-your-bot-token-here          # api.slack.com/apps → OAuth & Permissions → Bot User OAuth Token
SLACK_SIGNING_SECRET=your-signing-secret-here     # api.slack.com/apps → Basic Information → App Credentials → Signing Secret
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here      # console.anthropic.com → API Keys
HELLOSIGN_API_KEY=your-hellosign-api-key-here     # app.hellosign.com → Settings → Integrations → API
SIGNER_1_EMAIL=signer1@example.com                # Jonny
SIGNER_1_NAME=Jonny
SIGNER_2_EMAIL=signer2@example.com                # Daniel
SIGNER_2_NAME=Daniel
SIGNER_3_EMAIL=signer3@example.com                # Pak Kimin (boss)
SIGNER_3_NAME=Pak Kimin
SIGNER_4_EMAIL=signer4@example.com                # CFO
SIGNER_4_NAME=Yopi
PORT=3000                                         # Railway overrides this automatically

## Key decisions
- One Claude API call per receipt (not batched) for accuracy
- System prompt approach (skill rules embedded), not MCP
- Thread-based sessions — bot only listens in active threads
- In-memory session storage for v1
- FX rates from MAS (scraped), tied to the expense date per company policy
- Report output: original currency + USD + SGD (3 currency columns)
- Currency support: USD, RMB for v1 (extendable — MAS covers 20+ currencies)
- Every submission requires HelloSign (no threshold skip)
- Signing chain: Jonny → Daniel → Pak Kimin → Yopi (CFO)

## Commands / conventions
- `npm start` — run the bot
- `npm run dev` — run with nodemon for development
- All async/await, no callbacks
- ESM modules (type: "module" in package.json)
- Error handling: try/catch in every listener, post error to Slack thread