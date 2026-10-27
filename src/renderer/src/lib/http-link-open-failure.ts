import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

export function reportHttpLinkBrowserOpenFailure(error: unknown): void {
  toast.error(
    error instanceof Error
      ? error.message
      : translate('auto.lib.workspace.browser.tab.open.urlFailed', 'Unable to open URL.')
  )
}

export async function openSystemHttpLink(url: string): Promise<void> {
  try {
    await window.api.shell.openUrl(url)
  } catch {
    reportHttpLinkBrowserOpenFailure(null)
  }
}
