export type FlowOutput = Record<string, string | undefined>

export function normalizeFlowOutput(output: FlowOutput): FlowOutput {
  return Object.fromEntries(Object.entries(output).map(([key, value]) => [key.toLowerCase(), value]))
}