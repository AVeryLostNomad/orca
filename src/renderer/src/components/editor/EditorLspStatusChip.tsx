import { Loader2, TriangleAlert } from 'lucide-react'
import type { EditorLspStatus } from '@/lib/lsp/use-lsp-for-editor'
import { translate } from '@/i18n/i18n'

const SERVER_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  yaml: 'YAML',
  pyright: 'Python',
  bash: 'Bash',
  dockerfile: 'Dockerfile',
  intelephense: 'PHP',
  vue: 'Vue',
  'rust-analyzer': 'Rust',
  clangd: 'C/C++',
  lua: 'Lua',
  marksman: 'Markdown',
  taplo: 'TOML',
  terraform: 'Terraform',
  gopls: 'Go'
}

/** Transient bottom-right chip while a language server downloads or starts. */
export function EditorLspStatusChip({
  status
}: {
  status: EditorLspStatus
}): React.JSX.Element | null {
  if (status.phase === 'idle') {
    return null
  }
  const label = SERVER_LABELS[status.serverId] ?? status.serverId
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
      {status.phase === 'installing' ? (
        <span>
          {translate(
            'auto.components.editor.EditorLspStatusChip.installing',
            'Installing {{value0}} support… {{value1}}%',
            { value0: label, value1: Math.round(status.progress * 100) }
          )}
        </span>
      ) : status.phase === 'starting' ? (
        <span>
          {translate(
            'auto.components.editor.EditorLspStatusChip.starting',
            'Starting {{value0}} language server…',
            { value0: label }
          )}
        </span>
      ) : (
        <span>
          {translate(
            'auto.components.editor.EditorLspStatusChip.error',
            '{{value0}} language server unavailable',
            { value0: label }
          )}
        </span>
      )}
    </div>
  )
}
