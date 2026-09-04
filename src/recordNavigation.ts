export function physicalRecordUrl(environmentUrl: string, entity?: string, recordId?: string): string {
  const normalizedEntity = entity?.trim().toLowerCase()
  const normalizedUrl = environmentUrl.replace(/\/$/, '')
  if (!normalizedUrl || !normalizedEntity || !recordId || normalizedEntity === 'powerpagecomponent') return ''
  return `${normalizedUrl}/main.aspx?pagetype=entityrecord&etn=${encodeURIComponent(normalizedEntity)}&id=${encodeURIComponent(recordId)}`
}