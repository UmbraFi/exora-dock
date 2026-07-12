const WORK_RUN_EVENT_CACHE_LIMIT = 60

function createWorkspaceSnapshot(deps) {
  const workRunEventCache = new Map()

  return {
    snapshot: async function workspaceSnapshot() {
      const paths = await deps.dockPaths()
      await deps.ensureLocalLayout(paths)
      const folderStatus = await deps.projectFoldersStatus(paths)
      const workMcpLeases = await deps.activeWorkMCPLeases(paths)
      if (!(await deps.healthOk())) {
        return {
          online: false,
          orderPlans: [],
          approvals: [],
          tasks: [],
          payments: [],
          buyerFlows: [],
          mcpConnections: [],
          workMcpLeases,
          workRuns: [],
          ...folderStatus,
          errors: ['local daemon is offline'],
        }
      }

      const token = await deps.localOwnerToken(paths)
      const errors = []
      const [
        orderPlans,
        approvals,
        tasks,
        payments,
        buyerFlows,
        mcpConnections,
        workRuns,
      ] = await Promise.all([
        snapshotArray(deps.httpJson('GET', '/v1/order-plans?status=pending_selection', undefined, token), 'orderPlans', errors, deps.errorMessage),
        snapshotArray(deps.httpJson('GET', '/v1/approvals?status=pending', undefined, token), 'approvals', errors, deps.errorMessage),
        snapshotArray(deps.httpJson('GET', '/v1/tasks', undefined, token), 'tasks', errors, deps.errorMessage),
        snapshotArray(deps.httpJson('GET', '/v1/payments', undefined, token), 'payments', errors, deps.errorMessage),
        snapshotArray(deps.httpJson('GET', '/v1/buyer-flows', undefined, token), 'buyerFlows', errors, deps.errorMessage),
        snapshotArray(deps.httpJson('GET', '/v1/mcp/connections', undefined, token), 'mcpConnections', errors, deps.errorMessage),
        snapshotArray(deps.httpJson('GET', '/v1/work-runs', undefined, token), 'workRuns', errors, deps.errorMessage),
      ])
      const workRunEvents = await snapshotWorkRunEvents(workRuns, token, errors, deps, workRunEventCache)
      await deps.addConnectionProjectFolders(paths, mcpConnections)
      await deps.addActivityProjectFolders(paths, orderPlans, tasks)
      const updatedFolderStatus = await deps.projectFoldersStatus(paths)
      return {
        online: true,
        orderPlans,
        approvals,
        tasks,
        payments,
        buyerFlows,
        mcpConnections,
        workMcpLeases,
        workRuns,
        workRunEvents,
        ...updatedFolderStatus,
        errors,
      }
    },
  }
}

async function snapshotArray(promise, key, errors, errorMessage) {
  try {
    const value = await promise
    if (Array.isArray(value)) return value
    return Array.isArray(value?.[key]) ? value[key] : []
  } catch (error) {
    errors.push(`${key}: ${errorMessage(error)}`)
    return []
  }
}

async function snapshotWorkRunEvents(workRuns, token, errors, deps, workRunEventCache) {
  const selectedRuns = [...(Array.isArray(workRuns) ? workRuns : [])]
    .sort((a, b) => Date.parse(b?.updatedAt || b?.createdAt || '') - Date.parse(a?.updatedAt || a?.createdAt || ''))
    .filter((run, index) => index < 20 || ['queued', 'running', 'waiting_owner_choice', 'waiting_owner_approval', 'waiting_worker', 'stop_requested'].includes(String(run?.status || '')))
    .slice(0, 30)
  const entries = await Promise.all(selectedRuns.map(async (run) => {
    const runId = String(run?.runId || '').trim()
    if (!runId) return undefined
    const cacheKey = workRunEventCacheKey(run)
    const cached = workRunEventCache.get(runId)
    if (cached?.key === cacheKey) {
      return [runId, cached.events]
    }
    try {
      const value = await deps.httpJson('GET', `/v1/work-runs/${encodeURIComponent(runId)}/events`, undefined, token, { timeoutMs: 1800, retryOnOffline: false })
      const events = Array.isArray(value?.events) ? value.events.slice(-20) : []
      workRunEventCache.set(runId, { key: cacheKey, events })
      return [runId, events]
    } catch (error) {
      if (cached?.events) {
        return [runId, cached.events]
      }
      errors.push(`workRunEvents:${runId}: ${deps.errorMessage(error)}`)
      return [runId, []]
    }
  }))
  pruneWorkRunEventCache(selectedRuns, workRunEventCache)
  return Object.fromEntries(entries.filter(Boolean))
}

function workRunEventCacheKey(run) {
  return [
    run?.runId,
    run?.updatedAt,
    run?.lastCheckpointId,
    run?.status,
    run?.currentStep,
  ].map((value) => String(value || '')).join('|')
}

function pruneWorkRunEventCache(selectedRuns, workRunEventCache) {
  const selected = new Set(selectedRuns.map((run) => String(run?.runId || '').trim()).filter(Boolean))
  for (const key of workRunEventCache.keys()) {
    if (!selected.has(key) && workRunEventCache.size > WORK_RUN_EVENT_CACHE_LIMIT) {
      workRunEventCache.delete(key)
    }
  }
  while (workRunEventCache.size > WORK_RUN_EVENT_CACHE_LIMIT) {
    const oldest = workRunEventCache.keys().next().value
    if (!oldest) break
    workRunEventCache.delete(oldest)
  }
}

module.exports = {
  createWorkspaceSnapshot,
}
