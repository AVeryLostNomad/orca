import type { KeyHandlerContext } from './rich-markdown-key-handler'
import { editorShortcutMatches } from './editor-shortcuts'

/**
 * Cmd/Ctrl+S first flushes the pending rich serialization. The actual save is
 * document-owned; it must not run a second stale serialization after another
 * surface has advanced the canonical document.
 */
export function handleRichMarkdownSaveShortcut(
  ctx: KeyHandlerContext,
  event: KeyboardEvent
): boolean {
  if (!editorShortcutMatches('editor.save', event)) {
    return false
  }
  event.preventDefault()
  // Why: flush pending debounced serialization so the save captures the very
  // latest editor content, not a stale snapshot.
  ctx.flushPendingSerialization()
  ctx.onSaveRef.current(ctx.lastCommittedMarkdownRef.current)
  return true
}
