import { createSession, getActiveSession, setClaimantName, appendConversationHistory } from '../services/sessionManager.js';
import { chatWithClaude } from '../services/receiptExtractor.js';
import { log, error } from './logger.js';

/**
 * Start a new reimbursement session for a user.
 * Claude asks the opening question: "What is this reimbursement about?"
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

  // Claude generates the opening message and asks what the reimbursement is about
  let openingMessage;
  try {
    openingMessage = await chatWithClaude(
      'A new reimbursement session has just started. Greet the user briefly and ask what this reimbursement is about.',
      [],
    );
    appendConversationHistory(threadTs, 'assistant', openingMessage);
  } catch (claudeErr) {
    error('Failed to get Claude opening message', claudeErr, { threadTs });
    openingMessage = 'Hi! What is this reimbursement about? (e.g. business trip to Shanghai, client entertainment, etc.) Once you tell me, send your receipts and say *done* when finished.';
  }

  console.log('[session] Posting Claude opening message...');
  try {
    await say({
      text: openingMessage,
      thread_ts: threadTs,
    });
    console.log('[session] Opening message sent');
  } catch (sayErr) {
    console.error('[session] say() FAILED — opening message:', sayErr);
  }
}
