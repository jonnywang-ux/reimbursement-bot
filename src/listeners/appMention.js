import { createSession, getActiveSession, setClaimantName } from '../services/sessionManager.js';
import { log, error } from '../utils/logger.js';

export function registerAppMentionListener(app) {
  app.event('app_mention', async ({ event, say, client }) => {
    console.log('[appMention] RAW EVENT:', JSON.stringify(event, null, 2));
    const threadTs = event.thread_ts ?? event.ts;

    try {
      const existing = getActiveSession(event.channel, threadTs);

      if (existing) {
        console.log('[appMention] Session already active, calling say()...');
        try {
          await say({
            text: 'Session already active. Keep sending receipts or say *done*.',
            thread_ts: threadTs,
          });
          console.log('[appMention] say() completed (existing session)');
        } catch (sayErr) {
          console.error('[appMention] say() FAILED (existing session):', sayErr);
        }
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

      console.log('[appMention] Calling say() — ready message...');
      try {
        await say({
          text: 'Ready — send me your receipts and descriptions. Say *done* when finished.',
          thread_ts: threadTs,
        });
        console.log('[appMention] say() completed — ready message sent');
      } catch (sayErr) {
        console.error('[appMention] say() FAILED — ready message:', sayErr);
      }
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
