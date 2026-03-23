import 'dotenv/config';
import pkg from '@slack/bolt';
const { App, ExpressReceiver } = pkg;
import { registerAppMentionListener } from './listeners/appMention.js';
import { registerMessageListener } from './listeners/message.js';
import { registerActionsListener } from './listeners/actions.js';
import { log, error } from './utils/logger.js';

// ---------------------------------------------------------------------------
// Env validation — fail fast with a clear message if anything is missing
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'ANTHROPIC_API_KEY',
  'HELLOSIGN_API_KEY',
  'SIGNER_1_EMAIL', 'SIGNER_1_NAME',
  'SIGNER_2_EMAIL', 'SIGNER_2_NAME',
  'SIGNER_3_EMAIL', 'SIGNER_3_NAME',
  'SIGNER_4_EMAIL', 'SIGNER_4_NAME',
];

const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`[startup] Missing required environment variables:\n  ${missing.join('\n  ')}`);
  console.error('[startup] Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Bolt app
// ---------------------------------------------------------------------------
const PORT = process.env.PORT ?? 3000;

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// Health check
receiver.app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Register listeners
registerAppMentionListener(app);
registerMessageListener(app);
registerActionsListener(app);

await app.start(PORT);
log(`⚡ Reimbursement bot running on port ${PORT}`, { port: PORT });
