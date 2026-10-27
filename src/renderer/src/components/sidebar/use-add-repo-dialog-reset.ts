import { useCallback } from 'react'
import type { AddRepoDialogStep } from './add-repo-dialog-types'
import { useAddRepoHostChangeReset } from './use-add-repo-host-change-reset'

type AddRepoDialogResetInputs = {
  isOpen: boolean
  selectedHostId: string | null
  setStep: (step: AddRepoDialogStep) => void
  setIsAdding: (adding: boolean) => void
  setAddProjectBusyLabel: (label: string | null) => void
  resetLocalFolderFlow: () => void
  resetServerPathFlow: () => void
  resetCloneFlow: () => void
  resetNestedImportFlow: () => void
  resetNestedRepoReviewState: () => void
  resetCreateDefaultState: () => void
  resetCreateState: () => void
  resetRemoteState: () => void
}

/** Resets every add-project flow on close, and host-scoped flow state when the host changes. */
export function useAddRepoDialogReset(inputs: AddRepoDialogResetInputs): () => void {
  const {
    isOpen,
    selectedHostId,
    setStep,
    setIsAdding,
    setAddProjectBusyLabel,
    resetLocalFolderFlow,
    resetServerPathFlow,
    resetCloneFlow,
    resetNestedImportFlow,
    resetNestedRepoReviewState,
    resetCreateDefaultState,
    resetCreateState,
    resetRemoteState
  } = inputs
  const resetState = useCallback(() => {
    // Closing/backing out must abort an active clone instead of leaving it running on disk.
    void window.api.repos.cloneAbort()
    resetLocalFolderFlow()
    setStep('add')
    setIsAdding(false)
    setAddProjectBusyLabel(null)
    resetServerPathFlow()
    resetCloneFlow()
    resetNestedImportFlow()
    resetNestedRepoReviewState()
    resetCreateDefaultState()
    resetCreateState()
    resetRemoteState()
  }, [
    setStep,
    setIsAdding,
    setAddProjectBusyLabel,
    resetCloneFlow,
    resetLocalFolderFlow,
    resetNestedRepoReviewState,
    resetCreateDefaultState,
    resetServerPathFlow,
    resetNestedImportFlow,
    resetRemoteState,
    resetCreateState
  ])

  const resetHostScopedState = useCallback(() => {
    setIsAdding(false)
    setAddProjectBusyLabel(null)
    resetLocalFolderFlow()
    resetServerPathFlow()
    resetCloneFlow()
    resetCreateDefaultState()
    resetCreateState()
    resetRemoteState()
  }, [
    setIsAdding,
    setAddProjectBusyLabel,
    resetCloneFlow,
    resetCreateDefaultState,
    resetCreateState,
    resetRemoteState,
    resetLocalFolderFlow,
    resetServerPathFlow
  ])

  useAddRepoHostChangeReset({
    isOpen,
    selectedHostId,
    onResetClosed: resetState,
    onResetHostScopedState: resetHostScopedState
  })
  return resetState
}
