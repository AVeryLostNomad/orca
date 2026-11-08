import { runProcess } from '@orca/process-host'
import type { ProcessResult } from '@orca/process-host/process-spec'
import { tryRunProcessOffWindowsMainThread } from '../worker-thread-child-process/windows-main-thread-spawn-offload'

/** One-shot capture of the Unity CLI or bundled ripgrep, spawned off the Windows main thread. */
export function runUnityToolProcess(spec: {
  program: string
  args: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  timeoutMs: number
  maxOutputBytes: number
}): Promise<ProcessResult> {
  return tryRunProcessOffWindowsMainThread({ ...spec, captureBytes: false }, {}) ?? runProcess(spec)
}
