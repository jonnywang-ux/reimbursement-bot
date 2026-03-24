import { createSession, getActiveSession, setClaimantName } from '../services/sessionManager.js';
import { log, error } from './logger.js';

/**
 * Start a new reimbursement session for a user.
 * Called from both appMention and message listeners.
 */
export async function startSession(channel, userId, ts, say, client) {
  const threadTs = ts;

  const existing = getActiveSession(channel, threadTs);
  if (existing) {
    console.log('[session] Session already active, calling say()...');
    try {
      await say({
        text: 'Session already active. Keep sending receipts or say *done*.',
        thread_ts: threadTs,
      });
      console.log('[session] say() completed (existing session)');
    } catch (sayErr) {
      console.error('[session] say() FAILED (existing session):', sayErr);
    }
    return;
  }

  createSession(threadTs, channel, userId);

  try {
    const userInfo = await client.users.info({ user: userId });
    const name = userInfo.user?.profile?.real_name || userInfo.user?.real_name || userInfo.user?.name;
    if (name) setClaimantName(threadTs, name);
  } catch (nameErr) {
    error('Failed to resolve user display name', nameErr, { userId });
  }

  log('Session created', { threadTs, channel, userId });

  console.log('[session] Calling say() — ready message...');
  try {
    await say({
      text: 'Ready — send me your receipts and descriptions. Say *done* when finished.',
      thread_ts: threadTs,
    });
    console.log('[session] say() completed — ready message sent');
  } catch (sayErr) {
    console.error('[session] say() FAILED — ready message:', sayErr);
  }
}
