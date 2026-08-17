import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

type EditorPanelDiffCopyContentsButtonProps = {
  /** Copies the diff's modified-side contents; undefined when the diff has no text content. */
  onCopyDiffModifiedContents?: () => Promise<void>
}

/** Must render inside a TooltipProvider. */
export function EditorPanelDiffCopyContentsButton({
  onCopyDiffModifiedContents
}: EditorPanelDiffCopyContentsButtonProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current)
      }
    },
    []
  )
  const handleCopy = async (): Promise<void> => {
    if (!onCopyDiffModifiedContents) {
      return
    }
    try {
      await onCopyDiffModifiedContents()
    } catch {
      return
    }
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current)
    }
    setCopied(true)
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null
      setCopied(false)
    }, 1500)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          onClick={() => void handleCopy()}
          aria-label={translate(
            'auto.components.editor.EditorPanelHeader.0a6e218102',
            'Copy file contents'
          )}
          disabled={!onCopyDiffModifiedContents}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {onCopyDiffModifiedContents
          ? translate('auto.components.editor.EditorPanelHeader.0a6e218102', 'Copy file contents')
          : translate(
              'auto.components.editor.EditorPanelHeader.56558353b4',
              'This diff has no text contents to copy'
            )}
      </TooltipContent>
    </Tooltip>
  )
}
