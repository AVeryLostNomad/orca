/** Facts parsed from a Unity project's ProjectSettings (YAML) files. */
export type UnityProjectInfo = {
  /** Absolute directory holding Assets/ and ProjectSettings/ProjectVersion.txt. */
  projectRoot: string
  /** m_EditorVersion from ProjectVersion.txt, e.g. "6000.0.23f1". */
  editorVersion: string | null
  /** Built-in tags (Untagged, Respawn, Finish, EditorOnly, MainCamera, Player, GameController) + TagManager tags. */
  tags: string[]
  /** Named layers with their index (built-in + user layers; empty slots omitted). */
  layers: { index: number; name: string }[]
  sortingLayers: string[]
  /** EditorBuildSettings scenes in build order. `name` is the file name without extension. */
  scenes: { path: string; name: string; enabled: boolean }[]
  /** Unique InputManager axis/button names. */
  inputAxes: string[]
  /** Absolute .sln/.slnx files in projectRoot (empty when Unity has not generated them). */
  solutionFiles: string[]
  /** True when projectRoot holds any generated .csproj. */
  hasProjectFiles: boolean
  /** com.unity.pipeline from Packages/manifest.json; required for `unity command` editor control. */
  pipelinePackage: { installed: boolean; version: string | null }
}

export type UnityAssetUsageKind = 'scene' | 'prefab' | 'scriptable-object' | 'other'

export type UnityAssetUsage = {
  /** Absolute path of the referencing asset (.unity/.prefab/.asset/...). */
  assetPath: string
  kind: UnityAssetUsageKind
  /** 1-based line of the first reference inside the asset file. */
  line: number
  /** Number of references to the target inside this asset. */
  count: number
}

export type UnityPlayModeState = 'edit' | 'playing' | 'paused' | 'unknown'

export type UnityEditorState =
  | { connected: false; cliAvailable: boolean; projectRoot: string }
  | {
      connected: true
      cliAvailable: true
      projectRoot: string
      pid: number
      port: number
      editorVersion: string
      /** Raw editor state from `unity status` (e.g. "ready", "compiling"). */
      state: string
      playMode: UnityPlayModeState
    }

export type UnityEditorAction =
  | 'play'
  | 'pause'
  | 'stop'
  | 'step'
  | 'refresh'
  | 'recompile'
  | 'regenerate-project-files'

export type UnityCompileMessage = {
  severity: 'error' | 'warning'
  message: string
  file?: string
  line?: number
  column?: number
}

export type UnityEditorActionResult =
  | { ok: true; message?: string; compileErrors?: UnityCompileMessage[] }
  | { ok: false; error: string }

export type UnityConsoleLevel = 'log' | 'warning' | 'error' | 'exception' | 'assert'

export type UnityConsoleEntry = {
  level: UnityConsoleLevel
  message: string
  stackTrace: string
  /** Absolute path of the first project-owned frame, when one resolves. */
  file?: string
  line?: number
  timestamp?: string
}

export type UnityConsoleResult =
  | { ok: true; entries: UnityConsoleEntry[]; cursor: string | null }
  | { ok: false; error: string }

export type UnityCliStatus = {
  available: boolean
  path: string | null
  version: string | null
}

export type UnityPipelineStatus = {
  installed: boolean
  version: string | null
  latestVersion: string | null
  updateAvailable: boolean
}

export type UnityTestMode = 'EditMode' | 'PlayMode'

export type UnityTestCaseResult = {
  fullName: string
  name: string
  result: 'passed' | 'failed' | 'skipped' | 'inconclusive'
  durationMs: number
  message?: string
  stackTrace?: string
  /** First project-owned frame of a failure, when one resolves. */
  file?: string
  line?: number
}

export type UnityTestRunResult =
  | {
      ok: true
      passed: number
      failed: number
      skipped: number
      durationMs: number
      cases: UnityTestCaseResult[]
    }
  | { ok: false; error: string }

export type UnityTestListResult =
  | { ok: true; tests: { fullName: string; mode: UnityTestMode }[] }
  | { ok: false; error: string }

export type UnityEditorPackageResult =
  | { ok: true; outcome: 'installed' | 'updated' | 'current'; version: string; packagePath: string }
  | { ok: false; error: string }
