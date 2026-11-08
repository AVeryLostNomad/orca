import type React from 'react'
import { useEffect, useState } from 'react'
import { Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { basename } from '@/lib/path'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { UnityEditorState } from '../../../../shared/unity-types'
import { useActiveUnityProject, type ActiveUnityProject } from './unity-workbench-store'
import { setUnityPanelSection, type UnityPanelSection } from './unity-panel-section'
import { UnityConsoleSection } from './UnityConsoleSection'
import { UnityTestsSection } from './UnityTestsSection'

const OPEN_FEEDBACK_DELAY_MS = 200

type UnityPanelProps = {
  isVisible: boolean
  section: UnityPanelSection
}

export default function UnityPanel({ isVisible, section }: UnityPanelProps): React.JSX.Element {
  const project = useActiveUnityProject()
  if (!project) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        {translate(
          'auto.components.unity.UnityPanel.noProject',
          'No Unity project in this workspace.'
        )}
      </div>
    )
  }
  return (
    <UnityPanelContent
      key={project.projectRoot}
      project={project}
      isVisible={isVisible}
      section={section}
    />
  )
}

function connectionLabel(editorState: UnityEditorState | null): string {
  if (!editorState) {
    return translate('auto.components.unity.UnityPanel.checking', 'Checking editor…')
  }
  if (!editorState.connected) {
    return translate('auto.components.unity.UnityPanel.notRunning', 'Editor not running')
  }
  if (editorState.playMode === 'playing') {
    return translate('auto.components.unity.UnityPanel.connectedPlaying', 'Connected · playing')
  }
  if (editorState.playMode === 'paused') {
    return translate('auto.components.unity.UnityPanel.connectedPaused', 'Connected · paused')
  }
  return translate('auto.components.unity.UnityPanel.connected', 'Connected · {{state}}', {
    state: editorState.state
  })
}

export function UnityPanelContent({
  project,
  isVisible,
  section
}: UnityPanelProps & { project: ActiveUnityProject }): React.JSX.Element {
  const editorState = project.editorState
  const connected = editorState?.connected === true

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-sidebar-border px-2.5 py-2">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-foreground">
              {basename(project.projectRoot)}
            </div>
            <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  connected ? 'bg-status-success' : 'bg-muted-foreground/50'
                )}
              />
              <span className="truncate">{connectionLabel(editorState)}</span>
            </div>
          </div>
        </div>
        <div className="mt-2 rounded-md bg-muted p-0.5">
          <ToggleGroup
            variant="segmented"
            size="xs"
            type="single"
            spacing={1}
            value={section}
            onValueChange={(value) => {
              if (value === 'console' || value === 'tests') {
                setUnityPanelSection(value)
              }
            }}
            aria-label={translate(
              'auto.components.unity.UnityPanel.section',
              'Unity panel section'
            )}
            className="h-6 w-full"
          >
            <ToggleGroupItem value="console" className="min-w-0 flex-1">
              {translate('auto.components.unity.UnityPanel.console', 'Console')}
            </ToggleGroupItem>
            <ToggleGroupItem value="tests" className="min-w-0 flex-1">
              {translate('auto.components.unity.UnityPanel.tests', 'Tests')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      {!connected ? (
        <UnityDisconnectedState projectRoot={project.projectRoot} editorState={editorState} />
      ) : section === 'console' ? (
        <UnityConsoleSection projectRoot={project.projectRoot} active={isVisible} />
      ) : (
        <UnityTestsSection projectRoot={project.projectRoot} />
      )}
    </div>
  )
}

function UnityDisconnectedState({
  projectRoot,
  editorState
}: {
  projectRoot: string
  editorState: UnityEditorState | null
}): React.JSX.Element | null {
  const [opening, setOpening] = useState(false)
  const [showOpeningFeedback, setShowOpeningFeedback] = useState(false)
  const [result, setResult] = useState<{ ok: true } | { ok: false; error: string } | null>(null)

  useEffect(() => {
    if (!opening) {
      setShowOpeningFeedback(false)
      return
    }
    const timer = window.setTimeout(() => setShowOpeningFeedback(true), OPEN_FEEDBACK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [opening])

  if (!editorState) {
    return null
  }

  const openInUnity = async (): Promise<void> => {
    const openProjectInEditor = window.api?.unity?.openProjectInEditor
    if (!openProjectInEditor) {
      return
    }
    setOpening(true)
    setResult(null)
    const outcome = await openProjectInEditor({ projectRoot }).catch((error: unknown) => ({
      ok: false as const,
      error: String(error)
    }))
    setOpening(false)
    setResult(outcome.ok ? { ok: true } : { ok: false, error: outcome.error })
  }

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <Unplug className="size-6 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm text-foreground">
          {translate(
            'auto.components.unity.UnityPanel.disconnectedTitle',
            'Unity editor is not running'
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {editorState.cliAvailable
            ? translate(
                'auto.components.unity.UnityPanel.disconnectedBody',
                'Open the project in Unity to see its console and run tests.'
              )
            : translate(
                'auto.components.unity.UnityPanel.cliMissing',
                'The Unity CLI was not found. Install it to connect Orca to the editor.'
              )}
        </p>
      </div>
      <Button type="button" size="sm" disabled={opening} onClick={() => void openInUnity()}>
        {showOpeningFeedback ? <LoadingSpinner className="size-4" /> : null}
        {showOpeningFeedback
          ? translate('auto.components.unity.UnityPanel.opening', 'Opening…')
          : translate('auto.components.unity.UnityPanel.openInUnity', 'Open in Unity')}
      </Button>
      {result?.ok ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.unity.UnityPanel.waitingForEditor',
            'Waiting for the editor to connect…'
          )}
        </p>
      ) : null}
      {result && !result.ok ? (
        <p role="alert" className="text-xs text-destructive break-words">
          {result.error}
        </p>
      ) : null}
    </div>
  )
}
