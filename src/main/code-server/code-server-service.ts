import { CodeServerManager, type CodeServerProvider } from './code-server-manager'
import { createEditorProfile } from './code-server-profile'

let manager: CodeServerProvider | null = null

// v1: always the local manager. A future remote provider is selected here.
export function getCodeServerService(): CodeServerProvider {
  if (!manager) {
    manager = new CodeServerManager(createEditorProfile())
  }
  return manager
}
