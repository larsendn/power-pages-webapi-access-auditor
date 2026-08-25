import { describe, expect, it } from 'vitest'
import { findStructuredApiReferences } from './structuredWebApiAnalyzer'

describe('structured Web API analyzer', () => {
  it('associates aliased safeAjax options and spread payloads in HTML', () => {
    const references = findStructuredApiReferences(`<section>Contact</section><script>
      const endpoint = '/_api/contacts(' + contactId + ')'
      const identity = { FirstName: firstName }
      const payload = { ...identity, 'parentcustomerid_account@odata.bind': '/accounts(' + accountId + ')' }
      const options = { type: 'PATCH', url: endpoint, data: JSON.stringify(payload) }
      webapi.safeAjax(options)
    </script>`)

    expect(references).toEqual([expect.objectContaining({
      entitySet: 'contacts',
      fields: [
        { field: 'FirstName', source: 'payload', confidence: 'high' },
        { field: 'parentcustomerid_account', source: 'payload', confidence: 'high' },
      ],
      hasStaticQuery: true,
    })])
  })

  it('associates axios calls with aliased template URLs and payloads', () => {
    const references = findStructuredApiReferences(`
      const endpoint = \`/_api/contacts(\${contactId})\`
      const update = { lastname: nextName }
      axios.patch(endpoint, update)
    `)

    expect(references).toEqual([expect.objectContaining({
      entitySet: 'contacts',
      fields: [{ field: 'lastname', source: 'payload', confidence: 'high' }],
      hasStaticQuery: true,
    })])
  })

  it('reports a dynamic table name as unresolved', () => {
    const references = findStructuredApiReferences("const endpoint = '/_api/' + tableName + '?$select=firstname'; fetch(endpoint)")

    expect(references).toEqual([expect.objectContaining({
      entitySet: '',
      hasStaticQuery: false,
      unresolvedReason: 'A Web API request uses a dynamic table name.',
    })])
  })

  it('reports unsupported helper-based URL construction as unresolved', () => {
    const references = findStructuredApiReferences("const endpoint = ['/_api', tableName].join('/'); fetch(endpoint)")

    expect(references).toEqual([expect.objectContaining({
      entitySet: '',
      hasStaticQuery: false,
      unresolvedReason: 'A Web API request uses a dynamic table name.',
    })])
  })

  it('reports API URLs passed through unknown custom wrappers', () => {
    const references = findStructuredApiReferences(`
      const endpoint = '/_api/contacts'
      const payload = { firstname: nextName }
      customPortalApi(endpoint, payload)
    `)

    expect(references).toEqual([expect.objectContaining({
      entitySet: '',
      hasStaticQuery: false,
      unresolvedReason: 'A Web API request is passed through an unsupported custom wrapper.',
    })])
  })

  it('does not duplicate a URL used by diagnostic and recognized calls', () => {
    const references = findStructuredApiReferences(`
      const endpoint = '/_api/contacts?$select=firstname'
      console.debug(endpoint)
      fetch(endpoint)
    `)

    expect(references).toHaveLength(1)
    expect(references[0]).toEqual(expect.objectContaining({ entitySet: 'contacts', hasStaticQuery: true }))
  })
})