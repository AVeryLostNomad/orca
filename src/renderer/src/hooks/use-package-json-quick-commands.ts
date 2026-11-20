import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { useKnownWorktreeById, useWorktreesForRepo } from '@/store/selectors'
import { joinPath } from '@/lib/path'
import { getNestedWorktreeExcludePaths } from '@/components/quick-open-nested-worktrees'
import {
  getFileExplorerOperationOwner,
  getFileExplorerOperationRoute
} from '@/components/right-sidebar/file-explorer-operation-owner'
import { listRuntimeFiles } from '@/runtime/runtime-file-search-client'
import { readRuntimeFileContent } from '@/runtime/runtime-file-read-client'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client-types'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import {
  buildLockfileManagerIndex,
  buildPackageScriptQuickCommands,
  comparePackageJsonPaths,
  getLockfileManager,
  getPackageJsonManifestPackageManager,
  isPackageJsonPath
} from '@/lib/package-json-quick-commands'
import {
  getHostedTerminalQuickCommandKey,
  type HostedTerminalQuickCommand
} from '@/hooks/use-terminal-quick-command-hosts'

// Bound the work for very large monorepos; scripts past this many packages are skipped.
const MAX_PACKAGE_JSON_FILES = 40
const LISTING_MAX_RESULTS = 20_000

const EMPTY: HostedTerminalQuickCommand[] = []
// Why: keep the last scan per worktree so reopening the menu shows scripts instantly while it rescans.
const cache = new Map<string, HostedTerminalQuickCommand[]>()

async function scanPackageScripts(args: {
  worktreeId: string
  worktreePath: string
  excludePaths: string[]
}): Promise<HostedTerminalQuickCommand[]> {
  const route = getFileExplorerOperationRoute(getFileExplorerOperationOwner(args.worktreeId))
  if (!route) {
    return []
  }
  const context: RuntimeFileOperationArgs = {
    target: route.target,
    worktreeId: args.worktreeId,
    worktreePath: args.worktreePath,
    ...(route.connectionId ? { connectionId: route.connectionId } : {})
  }
  const isLocalListing = route.target.kind !== 'environment' && !route.connectionId
  const list = (nameFilter?: string): Promise<string[]> =>
    listRuntimeFiles(context, {
      rootPath: args.worktreePath,
      includeIgnored: false,
      allowLegacyIncludeIgnored: true,
      excludePaths: args.excludePaths.length > 0 ? args.excludePaths : undefined,
      maxResults: LISTING_MAX_RESULTS,
      ...(nameFilter ? { nameFilter } : {})
    })
  // Local hosts filter by name on the host; remote hosts return the full listing once.
  const paths = isLocalListing
    ? (await Promise.all([list('package.json'), list('lock')])).flat()
    : await list()

  const lockfiles = buildLockfileManagerIndex(paths.filter((p) => getLockfileManager(p) !== null))
  const packageJsonPaths = Array.from(
    new Set(paths.map((p) => p.replace(/\\/g, '/')).filter(isPackageJsonPath))
  )
    .sort(comparePackageJsonPaths)
    .slice(0, MAX_PACKAGE_JSON_FILES)
  if (packageJsonPaths.length === 0) {
    return []
  }

  const contents = await Promise.all(
    packageJsonPaths.map(async (relativePath) => {
      try {
        const result = await readRuntimeFileContent({
          target: context.target,
          filePath: joinPath(args.worktreePath, relativePath),
          relativePath,
          worktreeId: args.worktreeId,
          ...(context.connectionId ? { connectionId: context.connectionId } : {})
        })
        return result.isBinary ? null : { relativePath, content: result.content }
      } catch {
        return null
      }
    })
  )
  const rootManifest = contents.find((entry) => entry?.relativePath === 'package.json')
  const rootPackageManager = rootManifest
    ? getPackageJsonManifestPackageManager(rootManifest.content)
    : null

  const hostId = getExecutionHostIdForWorktree(useAppStore.getState(), args.worktreeId)
  const hostLabel = 'package.json'
  const result: HostedTerminalQuickCommand[] = []
  for (const entry of contents) {
    if (!entry) {
      continue
    }
    for (const script of buildPackageScriptQuickCommands({
      packageJsonPath: entry.relativePath,
      content: entry.content,
      lockfiles,
      rootPackageManager
    })) {
      result.push({
        command: script.command,
        hostId,
        hostLabel,
        key: getHostedTerminalQuickCommandKey(hostId, script.command.id),
        source: {
          kind: 'package-json',
          packageJsonPath: script.packageJsonPath
        }
      })
    }
  }
  return result
}

/** Scripts from every package.json in the worktree, offered as automatic quick commands. */
export function usePackageJsonQuickCommands(
  worktreeId: string,
  enabled = true
): { commands: HostedTerminalQuickCommand[]; refresh: () => void } {
  const worktree = useKnownWorktreeById(enabled ? worktreeId : null)
  const worktreePath = worktree?.path ?? null
  const repoWorktrees = useWorktreesForRepo(worktree?.repoId ?? null)
  const [commands, setCommands] = useState<HostedTerminalQuickCommand[]>(
    () => cache.get(worktreeId) ?? EMPTY
  )
  const [refreshToken, setRefreshToken] = useState(0)
  const repoWorktreesRef = useRef(repoWorktrees)
  repoWorktreesRef.current = repoWorktrees

  useEffect(() => {
    setCommands(cache.get(worktreeId) ?? EMPTY)
  }, [worktreeId])

  useEffect(() => {
    if (!enabled || !worktreePath) {
      return
    }
    let cancelled = false
    void scanPackageScripts({
      worktreeId,
      worktreePath,
      excludePaths: getNestedWorktreeExcludePaths(
        worktreeId,
        worktreePath,
        repoWorktreesRef.current
      )
    })
      .then((next) => {
        cache.set(worktreeId, next)
        if (!cancelled) {
          setCommands(next)
        }
      })
      .catch(() => {
        // Automatic scripts are best-effort; keep whatever the last successful scan found.
      })
    return () => {
      cancelled = true
    }
  }, [enabled, refreshToken, worktreeId, worktreePath])

  const refresh = useCallback((): void => setRefreshToken((token) => token + 1), [])
  return { commands: enabled ? commands : EMPTY, refresh }
}
