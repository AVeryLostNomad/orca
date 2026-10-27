// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { EditorCoreSettingsSection } from './EditorCoreSettingsSection'

vi.mock('@/i18n/i18n', () => ({
  i18n: { language: 'en' },
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ settingsSearchQuery: 'Auto Save' })
}))
// Monaco-backed and IPC-backed rows are outside this draft-lifetime scenario.
vi.mock('./EditorColorThemeSetting', () => ({ EditorColorThemeSetting: () => null }))
vi.mock('./EditorFontFamilySetting', () => ({ EditorFontFamilySetting: () => null }))
vi.mock('./EditorFontSizeSetting', () => ({ EditorFontSizeSetting: () => null }))
vi.mock('./EditorWordWrapSetting', () => ({ EditorWordWrapSetting: () => null }))
vi.mock('./LanguageServerSettings', () => ({ LanguageServerSettings: () => null }))

afterEach(() => {
  cleanup()
})

// Auto Save lives in the Editor pane; its draft survives rerenders but not external writes or unmounts.
it('preserves an autosave draft until external settings change or the section unmounts', async () => {
  const settings = { ...getDefaultSettings('/synthetic'), editorAutoSaveDelayMs: 1000 }
  const props = { settings, updateSettings: vi.fn(), fontSuggestions: [] }
  const view = render(<EditorCoreSettingsSection {...props} />)
  await act(async () => {})
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2500' } })
  await act(async () => view.rerender(<EditorCoreSettingsSection {...props} />))
  expect(screen.getByRole('spinbutton').getAttribute('value')).toBe('2500')
  expect(props.updateSettings).not.toHaveBeenCalled()
  const changedProps = { ...props, settings: { ...settings, editorAutoSaveDelayMs: 3000 } }
  await act(async () => view.rerender(<EditorCoreSettingsSection {...changedProps} />))
  expect(screen.getByRole('spinbutton').getAttribute('value')).toBe('3000')
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3500' } })
  await act(async () => view.rerender(<div />))
  expect(screen.queryByRole('spinbutton')).toBeNull()
  await act(async () => view.rerender(<EditorCoreSettingsSection {...changedProps} />))
  expect(screen.getByRole('spinbutton').getAttribute('value')).toBe('3000')
  expect(props.updateSettings).not.toHaveBeenCalled()
})
