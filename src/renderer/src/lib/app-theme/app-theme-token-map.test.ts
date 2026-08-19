import { describe, expect, it } from 'vitest'

import { buildAppThemeTokenOverrides } from './app-theme-token-map'

const NORD_SUBSET = {
  type: 'dark' as const,
  colors: {
    'editor.background': '#2e3440',
    'editor.foreground': '#d8dee9',
    'sideBar.background': '#2e3440',
    'sideBar.foreground': '#d8dee9',
    'activityBar.background': '#2e3440',
    'button.background': '#88c0d0',
    'button.foreground': '#2e3440',
    focusBorder: '#3b4252',
    'list.hoverBackground': '#3b4252',
    'panel.border': '#3b4252',
    'gitDecoration.modifiedResourceForeground': '#ebcb8b'
  }
}

describe('buildAppThemeTokenOverrides', () => {
  it('maps declared workbench colors verbatim', () => {
    const out = buildAppThemeTokenOverrides(NORD_SUBSET)
    expect(out).toBeDefined()
    expect(out?.['--background']).toBe('#2e3440')
    expect(out?.['--foreground']).toBe('#d8dee9')
    expect(out?.['--sidebar']).toBe('#2e3440')
    expect(out?.['--worktree-sidebar']).toBe('#2e3440')
    expect(out?.['--primary']).toBe('#88c0d0')
    expect(out?.['--primary-foreground']).toBe('#2e3440')
    expect(out?.['--ring']).toBe('#3b4252')
    expect(out?.['--git-decoration-modified']).toBe('#ebcb8b')
  })

  it('derives missing surfaces from the anchors instead of omitting them', () => {
    // light-plus class theme: only editor colors declared.
    const out = buildAppThemeTokenOverrides({
      type: 'light',
      colors: { 'editor.background': '#ffffff', 'editor.foreground': '#000000' }
    })
    expect(out).toBeDefined()
    expect(out?.['--sidebar']).toBeDefined()
    expect(out?.['--primary']).toBeDefined()
    expect(out?.['--border']).toBeDefined()
    expect(out?.['--muted-foreground']).toBeDefined()
    // No gitDecoration keys declared -> tokens omitted so Orca defaults stand.
    expect(out?.['--git-decoration-added']).toBeUndefined()
    expect(out?.['--destructive']).toBeUndefined()
  })

  it('falls back to shiki top-level bg/fg when the colors map lacks anchors', () => {
    const out = buildAppThemeTokenOverrides({ type: 'dark', bg: '#282a36', fg: '#f8f8f2' })
    expect(out?.['--background']).toBe('#282a36')
    expect(out?.['--foreground']).toBe('#f8f8f2')
  })

  it('returns undefined when no anchor colors exist', () => {
    expect(buildAppThemeTokenOverrides({ type: 'dark' })).toBeUndefined()
    expect(buildAppThemeTokenOverrides({ type: 'dark', colors: {} })).toBeUndefined()
  })

  it('replaces an illegible declared foreground pair with a readable one', () => {
    const out = buildAppThemeTokenOverrides({
      type: 'dark',
      colors: {
        'editor.background': '#111111',
        'editor.foreground': '#d8dee9',
        'button.background': '#111111',
        // Illegible on the near-black button surface:
        'button.foreground': '#1a1a1a'
      }
    })
    // Guard replaces the declared button.foreground with white.
    expect(out?.['--primary-foreground']).toBe('#ffffff')
  })

  it('composites alpha colors over the background for contrast decisions', () => {
    const out = buildAppThemeTokenOverrides({
      type: 'dark',
      colors: {
        'editor.background': '#202020',
        'editor.foreground': '#eeeeee',
        // Hover with alpha stays emitted verbatim (blend is the intent)...
        'list.hoverBackground': '#ffffff22'
      }
    })
    expect(out?.['--accent']).toBe('#ffffff22')
    // ...but its paired foreground was chosen against the flattened surface.
    expect(out?.['--accent-foreground']).toBeDefined()
  })

  it('replaces an unreadable primary anchor foreground rather than emitting it', () => {
    const out = buildAppThemeTokenOverrides({
      type: 'dark',
      colors: { 'editor.background': '#101010', 'editor.foreground': '#181818' }
    })
    // The declared foreground has ~1:1 contrast; the guard yields white.
    expect(out?.['--foreground']).toBe('#ffffff')
  })
})
