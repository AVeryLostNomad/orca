import { PANE_USAGE_MAX_ACCOUNTS, PANE_USAGE_MAX_LIMITS } from '../../shared/pane-usage-body'

// Converts omp UsageReports into the accounts one omp session routes through.
export function getOmpPaneUsageAccountSourceLines(): string[] {
  return [
    `const PANE_USAGE_MAX_ACCOUNTS = ${PANE_USAGE_MAX_ACCOUNTS}`,
    `const PANE_USAGE_MAX_LIMITS = ${PANE_USAGE_MAX_LIMITS}`,
    ...String.raw`
function paneUsageIdentityValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined
}

// Mirrors omp's limitMatchesActiveAccount so sibling accounts never claim this session's quota.
function paneUsageLimitMatches(report, limit, identity): boolean {
  const metadata = report?.metadata ?? {}
  const accountId = paneUsageIdentityValue(identity.accountId)
  const email = paneUsageIdentityValue(identity.email)
  const projectId = paneUsageIdentityValue(identity.projectId)
  const orgId = paneUsageIdentityValue(identity.orgId)
  const reportOrgId = paneUsageIdentityValue(metadata.orgId)
  if (orgId || reportOrgId) {
    if (orgId !== reportOrgId) return false
    if (!accountId && !email && !projectId) return true
  }
  // omp 18: emails on both sides decide alone (Team seats share account ids).
  const reportEmail = paneUsageIdentityValue(metadata.email)
  if (email && reportEmail) return email === reportEmail
  if (accountId) {
    const reportAccountId = paneUsageIdentityValue(metadata.accountId) ?? paneUsageIdentityValue(metadata.account_id)
    if (reportAccountId === accountId || paneUsageIdentityValue(limit?.scope?.accountId) === accountId) return true
  }
  if (projectId) {
    if (paneUsageIdentityValue(metadata.projectId) === projectId) return true
    if (paneUsageIdentityValue(limit?.scope?.projectId) === projectId) return true
  }
  return false
}

function paneUsagePercent(amount): number | null {
  if (!amount || typeof amount !== 'object') return null
  let value = NaN
  if (typeof amount.usedFraction === 'number') value = amount.usedFraction * 100
  else if (typeof amount.remainingFraction === 'number') value = (1 - amount.remainingFraction) * 100
  else if (amount.unit === 'percent' && typeof amount.used === 'number') value = amount.used
  else if (typeof amount.used === 'number' && typeof amount.limit === 'number' && amount.limit > 0) value = (amount.used / amount.limit) * 100
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
}

function paneUsageLimit(limit) {
  const usedPercent = paneUsagePercent(limit?.amount)
  const id = typeof limit?.id === 'string' ? limit.id : ''
  if (usedPercent === null || !id) return null
  const durationMs = limit.window?.durationMs
  const resetsAt = limit.window?.resetsAt
  return {
    id,
    label: typeof limit.label === 'string' && limit.label ? limit.label : (limit.window?.label || id),
    usedPercent,
    windowMinutes: typeof durationMs === 'number' && durationMs > 0 ? Math.round(durationMs / 60000) : null,
    resetsAt: typeof resetsAt === 'number' && Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt : null,
  }
}

// Same label omp's /usage marks the session's account with: base identity plus a distinct org.
function paneUsageAccountLabel(identity, metadata): string | null {
  const source = identity ?? metadata ?? {}
  const base = source.email || source.accountId || source.projectId
  if (typeof base !== 'string' || !base) return null
  const org = source.orgName || source.orgId
  return typeof org === 'string' && org && org !== base ? base + ' (' + org + ')' : base
}

// One account per provider: the one this session routes to, else the only one known.
function paneUsageAccounts(reports, authStorage, sessionId, activeProvider: string) {
  const byProvider = new Map()
  for (const report of Array.isArray(reports) ? reports : []) {
    const provider = typeof report?.provider === 'string' ? report.provider : ''
    if (!provider || !Array.isArray(report.limits)) continue
    const list = byProvider.get(provider)
    if (list) list.push(report)
    else byProvider.set(provider, [report])
  }
  const accounts = []
  for (const [provider, providerReports] of byProvider) {
    let identity
    try {
      // omp 18 moved identity onto the oauth facet; older builds expose it on AuthStorage.
      identity =
        typeof authStorage.oauth?.identity === 'function'
          ? authStorage.oauth.identity(provider, sessionId)
          : authStorage.getOAuthAccountIdentity?.(provider, sessionId)
    } catch {
      identity = undefined
    }
    let report = null
    let limits = []
    if (identity) {
      for (const candidate of providerReports) {
        const matched = candidate.limits.filter((limit) => paneUsageLimitMatches(candidate, limit, identity))
        if (matched.length > 0) {
          report = candidate
          limits = matched
          break
        }
      }
    }
    if (!report && providerReports.length === 1) {
      report = providerReports[0]
      limits = report.limits
    }
    if (!report) continue
    const converted = []
    for (const limit of limits) {
      if (converted.length >= PANE_USAGE_MAX_LIMITS) break
      const entry = paneUsageLimit(limit)
      if (entry) converted.push(entry)
    }
    accounts.push({
      provider,
      label: paneUsageAccountLabel(identity, report.metadata),
      active: provider === activeProvider,
      limits: converted,
    })
  }
  // The session's own provider survives the cap.
  accounts.sort((a, b) => Number(b.active) - Number(a.active))
  return accounts.slice(0, PANE_USAGE_MAX_ACCOUNTS)
}
`.split('\n')
  ]
}
