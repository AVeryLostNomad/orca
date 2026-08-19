import type { CodeServerImportSourceId } from './code-server-types'

/** One color theme contributed by an extension installed in a local editor. */
export type LocalEditorThemeDescriptor = {
  sourceId: CodeServerImportSourceId
  sourceName: string
  /** Folder name under the editor's extensions dir (`publisher.name-version`). */
  extensionFolder: string
  extensionDisplayName: string
  label: string
  /** VS Code theme kind: `vs` / `hc-light` are light, `vs-dark` / `hc-black` dark. */
  uiTheme: string
}

export type LocalEditorThemeReadRequest = {
  sourceId: string
  extensionFolder: string
  label: string
}

export type VSCodeTokenColorSetting = {
  scope?: string | string[]
  settings?: {
    foreground?: string
    background?: string
    fontStyle?: string
  }
}

/** A VS Code color theme with its `include` chain already flattened. */
export type MergedVSCodeTheme = {
  name?: string
  type: 'light' | 'dark'
  colors?: Record<string, string>
  tokenColors?: VSCodeTokenColorSetting[]
  semanticHighlighting?: boolean
}
