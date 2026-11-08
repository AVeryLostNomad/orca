import { toast } from 'sonner'
import { onLspNotification, type LspWorkspaceSession } from './lsp-client'
import { lspServerLabel } from './lsp-server-labels'

const subscribedSessionIds = new Set<string>()

function showServerMessage(session: LspWorkspaceSession, params: unknown): void {
  if (typeof params !== 'object' || params === null) {
    return
  }
  // window/showMessage uses `type`; Roslyn's window/_roslyn_showToast uses `messageType`.
  const type = 'messageType' in params ? params.messageType : 'type' in params ? params.type : null
  const message = 'message' in params ? params.message : null
  if (typeof message !== 'string' || message.length === 0 || (type !== 1 && type !== 2)) {
    return
  }
  const title = `${lspServerLabel(session.serverId)}: ${message}`
  // Same-text repeats replace the visible toast instead of stacking.
  const id = `lsp-message:${session.serverId}:${message}`
  if (type === 1) {
    toast.error(title, { id })
  } else {
    toast.warning(title, { id })
  }
}

/** Surface server error/warning messages (info/log stay silent). */
export function ensureLspServerMessageToasts(session: LspWorkspaceSession): void {
  if (subscribedSessionIds.has(session.sessionId)) {
    return
  }
  subscribedSessionIds.add(session.sessionId)
  onLspNotification(session, 'window/showMessage', (params) => showServerMessage(session, params))
  onLspNotification(session, 'window/_roslyn_showToast', (params) =>
    showServerMessage(session, params)
  )
}
