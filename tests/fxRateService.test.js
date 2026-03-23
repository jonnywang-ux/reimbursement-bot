import { describe, it, expect, vi, beforeEach } from 'vitest';

// cheerio is imported as `import * as cheerio` in fxRateService, so mock
// named exports (not default).
vi.mock('cheerio', () => ({
  load: vi.fn(() => {
    return (selector) => {
      if (selector === 'input[name="__VIEWSTATE"]') return { val: () => 'vs' };
      if (selector === 'input[name="__VIEWSTATEGENERATOR"]') return { val: () => 'gen' };
      if (selector === 'input[name="__EVENTVALIDATION"]') return { val: () => 'ev' };
      return { val: () => '' };
    };
  }),
}));

vi.mock('../src/utils/logger.js');
// Pass-through retry so we don't need timers
vi.mock('../src/utils/retry.js', () => ({
  withRetry: vi.fn((fn) => fn()),
}));

/** Build a minimal fetch Response-like object */
function mockResponse({ ok = true, contentType = 'text/csv', body = '', json = null } = {}) {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: (h) => (h === 'content-type' ? contentType : h === 'set-cookie' ? '' : null) },
    text: async () => body,
    json: async () => json,
  };
}

describe('fxRateService', () => {
  let fxRateService;

  beforeEach(async () => {
    vi.resetModules(); // clear rateCache between tests
    global.fetch = vi.fn();
    fxRateService = await import('../src/services/fxRateService.js');
  });

  describe('getMasRate', () => {
    it('returns rate object with correct shape', async () => {
      global.fetch
        .mockResolvedValueOnce(mockResponse({ contentType: 'text/html', body: '<html></html>' }))
        .mockResolvedValueOnce(mockResponse({ body: 'US Dollar,1.3400' }));

      const result = await fxRateService.getMasRate('2026-01-15', 'USD');

      expect(result).toHaveProperty('date', '2026-01-15');
      expect(result).toHaveProperty('rateDate');
      expect(result).toHaveProperty('sgdPerUnit');
      expect(result).toHaveProperty('source');
      expect(typeof result.sgdPerUnit).toBe('number');
    });

    it('falls back to open.er-api.com when MAS returns non-CSV content-type', async () => {
      global.fetch
        .mockResolvedValueOnce(mockResponse({ contentType: 'text/html', body: '<html></html>' }))
        .mockResolvedValueOnce(mockResponse({ contentType: 'text/html', body: '<html>Error</html>' }))
        .mockResolvedValue(mockResponse({ contentType: 'application/json', json: { rates: { SGD: 1.34, USD: 1 } } }));

      const result = await fxRateService.getMasRate('2026-01-15', 'USD');

      expect(result.source).toBe('fallback');
      expect(result.sgdPerUnit).toBeGreaterThan(0);
    });

    it('throws descriptive error when both MAS and fallback fail', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(fxRateService.getMasRate('2026-01-15', 'USD')).rejects.toThrow(
        /FX rate unavailable.*Both MAS and fallback API failed/,
      );
    });

    it('converts CNY to RMB for lookups', async () => {
      global.fetch
        .mockResolvedValueOnce(mockResponse({ contentType: 'text/html', body: '<html></html>' }))
        .mockResolvedValueOnce(mockResponse({ body: 'Chinese Renminbi,0.1850' }));

      const result = await fxRateService.getMasRate('2026-01-15', 'CNY');

      expect(result.sgdPerUnit).toBe(0.185);
    });
  });

  describe('convertAmount', () => {
    it('returns correct conversion object shape', async () => {
      global.fetch.mockResolvedValue(mockResponse({ body: 'US Dollar,1.3400' }));

      const result = await fxRateService.convertAmount(100, 'USD', '2026-01-15');

      expect(result).toHaveProperty('totalAmountSGD');
      expect(result).toHaveProperty('totalAmountUSD');
      expect(result).toHaveProperty('fxRateSGD');
      expect(result).toHaveProperty('fxRateUSD');
      expect(result).toHaveProperty('rateDate');
      expect(result).toHaveProperty('source');
    });

    it('returns original amount as totalAmountSGD for SGD input', async () => {
      global.fetch.mockResolvedValue(mockResponse({ body: 'US Dollar,1.3400' }));

      const result = await fxRateService.convertAmount(100, 'SGD', '2026-01-15');

      expect(result.totalAmountSGD).toBe(100);
      expect(result.fxRateSGD).toBe(1);
    });

    it('multiplies by sgdPerUnit for USD input', async () => {
      global.fetch.mockResolvedValue(mockResponse({ body: 'US Dollar,1.3400' }));

      const result = await fxRateService.convertAmount(100, 'USD', '2026-01-15');

      // 100 USD × 1.3400 SGD/USD = 134 SGD
      expect(result.totalAmountSGD).toBe(134);
      expect(result.totalAmountUSD).toBe(100);
      expect(result.fxRateSGD).toBe(1.34);
    });

    it('fetches both foreign and USD rates for other currencies', async () => {
      global.fetch.mockResolvedValue(mockResponse({ body: 'Chinese Renminbi,0.1850\nUS Dollar,1.3400' }));

      const result = await fxRateService.convertAmount(1000, 'RMB', '2026-01-15');

      // 1000 RMB × 0.1850 SGD/RMB = 185 SGD
      // 185 SGD ÷ 1.3400 SGD/USD = 138.06 USD
      expect(result.totalAmountSGD).toBe(185);
      expect(Math.round(result.totalAmountUSD * 100)).toBe(13806);
      expect(result.fxRateSGD).toBe(0.185);
      expect(result.fxRateUSD).toBe(1.34);
    });

    it('rounds results to 2 decimal places', async () => {
      global.fetch.mockResolvedValue(mockResponse({ body: 'Chinese Renminbi,0.18567\nUS Dollar,1.34891' }));

      const result = await fxRateService.convertAmount(123.456, 'RMB', '2026-01-15');

      // Check that results are rounded to 2 decimals
      expect(result.totalAmountSGD.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(result.totalAmountUSD.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
    });

    it('uses fallback source when MAS unavailable', async () => {
      global.fetch
        .mockResolvedValueOnce(mockResponse({ contentType: 'text/html', body: '<html></html>' }))
        .mockResolvedValueOnce(mockResponse({ contentType: 'text/html', body: '<html>Error</html>' }))
        .mockResolvedValue(mockResponse({ contentType: 'application/json', json: { rates: { SGD: 1.34, USD: 1 } } }));

      const result = await fxRateService.convertAmount(100, 'USD', '2026-01-15');

      expect(result.source).toBe('fallback');
    });

    it('handles CNY currency code as RMB', async () => {
      global.fetch.mockResolvedValue(mockResponse({ body: 'Chinese Renminbi,0.1850\nUS Dollar,1.3400' }));

      const result = await fxRateService.convertAmount(500, 'CNY', '2026-01-15');

      expect(result.totalAmountSGD).toBeGreaterThan(0);
      expect(result.fxRateSGD).toBe(0.185);
    });

    it('calculates USD amount as SGD divided by SGD/USD rate for foreign currencies', async () => {
      global.fetch.mockResolvedValue(mockResponse({ body: 'US Dollar,1.3400\nEuro,1.5000' }));

      const result = await fxRateService.convertAmount(100, 'EUR', '2026-01-15');

      // 100 EUR × 1.5000 SGD/EUR = 150 SGD
      // 150 SGD ÷ 1.3400 SGD/USD ≈ 111.94 USD
      expect(result.totalAmountSGD).toBe(150);
      expect(Math.round(result.totalAmountUSD * 100)).toBeCloseTo(11194, 0);
    });

    it('returns fallback as source when MAS unavailable for foreign currency', async () => {
      global.fetch
        .mockResolvedValueOnce(mockResponse({ contentType: 'text/html', body: '<html></html>' }))
        .mockResolvedValueOnce(mockResponse({ contentType: 'text/html', body: '<html></html>' }))
        .mockResolvedValue(mockResponse({ contentType: 'application/json', json: { rates: { SGD: 1.34, USD: 1, EUR: 1.5 } } }));

      const result = await fxRateService.convertAmount(100, 'EUR', '2026-01-15');

      expect(result.source).toBe('fallback');
    });
  });
});
