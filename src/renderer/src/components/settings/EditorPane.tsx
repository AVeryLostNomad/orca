import type React from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { useAppStore } from '../../store'
import { Separator } from '../ui/separator'
import { EditorCoreSettingsSection } from './EditorCoreSettingsSection'
import { EditorDiffMarkdownSettingsSection } from './EditorDiffMarkdownSettingsSection'
import { EditorSettingsPreview } from './EditorSettingsPreview'

type EditorPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  fontSuggestions: string[]
  onRequestFontSuggestions?: () => void
}

export function EditorPane({
  settings,
  updateSettings,
  fontSuggestions,
  onRequestFontSuggestions
}: EditorPaneProps): React.JSX.Element {
  const searchQuery = useAppStore((s) => s.settingsSearchQuery)
  // Why: while searching, sections collapse to matches only — a sticky preview
  // column next to one filtered row reads as clutter, so show it only unfiltered.
  const showPreview = searchQuery.trim() === ''

  const sections = (
    <div className="min-w-0 space-y-6">
      <EditorCoreSettingsSection
        settings={settings}
        updateSettings={updateSettings}
        fontSuggestions={fontSuggestions}
        onRequestFontSuggestions={onRequestFontSuggestions}
      />
      <Separator />
      <EditorDiffMarkdownSettingsSection settings={settings} updateSettings={updateSettings} />
    </div>
  )

  if (!showPreview) {
    return sections
  }

  // Why container queries: the pane renders inside the settings modal, so the
  // viewport breakpoints never describe the actual column width — the preview
  // must split off whenever the pane itself is wide enough.
  return (
    <div className="@container/editor-pane">
      {/* Always a grid (single column when narrow) — a flex→grid flip on the
          same element loses to `.flex` in the utilities cascade. */}
      <div className="grid grid-cols-1 items-start gap-6 @3xl/editor-pane:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] @3xl/editor-pane:gap-8">
        <div className="min-w-0 @3xl/editor-pane:sticky @3xl/editor-pane:top-0 @3xl/editor-pane:order-2 @3xl/editor-pane:self-start">
          <EditorSettingsPreview settings={settings} />
        </div>
        <div className="min-w-0 @3xl/editor-pane:order-1">{sections}</div>
      </div>
    </div>
  )
}
