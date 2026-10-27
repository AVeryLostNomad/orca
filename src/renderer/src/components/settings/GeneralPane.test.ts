import { describe, expect, it, vi } from 'vitest'
import {
  createAutoSaveDelayDraftState,
  getGeneralPaneSearchEntries,
  shouldShowProjectRuntimeSection,
  updateAutoSaveDelayDraftState
} from './GeneralPane'
import { matchesSettingsSearch } from './settings-search'
import { getEditorPaneSearchEntries } from './editor-search'

vi.mock('@/store', () => ({
  useAppStore: () => {
    throw new Error('Pure settings helpers must not access the app store')
  }
}))

vi.mock('@/components/terminal-pane/TerminalPane', () => ({
  default: () => {
    throw new Error('This suite must not render a terminal pane')
  }
}))

describe('GeneralPane auto-save delay drafts', () => {
  it('keeps a committed draft tied to the current persisted source while settings save is pending', () => {
    const current = createAutoSaveDelayDraftState(1000)

    expect(updateAutoSaveDelayDraftState(current, 1000, '1500')).toEqual({
      sourceDelayMs: 1000,
      draft: '1500'
    })
  })

  it('reconciles stale draft state before applying a new draft value', () => {
    const stale = updateAutoSaveDelayDraftState(createAutoSaveDelayDraftState(1000), 1000, '1500')

    expect(updateAutoSaveDelayDraftState(stale, 1250, '1750')).toEqual({
      sourceDelayMs: 1250,
      draft: '1750'
    })
  })
})

describe('GeneralPane search entries', () => {
  it('moved editor settings to the Editor pane so General no longer matches them', () => {
    const generalEntries = getGeneralPaneSearchEntries()
    const editorEntries = getEditorPaneSearchEntries()

    expect(matchesSettingsSearch('editor word wrap', generalEntries)).toBe(false)
    expect(matchesSettingsSearch('editor word wrap', editorEntries)).toBe(true)
    expect(matchesSettingsSearch('horizontal scroll', editorEntries)).toBe(true)
    expect(matchesSettingsSearch('spellcheck', generalEntries)).toBe(false)
    expect(matchesSettingsSearch('spellcheck', editorEntries)).toBe(true)
    expect(matchesSettingsSearch('red underline', editorEntries)).toBe(true)
  })

  it('includes the new editor font size setting in the Editor pane', () => {
    const editorEntries = getEditorPaneSearchEntries()

    expect(matchesSettingsSearch('editor font size', editorEntries)).toBe(true)
  })
})

describe('GeneralPane project runtime section visibility', () => {
  it('hides the section on non-Windows hosts even with an empty search query', () => {
    // Empty searches match empty entries; the platform gate must suppress orphaned non-Windows headers.
    expect(shouldShowProjectRuntimeSection(false, '', [])).toBe(false)
    expect(shouldShowProjectRuntimeSection(undefined, '', [])).toBe(false)
  })
})
