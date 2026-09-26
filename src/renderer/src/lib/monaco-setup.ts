import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { typescript as monacoTS } from 'monaco-editor'
import 'monaco-editor/min/vs/editor/editor.main.css'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { installMonacoDiffProviderFactory } from './diff-comparison/monaco-diff-provider'
import { registerAstroLanguage } from './monaco-languages/register-astro'
import { registerJsonlLanguage } from './monaco-languages/register-jsonl'
import { registerNimLanguage } from './monaco-languages/register-nim'
import { registerSvelteLanguage } from './monaco-languages/register-svelte'
import { registerTomlLanguage } from './monaco-languages/register-toml'
import { registerVueLanguage } from './monaco-languages/register-vue'
import { installMonacoDelayerCancellationGuard } from './monaco-delayer-cancellation-guard'
import { installMonacoDiffEditorDisposalGuard } from './monaco-diff-editor-disposal'
import { installMonacoPeekReferencesPreviewOptions } from './monaco-peek-preview-options'
import { installMonacoContextMenuPaste } from '@/components/editor/install-monaco-context-menu-paste'

installMonacoDiffProviderFactory()

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  }
}

// Built-in diagnostics cannot resolve workspace imports; project diagnostics come from LSP.
const diagnosticsOptions = {
  noSemanticValidation: true,
  noSuggestionDiagnostics: true,
  noSyntaxValidation: true
}
monacoTS.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
monacoTS.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions)

// TSX/JSX share Monaco's base language IDs.
monacoTS.typescriptDefaults.setCompilerOptions({
  ...monacoTS.typescriptDefaults.getCompilerOptions(),
  jsx: monacoTS.JsxEmit.Preserve
})
monacoTS.javascriptDefaults.setCompilerOptions({
  ...monacoTS.javascriptDefaults.getCompilerOptions(),
  jsx: monacoTS.JsxEmit.Preserve
})

registerVueLanguage(monaco)
registerSvelteLanguage(monaco)
registerAstroLanguage(monaco)
registerNimLanguage(monaco)
registerJsonlLanguage(monaco)
registerTomlLanguage(monaco)
installMonacoDelayerCancellationGuard()
installMonacoDiffEditorDisposalGuard(monaco)
installMonacoPeekReferencesPreviewOptions()
// Why: Monaco's built-in context-menu Paste reads navigator.clipboard, which is
// blocked in Orca's sandboxed renderer. Route it through the trusted IPC bridge
// so right-click Paste works like Cmd+V (which already works via native events).
installMonacoContextMenuPaste(monaco)

// Configure Monaco to use the locally bundled editor instead of CDN
loader.config({ monaco })

// Re-export for convenience
export { monaco }
