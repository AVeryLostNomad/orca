// Resolve parent and Git defaults on the chosen host while rejecting stale async results.
import { useCallback, useEffect, useRef, useState } from 'react'
import { browseRuntimeServerDirectory } from '@/runtime/runtime-server-directory-browser'
import { useCreateProjectGitAvailability } from './useCreateProjectGitAvailability'
import type { AddRepoDialogStep } from './add-repo-dialog-types'
import {
  getCreateProjectParentTargetKey,
  getDefaultCreateProjectParent,
  readLastCreateProjectParent,
  withCreateProjectTimeout,
  type GitAvailability
} from './create-project-defaults'

const CREATE_PROJECT_PARENT_TIMEOUT_MS = 3000

export type CreateRuntimeParentStatus = 'idle' | 'checking' | 'failed'

type AutoFilledCreateParent = {
  parent: string
  targetKey: string
}

type CreateParentProvenance = {
  parent: string
  targetKey: string
}

export function useCreateProjectDefaults({
  step,
  activeRuntimeEnvironmentId,
  createParent,
  setCreateParent
}: {
  step: AddRepoDialogStep
  activeRuntimeEnvironmentId: string | null | undefined
  createParent: string
  setCreateParent: (value: string) => void
}): {
  createDefaultParent: string
  createGitAvailability: GitAvailability
  createRuntimeParentStatus: CreateRuntimeParentStatus
  createParentDefaultPending: boolean
  resetCreateDefaultState: () => void
  markCreateParentTouched: (value?: string) => void
} {
  const [createDefaultParent, setCreateDefaultParent] = useState('')
  const { createGitAvailability, resetCreateGitAvailability } = useCreateProjectGitAvailability({
    step,
    activeRuntimeEnvironmentId
  })
  const [createRuntimeParentStatus, setCreateRuntimeParentStatus] =
    useState<CreateRuntimeParentStatus>('idle')
  const createStepAutoFilledRef = useRef(false)
  const autoFilledCreateParentRef = useRef<AutoFilledCreateParent | null>(null)
  const createParentProvenanceRef = useRef<CreateParentProvenance | null>(null)
  const createParentTouchedRef = useRef(false)
  const createParentDefaultGenRef = useRef(0)
  const activeCreateParentRuntimeEnvironmentId = activeRuntimeEnvironmentId?.trim() || null
  const activeCreateParentTargetKey = getCreateProjectParentTargetKey({
    runtimeEnvironmentId: activeCreateParentRuntimeEnvironmentId
  })

  const canReplaceCreateParentDefault = useCallback((parent: string): boolean => {
    if (createParentTouchedRef.current) {
      return false
    }
    const trimmedParent = parent.trim()
    return !trimmedParent || autoFilledCreateParentRef.current?.parent === trimmedParent
  }, [])

  // Prefer the last parent the user created a project in on this host.
  const applyRememberedCreateParent = useCallback(
    (targetKey: string, currentParent: string): boolean => {
      const rememberedParent = readLastCreateProjectParent(targetKey)
      if (!rememberedParent || !canReplaceCreateParentDefault(currentParent)) {
        return false
      }
      createParentDefaultGenRef.current++
      createStepAutoFilledRef.current = true
      autoFilledCreateParentRef.current = { parent: rememberedParent, targetKey }
      createParentProvenanceRef.current = { parent: rememberedParent, targetKey }
      if (currentParent.trim() !== rememberedParent) {
        setCreateParent(rememberedParent)
      }
      return true
    },
    [canReplaceCreateParentDefault, setCreateParent]
  )

  const resetCreateDefaultState = useCallback(() => {
    createParentDefaultGenRef.current++
    resetCreateGitAvailability()
    createStepAutoFilledRef.current = false
    autoFilledCreateParentRef.current = null
    createParentProvenanceRef.current = null
    createParentTouchedRef.current = false
    setCreateDefaultParent('')
    setCreateRuntimeParentStatus('idle')
  }, [resetCreateGitAvailability])

  // Why: a default must never clobber a parent the user picked themselves.
  const markCreateParentTouched = useCallback(
    (value?: string) => {
      autoFilledCreateParentRef.current = null
      createParentProvenanceRef.current = {
        parent: (value ?? createParent).trim(),
        targetKey: activeCreateParentTargetKey
      }
      createParentTouchedRef.current = true
    },
    [activeCreateParentTargetKey, createParent]
  )

  const createParentDefaultPending =
    step === 'create' &&
    !createParentTouchedRef.current &&
    Boolean(createParent.trim()) &&
    autoFilledCreateParentRef.current?.parent === createParent.trim() &&
    autoFilledCreateParentRef.current.targetKey !== activeCreateParentTargetKey
  const createParentTargetPending =
    step === 'create' &&
    Boolean(createParent.trim()) &&
    createParentProvenanceRef.current?.parent === createParent.trim() &&
    createParentProvenanceRef.current.targetKey !== activeCreateParentTargetKey
  const createParentPending = createParentDefaultPending || createParentTargetPending

  useEffect(() => {
    if (step !== 'create') {
      return
    }
    if (activeCreateParentRuntimeEnvironmentId) {
      return
    }
    if (applyRememberedCreateParent(activeCreateParentTargetKey, createParent)) {
      return
    }
    // Why: invalidate any in-flight runtime parent probe once local mode owns the default.
    const gen = ++createParentDefaultGenRef.current
    if (!canReplaceCreateParentDefault(createParent)) {
      return
    }
    if (
      createParent.trim() &&
      autoFilledCreateParentRef.current?.targetKey !== 'local' &&
      autoFilledCreateParentRef.current?.parent === createParent.trim()
    ) {
      setCreateDefaultParent('')
      setCreateParent('')
      return
    }
    if (
      autoFilledCreateParentRef.current?.targetKey === 'local' &&
      autoFilledCreateParentRef.current.parent === createParent.trim()
    ) {
      return
    }
    setCreateDefaultParent('')
    void window.api.repos
      .getDefaultCreateProjectParent()
      .then((parent) => {
        if (
          gen !== createParentDefaultGenRef.current ||
          !canReplaceCreateParentDefault(createParent) ||
          !parent
        ) {
          return
        }
        setCreateDefaultParent(parent)
        createStepAutoFilledRef.current = true
        autoFilledCreateParentRef.current = { parent, targetKey: 'local' }
        createParentProvenanceRef.current = { parent, targetKey: 'local' }
        setCreateParent(parent)
      })
      .catch(() => {
        // Keep the field empty if the local host cannot provide a submit-ready default.
      })
  }, [
    activeRuntimeEnvironmentId,
    activeCreateParentRuntimeEnvironmentId,
    activeCreateParentTargetKey,
    applyRememberedCreateParent,
    canReplaceCreateParentDefault,
    createParent,
    setCreateParent,
    step
  ])

  useEffect(() => {
    if (step !== 'create') {
      return
    }
    const runtimeEnvironmentId = activeCreateParentRuntimeEnvironmentId
    if (!runtimeEnvironmentId) {
      setCreateRuntimeParentStatus('idle')
      return
    }
    if (applyRememberedCreateParent(activeCreateParentTargetKey, createParent)) {
      setCreateRuntimeParentStatus('idle')
      return
    }
    if (!canReplaceCreateParentDefault(createParent)) {
      setCreateRuntimeParentStatus('idle')
      return
    }
    if (
      createParent.trim() &&
      autoFilledCreateParentRef.current?.targetKey !== `runtime:${runtimeEnvironmentId}` &&
      autoFilledCreateParentRef.current?.parent === createParent.trim()
    ) {
      setCreateDefaultParent('')
      setCreateRuntimeParentStatus('checking')
      setCreateParent('')
      return
    }
    if (
      autoFilledCreateParentRef.current?.targetKey === `runtime:${runtimeEnvironmentId}` &&
      autoFilledCreateParentRef.current.parent === createParent.trim()
    ) {
      setCreateRuntimeParentStatus('idle')
      return
    }
    setCreateDefaultParent('')

    const gen = ++createParentDefaultGenRef.current
    setCreateRuntimeParentStatus('checking')
    void withCreateProjectTimeout(
      browseRuntimeServerDirectory(runtimeEnvironmentId, '~'),
      CREATE_PROJECT_PARENT_TIMEOUT_MS
    )
      .then((result) => {
        if (
          gen !== createParentDefaultGenRef.current ||
          !canReplaceCreateParentDefault(createParent)
        ) {
          return
        }
        const parent = getDefaultCreateProjectParent(result.resolvedPath)
        createStepAutoFilledRef.current = true
        autoFilledCreateParentRef.current = {
          parent,
          targetKey: `runtime:${runtimeEnvironmentId}`
        }
        createParentProvenanceRef.current = {
          parent,
          targetKey: `runtime:${runtimeEnvironmentId}`
        }
        setCreateDefaultParent(parent)
        setCreateParent(parent)
        setCreateRuntimeParentStatus('idle')
      })
      .catch(() => {
        if (gen !== createParentDefaultGenRef.current) {
          return
        }
        setCreateRuntimeParentStatus('failed')
      })
  }, [
    activeRuntimeEnvironmentId,
    activeCreateParentRuntimeEnvironmentId,
    activeCreateParentTargetKey,
    applyRememberedCreateParent,
    canReplaceCreateParentDefault,
    createParent,
    setCreateParent,
    step
  ])

  return {
    createDefaultParent,
    createGitAvailability,
    createRuntimeParentStatus,
    createParentDefaultPending: createParentPending,
    resetCreateDefaultState,
    markCreateParentTouched
  }
}
