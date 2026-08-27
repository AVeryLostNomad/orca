import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OPEN_WITH_FILE_EXTENSIONS,
  hasOpenWithFileExtension,
  openWithFilePathsFromArguments
} from './open-with-file'

// Why: tsconfig.node compiles this to CJS, so import.meta.url is unavailable; vitest runs from the repo root.
const requireFromRepoRoot = createRequire(join(process.cwd(), 'package.json'))

describe('open-with-file', () => {
  it('matches the packaging association list in config/file-associations.cjs', () => {
    const { openWithFileExtensions } = requireFromRepoRoot('./config/file-associations.cjs') as {
      openWithFileExtensions: string[]
    }
    expect([...OPEN_WITH_FILE_EXTENSIONS]).toEqual(openWithFileExtensions)
  })

  it('matches extensions case-insensitively', () => {
    expect(hasOpenWithFileExtension('/tmp/query.SQL')).toBe(true)
    expect(hasOpenWithFileExtension('/tmp/.env')).toBe(true)
    expect(hasOpenWithFileExtension('/tmp/.gitignore')).toBe(false)
    expect(hasOpenWithFileExtension('/tmp/noext')).toBe(false)
    expect(hasOpenWithFileExtension('/tmp/trailing.')).toBe(false)
  })

  it('filters argv down to absolute association-matching paths', () => {
    expect(
      openWithFilePathsFromArguments([
        '/usr/bin/orca-ide',
        '--inspect=9229',
        'orca://skills/share/x',
        'https://example.test/a.sql',
        'relative/path.sql',
        '/home/me/a.sql',
        'C:\\work\\b.yml',
        '\\\\server\\share\\c.md',
        '/home/me/archive.zip'
      ])
    ).toEqual(['/home/me/a.sql', 'C:\\work\\b.yml', '\\\\server\\share\\c.md'])
  })
})
