const LOGICAL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export function normalizeExplicitFields(value: string): string {
  const fields = value.split(',').map((field) => field.trim()).filter(Boolean)
  if (fields.length === 0 || fields.some((field) => !LOGICAL_NAME.test(field))) return ''
  return [...new Set(fields)].sort().join(',')
}

export function minimumExplicitFields(tableLogicalName: string): string {
  const logicalName = tableLogicalName.trim()
  return LOGICAL_NAME.test(logicalName) ? `${logicalName}id` : ''
}