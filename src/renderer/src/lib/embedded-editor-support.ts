// Capability, not platform: the embedded editor (code-server) ships wherever
// the desktop preload exposes the codeServer bridge — mac, linux, and windows —
// while the web client has none. Local-vs-remote worktree gating stays a
// separate check at each call site.
export function isEmbeddedEditorSupported(): boolean {
  return typeof window !== 'undefined' && window.api?.codeServer != null
}
