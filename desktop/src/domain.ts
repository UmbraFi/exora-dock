export type AppStatus = {
  docker: string
  container: string
  daemon: string
  image: string
  containerName: string
  imageTag: string
  baseUrl: string
  dataDir: string
  configPath: string
  discoveryPath: string
  mcpCommand: string
  agentPrompt: string
  opencodeConfig: string
  message: string
}

export type CapabilityValidationIssue = {
  operationId?: string
  fieldPath: string
  errorCode: string
  message: string
}

export function capabilityValidationIssues(error: unknown): CapabilityValidationIssue[] {
  const text = String(error)
  const jsonStart = text.indexOf('{')
  if (jsonStart < 0) return []
  try {
    const parsed = JSON.parse(text.slice(jsonStart))
    if (!Array.isArray(parsed?.issues)) return []
    return parsed.issues.filter((value: unknown): value is CapabilityValidationIssue => {
      if (!value || typeof value !== 'object') return false
      const issue = value as Record<string, unknown>
      return typeof issue.fieldPath === 'string'
        && typeof issue.errorCode === 'string'
        && typeof issue.message === 'string'
    })
  } catch {
    return []
  }
}

export function humanizeError(error: unknown) {
  let text = String(error)
  for (let i = 0; i < 4; i += 1) {
    const next = text
      .replace(/^Error:\s*/, '')
      .replace(/^Error invoking remote method '[^']+':\s*/, '')
      .replace(/^Error occurred in handler for '[^']+':\s*/, '')
      .replace(/^TypeError:\s*/, '')
    if (next === text) break
    text = next
  }
  const jsonStart = text.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart))
      if (parsed?.statusReason) return String(parsed.statusReason)
      if (parsed?.error) return String(parsed.error)
    } catch {
      // Fall through to plain text.
    }
  }
  const lower = text.toLowerCase()
  if (lower.includes('fetch failed') || lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('socket hang up')) {
    return 'Network request failed. Check that the local Exora Dock runtime is running, then try again.'
  }
  return text.replace(/^Error:\s*/, '')
}

export function escapeHTML(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch] || ch))
}
