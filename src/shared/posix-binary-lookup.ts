/** Which shell will run the generated lookup. 'bash' may use bash-only builtins. */
export type PosixBinaryLookupShell = 'posix' | 'bash'

/**
 * Shell code that assigns the PATH executable for `name` to `variable` (empty when there is
 * none), ignoring any alias named `name`. A shell function named `name` yields no binary, the
 * same as `command -v` reporting the bare name and failing the caller's `-x` test.
 *
 * Why a bash variant: the portable form runs in a `$(...)` subshell, and on Git Bash for Windows
 * every fork costs ~5-30ms, paid on every new terminal. bash can answer from its hash table
 * in-process: `hash` searches PATH only (aliases and functions don't apply) and `BASH_CMDS`
 * exposes the resolved path. `if` keeps a missing binary from tripping `set -e`.
 * BASH_CMDS only exists from bash 4.0, so older bash (macOS /bin/bash is 3.2) keeps the portable
 * subshell form; without the guard it would silently resolve nothing there.
 */
export function getPosixBinaryLookup(
  name: string,
  variable: string,
  shell: PosixBinaryLookupShell = 'posix'
): string {
  const portable = `${variable}="$(unalias ${name} 2>/dev/null || :; command -v ${name} 2>/dev/null || :)"`
  if (shell === 'bash') {
    return `if (( \${BASH_VERSINFO[0]:-0} >= 4 )); then
  ${variable}=""
  if ! declare -F ${name} >/dev/null && hash ${name} 2>/dev/null; then ${variable}="\${BASH_CMDS[${name}]:-}"; fi
else
  ${portable}
fi`
  }
  return portable
}
