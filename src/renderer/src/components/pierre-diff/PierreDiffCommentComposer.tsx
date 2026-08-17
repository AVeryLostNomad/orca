import { useRef, useState } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  getCommentBodySubmitState,
  hasBoundedCommentBodyText
} from '@/lib/comment-body-submit-state'
import { getDiffCommentLineLabel } from '@/lib/diff-comment-compat'
import { translate } from '@/i18n/i18n'

// Why: unlike DiffCommentPopover (an absolutely-positioned Monaco overlay),
// this renders inline as a slotted annotation inside the @pierre/diffs web
// component, so the diff itself makes room for the draft.

type Props = {
  lineNumber: number
  startLine?: number
  onCancel: () => void
  onSubmit: (body: string) => Promise<void>
}

export function PierreDiffCommentComposer({
  lineNumber,
  startLine,
  onCancel,
  onSubmit
}: Props): React.JSX.Element {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const mountedRef = useMountedRef()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const autoResize = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }

  const handleSubmit = async (): Promise<void> => {
    if (submitting) {
      return
    }
    const bodyState = getCommentBodySubmitState(body)
    if (bodyState.status === 'empty') {
      return
    }
    if (bodyState.status === 'too-large-leading-whitespace') {
      toast.error(
        translate(
          'auto.components.pierre.diff.PierreDiffCommentComposer.e56f918567',
          'Comment is too large to submit safely.'
        )
      )
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(bodyState.body)
    } finally {
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  return (
    <div className="my-1 rounded-md border border-border bg-card p-2 shadow-sm">
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">
        {getDiffCommentLineLabel({ lineNumber, startLine })}
      </div>
      <textarea
        ref={(el) => {
          textareaRef.current = el
          el?.focus()
        }}
        className="w-full resize-none rounded-sm border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder={translate(
          'auto.components.pierre.diff.PierreDiffCommentComposer.ac2496b245',
          'Add note for the AI'
        )}
        value={body}
        onChange={(e) => {
          setBody(e.target.value)
          autoResize(e.currentTarget)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
            return
          }
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
            e.preventDefault()
            void handleSubmit()
          }
        }}
        rows={3}
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {translate('auto.components.pierre.diff.PierreDiffCommentComposer.c9ed119fb6', 'Cancel')}
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={submitting || !hasBoundedCommentBodyText(body)}
        >
          {submitting
            ? translate(
                'auto.components.pierre.diff.PierreDiffCommentComposer.ad0f61e520',
                'Saving…'
              )
            : translate(
                'auto.components.pierre.diff.PierreDiffCommentComposer.0dc4b6b751',
                'Add note'
              )}
          {!submitting && <CornerDownLeft className="ml-1 size-3 opacity-70" />}
        </Button>
      </div>
    </div>
  )
}
