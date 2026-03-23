import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSession,
  getSession,
  addReceipt,
  updateStatus,
  addDescription,
  getActiveSession,
  setSignatureRequestId,
  setExtractedData,
} from '../src/services/sessionManager.js';

describe('sessionManager', () => {
  let threadCounter = 0;

  function getUniqueThreadTs() {
    return `thread-${Date.now()}-${threadCounter++}`;
  }

  describe('createSession', () => {
    it('creates a session with correct shape', () => {
      const threadTs = getUniqueThreadTs();
      const channelId = 'C12345';
      const userId = 'U12345';
      const session = createSession(threadTs, channelId, userId);

      expect(session).toHaveProperty('threadTs', threadTs);
      expect(session).toHaveProperty('channelId', channelId);
      expect(session).toHaveProperty('userId', userId);
      expect(session).toHaveProperty('claimantName', 'Daniel');
      expect(session).toHaveProperty('receipts');
      expect(Array.isArray(session.receipts)).toBe(true);
      expect(session.receipts).toHaveLength(0);
      expect(session).toHaveProperty('notes');
      expect(Array.isArray(session.notes)).toBe(true);
      expect(session.notes).toHaveLength(0);
      expect(session).toHaveProperty('status', 'collecting');
      expect(session).toHaveProperty('extractedData');
      expect(Array.isArray(session.extractedData)).toBe(true);
      expect(session).toHaveProperty('fxRates');
      expect(typeof session.fxRates).toBe('object');
      expect(session).toHaveProperty('createdAt');
      expect(session.createdAt instanceof Date).toBe(true);
    });

    it('creates different sessions for different threadTs', () => {
      const thread1 = getUniqueThreadTs();
      const thread2 = getUniqueThreadTs();
      const session1 = createSession(thread1, 'channel1', 'user1');
      const session2 = createSession(thread2, 'channel2', 'user2');

      expect(getSession(thread1)).toBe(session1);
      expect(getSession(thread2)).toBe(session2);
      expect(session1.threadTs).not.toBe(session2.threadTs);
    });
  });

  describe('getSession', () => {
    it('returns undefined for missing key', () => {
      const session = getSession('nonexistent-' + Date.now());
      expect(session).toBeUndefined();
    });

    it('returns the session when it exists', () => {
      const threadTs = getUniqueThreadTs();
      const created = createSession(threadTs, 'C12345', 'U12345');
      const retrieved = getSession(threadTs);
      expect(retrieved).toBe(created);
    });
  });

  describe('addReceipt', () => {
    it('throws error when session does not exist', () => {
      expect(() => {
        addReceipt('nonexistent-' + Date.now(), { vendorName: 'Test' });
      }).toThrow('No session for thread');
    });

    it('adds receipt to receipts array immutably', () => {
      const threadTs = getUniqueThreadTs();
      const session = createSession(threadTs, 'C12345', 'U12345');

      const receipt = { vendorName: 'Starbucks', amount: 5.50 };
      const updated = addReceipt(threadTs, receipt);

      // Original should not be mutated
      expect(session.receipts).toHaveLength(0);
      // New session should have receipt
      expect(updated.receipts).toHaveLength(1);
      expect(updated.receipts[0]).toEqual(receipt);
    });

    it('adds multiple receipts sequentially', () => {
      const threadTs = getUniqueThreadTs();
      createSession(threadTs, 'C12345', 'U12345');

      const receipt1 = { vendorName: 'Vendor1', amount: 10 };
      const session1 = addReceipt(threadTs, receipt1);
      expect(session1.receipts).toHaveLength(1);

      const receipt2 = { vendorName: 'Vendor2', amount: 20 };
      const session2 = addReceipt(threadTs, receipt2);
      expect(session2.receipts).toHaveLength(2);
      expect(session2.receipts[0]).toEqual(receipt1);
      expect(session2.receipts[1]).toEqual(receipt2);
    });

    it('creates new array reference on each operation', () => {
      const threadTs = getUniqueThreadTs();
      createSession(threadTs, 'C12345', 'U12345');

      const receipt1 = { vendorName: 'Test', amount: 15 };
      const updated1 = addReceipt(threadTs, receipt1);

      const receipt2 = { vendorName: 'Another', amount: 25 };
      const updated2 = addReceipt(threadTs, receipt2);

      // Both should be different session objects
      expect(updated1).not.toBe(updated2);
      // And different receipt arrays
      expect(updated1.receipts).not.toBe(updated2.receipts);
      // Second should have 2 receipts
      expect(updated2.receipts).toHaveLength(2);
    });
  });

  describe('updateStatus', () => {
    it('throws error when session does not exist', () => {
      expect(() => {
        updateStatus('nonexistent-' + Date.now(), 'reviewing');
      }).toThrow('No session for thread');
    });

    it('changes status field', () => {
      const threadTs = getUniqueThreadTs();
      const session = createSession(threadTs, 'C12345', 'U12345');
      expect(session.status).toBe('collecting');

      const updated = updateStatus(threadTs, 'processing');
      expect(updated.status).toBe('processing');

      const retrieved = getSession(threadTs);
      expect(retrieved.status).toBe('processing');
    });

    it('updates to different statuses', () => {
      const threadTs = getUniqueThreadTs();
      createSession(threadTs, 'C12345', 'U12345');

      updateStatus(threadTs, 'processing');
      expect(getSession(threadTs).status).toBe('processing');

      updateStatus(threadTs, 'reviewing');
      expect(getSession(threadTs).status).toBe('reviewing');

      updateStatus(threadTs, 'approved');
      expect(getSession(threadTs).status).toBe('approved');
    });
  });

  describe('addDescription', () => {
    it('throws error when session does not exist', () => {
      expect(() => {
        addDescription('nonexistent-' + Date.now(), 'some text', '123');
      }).toThrow('No session for thread');
    });

    it('appends text to last receipt when receipts exist', () => {
      const threadTs = getUniqueThreadTs();
      const session = createSession(threadTs, 'C12345', 'U12345');
      const receipt = { vendorName: 'Restaurant', description: 'Lunch meeting' };
      addReceipt(threadTs, receipt);

      const updated = addDescription(threadTs, 'with Bob', '123.456');
      expect(updated.receipts[0].description).toBe('Lunch meeting with Bob');
    });

    it('appends text with space when receipt description already exists', () => {
      const threadTs = getUniqueThreadTs();
      createSession(threadTs, 'C12345', 'U12345');
      const receipt = { vendorName: 'Cafe', description: 'Morning coffee' };
      addReceipt(threadTs, receipt);

      const updated = addDescription(threadTs, 'with Alice', '123.456');
      expect(updated.receipts[0].description).toBe('Morning coffee with Alice');
    });

    it('appends text without space when receipt description is empty', () => {
      const threadTs = getUniqueThreadTs();
      createSession(threadTs, 'C12345', 'U12345');
      const receipt = { vendorName: 'Store', description: '' };
      addReceipt(threadTs, receipt);

      const updated = addDescription(threadTs, 'new description', '123.456');
      expect(updated.receipts[0].description).toBe('new description');
    });

    it('adds to notes array when no receipts exist', () => {
      const threadTs = getUniqueThreadTs();
      const session = createSession(threadTs, 'C12345', 'U12345');
      expect(session.notes).toHaveLength(0);

      const updated = addDescription(threadTs, 'Some note', '123.456');
      expect(updated.notes).toHaveLength(1);
      expect(updated.notes[0]).toEqual({ text: 'Some note', messageTs: '123.456' });
    });

    it('adds multiple notes when no receipts exist', () => {
      const threadTs = getUniqueThreadTs();
      createSession(threadTs, 'C12345', 'U12345');

      const updated1 = addDescription(threadTs, 'First note', '111');
      expect(updated1.notes).toHaveLength(1);

      const updated2 = addDescription(threadTs, 'Second note', '222');
      expect(updated2.notes).toHaveLength(2);
      expect(updated2.notes[1]).toEqual({ text: 'Second note', messageTs: '222' });
    });

    it('adds only to last receipt when multiple receipts exist', () => {
      const threadTs = getUniqueThreadTs();
      createSession(threadTs, 'C12345', 'U12345');
      const receipt1 = { vendorName: 'Vendor1', description: 'First' };
      const receipt2 = { vendorName: 'Vendor2', description: 'Second' };

      addReceipt(threadTs, receipt1);
      addReceipt(threadTs, receipt2);

      const updated = addDescription(threadTs, 'addition', '123.456');
      expect(updated.receipts[0].description).toBe('First');
      expect(updated.receipts[1].description).toBe('Second addition');
    });
  });

  describe('getActiveSession', () => {
    it('returns undefined when session does not exist', () => {
      const result = getActiveSession('C12345', 'nonexistent-' + Date.now());
      expect(result).toBeUndefined();
    });

    it('returns undefined when status is not collecting', () => {
      const threadTs = getUniqueThreadTs();
      const session = createSession(threadTs, 'C12345', 'U12345');
      updateStatus(threadTs, 'processing');

      const result = getActiveSession('C12345', threadTs);
      expect(result).toBeUndefined();
    });

    it('returns undefined when channelId does not match', () => {
      const threadTs = getUniqueThreadTs();
      createSession(threadTs, 'C12345', 'U12345');

      const result = getActiveSession('wrong-channel', threadTs);
      expect(result).toBeUndefined();
    });

    it('returns session when status=collecting and channelId matches', () => {
      const threadTs = getUniqueThreadTs();
      const created = createSession(threadTs, 'C12345', 'U12345');

      const result = getActiveSession('C12345', threadTs);
      expect(result).toBe(created);
      expect(result.status).toBe('collecting');
    });

    it('returns undefined when channelId matches but status changed', () => {
      const threadTs = getUniqueThreadTs();
      createSession(threadTs, 'C12345', 'U12345');
      updateStatus(threadTs, 'approved');

      const result = getActiveSession('C12345', threadTs);
      expect(result).toBeUndefined();
    });
  });

  describe('setSignatureRequestId', () => {
    it('throws error when session does not exist', () => {
      expect(() => {
        setSignatureRequestId('nonexistent-' + Date.now(), 'sig-123');
      }).toThrow('No session for thread');
    });

    it('sets signatureRequestId on session', () => {
      const threadTs = getUniqueThreadTs();
      const session = createSession(threadTs, 'C12345', 'U12345');
      expect(session).not.toHaveProperty('signatureRequestId');

      const sigId = 'sig-request-abc123';
      const updated = setSignatureRequestId(threadTs, sigId);
      expect(updated.signatureRequestId).toBe(sigId);
    });
  });

  describe('setExtractedData', () => {
    it('throws error when session does not exist', () => {
      expect(() => {
        setExtractedData('nonexistent-' + Date.now(), []);
      }).toThrow('No session for thread');
    });

    it('sets extractedData on session', () => {
      const threadTs = getUniqueThreadTs();
      const session = createSession(threadTs, 'C12345', 'U12345');
      expect(session.extractedData).toHaveLength(0);

      const extractedData = [
        { vendorName: 'Vendor1', amount: 100 },
        { vendorName: 'Vendor2', amount: 200 },
      ];
      const updated = setExtractedData(threadTs, extractedData);
      expect(updated.extractedData).toEqual(extractedData);
    });

    it('replaces existing extractedData', () => {
      const threadTs = getUniqueThreadTs();
      createSession(threadTs, 'C12345', 'U12345');
      const data1 = [{ vendorName: 'First', amount: 50 }];
      setExtractedData(threadTs, data1);

      const data2 = [{ vendorName: 'Second', amount: 75 }];
      const updated = setExtractedData(threadTs, data2);
      expect(updated.extractedData).toEqual(data2);
      expect(updated.extractedData[0].vendorName).toBe('Second');
    });
  });
});
