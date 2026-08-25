import type { IOperationResult } from '@microsoft/power-apps/data'
import { getClient } from '@microsoft/power-apps/data'
import { dataSourcesInfo } from '../.power/schemas/appschemas/dataSourcesInfo'
import { flowErrorMessage } from './errorMessage'
import { normalizeFlowOutput, type FlowOutput } from './flowOutput'

const client = getClient(dataSourcesInfo)

async function runFlow(dataSourceName: string, input: Record<string, string>): Promise<FlowOutput> {
  const result = await client.executeAsync<{ input: Record<string, string>; 'api-version': string }, FlowOutput>({
    connectorOperation: {
      tableName: dataSourceName,
      operationName: 'Run',
      parameters: { input, 'api-version': '2015-02-01-preview' },
    },
  }) as IOperationResult<FlowOutput>

  if (!result.success) throw new Error(result.error ? flowErrorMessage(result.error) : `Flow '${dataSourceName}' failed.`)
  return normalizeFlowOutput(result.data)
}

export const flowGateway = {
  discoverEnvironments: () => runFlow('ppwfa_discoverenvironments', {}),
  discoverSites: (targetEnvironment: string) => runFlow('ppwfa_discoversites', { targetEnvironment }),
  retrieveSite: (targetEnvironment: string, siteId: string, modelKind: string) =>
    runFlow('ppwfa_retrievesiteconfiguration', { targetEnvironment, siteId, modelKind }),
  retrieveCodeFile: (targetEnvironment: string, modelKind: string, fileId: string, fileName: string) =>
    runFlow('ppwfa_retrievecodefile', { targetEnvironment, modelKind, fileId, fileName }),
  apply: (input: { targetEnvironment: string; modelKind: string; settingId: string; settingName: string; approvedValue: string }) =>
    runFlow('ppwfa_applyapprovedfields', input),
  restore: (input: { targetEnvironment: string; modelKind: string; settingId: string; settingName: string; expectedCurrentValue: string; restoreValue: string }) =>
    runFlow('ppwfa_restorepreviousfields', input),
  verify: (targetEnvironment: string, modelKind: string, settingId: string) =>
    runFlow('ppwfa_verifyappliedfields', { targetEnvironment, modelKind, settingId }),
}
