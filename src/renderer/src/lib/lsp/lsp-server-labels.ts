const SERVER_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  angular: 'Angular',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  yaml: 'YAML',
  pyright: 'Python',
  bash: 'Bash',
  dockerfile: 'Dockerfile',
  intelephense: 'PHP',
  vue: 'Vue',
  'rust-analyzer': 'Rust',
  clangd: 'C/C++',
  lua: 'Lua',
  marksman: 'Markdown',
  taplo: 'TOML',
  terraform: 'Terraform',
  gopls: 'Go',
  csharp: 'C#'
}

/** Human-facing name for a language server in chips and toasts. */
export function lspServerLabel(serverId: string): string {
  return SERVER_LABELS[serverId] ?? serverId
}
