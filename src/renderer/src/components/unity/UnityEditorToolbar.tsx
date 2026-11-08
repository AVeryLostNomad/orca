import { useState, type ReactNode } from 'react'
import {
  CircleAlert,
  CircleArrowUp,
  Download,
  Ellipsis,
  ExternalLink,
  FileCode2,
  FlaskConical,
  Hammer,
  Pause,
  Play,
  RefreshCw,
  Square,
  SquareTerminal,
  StepForward,
  TriangleAlert
} from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { NativeChatPendingIcon } from '@/components/native-chat/NativeChatPendingIcon'
import type { UnityEditorAction } from '../../../../shared/unity-types'
import { useActiveUnityProject, type ActiveUnityProject } from './unity-workbench-store'
import {
  UNITY_CLI_DOCS_URL,
  installUnityPipeline,
  openUnityProjectInEditor,
  revealUnityPanel,
  runUnityEditorAction
} from './unity-editor-commands'

type ToolbarControl = UnityEditorAction | 'open-in-unity' | 'install-pipeline' | 'upgrade-pipeline'

const ICON_BUTTON_CLASS =
  'my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-accent aria-pressed:text-foreground'

const LABELED_BUTTON_CLASS =
  'my-auto flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50'

const NO_PENDING: ReadonlySet<ToolbarControl> = new Set()

/** Unity editor controls for the active workspace's tab strip; hidden workspaces and web clients render nothing. */
export function UnityEditorToolbar({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const visible = useAppStore(
    (s) => s.activeView === 'terminal' && s.activeWorktreeId === worktreeId
  )
  return visible && !isPairedWebClientWindow() ? <ActiveUnityEditorToolbar /> : null
}

function ActiveUnityEditorToolbar(): React.JSX.Element | null {
  const project = useActiveUnityProject()
  return project ? <UnityEditorToolbarView project={project} /> : null
}

function ToolbarIconButton({
  label,
  pending,
  disabled,
  pressed,
  onClick,
  children
}: {
  label: string
  pending: boolean
  disabled: boolean
  pressed?: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled || pending}
          onClick={onClick}
          className={ICON_BUTTON_CLASS}
        >
          <NativeChatPendingIcon pending={pending} className="size-3.5">
            {children}
          </NativeChatPendingIcon>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

const TOOLBAR_DIVIDER = (
  <span aria-hidden="true" className="mx-0.5 my-auto h-4 w-px shrink-0 bg-border" />
)

const ROOT_CLASS = 'ml-1 flex shrink-0 items-center gap-0.5'
// SAFETY: React's CSSProperties lacks Electron's -webkit-app-region; the tab strip is a window drag region.
const NO_DRAG_STYLE = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

function UnityCliMissingButton(): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void window.api?.shell?.openUrl(UNITY_CLI_DOCS_URL)}
      className={LABELED_BUTTON_CLASS}
    >
      <CircleAlert className="size-3.5" />
      {translate('auto.components.unity.UnityEditorToolbar.cliMissing', 'Unity CLI not installed')}
    </button>
  )
}

function statusText(project: ActiveUnityProject): string {
  const { editorState, info } = project
  if (editorState?.connected) {
    return translate(
      'auto.components.unity.UnityEditorToolbar.statusConnected',
      'Unity editor connected ({{state}})',
      { state: editorState.state }
    )
  }
  if (info?.pipelinePackage.installed === false) {
    return translate(
      'auto.components.unity.UnityEditorToolbar.statusNoPipeline',
      'Unity Pipeline not installed; the editor can’t be controlled'
    )
  }
  return translate(
    'auto.components.unity.UnityEditorToolbar.statusDisconnected',
    'Unity editor not running'
  )
}

export function UnityEditorToolbarView({
  project
}: {
  project: ActiveUnityProject
}): React.JSX.Element {
  const { projectRoot, info, editorState, pipelineStatus, cliStatus } = project
  const [pending, setPending] = useState<ReadonlySet<ToolbarControl>>(NO_PENDING)
  const [menuOpen, setMenuOpen] = useState(false)

  if (cliStatus?.available === false) {
    return (
      <div className={ROOT_CLASS} style={NO_DRAG_STYLE}>
        <UnityCliMissingButton />
      </div>
    )
  }

  const runControl = (control: ToolbarControl, task: () => Promise<unknown>): void => {
    if (pending.has(control)) {
      return
    }
    setPending((current) => new Set(current).add(control))
    void task().finally(() =>
      setPending((current) => {
        const next = new Set(current)
        next.delete(control)
        return next
      })
    )
  }
  const runAction = (action: UnityEditorAction): void =>
    runControl(action, () => runUnityEditorAction(projectRoot, action))

  const connectedState = editorState?.connected ? editorState : null
  const playMode = connectedState?.playMode ?? 'unknown'
  const inPlayMode = playMode === 'playing' || playMode === 'paused'
  const disconnected = connectedState === null
  const version = connectedState?.editorVersion ?? info?.editorVersion ?? null
  const status = statusText(project)
  const projectFilesMissingLabel = translate(
    'auto.components.unity.UnityEditorToolbar.projectFilesMissing',
    'Project files missing — Regenerate'
  )

  return (
    <div className={ROOT_CLASS} style={NO_DRAG_STYLE} data-unity-editor-toolbar="">
      {info?.hasProjectFiles === false ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={disconnected || pending.has('regenerate-project-files')}
              onClick={() => runAction('regenerate-project-files')}
              className={cn(LABELED_BUTTON_CLASS, 'text-status-warning')}
              aria-label={projectFilesMissingLabel}
            >
              <NativeChatPendingIcon
                pending={pending.has('regenerate-project-files')}
                className="size-3.5"
              >
                <TriangleAlert className="size-3.5" />
              </NativeChatPendingIcon>
              {/* Hides after the version text so the actionable warning outlives it. */}
              <span className="@max-[560px]/tab-strip:hidden">{projectFilesMissingLabel}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {projectFilesMissingLabel}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => revealUnityPanel()}
            className={LABELED_BUTTON_CLASS}
            aria-label={status}
          >
            <span
              aria-hidden="true"
              className={cn(
                'size-2 shrink-0 rounded-full',
                disconnected ? 'bg-muted-foreground/50' : 'bg-status-success'
              )}
            />
            {version ? (
              <span className="font-mono @max-[640px]/tab-strip:hidden">{version}</span>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {status}
        </TooltipContent>
      </Tooltip>
      {TOOLBAR_DIVIDER}
      {inPlayMode ? (
        <ToolbarIconButton
          label={translate('auto.components.unity.UnityEditorToolbar.stop', 'Stop')}
          pending={pending.has('stop')}
          disabled={disconnected}
          pressed
          onClick={() => runAction('stop')}
        >
          <Square className="size-3.5" />
        </ToolbarIconButton>
      ) : (
        <ToolbarIconButton
          label={translate('auto.components.unity.UnityEditorToolbar.play', 'Play')}
          pending={pending.has('play')}
          disabled={disconnected || playMode === 'unknown'}
          onClick={() => runAction('play')}
        >
          <Play className="size-3.5" />
        </ToolbarIconButton>
      )}
      {/* The CLI's pause is a toggle, so the same action resumes. */}
      <ToolbarIconButton
        label={
          playMode === 'paused'
            ? translate('auto.components.unity.UnityEditorToolbar.resume', 'Resume')
            : translate('auto.components.unity.UnityEditorToolbar.pause', 'Pause')
        }
        pending={pending.has('pause')}
        disabled={!inPlayMode}
        pressed={playMode === 'paused'}
        onClick={() => runAction('pause')}
      >
        <Pause className="size-3.5" />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={translate('auto.components.unity.UnityEditorToolbar.step', 'Step')}
        pending={pending.has('step')}
        disabled={!inPlayMode}
        onClick={() => runAction('step')}
      >
        <StepForward className="size-3.5" />
      </ToolbarIconButton>
      {TOOLBAR_DIVIDER}
      <ToolbarIconButton
        label={translate('auto.components.unity.UnityEditorToolbar.refresh', 'Refresh assets')}
        pending={pending.has('refresh')}
        disabled={disconnected}
        onClick={() => runAction('refresh')}
      >
        <RefreshCw className="size-3.5" />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={translate('auto.components.unity.UnityEditorToolbar.recompile', 'Recompile scripts')}
        pending={pending.has('recompile')}
        disabled={disconnected}
        onClick={() => runAction('recompile')}
      >
        <Hammer className="size-3.5" />
      </ToolbarIconButton>
      <Tooltip>
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={translate(
                  'auto.components.unity.UnityEditorToolbar.moreActions',
                  'More Unity actions'
                )}
                className={ICON_BUTTON_CLASS}
              >
                <Ellipsis className="size-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
            <DropdownMenuItem
              disabled={disconnected || pending.has('regenerate-project-files')}
              onSelect={() => runAction('regenerate-project-files')}
            >
              <FileCode2 className="size-4" />
              {translate(
                'auto.components.unity.UnityEditorToolbar.regenerate',
                'Regenerate project files'
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => revealUnityPanel('console')}>
              <SquareTerminal className="size-4" />
              {translate(
                'auto.components.unity.UnityEditorToolbar.openConsole',
                'Open Unity console'
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => revealUnityPanel('tests')}>
              <FlaskConical className="size-4" />
              {translate('auto.components.unity.UnityEditorToolbar.runTests', 'Run tests')}
            </DropdownMenuItem>
            {disconnected ||
            info?.pipelinePackage.installed === false ||
            pipelineStatus?.updateAvailable ? (
              <DropdownMenuSeparator />
            ) : null}
            {disconnected ? (
              <DropdownMenuItem
                disabled={pending.has('open-in-unity')}
                onSelect={() =>
                  runControl('open-in-unity', () => openUnityProjectInEditor(projectRoot))
                }
              >
                <ExternalLink className="size-4" />
                {translate('auto.components.unity.UnityEditorToolbar.openInUnity', 'Open in Unity')}
              </DropdownMenuItem>
            ) : null}
            {info?.pipelinePackage.installed === false ? (
              <DropdownMenuItem
                disabled={pending.has('install-pipeline')}
                onSelect={() =>
                  runControl('install-pipeline', () =>
                    installUnityPipeline(projectRoot, { upgrade: false })
                  )
                }
              >
                <Download className="size-4" />
                {translate(
                  'auto.components.unity.UnityEditorToolbar.installPipeline',
                  'Install Unity Pipeline'
                )}
              </DropdownMenuItem>
            ) : null}
            {pipelineStatus?.updateAvailable ? (
              <DropdownMenuItem
                disabled={pending.has('upgrade-pipeline')}
                onSelect={() =>
                  runControl('upgrade-pipeline', () =>
                    installUnityPipeline(projectRoot, { upgrade: true })
                  )
                }
              >
                <CircleArrowUp className="size-4" />
                {translate(
                  'auto.components.unity.UnityEditorToolbar.updatePipeline',
                  'Update Unity Pipeline'
                )}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipContent side="bottom" sideOffset={6}>
          {translate('auto.components.unity.UnityEditorToolbar.moreActions', 'More Unity actions')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
