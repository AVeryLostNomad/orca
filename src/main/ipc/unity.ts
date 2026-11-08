import { ipcMain, type WebContents } from 'electron'
import { isAbsolute } from 'node:path'
import type { UnityEditorAction, UnityTestMode } from '../../shared/unity-types'
import { findMethodAssetUsages, findScriptAssetUsages } from '../unity/unity-asset-usages'
import { getUnityCliStatus } from '../unity/unity-cli'
import { getUnityConsole } from '../unity/unity-console-fetch'
import {
  getUnityEditorState,
  isLocalUnityProject,
  runUnityEditorAction
} from '../unity/unity-editor-bridge'
import { openUnityDocs, openUnityProjectInEditor } from '../unity/unity-editor-launch'
import { ensureUnityEditorPackage } from '../unity/unity-editor-package'
import {
  refreshUnityEditorState,
  unwatchUnityEditorState,
  unwatchUnityEditorStateForOwner,
  watchUnityEditorState
} from '../unity/unity-editor-state-poller'
import { getUnityPipelineStatus, installUnityPipeline } from '../unity/unity-pipeline-package'
import { getUnityProjectInfo } from '../unity/unity-project-info'
import { findUnityProjectRootsUnder } from '../unity/unity-project-detect'
import { listUnityTests, runUnityTests } from '../unity/unity-tests'

const cleanupTrackedWebContentsIds = new Set<number>()

function trackWebContentsCleanup(sender: WebContents): void {
  if (cleanupTrackedWebContentsIds.has(sender.id)) {
    return
  }
  cleanupTrackedWebContentsIds.add(sender.id)
  const ownerPrefix = `${sender.id}:`
  sender.once('destroyed', () => {
    cleanupTrackedWebContentsIds.delete(sender.id)
    unwatchUnityEditorStateForOwner(ownerPrefix)
  })
}

export function registerUnityHandlers(): void {
  ipcMain.handle('unity:getProjectInfo', (_event, args: { path: string }) =>
    getUnityProjectInfo(args.path)
  )

  ipcMain.handle('unity:findProjectRoots', (_event, args: { rootPath: string }) =>
    typeof args.rootPath === 'string' && isAbsolute(args.rootPath)
      ? findUnityProjectRootsUnder(args.rootPath).catch(() => [])
      : []
  )

  ipcMain.handle('unity:findScriptAssetUsages', (_event, args: { scriptPath: string }) =>
    findScriptAssetUsages(args.scriptPath)
  )

  ipcMain.handle(
    'unity:findMethodAssetUsages',
    (_event, args: { scriptPath: string; methodName: string }) =>
      findMethodAssetUsages(args.scriptPath, args.methodName)
  )

  ipcMain.handle('unity:getEditorState', async (_event, args: { projectRoot: string }) =>
    (await isLocalUnityProject(args.projectRoot))
      ? getUnityEditorState(args.projectRoot)
      : {
          connected: false,
          cliAvailable: (await getUnityCliStatus()).available,
          projectRoot: args.projectRoot
        }
  )

  ipcMain.handle(
    'unity:subscribeEditorState',
    async (event, args: { subscriptionId: string; projectRoot: string }) => {
      if (!(await isLocalUnityProject(args.projectRoot))) {
        return
      }
      const sender = event.sender
      trackWebContentsCleanup(sender)
      watchUnityEditorState(args.projectRoot, `${sender.id}:${args.subscriptionId}`, (state) => {
        if (!sender.isDestroyed()) {
          sender.send('unity:editorState', { subscriptionId: args.subscriptionId, state })
        }
      })
    }
  )

  ipcMain.on('unity:unsubscribeEditorState', (event, args: { subscriptionId: string }) => {
    unwatchUnityEditorState(`${event.sender.id}:${args.subscriptionId}`)
  })

  ipcMain.handle(
    'unity:runEditorAction',
    async (_event, args: { projectRoot: string; action: UnityEditorAction }) => {
      const result = await runUnityEditorAction(args.projectRoot, args.action)
      refreshUnityEditorState(args.projectRoot)
      return result
    }
  )

  ipcMain.handle(
    'unity:getConsole',
    (_event, args: { projectRoot: string; cursor?: string | null; limit?: number }) =>
      getUnityConsole(args.projectRoot, args.cursor, args.limit)
  )

  ipcMain.handle('unity:openProjectInEditor', (_event, args: { projectRoot: string }) =>
    openUnityProjectInEditor(args.projectRoot)
  )

  ipcMain.handle('unity:getCliStatus', () => getUnityCliStatus())

  ipcMain.handle('unity:getPipelineStatus', (_event, args: { projectRoot: string }) =>
    getUnityPipelineStatus(args.projectRoot)
  )

  ipcMain.handle(
    'unity:installPipeline',
    async (_event, args: { projectRoot: string; upgrade?: boolean }) => {
      const result = await installUnityPipeline(args.projectRoot, args.upgrade === true)
      refreshUnityEditorState(args.projectRoot)
      return result
    }
  )

  ipcMain.handle('unity:listTests', (_event, args: { projectRoot: string; mode?: UnityTestMode }) =>
    listUnityTests(args.projectRoot, args.mode)
  )

  ipcMain.handle(
    'unity:runTests',
    (_event, args: { projectRoot: string; mode: UnityTestMode; filter?: string }) =>
      runUnityTests(args.projectRoot, args.mode, args.filter)
  )

  ipcMain.handle('unity:ensureEditorPackage', (_event, args: { projectRoot: string }) =>
    ensureUnityEditorPackage(args.projectRoot)
  )

  ipcMain.handle('unity:openDocs', (_event, args: { projectRoot: string; topic: string }) =>
    openUnityDocs(args.projectRoot, args.topic)
  )
}
