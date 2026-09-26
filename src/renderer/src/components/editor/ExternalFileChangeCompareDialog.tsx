import React, { Suspense, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { detectLanguage } from '@/lib/language-detect'
import { readRuntimeFileContent } from '@/runtime/runtime-file-client'
import { settingsForRuntimeOwner } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import type { WorkingDocument } from '@/store/slices/editor/working-document'
import { translate } from '@/i18n/i18n'

const DiffViewer = lazy(() => import('./DiffViewer'))

type DiskReadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'binary' }
  | { kind: 'ready'; content: string }

// The disk side is a private immutable snapshot. It never joins the working
// document model registry, so comparing a conflict cannot mutate the draft.
export function ExternalFileChangeCompareDialog({
  document,
  currentContent,
  open,
  onOpenChange,
  onReload,
  onKeepEdits
}: {
  document: WorkingDocument
  currentContent: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onReload: () => void
  onKeepEdits: () => void
}): React.JSX.Element {
  const [diskState, setDiskState] = useState<DiskReadState>({ kind: 'loading' })
  const { target } = document

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    setDiskState({ kind: 'loading' })
    void readRuntimeFileContent({
      settings: settingsForRuntimeOwner(
        useAppStore.getState().settings,
        target.owner.runtimeEnvironmentId
      ),
      filePath: target.filePath,
      relativePath: target.relativePath,
      worktreeId: target.worktreeId,
      connectionId: getConnectionIdForFile(target.worktreeId, target.filePath) ?? undefined,
      expectedExternalSshTargetId: target.externalSshTargetId
    })
      .then((result) => {
        if (!cancelled) {
          setDiskState(
            result.isBinary ? { kind: 'binary' } : { kind: 'ready', content: result.content }
          )
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDiskState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, target])

  const language = detectLanguage(target.relativePath)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-border/60 p-4">
          <DialogTitle>
            {translate(
              'auto.components.editor.ExternalFileChangeCompareDialog.4b8de20a11',
              'File changed on disk'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.editor.ExternalFileChangeCompareDialog.90cc31e4d7',
              'Disk version on the left, your unsaved edits on the right.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {diskState.kind === 'loading' ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              {translate(
                'auto.components.editor.ExternalFileChangeCompareDialog.8fe30ab254',
                'Reading file from disk...'
              )}
            </div>
          ) : diskState.kind === 'error' ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {translate(
                'auto.components.editor.ExternalFileChangeCompareDialog.e2b1cd0393',
                'Could not read the file from disk: {{value0}}',
                { value0: diskState.message }
              )}
            </div>
          ) : diskState.kind === 'binary' ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {translate(
                'auto.components.editor.ExternalFileChangeCompareDialog.b6cf20d514',
                'The file on disk is binary — no text comparison available.'
              )}
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {translate(
                    'auto.components.editor.ExternalFileChangeCompareDialog.2c8f1e07b9',
                    'Loading comparison...'
                  )}
                </div>
              }
            >
              <div className="flex h-full min-h-0 flex-col">
                <DiffViewer
                  modelKey={`external-change-compare:${document.id}`}
                  originalContent={diskState.content}
                  modifiedContent={currentContent}
                  language={language}
                  filePath={target.filePath}
                  relativePath={target.relativePath}
                  sideBySide
                />
              </div>
            </Suspense>
          )}
        </div>
        <DialogFooter className="border-t border-border/60 p-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              onOpenChange(false)
              onReload()
            }}
          >
            {translate(
              'auto.components.editor.ExternalFileChangeCompareDialog.3fa2b8d417',
              'Reload from Disk'
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onOpenChange(false)
              onKeepEdits()
            }}
          >
            {translate(
              'auto.components.editor.ExternalFileChangeCompareDialog.a95d02c644',
              'Keep My Edits'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
