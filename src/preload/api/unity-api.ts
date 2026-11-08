import type {
  UnityAssetUsage,
  UnityEditorPackageResult,
  UnityCliStatus,
  UnityConsoleResult,
  UnityEditorAction,
  UnityEditorActionResult,
  UnityEditorState,
  UnityPipelineStatus,
  UnityProjectInfo,
  UnityTestListResult,
  UnityTestMode,
  UnityTestRunResult
} from '../../shared/unity-types'

export type UnityApi = {
  /** Nearest Unity project (ancestor-inclusive) of any local file or directory. */
  getProjectInfo: (args: { path: string }) => Promise<UnityProjectInfo | null>
  /** Unity projects at or below a workspace root (bounded depth). */
  findProjectRoots: (args: { rootPath: string }) => Promise<string[]>
  /** Scenes/prefabs/assets that reference a script via its .meta GUID. */
  findScriptAssetUsages: (args: { scriptPath: string }) => Promise<UnityAssetUsage[]>
  /** UnityEvent persistent calls (m_MethodName) bound to a method of the script. */
  findMethodAssetUsages: (args: {
    scriptPath: string
    methodName: string
  }) => Promise<UnityAssetUsage[]>
  getEditorState: (args: { projectRoot: string }) => Promise<UnityEditorState>
  /** Main polls the editor while at least one subscription is live. */
  onEditorState: (
    args: { projectRoot: string },
    callback: (state: UnityEditorState) => void
  ) => () => void
  runEditorAction: (args: {
    projectRoot: string
    action: UnityEditorAction
  }) => Promise<UnityEditorActionResult>
  getConsole: (args: {
    projectRoot: string
    cursor?: string | null
    limit?: number
  }) => Promise<UnityConsoleResult>
  openProjectInEditor: (args: { projectRoot: string }) => Promise<UnityEditorActionResult>
  getCliStatus: () => Promise<UnityCliStatus>
  getPipelineStatus: (args: { projectRoot: string }) => Promise<UnityPipelineStatus>
  /** `unity pipeline install` (or `upgrade` when `upgrade: true`) for the project. */
  installPipeline: (args: {
    projectRoot: string
    upgrade?: boolean
  }) => Promise<UnityEditorActionResult>
  listTests: (args: { projectRoot: string; mode?: UnityTestMode }) => Promise<UnityTestListResult>
  runTests: (args: {
    projectRoot: string
    mode: UnityTestMode
    filter?: string
  }) => Promise<UnityTestRunResult>
  /** `unity docs <topic>` matched to the project's editor version. */
  openDocs: (args: { projectRoot: string; topic: string }) => Promise<UnityEditorActionResult>
  /** Install/update the embedded Orca editor package (makes Orca Unity's External Script Editor). */
  ensureEditorPackage: (args: { projectRoot: string }) => Promise<UnityEditorPackageResult>
}
