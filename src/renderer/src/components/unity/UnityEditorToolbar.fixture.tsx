import { defineFixture } from '../../component-fixtures/component-fixture'
import type { UnityProjectInfo } from '../../../../shared/unity-types'
import { UnityEditorToolbarView } from './UnityEditorToolbar'
import type { ActiveUnityProject } from './unity-workbench-store'

const PROJECT_ROOT = 'C:/Unity/PieceExploration'

const info: UnityProjectInfo = {
  projectRoot: PROJECT_ROOT,
  editorVersion: '6000.0.23f1',
  tags: ['Untagged', 'Player'],
  layers: [{ index: 0, name: 'Default' }],
  sortingLayers: ['Default'],
  scenes: [{ path: 'Assets/Scenes/Main.unity', name: 'Main', enabled: true }],
  inputAxes: ['Horizontal', 'Vertical'],
  solutionFiles: [`${PROJECT_ROOT}/PieceExploration.sln`],
  hasProjectFiles: true,
  pipelinePackage: { installed: true, version: '1.2.0' }
}

const connectedEditorState = {
  connected: true,
  cliAvailable: true,
  projectRoot: PROJECT_ROOT,
  pid: 4242,
  port: 7777,
  editorVersion: '6000.0.23f1',
  state: 'ready',
  playMode: 'edit'
} as const

const connected: ActiveUnityProject = {
  projectRoot: PROJECT_ROOT,
  info,
  editorState: connectedEditorState,
  pipelineStatus: {
    installed: true,
    version: '1.2.0',
    latestVersion: '1.2.0',
    updateAvailable: false
  },
  cliStatus: { available: true, path: 'unity', version: '1.0.0' }
}

// Mirrors the tab strip so the toolbar's container queries see a real width.
function renderStrip(project: ActiveUnityProject): React.JSX.Element {
  return (
    <div className="@container/tab-strip h-[32px] border-b border-border bg-card">
      <div className="flex h-full items-stretch justify-end pr-1.5">
        <UnityEditorToolbarView project={project} />
      </div>
    </div>
  )
}

export const connectedEdit = defineFixture({
  width: 720,
  render: () => renderStrip(connected)
})

export const connectedPlaying = defineFixture({
  width: 720,
  render: () =>
    renderStrip({ ...connected, editorState: { ...connectedEditorState, playMode: 'playing' } })
})

export const disconnected = defineFixture({
  width: 720,
  render: () =>
    renderStrip({
      ...connected,
      editorState: { connected: false, cliAvailable: true, projectRoot: PROJECT_ROOT }
    })
})

// The overflow menu offers Open in Unity only while the editor is not running.
export const disconnectedMenu = defineFixture({
  width: 720,
  render: () =>
    renderStrip({
      ...connected,
      editorState: { connected: false, cliAvailable: true, projectRoot: PROJECT_ROOT },
      pipelineStatus: {
        installed: true,
        version: '1.1.0',
        latestVersion: '1.2.0',
        updateAvailable: true
      }
    }),
  interact: (frame) => {
    frame
      .querySelector<HTMLButtonElement>('button[aria-label="More Unity actions"]')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  }
})

export const cliMissing = defineFixture({
  width: 720,
  render: () =>
    renderStrip({
      ...connected,
      editorState: { connected: false, cliAvailable: false, projectRoot: PROJECT_ROOT },
      cliStatus: { available: false, path: null, version: null }
    })
})

export const projectFilesMissing = defineFixture({
  width: 720,
  render: () =>
    renderStrip({ ...connected, info: { ...info, hasProjectFiles: false, solutionFiles: [] } })
})

export const projectFilesMissingNarrow = defineFixture({
  width: 420,
  render: () =>
    renderStrip({ ...connected, info: { ...info, hasProjectFiles: false, solutionFiles: [] } })
})
