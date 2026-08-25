import type { SiteModel } from './siteConfiguration'

export interface ChangeHistoryRecord {
  id: string
  changedAt: string
  environmentId: string
  environmentName: string
  targetEnvironment: string
  siteId: string
  siteName: string
  model: SiteModel
  settingId: string
  settingName: string
  previousValue: string
  appliedValue: string
  status: 'Applied' | 'Undone'
  undoneAt: string
}

const HEADERS: (keyof ChangeHistoryRecord)[] = [
  'id', 'changedAt', 'environmentId', 'environmentName', 'targetEnvironment',
  'siteId', 'siteName', 'model', 'settingId', 'settingName', 'previousValue', 'appliedValue',
  'status', 'undoneAt',
]

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function parseRows(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    if (quoted && character === '"' && csv[index + 1] === '"') {
      field += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && csv[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }
  if (quoted) throw new Error('The CSV contains an unterminated quoted value.')
  row.push(field)
  if (row.some((value) => value.length > 0)) rows.push(row)
  return rows
}

function isRecord(record: Partial<ChangeHistoryRecord>): record is ChangeHistoryRecord {
  const required = HEADERS.filter((header) => header !== 'undoneAt')
  return required.every((header) => typeof record[header] === 'string' && record[header]!.length > 0)
    && ['Standard', 'Enhanced', 'Modern'].includes(record.model ?? '')
    && ['Applied', 'Undone'].includes(record.status ?? '')
    && (record.status !== 'Undone' || Boolean(record.undoneAt))
    && /^Webapi\/[^/]+\/fields$/i.test(record.settingName ?? '')
    && (record.previousValue ?? '').split(',').map((value) => value.trim()).includes('*')
    && !(record.appliedValue ?? '').split(',').map((value) => value.trim()).includes('*')
}

export function changeHistoryToCsv(records: ChangeHistoryRecord[]): string {
  return [HEADERS.map(quote), ...records.map((record) => HEADERS.map((header) => quote(record[header])))]
    .map((row) => row.join(','))
    .join('\r\n')
}

export function parseChangeHistoryCsv(csv: string): ChangeHistoryRecord[] {
  const rows = parseRows(csv.replace(/^\uFEFF/, ''))
  if (rows.length === 0) throw new Error('The CSV is empty.')
  const headers = rows[0]
  if (HEADERS.some((header) => !headers.includes(header))) throw new Error('The CSV is not a Power Pages auditor undo file.')
  return rows.slice(1).map((values, rowIndex) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])) as Partial<ChangeHistoryRecord>
    if (!isRecord(record)) throw new Error(`Undo CSV row ${rowIndex + 2} is incomplete or unsafe.`)
    return { ...record, undoneAt: record.undoneAt ?? '' }
  })
}

export function mergeChangeHistory(current: ChangeHistoryRecord[], imported: ChangeHistoryRecord[]): ChangeHistoryRecord[] {
  return [...imported, ...current].filter((record, index, all) => all.findIndex((candidate) => candidate.id === record.id) === index)
}