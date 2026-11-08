import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { getConnectionId } from '@/lib/connection-context'
import { getRuntimeTargetForWorktreeOwner } from '@/lib/file-owner-runtime-target'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { selectFolderWorkspaces, selectWorktreesByRepo } from '@/store/workspace-record-selectors'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { isPathInsideOrEqual } from '../../../../shared/cross-platform-path'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type {
  UnityCliStatus,
  UnityEditorState,
  UnityPipelineStatus,
  UnityProjectInfo
} from '../../../../shared/unity-types'

export type UnityProjectSnapshot = {
  projectRoot: string
  info: UnityProjectInfo | null
  editorState: UnityEditorState | null
  pipelineStatus: UnityPipelineStatus | null
}

export type ActiveUnityProject = UnityProjectSnapshot & {
  cliStatus: UnityCliStatus | null
}

type ProjectEntry = {
  snapshot: UnityProjectSnapshot
  editorStateRefs: number
  unsubscribeEditorState: (() => void) | null
  infoRequested: boolean
  pipelineRequested: boolean
}

const rootsByWorkspace = new Map<string, Promise<string[]>>()
const projects = new Map<string, ProjectEntry>()
const listeners = new Set<() => void>()
let cliStatus: UnityCliStatus | null = null
let cliStatusRequest: Promise<UnityCliStatus | null> | null = null

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isUnityIntegrationEnabled(settings: GlobalSettings | null | undefined): boolean {
  return settings?.unityIntegrationEnabled !== false
}

/** Local workspace root for Unity features; SSH and runtime-environment workspaces resolve to null. */
export function resolveLocalUnityWorkspaceRoot(
  worktreeId: string | null | undefined
): string | null {
  if (!worktreeId) {
    return null
  }
  const state = useAppStore.getState()
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type === 'folder') {
    const workspace = selectFolderWorkspaces(state).find(
      (candidate) => candidate.id === scope.folderWorkspaceId
    )
    return workspace && !workspace.connectionId ? workspace.folderPath : null
  }
  if (getConnectionId(worktreeId) !== null) {
    return null
  }
  if (getRuntimeTargetForWorktreeOwner(state, worktreeId)?.kind !== 'local') {
    return null
  }
  return findWorktreeById(selectWorktreesByRepo(state), worktreeId)?.path ?? null
}

/** Unity project roots at or below a local workspace root, cached for the session. */
export function loadUnityProjectRoots(workspaceRoot: string): Promise<string[]> {
  let request = rootsByWorkspace.get(workspaceRoot)
  if (!request) {
    const findProjectRoots = window.api?.unity?.findProjectRoots
    request = findProjectRoots
      ? findProjectRoots({ rootPath: workspaceRoot }).catch(() => [])
      : Promise.resolve([])
    rootsByWorkspace.set(workspaceRoot, request)
  }
  return request
}

export function unityProjectRootFor(roots: readonly string[], path: string): string | null {
  return roots.find((root) => isPathInsideOrEqual(root, path)) ?? null
}

/** Unity roots of a workspace (empty while loading, remote, or with integration off). */
export function useUnityWorkspaceProjectRoots(worktreeId: string | null | undefined): string[] {
  const enabled = useAppStore((s) => isUnityIntegrationEnabled(s.settings))
  const workspaceRoot = enabled ? resolveLocalUnityWorkspaceRoot(worktreeId) : null
  const [loaded, setLoaded] = useState<{ workspaceRoot: string; roots: string[] } | null>(null)
  useEffect(() => {
    if (!workspaceRoot) {
      return
    }
    let cancelled = false
    void loadUnityProjectRoots(workspaceRoot).then((roots) => {
      if (!cancelled) {
        setLoaded({ workspaceRoot, roots })
      }
    })
    return () => {
      cancelled = true
    }
  }, [workspaceRoot])
  return workspaceRoot && loaded?.workspaceRoot === workspaceRoot ? loaded.roots : EMPTY_ROOTS
}

const EMPTY_ROOTS: string[] = []

function ensureEntry(projectRoot: string): ProjectEntry {
  let entry = projects.get(projectRoot)
  if (!entry) {
    entry = {
      snapshot: { projectRoot, info: null, editorState: null, pipelineStatus: null },
      editorStateRefs: 0,
      unsubscribeEditorState: null,
      infoRequested: false,
      pipelineRequested: false
    }
    projects.set(projectRoot, entry)
  }
  return entry
}

function patchSnapshot(projectRoot: string, patch: Partial<UnityProjectSnapshot>): void {
  const entry = ensureEntry(projectRoot)
  entry.snapshot = { ...entry.snapshot, ...patch }
  notify()
}

export async function refreshUnityProjectInfo(projectRoot: string): Promise<void> {
  ensureEntry(projectRoot).infoRequested = true
  const info = await window.api?.unity?.getProjectInfo({ path: projectRoot }).catch(() => null)
  patchSnapshot(projectRoot, { info: info ?? null })
}

export async function refreshUnityPipelineStatus(projectRoot: string): Promise<void> {
  ensureEntry(projectRoot).pipelineRequested = true
  const status = await window.api?.unity?.getPipelineStatus({ projectRoot }).catch(() => null)
  patchSnapshot(projectRoot, { pipelineStatus: status ?? null })
}

export async function refreshUnityEditorState(
  projectRoot: string
): Promise<UnityEditorState | null> {
  const state = await window.api?.unity?.getEditorState({ projectRoot }).catch(() => null)
  if (state) {
    patchSnapshot(projectRoot, { editorState: state })
  }
  return state ?? null
}

export function refreshUnityCliStatus(): Promise<UnityCliStatus | null> {
  const getCliStatus = window.api?.unity?.getCliStatus
  cliStatusRequest = (getCliStatus ? getCliStatus().catch(() => null) : Promise.resolve(null)).then(
    (status) => {
      cliStatus = status
      notify()
      return status
    }
  )
  return cliStatusRequest
}

/** Last known editor state, without starting a subscription. */
export function getUnityEditorStateSnapshot(projectRoot: string): UnityEditorState | null {
  return projects.get(projectRoot)?.snapshot.editorState ?? null
}

function retainEditorState(projectRoot: string): () => void {
  const entry = ensureEntry(projectRoot)
  entry.editorStateRefs += 1
  if (entry.editorStateRefs === 1) {
    entry.unsubscribeEditorState =
      window.api?.unity?.onEditorState({ projectRoot }, (state) => {
        patchSnapshot(projectRoot, { editorState: state })
      }) ?? null
    void refreshUnityEditorState(projectRoot)
  }
  return () => {
    entry.editorStateRefs -= 1
    if (entry.editorStateRefs === 0) {
      entry.unsubscribeEditorState?.()
      entry.unsubscribeEditorState = null
    }
  }
}

/** Snapshot of one Unity project; keeps the editor-state subscription alive while mounted. */
export function useUnityProject(projectRoot: string | null): ActiveUnityProject | null {
  useEffect(() => {
    if (!projectRoot) {
      return
    }
    const entry = ensureEntry(projectRoot)
    if (!entry.infoRequested) {
      void refreshUnityProjectInfo(projectRoot)
    }
    if (!entry.pipelineRequested) {
      void refreshUnityPipelineStatus(projectRoot)
    }
    if (!cliStatusRequest) {
      void refreshUnityCliStatus()
    }
    return retainEditorState(projectRoot)
  }, [projectRoot])
  const readSnapshot = (): UnityProjectSnapshot | null =>
    projectRoot ? (projects.get(projectRoot)?.snapshot ?? null) : null
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot)
  const readCliStatus = (): UnityCliStatus | null => cliStatus
  const cli = useSyncExternalStore(subscribe, readCliStatus, readCliStatus)
  return snapshot ? { ...snapshot, cliStatus: cli } : null
}

/** Unity project of the active local workspace, preferring the one containing the active file. */
export function useActiveUnityProjectRoot(): string | null {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeFilePath = useAppStore((s) => {
    const activeFile = s.activeFileId
      ? s.openFiles.find((file) => file.id === s.activeFileId)
      : null
    return activeFile?.filePath ?? null
  })
  const roots = useUnityWorkspaceProjectRoots(activeWorktreeId)
  if (roots.length === 0) {
    return null
  }
  return (activeFilePath ? unityProjectRootFor(roots, activeFilePath) : null) ?? roots[0]
}

export function useActiveUnityProject(): ActiveUnityProject | null {
  return useUnityProject(useActiveUnityProjectRoot())
}
