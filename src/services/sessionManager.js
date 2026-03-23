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

export function getActiveSession(channelId, threadTs) {
  const session = sessions.get(threadTs);
  if (session && session.channelId === channelId && session.status === 'collecting') {
    return session;
  }
  return undefined;
}
