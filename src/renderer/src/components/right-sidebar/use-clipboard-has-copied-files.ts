import { useEffect, useState } from 'react'

/** Whether the OS clipboard held copied files when the calling menu opened. */
export function useClipboardHasCopiedFiles(): boolean {
  const [hasCopiedFiles, setHasCopiedFiles] = useState(false)
  useEffect(() => {
    let mounted = true
    window.api.ui.readClipboardFilePaths().then(
      (paths) => {
        if (mounted) {
          setHasCopiedFiles(paths.length > 0)
        }
      },
      // An unreadable clipboard leaves Paste disabled, which is the honest state.
      () => {}
    )
    return () => {
      mounted = false
    }
  }, [])
  return hasCopiedFiles
}
