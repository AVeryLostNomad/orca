import type * as Monaco from 'monaco-editor'
import type {
  Diagnostic,
  DocumentDiagnosticReport,
  FullDocumentDiagnosticReport,
  UnchangedDocumentDiagnosticReport
} from 'vscode-languageserver-protocol'
import {
  onLspSessionStatus,
  registerLspServerRequestHandler,
  requestLsp,
  type LspWorkspaceSession
} from './lsp-client'
import { getLspBindingForUri, type LspDocumentBinding } from './lsp-document-binding'
import { setLspDiagnosticsForModel } from './lsp-diagnostics-markers'
import { lspCapability } from './lsp-provider-binding-access'

type MonacoModule = typeof Monaco

type DiagnosticProviderOptions = {
  identifier?: string
  interFileDependencies?: boolean
}

type PullState = {
  binding: LspDocumentBinding
  resultId?: string
  inFlight?: Monaco.CancellationTokenSource
  timer?: ReturnType<typeof setTimeout>
  timerDueAt?: number
  retried?: boolean
  disposed?: boolean
}

/** One document's slice of a pull report; `diagnostics` undefined = unchanged. */
type LspDiagnosticReportUpdate = {
  uri: string
  resultId?: string
  diagnostics?: Diagnostic[]
}

const CHANGE_DEBOUNCE_MS = 400
// Other open documents may depend on the edited one (Roslyn: interFileDependencies).
const DEPENDENT_DEBOUNCE_MS = 1200
const FAILED_PULL_RETRY_MS = 1000

const statesBySessionId = new Map<string, Set<PullState>>()
const stateByBinding = new WeakMap<LspDocumentBinding, PullState>()
let refreshHandlerInstalled = false

/** Flatten a textDocument/diagnostic report (including `relatedDocuments`). */
function lspDiagnosticReportUpdates(
  uri: string,
  report: DocumentDiagnosticReport
): LspDiagnosticReportUpdate[] {
  const toUpdate = (
    target: string,
    part: FullDocumentDiagnosticReport | UnchangedDocumentDiagnosticReport
  ): LspDiagnosticReportUpdate =>
    part.kind === 'full'
      ? { uri: target, resultId: part.resultId, diagnostics: part.items }
      : { uri: target, resultId: part.resultId }
  const updates = [toUpdate(uri, report)]
  for (const [relatedUri, related] of Object.entries(report.relatedDocuments ?? {})) {
    updates.push(toUpdate(relatedUri, related))
  }
  return updates
}

function applyReport(
  monaco: MonacoModule,
  state: PullState,
  report: DocumentDiagnosticReport
): void {
  const { session } = state.binding
  for (const update of lspDiagnosticReportUpdates(state.binding.uri, report)) {
    const binding =
      update.uri === state.binding.uri
        ? state.binding
        : getLspBindingForUri(session.sessionId, update.uri)
    const target = binding && stateByBinding.get(binding)
    if (!target || target.disposed || target.binding.model.isDisposed()) {
      continue
    }
    target.resultId = update.resultId
    if (update.diagnostics) {
      setLspDiagnosticsForModel(
        monaco,
        target.binding.model,
        session.serverId,
        'pull',
        update.diagnostics
      )
    }
  }
}

async function pull(monaco: MonacoModule, state: PullState): Promise<void> {
  state.inFlight?.cancel()
  const source = new monaco.CancellationTokenSource()
  state.inFlight = source
  const { session, uri } = state.binding
  const options = lspCapability<DiagnosticProviderOptions>(session, 'diagnosticProvider')
  const report = await requestLsp<DocumentDiagnosticReport>(
    session,
    'textDocument/diagnostic',
    { textDocument: { uri }, identifier: options?.identifier, previousResultId: state.resultId },
    source.token
  )
  if (state.inFlight === source) {
    state.inFlight = undefined
  }
  source.dispose()
  if (source.token.isCancellationRequested || state.disposed) {
    return
  }
  if (!report) {
    // Servers may cancel a pull mid-computation (ServerCancelled); retry once per edit.
    if (!state.retried) {
      state.retried = true
      schedulePull(monaco, state, FAILED_PULL_RETRY_MS)
    }
    return
  }
  applyReport(monaco, state, report)
}

function schedulePull(monaco: MonacoModule, state: PullState, delayMs: number): void {
  const dueAt = Date.now() + delayMs
  // Keep an earlier pending pull rather than pushing it back.
  if (state.timer !== undefined && state.timerDueAt !== undefined && state.timerDueAt <= dueAt) {
    return
  }
  clearTimeout(state.timer)
  state.timerDueAt = dueAt
  state.timer = setTimeout(() => {
    state.timer = undefined
    state.timerDueAt = undefined
    void pull(monaco, state)
  }, delayMs)
}

function installRefreshHandler(monaco: MonacoModule): void {
  if (refreshHandlerInstalled) {
    return
  }
  refreshHandlerInstalled = true
  registerLspServerRequestHandler(
    'workspace/diagnostic/refresh',
    async (session: LspWorkspaceSession) => {
      for (const state of statesBySessionId.get(session.sessionId) ?? []) {
        schedulePull(monaco, state, 0)
      }
      return null
    }
  )
}

/** Drive textDocument/diagnostic for a bound document when its server offers
 *  pull diagnostics; results land in the same marker owner as pushes. */
export function ensureLspPullDiagnostics(monaco: MonacoModule, binding: LspDocumentBinding): void {
  const { session, model } = binding
  if (stateByBinding.has(binding) || !lspCapability(session, 'diagnosticProvider')) {
    return
  }
  installRefreshHandler(monaco)
  const state: PullState = { binding }
  stateByBinding.set(binding, state)
  let sessionStates = statesBySessionId.get(session.sessionId)
  if (!sessionStates) {
    sessionStates = new Set()
    statesBySessionId.set(session.sessionId, sessionStates)
  }
  sessionStates.add(state)
  let epochSeen = session.epoch

  const contentSub = model.onDidChangeContent(() => {
    // The in-flight report describes text that no longer exists.
    state.inFlight?.cancel()
    state.retried = false
    clearTimeout(state.timer)
    state.timer = undefined
    schedulePull(monaco, state, CHANGE_DEBOUNCE_MS)
    if (
      lspCapability<DiagnosticProviderOptions>(session, 'diagnosticProvider')?.interFileDependencies
    ) {
      for (const other of sessionStates) {
        if (other !== state) {
          schedulePull(monaco, other, DEPENDENT_DEBOUNCE_MS)
        }
      }
    }
  })
  const statusSub = onLspSessionStatus(session, (current) => {
    // Restarted server: result ids from the old process are meaningless.
    if (current.status === 'ready' && current.epoch !== epochSeen) {
      epochSeen = current.epoch
      state.resultId = undefined
      schedulePull(monaco, state, 0)
    }
  })
  const disposeSub = model.onWillDispose(() => {
    disposeSub.dispose()
    contentSub.dispose()
    statusSub()
    state.disposed = true
    state.inFlight?.cancel()
    clearTimeout(state.timer)
    sessionStates.delete(state)
    stateByBinding.delete(binding)
  })
  void pull(monaco, state)
}
