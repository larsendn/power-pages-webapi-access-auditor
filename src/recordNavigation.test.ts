import { describe, expect, it } from 'vitest'
import { physicalRecordUrl } from './recordNavigation'

describe('physical record navigation', () => {
  it('builds links to physical Power Pages records', () => {
    expect(physicalRecordUrl('https://org.crm.dynamics.com/', 'mspp_sitesetting', 'setting-id')).toBe(
      'https://org.crm.dynamics.com/main.aspx?pagetype=entityrecord&etn=mspp_sitesetting&id=setting-id',
    )
  })

  it('never builds a generic powerpagecomponent link', () => {
    expect(physicalRecordUrl('https://org.crm.dynamics.com', 'powerpagecomponent', 'component-id')).toBe('')
  })
})