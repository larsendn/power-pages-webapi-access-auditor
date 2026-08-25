import { describe, expect, it } from 'vitest'
import { flowErrorMessage } from './errorMessage'
import { normalizeFlowOutput } from './flowOutput'

describe('flow output normalization', () => {
  it('normalizes generated camelCase response keys for runtime consumers', () => {
    expect(normalizeFlowOutput({
      enhancedAndCodeSitesJson: '[{"name":"Enhanced"}]',
      modernSitesJson: '[{"mspp_name":"ED Portal"}]',
      standardSitesJson: '[]',
    })).toEqual({
      enhancedandcodesitesjson: '[{"name":"Enhanced"}]',
      modernsitesjson: '[{"mspp_name":"ED Portal"}]',
      standardsitesjson: '[]',
    })
  })
})

describe('flowErrorMessage', () => {
  it('serializes structured connector errors instead of object coercion', () => {
    expect(flowErrorMessage({ code: 'BadRequest', details: { action: 'List_Modern_Web_Pages' } })).toBe([
      '{',
      '  "code": "BadRequest",',
      '  "details": {',
      '    "action": "List_Modern_Web_Pages"',
      '  }',
      '}',
    ].join('\n'))
  })

  it('prefers a connector message when one is available', () => {
    expect(flowErrorMessage({ message: 'The flow action failed.', code: 'FlowFailed' })).toBe('The flow action failed.')
  })
})