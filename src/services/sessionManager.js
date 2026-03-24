/** @type {Map<string, object>} keyed by thread_ts */
const sessions = new Map();

export function createSession(threadTs, channelId, userId) {
  const session = {
    threadTs,
    channelId,
    userId,
    claimantName: 'Daniel',
    receipts: [],
    notes: [],
    status: 'collecting',
    extractedData: [],
    fxRates: {},
    reimbursementPurpose: null,
    conversationHistory: [],
    processingQueue: [],
    isProcessingQueue: false,
    createdAt: new Date(),
  };
  sessions.set(threadTs, session);
  return session;
}

export function getSession(threadTs) {
  return sessions.get(threadTs);
}

export function addReceipt(threadTs, receiptObj) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  const updated = { ...session, receipts: [...session.receipts, receiptObj] };
  sessions.set(threadTs, updated);
  return updated;
}

export function enqueueReceipt(threadTs, receiptObj) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  const updated = {
    ...session,
    receipts: [...session.receipts, receiptObj],
    processingQueue: [...session.processingQueue, receiptObj],
  };
  sessions.set(threadTs, updated);
  return updated;
}

export function dequeueReceipt(threadTs) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  if (session.processingQueue.length === 0) return { session, item: null };
  const [item, ...rest] = session.processingQueue;
  const updated = { ...session, processingQueue: rest };
  sessions.set(threadTs, updated);
  return { session: updated, item };
}

export function setQueueProcessing(threadTs, isProcessing) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  const updated = { ...session, isProcessingQueue: isProcessing };
  sessions.set(threadTs, updated);
  return updated;
}

export function updateStatus(threadTs, status) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  const updated = { ...session, status };
  sessions.set(threadTs, updated);
  return updated;
}

export function addDescription(threadTs, text, messageTs) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);

  let updated;
  if (session.receipts.length > 0) {
    const receipts = session.receipts.map((r, i) => {
      if (i !== session.receipts.length - 1) return r;
      const sep = r.description ? ' ' : '';
      return { ...r, description: r.description + sep + text };
    });
    updated = { ...session, receipts };
  } else {
    updated = { ...session, notes: [...session.notes, { text, messageTs }] };
  }

  sessions.set(threadTs, updated);
  return updated;
}

export function setSignatureRequestId(threadTs, signatureRequestId) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  const updated = { ...session, signatureRequestId };
  sessions.set(threadTs, updated);
  return updated;
}

export function setClaimantName(threadTs, claimantName) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  const updated = { ...session, claimantName };
  sessions.set(threadTs, updated);
  return updated;
}

export function setExtractedData(threadTs, extractedData) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  const updated = { ...session, extractedData };
  sessions.set(threadTs, updated);
  return updated;
}

export function appendExtractedRecord(threadTs, record) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  const updated = { ...session, extractedData: [...session.extractedData, record] };
  sessions.set(threadTs, updated);
  return updated;
}

export function setReimbursementPurpose(threadTs, purpose) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  const updated = { ...session, reimbursementPurpose: purpose };
  sessions.set(threadTs, updated);
  return updated;
}

/**
 * Append a message to the conversation history.
 * Keeps only the last 20 messages to avoid bloating Claude's context window.
 *
 * @param {string} threadTs
 * @param {'user'|'assistant'} role
 * @param {string|Array} content
 */
export function appendConversationHistory(threadTs, role, content) {
  const session = sessions.get(threadTs);
  if (!session) throw new Error(`No session for thread ${threadTs}`);
  const MAX_HISTORY = 20;
  const next = [...session.conversationHistory, { role, content }].slice(-MAX_HISTORY);
  const updated = { ...session, conversationHistory: next };
  sessions.set(threadTs, updated);
  return updated;
}

export function getActiveSession(channelId, threadTs) {
  const session = sessions.get(threadTs);
  if (session && session.channelId === channelId && session.status === 'collecting') {
    return session;
  }
  return undefined;
}
