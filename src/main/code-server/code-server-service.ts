import { CodeServerManager, type CodeServerProvider } from './code-server-manager'

let manager: CodeServerProvider | null = null

// v1: always the local manager. A future remote provider is selected here.
export function getCodeServerService(): CodeServerProvider {
  if (!manager) {
    manager = new CodeServerManager()
  }
  return manager
}
