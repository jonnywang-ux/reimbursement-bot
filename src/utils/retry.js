/**
 * Retry an async function up to maxRetries times with linear back-off.
 *
 * @param {() => Promise<any>} fn
 * @param {number} maxRetries  Max additional attempts after the first failure (default 2)
 * @param {number} delayMs     Base delay between retries in ms (default 1000)
 * @returns {Promise<any>}
 */
export async function withRetry(fn, maxRetries = 2, delayMs = 1000) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}
