import { defineFixture } from '../../component-fixtures/component-fixture'
import type { UnityApi } from '../../../../preload/api/unity-api'
import type {
  UnityConsoleEntry,
  UnityEditorState,
  UnityTestCaseResult
} from '../../../../shared/unity-types'
import type { ActiveUnityProject } from './unity-workbench-store'
import type { UnityPanelSection } from './unity-panel-section'
import { UnityPanelContent } from './UnityPanel'

const notAvailable = { ok: false as const, error: 'Not available in fixtures' }

function installUnityApi(overrides: Partial<UnityApi>): void {
  window.api.unity = {
    getProjectInfo: async () => null,
    findProjectRoots: async () => [],
    findScriptAssetUsages: async () => [],
    findMethodAssetUsages: async () => [],
    getEditorState: async ({ projectRoot }) => ({
      connected: false,
      cliAvailable: true,
      projectRoot
    }),
    onEditorState: () => () => {},
    runEditorAction: async () => notAvailable,
    getConsole: async () => ({ ok: true, entries: [], cursor: null }),
    openProjectInEditor: async () => notAvailable,
    getCliStatus: async () => ({ available: true, path: null, version: null }),
    getPipelineStatus: async () => ({
      installed: true,
      version: null,
      latestVersion: null,
      updateAvailable: false
    }),
    installPipeline: async () => notAvailable,
    listTests: async () => ({ ok: true, tests: [] }),
    runTests: async () => notAvailable,
    openDocs: async () => notAvailable,
    ensureEditorPackage: async () => notAvailable,
    ...overrides
  }
}

function connectedState(projectRoot: string): UnityEditorState {
  return {
    connected: true,
    cliAvailable: true,
    projectRoot,
    pid: 4242,
    port: 52100,
    editorVersion: '6000.0.23f1',
    state: 'ready',
    playMode: 'edit'
  }
}

function renderPanel(
  projectRoot: string,
  editorState: UnityEditorState,
  section: UnityPanelSection
): React.JSX.Element {
  const project: ActiveUnityProject = {
    projectRoot,
    info: null,
    editorState,
    pipelineStatus: null,
    cliStatus: null
  }
  return (
    <div className="flex h-[560px] flex-col border border-border">
      <UnityPanelContent project={project} isVisible section={section} />
    </div>
  )
}

async function waitForElement(
  frame: HTMLElement,
  find: () => Element | null | undefined
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const element = find()
    if (element instanceof HTMLElement) {
      return element
    }
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 25)
    await promise
  }
  throw new Error(`Fixture element did not appear in ${frame.id}`)
}

const at = (seconds: number): string =>
  new Date(Date.UTC(2026, 10, 7, 14, 3, seconds)).toISOString()

const PLAYER_STACK =
  'PlayerController.Update () (at Assets/Scripts/PlayerController.cs:42)\nUnityEngine.Debug:LogError (object)'

const CONSOLE_ENTRIES: UnityConsoleEntry[] = [
  { level: 'log', message: 'Loaded scene: MainMenu', stackTrace: '', timestamp: at(1) },
  {
    level: 'warning',
    message: 'The referenced script on this Behaviour (Game Object "HUD") is missing!',
    stackTrace: '',
    timestamp: at(2)
  },
  { level: 'log', message: 'Spawned 12 enemies', stackTrace: '', timestamp: at(3) },
  {
    level: 'error',
    message: 'Health went negative: -5',
    stackTrace: PLAYER_STACK,
    file: 'C:/Unity/PieceExploration/Assets/Scripts/PlayerController.cs',
    line: 42,
    timestamp: at(4)
  },
  {
    level: 'error',
    message: 'Health went negative: -5',
    stackTrace: PLAYER_STACK,
    file: 'C:/Unity/PieceExploration/Assets/Scripts/PlayerController.cs',
    line: 42,
    timestamp: at(5)
  },
  {
    level: 'exception',
    message:
      'NullReferenceException: Object reference not set to an instance of an object\nInventory.AddItem (Item item)',
    stackTrace:
      'Inventory.AddItem (Item item) (at Assets/Scripts/Inventory.cs:88)\nPickup.OnTriggerEnter (UnityEngine.Collider other) (at Assets/Scripts/Pickup.cs:21)',
    file: 'C:/Unity/PieceExploration/Assets/Scripts/Inventory.cs',
    line: 88,
    timestamp: at(6)
  },
  {
    level: 'error',
    message: 'Health went negative: -5',
    stackTrace: PLAYER_STACK,
    file: 'C:/Unity/PieceExploration/Assets/Scripts/PlayerController.cs',
    line: 42,
    timestamp: at(7)
  },
  { level: 'log', message: 'Autosave complete', stackTrace: '', timestamp: at(8) }
]

const CONSOLE_PROJECT = 'C:/Unity/ConsoleFixture'

// Mixed levels with duplicates collapsed and the exception's stack expanded.
export const consoleEntries = defineFixture({
  width: 340,
  setup: () => {
    installUnityApi({
      getConsole: async ({ cursor }) =>
        cursor
          ? { ok: true, entries: [], cursor }
          : { ok: true, entries: CONSOLE_ENTRIES, cursor: 'session:8' }
    })
  },
  render: () => renderPanel(CONSOLE_PROJECT, connectedState(CONSOLE_PROJECT), 'console'),
  interact: async (frame) => {
    const collapse = await waitForElement(frame, () =>
      frame.querySelector('[aria-label="Collapse duplicates"]')
    )
    await waitForElement(frame, () => frame.querySelector('[data-index]'))
    collapse.click()
    // Expand only after the collapsed rows render; their keys differ from the uncollapsed ones.
    await waitForElement(frame, () => frame.querySelector('[aria-label="3 occurrences"]'))
    const expand = await waitForElement(frame, () =>
      [...frame.querySelectorAll('[data-index]')]
        .find((row) => row.textContent?.includes('NullReferenceException'))
        ?.querySelector('button[aria-expanded]')
    )
    expand.click()
  }
})

const TEST_NAMES = [
  'PieceExploration.Tests.InventoryTests.AddsItem',
  'PieceExploration.Tests.InventoryTests.RejectsWhenFull',
  'PieceExploration.Tests.InventoryTests.StacksItems(3,"potion.small")',
  'PieceExploration.Tests.InventoryTests.StacksItems(5,"arrow")',
  'PieceExploration.Tests.PlayerTests.TakesDamage',
  'PieceExploration.Tests.PlayerTests.DiesAtZeroHealth'
]

const TEST_RESULTS: UnityTestCaseResult[] = [
  { fullName: TEST_NAMES[0], name: 'AddsItem', result: 'passed', durationMs: 12 },
  {
    fullName: TEST_NAMES[1],
    name: 'RejectsWhenFull',
    result: 'failed',
    durationMs: 31,
    message: '  Expected: False\n  But was:  True',
    stackTrace:
      'at PieceExploration.Tests.InventoryTests.RejectsWhenFull () [0x0001a] in C:\\Unity\\PieceExploration\\Assets\\Tests\\InventoryTests.cs:57',
    file: 'C:/Unity/PieceExploration/Assets/Tests/InventoryTests.cs',
    line: 57
  },
  {
    fullName: TEST_NAMES[2],
    name: 'StacksItems(3,"potion.small")',
    result: 'passed',
    durationMs: 4
  },
  { fullName: TEST_NAMES[3], name: 'StacksItems(5,"arrow")', result: 'passed', durationMs: 3 },
  { fullName: TEST_NAMES[4], name: 'TakesDamage', result: 'passed', durationMs: 8 },
  { fullName: TEST_NAMES[5], name: 'DiesAtZeroHealth', result: 'skipped', durationMs: 0 }
]

const TESTS_PROJECT = 'C:/Unity/TestsFixture'

// A finished EditMode run with the failing case's message and stack expanded.
export const tests = defineFixture({
  width: 340,
  setup: () => {
    installUnityApi({
      listTests: async ({ mode }) => ({
        ok: true,
        tests: TEST_NAMES.map((fullName) => ({ fullName, mode: mode ?? 'EditMode' }))
      }),
      runTests: async () => ({
        ok: true,
        passed: 4,
        failed: 1,
        skipped: 1,
        durationMs: 1840,
        cases: TEST_RESULTS
      })
    })
  },
  render: () => renderPanel(TESTS_PROJECT, connectedState(TESTS_PROJECT), 'tests'),
  interact: async (frame) => {
    const runAll = await waitForElement(frame, () =>
      [...frame.querySelectorAll('button')].find(
        (button) => button.textContent === 'Run all' && !button.disabled
      )
    )
    await waitForElement(frame, () => frame.querySelector('[data-index]'))
    runAll.click()
    const expand = await waitForElement(frame, () =>
      frame.querySelector('button[aria-label="Expand"]')
    )
    expand.click()
  }
})

const DISCONNECTED_PROJECT = 'C:/Unity/PieceExploration'

export const disconnected = defineFixture({
  width: 340,
  setup: () => installUnityApi({}),
  render: () =>
    renderPanel(
      DISCONNECTED_PROJECT,
      { connected: false, cliAvailable: true, projectRoot: DISCONNECTED_PROJECT },
      'console'
    )
})
