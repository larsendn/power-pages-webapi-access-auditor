import type { EnvironmentTarget } from './auditor'

export interface SiteDiscoveryDiagnostic {
  model: 'Enhanced' | 'Standard' | 'Modern'
  status: string
  code: string
  message: string
  modelUnavailable: boolean
}

const DISCOVERY_MODELS = [
  { model: 'Enhanced', prefix: 'enhanced' },
  { model: 'Standard', prefix: 'standard' },
  { model: 'Modern', prefix: 'modern' },
] as const

function outputText(output: Record<string, unknown>, key: string): string {
  return typeof output[key] === 'string' ? output[key].trim() : ''
}

export function getSiteDiscoveryDiagnostics(output: Record<string, unknown>): SiteDiscoveryDiagnostic[] {
  return DISCOVERY_MODELS.map(({ model, prefix }) => {
    const status = outputText(output, `${prefix}status`)
    const code = outputText(output, `${prefix}errorcode`)
    const message = outputText(output, `${prefix}errormessage`)
    const modelUnavailable = status.toLowerCase() === 'failed'
      && (code.toLowerCase() === '0x80060888' || /resource not found for the segment/i.test(message))
    return { model, status, code, message, modelUnavailable }
  }).filter((diagnostic) => diagnostic.status || diagnostic.code || diagnostic.message)
}

export function siteDiscoveryFailure(output: Record<string, unknown>): string {
  const failures = getSiteDiscoveryDiagnostics(output)
    .filter((diagnostic) => diagnostic.status.toLowerCase() !== 'succeeded' && !diagnostic.modelUnavailable)
  if (failures.length === 0) return ''
  const details = failures.map((diagnostic) => {
    const reason = diagnostic.message || diagnostic.code || diagnostic.status || 'Unknown failure'
    return `${diagnostic.model}: ${reason}${diagnostic.code && diagnostic.message ? ` (${diagnostic.code})` : ''}`
  })
  return `Power Pages site discovery failed. ${details.join('; ')}`
}

export function parseEnvironmentList(value: string): string[] {
  return [...new Set(value
    .split(/[\r\n,;]+/)
    .map((item) => item.trim().replace(/\/$/, '').toLowerCase())
    .filter(Boolean))]
}

export function matchesEnvironmentList(environment: EnvironmentTarget, entries: string[]): boolean {
  if (entries.length === 0) return true
  const candidates = [environment.id, environment.name, environment.url, environment.target]
    .map((value) => value.trim().replace(/\/$/, '').toLowerCase())
  return entries.some((entry) => candidates.includes(entry))
}

export function hasPowerPagesSites(output: Record<string, unknown>, parseRows: (value?: string) => Record<string, unknown>[]): boolean {
  return ['modernsitesjson', 'enhancedandcodesitesjson', 'standardsitesjson']
    .some((key) => parseRows(typeof output[key] === 'string' ? output[key] : undefined).length > 0)
}
