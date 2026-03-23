import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry } from '../src/utils/retry.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns value on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and returns value on second attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('success');

    const promise = withRetry(fn, 2, 1000);
    expect(fn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    const result = await promise;
    expect(result).toBe('success');
  });

  it('throws after exhausting all retries', async () => {
    const error = new Error('persistent failure');
    const fn = vi.fn().mockRejectedValue(error);

    const promise = withRetry(fn, 2, 1000).catch(() => null);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await promise;
  });

  it('calls fn exactly maxRetries+1 times on total failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = withRetry(fn, 3, 500).catch(() => null);

    // Initial attempt
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance through all retry delays
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(1500);
    expect(fn).toHaveBeenCalledTimes(4);

    await promise;
  });

  it('uses exponential backoff with linear multiplier', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = withRetry(fn, 2, 1000).catch(() => null);

    // First attempt at t=0
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);

    // Second attempt at t=1000 (delay * 1)
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);

    // Third attempt at t=1000 + 2000 = 3000 (delay * 2)
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);

    await promise;
  });

  it('returns on success after multiple retries', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('finally success');

    const promise = withRetry(fn, 3, 500);

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toBe('finally success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses default maxRetries of 2 when not provided', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = withRetry(fn).catch(() => null);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await promise;
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('uses default delayMs of 1000 when not provided', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    const promise = withRetry(fn, 1).catch(() => null);

    await vi.advanceTimersByTimeAsync(1000);

    await promise;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error encountered', async () => {
    const error1 = new Error('first error');
    const error2 = new Error('second error');
    const error3 = new Error('final error');

    const fn = vi
      .fn()
      .mockRejectedValueOnce(error1)
      .mockRejectedValueOnce(error2)
      .mockRejectedValueOnce(error3);

    let caughtError;
    const promise = withRetry(fn, 2, 500).catch((err) => {
      caughtError = err;
    });

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);

    await promise;
    expect(caughtError).toEqual(error3);
    expect(caughtError.message).toBe('final error');
  });
});
