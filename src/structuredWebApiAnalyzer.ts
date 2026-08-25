import { parse } from '@babel/parser'
import { parseFragment } from 'parse5'

export type StructuredEvidenceSource = '$select' | '$filter' | '$orderby' | '$expand' | 'payload'

export interface StructuredApiField {
  field: string
  source: StructuredEvidenceSource
  confidence: 'high' | 'medium'
}

export interface StructuredApiReference {
  entitySet: string
  line: number
  fields: StructuredApiField[]
  hasStaticQuery: boolean
  unresolvedReason?: string
}

interface LooseNode extends Record<string, unknown> {
  type: string
  start?: number
  end?: number
  loc?: { start?: { line?: number } }
}

interface HtmlNode {
  tagName?: string
  value?: string
  childNodes?: HtmlNode[]
  sourceCodeLocation?: { startLine?: number; startTag?: { endLine?: number } }
}

interface SourceUnit {
  content: string
  lineOffset: number
}

interface ResolvedText {
  value: string
  complete: boolean
}

interface ResolvedPayload {
  fields: string[]
  complete: boolean
}

const DYNAMIC = '__PPWFA_DYNAMIC__'
const QUERY_KEYS = new Set(['$select', '$filter', '$orderby', '$expand'])
const FILTER_WORDS = new Set([
  'and', 'or', 'not', 'eq', 'ne', 'gt', 'ge', 'lt', 'le', 'in', 'null', 'true', 'false',
  'contains', 'startswith', 'endswith', 'tolower', 'toupper', 'length', 'indexof', 'substring',
  'year', 'month', 'day', 'hour', 'minute', 'second', 'now',
])

function isNode(value: unknown): value is LooseNode {
  return Boolean(value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string')
}

function childNodes(node: LooseNode): LooseNode[] {
  const children: LooseNode[] = []
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'tokens', 'comments'].includes(key)) continue
    if (isNode(value)) children.push(value)
    else if (Array.isArray(value)) children.push(...value.filter(isNode))
  }
  return children
}

function walk(node: LooseNode, visit: (node: LooseNode) => void) {
  visit(node)
  childNodes(node).forEach((child) => walk(child, visit))
}

function unwrap(node: LooseNode | undefined): LooseNode | undefined {
  let current = node
  while (current && ['TSAsExpression', 'TSTypeAssertion', 'TypeCastExpression', 'ParenthesizedExpression'].includes(current.type)) {
    current = isNode(current.expression) ? current.expression : undefined
  }
  return current
}

function bindingName(node: LooseNode | undefined): string {
  const current = unwrap(node)
  return current?.type === 'Identifier' && typeof current.name === 'string' ? current.name : ''
}

function collectBindings(root: LooseNode): Map<string, LooseNode | null> {
  const bindings = new Map<string, LooseNode | null>()
  const add = (name: string, value: LooseNode | undefined) => {
    if (!name || !value) return
    bindings.set(name, bindings.has(name) ? null : value)
  }
  walk(root, (node) => {
    if (node.type === 'VariableDeclarator') add(bindingName(isNode(node.id) ? node.id : undefined), isNode(node.init) ? node.init : undefined)
    if (node.type === 'AssignmentExpression') add(bindingName(isNode(node.left) ? node.left : undefined), isNode(node.right) ? node.right : undefined)
  })
  return bindings
}

function resolveBinding(node: LooseNode | undefined, bindings: Map<string, LooseNode | null>, seen = new Set<string>()): LooseNode | undefined {
  const current = unwrap(node)
  const name = bindingName(current)
  if (!name) return current
  if (seen.has(name)) return undefined
  const bound = bindings.get(name)
  if (!bound) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(name)
  return resolveBinding(bound, bindings, nextSeen)
}

function resolveText(node: LooseNode | undefined, bindings: Map<string, LooseNode | null>, seen = new Set<string>()): ResolvedText {
  const current = unwrap(node)
  if (!current) return { value: DYNAMIC, complete: false }
  if (current.type === 'StringLiteral' && typeof current.value === 'string') return { value: current.value, complete: true }
  if (current.type === 'NumericLiteral') return { value: String(current.value), complete: true }
  if (current.type === 'Identifier' && typeof current.name === 'string') {
    if (seen.has(current.name)) return { value: DYNAMIC, complete: false }
    const bound = bindings.get(current.name)
    if (!bound) return { value: DYNAMIC, complete: false }
    const nextSeen = new Set(seen)
    nextSeen.add(current.name)
    return resolveText(bound, bindings, nextSeen)
  }
  if (current.type === 'BinaryExpression' && current.operator === '+') {
    const left = resolveText(isNode(current.left) ? current.left : undefined, bindings, seen)
    const right = resolveText(isNode(current.right) ? current.right : undefined, bindings, seen)
    return { value: left.value + right.value, complete: left.complete && right.complete }
  }
  if (current.type === 'TemplateLiteral' && Array.isArray(current.quasis) && Array.isArray(current.expressions)) {
    let value = ''
    let complete = true
    const expressions = current.expressions as unknown[]
    current.quasis.forEach((quasi, index) => {
      const quasiValue = isNode(quasi) && quasi.value && typeof quasi.value === 'object'
        ? quasi.value as Record<string, unknown>
        : {}
      const cooked = quasiValue.cooked
      const raw = quasiValue.raw
      value += typeof cooked === 'string' ? cooked : typeof raw === 'string' ? raw : ''
      const expression = expressions[index]
      if (isNode(expression)) {
        const resolved = resolveText(expression, bindings, seen)
        value += resolved.value
        complete = complete && resolved.complete
      }
    })
    return { value, complete }
  }
  return { value: DYNAMIC, complete: false }
}

function propertyName(property: LooseNode): string {
  if (property.computed === true) return ''
  const key = isNode(property.key) ? property.key : undefined
  if (key?.type === 'Identifier' && typeof key.name === 'string') return key.name
  if (key?.type === 'StringLiteral' && typeof key.value === 'string') return key.value
  return ''
}

function objectNode(node: LooseNode | undefined, bindings: Map<string, LooseNode | null>): LooseNode | undefined {
  const current = resolveBinding(node, bindings)
  return current?.type === 'ObjectExpression' ? current : undefined
}

function objectProperties(node: LooseNode | undefined, bindings: Map<string, LooseNode | null>): { values: Map<string, LooseNode>; complete: boolean } {
  const object = objectNode(node, bindings)
  const values = new Map<string, LooseNode>()
  if (!object || !Array.isArray(object.properties)) return { values, complete: false }
  let complete = true
  for (const item of object.properties) {
    if (!isNode(item)) continue
    if (item.type === 'SpreadElement') {
      const spread = objectProperties(isNode(item.argument) ? item.argument : undefined, bindings)
      spread.values.forEach((value, key) => values.set(key, value))
      complete = complete && spread.complete
      continue
    }
    const name = propertyName(item)
    const value = isNode(item.value) ? item.value : undefined
    if (!name || !value) {
      complete = false
      continue
    }
    values.set(name, value)
  }
  return { values, complete }
}

function optionValue(values: Map<string, LooseNode>, name: string): LooseNode | undefined {
  return [...values.entries()].find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
}

function callName(node: LooseNode | undefined): string {
  const current = unwrap(node)
  if (!current) return ''
  if (current.type === 'Identifier' && typeof current.name === 'string') return current.name
  if (current.type === 'MemberExpression' || current.type === 'OptionalMemberExpression') {
    const object = callName(isNode(current.object) ? current.object : undefined)
    const memberProperty = isNode(current.property) ? current.property : undefined
    const property = current.computed === true
      ? memberProperty?.type === 'StringLiteral' && typeof memberProperty.value === 'string' ? memberProperty.value : ''
      : memberProperty?.type === 'Identifier' && typeof memberProperty.name === 'string' ? memberProperty.name : ''
    return [object, property].filter(Boolean).join('.')
  }
  return ''
}

function unwrapJsonPayload(node: LooseNode | undefined, bindings: Map<string, LooseNode | null>): LooseNode | undefined {
  const current = resolveBinding(node, bindings)
  if (!current) return undefined
  if ((current.type === 'CallExpression' || current.type === 'OptionalCallExpression') && callName(isNode(current.callee) ? current.callee : undefined).toLowerCase() === 'json.stringify') {
    return resolveBinding(Array.isArray(current.arguments) && isNode(current.arguments[0]) ? current.arguments[0] : undefined, bindings)
  }
  return current
}

function payloadFields(node: LooseNode | undefined, bindings: Map<string, LooseNode | null>): ResolvedPayload {
  const payload = unwrapJsonPayload(node, bindings)
  const properties = objectProperties(payload, bindings)
  const fields = [...properties.values.keys()].map((field) => field.replace(/@odata\.bind$/i, ''))
  return { fields, complete: Boolean(payload) && properties.complete }
}

function identifiers(value: string): string[] {
  return [...value.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)]
    .map((match) => match[0])
    .filter((token) => !FILTER_WORDS.has(token.toLowerCase()) && !token.startsWith('OData'))
}

function queryFields(key: string, value: string): StructuredApiField[] {
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
    .map((field) => ({ field, source: key as StructuredEvidenceSource, confidence }))
}

function parseQuery(rawQuery: string): StructuredApiField[] {
  const fields: StructuredApiField[] = []
  for (const part of rawQuery.replaceAll('&amp;', '&').split('&')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const key = part.slice(0, separator)
    if (QUERY_KEYS.has(key)) fields.push(...queryFields(key, part.slice(separator + 1)))
  }
  return fields
}

function scriptUnits(content: string): SourceUnit[] {
  if (!/<script\b/i.test(content)) return [{ content, lineOffset: 0 }]
  try {
    const root = parseFragment(content, { sourceCodeLocationInfo: true }) as unknown as HtmlNode
    const units: SourceUnit[] = []
    const visit = (node: HtmlNode) => {
      if (node.tagName?.toLowerCase() === 'script') {
        const script = (node.childNodes ?? []).map((child) => child.value ?? '').join('')
        if (script.trim()) units.push({ content: script, lineOffset: (node.sourceCodeLocation?.startTag?.endLine ?? node.sourceCodeLocation?.startLine ?? 1) - 1 })
      }
      node.childNodes?.forEach(visit)
    }
    visit(root)
    return units.length > 0 ? units : [{ content, lineOffset: 0 }]
  } catch {
    return [{ content, lineOffset: 0 }]
  }
}

function nodeContainsApiMarker(node: LooseNode | undefined, source: string): boolean {
  if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return false
  return source.slice(node.start, node.end).includes('/_api')
}

function referenceFromRequest(
  urlNode: LooseNode | undefined,
  payloadNode: LooseNode | undefined,
  bindings: Map<string, LooseNode | null>,
  source: string,
  lineOffset: number,
): StructuredApiReference | null {
  const url = resolveText(urlNode, bindings)
  const resolvedUrlNode = resolveBinding(urlNode, bindings) ?? urlNode
  if (!url.value.includes('/_api') && !nodeContainsApiMarker(resolvedUrlNode, source)) return null
  const endpoint = url.value.match(/\/_api\/([A-Za-z][A-Za-z0-9_]*)(?:\([^)]*\))?(?:\?([\s\S]*))?/)
  const line = (resolvedUrlNode?.loc?.start?.line ?? urlNode?.loc?.start?.line ?? 1) + lineOffset
  if (!endpoint) return { entitySet: '', line, fields: [], hasStaticQuery: false, unresolvedReason: 'A Web API request uses a dynamic table name.' }
  const query = endpoint[2] ?? ''
  const queryIsComplete = !query.includes(DYNAMIC)
  const queryEvidence = parseQuery(query.replaceAll(DYNAMIC, ''))
  const payload = payloadFields(payloadNode, bindings)
  const payloadEvidence = payload.fields.map((field) => ({ field, source: 'payload' as const, confidence: 'high' as const }))
  return {
    entitySet: endpoint[1],
    line,
    fields: [...queryEvidence, ...payloadEvidence],
    hasStaticQuery: (Boolean(query) && queryIsComplete && queryEvidence.length > 0) || (payload.complete && payloadEvidence.length > 0),
  }
}

function requestNodes(call: LooseNode, bindings: Map<string, LooseNode | null>): { url?: LooseNode; payload?: LooseNode } | null {
  const name = callName(isNode(call.callee) ? call.callee : undefined).toLowerCase()
  const args = Array.isArray(call.arguments) ? call.arguments.filter(isNode) : []
  if (name === 'fetch') {
    const request = resolveBinding(args[0], bindings)
    if (request?.type === 'NewExpression' && callName(isNode(request.callee) ? request.callee : undefined).toLowerCase() === 'request') {
      const requestArgs = Array.isArray(request.arguments) ? request.arguments.filter(isNode) : []
      const options = objectProperties(requestArgs[1], bindings).values
      return { url: requestArgs[0], payload: optionValue(options, 'body') ?? optionValue(options, 'data') }
    }
    const options = objectProperties(args[1], bindings).values
    return { url: args[0], payload: optionValue(options, 'body') ?? optionValue(options, 'data') }
  }
  if (name === 'axios' || name.endsWith('.request')) {
    const options = objectProperties(args[0], bindings).values
    return { url: optionValue(options, 'url'), payload: optionValue(options, 'data') ?? optionValue(options, 'body') }
  }
  if (/\.(?:ajax|safeajax)$/.test(name) || name === 'ajax' || name === 'safeajax') {
    const options = objectProperties(args[0], bindings).values
    return { url: optionValue(options, 'url'), payload: optionValue(options, 'data') ?? optionValue(options, 'body') }
  }
  if (/(?:^|\.)(?:get|getjson|delete|post|put|patch)$/.test(name)) {
    return { url: args[0], payload: /(?:^|\.)(?:post|put|patch)$/.test(name) ? args[1] : undefined }
  }
  if (name.endsWith('.open')) return { url: args[1] }
  return null
}

function apiMarkerLine(node: LooseNode | undefined, bindings: Map<string, LooseNode | null>, source: string, lineOffset: number): number | null {
  const resolved = resolveBinding(node, bindings) ?? node
  const text = resolveText(node, bindings)
  if (!text.value.includes('/_api') && !nodeContainsApiMarker(resolved, source)) return null
  return (resolved?.loc?.start?.line ?? node?.loc?.start?.line ?? 1) + lineOffset
}

function analyzeUnit(unit: SourceUnit): StructuredApiReference[] {
  let root: LooseNode
  try {
    root = parse(unit.content, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      plugins: ['jsx', 'typescript'],
    }) as unknown as LooseNode
  } catch {
    return []
  }
  const bindings = collectBindings(root)
  const references: StructuredApiReference[] = []
  const calls: LooseNode[] = []
  walk(root, (node) => {
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') calls.push(node)
  })
  const recognizedCalls = new Set<LooseNode>()
  for (const node of calls) {
    const request = requestNodes(node, bindings)
    if (!request) continue
    recognizedCalls.add(node)
    const reference = referenceFromRequest(request.url, request.payload, bindings, unit.content, unit.lineOffset)
    if (reference) references.push(reference)
  }
  const coveredLines = new Set(references.map((reference) => reference.line))
  for (const node of calls) {
    if (recognizedCalls.has(node)) continue
    const args = Array.isArray(node.arguments) ? node.arguments.filter(isNode) : []
    for (const argument of args) {
      const line = apiMarkerLine(argument, bindings, unit.content, unit.lineOffset)
      if (line === null || coveredLines.has(line)) continue
      references.push({ entitySet: '', line, fields: [], hasStaticQuery: false, unresolvedReason: 'A Web API request is passed through an unsupported custom wrapper.' })
      coveredLines.add(line)
    }
  }
  return references
}

export function findStructuredApiReferences(content: string): StructuredApiReference[] {
  return scriptUnits(content).flatMap(analyzeUnit)
}