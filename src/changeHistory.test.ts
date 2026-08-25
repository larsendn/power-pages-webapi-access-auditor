import { describe, expect, it } from 'vitest'
import { changeHistoryToCsv, mergeChangeHistory, parseChangeHistoryCsv, type ChangeHistoryRecord } from './changeHistory'

const record: ChangeHistoryRecord = {
  id: 'change-1', changedAt: '2026-08-25T12:00:00.000Z', environmentId: 'environment-1',
  environmentName: 'Customer, Production', targetEnvironment: 'environment-1', siteId: 'site-1',
  siteName: 'Portal "One"', model: 'Modern', settingId: 'setting-1',
  settingName: 'Webapi/contact/fields', previousValue: '*', appliedValue: 'contactid,fullname',
  status: 'Applied', undoneAt: '',
}

describe('change history CSV', () => {
  it('round trips quoted values', () => {
    expect(parseChangeHistoryCsv(changeHistoryToCsv([record]))).toEqual([record])
  })

  it('rejects rows that could restore a non-wildcard value', () => {
    const csv = changeHistoryToCsv([{ ...record, previousValue: 'contactid' }])
    expect(() => parseChangeHistoryCsv(csv)).toThrow('incomplete or unsafe')
  })

  it('deduplicates imported records by change ID', () => {
    expect(mergeChangeHistory([record], [record])).toEqual([record])
  })
})