import { describe, expect, it } from 'vitest'
import { analyzeConfiguration, isCodeWebFile } from './siteConfiguration'

describe('site configuration analysis', () => {
  it('distinguishes code-bearing web files from static assets', () => {
    expect(isCodeWebFile('portal.js')).toBe(true)
    expect(isCodeWebFile('page.liquid')).toBe(true)
    expect(isCodeWebFile('theme.css')).toBe(false)
    expect(isCodeWebFile('logo.png')).toBe(false)
    expect(isCodeWebFile('favicon.ico')).toBe(false)
    expect(isCodeWebFile('PWAManifest.json')).toBe(false)
  })

  it('analyzes enhanced settings and inline page code', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'setting-1', powerpagecomponenttype: 9, name: 'fields', content: JSON.stringify({ name: 'Webapi/contact/fields', value: '*' }) },
        { powerpagecomponentid: 'page-1', powerpagecomponenttype: 2, name: 'Contacts', content: JSON.stringify({ customjavascript: "fetch('/_api/contacts?$select=firstname,lastname')" }) },
      ]),
      standardwebpagesjson: JSON.stringify([{ adx_webpageid: 'physical-page-1', adx_name: 'Contacts' }]),
    })

    expect(result.sourceCount).toBe(1)
    expect(result.findings[0].confidence).toBe('high')
    expect(result.findings[0].proposedFields).toEqual(['firstname', 'lastname'])
    expect(result.findings[0].evidence[0]).toEqual(expect.objectContaining({ recordEntity: 'adx_webpage', recordId: 'physical-page-1' }))
  })

  it('reads an Enhanced site-setting name from the component row', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'setting-1', powerpagecomponenttype: 9, name: 'Webapi/contact/fields', content: JSON.stringify({ value: '*', source: 0 }) },
        { powerpagecomponentid: 'page-1', powerpagecomponenttype: 2, name: 'Contacts', content: JSON.stringify({ customjavascript: "fetch('/_api/contacts?$select=firstname')" }) },
      ]),
    })

    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].settingName).toBe('Webapi/contact/fields')
    expect(result.findings[0].proposedFields).toEqual(['firstname'])
  })

  it('keeps the Enhanced component mutation ID but links its physical site-setting record', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'component-setting-1', powerpagecomponenttype: 9, name: 'Webapi/contact/fields', content: JSON.stringify({ value: '*' }) },
        { powerpagecomponentid: 'page-1', powerpagecomponenttype: 2, name: 'Contacts', content: JSON.stringify({ customjavascript: "fetch('/_api/contacts?$select=firstname')" }) },
      ]),
      modernsettingsjson: JSON.stringify([{ mspp_sitesettingid: 'physical-setting-1', mspp_name: 'Webapi/contact/fields', mspp_value: '*' }]),
    })

    expect(result.findings[0]).toEqual(expect.objectContaining({
      settingRecordId: 'component-setting-1',
      settingRecordEntity: 'powerpagecomponent',
      settingNavigationRecordEntity: 'mspp_sitesetting',
      settingNavigationRecordId: 'physical-setting-1',
    }))
  })

  it('does not expose a component URL when an Enhanced physical site-setting record cannot be resolved', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'component-setting-1', powerpagecomponenttype: 9, name: 'Webapi/contact/fields', content: JSON.stringify({ value: '*' }) },
        { powerpagecomponentid: 'page-1', powerpagecomponenttype: 2, name: 'Contacts', content: JSON.stringify({ customjavascript: "fetch('/_api/contacts?$select=firstname')" }) },
      ]),
    })

    expect(result.findings[0].settingNavigationRecordEntity).toBeUndefined()
    expect(result.findings[0].settingNavigationRecordId).toBeUndefined()
  })

  it('analyzes Enhanced content snippets', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'setting-1', powerpagecomponenttype: 9, name: 'fields', content: JSON.stringify({ name: 'Webapi/contact/fields', value: '*' }) },
        { powerpagecomponentid: 'snippet-1', powerpagecomponenttype: 7, name: 'Contact script', content: JSON.stringify({ value: "<script>fetch('/_api/contacts?$select=firstname')</script>" }) },
      ]),
    })

    expect(result.findings[0].proposedFields).toEqual(['firstname'])
  })

  it('blocks enhanced remediation when web-file bytes were not scanned', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'setting-1', powerpagecomponenttype: 9, name: 'fields', content: JSON.stringify({ name: 'Webapi/contact/fields', value: '*' }) },
        { powerpagecomponentid: 'page-1', powerpagecomponenttype: 2, name: 'Contacts', content: JSON.stringify({ customjavascript: "fetch('/_api/contacts?$select=firstname')" }) },
        { powerpagecomponentid: 'file-1', powerpagecomponenttype: 3, name: 'contacts.js', content: JSON.stringify({ partialurl: 'contacts.js' }) },
      ]),
    })

    expect(result.findings[0].confidence).toBe('blocked')
    expect(result.findings[0].blockers.join(' ')).toContain('file-column bytes')
  })

  it('includes retrieved Enhanced web-file code and clears the completeness blocker', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'setting-1', powerpagecomponenttype: 9, name: 'fields', content: JSON.stringify({ name: 'Webapi/contact/fields', value: '*' }) },
        { powerpagecomponentid: 'file-1', powerpagecomponenttype: 3, name: 'contacts.js', content: JSON.stringify({ partialurl: 'contacts.js' }) },
      ]),
      standardwebfilesjson: JSON.stringify([{ adx_webfileid: 'physical-file-1', adx_name: 'contacts.js', adx_partialurl: 'contacts.js' }]),
    }, [{ id: 'file-1', name: 'contacts.js', content: "fetch('/_api/contacts?$select=mobilephone')" }])

    expect(result.findings[0].confidence).toBe('high')
    expect(result.findings[0].proposedFields).toEqual(['mobilephone'])
    expect(result.findings[0].evidence[0]).toEqual(expect.objectContaining({ recordEntity: 'adx_webfile', recordId: 'physical-file-1' }))
    expect(result.completenessBlockers).toEqual([])
  })

  it('does not link Enhanced code to a generic site component when no physical record resolves', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'setting-1', powerpagecomponenttype: 9, name: 'fields', content: JSON.stringify({ name: 'Webapi/contact/fields', value: '*' }) },
        { powerpagecomponentid: 'page-1', powerpagecomponenttype: 2, name: 'Contacts', content: JSON.stringify({ customjavascript: "fetch('/_api/contacts?$select=firstname')" }) },
      ]),
    })

    expect(result.findings[0].evidence[0]).toEqual(expect.objectContaining({ recordEntity: undefined, recordId: undefined }))
  })

  it('resolves an Enhanced page by partial URL when its physical record name differs', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'setting-1', powerpagecomponenttype: 9, name: 'fields', content: JSON.stringify({ name: 'Webapi/contact/fields', value: '*' }) },
        { powerpagecomponentid: 'page-1', powerpagecomponenttype: 2, name: 'Information: Submission Details', content: JSON.stringify({ partialurl: 'submission-details', customjavascript: "fetch('/_api/contacts?$select=firstname')" }) },
      ]),
      standardwebpagesjson: JSON.stringify([{ adx_webpageid: 'physical-page-1', adx_name: 'Submission Details', adx_partialurl: 'submission-details' }]),
    })

    expect(result.findings[0].evidence[0]).toEqual(expect.objectContaining({ recordEntity: 'adx_webpage', recordId: 'physical-page-1' }))
  })

  it('analyzes standard settings and configured code records', () => {
    const result = analyzeConfiguration('Standard', {
      standardsettingsjson: JSON.stringify([{ adx_sitesettingid: 'setting-1', adx_name: 'Webapi/contact/fields', adx_value: '*' }]),
      standardwebpagesjson: JSON.stringify([{ adx_name: 'Contacts', adx_customjavascript: "fetch('/_api/contacts?$select=emailaddress1')" }]),
      standardwebtemplatesjson: '[]',
      standardcontentsnippetsjson: '[]',
      standardwebfilesjson: '[]',
    })

    expect(result.findings[0].confidence).toBe('high')
    expect(result.findings[0].proposedFields).toEqual(['emailaddress1'])
  })

  it('analyzes both HTML and JavaScript on Standard localized webpage records', () => {
    const result = analyzeConfiguration('Standard', {
      standardsettingsjson: JSON.stringify([{ adx_sitesettingid: 'setting-1', adx_name: 'Webapi/contact/fields', adx_value: '*' }]),
      standardwebpagesjson: JSON.stringify([{
        adx_webpageid: 'page-1',
        adx_name: 'Localized contact page',
        adx_copy: "<script>fetch('/_api/contacts?$select=firstname')</script>",
        adx_customjavascript: `
          webapi.safeAjax({
            type: 'PATCH',
            url: '/_api/contacts(' + contactId + ')',
            data: JSON.stringify({ 'boss_sbureau@odata.bind': '/dmh_sbureaus(' + bureauId + ')' })
          })`,
      }]),
      standardwebtemplatesjson: '[]',
      standardcontentsnippetsjson: '[]',
      standardwebfilesjson: '[]',
    })

    expect(result.findings[0].confidence).toBe('high')
    expect(result.findings[0].proposedFields).toEqual(['boss_sbureau', 'firstname'])
    expect(result.findings[0].evidence.map((item) => item.file)).toEqual([
      'Localized contact page/adx_copy',
      'Localized contact page/adx_customjavascript',
    ])
    expect(result.findings[0].evidence.every((item) => item.recordEntity === 'adx_webpage' && item.recordId === 'page-1')).toBe(true)
  })

  it('links Standard JavaScript evidence to the web-file record', () => {
    const result = analyzeConfiguration('Standard', {
      standardsettingsjson: JSON.stringify([{ adx_sitesettingid: 'setting-1', adx_name: 'Webapi/contact/fields', adx_value: '*' }]),
      standardwebpagesjson: '[]',
      standardwebtemplatesjson: '[]',
      standardcontentsnippetsjson: '[]',
      standardwebfilesjson: JSON.stringify([{ adx_webfileid: 'webfile-1', adx_name: 'contacts.js', adx_partialurl: 'contacts.js' }]),
    }, [{ id: 'webfile-1', name: 'contacts.js', content: "fetch('/_api/contacts?$select=emailaddress1')" }])

    expect(result.findings[0].evidence[0]).toEqual(expect.objectContaining({
      file: 'contacts.js',
      recordEntity: 'adx_webfile',
      recordId: 'webfile-1',
    }))
  })

  it('analyzes Standard basic-form and multistep-step JavaScript', () => {
    const result = analyzeConfiguration('Standard', {
      standardsettingsjson: JSON.stringify([{ adx_sitesettingid: 'setting-1', adx_name: 'Webapi/contact/fields', adx_value: '*' }]),
      standardwebpagesjson: '[]',
      standardwebtemplatesjson: '[]',
      standardbasicformsjson: JSON.stringify([{ adx_name: 'Contact form', adx_registerstartupscript: "fetch('/_api/contacts?$select=firstname')" }]),
      standardmultistepformsjson: JSON.stringify([{ adx_webformid: 'form-1' }]),
      standardmultistepformstepsjson: JSON.stringify([
        { adx_name: 'Contact step', _adx_webform_value: 'form-1', adx_registerstartupscript: "fetch('/_api/contacts?$select=lastname')" },
        { adx_name: 'Other site step', _adx_webform_value: 'form-2', adx_registerstartupscript: "fetch('/_api/contacts?$select=mobilephone')" },
      ]),
      standardwebfilesjson: '[]',
    })

    expect(result.findings[0].proposedFields).toEqual(['firstname', 'lastname'])
  })

  it('analyzes Standard content snippets', () => {
    const result = analyzeConfiguration('Standard', {
      standardsettingsjson: JSON.stringify([{ adx_sitesettingid: 'setting-1', adx_name: 'Webapi/contact/fields', adx_value: '*' }]),
      standardwebpagesjson: '[]',
      standardwebtemplatesjson: '[]',
      standardcontentsnippetsjson: JSON.stringify([{ adx_name: 'Contact script', adx_value: "<script>fetch('/_api/contacts?$select=mobilephone')</script>" }]),
      standardwebfilesjson: '[]',
    })

    expect(result.findings[0].proposedFields).toEqual(['mobilephone'])
  })

  it('analyzes Enhanced basic-form and multistep-step JavaScript', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'setting-1', powerpagecomponenttype: 9, name: 'fields', content: JSON.stringify({ name: 'Webapi/contact/fields', value: '*' }) },
        { powerpagecomponentid: 'form-1', powerpagecomponenttype: 15, name: 'Contact form', content: JSON.stringify({ registerstartupscript: "fetch('/_api/contacts?$select=emailaddress1')" }) },
        { powerpagecomponentid: 'step-1', powerpagecomponenttype: 20, name: 'Contact step', content: JSON.stringify({ customjavascript: "fetch('/_api/contacts?$select=telephone1')" }) },
      ]),
    })

    expect(result.findings[0].proposedFields).toEqual(['emailaddress1', 'telephone1'])
  })

  it('analyzes mspp settings and code for modern sites', () => {
    const result = analyzeConfiguration('Modern', {
      modernsettingsjson: JSON.stringify([{
        mspp_sitesettingid: '2d93fa62-d72d-f111-8341-001dd80ef717',
        mspp_name: 'webapi/cr314_institutionsdata/fields',
        mspp_value: '*',
      }]),
      modernwebpagesjson: JSON.stringify([{
        mspp_name: 'Institutions',
        mspp_customjavascript: "fetch('/_api/cr314_institutionsdatas?$select=cr314_name,cr314_status')",
      }]),
      modernwebtemplatesjson: '[]',
      moderncontentsnippetsjson: '[]',
      modernwebfilesjson: '[]',
    })

    expect(result.findings[0].settingRecordEntity).toBe('mspp_sitesetting')
    expect(result.findings[0].confidence).toBe('high')
    expect(result.findings[0].proposedFields).toEqual(['cr314_name', 'cr314_status'])
  })

  it('analyzes Modern content snippets', () => {
    const result = analyzeConfiguration('Modern', {
      modernsettingsjson: JSON.stringify([{ mspp_sitesettingid: 'setting-1', mspp_name: 'Webapi/contact/fields', mspp_value: '*' }]),
      modernwebpagesjson: '[]',
      modernwebtemplatesjson: '[]',
      moderncontentsnippetsjson: JSON.stringify([{ mspp_name: 'Contact script', mspp_value: "<script>fetch('/_api/contacts?$select=telephone1')</script>" }]),
      modernwebfilesjson: '[]',
    })

    expect(result.findings[0].proposedFields).toEqual(['telephone1'])
  })

  it('does not block a modern finding for missing static image bytes', () => {
    const result = analyzeConfiguration('Modern', {
      modernsettingsjson: JSON.stringify([{ mspp_sitesettingid: 'setting-1', mspp_name: 'Webapi/contact/fields', mspp_value: '*' }]),
      modernwebpagesjson: JSON.stringify([{ mspp_name: 'Contacts', mspp_customjavascript: "fetch('/_api/contacts?$select=fullname')" }]),
      modernwebtemplatesjson: '[]',
      moderncontentsnippetsjson: '[]',
      modernwebfilesjson: JSON.stringify([{ mspp_webfileid: 'image-1', mspp_name: 'logo.png', mspp_partialurl: 'logo.png' }]),
    })

    expect(result.completenessBlockers).toEqual([])
    expect(result.findings[0].confidence).toBe('high')
  })

  it('finds a Standard table permission assigned to the anonymous users role', () => {
    const result = analyzeConfiguration('Standard', {
      standardpermissionsjson: JSON.stringify([{
        adx_entitypermissionid: 'permission-1',
        adx_entityname: 'Public contacts',
        adx_entitylogicalname: 'contact',
        adx_scope: 756150000,
        adx_read: true,
        adx_write: false,
      }]),
      standardrolesjson: JSON.stringify([{ adx_webroleid: 'role-1', adx_name: 'Anonymous Users', adx_anonymoususersrole: true }]),
      standardpermissionrolesjson: JSON.stringify([{ adx_entitypermissionid: 'permission-1', adx_webroleid: 'role-1' }]),
    })

    expect(result.anonymousPermissionFindings).toEqual([expect.objectContaining({
      permissionName: 'Public contacts',
      table: 'contact',
      scope: 'Global',
      privileges: ['Read'],
      roleName: 'Anonymous Users',
      inherited: false,
    })])
  })

  it('finds Enhanced child permissions that inherit anonymous access', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'role-1', powerpagecomponenttype: 11, name: 'Anonymous Users', content: JSON.stringify({ anonymoususersrole: true }) },
        { powerpagecomponentid: 'parent-1', powerpagecomponenttype: 18, name: 'Public accounts', content: JSON.stringify({ entityname: 'Public accounts', entitylogicalname: 'account', scope: 756150000, read: true, adx_entitypermission_webrole: ['role-1'] }) },
        { powerpagecomponentid: 'child-1', powerpagecomponenttype: 18, name: 'Public contacts', content: JSON.stringify({ entityname: 'Public contacts', entitylogicalname: 'contact', scope: 756150003, read: true, write: true, parententitypermission: 'parent-1', adx_entitypermission_webrole: [] }) },
      ]),
    })

    expect(result.anonymousPermissionFindings).toHaveLength(2)
    expect(result.anonymousPermissionFindings[1]).toEqual(expect.objectContaining({
      permissionName: 'Public contacts',
      table: 'contact',
      scope: 'Parent',
      privileges: ['Read', 'Write'],
      inherited: true,
    }))
  })

  it('links an Enhanced finding to its matching table permission record', () => {
    const result = analyzeConfiguration('Enhanced', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'anonymous-role', powerpagecomponenttype: 11, name: 'Anonymous Users', content: JSON.stringify({ anonymoususersrole: true }) },
        { powerpagecomponentid: 'permission-1', powerpagecomponenttype: 18, name: 'Contact (Global)', content: JSON.stringify({ entityname: 'Contact (Global)', entitylogicalname: 'contact', scope: 756150000, read: true, adx_entitypermission_webrole: ['anonymous-role'] }) },
      ]),
      modernpermissionsjson: JSON.stringify([
        { mspp_entitypermissionid: 'permission-1', mspp_entityname: 'Contact (Global)', mspp_entitylogicalname: 'contact' },
      ]),
    })

    expect(result.anonymousPermissionFindings).toEqual([expect.objectContaining({
      permissionRecordId: 'permission-1',
      permissionRecordEntity: 'mspp_entitypermission',
    })])
  })

  it('uses Enhanced security components for a Modern site when its N:N rows are empty', () => {
    const result = analyzeConfiguration('Modern', {
      enhancedcomponentsjson: JSON.stringify([
        { powerpagecomponentid: 'anonymous-role', powerpagecomponenttype: 11, name: 'Anonymous Users', content: JSON.stringify({ anonymoususersrole: true }) },
        { powerpagecomponentid: 'permission-1', powerpagecomponenttype: 18, name: 'Contact (Global)', content: JSON.stringify({ entityname: 'Contact (Global)', entitylogicalname: 'contact', scope: 756150000, read: true, write: true, adx_entitypermission_webrole: ['anonymous-role'] }) },
      ]),
      modernpermissionsjson: JSON.stringify([{ mspp_entitypermissionid: 'permission-1', mspp_entityname: 'Contact (Global)', mspp_entitylogicalname: 'contact', mspp_scope: 756150000, mspp_read: true }]),
      modernrolesjson: JSON.stringify([{ mspp_webroleid: 'anonymous-role', mspp_name: 'Anonymous Users', mspp_anonymoususersrole: true }]),
      modernpermissionrolesjson: '[]',
    })

    expect(result.anonymousPermissionFindings).toEqual([expect.objectContaining({
      permissionRecordId: 'permission-1',
      permissionRecordEntity: 'mspp_entitypermission',
      table: 'contact',
      roleName: 'Anonymous Users',
      privileges: ['Read', 'Write'],
    })])
  })
})
