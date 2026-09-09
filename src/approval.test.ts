import { describe, expect, it } from 'vitest'
import { minimumExplicitFields, normalizeExplicitFields, resolveExplicitFields } from './approval'

describe('manual explicit field approval', () => {
  it('normalizes a valid comma-separated logical-name list', () => {
    expect(normalizeExplicitFields(' lastname, firstname,firstname ')).toBe('firstname,lastname')
  })

  it('rejects wildcards, paths, and blank lists', () => {
    expect(normalizeExplicitFields('*')).toBe('')
    expect(normalizeExplicitFields('firstname,contact/fullname')).toBe('')
    expect(normalizeExplicitFields('')).toBe('')
  })

  it('provides a minimum primary-id allowlist for a logical table name', () => {
    expect(minimumExplicitFields('cr314_institutionsdata')).toBe('cr314_institutionsdataid')
    expect(minimumExplicitFields('bad/table')).toBe('')
  })

  it('allows all-column findings to use detected fields without changing code', () => {
    expect(resolveExplicitFields('blocked', true, '', 'ssrs_name,ssrs_facilityid', 'ssrs_facility')).toBe('ssrs_facilityid,ssrs_name')
    expect(resolveExplicitFields('blocked', true, 'ssrs_name,ssrs_city', 'ssrs_name', 'ssrs_facility')).toBe('ssrs_city,ssrs_name')
  })

  it('uses a primary-id fallback for opaque requests without detected fields', () => {
    expect(resolveExplicitFields('blocked', false, '', '', 'incident')).toBe('incidentid')
    expect(resolveExplicitFields('blocked', false, 'title,incidentid', '', 'incident')).toBe('incidentid,title')
  })
})