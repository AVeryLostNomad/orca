import { describe, expect, it } from 'vitest'
import { buildCodeServerUrl } from './code-server-webview'

describe('buildCodeServerUrl', () => {
  it('opens the folder with an encoded path', () => {
    expect(buildCodeServerUrl(8080, '/repo/my worktree')).toBe(
      'http://127.0.0.1:8080/?folder=%2Frepo%2Fmy%20worktree'
    )
  })
})
