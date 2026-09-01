import { describe, expect, it } from 'vitest'
import { embeddedFormWebResourceNames, referencedHtmlWebResourceNames } from './formWebResources'

describe('form web resources', () => {
  it('finds embedded control resources without treating model-driven event libraries as portal code', () => {
    const formXml = `
      <form>
        <events><event name="onload"><Handlers><Handler libraryName="new_/form-events.js" /></Handlers></event></events>
        <tabs><tab><columns><column><sections><section><rows><row><cell>
          <control id="WebResource_contact_help">
            <parameters><Url>new_/contact-help.html</Url></parameters>
          </control>
          <control id="WebResource_contact_script"><parameters><Url>$webresource:new_/contact-form.js</Url></parameters></control>
        </cell></row></rows></section></sections></column></columns></tab></tabs>
      </form>`

    expect(embeddedFormWebResourceNames(formXml)).toEqual(['new_/contact-form.js', 'new_/contact-help.html'])
  })

  it('finds scripts referenced by embedded HTML resources', () => {
    const html = `
      <script src="$webresource:new_/contact-api.js"></script>
      <script src="/WebResources/new_/shared-api.js?v=3"></script>`

    expect(referencedHtmlWebResourceNames(html)).toEqual(['new_/contact-api.js', 'new_/shared-api.js'])
  })

  it('returns no references for malformed FormXML', () => {
    expect(embeddedFormWebResourceNames('<form><control>')).toEqual([])
  })
})