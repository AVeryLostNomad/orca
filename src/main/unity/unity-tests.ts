import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  UnityTestCaseResult,
  UnityTestListResult,
  UnityTestMode,
  UnityTestRunResult
} from '../../shared/unity-types'
import { runUnityCli, unityCliFailureMessage } from './unity-cli'
import { NOT_A_PROJECT_ERROR, isLocalUnityProject, runEditorCommand } from './unity-editor-bridge'
import { parseNunitTestCases } from './unity-nunit-results'
import { payloadField, payloadString } from './unity-payload-fields'
import { readPipelineEndpoint } from './unity-pipeline-http'
import { getUnityProjectInfoForRoot } from './unity-project-info'
import { resolveFirstProjectFrame } from './unity-stack-frame'

const PIPELINE_MODE: Record<UnityTestMode, string> = { EditMode: 'editor', PlayMode: 'playmode' }
const TEST_RUN_TIMEOUT_MS = 30 * 60_000
const PLAY_MODE_STATUS_POLL_MS = 1_500

type TestCaseFields = Omit<UnityTestCaseResult, 'file' | 'line'>

const RESULT_BY_STATUS: Record<string, UnityTestCaseResult['result']> = {
  passed: 'passed',
  failed: 'failed',
  skipped: 'skipped',
  ignored: 'skipped',
  inconclusive: 'inconclusive'
}

/** Pipeline serializes results PascalCase inline but camelCase in its async status file. */
function caseInsensitive(value: unknown, key: string): unknown {
  return payloadField(value, key) ?? payloadField(value, key[0].toLowerCase() + key.slice(1))
}

export async function listUnityTests(
  projectRoot: string,
  mode: UnityTestMode | undefined
): Promise<UnityTestListResult> {
  if (!(await isLocalUnityProject(projectRoot))) {
    return { ok: false, error: NOT_A_PROJECT_ERROR }
  }
  const response = await runEditorCommand(
    projectRoot,
    'test list',
    { mode: mode ? PIPELINE_MODE[mode] : 'all' },
    120_000
  )
  if (!response.ok) {
    return response
  }
  const tests = caseInsensitive(response.result, 'Tests')
  return {
    ok: true,
    tests: (Array.isArray(tests) ? tests : []).flatMap((test) => {
      const fullName = caseInsensitive(test, 'FullName')
      const testMode = caseInsensitive(test, 'Mode')
      return typeof fullName === 'string'
        ? [{ fullName, mode: testMode === 'PlayMode' ? 'PlayMode' : 'EditMode' } as const]
        : []
    })
  }
}

async function toCaseResult(
  projectRoot: string,
  raw: TestCaseFields
): Promise<UnityTestCaseResult> {
  const frame = raw.stackTrace
    ? await resolveFirstProjectFrame(projectRoot, '', raw.stackTrace)
    : null
  return { ...raw, ...(frame ? { file: frame.file, line: frame.line } : {}) }
}

function pipelineResults(payload: unknown): unknown[] {
  const results = caseInsensitive(payload, 'Results')
  return Array.isArray(results) ? results : []
}

function pipelineCase(raw: unknown): TestCaseFields {
  const fullName = String(caseInsensitive(raw, 'FullName') ?? '')
  const head = fullName.split('(')[0]
  const status = String(caseInsensitive(raw, 'Status') ?? '').toLowerCase()
  const duration = Number(caseInsensitive(raw, 'Duration'))
  const message = caseInsensitive(raw, 'Message')
  const stackTrace = caseInsensitive(raw, 'StackTrace')
  return {
    fullName,
    // Parameterized names contain dots inside their argument list, so take the last segment before "(".
    name: head.slice(head.lastIndexOf('.') + 1) + fullName.slice(head.length),
    result: RESULT_BY_STATUS[status] ?? 'inconclusive',
    durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : 0,
    ...(typeof message === 'string' && message.trim()
      ? { message: message.replaceAll('\r\n', '\n').trim() }
      : {}),
    ...(typeof stackTrace === 'string' && stackTrace.trim()
      ? { stackTrace: stackTrace.replaceAll('\r\n', '\n').trim() }
      : {})
  }
}

/** The in-editor filter is a substring match; keep the requested test or its children only. */
function selectedBy(name: string | undefined, fullName: string): boolean {
  return (
    !name || fullName === name || fullName.startsWith(`${name}.`) || fullName.startsWith(`${name}(`)
  )
}

async function waitForPlayModeRun(
  projectRoot: string
): Promise<{ ok: true; payload: unknown } | { ok: false; error: string }> {
  const deadline = Date.now() + TEST_RUN_TIMEOUT_MS
  while (Date.now() < deadline) {
    await delay(PLAY_MODE_STATUS_POLL_MS)
    // Entering play mode reloads the domain and briefly takes the server down; keep polling.
    if (!(await readPipelineEndpoint(projectRoot))) {
      continue
    }
    const status = await runEditorCommand(projectRoot, 'test status', {}, 10_000)
    if (!status.ok) {
      continue
    }
    const state = payloadString(status.result, 'status')
    if (state === 'completed') {
      return { ok: true, payload: status.result }
    }
    if (state === 'error' || state === 'cancelled') {
      return { ok: false, error: payloadString(status.result, 'message') ?? `Test run ${state}.` }
    }
  }
  return { ok: false, error: 'Timed out waiting for the PlayMode test run.' }
}

async function runInEditor(
  projectRoot: string,
  mode: UnityTestMode,
  names: (string | undefined)[]
): Promise<UnityTestRunResult> {
  const started = Date.now()
  const cases: UnityTestCaseResult[] = []
  for (const name of names) {
    const parameters: Record<string, string | boolean> = { mode: PIPELINE_MODE[mode] }
    if (name) {
      parameters.filter = name
    }
    // PlayMode cannot answer synchronously: entering play mode reloads the domain mid-request.
    if (mode === 'PlayMode') {
      parameters['async-tests'] = true
    }
    const response = await runEditorCommand(
      projectRoot,
      'test run',
      parameters,
      TEST_RUN_TIMEOUT_MS
    )
    if (!response.ok) {
      return response
    }
    let payload = response.result
    if (mode === 'PlayMode') {
      const completed = await waitForPlayModeRun(projectRoot)
      if (!completed.ok) {
        return completed
      }
      payload = completed.payload
    }
    const selected = pipelineResults(payload)
      .map(pipelineCase)
      .filter((testCase) => selectedBy(name, testCase.fullName))
    cases.push(
      ...(await Promise.all(selected.map((testCase) => toCaseResult(projectRoot, testCase))))
    )
  }
  return summarize(cases, Date.now() - started)
}

async function runInBatchMode(
  projectRoot: string,
  mode: UnityTestMode,
  filter: string | undefined
): Promise<UnityTestRunResult> {
  const output = join(tmpdir(), `orca-unity-tests-${randomUUID()}.xml`)
  const started = Date.now()
  try {
    let run
    try {
      run = await runUnityCli(
        [
          'test',
          projectRoot,
          '--mode',
          mode,
          ...(filter ? ['--filter', filter] : []),
          '--output',
          output
        ],
        { timeoutMs: TEST_RUN_TIMEOUT_MS }
      )
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    // Failing tests exit nonzero (code 8) but still write the report.
    const xml = await readFile(output, 'utf8').catch(() => null)
    if (xml === null) {
      return { ok: false, error: unityCliFailureMessage(run) }
    }
    const cases = await Promise.all(
      parseNunitTestCases(xml).map((testCase) =>
        toCaseResult(projectRoot, {
          fullName: testCase.fullName,
          name: testCase.name,
          result: testCase.result,
          durationMs: Math.round(testCase.durationSeconds * 1000),
          ...(testCase.message ? { message: testCase.message } : {}),
          ...(testCase.stackTrace ? { stackTrace: testCase.stackTrace } : {})
        })
      )
    )
    return summarize(cases, Date.now() - started)
  } finally {
    await rm(output, { force: true }).catch(() => {})
  }
}

function summarize(cases: UnityTestCaseResult[], durationMs: number): UnityTestRunResult {
  return {
    ok: true,
    passed: cases.filter((testCase) => testCase.result === 'passed').length,
    failed: cases.filter((testCase) => testCase.result === 'failed').length,
    skipped: cases.filter((testCase) => testCase.result === 'skipped').length,
    durationMs,
    cases
  }
}

/** Runs tests in the open editor via Pipeline, else in a batch-mode editor via `unity test`.
 *  `filter` is a `;`-separated list of test full names (Unity's -testFilter syntax). */
export async function runUnityTests(
  projectRoot: string,
  mode: UnityTestMode,
  filter: string | undefined
): Promise<UnityTestRunResult> {
  if (!(await isLocalUnityProject(projectRoot))) {
    return { ok: false, error: NOT_A_PROJECT_ERROR }
  }
  if (mode !== 'EditMode' && mode !== 'PlayMode') {
    return { ok: false, error: `Unknown test mode: ${String(mode)}` }
  }
  const names = (filter ?? '')
    .split(';')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  const info = await getUnityProjectInfoForRoot(projectRoot)
  if (info.pipelinePackage.installed && (await readPipelineEndpoint(projectRoot))) {
    return runInEditor(projectRoot, mode, names.length > 0 ? names : [undefined])
  }
  return runInBatchMode(projectRoot, mode, names.length > 0 ? names.join(';') : undefined)
}
