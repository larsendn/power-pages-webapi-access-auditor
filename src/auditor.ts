import { findStructuredApiReferences } from './structuredWebApiAnalyzer'

export type Confidence = 'high' | 'medium' | 'blocked'

export interface SourceFile {
  path: string
  content: string
  recordEntity?: string
  recordId?: string
}

export interface SiteSetting {
  name: string
  value: string
  recordId: string
  recordEntity: 'adx_sitesetting' | 'mspp_sitesetting' | 'powerpagecomponent'
  navigationRecordEntity?: 'adx_sitesetting' | 'mspp_sitesetting'
  navigationRecordId?: string
}

export interface FieldEvidence {
  field: string
  source: '$select' | '$filter' | '$orderby' | '$expand' | 'payload' | 'fetchxml'
  file: string
  line: number
  confidence: Exclude<Confidence, 'blocked'>
  recordEntity?: string
  recordId?: string
}

export interface TableFinding {
  table: string
  settingName: string
  settingRecordId: string
  settingRecordEntity: SiteSetting['recordEntity']
  settingNavigationRecordEntity?: SiteSetting['navigationRecordEntity']
  settingNavigationRecordId?: string
  currentValue: string
  proposedFields: string[]
  evidence: FieldEvidence[]
  confidence: Confidence
  blockers: string[]
}

export interface EnvironmentTarget {
  id: string
  name: string
  target: string
  url: string
  sku: string
  type: string
  isProduction: boolean
  isPersonalDeveloper: boolean
  isTrial: boolean
}

interface ApiReference {
  entitySet: string
  file: string
  line: number
  fields: Omit<FieldEvidence, 'file' | 'line'>[]
  hasStaticQuery: boolean
  usesAllAttributes?: boolean
}

const QUERY_KEYS = new Set(['$select', '$filter', '$orderby', '$expand'])
const FILTER_WORDS = new Set([
  'and', 'or', 'not', 'eq', 'ne', 'gt', 'ge', 'lt', 'le', 'in', 'null', 'true', 'false',
  'contains', 'startswith', 'endswith', 'tolower', 'toupper', 'length', 'indexof', 'substring',
  'year', 'month', 'day', 'hour', 'minute', 'second', 'now',
])

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(...values: unknown[]): string {
  return values.find((value) => typeof value === 'string' && value.trim())?.toString().trim() ?? ''
}

function isExcludedEnvironment(row: Record<string, unknown>): boolean {
  const properties = object(row.properties)
  const linkedMetadata = object(properties.linkedEnvironmentMetadata)
  const environmentKind = `${stringValue(properties.environmentSku, row.environmentSku)} ${stringValue(properties.environmentType, row.environmentType)}`
  if (/\bteams\b/i.test(environmentKind)) return true

  const url = stringValue(
    linkedMetadata.instanceUrl,
    linkedMetadata.environmentUrl,
    linkedMetadata.url,
    properties.environmentUrl,
    properties.instanceUrl,
    properties.url,
    row.environmentUrl,
    row.instanceUrl,
    row.url,
  )
  const name = stringValue(properties.displayName, row.displayName, row.name)
  return !url && /\bteams\b/i.test(name)
}

export function parseAccessibleEnvironments(rows: Record<string, unknown>[]): EnvironmentTarget[] {
  return rows.filter((row) => !isExcludedEnvironment(row)).map((row): EnvironmentTarget => {
    const properties = object(row.properties)
    const linkedMetadata = object(properties.linkedEnvironmentMetadata)
    const url = stringValue(
      linkedMetadata.instanceUrl,
      linkedMetadata.environmentUrl,
      linkedMetadata.url,
      properties.environmentUrl,
      properties.instanceUrl,
      properties.url,
      row.environmentUrl,
      row.instanceUrl,
      row.url,
    ).replace(/\/$/, '')
    const sku = stringValue(properties.environmentSku, row.environmentSku)
    const type = stringValue(properties.environmentType, row.environmentType)
    const environmentKind = `${sku} ${type}`
    const name = stringValue(properties.displayName, row.displayName, row.name) || 'Unnamed environment'

    return {
      id: stringValue(row.name, row.id),
      name,
      target: url || stringValue(row.name, row.id),
      url,
      sku,
      type,
      isProduction: /production/i.test(environmentKind),
      isPersonalDeveloper: /\bdeveloper\b/i.test(environmentKind),
      isTrial: /\btrial\b/i.test(environmentKind) || (!url && /\btrial\b/i.test(name)),
    }
  })
    .filter((environment) => environment.id && environment.target)
    .filter((environment, index, all) => all.findIndex((candidate) => candidate.id === environment.id) === index)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function isWebApiFieldSettingName(name: string): boolean {
  return /^Webapi\/[^/]+\/fields$/i.test(name.trim())
}

export function isWildcardValue(value: string): boolean {
  return value.split(',').some((part) => part.trim() === '*')
}

function entitySetCandidates(logicalName: string): string[] {
  const candidates = new Set([logicalName, `${logicalName}s`, `${logicalName}es`])
  if (logicalName.endsWith('y')) candidates.add(`${logicalName.slice(0, -1)}ies`)
  return [...candidates]
}

function identifiers(value: string): string[] {
  return [...value.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)]
    .map((match) => match[0])
    .filter((token) => !FILTER_WORDS.has(token.toLowerCase()) && !token.startsWith('OData'))
}

function fieldsForParameter(key: string, value: string): Omit<FieldEvidence, 'file' | 'line'>[] {
  let decoded: string
  try {
    decoded = decodeURIComponent(value.replaceAll('+', ' '))
  } catch {
    return []
  }
  let fields: string[] = []
  let confidence: 'high' | 'medium' = 'high'

  if (key === '$select') fields = decoded.split(',').map((field) => field.trim())
  if (key === '$filter') fields = identifiers(decoded)
  if (key === '$orderby') fields = decoded.split(',').map((part) => part.trim().split(/\s+/)[0])
  if (key === '$expand') {
    fields = identifiers(decoded)
    confidence = 'medium'
  }

  return fields
    .filter((field) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(field))
    .map((field) => ({ field, source: key as FieldEvidence['source'], confidence }))
}

function parseQuery(rawQuery: string): Omit<FieldEvidence, 'file' | 'line'>[] {
  const fields: Omit<FieldEvidence, 'file' | 'line'>[] = []
  for (const part of rawQuery.replaceAll('&amp;', '&').split('&')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const key = part.slice(0, separator)
    if (QUERY_KEYS.has(key)) fields.push(...fieldsForParameter(key, part.slice(separator + 1)))
  }
  return fields
}

function payloadFields(context: string): Omit<FieldEvidence, 'file' | 'line'>[] {
  const body = context.match(/(?:body|data)\s*:\s*JSON\.stringify\s*\(\s*\{([\s\S]*?)\}\s*\)/)?.[1]
  if (!body) return []
  return [...body.matchAll(/(?:^|[,\n])\s*["']?([A-Za-z_][A-Za-z0-9_]*(?:@odata\.bind)?)["']?\s*:/g)]
    .map((match) => ({ field: match[1].replace(/@odata\.bind$/i, ''), source: 'payload' as const, confidence: 'high' as const }))
}

function fetchXmlReferences(source: string, file: string): ApiReference[] {
  const references: ApiReference[] = []
  const stack: ApiReference[] = []
  const tags = /<\/?(?:entity|link-entity)\b[^>]*>|<(?:attribute|condition|order|all-attributes)\b[^>]*>/gi
  for (const match of source.matchAll(tags)) {
    const tag = match[0]
    const closingEntity = tag.match(/^<\/(?:entity|link-entity)\b/i)
    if (closingEntity) {
      const reference = stack.pop()
      if (reference) references.push(reference)
      continue
    }

    const entity = tag.match(/^<(?:entity|link-entity)\b[^>]*\bname=["']([^"']+)["']/i)
    if (entity) {
      stack.push({
        entitySet: entity[1],
        file,
        line: source.slice(0, match.index).split(/\r?\n/).length,
        fields: [],
        hasStaticQuery: false,
      })
      continue
    }

    const current = stack.at(-1)
    if (!current) continue
    if (/^<all-attributes\b/i.test(tag)) {
      current.usesAllAttributes = true
      current.hasStaticQuery = true
      current.fields.push({ field: '*', source: 'fetchxml', confidence: 'high' })
      continue
    }
    const field = tag.match(/^<attribute\b[^>]*\bname=["']([^"']+)["']/i)?.[1]
      ?? tag.match(/^<(?:condition|order)\b[^>]*\battribute=["']([^"']+)["']/i)?.[1]
    if (field) {
      current.fields.push({ field, source: 'fetchxml', confidence: 'high' })
      current.hasStaticQuery = true
    }
  }
  return references
}

function findApiReferences(files: SourceFile[]): ApiReference[] {
  const references: ApiReference[] = []
  const endpointPattern = /\/_api\/([A-Za-z][A-Za-z0-9_]*)(?:\([^)]*\))?(?:\?([^"'`\s<>]*))?/g

  for (const file of files) {
    const structured = findStructuredApiReferences(file.content).map((reference): ApiReference => ({
      ...reference,
      file: file.path,
    }))
    references.push(...structured)
    const structuredKeys = new Set(structured.map((reference) => `${reference.line}|${reference.entitySet.toLowerCase()}`))
    for (const match of file.content.matchAll(endpointPattern)) {
      const query = match[2] ?? ''
      const payload = payloadFields(file.content.slice(match.index, match.index + 2000))
      const line = file.content.slice(0, match.index).split(/\r?\n/).length
      if (structuredKeys.has(`${line}|${match[1].toLowerCase()}`)) continue
      references.push({
        entitySet: match[1],
        file: file.path,
        line,
        fields: [...parseQuery(query), ...payload],
        hasStaticQuery: (query.length > 0 && !/\$\{|[{}]/.test(query)) || payload.length > 0,
      })
    }
    references.push(...fetchXmlReferences(file.content, file.path))
  }
  return references
}

export function analyzeSite(settings: SiteSetting[], files: SourceFile[]): TableFinding[] {
  const references = findApiReferences(files)
  const unresolvedReferences = references.filter((reference) => !reference.entitySet)
  return settings
    .filter((setting) => isWebApiFieldSettingName(setting.name) && isWildcardValue(setting.value))
    .map((setting) => {
      const table = setting.name.split('/')[1]
      const candidates = entitySetCandidates(table)
      const matches = references.filter((reference) => candidates.includes(reference.entitySet))
      const evidence = matches.flatMap((reference) => reference.fields.map((field) => ({
        ...field,
        file: reference.file,
        line: reference.line,
        recordEntity: files.find((file) => file.path === reference.file)?.recordEntity,
        recordId: files.find((file) => file.path === reference.file)?.recordId,
      })))
      const proposedFields = [...new Set(evidence.map((item) => item.field).filter((field) => field !== '*'))].sort()
      const blockers: string[] = []
      if (matches.length === 0) blockers.push('No static Web API request could be matched to this table.')
      if (matches.some((reference) => !reference.hasStaticQuery)) {
        blockers.push('At least one request has no fully static query; its returned fields cannot be inferred safely.')
      }
      if (matches.some((reference) => reference.usesAllAttributes)) {
        blockers.push('FetchXML uses <all-attributes />. Replace it with explicit <attribute name="..." /> elements, then rescan before removing the wildcard.')
      }
      if (unresolvedReferences.length > 0) blockers.push(`${unresolvedReferences.length} Web API request${unresolvedReferences.length === 1 ? ' uses' : 's use'} a dynamic table name and could not be associated with a field setting.`)
      if (proposedFields.length === 0) blockers.push('No fields were inferred from static OData query options.')

      return {
        table,
        settingName: setting.name,
        settingRecordId: setting.recordId,
        settingRecordEntity: setting.recordEntity,
        settingNavigationRecordEntity: setting.navigationRecordEntity,
        settingNavigationRecordId: setting.navigationRecordId,
        currentValue: setting.value,
        proposedFields,
        evidence,
        confidence: blockers.length > 0 ? 'blocked' : evidence.some((item) => item.confidence === 'medium') ? 'medium' : 'high',
        blockers,
      }
    })
}

export function suggestedFetchXmlAttributes(finding: TableFinding): string {
  const fields = finding.proposedFields.length > 0 ? finding.proposedFields : ['required_column_logical_name']
  return fields.map((field) => `<attribute name="${field}" />`).join('\n')
}