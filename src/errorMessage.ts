export function flowErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const preferred = [record.message, record.error, record.details, record.response]
      .find((value) => typeof value === 'string' && value.trim())
    if (typeof preferred === 'string') return preferred
    try {
      return JSON.stringify(error, null, 2)
    } catch {
      return Object.prototype.toString.call(error)
    }
  }
  return String(error)
}