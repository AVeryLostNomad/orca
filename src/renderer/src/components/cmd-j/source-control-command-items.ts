import {
  ArrowDownToLine,
  ArrowUpFromLine,
  GitCommitHorizontal,
  GitPullRequestArrow,
  RefreshCw,
  Upload
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { DropdownActionKind } from '@/components/right-sidebar/source-control-dropdown-item-types'
import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { CmdJQuickAction } from './quick-actions'
import type { CmdJQuickActionAvailability, CmdJQuickActionContext } from './quick-action-context'
import { getCurrentWorkspaceActionAvailability } from './quick-action-context'
import { requestSourceControlAction } from './source-control-command-bridge'

type SourceControlItemSpec = {
  id: string
  kind: DropdownActionKind
  title: string
  description: string
  icon: LucideIcon
  verbKeywords: string[]
}

const getSourceControlItemSpecs = createLocalizedCatalog((): SourceControlItemSpec[] => [
  {
    id: 'source-control:commit',
    kind: 'commit',
    title: translate('auto.components.cmd.j.sourceControl.commit', 'Commit Changes'),
    description: translate(
      'auto.components.cmd.j.sourceControl.commitDesc',
      'Open Source Control and commit staged changes.'
    ),
    icon: GitCommitHorizontal,
    verbKeywords: [
      translate('auto.components.cmd.j.sourceControl.kw.commit', 'commit'),
      translate('auto.components.cmd.j.sourceControl.kw.commitChanges', 'commit changes')
    ]
  },
  {
    id: 'source-control:push',
    kind: 'push',
    title: translate('auto.components.cmd.j.sourceControl.push', 'Push'),
    description: translate(
      'auto.components.cmd.j.sourceControl.pushDesc',
      'Push commits to the remote branch.'
    ),
    icon: ArrowUpFromLine,
    verbKeywords: [
      translate('auto.components.cmd.j.sourceControl.kw.push', 'push'),
      translate('auto.components.cmd.j.sourceControl.kw.pushCode', 'push code'),
      translate('auto.components.cmd.j.sourceControl.kw.upload', 'upload commits')
    ]
  },
  {
    id: 'source-control:pull',
    kind: 'pull',
    title: translate('auto.components.cmd.j.sourceControl.pull', 'Pull'),
    description: translate(
      'auto.components.cmd.j.sourceControl.pullDesc',
      'Pull the latest changes from the remote branch.'
    ),
    icon: ArrowDownToLine,
    verbKeywords: [translate('auto.components.cmd.j.sourceControl.kw.pull', 'pull')]
  },
  {
    id: 'source-control:sync',
    kind: 'sync',
    title: translate('auto.components.cmd.j.sourceControl.sync', 'Sync'),
    description: translate(
      'auto.components.cmd.j.sourceControl.syncDesc',
      'Pull then push to sync with the remote branch.'
    ),
    icon: RefreshCw,
    verbKeywords: [
      translate('auto.components.cmd.j.sourceControl.kw.sync', 'sync'),
      translate('auto.components.cmd.j.sourceControl.kw.pullPush', 'pull push')
    ]
  },
  {
    id: 'source-control:publish',
    kind: 'publish',
    title: translate('auto.components.cmd.j.sourceControl.publish', 'Publish Branch'),
    description: translate(
      'auto.components.cmd.j.sourceControl.publishDesc',
      'Publish the current branch to the remote.'
    ),
    icon: Upload,
    verbKeywords: [
      translate('auto.components.cmd.j.sourceControl.kw.publish', 'publish branch'),
      translate('auto.components.cmd.j.sourceControl.kw.publishUpstream', 'set upstream')
    ]
  },
  {
    id: 'source-control:create-pr',
    kind: 'create_pr',
    title: translate('auto.components.cmd.j.sourceControl.createPr', 'Create Pull Request'),
    description: translate(
      'auto.components.cmd.j.sourceControl.createPrDesc',
      'Open Source Control and start a pull request.'
    ),
    icon: GitPullRequestArrow,
    verbKeywords: [
      translate('auto.components.cmd.j.sourceControl.kw.createPr', 'create pr'),
      translate('auto.components.cmd.j.sourceControl.kw.pullRequest', 'pull request'),
      translate('auto.components.cmd.j.sourceControl.kw.mergeRequest', 'merge request'),
      translate('auto.components.cmd.j.sourceControl.kw.openPr', 'open pr')
    ]
  }
])

function sourceControlAvailability(ctx: CmdJQuickActionContext): CmdJQuickActionAvailability {
  const base = getCurrentWorkspaceActionAvailability(ctx)
  if (!base.available) {
    return base
  }
  // Folder workspaces have no git repo — hide git verbs entirely.
  const repo = useAppStore.getState().repos.find((entry) => entry.id === ctx.activeWorktree?.repoId)
  if (!repo || !isGitRepoKind(repo)) {
    return { available: false, reason: 'no-active-workspace' }
  }
  return { available: true }
}

/** Reveal-and-delegate: the Source Control panel consumes the parked intent. */
export function buildSourceControlCommandItems(): CmdJQuickAction[] {
  return getSourceControlItemSpecs().map((spec) => ({
    id: spec.id,
    kind: 'action',
    title: spec.title,
    description: spec.description,
    icon: spec.icon,
    verbKeywords: spec.verbKeywords,
    isAvailable: sourceControlAvailability,
    run: async (ctx) => {
      const availability = sourceControlAvailability(ctx)
      if (!availability.available) {
        return { status: 'unavailable', reason: availability.reason }
      }
      const state = useAppStore.getState()
      state.setRightSidebarTab('source-control')
      state.setRightSidebarOpen(true)
      if (ctx.activeWorktreeId) {
        requestSourceControlAction(spec.kind, ctx.activeWorktreeId)
      }
      return { status: 'ok' }
    }
  }))
}
