import { describe, expect, it, vi } from 'vitest'
import { isTransientDetectionError, runBoundedPool, withTransientRetry } from './detectionScheduler'

describe('detection scheduler', () => {
  it('never exceeds the requested concurrency', async () => {
    let active = 0
    let peak = 0
    const releases: (() => void)[] = []
    const operation = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => releases.push(resolve))
      active -= 1
      return 1
    })
    const pending = runBoundedPool([1, 2, 3, 4, 5], 3, operation)
    await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(3))
    while (releases.length > 0) releases.shift()?.()
    await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(5))
    while (releases.length > 0) releases.shift()?.()
    await pending
    expect(peak).toBe(3)
  })

  it('retries transient failures with exponential delays', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('429 throttled'))
      .mockRejectedValueOnce(new Error('503 temporarily unavailable'))
      .mockResolvedValue('ok')
    const sleep = vi.fn(async () => undefined)
    const result = await withTransientRetry(operation, { retries: 2, baseDelayMs: 500, sleep })
    expect(result).toEqual({ value: 'ok', attempts: 3 })
    expect(sleep.mock.calls).toEqual([[500], [1000]])
  })

  it('does not retry access or configuration errors', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('403 Forbidden'))
    await expect(withTransientRetry(operation, { retries: 2, baseDelayMs: 500, sleep: async () => undefined })).rejects.toThrow('403')
    expect(operation).toHaveBeenCalledTimes(1)
    expect(isTransientDetectionError(new Error('Power Apps flow failed'))).toBe(true)
  })

  it('stops scheduling new items after cancellation', async () => {
    let stopped = false
    const completed: number[] = []
    const results = await runBoundedPool(
      [1, 2, 3, 4],
      1,
      async (item) => {
        completed.push(item)
        stopped = true
        return 1
      },
      undefined,
      () => stopped,
    )
    expect(completed).toEqual([1])
    expect(results).toHaveLength(1)
  })
})