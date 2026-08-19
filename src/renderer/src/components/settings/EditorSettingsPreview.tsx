import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import '@/lib/monaco-setup'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { useAppStore } from '@/store'
import { useMonacoThemeName } from '@/lib/monaco-highlighting/use-monaco-theme-name'
import {
  computeEditorFontSize,
  resolveEditorBaseFontSize,
  resolveEditorFontFamily
} from '@/lib/editor-font-zoom'
import { buildFileEditorWordWrapOptions } from '../editor/file-editor-word-wrap-options'
import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { EDITOR_PREVIEW_SAMPLES, type EditorPreviewLanguageId } from './editor-preview-sample'

type EditorSettingsPreviewProps = {
  settings: GlobalSettings
}

type PreviewEditor = Parameters<OnMount>[0]

export function EditorSettingsPreview({ settings }: EditorSettingsPreviewProps): React.JSX.Element {
  const [sampleId, setSampleId] = useState<EditorPreviewLanguageId>('typescript')
  const editorRef = useRef<PreviewEditor | null>(null)
  const monacoThemeName = useMonacoThemeName()
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)

  const sample =
    EDITOR_PREVIEW_SAMPLES.find((entry) => entry.id === sampleId) ?? EDITOR_PREVIEW_SAMPLES[0]
  const fontSize = computeEditorFontSize(resolveEditorBaseFontSize(settings), editorFontZoomLevel)
  const fontFamily = resolveEditorFontFamily(settings)
  const minimapEnabled = settings.editorMinimapEnabled

  useEffect(() => {
    // Why: updateOptions avoids the remount flicker Editor prop churn causes.
    editorRef.current?.updateOptions({
      fontSize,
      fontFamily,
      minimap: { enabled: minimapEnabled },
      ...buildFileEditorWordWrapOptions(settings.editorWordWrap)
    })
  }, [fontSize, fontFamily, minimapEnabled, settings.editorWordWrap])

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <Label className="text-xs font-medium text-muted-foreground">
          {translate('auto.components.settings.EditorSettingsPreview.title', 'Preview')}
        </Label>
        <Select
          value={sample.id}
          onValueChange={(value) => setSampleId(value as EditorPreviewLanguageId)}
        >
          <SelectTrigger size="sm" className="h-7 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EDITOR_PREVIEW_SAMPLES.map((entry) => (
              <SelectItem key={entry.id} value={entry.id} className="text-xs">
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="h-[420px]" style={{ background: 'var(--editor-surface)' }}>
        <Editor
          key={sample.id}
          path={`orca-settings-preview.${sample.id}`}
          language={sample.language}
          value={sample.content}
          theme={monacoThemeName}
          onMount={handleMount}
          options={{
            readOnly: true,
            contextmenu: false,
            scrollBeyondLastLine: false,
            fontSize,
            fontFamily,
            minimap: { enabled: minimapEnabled },
            ...buildFileEditorWordWrapOptions(settings.editorWordWrap),
            lineNumbers: 'on',
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            scrollbar: { alwaysConsumeMouseWheel: false }
          }}
        />
      </div>
    </div>
  )
}
