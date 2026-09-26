import type { DiffLineAnnotation } from '@pierre/diffs/react'
import type { DecoratedDiffComment } from '../diff-comments/decorated-diff-comment'
import { getDiffCommentLineLabel } from '@/lib/diff-comment-compat'
import { DiffCommentCard } from '../diff-comments/DiffCommentCard'
import { PierreDiffCommentComposer } from './PierreDiffCommentComposer'

export type PierreDiffDraft = { lineNumber: number; startLine?: number }

export type PierreDiffAnnotationData =
  | { kind: 'comment'; comment: DecoratedDiffComment }
  | { kind: 'draft'; draft: PierreDiffDraft }

/**
 * Saved notes always anchor to the modified side ('additions'); the draft
 * composer anchors wherever the user clicked the gutter "+".
 */
export function buildPierreDiffAnnotations(
  comments: readonly DecoratedDiffComment[],
  draft: PierreDiffDraft | null
): DiffLineAnnotation<PierreDiffAnnotationData>[] {
  const annotations: DiffLineAnnotation<PierreDiffAnnotationData>[] = comments.map((comment) => ({
    side: 'additions',
    lineNumber: comment.lineNumber,
    metadata: { kind: 'comment', comment }
  }))
  if (draft) {
    annotations.push({
      side: 'additions',
      lineNumber: draft.lineNumber,
      metadata: { kind: 'draft', draft }
    })
  }
  return annotations
}

export function PierreDiffCommentAnnotation({
  data,
  onDeleteComment,
  onUpdateComment,
  onCancelDraft,
  onSubmitDraft
}: {
  data: PierreDiffAnnotationData
  onDeleteComment?: (id: string) => void
  onUpdateComment?: (id: string, body: string) => Promise<boolean>
  onCancelDraft: () => void
  onSubmitDraft: (draft: PierreDiffDraft, body: string) => Promise<void>
}): React.JSX.Element {
  if (data.kind === 'draft') {
    return (
      <PierreDiffCommentComposer
        lineNumber={data.draft.lineNumber}
        startLine={data.draft.startLine}
        onCancel={onCancelDraft}
        onSubmit={(body) => onSubmitDraft(data.draft, body)}
      />
    )
  }
  const comment = data.comment
  return (
    <div data-diff-comment-id={comment.id} className="my-1">
      <DiffCommentCard
        lineNumber={comment.lineNumber}
        startLine={comment.startLine}
        label={getDiffCommentLineLabel(comment)}
        body={comment.body}
        author={comment.author}
        createdAtLabel={comment.createdAtLabel}
        url={comment.url}
        onDelete={
          onDeleteComment && comment.canDelete !== false
            ? () => onDeleteComment(comment.id)
            : undefined
        }
        onSubmitEdit={
          onUpdateComment && comment.canEdit !== false
            ? (body) => onUpdateComment(comment.id, body)
            : undefined
        }
      />
    </div>
  )
}
