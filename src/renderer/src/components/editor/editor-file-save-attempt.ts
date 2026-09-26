import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { requestEditorDocumentSave, type EditorDocumentSaveTarget } from './editor-autosave'

export async function attemptEditorDocumentSave(
  target: EditorDocumentSaveTarget
): Promise<boolean> {
  try {
    await requestEditorDocumentSave(target)
    return true
  } catch (error) {
    console.error('[editor] document save failed', error)
    toast.error(
      translate(
        'auto.components.editor.editor.save.failure.notice.8c59ce5075',
        'Failed to save the file. Please try again.'
      )
    )
    return false
  }
}
