import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { AddRepoDialogStep } from './add-repo-dialog-types'
import { withCreateProjectTimeout, type GitAvailability } from './create-project-defaults'

const LOCAL_GIT_AVAILABILITY_TIMEOUT_MS = 1500
const RUNTIME_GIT_AVAILABILITY_TIMEOUT_MS = 3000

export function useCreateProjectGitAvailability({
  step,
  activeRuntimeEnvironmentId,
  sshTargetId
}: {
  step: AddRepoDialogStep
  activeRuntimeEnvironmentId: string | null | undefined
  sshTargetId?: string | null | undefined
}): {
  createGitAvailability: GitAvailability
  resetCreateGitAvailability: () => void
} {
  const [createGitAvailability, setCreateGitAvailability] = useState<GitAvailability>('unknown')
  const createGitProbeGenRef = useRef(0)
  const activeSshTargetId = sshTargetId?.trim() || null

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
    if (activeSshTargetId) {
      // Why: SSH creation happens through the relay; probing client Git would
      // make the selected host look healthier or less healthy than it is.
      setCreateGitAvailability('unknown')
      return
    }
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
  }, [activeRuntimeEnvironmentId, activeSshTargetId, step])

  return { createGitAvailability, resetCreateGitAvailability }
}
