export interface RetryOptions {
  retries: number
  baseDelayMs: number
  sleep?: (milliseconds: number) => Promise<void>
}

export interface PoolResult<T> {
  item: T
  error?: unknown
  attempts: number
}

export function isTransientDetectionError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (/\b(400|401|403|404)\b|bad request|unauthorized|forbidden|not found/.test(message)) return false
  return /\b(408|409|425|429|500|502|503|504)\b|timeout|timed out|throttl|rate limit|temporar|network|fetch|connection|flow .*failed/.test(message)
}

export async function withTransientRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<{ value: T; attempts: number }> {
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  let attempt = 0
  while (true) {
    attempt += 1
    try {
      return { value: await operation(), attempts: attempt }
    } catch (error) {
      if (attempt > options.retries || !isTransientDetectionError(error)) throw Object.assign(error instanceof Error ? error : new Error(String(error)), { attempts: attempt })
      await sleep(options.baseDelayMs * (2 ** (attempt - 1)))
    }
  }
}

export async function runBoundedPool<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<number>,
  onComplete?: (result: PoolResult<T>) => void,
  shouldStop?: () => boolean,
): Promise<PoolResult<T>[]> {
  const results: PoolResult<T>[] = []
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length && !shouldStop?.()) {
      const item = items[cursor]
      cursor += 1
      let result: PoolResult<T>
      try {
        result = { item, attempts: await operation(item) }
      } catch (error) {
        result = { item, error, attempts: Number((error as { attempts?: unknown })?.attempts) || 1 }
      }
      results.push(result)
      onComplete?.(result)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()))
  return results
}