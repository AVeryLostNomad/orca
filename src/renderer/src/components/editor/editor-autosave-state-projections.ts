import type { AppState } from '@/store'

export type AutosaveSubscriberInputs = {
  workingDocuments: AppState['workingDocuments']
  editorAutoSave: boolean | undefined
  editorAutoSaveDelayMs: number | undefined
}

export function getAutosaveSubscriberInputs(state: AppState): AutosaveSubscriberInputs {
  return {
    workingDocuments: state.workingDocuments,
    editorAutoSave: state.settings?.editorAutoSave,
    editorAutoSaveDelayMs: state.settings?.editorAutoSaveDelayMs
  }
}

export function autosaveSubscriberInputsEqual(
  left: AutosaveSubscriberInputs,
  right: AutosaveSubscriberInputs
): boolean {
  return (
    left.workingDocuments === right.workingDocuments &&
    left.editorAutoSave === right.editorAutoSave &&
    left.editorAutoSaveDelayMs === right.editorAutoSaveDelayMs
  )
}
