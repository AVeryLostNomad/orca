import type React from 'react'
import { Sparkles } from 'lucide-react'
import { translate } from '@/i18n/i18n'

/** The "Or quick AI?" fallback row shown when a query matches nothing. */
export function QuickAiRow({ query }: { query: string }): React.JSX.Element {
  return (
    <div className="flex w-full min-w-0 items-center gap-2 px-3 py-2">
      <Sparkles className="size-4 shrink-0 text-ai-action-accent" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground">
          {translate('auto.components.cmd.j.QuickAiRow.prompt', 'Or quick AI?')}
        </span>{' '}
        <span className="text-muted-foreground">{`\u201C${query}\u201D`}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        <kbd className="rounded border border-border/60 bg-muted/35 px-1.5 py-0.5 text-[10px] font-medium text-foreground/85">
          {translate('auto.components.cmd.j.QuickAiRow.tabKey', 'Tab')}
        </kbd>
        {translate('auto.components.cmd.j.QuickAiRow.hint', 'to ask your agent')}
      </span>
    </div>
  )
}
