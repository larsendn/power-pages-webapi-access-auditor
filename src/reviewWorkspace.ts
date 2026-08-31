export function withoutNestedSiteAnalysis<T extends { site: { analysis?: unknown } }>(entries: T[]): T[] {
  return entries.map((entry) => {
    const site = { ...entry.site }
    delete site.analysis
    return { ...entry, site } as T
  })
}

export function withoutComponentEvidenceLinks<T extends { evidence: Array<{ recordEntity?: string; recordId?: string }> }>(entries: T[]): T[] {
  return entries.map((entry) => ({
    ...entry,
    evidence: entry.evidence.map((item) => item.recordEntity === 'powerpagecomponent'
      ? { ...item, recordEntity: undefined, recordId: undefined }
      : item),
  }))
}

export function wildcardFindingKey(environmentId: string, siteId: string, model: string, settingName: string, settingRecordId: string): string {
  return `${environmentId}|${siteId}|${model.toLowerCase()}|${settingName.toLowerCase()}|${settingRecordId.toLowerCase()}`
}