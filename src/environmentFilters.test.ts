import { describe, expect, it } from 'vitest'
import type { EnvironmentTarget } from './auditor'
import { claimUniqueSites, getSiteDiscoveryDiagnostics, hasPowerPagesSites, isActiveSiteRecord, matchesEnvironmentList, parseEnvironmentList, siteDiscoveryFailure } from './environmentFilters'

const environment: EnvironmentTarget = {
  id: 'ENVIRONMENT-1',
  name: 'Customer Portal Dev',
  target: 'https://customer.crm.dynamics.com',
  url: 'https://customer.crm.dynamics.com',
  sku: 'Sandbox',
  type: 'Sandbox',
  isProduction: false,
  isPersonalDeveloper: false,
  isTrial: false,
}

describe('bulk environment lists', () => {
  it('parses newline, comma, and semicolon-separated values without duplicates', () => {
    expect(parseEnvironmentList(' ENVIRONMENT-1\nCustomer Portal Dev, https://customer.crm.dynamics.com/;environment-1 ')).toEqual([
      'environment-1',
      'customer portal dev',
      'https://customer.crm.dynamics.com',
    ])
  })

  it('matches exact environment IDs, names, and URLs case-insensitively', () => {
    expect(matchesEnvironmentList(environment, ['environment-1'])).toBe(true)
    expect(matchesEnvironmentList(environment, ['customer portal dev'])).toBe(true)
    expect(matchesEnvironmentList(environment, ['https://customer.crm.dynamics.com'])).toBe(true)
    expect(matchesEnvironmentList(environment, ['customer portal'])).toBe(false)
  })
})

describe('Power Pages presence', () => {
  const parseRows = (value?: string) => JSON.parse(value ?? '[]') as Record<string, unknown>[]

  it('recognizes a site from any supported storage model', () => {
    expect(hasPowerPagesSites({ modernsitesjson: '[{"id":"site"}]' }, parseRows)).toBe(true)
    expect(hasPowerPagesSites({ enhancedandcodesitesjson: '[{"id":"site"}]' }, parseRows)).toBe(true)
    expect(hasPowerPagesSites({ standardsitesjson: '[{"id":"site"}]' }, parseRows)).toBe(true)
  })

  it('returns false when all site collections are empty', () => {
    expect(hasPowerPagesSites({ modernsitesjson: '[]', enhancedandcodesitesjson: '[]', standardsitesjson: '[]' }, parseRows)).toBe(false)
  })

  it('treats an unavailable model table as expected', () => {
    const output = {
      enhancedstatus: 'Succeeded',
      standardstatus: 'Failed',
      standarderrorcode: '0x80060888',
      standarderrormessage: "Resource not found for the segment 'adx_websites'.",
      modernstatus: 'Succeeded',
    }
    expect(getSiteDiscoveryDiagnostics(output)[1].modelUnavailable).toBe(true)
    expect(siteDiscoveryFailure(output)).toBe('')
  })

  it('surfaces authorization failures instead of reporting an empty environment', () => {
    const output = {
      enhancedstatus: 'Failed',
      enhancederrorcode: '403',
      enhancederrormessage: 'Forbidden',
      standardstatus: 'Failed',
      standarderrorcode: '0x80060888',
      standarderrormessage: "Resource not found for the segment 'adx_websites'.",
      modernstatus: 'TimedOut',
    }
    expect(siteDiscoveryFailure(output)).toBe('Power Pages site discovery failed. Enhanced: Forbidden (403); Modern: TimedOut')
  })

  it('remains compatible with flows that do not return diagnostics', () => {
    expect(getSiteDiscoveryDiagnostics({ standardsitesjson: '[]' })).toEqual([])
    expect(siteDiscoveryFailure({ standardsitesjson: '[]' })).toBe('')
  })
})

describe('Power Pages site model discovery', () => {
  it('deduplicates site IDs across model representations in discovery order', () => {
    const claimedIds = new Set<string>()
    const modern = claimUniqueSites([{ id: 'SITE-1', model: 'Modern' }, { id: 'site-1', model: 'Modern' }], claimedIds)
    const enhanced = claimUniqueSites([{ id: 'site-1', model: 'Enhanced' }, { id: 'site-2', model: 'Enhanced' }], claimedIds)
    const standard = claimUniqueSites([{ id: 'SITE-1', model: 'Standard' }, { id: 'site-2', model: 'Standard' }, { id: 'site-3', model: 'Standard' }], claimedIds)

    expect(modern).toEqual([{ id: 'SITE-1', model: 'Modern' }])
    expect(enhanced).toEqual([{ id: 'site-2', model: 'Enhanced' }])
    expect(standard).toEqual([{ id: 'site-3', model: 'Standard' }])
  })

  it('identifies inactive sites and treats legacy flow rows as active', () => {
    expect(isActiveSiteRecord({ statecode: 0 })).toBe(true)
    expect(isActiveSiteRecord({ statecode: '0' })).toBe(true)
    expect(isActiveSiteRecord({ statecode: 1 })).toBe(false)
    expect(isActiveSiteRecord({})).toBe(true)
  })
})
