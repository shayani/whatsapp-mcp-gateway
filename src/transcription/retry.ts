const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function isTransientApiError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { status?: number; code?: string; message?: string };
  if (typeof anyErr.status === 'number' && RETRYABLE_STATUS_CODES.has(anyErr.status)) {
    return true;
  }
  const msg = (anyErr.message || '').toLowerCase();
  return (
    msg.includes('over capacity') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('temporarily unavailable') ||
    msg.includes('timeout')
  );
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries || !isTransientApiError(err)) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
