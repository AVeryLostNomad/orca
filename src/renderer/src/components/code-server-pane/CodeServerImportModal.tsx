import type { CodeServerImportSource } from '../../../../shared/code-server-types'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { UseCodeServerImportReturn } from './useCodeServerImport'

function sourceSummary(source: CodeServerImportSource): string {
  const parts: string[] = []
  if (source.hasSettings) {
    parts.push(
      translate('auto.components.code.server.pane.CodeServerImportModal.37836403ec', 'Settings')
    )
  }
  if (source.hasKeybindings) {
    parts.push(
      translate('auto.components.code.server.pane.CodeServerImportModal.0c46f685c1', 'Keybindings')
    )
  }
  if (source.hasSnippets) {
    parts.push(
      translate('auto.components.code.server.pane.CodeServerImportModal.650939408f', 'Snippets')
    )
  }
  if (source.extensionCount > 0) {
    parts.push(
      translate(
        'auto.components.code.server.pane.CodeServerImportModal.3a3a68ace1',
        '{{count}} extensions',
        { count: source.extensionCount }
      )
    )
  }
  return parts.join(' · ')
}

export function CodeServerImportModal(props: UseCodeServerImportReturn): React.JSX.Element {
  const { state, selectedSourceId, applied } = props
  const selected = state?.sources.find((s) => s.id === selectedSourceId)

  return (
    <Dialog open={props.open} onOpenChange={props.handleOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate(
              'auto.components.code.server.pane.CodeServerImportModal.5d66e7cb4e',
              'Use Your Editor Settings'
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.code.server.pane.CodeServerImportModal.09804247df',
              'Bring settings, keybindings, snippets, and extensions from an editor on this machine into the embedded VS Code.'
            )}
          </DialogDescription>
        </DialogHeader>

        {props.loading ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.code.server.pane.CodeServerImportModal.51181e3c10',
              'Detecting installed editors…'
            )}
          </p>
        ) : applied ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-green-600">
              {translate(
                'auto.components.code.server.pane.CodeServerImportModal.4a11eb10e3',
                'Import complete'
              )}
            </p>
            {applied.extensionsImported > 0 && (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.code.server.pane.CodeServerImportModal.02678305a1',
                  '{{count}} extensions installed.',
                  { count: applied.extensionsImported }
                )}
              </p>
            )}
            {applied.extensionsSkipped > 0 && (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.code.server.pane.CodeServerImportModal.2567936aa7',
                  '{{count}} already-installed extensions were skipped.',
                  { count: applied.extensionsSkipped }
                )}
              </p>
            )}
            {applied.restarted && (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.code.server.pane.CodeServerImportModal.06ff3cfd41',
                  'VS Code is reloading to apply the changes.'
                )}
              </p>
            )}
          </div>
        ) : state == null || state.sources.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.code.server.pane.CodeServerImportModal.1777686b0c',
              'No VS Code or Cursor configuration was found on this machine.'
            )}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              {state.sources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => props.setSelectedSourceId(source.id)}
                  className={cn(
                    'flex w-full flex-col items-start rounded-md border px-3 py-2 text-left',
                    source.id === selectedSourceId
                      ? 'border-primary bg-accent'
                      : 'border-border hover:bg-accent/50'
                  )}
                >
                  <span className="text-xs font-medium">{source.name}</span>
                  <span className="text-xs text-muted-foreground">{sourceSummary(source)}</span>
                </button>
              ))}
            </div>

            {selected && selected.extensionCount > 0 && (
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={props.includeExtensions}
                  onCheckedChange={(checked) => props.setIncludeExtensions(checked === true)}
                />
                {translate(
                  'auto.components.code.server.pane.CodeServerImportModal.69eb483fbf',
                  'Install {{count}} extensions',
                  { count: selected.extensionCount }
                )}
              </label>
            )}

            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.code.server.pane.CodeServerImportModal.2c04a2e2cb',
                'Settings, keybindings, and snippets stay linked — edits made in either editor apply to both.'
              )}
            </p>

            {props.applyError && <p className="text-xs text-red-500">{props.applyError}</p>}
          </div>
        )}

        <DialogFooter>
          {applied ? (
            <Button onClick={() => props.handleOpenChange(false)}>
              {translate(
                'auto.components.code.server.pane.CodeServerImportModal.30d1bf1217',
                'Done'
              )}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => props.handleOpenChange(false)}>
                {translate(
                  'auto.components.code.server.pane.CodeServerImportModal.ac0db0202e',
                  'Not Now'
                )}
              </Button>
              {state != null && state.sources.length > 0 && (
                <Button
                  disabled={props.applying || !selectedSourceId}
                  onClick={() => void props.handleApply()}
                >
                  {props.applying ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      {translate(
                        'auto.components.code.server.pane.CodeServerImportModal.2084722876',
                        'Importing…'
                      )}
                    </>
                  ) : (
                    translate(
                      'auto.components.code.server.pane.CodeServerImportModal.9ece26b2e4',
                      'Import'
                    )
                  )}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
