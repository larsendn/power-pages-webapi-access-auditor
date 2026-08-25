export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

function detailsText(details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return ''
  return ` ${JSON.stringify(details, (_, value) => value instanceof Error ? value.message : value)}`
}

class DebugLogger {
  private lines: string[] = []
  private listeners = new Set<(lines: string[]) => void>()

  log(level: LogLevel, event: string, details?: Record<string, unknown>) {
    const line = `${new Date().toISOString()} [${level}] ${event}${detailsText(details)}`
    this.lines.push(line)
    if (this.lines.length > 10_000) {
      this.lines.splice(0, this.lines.length - 10_000)
    }
    this.listeners.forEach((listener) => listener([...this.lines]))
  }

  info(event: string, details?: Record<string, unknown>) { this.log('INFO', event, details) }
  warn(event: string, details?: Record<string, unknown>) { this.log('WARN', event, details) }
  error(event: string, details?: Record<string, unknown>) { this.log('ERROR', event, details) }

  subscribe(listener: (lines: string[]) => void): () => void {
    this.listeners.add(listener)
    listener([...this.lines])
    return () => this.listeners.delete(listener)
  }

  download() {
    const content = `${this.lines.join('\r\n')}\r\n`
    const href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = `ppwfa-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  clear() {
    this.lines = []
    this.listeners.forEach((listener) => listener([]))
    this.info('debug.log.cleared')
  }
}

export const debugLogger = new DebugLogger()