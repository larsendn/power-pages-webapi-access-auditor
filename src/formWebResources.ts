import { XMLParser } from 'fast-xml-parser'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: false,
})

const webResourceToken = /\$webresource:([^\s"'<>]+)/gi
const webResourcePath = /(?:^|\/)WebResources\/([^?#"'<>]+)/i
const resourceExtension = /\.(?:html?|js)$/i

function addTokens(value: string, names: Set<string>) {
  for (const match of value.matchAll(webResourceToken)) {
    const name = match[1]?.trim()
    if (name) names.add(name)
  }
}

function visitXml(value: unknown, insideControl: boolean, names: Set<string>) {
  if (typeof value === 'string') {
    if (insideControl) {
      addTokens(value, names)
      const candidate = value.trim().replace(/^\/?WebResources\//i, '').split(/[?#]/, 1)[0]
      if (!candidate.toLowerCase().startsWith('$webresource:') && resourceExtension.test(candidate)) names.add(candidate)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => visitXml(item, insideControl, names))
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    visitXml(child, insideControl || key.toLowerCase() === 'control', names)
  }
}

export function embeddedFormWebResourceNames(formXml: string): string[] {
  if (!formXml.trim()) return []
  try {
    const names = new Set<string>()
    visitXml(xmlParser.parse(formXml), false, names)
    return [...names].sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

function visitHtml(node: DefaultTreeAdapterMap['node'], names: Set<string>) {
  if ('attrs' in node) {
    for (const attribute of node.attrs) {
      if (!['src', 'href'].includes(attribute.name.toLowerCase())) continue
      addTokens(attribute.value, names)
      const pathMatch = attribute.value.match(webResourcePath)
      if (pathMatch?.[1]) {
        try {
          names.add(decodeURIComponent(pathMatch[1]))
        } catch {
          names.add(pathMatch[1])
        }
      }
    }
  }
  if ('childNodes' in node) node.childNodes.forEach((child) => visitHtml(child, names))
}

export function referencedHtmlWebResourceNames(html: string): string[] {
  const names = new Set<string>()
  visitHtml(parseFragment(html), names)
  return [...names].sort((left, right) => left.localeCompare(right))
}