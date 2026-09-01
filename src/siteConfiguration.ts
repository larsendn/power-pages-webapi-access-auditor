import { analyzeSite, findAllAttributes, type AllAttributesFinding, type SourceFile, type SiteSetting, type TableFinding } from './auditor'

export type SiteModel = 'Standard' | 'Enhanced' | 'Modern'

export function siteModelLabel(model: SiteModel): 'SDM' | 'EDM' {
  return model === 'Standard' ? 'SDM' : 'EDM'
}

export interface SiteConfigurationPayload {
  retrievaldiagnostics?: string
  enhancedcomponentsjson?: string
  standardsettingsjson?: string
  standardwebpagesjson?: string
  standardwebtemplatesjson?: string
  standardbasicformsjson?: string
  standardmultistepformsjson?: string
  standardmultistepformstepsjson?: string
  standardcontentsnippetsjson?: string
  standardwebfilesjson?: string
  modernsettingsjson?: string
  modernwebpagesjson?: string
  modernwebtemplatesjson?: string
  modernbasicformsjson?: string
  modernmultistepformsjson?: string
  modernmultistepformstepsjson?: string
  moderncontentsnippetsjson?: string
  modernwebfilesjson?: string
  standardpermissionsjson?: string
  modernpermissionsjson?: string
  standardrolesjson?: string
  modernrolesjson?: string
  standardpermissionrolesjson?: string
  modernpermissionrolesjson?: string
}

export interface AnonymousPermissionFinding {
  permissionName: string
  permissionRecordId: string
  permissionRecordEntity: 'adx_entitypermission' | 'mspp_entitypermission' | 'powerpagecomponent'
  table: string
  scope: string
  privileges: string[]
  roleName: string
  inherited: boolean
}

export interface SiteAnalysis {
  findings: TableFinding[]
  allAttributesFindings: AllAttributesFinding[]
  anonymousPermissionFindings: AnonymousPermissionFinding[]
  sourceCount: number
  completenessBlockers: string[]
}

export interface RetrievedCodeFile {
  id: string
  name: string
  content: string
  sourcePath?: string
  recordEntity?: string
  recordId?: string
}

export interface PortalFormReference {
  name: string
  formName: string
  entityName: string
}

export function parseRows(value?: string): Record<string, unknown>[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[]
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { value?: unknown }).value)) {
    return (parsed as { value: Record<string, unknown>[] }).value
  }
  return []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseContent(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function addTextFields(files: SourceFile[], row: Record<string, unknown>, path: string, fields: string[], recordEntity?: string, recordId?: string) {
  for (const field of fields) {
    const content = text(row[field])
    if (content) files.push({ path: `${path}/${field}`, content, recordEntity, recordId })
  }
}

function enhancedCodeRecord(
  componentType: number,
  content: Record<string, unknown>,
  componentName: string,
  payload: SiteConfigurationPayload,
): { entity: string; id: string } | undefined {
  const definitions: Record<number, Array<{ payloadKey: keyof SiteConfigurationPayload; entity: string; id: string; names: string[] }>> = {
    2: [
      { payloadKey: 'standardwebpagesjson', entity: 'adx_webpage', id: 'adx_webpageid', names: ['adx_partialurl', 'adx_name'] },
      { payloadKey: 'modernwebpagesjson', entity: 'mspp_webpage', id: 'mspp_webpageid', names: ['mspp_partialurl', 'mspp_name'] },
    ],
    3: [
      { payloadKey: 'standardwebfilesjson', entity: 'adx_webfile', id: 'adx_webfileid', names: ['adx_partialurl', 'adx_name'] },
      { payloadKey: 'modernwebfilesjson', entity: 'mspp_webfile', id: 'mspp_webfileid', names: ['mspp_partialurl', 'mspp_name'] },
    ],
  }
  const idHints = new Set(Object.entries(content)
    .filter(([key, value]) => key.toLowerCase().endsWith('id') && typeof value === 'string')
    .map(([, value]) => String(value).toLowerCase()))
  const nameHints = new Set([componentName, text(content.name), text(content.partialurl)].filter(Boolean).map((value) => value.toLowerCase()))

  for (const definition of definitions[componentType] ?? []) {
    const rows = parseRows(payload[definition.payloadKey])
    const idMatches = rows.filter((row) => idHints.has(text(row[definition.id]).toLowerCase()))
    const matches = idMatches.length > 0 ? idMatches : rows.filter((row) => definition.names.some((field) => nameHints.has(text(row[field]).toLowerCase())))
    if (matches.length === 1) return { entity: definition.entity, id: text(matches[0][definition.id]) }
  }
  return undefined
}

function enhancedSettingRecord(settingName: string, componentId: string, payload: SiteConfigurationPayload): { entity: 'adx_sitesetting' | 'mspp_sitesetting'; id: string } | undefined {
  const definitions: Array<{ payloadKey: keyof SiteConfigurationPayload; entity: 'adx_sitesetting' | 'mspp_sitesetting'; id: string; name: string }> = [
    { payloadKey: 'standardsettingsjson', entity: 'adx_sitesetting', id: 'adx_sitesettingid', name: 'adx_name' },
    { payloadKey: 'modernsettingsjson', entity: 'mspp_sitesetting', id: 'mspp_sitesettingid', name: 'mspp_name' },
  ]
  for (const definition of definitions) {
    const rows = parseRows(payload[definition.payloadKey])
    const idMatches = rows.filter((row) => text(row[definition.id]).toLowerCase() === componentId.toLowerCase())
    const matches = idMatches.length > 0 ? idMatches : rows.filter((row) => text(row[definition.name]).toLowerCase() === settingName.toLowerCase())
    if (matches.length === 1) return { entity: definition.entity, id: text(matches[0][definition.id]) }
  }
  return undefined
}

function childRows(payload: SiteConfigurationPayload, parentPayload: keyof SiteConfigurationPayload, childPayload: keyof SiteConfigurationPayload, parentId: string, childParentIds: string[]) {
  const parentIds = new Set(parseRows(payload[parentPayload]).map((row) => text(row[parentId])).filter(Boolean))
  return parseRows(payload[childPayload]).filter((row) => childParentIds.some((field) => parentIds.has(text(row[field]))))
}

function addPortalFormReference(references: PortalFormReference[], row: Record<string, unknown>, prefix: 'adx_' | 'mspp_', fallbackName: string) {
  const formName = text(row[`${prefix}formname`])
  const entityName = text(row[`${prefix}entityname`])
  if (!formName || !entityName) return
  references.push({ name: text(row[`${prefix}name`]) || fallbackName, formName, entityName })
}

export function portalFormReferences(model: SiteModel, payload: SiteConfigurationPayload): PortalFormReference[] {
  const references: PortalFormReference[] = []
  const addStandardRows = () => {
    parseRows(payload.standardbasicformsjson).forEach((row) => addPortalFormReference(references, row, 'adx_', 'basic form'))
    childRows(payload, 'standardmultistepformsjson', 'standardmultistepformstepsjson', 'adx_webformid', ['_adx_webform_value', '_adx_webformid_value'])
      .forEach((row) => addPortalFormReference(references, row, 'adx_', 'multistep form step'))
  }
  const addModernRows = () => {
    parseRows(payload.modernbasicformsjson).forEach((row) => addPortalFormReference(references, row, 'mspp_', 'basic form'))
    childRows(payload, 'modernmultistepformsjson', 'modernmultistepformstepsjson', 'mspp_webformid', ['_mspp_webform_value', '_mspp_webformid_value'])
      .forEach((row) => addPortalFormReference(references, row, 'mspp_', 'multistep form step'))
  }

  if (model === 'Standard') addStandardRows()
  else if (model === 'Modern') addModernRows()
  else {
    addStandardRows()
    addModernRows()
    for (const row of parseRows(payload.enhancedcomponentsjson)) {
      if (![15, 20].includes(Number(row.powerpagecomponenttype))) continue
      const content = parseContent(row.content)
      const formName = text(content.formname)
      const entityName = text(content.entityname)
      if (formName && entityName) references.push({ name: text(row.name) || 'form component', formName, entityName })
    }
  }

  return references.filter((reference, index, all) => all.findIndex((candidate) =>
    candidate.formName.toLowerCase() === reference.formName.toLowerCase()
    && candidate.entityName.toLowerCase() === reference.entityName.toLowerCase()) === index)
}

function boolean(value: unknown): boolean {
  return value === true || value === 1 || value === 'true'
}

function privileges(record: Record<string, unknown>, prefix = ''): string[] {
  return ['read', 'write', 'create', 'delete', 'append', 'appendto']
    .filter((name) => boolean(record[`${prefix}${name}`]))
    .map((name) => name === 'appendto' ? 'Append To' : `${name[0].toUpperCase()}${name.slice(1)}`)
}

function scopeName(value: unknown): string {
  const scopes: Record<string, string> = {
    '756150000': 'Global',
    '756150001': 'Contact',
    '756150002': 'Account',
    '756150003': 'Parent',
    '756150004': 'Self',
  }
  return scopes[String(value)] ?? String(value || 'Unknown')
}

function standardAnonymousPermissions(
  model: 'Standard' | 'Modern',
  rows: Record<string, unknown>[],
  roles: Record<string, unknown>[],
  assignments: Record<string, unknown>[],
): AnonymousPermissionFinding[] {
  const prefix = model === 'Standard' ? 'adx_' : 'mspp_'
  const idProperty = `${prefix}entitypermissionid`
  const roleIdProperty = `${prefix}webroleid`
  const parentProperty = `_${prefix}parententitypermission_value`
  const anonymousByPermission = new Map<string, string>()
  const recordsById = new Map(rows.map((row) => [text(row[idProperty]).toLowerCase(), row]))
  const anonymousRoles = new Map(roles
    .filter((role) => boolean(role[`${prefix}anonymoususersrole`]))
    .map((role) => [text(role[roleIdProperty]).toLowerCase(), text(role[`${prefix}name`]) || 'Anonymous Users']))

  for (const assignment of assignments) {
    const roleId = text(assignment[roleIdProperty]).toLowerCase()
    const permissionId = text(assignment[idProperty]).toLowerCase()
    if (anonymousRoles.has(roleId)) anonymousByPermission.set(permissionId, anonymousRoles.get(roleId) ?? 'Anonymous Users')
  }

  return rows.flatMap((row) => {
    const id = text(row[idProperty])
    let currentId = id.toLowerCase()
    let roleName = ''
    let inherited = false
    const visited = new Set<string>()
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      roleName = anonymousByPermission.get(currentId) ?? ''
      if (roleName) break
      const current = recordsById.get(currentId)
      currentId = text(current?.[parentProperty]).toLowerCase()
      inherited = Boolean(currentId)
    }
    if (!roleName) return []
    return [{
      permissionName: text(row[`${prefix}entityname`]) || 'Unnamed table permission',
      permissionRecordId: id,
      permissionRecordEntity: model === 'Standard' ? 'adx_entitypermission' as const : 'mspp_entitypermission' as const,
      table: text(row[`${prefix}entitylogicalname`]) || text(row[`${prefix}entityname`]) || 'Unknown table',
      scope: scopeName(row[`${prefix}scope`]),
      privileges: privileges(row, prefix),
      roleName,
      inherited,
    }]
  })
}

function enhancedAnonymousPermissions(rows: Record<string, unknown>[]): AnonymousPermissionFinding[] {
  const components = rows.map((row) => ({ row, content: parseContent(row.content) }))
  const anonymousRoles = new Map(components
    .filter(({ row, content }) => Number(row.powerpagecomponenttype) === 11 && boolean(content.anonymoususersrole))
    .map(({ row }) => [text(row.powerpagecomponentid).toLowerCase(), text(row.name) || 'Anonymous Users']))
  const permissions = components.filter(({ row }) => Number(row.powerpagecomponenttype) === 18)
  const recordsById = new Map(permissions.map((permission) => [text(permission.row.powerpagecomponentid).toLowerCase(), permission]))

  return permissions.flatMap(({ row, content }) => {
    const id = text(row.powerpagecomponentid)
    let currentId = id.toLowerCase()
    let roleName = ''
    let inherited = false
    const visited = new Set<string>()
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const current = recordsById.get(currentId)
      const roleIds = Array.isArray(current?.content.adx_entitypermission_webrole) ? current.content.adx_entitypermission_webrole : []
      const anonymousRoleId = roleIds.map(String).find((roleId) => anonymousRoles.has(roleId.toLowerCase()))
      if (anonymousRoleId) {
        roleName = anonymousRoles.get(anonymousRoleId.toLowerCase()) ?? 'Anonymous Users'
        break
      }
      currentId = text(current?.content.parententitypermission).toLowerCase()
      inherited = Boolean(currentId)
    }
    if (!roleName) return []
    return [{
      permissionName: text(content.entityname) || text(row.name) || 'Unnamed table permission',
      permissionRecordId: id,
      permissionRecordEntity: 'powerpagecomponent' as const,
      table: text(content.entitylogicalname) || 'Unknown table',
      scope: scopeName(content.scope),
      privileges: privileges(content),
      roleName,
      inherited,
    }]
  })
}

export function isCodeWebFile(name: string): boolean {
  return /\.(?:js|mjs|cjs|ts|tsx|jsx|html?|liquid)$/i.test(name.trim())
}

export function analyzeConfiguration(model: SiteModel, payload: SiteConfigurationPayload, codeFiles: RetrievedCodeFile[] = [], additionalCompletenessBlockers: string[] = []): SiteAnalysis {
  const settings: SiteSetting[] = []
  const files: SourceFile[] = []
  const completenessBlockers: string[] = [...additionalCompletenessBlockers]
  const componentPermissionFindings = model === 'Enhanced' || model === 'Modern'
    ? enhancedAnonymousPermissions(parseRows(payload.enhancedcomponentsjson))
    : []
  const modernPermissionIds = new Set(parseRows(payload.modernpermissionsjson)
    .map((row) => text(row.mspp_entitypermissionid).toLowerCase())
    .filter(Boolean))
  const navigableComponentPermissionFindings = model === 'Modern' || model === 'Enhanced'
    ? componentPermissionFindings.map((finding): AnonymousPermissionFinding => modernPermissionIds.has(finding.permissionRecordId.toLowerCase())
      ? { ...finding, permissionRecordEntity: 'mspp_entitypermission' }
      : finding)
    : componentPermissionFindings
  const recordPermissionFindings = model === 'Standard' || model === 'Modern'
    ? standardAnonymousPermissions(
      model,
      parseRows(model === 'Standard' ? payload.standardpermissionsjson : payload.modernpermissionsjson),
      parseRows(model === 'Standard' ? payload.standardrolesjson : payload.modernrolesjson),
      parseRows(model === 'Standard' ? payload.standardpermissionrolesjson : payload.modernpermissionrolesjson),
    )
    : []
  const anonymousPermissionFindings = [...navigableComponentPermissionFindings, ...recordPermissionFindings]
    .filter((finding, index, all) => all.findIndex((candidate) => candidate.permissionRecordId.toLowerCase() === finding.permissionRecordId.toLowerCase()) === index)
  const codeFilesById = new Map(codeFiles.map((file) => [file.id, file]))

  codeFiles.filter((file) => file.recordEntity === 'webresource').forEach((file) => files.push({
    path: file.sourcePath || `Form web resource/${file.name}`,
    content: file.content,
    recordEntity: file.recordEntity,
    recordId: file.recordId || file.id,
  }))

  if (model === 'Enhanced') {
    for (const row of parseRows(payload.enhancedcomponentsjson)) {
      const content = parseContent(row.content)
      const componentType = Number(row.powerpagecomponenttype)
      const name = text(row.name) || `component-${text(row.powerpagecomponentid)}`
      const settingName = text(content.name) || text(row.name)
      if (componentType === 9 && settingName) {
        const navigationRecord = enhancedSettingRecord(settingName, text(row.powerpagecomponentid), payload)
        settings.push({
          name: settingName,
          value: text(content.value),
          recordId: text(row.powerpagecomponentid),
          recordEntity: 'powerpagecomponent',
          navigationRecordEntity: navigationRecord?.entity,
          navigationRecordId: navigationRecord?.id,
        })
      }
      if ([2, 7, 8, 15, 20].includes(componentType)) {
        const record = enhancedCodeRecord(componentType, content, name, payload)
        addTextFields(files, content, name, ['copy', 'customjavascript', 'source', 'registerstartupscript', 'value'], record?.entity, record?.id)
      }
      if (componentType === 3) {
        if (!isCodeWebFile(name)) continue
        const codeFile = codeFilesById.get(text(row.powerpagecomponentid))
        const record = enhancedCodeRecord(componentType, content, name, payload)
        if (codeFile) files.push({ path: codeFile.name || name, content: codeFile.content, recordEntity: record?.entity, recordId: record?.id })
        else completenessBlockers.push(`Web file '${name}' was found, but its file-column bytes were not returned by the retrieve flow.`)
      }
    }
  } else if (model === 'Standard') {
    for (const row of parseRows(payload.standardsettingsjson)) {
      settings.push({
        name: text(row.adx_name),
        value: text(row.adx_value),
        recordId: text(row.adx_sitesettingid),
        recordEntity: 'adx_sitesetting',
      })
    }
    parseRows(payload.standardwebpagesjson).forEach((row) => addTextFields(files, row, text(row.adx_name) || 'web-page', ['adx_copy', 'adx_customjavascript', 'adx_customcss'], 'adx_webpage', text(row.adx_webpageid)))
    parseRows(payload.standardwebtemplatesjson).forEach((row) => addTextFields(files, row, text(row.adx_name) || 'web-template', ['adx_source'], 'adx_webtemplate', text(row.adx_webtemplateid)))
    parseRows(payload.standardcontentsnippetsjson).forEach((row) => addTextFields(files, row, text(row.adx_name) || 'content-snippet', ['adx_value'], 'adx_contentsnippet', text(row.adx_contentsnippetid)))
    parseRows(payload.standardbasicformsjson).forEach((row) => addTextFields(files, row, text(row.adx_name) || 'basic-form', ['adx_registerstartupscript'], 'adx_entityform', text(row.adx_entityformid)))
    childRows(payload, 'standardmultistepformsjson', 'standardmultistepformstepsjson', 'adx_webformid', ['_adx_webform_value', '_adx_webformid_value'])
      .forEach((row) => addTextFields(files, row, text(row.adx_name) || 'multistep-form-step', ['adx_registerstartupscript'], 'adx_webformstep', text(row.adx_webformstepid)))
    for (const row of parseRows(payload.standardwebfilesjson)) {
      const id = text(row.adx_webfileid)
      const name = text(row.adx_partialurl) || text(row.adx_name)
      if (!isCodeWebFile(name)) continue
      const codeFile = codeFilesById.get(id)
      if (codeFile) files.push({ path: codeFile.name || name, content: codeFile.content, recordEntity: 'adx_webfile', recordId: id })
      else completenessBlockers.push(`Standard web file '${text(row.adx_name) || id}' was found, but its annotation bytes were not returned by the retrieve flow.`)
    }
  } else {
    for (const row of parseRows(payload.modernsettingsjson)) {
      settings.push({
        name: text(row.mspp_name),
        value: text(row.mspp_value),
        recordId: text(row.mspp_sitesettingid),
        recordEntity: 'mspp_sitesetting',
      })
    }
    parseRows(payload.modernwebpagesjson).forEach((row) => addTextFields(files, row, text(row.mspp_name) || 'web-page', ['mspp_copy', 'mspp_customjavascript', 'mspp_customcss'], 'mspp_webpage', text(row.mspp_webpageid)))
    parseRows(payload.modernwebtemplatesjson).forEach((row) => addTextFields(files, row, text(row.mspp_name) || 'web-template', ['mspp_source'], 'mspp_webtemplate', text(row.mspp_webtemplateid)))
    parseRows(payload.moderncontentsnippetsjson).forEach((row) => addTextFields(files, row, text(row.mspp_name) || 'content-snippet', ['mspp_value'], 'mspp_contentsnippet', text(row.mspp_contentsnippetid)))
    parseRows(payload.modernbasicformsjson).forEach((row) => addTextFields(files, row, text(row.mspp_name) || 'basic-form', ['mspp_registerstartupscript'], 'mspp_entityform', text(row.mspp_entityformid)))
    childRows(payload, 'modernmultistepformsjson', 'modernmultistepformstepsjson', 'mspp_webformid', ['_mspp_webform_value', '_mspp_webformid_value'])
      .forEach((row) => addTextFields(files, row, text(row.mspp_name) || 'multistep-form-step', ['mspp_registerstartupscript'], 'mspp_webformstep', text(row.mspp_webformstepid)))
    for (const row of parseRows(payload.modernwebfilesjson)) {
      const id = text(row.mspp_webfileid)
      const name = text(row.mspp_partialurl) || text(row.mspp_name)
      if (!isCodeWebFile(name)) continue
      const codeFile = codeFilesById.get(id)
      if (codeFile) files.push({ path: codeFile.name || name, content: codeFile.content, recordEntity: 'mspp_webfile', recordId: id })
      else completenessBlockers.push(`Modern web file '${text(row.mspp_name) || id}' was found, but its annotation bytes were not returned by the retrieve flow.`)
    }
  }

  const findings = analyzeSite(settings, files).map((finding) => completenessBlockers.length === 0 ? finding : {
    ...finding,
    confidence: 'blocked' as const,
    blockers: [...finding.blockers, ...completenessBlockers],
  })
  const allAttributesFindings = findAllAttributes(settings, files)
  return { findings, allAttributesFindings, anonymousPermissionFindings, sourceCount: files.length, completenessBlockers }
}
