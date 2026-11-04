/** Structured-clone-safe subset of ProcessSpec; stdio is always three pipes. */
export type WorkerThreadChildSpec = {
  program: string
  args: string[]
  cwd?: string
  env?: Record<string, string | undefined>
}

/** Structured-clone-safe subset of a host-owned runProcess call with a boolean barrier. */
export type WorkerThreadRunSpec = WorkerThreadChildSpec & {
  timeoutMs: number
  maxOutputBytes: number
  captureBytes: boolean
  input?: string
}

export type WorkerThreadRunResult = {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  stdoutBytes?: Uint8Array
  stderrBytes?: Uint8Array
  timedOut: boolean
  outputTruncated?: boolean
}

export type WorkerThreadChildRequest =
  | { type: 'spawn'; id: number; spec: WorkerThreadChildSpec }
  | { type: 'stdin-write'; id: number; data: string }
  | { type: 'stdin-end'; id: number }
  | { type: 'output-consumed'; id: number; bytes: number }
  | { type: 'kill'; id: number; signal?: NodeJS.Signals }
  | { type: 'run'; id: number; spec: WorkerThreadRunSpec }
  | { type: 'run-abort'; id: number }

export type WorkerThreadChildErrorPayload = { message: string; code?: string }

export type WorkerThreadChildEvent =
  | { type: 'spawn'; id: number; pid: number | undefined }
  // Structured clone turns a Buffer into a plain Uint8Array.
  | { type: 'stdout' | 'stderr'; id: number; chunk: Uint8Array }
  // 'spawn-error': process creation threw, so no exit or close will follow.
  | { type: 'error' | 'spawn-error'; id: number; error: WorkerThreadChildErrorPayload }
  | { type: 'exit' | 'close'; id: number; code: number | null; signal: NodeJS.Signals | null }
  // 'run-terminated' mirrors runProcess onChildTerminated and may arrive before or after the result.
  | { type: 'run-terminated'; id: number }
  | { type: 'run-result'; id: number; result: WorkerThreadRunResult }
  | { type: 'run-error'; id: number; error: WorkerThreadChildErrorPayload }
