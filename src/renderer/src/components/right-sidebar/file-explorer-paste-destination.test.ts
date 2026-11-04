import { describe, expect, it } from 'vitest'
import { resolveFileExplorerPasteDestination } from './file-explorer-paste-destination'

describe('resolveFileExplorerPasteDestination', () => {
  it('pastes into the target, including the copied entry’s own parent', () => {
    expect(resolveFileExplorerPasteDestination(['/repo-a/src/app.ts'], '/repo-b/lib')).toBe(
      '/repo-b/lib'
    )
    expect(resolveFileExplorerPasteDestination(['/repo/src'], '/repo')).toBe('/repo')
  })

  it('places a lone folder pasted onto itself beside it', () => {
    expect(resolveFileExplorerPasteDestination(['/repo/src'], '/repo/src')).toBe('/repo')
    expect(resolveFileExplorerPasteDestination(['C:\\repo\\src'], 'c:\\repo\\src')).toBe('c:\\repo')
  })

  it('refuses to paste a folder into its own subtree', () => {
    expect(resolveFileExplorerPasteDestination(['/repo/src'], '/repo/src/lib')).toBeNull()
    expect(
      resolveFileExplorerPasteDestination(['/repo/src', '/repo/README.md'], '/repo/src')
    ).toBeNull()
  })
})
