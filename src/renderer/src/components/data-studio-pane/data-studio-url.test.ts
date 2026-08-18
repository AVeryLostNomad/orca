import { describe, expect, it } from 'vitest'
import { buildDataStudioUrl } from './data-studio-webview'

describe('buildDataStudioUrl', () => {
  it('opens the folder with an encoded path', () => {
    expect(buildDataStudioUrl(41100, '/repo/my worktree')).toBe(
      'http://127.0.0.1:41100/?folder=%2Frepo%2Fmy%20worktree'
    )
  })

  // A raw C:\ path parses the drive letter as the URI scheme — the workspace
  // goes "virtual" and mssql (virtualWorkspaces:false) is silently disabled.
  it('normalizes a Windows drive folder into vscode-remote URI form (/C:/...)', () => {
    expect(buildDataStudioUrl(41100, 'C:\\Users\\joey\\repo')).toBe(
      'http://127.0.0.1:41100/?folder=%2FC%3A%2FUsers%2Fjoey%2Frepo'
    )
  })

  it('normalizes a WSL UNC folder into forward-slash form', () => {
    expect(buildDataStudioUrl(41100, '\\\\wsl.localhost\\Ubuntu\\home\\joey\\repo')).toBe(
      'http://127.0.0.1:41100/?folder=%2F%2Fwsl.localhost%2FUbuntu%2Fhome%2Fjoey%2Frepo'
    )
  })
})
