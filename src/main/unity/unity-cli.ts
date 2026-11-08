import { spawnProcess } from '@orca/process-host'
import type { ProcessResult } from '@orca/process-host/process-spec'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, join } from 'node:path'
import type { UnityCliStatus } from '../../shared/unity-types'
import { hydrateShellPath } from '../startup/hydrate-shell-path'
import { trySpawnOffWindowsMainThread } from '../worker-thread-child-process/windows-main-thread-spawn-offload'
import { runUnityToolProcess } from './unity-tool-process'

export const UNITY_CLI_DOCS_URL = 'https://docs.unity.com/en-us/unity-cli/unity-cli'
export const UNITY_CLI_MISSING_ERROR = `The Unity CLI was not found. Install it from ${UNITY_CLI_DOCS_URL} and make sure \`unity\` is on your PATH, then retry.`

const CLI_OUTPUT_LIMIT_BYTES = 16 * 1024 * 1024
// A missing CLI is re-probed after this, so installing it mid-session is picked up.
const MISSING_CLI_RECHECK_MS = 30_000

// Documented exit codes (`unity --help`) whose generic wording beats raw stderr.
const EXIT_CODE_MESSAGES: Record<number, string> = {
  4: 'The Unity CLI reports missing setup. Run `unity doctor` in a terminal for details.',
  12: 'No running Unity Editor has this project open (with the Unity Pipeline package). Open the project in Unity and retry.',
  13: 'The Unity Editor does not expose this command. Upgrade the Unity Pipeline package and retry.',
  14: 'The Unity Editor did not answer in time.',
  17: 'The Unity Editor is busy (compiling or importing). Retry in a moment.',
  18: 'The Unity Editor is waiting on a dialog. Dismiss it in Unity and retry.'
}

export class UnityCliMissingError extends Error {
  constructor() {
    super(UNITY_CLI_MISSING_ERROR)
  }
}

type CliResolution = { path: string | null; version: string | null; checkedAt: number }

let resolution: CliResolution | null = null
let inFlightResolution: Promise<CliResolution> | null = null

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function knownInstallLocations(): string[] {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA
      ? [join(process.env.LOCALAPPDATA, 'Unity', 'bin', 'unity.exe')]
      : []
  }
  const home = homedir()
  return [
    join(home, '.local', 'bin', 'unity'),
    join(home, '.unity', 'bin', 'unity'),
    '/opt/homebrew/bin/unity',
    '/usr/local/bin/unity',
    '/home/linuxbrew/.linuxbrew/bin/unity',
    '/usr/bin/unity'
  ]
}

async function pathCandidates(): Promise<string[]> {
  const hydration = await hydrateShellPath().catch(() => null)
  const launchPath = process.env.PATH ?? process.env.Path ?? ''
  const segments = [...(hydration?.ok ? hydration.segments : []), ...launchPath.split(delimiter)]
  const binary = process.platform === 'win32' ? 'unity.exe' : 'unity'
  // Why: Hub editor folders hold Unity.exe, the Editor itself, which must never be launched as the CLI.
  return segments
    .filter((segment) => segment.length > 0 && basename(segment).toLowerCase() !== 'editor')
    .map((segment) => join(segment, binary))
}

// Plain, prompt-free output for a non-TTY caller.
const CLI_ENV_OVERRIDES = {
  UNITY_NO_BANNER: '1',
  UNITY_NO_PAGER: '1',
  UNITY_NON_INTERACTIVE: '1',
  NO_COLOR: '1'
}

function runCli(program: string, args: string[], timeoutMs: number, cwd?: string) {
  const env = { ...process.env, ...CLI_ENV_OVERRIDES }
  return runUnityToolProcess({
    program,
    args,
    cwd,
    env,
    timeoutMs,
    maxOutputBytes: CLI_OUTPUT_LIMIT_BYTES
  })
}

async function probeCli(): Promise<CliResolution> {
  const candidates =
    process.platform === 'win32'
      ? [...knownInstallLocations(), ...(await pathCandidates())]
      : [...(await pathCandidates()), ...knownInstallLocations()]
  for (const candidate of candidates) {
    if (!(await isFile(candidate))) {
      continue
    }
    const probe = await runCli(candidate, ['--version'], 10_000).catch(() => null)
    const version = probe?.code === 0 ? (probe.stdout.trim().split(/\s+/).at(-1) ?? null) : null
    if (version) {
      return { path: candidate, version, checkedAt: Date.now() }
    }
  }
  return { path: null, version: null, checkedAt: Date.now() }
}

async function resolveCli(): Promise<CliResolution> {
  if (
    resolution &&
    (resolution.path || Date.now() - resolution.checkedAt < MISSING_CLI_RECHECK_MS)
  ) {
    return resolution
  }
  inFlightResolution ??= probeCli()
    .then((result) => {
      resolution = result
      return result
    })
    .finally(() => {
      inFlightResolution = null
    })
  return inFlightResolution
}

export async function getUnityCliStatus(): Promise<UnityCliStatus> {
  const { path, version } = await resolveCli()
  return { available: path !== null, path, version }
}

/** Runs the Unity CLI off the Windows main thread; throws UnityCliMissingError when it cannot start. */
export async function runUnityCli(
  args: string[],
  options: { timeoutMs: number; cwd?: string }
): Promise<ProcessResult> {
  const { path } = await resolveCli()
  if (!path) {
    throw new UnityCliMissingError()
  }
  try {
    return await runCli(path, args, options.timeoutMs, options.cwd)
  } catch {
    // The binary vanished or became unlaunchable; force a fresh probe next time.
    resolution = null
    throw new UnityCliMissingError()
  }
}

/** For commands that start long-lived apps (`open`, `docs`): settle on the CLI's own exit, since the
 *  launched Editor/browser can inherit its pipes, and never kill it on timeout. */
export async function launchUnityCli(
  args: string[],
  options: { settleMs: number; cwd?: string }
): Promise<{ exited: boolean; code: number | null; output: string }> {
  const { path } = await resolveCli()
  if (!path) {
    throw new UnityCliMissingError()
  }
  const env = { ...process.env, ...CLI_ENV_OVERRIDES }
  const spec = { program: path, args, cwd: options.cwd, env }
  const child =
    trySpawnOffWindowsMainThread(spec) ?? spawnProcess({ ...spec, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin?.end()
  const settled = Promise.withResolvers<{ exited: boolean; code: number | null; output: string }>()
  let output = ''
  const collect = (chunk: Buffer | string): void => {
    output = (output + chunk.toString()).slice(-4_096)
  }
  const timer = setTimeout(
    () => settled.resolve({ exited: false, code: null, output }),
    options.settleMs
  )
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  child.once('error', () => {
    clearTimeout(timer)
    resolution = null
    settled.reject(new UnityCliMissingError())
  })
  child.once('exit', (code: number | null) => {
    clearTimeout(timer)
    settled.resolve({ exited: true, code, output })
  })
  return settled.promise
}

export function parseCliJson(stdout: string): unknown {
  const start = stdout.indexOf('{')
  if (start === -1) {
    return null
  }
  try {
    return JSON.parse(stdout.slice(start))
  } catch {
    return null
  }
}

function firstEnvelopeError(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object' || !('errors' in parsed)) {
    return null
  }
  const { errors } = parsed
  const first: unknown = Array.isArray(errors) ? errors[0] : null
  return first &&
    typeof first === 'object' &&
    'message' in first &&
    typeof first.message === 'string'
    ? first.message
    : null
}

/** Actionable message for a failed CLI run: envelope error, documented exit code, then raw output. */
export function unityCliFailureMessage(run: ProcessResult): string {
  if (run.timedOut) {
    return 'The Unity CLI timed out.'
  }
  const envelopeError = firstEnvelopeError(parseCliJson(run.stdout))
  if (envelopeError) {
    return envelopeError
  }
  const known = run.code === null ? undefined : EXIT_CODE_MESSAGES[run.code]
  if (known) {
    return known
  }
  const raw = (run.stderr.trim() || run.stdout.trim()).slice(-800)
  return raw || `The Unity CLI exited with code ${run.code ?? 'unknown'}.`
}

/** `unity <args> --json` → the envelope's `data` on success, or an actionable error. */
export async function runUnityCliJson(
  args: string[],
  options: { timeoutMs: number; cwd?: string }
): Promise<{ ok: true; data: unknown; run: ProcessResult } | { ok: false; error: string }> {
  try {
    const run = await runUnityCli([...args, '--json'], options)
    const parsed = parseCliJson(run.stdout)
    if (run.code !== 0 || !parsed || typeof parsed !== 'object') {
      return { ok: false, error: unityCliFailureMessage(run) }
    }
    return { ok: true, data: 'data' in parsed ? parsed.data : parsed, run }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
