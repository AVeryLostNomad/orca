import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor'
import type { UnityAssetUsage } from '../../../../shared/unity-types'
import type { UnityInsightLens } from './unity-insight-analysis'
import { registerUnityCodeLensProvider } from './unity-monaco-code-lens'

const insightState = vi.hoisted(() => ({ lenses: [] as UnityInsightLens[] }))

vi.mock('./unity-asset-usage-peek', () => ({ SHOW_UNITY_ASSET_USAGES_COMMAND: 'show-usages' }))
vi.mock('./unity-docs', () => ({ OPEN_UNITY_DOCS_COMMAND: 'open-docs' }))
vi.mock('./unity-insight-model-state', () => ({
  onUnityInsightChanged: () => () => {},
  unityInsightForModel: () => ({
    filePath: 'C:\\Proj\\Assets\\Door.cs',
    project: { projectRoot: 'C:\\Proj' },
    analysis: { lenses: insightState.lenses, diagnostics: [] }
  })
}))

type Listener = () => void

function setup(): {
  provider: Monaco.languages.CodeLensProvider
  changes: { count: number }
  model: Monaco.editor.ITextModel
} {
  let provider: Monaco.languages.CodeLensProvider | undefined
  const changes = { count: 0 }
  const monaco = {
    Emitter: class {
      private listeners: Listener[] = []
      event = (listener: Listener): void => {
        this.listeners.push(listener)
      }
      fire(): void {
        changes.count += 1
        for (const listener of this.listeners) {
          listener()
        }
      }
    },
    languages: {
      registerCodeLensProvider: (_language: string, registered: typeof provider) => {
        provider = registered
      }
    }
  } as unknown as typeof Monaco
  registerUnityCodeLensProvider(monaco)
  const model = {
    uri: { toString: () => 'file:///C:/Proj/Assets/Door.cs' },
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 })
  } as unknown as Monaco.editor.ITextModel
  return { provider: provider!, changes, model }
}

const token = { isCancellationRequested: false } as Monaco.CancellationToken

async function providedLenses(
  provider: Monaco.languages.CodeLensProvider,
  model: Monaco.editor.ITextModel
): Promise<readonly Monaco.languages.CodeLens[]> {
  return (await provider.provideCodeLenses(model, token))?.lenses ?? []
}

describe('Unity handler-usage lenses', () => {
  let usages: UnityAssetUsage[]

  beforeEach(() => {
    usages = []
    vi.stubGlobal('window', {
      api: { unity: { findMethodAssetUsages: vi.fn(async () => usages) } }
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('drops the lens row of a method resolved to zero usages and restores it once bound', async () => {
    // A distinct method per test keeps the module-level caches from leaking between cases.
    insightState.lenses = [
      { kind: 'handler-usages', span: { start: 0, end: 4 }, methodName: 'OpenDoor' }
    ]
    const { provider, changes, model } = setup()

    const [lens] = await providedLenses(provider, model)
    expect(lens).toBeDefined()
    const resolved = await provider.resolveCodeLens!(model, lens, token)
    // Monaco renders a lens row (and a dangling separator) for any provided lens, even without a command.
    expect(resolved?.command).toBeUndefined()
    expect(changes.count).toBe(1)
    expect(await providedLenses(provider, model)).toEqual([])

    // A handler bound in the Unity editor reappears after the usage cache expires.
    usages = [{ assetPath: 'C:\\Proj\\Assets\\Door.prefab', count: 2 } as UnityAssetUsage]
    vi.advanceTimersByTime(31_000)
    expect(await providedLenses(provider, model)).toEqual([])
    await vi.waitFor(() => expect(changes.count).toBe(2))
    const [restored] = await providedLenses(provider, model)
    const bound = await provider.resolveCodeLens!(model, restored, token)
    expect(bound?.command?.title).toContain('2 event handler usages')
  })
})
