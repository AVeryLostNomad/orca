import React from 'react'
import { EditProvider } from '@pierre/diffs/react'
import type { CreateEditor, FileDiffProps } from '@pierre/diffs/react'
import { Plus } from 'lucide-react'
import type { PierreDiffAnnotationData, PierreDiffDraft } from './pierre-diff-comment-annotations'
import { PierreDiffCommentAnnotation } from './pierre-diff-comment-annotations'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { PierreEditableFileDiff } from './PierreEditableFileDiff'

type PierreDiffSectionFileProps = Pick<
  FileDiffProps<PierreDiffAnnotationData>,
  'edit' | 'editorOptions' | 'fileDiff' | 'lineAnnotations' | 'options'
> & {
  createEditor: CreateEditor<PierreDiffAnnotationData>
  workingDocumentId?: WorkingDocumentId
  onSave?: (content: string) => Promise<boolean>
  canComment: boolean
  addLineCommentLabel?: string
  onAddAtLine: (lineNumber: number) => void
  onDeleteComment?: (id: string) => void
  onUpdateComment?: (id: string, body: string) => Promise<boolean>
  onCancelDraft: () => void
  onSubmitDraft: (draft: PierreDiffDraft, body: string) => Promise<void>
}

export function PierreDiffSectionFile({
  addLineCommentLabel,
  canComment,
  createEditor,
  onAddAtLine,
  onCancelDraft,
  onDeleteComment,
  onSubmitDraft,
  onUpdateComment,
  workingDocumentId,
  onSave,
  ...fileDiffProps
}: PierreDiffSectionFileProps): React.JSX.Element {
  return (
    <EditProvider createEditor={createEditor}>
      <PierreEditableFileDiff
        key={workingDocumentId}
        workingDocumentId={workingDocumentId}
        onSave={onSave}
        {...fileDiffProps}
        renderAnnotation={(annotation) =>
          annotation.metadata ? (
            <PierreDiffCommentAnnotation
              data={annotation.metadata}
              onDeleteComment={onDeleteComment}
              onUpdateComment={onUpdateComment}
              onCancelDraft={onCancelDraft}
              onSubmitDraft={onSubmitDraft}
            />
          ) : null
        }
        renderGutterUtility={
          canComment
            ? (getHoveredLine) => (
                <button
                  type="button"
                  aria-label={addLineCommentLabel ?? 'Add note'}
                  className="flex size-4 cursor-pointer items-center justify-center rounded-sm bg-primary text-primary-foreground shadow-sm"
                  onClick={() => {
                    const hovered = getHoveredLine()
                    if (hovered && hovered.side !== 'deletions') {
                      onAddAtLine(hovered.lineNumber)
                    }
                  }}
                >
                  <Plus className="size-3" />
                </button>
              )
            : undefined
        }
      />
    </EditProvider>
  )
}
