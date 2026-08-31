import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge, Button, Checkbox, FluentProvider, Input, MessageBar, MessageBarBody,
  ProgressBar, Spinner, Switch, Textarea, webLightTheme,
} from '@fluentui/react-components'
import {
  ArrowDownloadRegular, ArrowLeftRegular, ArrowSyncRegular, ArrowUndoRegular, ArrowUploadRegular,
  CheckmarkCircleRegular, ChevronDownRegular, ChevronRightRegular, DatabaseSearchRegular, OpenRegular, SearchRegular, ShieldLockRegular, StopRegular, WarningRegular,
} from '@fluentui/react-icons'
import { parseAccessibleEnvironments, type EnvironmentTarget, type TableFinding } from './auditor'
import { changeHistoryToCsv, mergeChangeHistory, parseChangeHistoryCsv, type ChangeHistoryRecord } from './changeHistory'
import { flowErrorMessage } from './errorMessage'
import { flowGateway } from './flowGateway'
import { minimumExplicitFields, normalizeExplicitFields } from './approval'
import { claimUniqueSites, getSiteDiscoveryDiagnostics, hasPowerPagesSites, isActiveSiteRecord, matchesEnvironmentList, parseEnvironmentList, siteDiscoveryFailure } from './environmentFilters'
import { runBoundedPool, withTransientRetry } from './detectionScheduler'
import { debugLogger } from './debugLogger'
import { wildcardFindingKey, withoutNestedSiteAnalysis } from './reviewWorkspace'
import { analyzeConfiguration, isCodeWebFile, parseRows, type AnonymousPermissionFinding, type RetrievedCodeFile, type SiteAnalysis, type SiteConfigurationPayload, type SiteModel } from './siteConfiguration'
import powerPagesLogo from './assets/power-pages-logo.png'
import './App.css'

const powerPagesTheme = {
  ...webLightTheme,
  colorBrandBackground: '#5c2d91',
  colorBrandBackgroundHover: '#4b2577',
  colorBrandBackgroundPressed: '#3b1d5f',
  colorBrandForeground1: '#5c2d91',
  colorBrandStroke1: '#5c2d91',
}
type Stage = 'environments' | 'scanning' | 'review' | 'undo'
type ReviewView = 'wildcards' | 'updated' | 'anonymous'
type PowerPagesPresence = 'present' | 'absent' | 'failed'
type DetectionConcurrency = 3 | 6 | 9

const DETECTION_PROFILES: { value: DetectionConcurrency; label: string }[] = [
  { value: 3, label: 'Conservative' },
  { value: 6, label: 'Balanced' },
  { value: 9, label: 'Fast' },
]
const CHANGE_HISTORY_KEY = 'ppwfaChangeHistoryV1'
const REVIEW_WORKSPACE_KEY = 'ppwfaReviewWorkspaceV1'

function loadChangeHistory(): ChangeHistoryRecord[] {
  try {
    const stored = localStorage.getItem(CHANGE_HISTORY_KEY)
    return stored ? JSON.parse(stored) as ChangeHistoryRecord[] : []
  } catch {
    return []
  }
}

function loadReviewWorkspace(): SavedReviewWorkspace | null {
  try {
    const stored = localStorage.getItem(REVIEW_WORKSPACE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored) as Partial<SavedReviewWorkspace>
    if (parsed.version !== 1 || !Array.isArray(parsed.findings) || !Array.isArray(parsed.updatedFindings) || !Array.isArray(parsed.anonymousFindings)) return null
    return parsed as SavedReviewWorkspace
  } catch {
    return null
  }
}

function saveReviewWorkspace(workspace: SavedReviewWorkspace): boolean {
  try {
    localStorage.setItem(REVIEW_WORKSPACE_KEY, JSON.stringify(workspace))
    return true
  } catch (error) {
    debugLogger.error('review.workspace.save-failed', { message: errorMessage(error) })
    return false
  }
}

function clearReviewWorkspace() {
  localStorage.removeItem(REVIEW_WORKSPACE_KEY)
}

function downloadText(content: string, fileName: string) {
  const href = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(href)
}

interface PowerPagesSite {
  id: string
  name: string
  url: string
  model: SiteModel
  environment: EnvironmentTarget
  active: boolean
  analysis?: SiteAnalysis
  error?: string
}

interface FindingEntry extends TableFinding {
  key: string
  site: PowerPagesSite
  proposedValue: string
  applyStatus?: 'applied' | 'verified' | 'failed'
  applyMessage?: string
}

interface AnonymousFindingEntry extends AnonymousPermissionFinding {
  key: string
  site: PowerPagesSite
}

interface WildcardSiteGroup {
  key: string
  site: PowerPagesSite
  findings: FindingEntry[]
}

interface AnonymousSiteGroup {
  key: string
  site: PowerPagesSite
  findings: AnonymousFindingEntry[]
}

interface SavedReviewWorkspace {
  version: 1
  savedAt: string
  sites: PowerPagesSite[]
  findings: FindingEntry[]
  updatedFindings: FindingEntry[]
  anonymousFindings: AnonymousFindingEntry[]
  approvedKeys: string[]
  manualValues: Record<string, string>
  reviewView: ReviewView
  selectedFindingKey: string
  selectedUpdatedFindingKey: string
  selectedAnonymousFindingKey: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function errorMessage(error: unknown): string {
  return flowErrorMessage(error)
}

function recordUrl(site: PowerPagesSite, entity: string, recordId: string): string {
  const environmentUrl = site.environment.url.replace(/\/$/, '')
  if (!environmentUrl) return ''
  return `${environmentUrl}/main.aspx?pagetype=entityrecord&etn=${encodeURIComponent(entity)}&id=${encodeURIComponent(recordId)}`
}

function decodeBase64(value: string): string {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

async function retrieveCodeFiles(environment: EnvironmentTarget, model: SiteModel, configuration: SiteConfigurationPayload): Promise<RetrievedCodeFile[]> {
  const metadata = model === 'Enhanced'
    ? parseRows(configuration.enhancedcomponentsjson)
      .filter((row) => Number(row.powerpagecomponenttype) === 3)
      .map((row) => ({ id: text(row.powerpagecomponentid), name: text(row.name) }))
    : model === 'Standard'
      ? parseRows(configuration.standardwebfilesjson)
      .map((row) => ({ id: text(row.adx_webfileid), name: text(row.adx_partialurl) || text(row.adx_name) }))
      : parseRows(configuration.modernwebfilesjson)
        .map((row) => ({ id: text(row.mspp_webfileid), name: text(row.mspp_partialurl) || text(row.mspp_name) }))
  const files: RetrievedCodeFile[] = []
  for (const file of metadata.filter((item) => item.id && isCodeWebFile(item.name))) {
    const response = await flowGateway.retrieveCodeFile(environment.target, model, file.id, file.name)
    const records = parseRows(response.filesjson)
    const record = records.find((item) => text(item.documentbody))
    if (record) files.push({ id: file.id, name: text(record.filename) || file.name, content: decodeBase64(text(record.documentbody)) })
  }
  return files
}

async function withTimeout<T>(operation: Promise<T>, message: string, milliseconds = 45_000): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), milliseconds)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function App() {
  const restoredWorkspace = useMemo(() => loadReviewWorkspace(), [])
  const [stage, setStage] = useState<Stage>(restoredWorkspace ? 'review' : 'environments')
  const [environments, setEnvironments] = useState<EnvironmentTarget[]>([])
  const [selectedEnvironmentIds, setSelectedEnvironmentIds] = useState<Set<string>>(new Set())
  const [includeNonProduction, setIncludeNonProduction] = useState(true)
  const [includeProduction, setIncludeProduction] = useState(false)
  const [hidePersonalDeveloper, setHidePersonalDeveloper] = useState(true)
  const [environmentFilter, setEnvironmentFilter] = useState('')
  const [pasteListEnabled, setPasteListEnabled] = useState(false)
  const [bulkEnvironmentList, setBulkEnvironmentList] = useState('')
  const [bulkFilterEnabled, setBulkFilterEnabled] = useState(false)
  const [powerPagesPresence, setPowerPagesPresence] = useState<Record<string, PowerPagesPresence>>({})
  const [showOnlyPowerPages, setShowOnlyPowerPages] = useState(false)
  const [auditAnonymousAccess, setAuditAnonymousAccess] = useState(true)
  const [ignoreInactiveSites, setIgnoreInactiveSites] = useState(true)
  const [detectingPowerPages, setDetectingPowerPages] = useState(false)
  const [stoppingDetection, setStoppingDetection] = useState(false)
  const [detectionConcurrency, setDetectionConcurrency] = useState<DetectionConcurrency>(6)
  const [detectionProgress, setDetectionProgress] = useState({ current: 0, total: 0, retries: 0 })
  const [sites, setSites] = useState<PowerPagesSite[]>(restoredWorkspace?.sites ?? [])
  const [findings, setFindings] = useState<FindingEntry[]>(restoredWorkspace?.findings ?? [])
  const [updatedFindings, setUpdatedFindings] = useState<FindingEntry[]>(restoredWorkspace?.updatedFindings ?? [])
  const [anonymousFindings, setAnonymousFindings] = useState<AnonymousFindingEntry[]>(restoredWorkspace?.anonymousFindings ?? [])
  const [reviewView, setReviewView] = useState<ReviewView>(restoredWorkspace?.reviewView ?? 'wildcards')
  const [collapsedSiteGroups, setCollapsedSiteGroups] = useState<Set<string>>(new Set())
  const [approved, setApproved] = useState<Set<string>>(new Set(restoredWorkspace?.approvedKeys ?? []))
  const [manualValues, setManualValues] = useState<Record<string, string>>(restoredWorkspace?.manualValues ?? {})
  const [selectedFindingKey, setSelectedFindingKey] = useState(restoredWorkspace?.selectedFindingKey ?? '')
  const [discovering, setDiscovering] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [stoppingScan, setStoppingScan] = useState(false)
  const [applying, setApplying] = useState(false)
  const [debugLines, setDebugLines] = useState<string[]>([])
  const [showDebugLogs, setShowDebugLogs] = useState(false)
  const [changeHistory, setChangeHistory] = useState<ChangeHistoryRecord[]>(loadChangeHistory)
  const [undoingChangeId, setUndoingChangeId] = useState('')
  const [undoMessages, setUndoMessages] = useState<Record<string, string>>({})
  const detectionRun = useRef<{ cancelled: boolean } | null>(null)
  const scanRun = useRef<{ cancelled: boolean } | null>(null)
  const reviewPersistenceDisabled = useRef(false)
  const undoFileInput = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState({ current: 0, total: 0, message: '' })
  const [notice, setNotice] = useState<{ intent: 'info' | 'success' | 'warning' | 'error'; text: string }>({
    intent: restoredWorkspace ? 'success' : 'info',
    text: restoredWorkspace
      ? `Restored saved review progress from ${new Date(restoredWorkspace.savedAt).toLocaleString()}.`
      : 'Discover the environments available to the connection identity. Production is excluded by default.',
  })

  const debugFailureCount = useMemo(() => debugLines.filter((line) => line.includes(' [ERROR] ')).length, [debugLines])
  const bulkEntries = useMemo(() => parseEnvironmentList(bulkEnvironmentList), [bulkEnvironmentList])
  const scopedEnvironments = useMemo(() => {
    const query = environmentFilter.trim().toLowerCase()
    return environments.filter((environment) => {
      const includedType = environment.isProduction ? includeProduction : includeNonProduction
      const searchable = `${environment.name} ${environment.url} ${environment.sku} ${environment.type}`.toLowerCase()
      return includedType && (!hidePersonalDeveloper || !environment.isPersonalDeveloper) && (!query || searchable.includes(query))
    })
  }, [environmentFilter, environments, hidePersonalDeveloper, includeNonProduction, includeProduction])
  const bulkMatches = useMemo(
    () => scopedEnvironments.filter((environment) => matchesEnvironmentList(environment, bulkEntries)),
    [bulkEntries, scopedEnvironments],
  )
  const environmentCandidates = pasteListEnabled && bulkFilterEnabled && bulkEntries.length > 0 ? bulkMatches : scopedEnvironments
  const visibleEnvironments = useMemo(
    () => environmentCandidates.filter((environment) => !showOnlyPowerPages || powerPagesPresence[environment.id] === 'present'),
    [environmentCandidates, powerPagesPresence, showOnlyPowerPages],
  )
  const hiddenPersonalDeveloperCount = environments.filter((environment) => environment.isPersonalDeveloper).length
  const detectedPowerPagesCount = environmentCandidates.filter((environment) => powerPagesPresence[environment.id] === 'present').length
  const detectedEnvironmentCount = environmentCandidates.filter((environment) => powerPagesPresence[environment.id]).length
  const environmentsNeedingDetection = environmentCandidates.filter((environment) => !powerPagesPresence[environment.id] || powerPagesPresence[environment.id] === 'failed')
  const allVisibleSelected = visibleEnvironments.length > 0 && visibleEnvironments.every((environment) => selectedEnvironmentIds.has(environment.id))
  const selectedFinding = findings.find((finding) => finding.key === selectedFindingKey)
  const [selectedUpdatedFindingKey, setSelectedUpdatedFindingKey] = useState(restoredWorkspace?.selectedUpdatedFindingKey ?? '')
  const selectedUpdatedFinding = updatedFindings.find((finding) => finding.key === selectedUpdatedFindingKey)
  const [selectedAnonymousFindingKey, setSelectedAnonymousFindingKey] = useState(restoredWorkspace?.selectedAnonymousFindingKey ?? '')
  const selectedAnonymousFinding = anonymousFindings.find((finding) => finding.key === selectedAnonymousFindingKey)
  const wildcardSiteGroups = useMemo(() => {
    const groups = new Map<string, WildcardSiteGroup>()
    for (const finding of findings) {
      const key = `${finding.site.environment.id}|${finding.site.id}|${finding.site.model}`
      const group = groups.get(key)
      if (group) group.findings.push(finding)
      else groups.set(key, { key, site: finding.site, findings: [finding] })
    }
    return [...groups.values()]
  }, [findings])
  const anonymousSiteGroups = useMemo(() => {
    const groups = new Map<string, AnonymousSiteGroup>()
    for (const finding of anonymousFindings) {
      const key = `${finding.site.environment.id}|${finding.site.id}|${finding.site.model}`
      const group = groups.get(key)
      if (group) group.findings.push(finding)
      else groups.set(key, { key, site: finding.site, findings: [finding] })
    }
    return [...groups.values()]
  }, [anonymousFindings])
  const approvalValue = (finding: FindingEntry) => normalizeExplicitFields(manualValues[finding.key] ?? '') || normalizeExplicitFields(finding.proposedValue) || minimumExplicitFields(finding.table)
  const readyCount = findings.filter((finding) => approvalValue(finding)).length
  const selectedFieldsRequiredCount = findings.filter((finding) => approved.has(finding.key) && !approvalValue(finding)).length
  const failedSiteCount = sites.filter((site) => site.error).length

  function toggleSiteGroup(groupKey: string) {
    setCollapsedSiteGroups((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  useEffect(() => {
    const unsubscribe = debugLogger.subscribe(setDebugLines)
    debugLogger.info('app.session.started', { version: __APP_VERSION__ })
    return unsubscribe
  }, [])

  useEffect(() => {
    localStorage.setItem(CHANGE_HISTORY_KEY, JSON.stringify(changeHistory))
  }, [changeHistory])

  useEffect(() => {
    if (stage !== 'review' || reviewPersistenceDisabled.current) return
    const saved = saveReviewWorkspace({
      version: 1,
      savedAt: new Date().toISOString(),
      sites: sites.map((site) => ({
        id: site.id,
        name: site.name,
        url: site.url,
        model: site.model,
        environment: site.environment,
        active: site.active,
        error: site.error,
      })),
      findings: withoutNestedSiteAnalysis(findings),
      updatedFindings: withoutNestedSiteAnalysis(updatedFindings),
      anonymousFindings: withoutNestedSiteAnalysis(anonymousFindings),
      approvedKeys: [...approved],
      manualValues,
      reviewView,
      selectedFindingKey,
      selectedUpdatedFindingKey,
      selectedAnonymousFindingKey,
    })
    if (!saved) {
      reviewPersistenceDisabled.current = true
      queueMicrotask(() => setNotice({
          intent: 'warning',
          text: 'The review is complete, but this browser could not save it for restoration after the app closes. Keep this session open while reviewing the results.',
        }))
    }
  }, [anonymousFindings, approved, findings, manualValues, reviewView, selectedAnonymousFindingKey, selectedFindingKey, selectedUpdatedFindingKey, sites, stage, updatedFindings])

  async function importUndoCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const imported = parseChangeHistoryCsv(await file.text())
      setChangeHistory((current) => mergeChangeHistory(current, imported))
      setNotice({ intent: 'success', text: `Imported ${imported.length} undo record${imported.length === 1 ? '' : 's'} from ${file.name}.` })
      debugLogger.info('undo.csv.imported', { fileName: file.name, records: imported.length })
    } catch (error) {
      setNotice({ intent: 'error', text: errorMessage(error) })
      debugLogger.error('undo.csv.import-failed', { fileName: file.name, message: errorMessage(error) })
    }
  }

  function exportUndoCsv() {
    downloadText(changeHistoryToCsv(changeHistory), `ppwfa-undo-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`)
    debugLogger.info('undo.csv.exported', { records: changeHistory.length })
  }

  async function undoChange(change: ChangeHistoryRecord) {
    if (change.status !== 'Applied' || undoingChangeId) return
    setUndoingChangeId(change.id)
    setUndoMessages((current) => ({ ...current, [change.id]: '' }))
    debugLogger.info('undo.setting.started', { environmentId: change.environmentId, siteId: change.siteId, settingId: change.settingId })
    try {
      const restored = await flowGateway.restore({
        targetEnvironment: change.targetEnvironment,
        modelKind: change.model,
        settingId: change.settingId,
        settingName: change.settingName,
        expectedCurrentValue: change.appliedValue,
        restoreValue: change.previousValue,
      })
      if (restored.status !== 'Restored') {
        throw new Error(`Undo was blocked because the remote value is now '${restored.currentvalue ?? 'unknown'}'. No change was made.`)
      }
      const verified = await flowGateway.verify(change.targetEnvironment, change.model, change.settingId)
      if (verified.currentvalue !== change.previousValue || verified.wildcardpresent !== 'true') {
        throw new Error(`Undo verification returned '${verified.currentvalue ?? ''}'.`)
      }
      const undoneAt = new Date().toISOString()
      setChangeHistory((current) => current.map((record) => record.id === change.id ? { ...record, status: 'Undone', undoneAt } : record))
      setUndoMessages((current) => ({ ...current, [change.id]: 'Previous wildcard value restored and remotely verified.' }))
      setNotice({ intent: 'success', text: `${change.settingName} was restored and remotely verified.` })
      debugLogger.info('undo.setting.verified', { settingId: change.settingId, restoredValue: change.previousValue })
    } catch (error) {
      const message = errorMessage(error)
      setUndoMessages((current) => ({ ...current, [change.id]: message }))
      setNotice({ intent: 'error', text: message })
      debugLogger.error('undo.setting.failed', { settingId: change.settingId, message })
    } finally {
      setUndoingChangeId('')
    }
  }

  async function discoverEnvironments() {
    const startedAt = performance.now()
    debugLogger.info('environment.discovery.started')
    setDiscovering(true)
    setNotice({ intent: 'info', text: 'Retrieving environments available to the flow connection identity...' })
    try {
      const result = await withTimeout(
        flowGateway.discoverEnvironments(),
        'Environment discovery did not respond. Confirm the Power Automate Management connection and flow consent.',
      )
      const nextEnvironments = parseAccessibleEnvironments(parseRows(result.environmentsjson))
      debugLogger.info('environment.discovery.completed', { count: nextEnvironments.length, elapsedMs: Math.round(performance.now() - startedAt) })
      startTransition(() => {
        setEnvironments(nextEnvironments)
        setSelectedEnvironmentIds(new Set())
        setIncludeNonProduction(true)
        setIncludeProduction(false)
        setHidePersonalDeveloper(true)
        setEnvironmentFilter('')
        setPasteListEnabled(false)
        setBulkEnvironmentList('')
        setBulkFilterEnabled(false)
        setPowerPagesPresence({})
        setShowOnlyPowerPages(false)
        setAuditAnonymousAccess(true)
        setIgnoreInactiveSites(true)
      })
      setNotice(nextEnvironments.length > 0
        ? { intent: 'success', text: `${nextEnvironments.length} accessible Dataverse environment${nextEnvironments.length === 1 ? '' : 's'} found.` }
        : { intent: 'warning', text: 'No accessible Dataverse environments were returned for this connection identity.' })
    } catch (error) {
      debugLogger.error('environment.discovery.failed', { message: errorMessage(error), elapsedMs: Math.round(performance.now() - startedAt) })
      setNotice({ intent: 'error', text: errorMessage(error) })
    } finally {
      setDiscovering(false)
    }
  }

  function toggleEnvironment(environmentId: string, checked: boolean) {
    setSelectedEnvironmentIds((current) => {
      const next = new Set(current)
      if (checked) next.add(environmentId)
      else next.delete(environmentId)
      return next
    })
  }

  function toggleEnvironmentType(production: boolean, checked: boolean) {
    if (production) setIncludeProduction(checked)
    else setIncludeNonProduction(checked)
    if (checked) return
    setSelectedEnvironmentIds((current) => {
      const next = new Set(current)
      environments.filter((environment) => environment.isProduction === production).forEach((environment) => next.delete(environment.id))
      return next
    })
  }

  function togglePersonalDeveloperFilter(checked: boolean) {
    setHidePersonalDeveloper(checked)
    if (!checked) return
    setSelectedEnvironmentIds((current) => {
      const next = new Set(current)
      environments.filter((environment) => environment.isPersonalDeveloper).forEach((environment) => next.delete(environment.id))
      return next
    })
  }

  function toggleVisibleEnvironments(checked: boolean) {
    setSelectedEnvironmentIds((current) => {
      const next = new Set(current)
      visibleEnvironments.forEach((environment) => checked ? next.add(environment.id) : next.delete(environment.id))
      return next
    })
  }

  function selectBulkMatches() {
    const matches = scopedEnvironments.filter((environment) => matchesEnvironmentList(environment, bulkEntries))
    setSelectedEnvironmentIds(new Set(matches.map((environment) => environment.id)))
    setNotice(matches.length > 0
      ? { intent: 'success', text: `Selected ${matches.length} environment${matches.length === 1 ? '' : 's'} matching the pasted list.` }
      : { intent: 'warning', text: 'No environments matched the pasted IDs, exact names, or URLs in the current scope.' })
  }

  function togglePasteList(checked: boolean) {
    setPasteListEnabled(checked)
    if (!checked) setBulkFilterEnabled(false)
  }

  async function detectPowerPages() {
    if (environmentsNeedingDetection.length === 0) return
    const run = { cancelled: false }
    detectionRun.current = run
    setDetectingPowerPages(true)
    setStoppingDetection(false)
    setShowOnlyPowerPages(false)
    setDetectionProgress({ current: 0, total: environmentsNeedingDetection.length, retries: 0 })
    setNotice({ intent: 'info', text: `Checking ${environmentsNeedingDetection.length} environment${environmentsNeedingDetection.length === 1 ? '' : 's'} with ${detectionConcurrency} concurrent workers; transient failures retry twice...` })
    const nextPresence: Record<string, PowerPagesPresence> = { ...powerPagesPresence }
    let completed = 0
    let retries = 0
    debugLogger.info('presence.detection.started', { environmentCount: environmentsNeedingDetection.length, concurrency: detectionConcurrency })
    await runBoundedPool(
      environmentsNeedingDetection,
      detectionConcurrency,
      async (environment) => {
        const startedAt = performance.now()
        debugLogger.info('presence.environment.started', { environmentId: environment.id, environmentName: environment.name, environmentUrl: environment.url })
        const result = await withTransientRetry(
          () => {
            if (run.cancelled) throw new Error('Detection stopped by user.')
            return withTimeout(flowGateway.discoverSites(environment.target), `Power Pages detection timed out for ${environment.name}.`)
          },
          { retries: 2, baseDelayMs: 750 },
        )
        const diagnostics = getSiteDiscoveryDiagnostics(result.value)
        debugLogger.info('presence.environment.actions', { environmentId: environment.id, diagnostics })
        const discoveryFailure = siteDiscoveryFailure(result.value)
        if (discoveryFailure) throw new Error(discoveryFailure)
        nextPresence[environment.id] = hasPowerPagesSites(result.value, parseRows) ? 'present' : 'absent'
        debugLogger.info('presence.environment.completed', { environmentId: environment.id, result: nextPresence[environment.id], attempts: result.attempts, elapsedMs: Math.round(performance.now() - startedAt) })
        return result.attempts
      },
      (result) => {
        if (result.error) {
          nextPresence[result.item.id] = 'failed'
          debugLogger.error('presence.environment.failed', { environmentId: result.item.id, environmentName: result.item.name, attempts: result.attempts, message: errorMessage(result.error) })
        }
        completed += 1
        retries += Math.max(0, result.attempts - 1)
        setDetectionProgress({ current: completed, total: environmentsNeedingDetection.length, retries })
        setPowerPagesPresence({ ...nextPresence })
      },
      () => run.cancelled,
    )
    detectionRun.current = null
    const present = environmentCandidates.filter((environment) => nextPresence[environment.id] === 'present').length
    const failed = environmentCandidates.filter((environment) => nextPresence[environment.id] === 'failed').length
    setDetectingPowerPages(false)
    setStoppingDetection(false)
    if (run.cancelled) {
      debugLogger.warn('presence.detection.stopped', { completed, total: environmentsNeedingDetection.length, retries })
      setNotice({ intent: 'info', text: `Power Pages detection stopped after ${completed} of ${environmentsNeedingDetection.length} environments. Completed results remain cached.` })
      return
    }
    setNotice({
      intent: failed > 0 ? 'warning' : 'success',
      text: `Power Pages detection found ${present} environment${present === 1 ? '' : 's'} with sites${retries ? ` after ${retries} retr${retries === 1 ? 'y' : 'ies'}` : ''}${failed ? `; ${failed} could not be checked` : ''}.`,
    })
    debugLogger.info('presence.detection.completed', { completed, present, failed, retries })
  }

  function stopPowerPagesDetection() {
    if (!detectionRun.current) return
    detectionRun.current.cancelled = true
    debugLogger.warn('presence.detection.stop-requested')
    setStoppingDetection(true)
    setNotice({ intent: 'info', text: 'Stopping Power Pages detection after the current in-flight checks finish...' })
  }

  async function scanSelectedEnvironments() {
    const selectedEnvironments = environments.filter((environment) => selectedEnvironmentIds.has(environment.id))
    if (selectedEnvironments.length === 0) return
    clearReviewWorkspace()
    const run = { cancelled: false }
    scanRun.current = run
    setScanning(true)
    setStoppingScan(false)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    setStage('scanning')
    setSites([])
    setFindings([])
    setUpdatedFindings([])
    setAnonymousFindings([])
    setApproved(new Set())
    setManualValues({})
    setProgress({ current: 0, total: selectedEnvironments.length, message: 'Starting tenant scan' })
    const scannedSites: PowerPagesSite[] = []
    const scanErrors: string[] = []
    debugLogger.info('site.scan.started', { environmentCount: selectedEnvironments.length, auditAnonymousAccess })

    for (let environmentIndex = 0; environmentIndex < selectedEnvironments.length; environmentIndex += 1) {
      if (run.cancelled) break
      const environment = selectedEnvironments[environmentIndex]
      const environmentStartedAt = performance.now()
      debugLogger.info('site.discovery.started', { environmentId: environment.id, environmentName: environment.name, environmentUrl: environment.url })
      setProgress({ current: environmentIndex, total: selectedEnvironments.length, message: `Finding sites in ${environment.name}` })
      try {
        const discovered = await flowGateway.discoverSites(environment.target)
        const discoveryDiagnostics = getSiteDiscoveryDiagnostics(discovered)
        debugLogger.info('site.discovery.actions', { environmentId: environment.id, diagnostics: discoveryDiagnostics })
        const discoveryFailure = siteDiscoveryFailure(discovered)
        if (discoveryFailure) throw new Error(discoveryFailure)
        const modernSiteIds = new Set<string>()
        const modernSites = claimUniqueSites(parseRows(discovered.modernsitesjson).map((row): PowerPagesSite => ({
          id: text(row.mspp_websiteid), name: text(row.mspp_name) || 'Unnamed site', url: text(row.mspp_primarydomainname), model: 'Modern', environment, active: isActiveSiteRecord(row),
        })), modernSiteIds)
        const enhancedSiteIds = new Set<string>()
        const enhancedSites = claimUniqueSites(parseRows(discovered.enhancedandcodesitesjson).map((row): PowerPagesSite => ({
          id: text(row.powerpagesiteid), name: text(row.name) || 'Unnamed site', url: text(row.primarydomainname), model: 'Enhanced', environment, active: isActiveSiteRecord(row),
        })), enhancedSiteIds)
        const standardSiteIds = new Set<string>()
        const standardSites = claimUniqueSites(parseRows(discovered.standardsitesjson).map((row): PowerPagesSite => ({
          id: text(row.adx_websiteid), name: text(row.adx_name) || 'Unnamed site', url: text(row.adx_primarydomainname), model: 'Standard', environment, active: isActiveSiteRecord(row),
        })), standardSiteIds)
        const discoveredSites = [...modernSites, ...enhancedSites, ...standardSites].filter((candidate) => candidate.id)
        const sitesToScan = ignoreInactiveSites ? discoveredSites.filter((site) => site.active) : discoveredSites
        debugLogger.info('site.discovery.completed', { environmentId: environment.id, modernSites: modernSites.length, enhancedSites: enhancedSites.length, standardSites: standardSites.length, inactiveSitesIgnored: discoveredSites.length - sitesToScan.length, elapsedMs: Math.round(performance.now() - environmentStartedAt) })
        for (const site of sitesToScan) {
          if (run.cancelled) break
          setProgress({ current: environmentIndex, total: selectedEnvironments.length, message: `Scanning ${site.name} in ${environment.name}` })
          try {
            const siteStartedAt = performance.now()
            debugLogger.info('site.configuration.started', { environmentId: environment.id, siteId: site.id, siteName: site.name, model: site.model })
            const configuration = await flowGateway.retrieveSite(environment.target, site.id, site.model)
            const retrievalDiagnostics = configuration.retrievaldiagnostics ?? ''
            debugLogger.info('site.configuration.actions', { environmentId: environment.id, siteId: site.id, actions: retrievalDiagnostics })
            if (/=(Failed|TimedOut);/.test(retrievalDiagnostics)) {
              debugLogger.warn('site.configuration.partial', { environmentId: environment.id, siteId: site.id, actions: retrievalDiagnostics })
            }
            debugLogger.info('site.configuration.received', {
              environmentId: environment.id, siteId: site.id, model: site.model,
              enhancedComponents: parseRows(configuration.enhancedcomponentsjson).length,
              standardPermissions: parseRows(configuration.standardpermissionsjson).length,
              modernPermissions: parseRows(configuration.modernpermissionsjson).length,
              standardRoles: parseRows(configuration.standardrolesjson).length,
              modernRoles: parseRows(configuration.modernrolesjson).length,
              standardAssignments: parseRows(configuration.standardpermissionrolesjson).length,
              modernAssignments: parseRows(configuration.modernpermissionrolesjson).length,
            })
            const codeFiles = await retrieveCodeFiles(environment, site.model, configuration)
            site.analysis = analyzeConfiguration(site.model, configuration, codeFiles)
            debugLogger.info('site.analysis.completed', { environmentId: environment.id, siteId: site.id, codeFiles: codeFiles.length, sources: site.analysis.sourceCount, wildcardFindings: site.analysis.findings.length, anonymousFindings: site.analysis.anonymousPermissionFindings.length, blockers: site.analysis.completenessBlockers.length, elapsedMs: Math.round(performance.now() - siteStartedAt) })
          } catch (error) {
            site.error = errorMessage(error)
            debugLogger.error('site.scan.failed', { environmentId: environment.id, siteId: site.id, siteName: site.name, model: site.model, message: site.error })
          }
          if (run.cancelled) break
          scannedSites.push(site)
          setSites([...scannedSites])
        }
      } catch (error) {
        const message = errorMessage(error)
        debugLogger.error('site.discovery.failed', { environmentId: environment.id, environmentName: environment.name, message })
        if (!run.cancelled) {
          scanErrors.push(`${environment.name}: ${message}`)
          scannedSites.push({ id: `environment-error-${environment.id}`, name: 'Environment access failed', url: '', model: 'Enhanced', environment, active: true, error: message })
        }
      }
    }

    scanRun.current = null
    if (run.cancelled) {
      debugLogger.warn('site.scan.stopped', { scannedSites: scannedSites.length })
      startTransition(() => {
        setSites([])
        setFindings([])
        setUpdatedFindings([])
        setAnonymousFindings([])
        setStage('environments')
        setScanning(false)
        setStoppingScan(false)
      })
      setNotice({ intent: 'info', text: 'Site scan stopped. Select environments and start again when ready.' })
      return
    }

    const nextFindings = scannedSites.flatMap((site) => (site.analysis?.findings ?? []).map((finding): FindingEntry => ({
      ...finding,
      key: wildcardFindingKey(site.environment.id, site.id, site.model, finding.settingName, finding.settingRecordId),
      site,
      proposedValue: finding.proposedFields.join(','),
    })))
    const nextAnonymousFindings = auditAnonymousAccess
      ? scannedSites.flatMap((site) => (site.analysis?.anonymousPermissionFindings ?? []).map((finding): AnonymousFindingEntry => ({
        ...finding,
        key: `${site.environment.id}|${site.id}|${site.model}|anonymous|${finding.permissionRecordId}`,
        site,
      })))
      : []
    startTransition(() => {
      setSites(scannedSites)
      setFindings(nextFindings)
      setAnonymousFindings(nextAnonymousFindings)
      setSelectedFindingKey(nextFindings[0]?.key ?? '')
      setSelectedAnonymousFindingKey(nextAnonymousFindings[0]?.key ?? '')
      setReviewView(nextFindings.length === 0 && nextAnonymousFindings.length > 0 ? 'anonymous' : 'wildcards')
      setStage((current) => current === 'scanning' ? 'review' : current)
      setScanning(false)
    })
    setProgress({ current: selectedEnvironments.length, total: selectedEnvironments.length, message: 'Tenant scan complete' })
    const successfulSites = scannedSites.filter((site) => !site.error).length
    setNotice({
      intent: scannedSites.some((site) => site.error) ? 'warning' : 'success',
      text: `Scanned ${successfulSites} site${successfulSites === 1 ? '' : 's'} across ${selectedEnvironments.length} environment${selectedEnvironments.length === 1 ? '' : 's'}; found ${nextFindings.length} wildcard setting${nextFindings.length === 1 ? '' : 's'}${auditAnonymousAccess ? ` and ${nextAnonymousFindings.length} anonymous table permission${nextAnonymousFindings.length === 1 ? '' : 's'}` : ''}.${scanErrors.length ? ` ${scanErrors[0]}${scanErrors.length > 1 ? `; ${scanErrors.length - 1} additional environment${scanErrors.length === 2 ? '' : 's'} failed.` : ''}` : ''}`,
    })
    debugLogger.info('site.scan.completed', { environments: selectedEnvironments.length, successfulSites, failedSites: scannedSites.length - successfulSites, wildcardFindings: nextFindings.length, anonymousFindings: nextAnonymousFindings.length })
  }

  function stopSiteScan() {
    if (!scanRun.current) return
    scanRun.current.cancelled = true
    debugLogger.warn('site.scan.stop-requested')
    setStoppingScan(true)
    setNotice({ intent: 'info', text: 'Stopping the site scan after the current flow request finishes...' })
  }

  function toggleApproval(finding: FindingEntry, checked: boolean) {
    toggleApprovals([finding], checked)
  }

  function toggleApprovals(entries: FindingEntry[], checked: boolean) {
    setApproved((current) => {
      const next = new Set(current)
      for (const entry of entries) {
        if (checked) next.add(entry.key)
        else next.delete(entry.key)
      }
      return next
    })
  }

  function approvalSelectionState(entries: FindingEntry[]): boolean | 'mixed' {
    const selected = entries.filter((entry) => approved.has(entry.key)).length
    return selected === 0 ? false : selected === entries.length ? true : 'mixed'
  }

  function updateManualValue(finding: FindingEntry, value: string) {
    setManualValues((current) => ({ ...current, [finding.key]: value }))
  }

  async function applyApproved() {
    if (selectedFieldsRequiredCount > 0) {
      setNotice({ intent: 'warning', text: `Enter a valid explicit field list for ${selectedFieldsRequiredCount} selected wildcard setting${selectedFieldsRequiredCount === 1 ? '' : 's'} before applying.` })
      return
    }
    const approvedFindings = findings.filter((finding) => approved.has(finding.key) && approvalValue(finding))
    if (approvedFindings.length === 0) return
    setApplying(true)
    debugLogger.info('apply.started', { settingCount: approvedFindings.length })
    const nextFindings = [...findings]
    let verifiedCount = 0
    for (let index = 0; index < approvedFindings.length; index += 1) {
      const finding = approvedFindings[index]
      setProgress({ current: index, total: approvedFindings.length, message: `Applying ${finding.settingName} in ${finding.site.environment.name}` })
      const targetIndex = nextFindings.findIndex((candidate) => candidate.key === finding.key)
      const explicitValue = approvalValue(finding)
      try {
        const applyStartedAt = performance.now()
        debugLogger.info('apply.setting.started', { environmentId: finding.site.environment.id, siteId: finding.site.id, settingId: finding.settingRecordId, settingName: finding.settingName })
        const applied = await flowGateway.apply({
          targetEnvironment: finding.site.environment.target,
          modelKind: finding.site.model,
          settingId: finding.settingRecordId,
          settingName: finding.settingName,
          approvedValue: explicitValue,
        })
        if (applied.status !== 'Applied') throw new Error('The apply flow refused the update because its wildcard safety guard did not pass.')
        debugLogger.info('apply.setting.applied', { settingId: finding.settingRecordId, elapsedMs: Math.round(performance.now() - applyStartedAt) })
        nextFindings[targetIndex] = { ...finding, applyStatus: 'applied', applyMessage: 'Applied; verifying remote value.' }
        setFindings([...nextFindings])
        const verified = await flowGateway.verify(finding.site.environment.target, finding.site.model, finding.settingRecordId)
        if (verified.currentvalue !== explicitValue || verified.wildcardpresent === 'true') {
          throw new Error(`Remote verification returned '${verified.currentvalue ?? ''}'.`)
        }
        const changedAt = new Date().toISOString()
        const historyRecord: ChangeHistoryRecord = {
          id: crypto.randomUUID(), changedAt,
          environmentId: finding.site.environment.id,
          environmentName: finding.site.environment.name,
          targetEnvironment: finding.site.environment.target,
          siteId: finding.site.id,
          siteName: finding.site.name,
          model: finding.site.model,
          settingId: finding.settingRecordId,
          settingName: finding.settingName,
          previousValue: finding.currentValue,
          appliedValue: explicitValue,
          status: 'Applied',
          undoneAt: '',
        }
        setChangeHistory((current) => mergeChangeHistory(current, [historyRecord]))
        debugLogger.info('apply.setting.verified', { settingId: finding.settingRecordId, wildcardPresent: verified.wildcardpresent })
        const updatedFinding = { ...finding, proposedValue: explicitValue, applyStatus: 'verified' as const, applyMessage: 'Remote value verified.' }
        setUpdatedFindings((current) => [...current, updatedFinding])
        setSelectedUpdatedFindingKey((current) => current || finding.key)
        verifiedCount += 1
        nextFindings.splice(targetIndex, 1)
        setApproved((current) => {
          const next = new Set(current)
          next.delete(finding.key)
          return next
        })
        setManualValues((current) => {
          const next = { ...current }
          delete next[finding.key]
          return next
        })
        setSelectedFindingKey((current) => current === finding.key ? nextFindings[0]?.key ?? '' : current)
      } catch (error) {
        nextFindings[targetIndex] = { ...finding, applyStatus: 'failed', applyMessage: errorMessage(error) }
        debugLogger.error('apply.setting.failed', { settingId: finding.settingRecordId, message: errorMessage(error) })
      }
      setFindings([...nextFindings])
    }
    const failures = nextFindings.filter((finding) => finding.applyStatus === 'failed').length
    if (nextFindings.length === 0 && verifiedCount > 0) setReviewView('updated')
    setProgress({ current: approvedFindings.length, total: approvedFindings.length, message: 'Apply and verification complete' })
    setNotice(failures > 0
      ? { intent: 'error', text: `${failures} approved change${failures === 1 ? '' : 's'} failed apply or remote verification.` }
      : { intent: 'success', text: `${approvedFindings.length} approved change${approvedFindings.length === 1 ? '' : 's'} applied and independently verified.` })
    setApplying(false)
    debugLogger.info('apply.completed', { settingCount: approvedFindings.length, failures })
  }

  return (
    <FluentProvider theme={powerPagesTheme}>
      <div className="app-shell">
        <aside className="rail">
          <div className="brand-mark"><img src={powerPagesLogo} alt="Microsoft Power Pages" /></div>
          <div className="brand-copy"><strong>Wildcard &amp; Anonymous</strong><span>Power Pages access auditor</span></div>
          <nav aria-label="Audit workflow">
            <button className={stage === 'environments' ? 'active' : ''} onClick={() => setStage('environments')}><span>01</span> Environments</button>
            <button className={stage === 'scanning' ? 'active' : ''} disabled={!scanning} onClick={() => scanning && setStage('scanning')}><span>02</span> Scan</button>
            <button className={stage === 'review' ? 'active' : ''} disabled={findings.length + anonymousFindings.length === 0} onClick={() => findings.length + anonymousFindings.length > 0 && setStage('review')}><span>03</span> Review</button>
            <button disabled={approved.size === 0}><span>04</span> Apply + verify</button>
            <button className={stage === 'undo' ? 'active' : ''} onClick={() => setStage('undo')}><span>05</span> Undo changes</button>
          </nav>
          <div className="app-version">Version {__APP_VERSION__}</div>
          <div className="deadline"><WarningRegular /><div><span>Wildcard removal</span><strong>September 14, 2026</strong></div></div>
        </aside>

        <main>
          <header className="topbar">
            <div>
              <span className="eyebrow">POWER PAGES SECURITY</span>
              <h1>{stage === 'environments' ? 'Choose tenant environments' : stage === 'scanning' ? 'Scanning selected environments' : stage === 'undo' ? 'Undo applied changes' : 'Review security findings'}</h1>
              <p>{stage === 'review' ? 'Inspect wildcard evidence and anonymous table access discovered across the selected sites.' : stage === 'undo' ? 'Restore a recorded wildcard value only when the remote setting has not changed since it was applied.' : 'Production stays excluded until you explicitly include it.'}</p>
            </div>
          </header>

          <MessageBar intent={notice.intent} className="flow-notice"><MessageBarBody>{notice.text}</MessageBarBody></MessageBar>
          <section className="debug-panel" aria-label="Debug logging">
            <div className="debug-toolbar">
              <strong>Debug logging</strong>
              <Badge appearance="tint" color="informative">{debugLines.length} events</Badge>
              <Badge appearance="tint" color="danger">{debugFailureCount} {debugFailureCount === 1 ? 'failure' : 'failures'}</Badge>
              <Switch checked={showDebugLogs} label={showDebugLogs ? 'Hide logs' : 'Show logs'} onChange={(_, data) => setShowDebugLogs(data.checked)} />
              <Button icon={<ArrowDownloadRegular />} disabled={debugLines.length === 0} onClick={() => debugLogger.download()}>Download debug log</Button>
            </div>
            {showDebugLogs && <pre aria-label="Recent debug events">{debugLines.slice(-100).join('\n')}</pre>}
          </section>
          {stage === 'environments' && (
            <section className="workspace environment-workspace">
              <div className="workspace-main">
                <div className="section-heading">
                  <div><span className="step-label">STEP 1</span><h2>Accessible environments</h2><p>Discover first, then select the environments that may be scanned.</p></div>
                  <Button icon={discovering ? <Spinner size="tiny" /> : <ArrowSyncRegular />} appearance="primary" disabled={discovering} aria-busy={discovering} onClick={discoverEnvironments}>{discovering ? 'Discovering environments...' : 'Discover environments'}</Button>
                </div>
                <div className="environment-filter-heading"><strong>Environment Filter</strong></div>
                <div className="environment-filter-layout">
                  <div className="environment-search">
                    <Input contentBefore={<SearchRegular />} value={environmentFilter} onChange={(_, data) => setEnvironmentFilter(data.value)} placeholder="Filter environments" disabled={environments.length === 0} />
                  </div>
                  <div className="environment-switches">
                    <Switch checked={includeNonProduction} label="Sandbox and non-production" onChange={(_, data) => toggleEnvironmentType(false, data.checked)} />
                    <Switch checked={includeProduction} label="Production" onChange={(_, data) => toggleEnvironmentType(true, data.checked)} />
                    <Switch checked={hidePersonalDeveloper} label={`Hide personal developer${hiddenPersonalDeveloperCount ? ` (${hiddenPersonalDeveloperCount})` : ''}`} onChange={(_, data) => togglePersonalDeveloperFilter(data.checked)} />
                    <Switch checked={pasteListEnabled} label="Paste environment list" onChange={(_, data) => togglePasteList(data.checked)} />
                    <Switch checked={auditAnonymousAccess} label="Audit anonymous table access" onChange={(_, data) => setAuditAnonymousAccess(data.checked)} />
                    <Switch checked={ignoreInactiveSites} label="Ignore inactive sites" onChange={(_, data) => setIgnoreInactiveSites(data.checked)} />
                  </div>
                  <div className="power-pages-filter">
                    <div><strong>Power Pages presence</strong><span>Detect Standard and Enhanced Power Pages sites in the current environment filter.</span></div>
                    <div className="detection-speed" role="group" aria-label="Detection speed">
                      <span className="detection-speed-label">Detection speed</span>
                      {DETECTION_PROFILES.map((profile) => <Button key={profile.value} size="small" appearance={detectionConcurrency === profile.value ? 'primary' : 'subtle'} aria-pressed={detectionConcurrency === profile.value} disabled={detectingPowerPages} onClick={() => setDetectionConcurrency(profile.value)}>{profile.label} ({profile.value})</Button>)}
                    </div>
                    <div className="detection-actions">
                      <Button icon={detectingPowerPages ? <Spinner size="tiny" /> : <SearchRegular />} disabled={detectingPowerPages || environmentsNeedingDetection.length === 0} aria-busy={detectingPowerPages} onClick={detectPowerPages}>{detectingPowerPages ? 'Checking environments...' : environments.length === 0 ? 'Discover environments first' : environmentsNeedingDetection.length > 0 ? `Detect Power Pages (${environmentsNeedingDetection.length})` : 'All filtered environments checked'}</Button>
                      {detectingPowerPages && <Badge appearance="filled" color="informative" aria-live="polite">{detectionProgress.current} of {detectionProgress.total}{detectionProgress.retries ? ` · ${detectionProgress.retries} retries` : ''}</Badge>}
                      {detectingPowerPages && <Button icon={stoppingDetection ? <Spinner size="tiny" /> : <StopRegular />} appearance="secondary" disabled={stoppingDetection} aria-busy={stoppingDetection} onClick={stopPowerPagesDetection}>{stoppingDetection ? 'Stopping...' : 'Stop'}</Button>}
                    </div>
                    <Switch checked={showOnlyPowerPages} disabled={detectedEnvironmentCount === 0 || detectingPowerPages} label={`Only environments with Power Pages (${detectedPowerPagesCount})`} onChange={(_, data) => setShowOnlyPowerPages(data.checked)} />
                  </div>
                  {pasteListEnabled && <div className="bulk-environment-filter">
                    <div><strong>Bulk environment list</strong><span>Paste environment IDs, exact names, or Dataverse URLs. Separate entries with a new line, comma, or semicolon.</span></div>
                    <Textarea value={bulkEnvironmentList} onChange={(_, data) => setBulkEnvironmentList(data.value)} placeholder={'environment-guid\nCustomer Portal Dev\nhttps://org.crm.dynamics.com'} resize="vertical" />
                    <div className="bulk-filter-actions">
                      <Button disabled={bulkEntries.length === 0} appearance="primary" onClick={() => setBulkFilterEnabled((current) => !current)}>{bulkFilterEnabled ? 'Clear pasted list filter' : `Apply pasted list filter (${bulkMatches.length})`}</Button>
                      <Button disabled={bulkEntries.length === 0} onClick={selectBulkMatches}>Select matches ({bulkMatches.length})</Button>
                    </div>
                  </div>}
                </div>
                <div className="environment-selection-header">
                  <div><strong>Choose environments to scan</strong><span>Select all visible environments or select individual environments from the list below.</span></div>
                  <Checkbox label="Select all visible" checked={allVisibleSelected} disabled={visibleEnvironments.length === 0} onChange={(_, data) => toggleVisibleEnvironments(data.checked === true)} />
                </div>
                {visibleEnvironments.length > 0 ? (
                  <div className="environment-list">
                    {visibleEnvironments.map((environment) => (
                      <label className="environment-row" key={environment.id}>
                        <Checkbox checked={selectedEnvironmentIds.has(environment.id)} onChange={(_, data) => toggleEnvironment(environment.id, data.checked === true)} aria-label={`Select ${environment.name}`} />
                        <span className="site-copy"><strong>{environment.name}</strong><small>{environment.url || environment.id}</small></span>
                        <Badge appearance="tint" color={environment.isProduction ? 'danger' : 'informative'}>{environment.sku || environment.type || 'Environment'}</Badge>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state"><DatabaseSearchRegular /><h3>{environments.length ? 'No environments match this filter' : 'No environments loaded'}</h3><p>Environment discovery uses the connection identity, matching the desktop app's tenant inventory step.</p></div>
                )}
                <div className="primary-action-bar"><span>{selectedEnvironmentIds.size} environment{selectedEnvironmentIds.size === 1 ? '' : 's'} selected</span><Button icon={scanning ? <Spinner size="tiny" /> : undefined} appearance="primary" disabled={selectedEnvironmentIds.size === 0 || discovering || detectingPowerPages || scanning} aria-busy={scanning} onClick={scanSelectedEnvironments}>{scanning ? 'Starting scan...' : 'Scan selected environments'}</Button></div>
              </div>
            </section>
          )}

          {stage === 'scanning' && (
            <section className="scan-state"><Spinner size="huge" label={stoppingScan ? 'Stopping after the current request...' : progress.message} /><ProgressBar value={progress.total ? progress.current / progress.total : undefined} /><p>{progress.current} of {progress.total} environments complete</p><Button icon={stoppingScan ? <Spinner size="tiny" /> : <StopRegular />} appearance="secondary" disabled={stoppingScan} aria-busy={stoppingScan} onClick={stopSiteScan}>{stoppingScan ? 'Stopping...' : 'Stop scan'}</Button></section>
          )}

          {stage === 'review' && (
            <section className="review-layout">
              <div className="review-list-pane">
                <div className="review-summary">
                  <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => setStage('environments')}>Environments</Button>
                  <div><strong>{findings.length}</strong><span>Wildcard settings</span></div>
                  <div><strong>{anonymousFindings.length}</strong><span>Anonymous permissions</span></div>
                  <div><strong>{readyCount}</strong><span>Field list ready</span></div>
                  <div><strong>{failedSiteCount}</strong><span>Site failures</span></div>
                </div>
                <div className="review-tabs" role="tablist" aria-label="Security finding type">
                  <Button role="tab" aria-selected={reviewView === 'wildcards'} appearance={reviewView === 'wildcards' ? 'primary' : 'subtle'} onClick={() => setReviewView('wildcards')}>Wildcard fields ({findings.length})</Button>
                  <Button role="tab" aria-selected={reviewView === 'updated'} appearance={reviewView === 'updated' ? 'primary' : 'subtle'} onClick={() => setReviewView('updated')}>Updated wildcards ({updatedFindings.length})</Button>
                  <Button role="tab" aria-selected={reviewView === 'anonymous'} appearance={reviewView === 'anonymous' ? 'primary' : 'subtle'} onClick={() => setReviewView('anonymous')}>Anonymous table access ({anonymousFindings.length})</Button>
                </div>
                {reviewView === 'wildcards' && <div className="apply-bar"><span>{approved.size} wildcard change{approved.size === 1 ? '' : 's'} selected{selectedFieldsRequiredCount > 0 ? `; ${selectedFieldsRequiredCount} need fields` : ''}</span><Button icon={applying ? <Spinner size="tiny" /> : undefined} appearance="primary" disabled={approved.size === 0 || selectedFieldsRequiredCount > 0 || applying} aria-busy={applying} onClick={applyApproved}>{applying ? `Applying and verifying ${progress.current + 1} of ${progress.total}` : 'Apply selected and verify'}</Button></div>}
                {reviewView === 'wildcards' && (findings.length > 0 ? <>
                  <div className="wildcard-selection-toolbar">
                    <div><strong>Select wildcard changes</strong><span>Select every result, then clear individual sites or settings that should not be updated.</span></div>
                    <Checkbox label={`Select all results (${findings.length})`} checked={approvalSelectionState(findings)} disabled={applying} onChange={(_, data) => toggleApprovals(findings, data.checked === true)} />
                  </div>
                  <div className="wildcard-site-groups">
                    {wildcardSiteGroups.map((group) => {
                      const collapsed = collapsedSiteGroups.has(group.key)
                      const contentId = `wildcard-site-${group.key.replace(/[^a-z0-9_-]/gi, '-')}`
                      return <section className="wildcard-site-group" key={group.key}>
                      <div className="wildcard-site-heading">
                        <div className="wildcard-site-heading-main">
                          <Button appearance="subtle" size="small" icon={collapsed ? <ChevronRightRegular /> : <ChevronDownRegular />} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.site.name}`} aria-expanded={!collapsed} aria-controls={contentId} onClick={() => toggleSiteGroup(group.key)} />
                          <div><strong>{group.site.name} <Badge appearance="tint" color="informative">{group.site.model === 'Standard' ? 'SDM' : 'EDM'}</Badge></strong><span>{group.site.environment.name} · {group.site.model} · {group.findings.length} wildcard setting{group.findings.length === 1 ? '' : 's'}</span></div>
                        </div>
                        <Checkbox label={`Select all for ${group.site.name} (${group.site.model === 'Standard' ? 'SDM' : 'EDM'})`} checked={approvalSelectionState(group.findings)} disabled={applying} onChange={(_, data) => toggleApprovals(group.findings, data.checked === true)} />
                      </div>
                      <div id={contentId} hidden={collapsed}>{group.findings.map((finding) => (
                        <button className={`finding-row ${selectedFindingKey === finding.key ? 'selected' : ''}`} key={finding.key} onClick={() => setSelectedFindingKey(finding.key)}>
                          <Checkbox checked={approved.has(finding.key)} disabled={applying} onChange={(_, data) => toggleApproval(finding, data.checked === true)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${finding.settingName} for update`} />
                          <span className="finding-copy"><strong>{finding.table}</strong><small>{finding.settingName}{group.findings.filter((candidate) => candidate.settingName.toLowerCase() === finding.settingName.toLowerCase()).length > 1 ? ' · duplicate setting record' : ''}</small></span>
                          <Badge appearance="tint" color="brand">ready to update</Badge>
                        </button>
                      ))}</div>
                    </section>})}
                  </div>
                </> : (
                  <div className="empty-state"><CheckmarkCircleRegular /><h3>No wildcard settings found</h3><p>The selected accessible sites did not return a <code>Webapi/&lt;table&gt;/fields</code> setting containing <code>*</code>.</p></div>
                ))}
                {reviewView === 'updated' && (updatedFindings.length > 0 ? updatedFindings.map((finding) => (
                  <button className={`finding-row ${selectedUpdatedFindingKey === finding.key ? 'selected' : ''}`} key={finding.key} onClick={() => setSelectedUpdatedFindingKey(finding.key)}>
                    <CheckmarkCircleRegular className="updated-finding-icon" />
                    <span className="finding-copy"><strong>{finding.site.name} / {finding.table}</strong><small>{finding.site.environment.name} · {finding.settingName}</small></span>
                    <Badge appearance="tint" color="success">verified</Badge>
                  </button>
                )) : (
                  <div className="empty-state"><CheckmarkCircleRegular /><h3>No updated wildcards yet</h3><p>Wildcard settings move here after the replacement is applied and independently verified.</p></div>
                ))}
                {reviewView === 'anonymous' && (anonymousFindings.length > 0 ? (
                  <div className="wildcard-site-groups">
                    {anonymousSiteGroups.map((group) => {
                      const collapsed = collapsedSiteGroups.has(group.key)
                      const contentId = `anonymous-site-${group.key.replace(/[^a-z0-9_-]/gi, '-')}`
                      return <section className="wildcard-site-group" key={group.key}>
                      <div className="wildcard-site-heading">
                        <div className="wildcard-site-heading-main">
                          <Button appearance="subtle" size="small" icon={collapsed ? <ChevronRightRegular /> : <ChevronDownRegular />} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.site.name}`} aria-expanded={!collapsed} aria-controls={contentId} onClick={() => toggleSiteGroup(group.key)} />
                          <div><strong>{group.site.name} <Badge appearance="tint" color="informative">{group.site.model === 'Standard' ? 'SDM' : 'EDM'}</Badge></strong><span>{group.site.environment.name} · {group.site.model} · {group.findings.length} anonymous permission{group.findings.length === 1 ? '' : 's'}</span></div>
                        </div>
                      </div>
                      <div id={contentId} hidden={collapsed}>{group.findings.map((finding) => (
                        <button className={`finding-row ${selectedAnonymousFindingKey === finding.key ? 'selected' : ''}`} key={finding.key} onClick={() => setSelectedAnonymousFindingKey(finding.key)}>
                          <ShieldLockRegular className="finding-icon" />
                          <span className="finding-copy"><strong>{finding.table}</strong><small>{finding.permissionName}</small></span>
                          <Badge appearance="tint" color="danger">anonymous access</Badge>
                        </button>
                      ))}</div>
                    </section>})}
                  </div>
                ) : (
                  <div className="empty-state"><CheckmarkCircleRegular /><h3>No anonymous table access found</h3><p>No scanned table permission is assigned to an Anonymous Users role.</p></div>
                ))}
              </div>

              <aside className="finding-detail">
                {reviewView === 'wildcards' && selectedFinding ? (
                  <>
                    <span className="step-label">CODE EVIDENCE</span><h2>{selectedFinding.settingName}</h2><p>{selectedFinding.site.environment.name} / {selectedFinding.site.name}</p>
                    {recordUrl(selectedFinding.site, selectedFinding.settingRecordEntity, selectedFinding.settingRecordId) && <Button as="a" href={recordUrl(selectedFinding.site, selectedFinding.settingRecordEntity, selectedFinding.settingRecordId)} target="_blank" rel="noreferrer" appearance="outline" className="record-link">Open site setting record</Button>}
                    <dl><dt>Current value</dt><dd><code>{selectedFinding.currentValue}</code></dd><dt>Explicit replacement</dt><dd><code>{approvalValue(selectedFinding) || 'Enter the fields below'}</code></dd></dl>
                    <div className="manual-fields"><label htmlFor="manual-fields">Reviewed explicit fields (optional override)</label><Input id="manual-fields" value={manualValues[selectedFinding.key] ?? ''} onChange={(event) => updateManualValue(selectedFinding, event.currentTarget.value)} placeholder={approvalValue(selectedFinding)} disabled={applying} /><small>The primary ID is used as the minimum allowlist when no code fields are found. Enter additional logical column names here when needed.</small></div>
                    {selectedFinding.blockers.length > 0 && <div className="blocker-panel"><strong>Minimum allowlist selected</strong><p>No static Web API fields were found, so this update retains access only to <code>{minimumExplicitFields(selectedFinding.table)}</code>. Add fields above if this table is accessed dynamically.</p></div>}
                    <h3>References ({selectedFinding.evidence.length})</h3>
                    <div className="evidence-list">{selectedFinding.evidence.map((evidence, index) => {
                      const sourceUrl = evidence.recordEntity && evidence.recordId ? recordUrl(selectedFinding.site, evidence.recordEntity, evidence.recordId) : ''
                      return <div className="evidence-row" key={`${evidence.file}-${evidence.line}-${evidence.field}-${index}`}><div className="evidence-row-head"><code>{evidence.field}</code>{sourceUrl && <Button as="a" href={sourceUrl} target="_blank" rel="noreferrer" appearance="subtle" size="small" icon={<OpenRegular />} className="evidence-record-link">Open record</Button>}</div><span>{evidence.source} · {evidence.file}:{evidence.line}</span></div>
                    })}</div>
                    {selectedFinding.applyStatus && <MessageBar intent={selectedFinding.applyStatus === 'verified' ? 'success' : selectedFinding.applyStatus === 'failed' ? 'error' : 'info'}><MessageBarBody>{selectedFinding.applyMessage}</MessageBarBody></MessageBar>}
                  </>
                ) : reviewView === 'updated' && selectedUpdatedFinding ? (
                  <>
                    <span className="step-label">VERIFIED UPDATE</span><h2>{selectedUpdatedFinding.settingName}</h2><p>{selectedUpdatedFinding.site.environment.name} / {selectedUpdatedFinding.site.name}</p>
                    {recordUrl(selectedUpdatedFinding.site, selectedUpdatedFinding.settingRecordEntity, selectedUpdatedFinding.settingRecordId) && <Button as="a" href={recordUrl(selectedUpdatedFinding.site, selectedUpdatedFinding.settingRecordEntity, selectedUpdatedFinding.settingRecordId)} target="_blank" rel="noreferrer" appearance="outline" className="record-link">Open site setting record</Button>}
                    <dl><dt>Previous wildcard value</dt><dd><code>{selectedUpdatedFinding.currentValue}</code></dd><dt>Verified explicit value</dt><dd><code>{selectedUpdatedFinding.proposedValue}</code></dd></dl>
                    {selectedUpdatedFinding.blockers.length > 0 && <div className="blocker-panel"><strong>Minimum allowlist was used</strong><p>The scan found no static Web API fields, so the verified update retained access only to <code>{minimumExplicitFields(selectedUpdatedFinding.table)}</code>.</p></div>}
                    <h3>References ({selectedUpdatedFinding.evidence.length})</h3>
                    <div className="evidence-list">{selectedUpdatedFinding.evidence.map((evidence, index) => {
                      const sourceUrl = evidence.recordEntity && evidence.recordId ? recordUrl(selectedUpdatedFinding.site, evidence.recordEntity, evidence.recordId) : ''
                      return <div className="evidence-row" key={`${evidence.file}-${evidence.line}-${evidence.field}-${index}`}><div className="evidence-row-head"><code>{evidence.field}</code>{sourceUrl && <Button as="a" href={sourceUrl} target="_blank" rel="noreferrer" appearance="subtle" size="small" icon={<OpenRegular />} className="evidence-record-link">Open record</Button>}</div><span>{evidence.source} · {evidence.file}:{evidence.line}</span></div>
                    })}</div>
                    <MessageBar intent="success"><MessageBarBody>{selectedUpdatedFinding.applyMessage}</MessageBarBody></MessageBar>
                  </>
                ) : reviewView === 'anonymous' && selectedAnonymousFinding ? (
                  <>
                    <span className="step-label">ANONYMOUS TABLE ACCESS</span><h2>{selectedAnonymousFinding.permissionName}</h2><p>{selectedAnonymousFinding.site.environment.name} / {selectedAnonymousFinding.site.name} / {selectedAnonymousFinding.site.model === 'Standard' ? 'SDM' : 'EDM'} ({selectedAnonymousFinding.site.model})</p>
                    {recordUrl(selectedAnonymousFinding.site, selectedAnonymousFinding.permissionRecordEntity, selectedAnonymousFinding.permissionRecordId) && <Button as="a" href={recordUrl(selectedAnonymousFinding.site, selectedAnonymousFinding.permissionRecordEntity, selectedAnonymousFinding.permissionRecordId)} target="_blank" rel="noreferrer" appearance="outline" className="record-link">Open table permission record</Button>}
                    <dl>
                      <dt>Dataverse table</dt><dd><code>{selectedAnonymousFinding.table}</code></dd>
                      <dt>Access scope</dt><dd>{selectedAnonymousFinding.scope}</dd>
                      <dt>Allowed operations</dt><dd>{selectedAnonymousFinding.privileges.join(', ') || 'None'}</dd>
                      <dt>Anonymous role</dt><dd>{selectedAnonymousFinding.roleName}{selectedAnonymousFinding.inherited ? ' (inherited from parent permission)' : ''}</dd>
                    </dl>
                    <MessageBar intent="warning"><MessageBarBody>Any visitor can use these table privileges without signing in to access any record from this table. Review whether this access is intentional.</MessageBarBody></MessageBar>
                  </>
                ) : <div className="empty-detail"><DatabaseSearchRegular /><p>Select a finding to inspect its evidence.</p></div>}
              </aside>
            </section>
          )}
          {stage === 'undo' && (
            <section className="undo-workspace">
              <div className="section-heading">
                <div><span className="step-label">RECOVERY</span><h2>Change history</h2><p>History is saved in this browser. Export it for customer handoff or import a previous auditor CSV.</p></div>
                <div className="undo-actions">
                  <input ref={undoFileInput} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={importUndoCsv} />
                  <Button icon={<ArrowUploadRegular />} onClick={() => undoFileInput.current?.click()}>Import undo CSV</Button>
                  <Button icon={<ArrowDownloadRegular />} disabled={changeHistory.length === 0} onClick={exportUndoCsv}>Export history CSV</Button>
                </div>
              </div>
              {changeHistory.length > 0 ? <div className="undo-list">
                {changeHistory.map((change) => <div className="undo-row" key={change.id}>
                  <div className="undo-copy">
                    <strong>{change.environmentName} / {change.siteName}</strong>
                    <span>{change.settingName} · {change.model} · {new Date(change.changedAt).toLocaleString()}</span>
                    <code>{change.previousValue} → {change.appliedValue}</code>
                    {undoMessages[change.id] && <small className={change.status === 'Undone' ? 'undo-success' : 'undo-error'}>{undoMessages[change.id]}</small>}
                  </div>
                  <Badge appearance="tint" color={change.status === 'Undone' ? 'success' : 'warning'}>{change.status}</Badge>
                  <Button icon={undoingChangeId === change.id ? <Spinner size="tiny" /> : <ArrowUndoRegular />} appearance="primary" disabled={change.status === 'Undone' || Boolean(undoingChangeId)} aria-busy={undoingChangeId === change.id} onClick={() => undoChange(change)}>{undoingChangeId === change.id ? 'Restoring...' : change.status === 'Undone' ? 'Restored' : 'Undo and verify'}</Button>
                </div>)}
              </div> : <div className="empty-state"><ArrowUndoRegular /><h3>No recorded changes</h3><p>Verified changes made by this browser appear here. You can also import an undo CSV from another session.</p></div>}
            </section>
          )}
        </main>
      </div>
    </FluentProvider>
  )
}

export default App
