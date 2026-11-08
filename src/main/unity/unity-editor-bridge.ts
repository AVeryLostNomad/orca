import { isAbsolute, join, resolve, sep } from 'node:path'
import type {
  UnityCompileMessage,
  UnityEditorAction,
  UnityEditorActionResult,
  UnityEditorState,
  UnityPlayModeState
} from '../../shared/unity-types'
import {
  getUnityCliStatus,
  parseCliJson,
  runUnityCli,
  runUnityCliJson,
  unityCliFailureMessage
} from './unity-cli'
import { payloadField, payloadNumber, payloadString } from './unity-payload-fields'
import {
  execPipelineCommand,
  fetchPipelineEditorStatus,
  readPipelineEndpoint
} from './unity-pipeline-http'
import { getUnityProjectInfoForRoot } from './unity-project-info'
import { isUnityProjectRoot } from './unity-project-detect'

export const UNITY_PIPELINE_MISSING_ERROR =
  'The Unity Pipeline package (com.unity.pipeline) is not installed in this project. Install it to control the Unity Editor from Orca.'
const EDITOR_NOT_RUNNING_ERROR =
  'No running Unity Editor has this project open. Open the project in Unity and retry.'
export const NOT_A_PROJECT_ERROR = 'This folder is not a local Unity project.'

const PLAY_MODE_BY_PIPELINE_STATE: Record<string, UnityPlayModeState> = {
  stopped: 'edit',
  playing: 'playing',
  paused: 'paused'
}

export type EditorCommandResult = { ok: true; result: unknown } | { ok: false; error: string }

/** Local Unity project roots only: remote/relative paths never reach the CLI. */
export async function isLocalUnityProject(projectRoot: unknown): Promise<boolean> {
  return (
    typeof projectRoot === 'string' && isAbsolute(projectRoot) && isUnityProjectRoot(projectRoot)
  )
}

/** One Pipeline command over the editor's loopback HTTP API; the CLI covers a live editor whose HTTP endpoint fails. */
export async function runEditorCommand(
  projectRoot: string,
  command: string,
  parameters: Record<string, string | number | boolean>,
  timeoutMs: number
): Promise<EditorCommandResult> {
  const info = await getUnityProjectInfoForRoot(projectRoot)
  if (!info.pipelinePackage.installed) {
    return { ok: false, error: UNITY_PIPELINE_MISSING_ERROR }
  }
  // Pipeline writes its descriptor whenever its editor runs; without one, skip a doomed CLI spawn.
  const endpoint = await readPipelineEndpoint(projectRoot)
  if (!endpoint) {
    return { ok: false, error: EDITOR_NOT_RUNNING_ERROR }
  }
  const viaHttp = await execPipelineCommand(endpoint, command, parameters, timeoutMs)
  if (viaHttp.ok || !viaHttp.unreachable) {
    return viaHttp.ok ? viaHttp : { ok: false, error: viaHttp.error }
  }
  const args = [
    'command',
    ...command.split(' '),
    ...Object.entries(parameters).flatMap(([key, value]) => [`--${key}`, String(value)]),
    '--project-path',
    projectRoot,
    '--result-only',
    '--timeout',
    String(Math.ceil(timeoutMs / 1000)),
    '--json'
  ]
  try {
    const run = await runUnityCli(args, { timeoutMs: timeoutMs + 15_000 })
    return run.code === 0
      ? { ok: true, result: parseCliJson(run.stdout) }
      : { ok: false, error: unityCliFailureMessage(run) }
  } catch {
    return { ok: false, error: viaHttp.error }
  }
}

async function evalInEditor(projectRoot: string, code: string): Promise<EditorCommandResult> {
  const response = await runEditorCommand(projectRoot, 'script eval', { code }, 60_000)
  return response.ok ? { ok: true, result: payloadField(response.result, 'result') } : response
}

export async function getUnityEditorState(projectRoot: string): Promise<UnityEditorState> {
  if (!(await getUnityCliStatus()).available) {
    return { connected: false, cliAvailable: false, projectRoot }
  }
  const disconnected: UnityEditorState = { connected: false, cliAvailable: true, projectRoot }
  const endpoint = await readPipelineEndpoint(projectRoot)
  if (endpoint) {
    const status = await fetchPipelineEditorStatus(endpoint)
    return {
      connected: true,
      cliAvailable: true,
      projectRoot,
      pid: endpoint.pid,
      port: endpoint.port,
      editorVersion: status?.unityVersion || endpoint.unityVersion,
      // A live editor whose server does not answer is mid domain reload or blocked on the main thread.
      state: !status
        ? 'busy'
        : status.compiling
          ? 'compiling'
          : status.domainReloadInProgress
            ? 'reloading'
            : status.status,
      playMode: (status && PLAY_MODE_BY_PIPELINE_STATE[status.playMode]) ?? 'unknown'
    }
  }
  if ((await getUnityProjectInfoForRoot(projectRoot)).pipelinePackage.installed) {
    // Pipeline writes its descriptor whenever its editor runs, so no live descriptor means no editor.
    return disconnected
  }
  const listing = await runUnityCliJson(['status'], { timeoutMs: 15_000 })
  const instances = listing.ok ? payloadField(listing.data, 'instances') : null
  const match = Array.isArray(instances)
    ? instances.find((instance) => {
        const path = payloadString(instance, 'projectPath')
        return path !== undefined && unityProjectKey(path) === unityProjectKey(projectRoot)
      })
    : undefined
  if (!match) {
    return disconnected
  }
  return {
    connected: true,
    cliAvailable: true,
    projectRoot,
    pid: payloadNumber(match, 'pid') ?? 0,
    port: payloadNumber(match, 'port') ?? 0,
    editorVersion: payloadString(match, 'editorVersion') ?? '',
    state: payloadString(match, 'state') ?? 'unknown',
    playMode: 'unknown'
  }
}

function toCompileMessages(
  projectRoot: string,
  items: unknown,
  severity: UnityCompileMessage['severity']
): UnityCompileMessage[] {
  if (!Array.isArray(items)) {
    return []
  }
  return items.map((item) => {
    const file = payloadString(item, 'file')
    const code = payloadString(item, 'code')
    const message = payloadString(item, 'message') ?? payloadString(item, 'raw') ?? ''
    return {
      severity,
      message: code ? `${code}: ${message}` : message,
      ...(file ? { file: isAbsolute(file) ? file : join(projectRoot, file) } : {}),
      ...(payloadNumber(item, 'line') ? { line: payloadNumber(item, 'line') } : {}),
      ...(payloadNumber(item, 'column') ? { column: payloadNumber(item, 'column') } : {})
    }
  })
}

async function recompile(projectRoot: string): Promise<UnityEditorActionResult> {
  let run
  try {
    run = await runUnityCli(['recompile', '--project-path', projectRoot, '--json'], {
      timeoutMs: 180_000
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const data = payloadField(parseCliJson(run.stdout), 'data')
  // Compile errors exit nonzero yet still carry the structured report.
  if (!data || typeof data !== 'object' || !Array.isArray(payloadField(data, 'errors'))) {
    return { ok: false, error: unityCliFailureMessage(run) }
  }
  const errors = toCompileMessages(projectRoot, payloadField(data, 'errors'), 'error')
  const warnings = toCompileMessages(projectRoot, payloadField(data, 'warnings'), 'warning')
  const message =
    errors.length > 0
      ? `Compilation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}.`
      : payloadField(data, 'status') === 'up_to_date'
        ? 'Scripts are up to date.'
        : 'Scripts recompiled.'
  return { ok: true, message, compileErrors: [...errors, ...warnings] }
}

async function regenerateProjectFiles(projectRoot: string): Promise<UnityEditorActionResult> {
  const response = await evalInEditor(
    projectRoot,
    'var editor = Unity.CodeEditor.CodeEditor.CurrentEditor; editor.SyncAll(); return editor.GetType().FullName;'
  )
  if (!response.ok) {
    return response
  }
  const editorType = typeof response.result === 'string' ? response.result : ''
  // Unity's fallback editor implements SyncAll as a no-op; only IDE packages generate .sln/.csproj.
  if (editorType.endsWith('DefaultExternalCodeEditor')) {
    return {
      ok: false,
      error:
        'Unity has no IDE package selected as External Script Editor (Preferences > External Tools), so it cannot generate project files. Choose Visual Studio, Rider or VS Code there and retry.'
    }
  }
  return { ok: true, message: 'Project files regenerated.' }
}

const COMMAND_ACTIONS: Partial<Record<UnityEditorAction, { command: string; message: string }>> = {
  play: { command: 'editor.playmode start', message: 'Entered play mode.' },
  // Pipeline's pause toggles, which the toolbar relies on to resume as well.
  pause: { command: 'editor.playmode pause', message: 'Toggled pause.' },
  stop: { command: 'editor.playmode stop', message: 'Exited play mode.' }
}

const EVAL_ACTIONS: Partial<Record<UnityEditorAction, { code: string; message: string }>> = {
  step: {
    code: 'UnityEditor.EditorApplication.Step(); return true;',
    message: 'Stepped one frame.'
  },
  refresh: {
    code: 'UnityEditor.AssetDatabase.Refresh(); return true;',
    message: 'Assets refreshed.'
  }
}

export async function runUnityEditorAction(
  projectRoot: string,
  action: UnityEditorAction
): Promise<UnityEditorActionResult> {
  if (!(await isLocalUnityProject(projectRoot))) {
    return { ok: false, error: NOT_A_PROJECT_ERROR }
  }
  if (action === 'recompile') {
    const info = await getUnityProjectInfoForRoot(projectRoot)
    return info.pipelinePackage.installed
      ? recompile(projectRoot)
      : { ok: false, error: UNITY_PIPELINE_MISSING_ERROR }
  }
  if (action === 'regenerate-project-files') {
    return regenerateProjectFiles(projectRoot)
  }
  const commandAction = COMMAND_ACTIONS[action]
  if (commandAction) {
    const response = await runEditorCommand(projectRoot, commandAction.command, {}, 30_000)
    return response.ok ? { ok: true, message: commandAction.message } : response
  }
  const evalAction = EVAL_ACTIONS[action]
  if (evalAction) {
    const response = await evalInEditor(projectRoot, evalAction.code)
    return response.ok ? { ok: true, message: evalAction.message } : response
  }
  return { ok: false, error: `Unsupported Unity action: ${String(action)}` }
}

/** Case-folded (on Windows) absolute root, for matching CLI-reported paths and poller keys. */
export function unityProjectKey(projectRoot: string): string {
  const resolved = resolve(projectRoot).replace(/[\\/]+$/, '') || sep
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
