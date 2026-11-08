import { ipcRenderer } from 'electron'
import type {
  UnityAssetUsage,
  UnityCliStatus,
  UnityConsoleResult,
  UnityEditorAction,
  UnityEditorActionResult,
  UnityEditorPackageResult,
  UnityEditorState,
  UnityPipelineStatus,
  UnityProjectInfo,
  UnityTestListResult,
  UnityTestMode,
  UnityTestRunResult
} from '../../shared/unity-types'
import type { PreloadApi } from '../api-types'

export const unityApi = {
  getProjectInfo: (args: { path: string }): Promise<UnityProjectInfo | null> =>
    ipcRenderer.invoke('unity:getProjectInfo', args),
  findProjectRoots: (args: { rootPath: string }): Promise<string[]> =>
    ipcRenderer.invoke('unity:findProjectRoots', args),
  findScriptAssetUsages: (args: { scriptPath: string }): Promise<UnityAssetUsage[]> =>
    ipcRenderer.invoke('unity:findScriptAssetUsages', args),
  findMethodAssetUsages: (args: {
    scriptPath: string
    methodName: string
  }): Promise<UnityAssetUsage[]> => ipcRenderer.invoke('unity:findMethodAssetUsages', args),
  getEditorState: (args: { projectRoot: string }): Promise<UnityEditorState> =>
    ipcRenderer.invoke('unity:getEditorState', args),
  onEditorState: (
    args: { projectRoot: string },
    callback: (state: UnityEditorState) => void
  ): (() => void) => {
    const subscriptionId = crypto.randomUUID()
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { subscriptionId: string; state: UnityEditorState }
    ): void => {
      if (payload.subscriptionId === subscriptionId) {
        callback(payload.state)
      }
    }
    ipcRenderer.on('unity:editorState', listener)
    void ipcRenderer.invoke('unity:subscribeEditorState', {
      subscriptionId,
      projectRoot: args.projectRoot
    })
    return () => {
      ipcRenderer.removeListener('unity:editorState', listener)
      ipcRenderer.send('unity:unsubscribeEditorState', { subscriptionId })
    }
  },
  runEditorAction: (args: {
    projectRoot: string
    action: UnityEditorAction
  }): Promise<UnityEditorActionResult> => ipcRenderer.invoke('unity:runEditorAction', args),
  getConsole: (args: {
    projectRoot: string
    cursor?: string | null
    limit?: number
  }): Promise<UnityConsoleResult> => ipcRenderer.invoke('unity:getConsole', args),
  openProjectInEditor: (args: { projectRoot: string }): Promise<UnityEditorActionResult> =>
    ipcRenderer.invoke('unity:openProjectInEditor', args),
  getCliStatus: (): Promise<UnityCliStatus> => ipcRenderer.invoke('unity:getCliStatus'),
  getPipelineStatus: (args: { projectRoot: string }): Promise<UnityPipelineStatus> =>
    ipcRenderer.invoke('unity:getPipelineStatus', args),
  installPipeline: (args: {
    projectRoot: string
    upgrade?: boolean
  }): Promise<UnityEditorActionResult> => ipcRenderer.invoke('unity:installPipeline', args),
  listTests: (args: { projectRoot: string; mode?: UnityTestMode }): Promise<UnityTestListResult> =>
    ipcRenderer.invoke('unity:listTests', args),
  runTests: (args: {
    projectRoot: string
    mode: UnityTestMode
    filter?: string
  }): Promise<UnityTestRunResult> => ipcRenderer.invoke('unity:runTests', args),
  openDocs: (args: { projectRoot: string; topic: string }): Promise<UnityEditorActionResult> =>
    ipcRenderer.invoke('unity:openDocs', args),
  ensureEditorPackage: (args: { projectRoot: string }): Promise<UnityEditorPackageResult> =>
    ipcRenderer.invoke('unity:ensureEditorPackage', args)
} satisfies PreloadApi['unity']
