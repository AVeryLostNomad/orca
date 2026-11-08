import { Loader2, TriangleAlert } from 'lucide-react'
import type { EditorLspStatus } from '@/lib/lsp/use-lsp-for-editor'
import { lspServerLabel } from '@/lib/lsp/lsp-server-labels'
import { translate } from '@/i18n/i18n'

function statusText(status: Exclude<EditorLspStatus, { phase: 'idle' }>): string {
  const label = lspServerLabel(status.serverId)
  switch (status.phase) {
    case 'installing':
      return translate(
        'auto.components.editor.EditorLspStatusChip.installing',
        'Installing {{value0}} support… {{value1}}%',
        { value0: label, value1: Math.round(status.progress * 100) }
      )
    case 'starting':
      return translate(
        'auto.components.editor.EditorLspStatusChip.starting',
        'Starting {{value0}} language server…',
        { value0: label }
      )
    case 'loading-projects':
      return translate(
        'auto.components.editor.EditorLspStatusChip.loadingProjects',
        'Loading {{value0}} projects…',
        { value0: label }
      )
    case 'error':
      return translate(
        'auto.components.editor.EditorLspStatusChip.error',
        '{{value0}} language server unavailable',
        { value0: label }
      )
  }
}

/** Transient bottom-right chip while a language server downloads, starts, or loads projects. */
export function EditorLspStatusChip({
  status
}: {
  status: EditorLspStatus
}): React.JSX.Element | null {
  if (status.phase === 'idle') {
    return null
  }
  return (
    <div
      className="pointer-events-none absolute right-3 bottom-3 z-10 flex items-center gap-1.5 rounded-md border border-border bg-popover/95 px-2 py-1 text-[11px] text-muted-foreground shadow-sm"
      role="status"
    >
      {status.phase === 'error' ? (
        <TriangleAlert className="size-3 text-amber-500" />
      ) : (
        <Loader2 className="size-3 animate-spin" />
      )}
      <span>{statusText(status)}</span>
    </div>
  )
}
