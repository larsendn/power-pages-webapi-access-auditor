import { describe, expect, it } from 'vitest'
import { wildcardFindingKey, withoutComponentEvidenceLinks, withoutNestedSiteAnalysis } from './reviewWorkspace'

describe('withoutNestedSiteAnalysis', () => {
  it('removes repeated analysis while preserving review data and source links', () => {
    const entries = [{
      key: 'environment|site|table',
      evidence: [{ field: 'name', recordEntity: 'adx_webfile', recordId: 'file-id' }],
      site: {
        id: 'site-id',
        name: 'Site',
        analysis: { findings: [{ table: 'contact' }], sourceCount: 200 },
      },
    }]

    const compact = withoutNestedSiteAnalysis(entries)

    expect(compact[0].site).toEqual({ id: 'site-id', name: 'Site' })
    expect(compact[0].evidence).toEqual(entries[0].evidence)
    expect(entries[0].site.analysis).toBeDefined()
  })

  it('keeps a thousand representative findings under a one-megabyte budget', () => {
    const repeatedAnalysis = { findings: Array.from({ length: 20 }, (_, index) => ({ table: `table_${index}`, evidence: 'x'.repeat(500) })) }
    const entries = Array.from({ length: 1_000 }, (_, index) => ({
      key: `environment|site|table_${index}`,
      table: `table_${index}`,
      proposedValue: 'contactid,fullname,emailaddress1',
      evidence: [{ field: 'fullname', file: '/web-files/client.js', line: index + 1, recordEntity: 'adx_webfile', recordId: `file-${index}` }],
      site: { id: `site-${index % 358}`, name: `Site ${index % 358}`, analysis: repeatedAnalysis },
    }))

    const serialized = JSON.stringify(withoutNestedSiteAnalysis(entries))

    expect(new Blob([serialized]).size).toBeLessThan(1_000_000)
  })
})

describe('withoutComponentEvidenceLinks', () => {
  it('removes obsolete site-component navigation from restored code evidence', () => {
    const entries = [{
      evidence: [
        { field: '*', recordEntity: 'powerpagecomponent', recordId: 'component-id' },
        { field: 'name', recordEntity: 'adx_webpage', recordId: 'page-id' },
      ],
    }]

    expect(withoutComponentEvidenceLinks(entries)[0].evidence).toEqual([
      { field: '*', recordEntity: undefined, recordId: undefined },
      { field: 'name', recordEntity: 'adx_webpage', recordId: 'page-id' },
    ])
  })
})

describe('wildcardFindingKey', () => {
  it('distinguishes duplicate setting names by physical record ID', () => {
    const first = wildcardFindingKey('environment', 'site', 'Modern', 'Webapi/account/fields', 'record-1')
    const second = wildcardFindingKey('environment', 'site', 'Standard', 'webapi/account/FIELDS', 'record-2')

    expect(first).not.toBe(second)
  })

  it('distinguishes models even when migrated records share a site and setting ID', () => {
    const modern = wildcardFindingKey('environment', 'site', 'Modern', 'Webapi/account/fields', 'record')
    const standard = wildcardFindingKey('environment', 'site', 'Standard', 'Webapi/account/fields', 'record')

    expect(modern).not.toBe(standard)
  })
})