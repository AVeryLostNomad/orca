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

/** Quit teardown: never construct the manager (and its profile dirs) just to stop it. */
export function shutdownCodeServerServiceIfStarted(): Promise<void> {
  return manager ? manager.shutdown() : Promise.resolve()
}
