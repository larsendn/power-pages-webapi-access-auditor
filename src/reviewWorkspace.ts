export function withoutNestedSiteAnalysis<T extends { site: { analysis?: unknown } }>(entries: T[]): T[] {
  return entries.map((entry) => {
    const site = { ...entry.site }
    delete site.analysis
    return { ...entry, site } as T
  })
}

export function wildcardFindingKey(environmentId: string, siteId: string, model: string, settingName: string, settingRecordId: string): string {
  return `${environmentId}|${siteId}|${model.toLowerCase()}|${settingName.toLowerCase()}|${settingRecordId.toLowerCase()}`
}