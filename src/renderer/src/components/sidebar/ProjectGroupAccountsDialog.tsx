import { useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import {
  getProjectGroupExecutionHostId,
  getProjectGroupSubtreeIds
} from '../../../../shared/project-groups'
import { resolveGroupAccountPin } from '../../../../shared/project-account-pins'
import type { ProjectAccountPinField } from '../../../../shared/project-account-pin-types'
import { useProjectAccountOptions } from '../project-accounts/project-account-options'
import {
  describeAccountPinFallback,
  ProjectAccountPinSelect
} from '../project-accounts/ProjectAccountPinSelect'

function useDescendantOverrideCounts(group: ProjectGroup): Record<ProjectAccountPinField, number> {
  const repos = useAppStore((state) => state.repos)
  const projectGroups = useAppStore((state) => state.projectGroups)
  const hostId = getProjectGroupExecutionHostId(group)
  const subtreeIds = getProjectGroupSubtreeIds(projectGroups, group.id, hostId)
  const count = (field: ProjectAccountPinField): number =>
    repos.filter(
      (repo) =>
        repo.projectGroupId &&
        subtreeIds.has(repo.projectGroupId) &&
        getRepoExecutionHostId(repo) === hostId &&
        repo[field]
    ).length +
    projectGroups.filter(
      (entry) =>
        entry.id !== group.id &&
        subtreeIds.has(entry.id) &&
        getProjectGroupExecutionHostId(entry) === hostId &&
        entry[field]
    ).length
  return {
    githubAccountRef: count('githubAccountRef'),
    claudeAccountId: count('claudeAccountId'),
    codexAccountId: count('codexAccountId')
  }
}

function ProjectGroupAccountsForm({
  group,
  hostId
}: {
  group: ProjectGroup
  hostId?: ExecutionHostId
}): React.JSX.Element {
  const projectGroups = useAppStore((state) => state.projectGroups)
  const updateProjectGroup = useAppStore((state) => state.updateProjectGroup)
  const options = useProjectAccountOptions()
  const overrideCounts = useDescendantOverrideCounts(group)
  const [applying, setApplying] = useState<ProjectAccountPinField | null>(null)
  const groupHostId = getProjectGroupExecutionHostId(group)
  const isLocalGroup = groupHostId === LOCAL_EXECUTION_HOST_ID

  const globalLabel = (account: string | null): string =>
    account
      ? translate(
          'auto.components.sidebar.ProjectGroupAccountsDialog.globalWithAccount',
          'Global selection ({{account}})',
          { account }
        )
      : translate('auto.components.sidebar.ProjectGroupAccountsDialog.global', 'Global selection')

  const rows: {
    field: ProjectAccountPinField
    label: string
    defaultLabel: string
  }[] = [
    {
      field: 'githubAccountRef',
      label: 'GitHub',
      defaultLabel: translate(
        'auto.components.sidebar.ProjectGroupAccountsDialog.githubDefault',
        'Default (active gh account)'
      )
    },
    // Why: managed agent accounts live on this machine; SSH projects use the remote host's login.
    ...(isLocalGroup
      ? [
          {
            field: 'claudeAccountId' as const,
            label: 'Claude',
            defaultLabel: globalLabel(options.globalClaudeLabel)
          },
          {
            field: 'codexAccountId' as const,
            label: 'Codex',
            defaultLabel: globalLabel(options.globalCodexLabel)
          }
        ]
      : [])
  ]

  const onChange = async (field: ProjectAccountPinField, value: string | null): Promise<void> => {
    const saved = await updateProjectGroup(group.id, { [field]: value }, { hostId })
    if (!saved) {
      toast.error(
        translate(
          'auto.components.sidebar.ProjectGroupAccountsDialog.saveFailed',
          'Could not update the group account'
        )
      )
    }
  }

  const applyToAll = async (field: ProjectAccountPinField): Promise<void> => {
    setApplying(field)
    try {
      const result = await window.api.projectGroups.clearDescendantAccountPins({
        groupId: group.id,
        field
      })
      if (!result) {
        throw new Error('group not found')
      }
      toast.success(
        translate(
          'auto.components.sidebar.ProjectGroupAccountsDialog.applied',
          'Cleared {{count}} override(s); everything in {{group}} now uses the group account.',
          {
            count: result.clearedProjects + result.clearedGroups,
            group: group.name
          }
        )
      )
    } catch (error) {
      toast.error(
        translate(
          'auto.components.sidebar.ProjectGroupAccountsDialog.applyFailed',
          'Could not apply the account to the group'
        ),
        { description: error instanceof Error ? error.message : String(error) }
      )
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className="space-y-4">
      {rows.map(({ field, label, defaultLabel }) => {
        const inherited = resolveGroupAccountPin(
          projectGroups,
          group.parentGroupId,
          groupHostId,
          field
        )
        const overrides = overrideCounts[field]
        return (
          <div key={field} className="space-y-1.5">
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-sm font-medium">{label}</span>
              <ProjectAccountPinSelect
                value={group[field] ?? null}
                options={options[field]}
                fallbackLabel={describeAccountPinFallback(inherited, options[field], defaultLabel)}
                onChange={(value) => void onChange(field, value)}
                ariaLabel={translate(
                  'auto.components.sidebar.ProjectGroupAccountsDialog.selectLabel',
                  '{{agent}} account',
                  { agent: label }
                )}
              />
            </div>
            <div className="flex items-center gap-2 pl-[76px]">
              <span className="text-xs text-muted-foreground">
                {overrides === 0
                  ? translate(
                      'auto.components.sidebar.ProjectGroupAccountsDialog.noOverrides',
                      'All projects inherit this'
                    )
                  : translate(
                      'auto.components.sidebar.ProjectGroupAccountsDialog.overrides',
                      '{{count}} project(s) or subgroup(s) override this',
                      { count: overrides }
                    )}
              </span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={overrides === 0 || applying !== null}
                onClick={() => void applyToAll(field)}
              >
                {translate(
                  'auto.components.sidebar.ProjectGroupAccountsDialog.forceApply',
                  'Force update all children'
                )}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ProjectGroupAccountsDialog({
  group,
  hostId,
  onOpenChange
}: {
  group: ProjectGroup | null
  hostId?: ExecutionHostId
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={group !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.sidebar.ProjectGroupAccountsDialog.title',
              'Group Accounts'
            )}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.sidebar.ProjectGroupAccountsDialog.description',
              'Projects in this group, including ones you drag in later, use these accounts unless they set their own. “Force update all children” clears those per-project and subgroup overrides.'
            )}
          </DialogDescription>
        </DialogHeader>
        {group ? <ProjectGroupAccountsForm group={group} hostId={hostId} /> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {translate('auto.components.sidebar.ProjectGroupAccountsDialog.done', 'Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
