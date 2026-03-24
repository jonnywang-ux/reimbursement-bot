import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/utils/logger.js');

// We'll set up the retry mock after Anthropic, but we need a way to control it per test
let shouldUseRealRetry = false;
const realRetryImplementation = async (fn, maxRetries = 2, delayMs = 1000) => {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        // Don't actually sleep in tests, just move on
      }
    }
  }
  throw lastErr;
};

vi.mock('../src/utils/retry.js', () => ({
  withRetry: vi.fn((fn, maxRetries, delayMs) => {
    if (shouldUseRealRetry) {
      return realRetryImplementation(fn, maxRetries, delayMs);
    }
    return fn();
  }),
}));

// Mutable mock that we'll update per test
let globalMockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class Anthropic {
      constructor() {
        this.messages = {
          create: (...args) => globalMockCreate(...args),
        };
      }
    },
  };
});

/** Wrap JSON in the expected <receipt_json> tag */
function receipt(obj) {
  return `I've processed your receipt.\n<receipt_json>${JSON.stringify(obj)}</receipt_json>`;
}

describe('receiptExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to a fresh mock for each test
    globalMockCreate = vi.fn();
    shouldUseRealRetry = false;
  });

  it('extracts receipt and parses valid JSON response from Claude', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Starbucks',
            amount: 5.50,
            currency: 'USD',
            category: 'Meals/Entertainment',
            date: '2026-01-15',
            description: 'Coffee with Bob',
            confidence: 0.95,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('fake image data');
    const result = await extractReceipt(fileBuffer, 'image/jpeg', 'Coffee meeting');

    expect(result.extracted.vendorName).toBe('Starbucks');
    expect(result.extracted.amount).toBe(5.50);
    expect(result.extracted.currency).toBe('USD');
    expect(result.extracted.category).toBe('Meals/Entertainment');
    expect(result.extracted.date).toBe('2026-01-15');
    expect(result.extracted.confidence).toBe(0.95);
  });

  it('sets needsReview=true when confidence < 0.8', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Blurry Receipt',
            amount: 25,
            currency: 'SGD',
            category: 'Transportation',
            date: '2026-01-15',
            confidence: 0.65,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('blurry image');
    const result = await extractReceipt(fileBuffer, 'image/png');

    expect(result.extracted.confidence).toBe(0.65);
    expect(result.extracted.needsReview).toBe(true);
  });

  it('does not set needsReview when confidence >= 0.8', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Clear Receipt',
            amount: 50,
            currency: 'SGD',
            category: 'Meals/Entertainment',
            date: '2026-01-15',
            description: 'Lunch with Alice',
            confidence: 0.92,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('clear image');
    const result = await extractReceipt(fileBuffer, 'image/jpeg');

    expect(result.extracted.confidence).toBe(0.92);
    expect(result.extracted.needsReview).toBeUndefined();
  });

  it('sets missingCounterparty=true for Meals/Entertainment without "with X" in description', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Restaurant',
            amount: 45,
            currency: 'SGD',
            category: 'Meals/Entertainment',
            date: '2026-01-15',
            description: 'Lunch alone',
            confidence: 0.90,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');
    const result = await extractReceipt(fileBuffer, 'image/jpeg');

    expect(result.extracted.category).toBe('Meals/Entertainment');
    expect(result.extracted.description).toBe('Lunch alone');
    expect(result.extracted.missingCounterparty).toBe(true);
  });

  it('does not set missingCounterparty for Meals/Entertainment with "with X" in description', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Restaurant',
            amount: 60,
            currency: 'SGD',
            category: 'Meals/Entertainment',
            date: '2026-01-15',
            description: 'Lunch with Bob',
            confidence: 0.90,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');
    const result = await extractReceipt(fileBuffer, 'image/jpeg');

    expect(result.extracted.missingCounterparty).toBeUndefined();
  });

  it('sets missingCounterparty for Meals/Entertainment with missing description', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Restaurant',
            amount: 35,
            currency: 'SGD',
            category: 'Meals/Entertainment',
            date: '2026-01-15',
            confidence: 0.90,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');
    const result = await extractReceipt(fileBuffer, 'image/jpeg');

    expect(result.extracted.description).toBeUndefined();
    expect(result.extracted.missingCounterparty).toBe(true);
  });

  it('does not set missingCounterparty for non-Meals categories', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Taxi Company',
            amount: 25,
            currency: 'SGD',
            category: 'Transportation',
            date: '2026-01-15',
            description: 'Solo trip',
            confidence: 0.90,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');
    const result = await extractReceipt(fileBuffer, 'image/jpeg');

    expect(result.extracted.category).toBe('Transportation');
    expect(result.extracted.missingCounterparty).toBeUndefined();
  });

  it('throws error when Claude returns response with no receipt_json tag', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: 'This is not JSON, just plain text response',
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');

    await expect(extractReceipt(fileBuffer, 'image/jpeg')).rejects.toThrow(
      /unparseable/,
    );
  });

  it('throws error when response contains invalid JSON inside receipt_json tag', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: '<receipt_json>{invalid json without closing brace</receipt_json>',
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');

    await expect(extractReceipt(fileBuffer, 'image/jpeg')).rejects.toThrow();
  });

  it('retries on API failure via withRetry', async () => {
    shouldUseRealRetry = true;
    let callCount = 0;
    globalMockCreate.mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        throw new Error('API temporarily unavailable');
      }
      return Promise.resolve({
        content: [
          {
            text: receipt({
              vendorName: 'Success',
              amount: 10,
              currency: 'SGD',
              category: 'Other',
              date: '2026-01-15',
              confidence: 0.90,
            }),
          },
        ],
      });
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');
    const result = await extractReceipt(fileBuffer, 'image/jpeg');

    expect(result.extracted.vendorName).toBe('Success');
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it('supports PDF files with document source type', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'PDF Receipt',
            amount: 99,
            currency: 'USD',
            category: 'Other',
            date: '2026-01-15',
            confidence: 0.88,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('fake pdf data');
    const result = await extractReceipt(fileBuffer, 'application/pdf');

    expect(result.extracted.vendorName).toBe('PDF Receipt');
    const callArgs = globalMockCreate.mock.calls[0][0];
    const lastMsg = callArgs.messages[callArgs.messages.length - 1];
    const docMessage = lastMsg.content.find((c) => c.type === 'document');
    expect(docMessage).toBeDefined();
    expect(docMessage.source.media_type).toBe('application/pdf');
  });

  it('includes user context in Claude request when provided', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Test',
            amount: 20,
            currency: 'SGD',
            category: 'Other',
            date: '2026-01-15',
            confidence: 0.90,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');
    const context = 'Lunch meeting with client';
    await extractReceipt(fileBuffer, 'image/jpeg', context);

    const callArgs = globalMockCreate.mock.calls[0][0];
    const lastMsg = callArgs.messages[callArgs.messages.length - 1];
    const textMessage = lastMsg.content.find((c) => c.type === 'text');
    expect(textMessage.text).toContain('Additional context from the submitter');
    expect(textMessage.text).toContain(context);
  });

  it('includes default message when context not provided', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Test',
            amount: 15,
            currency: 'SGD',
            category: 'Other',
            date: '2026-01-15',
            confidence: 0.90,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');
    await extractReceipt(fileBuffer, 'image/jpeg', '');

    const callArgs = globalMockCreate.mock.calls[0][0];
    const lastMsg = callArgs.messages[callArgs.messages.length - 1];
    const textMessage = lastMsg.content.find((c) => c.type === 'text');
    expect(textMessage.text).toContain('No additional context provided');
  });

  it('supports image/gif and image/webp formats', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Test',
            amount: 10,
            currency: 'SGD',
            category: 'Other',
            date: '2026-01-15',
            confidence: 0.90,
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');

    // Test GIF
    await extractReceipt(fileBuffer, 'image/gif');
    let callArgs = globalMockCreate.mock.calls[0][0];
    let lastMsg = callArgs.messages[callArgs.messages.length - 1];
    let imageMessage = lastMsg.content.find((c) => c.type === 'image');
    expect(imageMessage.source.media_type).toBe('image/gif');

    globalMockCreate.mockClear();

    // Test WebP
    await extractReceipt(fileBuffer, 'image/webp');
    callArgs = globalMockCreate.mock.calls[0][0];
    lastMsg = callArgs.messages[callArgs.messages.length - 1];
    imageMessage = lastMsg.content.find((c) => c.type === 'image');
    expect(imageMessage.source.media_type).toBe('image/webp');
  });

  it('handles empty response content gracefully', async () => {
    globalMockCreate.mockResolvedValue({
      content: [{ text: '' }],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');

    await expect(extractReceipt(fileBuffer, 'image/jpeg')).rejects.toThrow();
  });

  it('handles missing confidence field gracefully', async () => {
    globalMockCreate.mockResolvedValue({
      content: [
        {
          text: receipt({
            vendorName: 'Test',
            amount: 25,
            currency: 'SGD',
            category: 'Transportation',
            date: '2026-01-15',
          }),
        },
      ],
    });

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');
    const fileBuffer = Buffer.from('receipt');
    const result = await extractReceipt(fileBuffer, 'image/jpeg');

    expect(result.extracted.vendorName).toBe('Test');
    expect(result.extracted.confidence).toBeUndefined();
    expect(result.extracted.needsReview).toBe(true);
  });

  it('handles case-insensitive "with" pattern in Meals/Entertainment description', async () => {
    const testCases = [
      { desc: 'WITH uppercase', hasPartner: true },
      { desc: 'With mixed case', hasPartner: true },
      { desc: 'with lowercase', hasPartner: true },
      { desc: 'no partner mentioned', hasPartner: false },
    ];

    const { extractReceipt } = await import('../src/services/receiptExtractor.js');

    for (const testCase of testCases) {
      globalMockCreate.mockResolvedValue({
        content: [
          {
            text: receipt({
              vendorName: 'Restaurant',
              amount: 50,
              currency: 'SGD',
              category: 'Meals/Entertainment',
              date: '2026-01-15',
              description: testCase.desc,
              confidence: 0.90,
            }),
          },
        ],
      });

      const fileBuffer = Buffer.from('receipt');
      const result = await extractReceipt(fileBuffer, 'image/jpeg');

      if (testCase.hasPartner) {
        expect(result.extracted.missingCounterparty).toBeUndefined();
      } else {
        expect(result.extracted.missingCounterparty).toBe(true);
      }

      globalMockCreate.mockClear();
    }
  });
});
