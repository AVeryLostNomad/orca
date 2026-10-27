import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { AddRepoDialogStep } from './add-repo-dialog-types'
import { withCreateProjectTimeout, type GitAvailability } from './create-project-defaults'

const LOCAL_GIT_AVAILABILITY_TIMEOUT_MS = 1500
const RUNTIME_GIT_AVAILABILITY_TIMEOUT_MS = 3000

export function useCreateProjectGitAvailability({
  step,
  activeRuntimeEnvironmentId
}: {
  step: AddRepoDialogStep
  activeRuntimeEnvironmentId: string | null | undefined
}): {
  createGitAvailability: GitAvailability
  resetCreateGitAvailability: () => void
} {
  const [createGitAvailability, setCreateGitAvailability] = useState<GitAvailability>('unknown')
  const createGitProbeGenRef = useRef(0)

  const resetCreateGitAvailability = useCallback(() => {
    createGitProbeGenRef.current++
    setCreateGitAvailability('unknown')
  }, [])

  useEffect(() => {
    if (step !== 'create') {
      return
    }
    const runtimeEnvironmentId = activeRuntimeEnvironmentId?.trim()
    const gen = ++createGitProbeGenRef.current
    setCreateGitAvailability('checking')
    const probe = runtimeEnvironmentId
      ? callRuntimeRpc<{ available: boolean }>(
          { kind: 'environment', environmentId: runtimeEnvironmentId },
          'repo.gitAvailable',
          undefined,
          { timeoutMs: RUNTIME_GIT_AVAILABILITY_TIMEOUT_MS }
        ).then((result) => result.available)
      : window.api.repos.isGitAvailable()
    const timeoutMs = runtimeEnvironmentId
      ? RUNTIME_GIT_AVAILABILITY_TIMEOUT_MS
      : LOCAL_GIT_AVAILABILITY_TIMEOUT_MS

    void withCreateProjectTimeout(probe, timeoutMs)
      .then((available) => {
        if (gen !== createGitProbeGenRef.current) {
          return
        }
        setCreateGitAvailability(available ? 'available' : 'unavailable')
      })
      .catch(() => {
        if (gen !== createGitProbeGenRef.current) {
          return
        }
        setCreateGitAvailability('unknown')
      })
  }, [activeRuntimeEnvironmentId, step])

  return { createGitAvailability, resetCreateGitAvailability }
}
