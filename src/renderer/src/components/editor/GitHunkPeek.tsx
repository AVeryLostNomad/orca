import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Undo2, X } from 'lucide-react'
import { monaco } from '@/lib/monaco-setup'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useMonacoThemeName } from '@/lib/monaco-highlighting/use-monaco-theme-name'
import type { GitHunkPeekRow } from './git-gutter-hunks'

export type GitHunkPeekProps = {
  fileName: string
  rows: readonly GitHunkPeekRow[]
  language: string
  changeIndex: number
  changeCount: number
  canRevert: boolean
  fontFamily: string
  fontSize: number
  lineHeight: number
  onRevert: () => void
  onPrevious: () => void
  onNext: () => void
  onClose: () => void
}

type ColorizedRows = { rows: readonly GitHunkPeekRow[]; key: string; lines: readonly string[] }

// Colorize emits theme-resolved token classes, so it reruns when the theme changes.
function useColorizedRows(
  rows: readonly GitHunkPeekRow[],
  language: string
): readonly string[] | null {
  const themeName = useMonacoThemeName()
  const [html, setHtml] = useState<ColorizedRows | null>(null)
  const key = `${themeName}\0${language}`
  useEffect(() => {
    let cancelled = false
    void monaco.editor
      .colorize(rows.map((row) => row.text).join('\n'), language, { tabSize: 2 })
      .then(
        (result) => {
          if (!cancelled) {
            setHtml({ rows, key, lines: result.split('<br/>') })
          }
        },
        () => undefined
      )
    return () => {
      cancelled = true
    }
  }, [key, language, rows])
  return html?.rows === rows && html.key === key ? html.lines : null
}

function PeekAction({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Inline unified view of one working-tree change against HEAD, anchored under the change. */
export function GitHunkPeek({
  fileName,
  rows,
  language,
  changeIndex,
  changeCount,
  canRevert,
  fontFamily,
  fontSize,
  lineHeight,
  onRevert,
  onPrevious,
  onNext,
  onClose
}: GitHunkPeekProps): React.JSX.Element {
  const html = useColorizedRows(rows, language)
  const multiple = changeCount > 1
  return (
    <TooltipProvider delayDuration={400}>
      <div className="orca-git-hunk-peek flex h-full flex-col overflow-hidden border-y border-border bg-background text-foreground">
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
          <span className="truncate font-medium">{fileName}</span>
          <span className="truncate text-muted-foreground">
            {translate(
              'auto.components.editor.GitHunkPeek.position',
              'Changes since HEAD · {{value0}} of {{value1}}',
              {
                value0: changeIndex + 1,
                value1: changeCount
              }
            )}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <PeekAction
              label={translate('auto.components.editor.GitHunkPeek.revert', 'Revert change')}
              onClick={onRevert}
              disabled={!canRevert}
            >
              <Undo2 />
            </PeekAction>
            <PeekAction
              label={translate('auto.components.editor.GitHunkPeek.next', 'Next change')}
              onClick={onNext}
              disabled={!multiple}
            >
              <ArrowDown />
            </PeekAction>
            <PeekAction
              label={translate('auto.components.editor.GitHunkPeek.previous', 'Previous change')}
              onClick={onPrevious}
              disabled={!multiple}
            >
              <ArrowUp />
            </PeekAction>
            <PeekAction
              label={translate('auto.components.editor.GitHunkPeek.close', 'Close')}
              onClick={onClose}
            >
              <X />
            </PeekAction>
          </div>
        </div>
        <div
          className="scrollbar-editor min-h-0 flex-1 overflow-auto"
          style={{ fontFamily, fontSize, lineHeight: `${lineHeight}px` }}
        >
          {rows.map((row, index) => (
            <div
              key={`${row.kind}:${row.originalLineNumber ?? ''}:${row.modifiedLineNumber ?? ''}`}
              data-git-hunk-peek-row={row.kind}
              className={cn(
                'flex min-w-max whitespace-pre',
                row.kind === 'added' && 'bg-[var(--diff-added-ground)]',
                row.kind === 'removed' && 'bg-[var(--diff-removed-ground)]'
              )}
            >
              <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground tabular-nums">
                {row.originalLineNumber ?? ''}
              </span>
              <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground tabular-nums">
                {row.modifiedLineNumber ?? ''}
              </span>
              <span className="w-4 shrink-0 select-none text-center text-muted-foreground">
                {row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ''}
              </span>
              {html?.[index] ? (
                // Monaco's colorizer escapes source text; only its token spans are markup.
                <code
                  className="pr-4 font-[inherit]"
                  dangerouslySetInnerHTML={{ __html: html[index] }}
                />
              ) : (
                <code className="pr-4 font-[inherit]">{row.text || ' '}</code>
              )}
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}
