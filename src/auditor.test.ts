import { describe, expect, it } from 'vitest'
import { analyzeSite, isWebApiFieldSettingName, isWildcardValue, parseAccessibleEnvironments, suggestedFetchXmlAttributes, type SiteSetting } from './auditor'

const wildcardSetting: SiteSetting = {
  name: 'Webapi/contact/fields',
  value: '*',
  recordId: 'setting-1',
  recordEntity: 'adx_sitesetting',
}

describe('site setting scope', () => {
  it('accepts only the exact Web API fields setting shape', () => {
    expect(isWebApiFieldSettingName('Webapi/contact/fields')).toBe(true)
    expect(isWebApiFieldSettingName('webapi/contact/FIELDS')).toBe(true)
    expect(isWebApiFieldSettingName('Webapi/contact/enabled')).toBe(false)
    expect(isWebApiFieldSettingName('Webapi/contact/fields/extra')).toBe(false)
  })

  it('recognizes a wildcard token without treating text as a wildcard', () => {
    expect(isWildcardValue('*')).toBe(true)
    expect(isWildcardValue('firstname, *, lastname')).toBe(true)
    expect(isWildcardValue('firstname,lastname')).toBe(false)
  })
})

describe('environment discovery', () => {
  it('normalizes accessible Dataverse environments and classifies production', () => {
    expect(parseAccessibleEnvironments([
      {
        name: 'environment-1',
        properties: {
          displayName: 'Production Portal',
          environmentSku: 'Production',
          linkedEnvironmentMetadata: { instanceUrl: 'https://prod.crm.dynamics.com/' },
        },
      },
      {
        name: 'environment-2',
        properties: {
          displayName: 'Portal Sandbox',
          environmentType: 'Sandbox',
          environmentUrl: 'https://sandbox.crm.dynamics.com',
        },
      },
      {
        name: 'environment-3',
        properties: {
          displayName: 'Daniel personal environment',
          environmentSku: 'Developer',
          environmentType: 'Developer',
          environmentUrl: 'https://developer.crm.dynamics.com',
        },
      },
    ])).toEqual([
      {
        id: 'environment-3',
        name: 'Daniel personal environment',
        target: 'https://developer.crm.dynamics.com',
        url: 'https://developer.crm.dynamics.com',
        sku: 'Developer',
        type: 'Developer',
        isProduction: false,
        isPersonalDeveloper: true,
        isTrial: false,
      },
      {
        id: 'environment-2',
        name: 'Portal Sandbox',
        target: 'https://sandbox.crm.dynamics.com',
        url: 'https://sandbox.crm.dynamics.com',
        sku: '',
        type: 'Sandbox',
        isProduction: false,
        isPersonalDeveloper: false,
        isTrial: false,
      },
      {
        id: 'environment-1',
        name: 'Production Portal',
        target: 'https://prod.crm.dynamics.com',
        url: 'https://prod.crm.dynamics.com',
        sku: 'Production',
        type: '',
        isProduction: true,
        isPersonalDeveloper: false,
        isTrial: false,
      },
    ])
  })

  it('filters Teams environments and classifies trial environments for optional hiding', () => {
    const parsed = parseAccessibleEnvironments([
      { name: 'environment-without-dataverse', properties: { displayName: 'Teams only' } },
      { name: 'explicit-teams', properties: { displayName: 'Collaboration', environmentSku: 'Teams' } },
      { name: 'trial-without-dataverse', properties: { displayName: 'Trial only' } },
      { name: 'explicit-trial', properties: { displayName: 'Evaluation', environmentType: 'Trial' } },
      { name: 'dataverse-teams-project', properties: { displayName: 'Teams Project', environmentType: 'Sandbox', environmentUrl: 'https://teams-project.crm.dynamics.com' } },
      { name: 'dataverse-trial-project', properties: { displayName: 'Trial Migration', environmentType: 'Sandbox', environmentUrl: 'https://trial-project.crm.dynamics.com' } },
    ])

    expect(parsed.map((environment) => environment.id)).toEqual([
      'explicit-trial',
      'dataverse-teams-project',
      'dataverse-trial-project',
      'trial-without-dataverse',
    ])
    expect(parsed.filter((environment) => environment.isTrial).map((environment) => environment.id)).toEqual([
      'explicit-trial',
      'trial-without-dataverse',
    ])
  })
})

describe('browser analyzer', () => {
  it('infers static OData and payload fields for a wildcard setting', () => {
    const findings = analyzeSite([wildcardSetting], [{
      path: 'web-pages/contacts.js',
      content: `
        fetch('/_api/contacts?$select=firstname,lastname&$filter=statecode eq 0', {
          method: 'PATCH',
          body: JSON.stringify({ emailaddress1: email })
        })
      `,
    }])

    expect(findings).toHaveLength(1)
    expect(findings[0].confidence).toBe('high')
    expect(findings[0].proposedFields).toEqual(['emailaddress1', 'firstname', 'lastname', 'statecode'])
    expect(findings[0].blockers).toEqual([])
  })

  it('blocks a matching request whose returned fields are dynamic', () => {
    const findings = analyzeSite([wildcardSetting], [{
      path: 'web-pages/contacts.js',
      content: "fetch(`/_api/contacts?${query}`)",
    }])

    expect(findings).toHaveLength(1)
    expect(findings[0].confidence).toBe('blocked')
    expect(findings[0].blockers).toContain('At least one request has no fully static query; its returned fields cannot be inferred safely.')
  })

  it('resolves aliased URLs, options, payloads, spreads, and HTML script blocks', () => {
    const findings = analyzeSite([wildcardSetting], [{
      path: 'web-pages/contact/adx_copy',
      content: `<section>Contact</section><script>
        const endpoint = '/_api/contacts(' + contactId + ')'
        const identity = { FirstName: firstName }
        const payload = { ...identity, 'parentcustomerid_account@odata.bind': '/accounts(' + accountId + ')' }
        const options = { type: 'PATCH', url: endpoint, data: JSON.stringify(payload) }
        webapi.safeAjax(options)
      </script>`,
    }])

    expect(findings[0].confidence).toBe('high')
    expect(findings[0].proposedFields).toEqual(['FirstName', 'parentcustomerid_account'])
    expect(findings[0].blockers).toEqual([])
  })

  it('resolves axios payload aliases', () => {
    const findings = analyzeSite([wildcardSetting], [{
      path: 'web-files/contacts.ts',
      content: `
        const endpoint = \`/_api/contacts(\${contactId})\`
        const update = { lastname: nextName }
        axios.patch(endpoint, update)
      `,
    }])

    expect(findings[0].confidence).toBe('high')
    expect(findings[0].proposedFields).toEqual(['lastname'])
  })

  it('blocks FetchXML all-attributes and keeps nested entity fields scoped to their tables', () => {
    const findings = analyzeSite([
      wildcardSetting,
      { ...wildcardSetting, name: 'Webapi/account/fields', recordId: 'setting-2' },
    ], [{
      path: 'web-pages/attendance.js',
      content: `
        const fetchXml = '<fetch>' +
          '<entity name="contact">' +
            '<all-attributes />' +
            '<filter><condition attribute="statecode" operator="eq" value="0" /></filter>' +
            '<link-entity name="account" from="accountid" to="parentcustomerid" alias="account">' +
              '<attribute name="name" />' +
            '</link-entity>' +
          '</entity>' +
        '</fetch>'
      `,
    }])

    expect(findings[0].confidence).toBe('blocked')
    expect(findings[0].proposedFields).toEqual(['statecode'])
    expect(findings[0].blockers.join(' ')).toContain('FetchXML uses <all-attributes />')
    expect(findings[0].evidence).toEqual(expect.arrayContaining([expect.objectContaining({ field: '*', source: 'fetchxml' })]))
    expect(suggestedFetchXmlAttributes(findings[0])).toBe('<attribute name="statecode" />')
    expect(findings[1].confidence).toBe('high')
    expect(findings[1].proposedFields).toEqual(['name'])
  })

  it('uses an explicit placeholder when no safe FetchXML attributes can be inferred', () => {
    const findings = analyzeSite([wildcardSetting], [{
      path: 'web-pages/contacts.js',
      content: '<fetch><entity name="contact"><all-attributes /></entity></fetch>',
    }])

    expect(suggestedFetchXmlAttributes(findings[0])).toBe('<attribute name="required_column_logical_name" />')
  })

  it('blocks every proposal when a dynamic Web API table cannot be associated', () => {
    const findings = analyzeSite([wildcardSetting], [{
      path: 'web-files/dynamic.js',
      content: "const endpoint = '/_api/' + tableName + '?$select=firstname'; fetch(endpoint)",
    }])

    expect(findings[0].confidence).toBe('blocked')
    expect(findings[0].blockers).toContain('1 Web API request uses a dynamic table name and could not be associated with a field setting.')
  })

  it('ignores non-field and non-wildcard settings', () => {
    const findings = analyzeSite([
      { ...wildcardSetting, name: 'Webapi/contact/enabled', value: 'true' },
      { ...wildcardSetting, value: 'firstname,lastname' },
    ], [{ path: 'contacts.js', content: "fetch('/_api/contacts?$select=firstname')" }])

    expect(findings).toEqual([])
  })
})