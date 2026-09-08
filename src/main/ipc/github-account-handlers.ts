import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { GithubPatAccountMeta } from '../../shared/github/github-account-ref'
import { appStarSourceSchema } from '../../shared/gh-star-source'
import type { Store } from '../persistence'
import { diagnoseGhAuth } from '../github/auth-diagnose'
import { checkOrcaStarred, getAuthenticatedViewer, starOrca } from '../github/client'
import { deleteGithubPatToken, saveGithubPatToken } from '../github/github-pat-store'
import { invalidateGithubAccountToken } from '../github/github-account-env'
import { getRateLimit } from '../github/rate-limit'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'
import { track } from '../telemetry/client'

export function registerGitHubAccountHandlers(store: Store): void {
  ipcMain.handle('gh:viewer', () => getAuthenticatedViewer())
  ipcMain.handle('gh:checkOrcaStarred', () => checkOrcaStarred())
  ipcMain.handle('gh:starOrca', async (_event, source: unknown) => {
    const sourceParse = appStarSourceSchema.safeParse(source)
    const starred = await starOrca()
    if (starred && sourceParse.success) {
      track('app_starred_orca', {
        source: sourceParse.data,
        ...getCohortAtEmit()
      })
    }
    return starred
  })

  ipcMain.handle('gh:rateLimit', (_event, args?: { force?: boolean }) =>
    getRateLimit(args?.force ? { force: true } : undefined)
  )

  ipcMain.handle('gh:diagnoseAuth', (_event, args?: { host?: string }) =>
    diagnoseGhAuth(args?.host)
  )

  ipcMain.handle(
    'gh:addPatAccount',
    (_event, args: { label: string; host?: string; token: string }) => {
      const label = String(args.label ?? '').trim()
      const token = String(args.token ?? '').trim()
      const host = String(args.host ?? '').trim() || 'github.com'
      if (!label || !token) {
        throw new Error('A label and token are required')
      }
      const meta: GithubPatAccountMeta = { id: randomUUID(), label, host }
      saveGithubPatToken(meta.id, token)
      const existing = store.getSettings().githubPatAccounts ?? []
      store.updateSettings({ githubPatAccounts: [...existing, meta] }, { notifyListeners: true })
      return meta
    }
  )

  ipcMain.handle('gh:removePatAccount', (_event, args: { id: string }) => {
    const existing = store.getSettings().githubPatAccounts ?? []
    store.updateSettings(
      { githubPatAccounts: existing.filter((meta) => meta.id !== args.id) },
      { notifyListeners: true }
    )
    deleteGithubPatToken(args.id)
    invalidateGithubAccountToken(`pat:${args.id}`)
    return true
  })
}
