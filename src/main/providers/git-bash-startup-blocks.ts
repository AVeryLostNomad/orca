/**
 * Git for Windows startup speedups for the bash shell-ready rcfile.
 *
 * Every block tests `$OSTYPE` (msys/cygwin) itself, so the same rcfile stays a no-op addition on
 * macOS/Linux (OSTYPE darwin or linux-gnu) and in WSL. Why they exist: under MSYS every fork or
 * process start costs roughly 5-30ms (more with endpoint security hooks), and Git Bash's stock
 * startup pays dozens of them per pane.
 */

/**
 * Runs before /etc/profile.
 *
 * - chcp: Git Bash inherits the OEM codepage; select UTF-8 before TUIs write bytes. This used to
 *   run in a `bash -c "chcp; exec bash ..."` stub, which cost one extra MSYS process per pane.
 *   A missing chcp.com must not stop startup, hence the redirect and no `set -e` reliance.
 * - CYG_SYS_BASHRC: bash already read /etc/bash.bashrc (compiled-in SYS_BASHRC) before this file,
 *   and /etc/profile sources it again. Its "already sourced" guard sets CYG_SYS_BASHRC inside a
 *   `( )` subshell, so it never holds and the second pass re-runs git-prompt.sh and
 *   git-completion.bash. Setting the flag here is what the guard intended. MSYS2_PS1 (written by
 *   Git's git-prompt.sh, not exported) proves the first pass already ran in this shell.
 */
export const GIT_BASH_PRE_PROFILE_BLOCK = `# Git for Windows only (no-op elsewhere): UTF-8 codepage, and skip the duplicate bash.bashrc pass.
case "\${OSTYPE:-}" in
  msys*|cygwin*)
    chcp.com 65001 >/dev/null 2>&1 || :
    if [[ -n "\${MSYS2_PS1:-}" ]]; then CYG_SYS_BASHRC=1; fi
    ;;
esac`

/**
 * Runs after the user's startup files.
 *
 * Git for Windows' default prompt calls the stock `__git_ps1`, which forks `git rev-parse` before
 * every prompt (including the first). When the prompt is still Git's untouched default (PS1 equals
 * the MSYS2_PS1 that Git's git-prompt.sh records, contains its `__git_ps1` call, and Git's prompt
 * helpers are loaded), point that call at a fast path that answers the common case (on a branch,
 * nothing in progress) by reading .git/HEAD in bash. Anything else — GIT_PS1_* options, GIT_DIR,
 * bare repos, inside .git, detached HEAD (stock may print a tag), merge/rebase/etc. states, sparse
 * checkout, reftable — calls the real `__git_ps1`, which is never modified. A customized PS1 is left
 * alone. Preserves `$?`.
 *
 * Why no `$(declare -f __git_ps1)` copy: by this point the shell holds git-completion, and an MSYS
 * fork copies the whole heap, so that single fork costs ~15ms on every pane.
 */
export const GIT_BASH_FAST_GIT_PS1_BLOCK = `# Git for Windows only: fork-free fast path for the default prompt's __git_ps1 (falls back to it for anything unusual).
__orca_git_ps1_call='\`__git_ps1\`'
if [[ "\${OSTYPE:-}" == msys* || "\${OSTYPE:-}" == cygwin* ]] &&
  [[ -n "\${MSYS2_PS1:-}" && "\${PS1:-}" == "$MSYS2_PS1" && "$PS1" == *"$__orca_git_ps1_call"* ]] &&
  declare -F __git_ps1 __git_eread >/dev/null; then
  __orca_git_ps1_status() { return "$1"; }
  # An operation in progress or a sparse checkout changes what stock prints.
  __orca_git_ps1_busy() {
    local __orca_marker
    for __orca_marker in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG info/sparse-checkout; do
      [[ -e "$1/$__orca_marker" ]] && return 0
    done
    return 1
  }
  # Stock __git_ps1 captures $? on entry, so restore it last (shift and local would reset it).
  __orca_git_ps1_fallback() {
    local __orca_status="$1"
    shift
    __orca_git_ps1_status "$__orca_status"
    __git_ps1 "$@"
  }
  __orca_fast_git_ps1() {
    local __orca_exit=$?
    if (( $# > 1 )) || [[ -n "\${GIT_DIR:-}" || -n "\${!GIT_PS1_*}" ]]; then
      __orca_git_ps1_fallback "$__orca_exit" "$@"; return
    fi
    local __orca_dir="$PWD" __orca_gitdir="" __orca_line="" __orca_head=""
    while :; do
      case "$__orca_dir" in
        */.git|*/.git/*) __orca_git_ps1_fallback "$__orca_exit" "$@"; return ;;
      esac
      if [[ -d "$__orca_dir/.git" ]]; then
        __orca_gitdir="$__orca_dir/.git"
        break
      elif [[ -f "$__orca_dir/.git" ]]; then
        read -r __orca_line < "$__orca_dir/.git" || :
        __orca_gitdir="\${__orca_line#gitdir: }"
        case "$__orca_gitdir" in
          /*|[A-Za-z]:*) ;;
          *) __orca_gitdir="$__orca_dir/$__orca_gitdir" ;;
        esac
        break
      elif [[ -f "$__orca_dir/HEAD" && -d "$__orca_dir/objects" ]]; then
        # Looks like a bare repository: let stock decide.
        __orca_git_ps1_fallback "$__orca_exit" "$@"; return
      fi
      if [[ -z "$__orca_dir" || "$__orca_dir" == / ]]; then
        return "$__orca_exit"
      fi
      __orca_dir="\${__orca_dir%/*}"
    done
    read -r __orca_head < "$__orca_gitdir/HEAD" 2>/dev/null || :
    if [[ "$__orca_head" != "ref: refs/heads/"* || "$__orca_head" == "ref: refs/heads/.invalid" ]] ||
      __orca_git_ps1_busy "$__orca_gitdir"; then
      __orca_git_ps1_fallback "$__orca_exit" "$@"; return
    fi
    printf -- "\${1:- (%s)}" "\${__orca_head#ref: refs/heads/}"
    return "$__orca_exit"
  }
  __orca_git_ps1_fast_call='\`__orca_fast_git_ps1\`'
  PS1="\${PS1//"$__orca_git_ps1_call"/$__orca_git_ps1_fast_call}"
fi
unset __orca_git_ps1_call __orca_git_ps1_fast_call`
