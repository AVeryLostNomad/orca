import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { payloadField, payloadString } from './unity-payload-fields'

// The Unity Pipeline package serves the same command API the CLI uses on 127.0.0.1, guarded by a
// bearer token it writes next to the port into Library/Pipeline/.unity-pipeline-port.

export type PipelineEndpoint = { pid: number; port: number; token: string; unityVersion: string }

export type PipelineEditorStatus = {
  status: string
  compiling: boolean
  domainReloadInProgress: boolean
  playMode: string
  unityVersion: string
}

export type PipelineExecResult =
  | { ok: true; result: unknown }
  // `unreachable` separates "no live server" (callers may fall back to the CLI) from command failures.
  | { ok: false; error: string; unreachable: boolean }

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

/** Live editor endpoint for a project, or null when the descriptor is missing or its editor exited. */
export async function readPipelineEndpoint(projectRoot: string): Promise<PipelineEndpoint | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(
      await readFile(join(projectRoot, 'Library', 'Pipeline', '.unity-pipeline-port'), 'utf8')
    )
  } catch {
    return null
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('pid' in parsed) ||
    !('port' in parsed) ||
    !('evalToken' in parsed)
  ) {
    return null
  }
  const pid = Number(parsed.pid)
  const port = Number(parsed.port)
  const token = parsed.evalToken
  if (!Number.isInteger(pid) || !Number.isInteger(port) || typeof token !== 'string') {
    return null
  }
  const unityVersion = payloadString(parsed, 'unityVersion') ?? ''
  return isProcessAlive(pid) ? { pid, port, token, unityVersion } : null
}

async function pipelineFetch(
  endpoint: PipelineEndpoint,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs: number }
): Promise<{ status: number; json: unknown } | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${endpoint.token}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs)
    })
    const text = await response.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    return { status: response.status, json }
  } catch {
    return null
  }
}

export async function fetchPipelineEditorStatus(
  endpoint: PipelineEndpoint,
  timeoutMs = 2_000
): Promise<PipelineEditorStatus | null> {
  const response = await pipelineFetch(endpoint, '/api/editor_status', { method: 'GET', timeoutMs })
  if (response?.status !== 200 || !response.json || typeof response.json !== 'object') {
    return null
  }
  const json = response.json
  return {
    status: payloadString(json, 'status') ?? 'unknown',
    compiling: payloadField(json, 'compiling') === true,
    domainReloadInProgress: payloadField(json, 'domainReloadInProgress') === true,
    playMode: payloadString(json, 'playMode') ?? 'unknown',
    unityVersion: payloadString(json, 'unityVersion') ?? ''
  }
}

/** POST /api/exec: runs one Pipeline command (`group name`) with named parameters. */
export async function execPipelineCommand(
  endpoint: PipelineEndpoint,
  command: string,
  parameters: Record<string, string | number | boolean>,
  timeoutMs: number
): Promise<PipelineExecResult> {
  const response = await pipelineFetch(endpoint, '/api/exec', {
    method: 'POST',
    body: { command, parameters, timeout: timeoutMs },
    // Leave headroom past the server-side timeout so its own error reply arrives first.
    timeoutMs: timeoutMs + 5_000
  })
  if (!response || response.status === 401 || response.status === 403) {
    return { ok: false, error: 'The Unity Pipeline server did not answer.', unreachable: true }
  }
  const json = response.json
  if (json && typeof json === 'object' && payloadField(json, 'success') === true) {
    return { ok: true, result: payloadField(json, 'result') }
  }
  return {
    ok: false,
    error:
      payloadString(json, 'errorDetails') ??
      payloadString(json, 'error') ??
      `Unity Pipeline command failed (HTTP ${response.status}).`,
    unreachable: false
  }
}
