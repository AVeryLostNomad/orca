import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { openExternalPathsInActiveWorkspace } from '@/lib/external-file-open'
import {
  NATIVE_FILE_DROP_MAX_PATHS,
  type NativeFileDropRejectedPayload
} from '../../../shared/native-file-drop'

export {
  getEditorFileDropOperationContext,
  getEditorFileDropSettingsForWorktree,
  shouldUploadRemoteEditorFileDrop
} from '@/lib/external-file-open'

export function useGlobalFileDrop(): void {
  useEffect(() => {
    return window.api.ui.onFileDrop((data) => {
      if (data.target === 'rejected') {
        showNativeFileDropRejection(data)
        return
      }

      if (data.target !== 'editor') {
        return
      }

      openExternalPathsInActiveWorkspace(data.paths)
    })
  }, [])
}

function showNativeFileDropRejection(data: NativeFileDropRejectedPayload): void {
  const message = getNativeFileDropRejectionMessage(data)
  toast.error(message.title, { description: message.description })
}

export function getNativeFileDropRejectionMessage(data: NativeFileDropRejectedPayload): {
  description: string
  title: string
} {
  if (data.reason === 'too-many-paths') {
    return {
      description: translate(
        'auto.hooks.useGlobalFileDrop.nativeDropTooManyPathsDescription',
        'Drop {{value0}} or fewer files at a time.',
        { value0: NATIVE_FILE_DROP_MAX_PATHS }
      ),
      title: translate(
        'auto.hooks.useGlobalFileDrop.nativeDropTooManyPaths',
        'Drop contains too many files.'
      )
    }
  }

  return {
    description: translate(
      'auto.hooks.useGlobalFileDrop.nativeDropPathsTooLargeDescription',
      'Drop fewer files or use a shorter path list.'
    ),
    title: translate(
      'auto.hooks.useGlobalFileDrop.nativeDropPathsTooLarge',
      'Drop path list is too large.'
    )
  }
}
