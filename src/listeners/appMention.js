import { createSession, getActiveSession, setClaimantName } from '../services/sessionManager.js';
import { log, error } from '../utils/logger.js';

export function registerAppMentionListener(app) {
  app.event('app_mention', async ({ event, say, client }) => {
    const threadTs = event.thread_ts ?? event.ts;

    try {
      const existing = getActiveSession(event.channel, threadTs);

      if (existing) {
        await say({
          text: 'Session already active. Keep sending receipts or say *done*.',
          thread_ts: threadTs,
        });
        return;
      }

      createSession(threadTs, event.channel, event.user);

      // Resolve the user's real display name for the claimant field
      try {
        const userInfo = await client.users.info({ user: event.user });
        const name = userInfo.user?.profile?.real_name || userInfo.user?.real_name || userInfo.user?.name;
        if (name) setClaimantName(threadTs, name);
      } catch (nameErr) {
        error('Failed to resolve user display name', nameErr, { userId: event.user });
      }

      log('Session created', { threadTs, channel: event.channel, userId: event.user });

      await say({
        text: 'Ready — send me your receipts and descriptions. Say *done* when finished.',
        thread_ts: threadTs,
      });
    } catch (err) {
      error('appMention error', err, { threadTs });
      await say({
        text: `Something went wrong: ${err.message}. Please try again or contact support.`,
        thread_ts: threadTs,
      });
    }
  });
}
