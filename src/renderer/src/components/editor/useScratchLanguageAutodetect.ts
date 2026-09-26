import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { getWorkingDocumentForFile } from '@renderer/store/slices/editor/working-document-state'
import { detectLanguageFromContent } from '@/lib/content-language-detect'
import { detectLanguage } from '@/lib/language-detect'
import { SCRATCH_FILE_NAME_PATTERN } from '@/lib/create-scratch-file'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import { executeOpenEditorPathMove } from '@/lib/execute-open-editor-path-move'
import { joinPath } from '@/lib/path'
import { runtimePathExists } from '@/runtime/runtime-file-client'
import { quiesceDocumentSave, requestEditorDocumentSave } from './editor-autosave'
import { getUntitledFileRoot } from './untitled-file-rename-path'

const DETECT_DEBOUNCE_MS = 600
const renamesInFlight = new Set<string>()

/**
 * Watches the active scratch document's canonical content and, once it reads as
 * a known language, renames the file's extension on disk (scratch.txt -> scratch.sql).
 * The rename rekeys the tab, which recomputes editor language, TextMate
 * highlighting, and the LSP binding from the new path — the single lever that
 * updates all three consistently.
 */
export function useScratchLanguageAutodetect(activeFile: OpenFile | null): void {
  const fileId = activeFile?.isScratch === true && activeFile.mode === 'edit' ? activeFile.id : null
  const document = useAppStore((state) =>
    fileId ? getWorkingDocumentForFile(state, fileId) : undefined
  )

  useEffect(() => {
    if (!fileId || !document?.content) {
      return
    }
    const handle = window.setTimeout(() => {
      void applyDetectedScratchLanguage(fileId, document.id, document.content!)
    }, DETECT_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [document?.content, document?.id, fileId])
}

async function applyDetectedScratchLanguage(
  fileId: string,
  documentId: WorkingDocumentId,
  content: string
): Promise<void> {
  const state = useAppStore.getState()
  const file = state.openFiles.find((f) => f.id === fileId)
  if (state.workingDocuments[documentId]?.content !== content) {
    return
  }
  // Why: only auto-generated names may be auto-renamed — never fight a name the user chose.
  if (
    !file ||
    file.isScratch !== true ||
    file.mode !== 'edit' ||
    !SCRATCH_FILE_NAME_PATTERN.test(file.relativePath)
  ) {
    return
  }
  const detection = detectLanguageFromContent(content)
  if (!detection || detection.language === detectLanguage(file.filePath)) {
    return
  }
  if (renamesInFlight.has(fileId)) {
    return
  }
  renamesInFlight.add(fileId)
  try {
    const root = getUntitledFileRoot(file)
    const context = getEditorFileOperationContext(state, file, root)
    const stem = file.relativePath.slice(0, file.relativePath.lastIndexOf('.'))
    const toPath = joinPath(root, `${stem}${detection.extension}`)
    // Why: another scratch tab may already hold the target name; skip this round
    // rather than clobbering — detection re-runs on the next edit.
    if (await runtimePathExists(context, toPath)) {
      return
    }
    await quiesceDocumentSave(documentId)
    await requestEditorDocumentSave({ documentId })
    if (useAppStore.getState().workingDocuments[documentId]?.target.filePath !== file.filePath) {
      return
    }
    await executeOpenEditorPathMove({
      context,
      fromPath: file.filePath,
      toPath,
      worktreeId: file.worktreeId,
      worktreePath: root
    })
  } catch {
    // Best-effort: a failed rename leaves a working plaintext tab, and the next
    // edit retries detection.
  } finally {
    renamesInFlight.delete(fileId)
  }
}
