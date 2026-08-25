import { describe, expect, it } from 'vitest'
import { minimumExplicitFields, normalizeExplicitFields } from './approval'

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
})