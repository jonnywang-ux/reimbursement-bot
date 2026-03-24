import { startSession } from '../utils/sessionHelpers.js';
import { error } from '../utils/logger.js';

export function registerAppMentionListener(app) {
  app.event('app_mention', async ({ event, say, client }) => {
    console.log('[appMention] RAW EVENT:', JSON.stringify(event, null, 2));
    const threadTs = event.thread_ts ?? event.ts;

    try {
      await startSession(event.channel, event.user, threadTs, say, client);
    } catch (err) {
      error('appMention error', err, { threadTs });
      console.error('[appMention] Outer catch error:', err);
      try {
        await say({
          text: `Something went wrong: ${err.message}. Please try again or contact support.`,
          thread_ts: threadTs,
        });
      } catch (sayErr) {
        console.error('[appMention] say() FAILED — error message:', sayErr);
      }
    }
  });
}
