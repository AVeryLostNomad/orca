import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { RepoIcon } from '../../../../shared/repo-icon'
import { translate } from '@/i18n/i18n'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { RepositoryIconTabs } from '@/components/settings/RepositoryIconTabs'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

export function ProjectGroupIconDialog({
  group,
  onOpenChange,
  onSave
}: {
  group: ProjectGroup | null
  onOpenChange: (open: boolean) => void
  onSave: (groupId: string, icon: RepoIcon | null) => Promise<boolean>
}): React.JSX.Element {
  const [draftIcon, setDraftIcon] = useState<RepoIcon | null>(group?.icon ?? null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraftIcon(group?.icon ?? null)
  }, [group])

  const initialTab =
    draftIcon?.type === 'emoji' ? 'emoji' : draftIcon?.type === 'lucide' ? 'icon' : 'avatar'

  return (
    <Dialog open={group !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.sidebar.ProjectGroupIconDialog.title', 'Change Group Icon')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.sidebar.ProjectGroupIconDialog.description',
              'Choose the icon shown beside this group in the sidebar.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <RepoIconGlyph
            repoIcon={draftIcon}
            color={group?.color ?? 'var(--muted-foreground)'}
            className="size-10 shrink-0 rounded-md bg-muted/30"
            iconClassName="size-5"
          />
          <div className="min-w-0 flex-1 truncate text-sm font-medium">{group?.name}</div>
          <Button type="button" variant="outline" size="sm" onClick={() => setDraftIcon(null)}>
            <RotateCcw className="size-3.5" />
            {translate('auto.components.sidebar.ProjectGroupIconDialog.reset', 'Reset')}
          </Button>
        </div>
        <RepositoryIconTabs
          key={`${group?.id ?? 'closed'}:${initialTab}`}
          initialTab={initialTab}
          selectedLucideName={draftIcon?.type === 'lucide' ? draftIcon.name : null}
          selectedEmoji={draftIcon?.type === 'emoji' ? draftIcon.emoji : ''}
          showGitHubAvatar={false}
          onSetIcon={setDraftIcon}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {translate('auto.components.sidebar.ProjectGroupIconDialog.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            disabled={!group || saving}
            onClick={() => {
              if (!group) {
                return
              }
              setSaving(true)
              void onSave(group.id, draftIcon).then((saved) => {
                setSaving(false)
                if (saved) {
                  onOpenChange(false)
                }
              })
            }}
          >
            {saving
              ? translate('auto.components.sidebar.ProjectGroupIconDialog.saving', 'Saving…')
              : translate('auto.components.sidebar.ProjectGroupIconDialog.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
