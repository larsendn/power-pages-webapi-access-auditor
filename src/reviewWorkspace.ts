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

interface RestorableFinding {
  key: string
  settingRecordId: string
  currentValue: string
  applyStatus?: 'applied' | 'verified' | 'failed'
  applyMessage?: string
}

export function restoreUndoneFinding<T extends RestorableFinding>(
  findings: T[],
  updatedFindings: T[],
  settingRecordId: string,
  restoredValue: string,
): { findings: T[]; updatedFindings: T[]; restoredFinding?: T } {
  const updatedFinding = updatedFindings.find((finding) => finding.settingRecordId === settingRecordId)
  if (!updatedFinding) return { findings, updatedFindings }
  const restoredFinding = {
    ...updatedFinding,
    currentValue: restoredValue,
    applyStatus: undefined,
    applyMessage: undefined,
  } as T
  return {
    findings: [...findings.filter((finding) => finding.key !== restoredFinding.key), restoredFinding],
    updatedFindings: updatedFindings.filter((finding) => finding.key !== restoredFinding.key),
    restoredFinding,
  }
}