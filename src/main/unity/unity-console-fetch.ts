import type {
  UnityConsoleEntry,
  UnityConsoleLevel,
  UnityConsoleResult
} from '../../shared/unity-types'
import { NOT_A_PROJECT_ERROR, isLocalUnityProject, runEditorCommand } from './unity-editor-bridge'
import { payloadField, payloadNumber, payloadString } from './unity-payload-fields'
import { resolveFirstProjectFrame } from './unity-stack-frame'

const CONSOLE_LEVEL_BY_LOG_TYPE: Record<string, UnityConsoleLevel> = {
  Log: 'log',
  Warning: 'warning',
  Error: 'error',
  Exception: 'exception',
  Assert: 'assert'
}

const CONSOLE_LEVEL_BY_SEVERITY: Record<string, UnityConsoleLevel> = {
  warn: 'warning',
  error: 'error'
}

/** Opaque console cursor: Unity's buffer session plus the last seen sequence number. */
function parseConsoleCursor(
  cursor: string | null | undefined
): { session: string; seq: number } | null {
  const separator = cursor ? cursor.lastIndexOf(':') : -1
  if (!cursor || separator <= 0) {
    return null
  }
  const seq = Number(cursor.slice(separator + 1))
  return Number.isInteger(seq) ? { session: cursor.slice(0, separator), seq } : null
}

/** `console get` entries newer than `cursor` (or the latest `limit` when null), with project frames resolved. */
export async function getUnityConsole(
  projectRoot: string,
  cursor: string | null | undefined,
  limit: number | undefined
): Promise<UnityConsoleResult> {
  if (!(await isLocalUnityProject(projectRoot))) {
    return { ok: false, error: NOT_A_PROJECT_ERROR }
  }
  const tail = Math.min(Math.max(Math.trunc(limit ?? 200), 1), 2_000)
  const since = parseConsoleCursor(cursor)
  const parameters: Record<string, string | number> = { tail, level: 'log' }
  if (since) {
    parameters.since = since.seq
    parameters['since-session'] = since.session
  }
  const response = await runEditorCommand(projectRoot, 'console get', parameters, 10_000)
  if (!response.ok) {
    return response
  }
  const rawEntries = payloadField(response.result, 'entries')
  const entries: UnityConsoleEntry[] = await Promise.all(
    (Array.isArray(rawEntries) ? rawEntries : []).map(async (raw) => {
      const message = payloadString(raw, 'message') ?? ''
      const stackTrace = payloadString(raw, 'stackTrace') ?? ''
      const frame = await resolveFirstProjectFrame(projectRoot, message, stackTrace)
      const timestamp = payloadString(raw, 'timestampUtc')
      return {
        level:
          CONSOLE_LEVEL_BY_LOG_TYPE[payloadString(raw, 'logType') ?? ''] ??
          CONSOLE_LEVEL_BY_SEVERITY[payloadString(raw, 'level') ?? ''] ??
          'log',
        message,
        stackTrace,
        ...(frame ? { file: frame.file, line: frame.line } : {}),
        ...(timestamp ? { timestamp } : {})
      }
    })
  )
  const session = payloadString(response.result, 'session')
  const seq = payloadNumber(response.result, 'cursor')
  return {
    ok: true,
    entries,
    cursor: session && seq !== undefined ? `${session}:${seq}` : (cursor ?? null)
  }
}
