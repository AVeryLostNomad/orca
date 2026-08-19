import type React from 'react'
import { Suspense } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { markSettingsModalEscapePrevented, requestSettingsModalClose } from './settings-modal-close'

const Settings = lazy(() => import('./Settings'))

export function SettingsModal(): React.JSX.Element | null {
  const settingsOpen = useAppStore((s) => s.settingsOpen)

  return (
    <Dialog
      open={settingsOpen}
      onOpenChange={(open) => {
        if (!open) {
          requestSettingsModalClose()
        }
      }}
    >
      <DialogContent
        data-settings-modal-root
        showCloseButton={false}
        className="flex h-[90vh] w-[90vw] max-w-[90vw] flex-row gap-0 overflow-hidden p-0 sm:max-w-[90vw]"
        // Why: SettingsSidebar's searchAutoFocus owns entry focus (deep links suppress it).
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Why: Settings' document-level handler owns Escape (nested-overlay
        // detection, editable-target deferral, shortcuts double-esc, discard guard).
        onEscapeKeyDown={(e) => {
          markSettingsModalEscapePrevented(e)
          e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault()
          requestSettingsModalClose()
        }}
        // Why: a closing dropdown (e.g. sidebar "Project Settings") returns
        // focus to its trigger after this dialog opens; that focus-outside
        // must not dismiss the freshly opened modal.
        onFocusOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">
          {translate('auto.components.settings.SettingsModal.title', 'Settings')}
        </DialogTitle>
        <Suspense fallback={null}>{settingsOpen ? <Settings /> : null}</Suspense>
      </DialogContent>
    </Dialog>
  )
}
