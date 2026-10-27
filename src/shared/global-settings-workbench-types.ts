import type { GithubPatAccountMeta } from './github/github-account-ref'
import type { GlobalSettingsBase } from './global-settings-base'

/** App/editor theming, language servers, extra tab kinds and stored GitHub accounts. */
export type WorkbenchSettings = {
  /** App chrome theme while in light mode. `'default'` (or unset) keeps Orca's
   *  built-in palette; otherwise the same id space as `editorThemeLight` — the
   *  theme's VS Code workbench colors are mapped onto Orca's CSS tokens. */
  appThemeLight?: string
  /** App chrome theme while in dark mode. Same id space as `appThemeLight`. */
  appThemeDark?: string
  /** When an app theme is active, terminals use its terminal/editor colors
   *  instead of the selected terminal theme. Unset means true. */
  terminalFollowsAppTheme?: boolean
  /** Opt-in code-editor font size; unset (the default) keeps following `terminalFontSize`. */
  editorFontSize?: number
  /** Editor color theme used while the app is in light mode. Bundled shiki
   *  theme id, or `local:...` for a theme scanned from an installed VS Code /
   *  Cursor / VSCodium theme extension. */
  editorThemeLight?: string
  /** Editor color theme used while the app is in dark mode. Same id space as
   *  `editorThemeLight`. */
  editorThemeDark?: string
  /** Master switch for language-server intellisense in the embedded editor.
   *  Servers download on demand when a matching file opens. */
  lspEnabled?: boolean
  /** Server ids (LspServerId) the user turned off individually. */
  lspDisabledServers?: string[]
  /** Offer "New VS Code Tab" in the new-tab menu (like disabling an agent type). */
  newTabVSCodeEnabled?: boolean
  /** Offer "New Data Studio Tab" in the new-tab menu. */
  newTabDataStudioEnabled?: boolean
  /** Metadata for Orca-stored GitHub PAT accounts; tokens live in encrypted credential files, never here. */
  githubPatAccounts?: GithubPatAccountMeta[]
}

/** Upstream's base settings plus the fork's workbench settings. */
export type BaseAndWorkbenchSettings = GlobalSettingsBase & WorkbenchSettings
