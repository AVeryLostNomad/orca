# Version control for Unity projects

Unity's full reference: `unity skill show --path references/version-control.md`. Use plain `git`
for ordinary work; reach for `unity vcs` where it knows something about Unity that git does not.

## .meta files and GUIDs

- Every file and folder under `Assets/` (and inside embedded packages) has a `.meta` holding its
  GUID and import settings. Scenes, prefabs, and materials reference assets by GUID, so the
  `.meta` is part of the asset.
- Commit an asset and its `.meta` together, and delete them together.
- Never hand-edit, regenerate, or delete a `.meta` to make an error go away, and never copy one to
  create another asset. A new GUID silently breaks every reference to the asset; a duplicated GUID
  makes two assets fight over one identity.
- Move or rename with the Editor (`unity command asset move|rename`, which keep the GUID) or in
  Orca, which carries the `.meta`. With shell or file tools, move both:
  `git mv Assets/Old.cs Assets/New.cs` and `git mv Assets/Old.cs.meta Assets/New.cs.meta`. A folder's
  `.meta` sits beside the folder (`Assets/Scripts.meta`).
- New files get their `.meta` when Unity imports them; with the Editor open that happens on the
  next asset refresh (Orca refreshes on save). Commit the `.meta` Unity created.
- `unity projects verify PROJECT --format json` checks the tree with no Editor:
  `META_MISSING` (asset without `.meta`), `META_ORPHAN`, `GUID_DUPLICATE`, `CONFLICT_MARKERS`,
  `MANIFEST_INVALID`. It exits `6` on any error and only detects; repair through the Editor.
- `unity vcs guid GUID --format json` names the asset a GUID points to, instead of grepping every
  `.meta`.

## What to commit

Commit `Assets/`, `Packages/manifest.json`, `Packages/packages-lock.json`, embedded packages under
`Packages/`, and `ProjectSettings/`. Never commit `Library/`, `Temp/`, `obj/`, `Logs/`,
`UserSettings/`, build output, or the generated `.sln`/`.csproj`; a standard Unity `.gitignore`
excludes them. Do not add Orca's `Packages/com.stablyai.orca.ide` or `Library/Orca/` to a commit
unless the user wants the package shared. Before committing, read `git status` for staged files under
those folders and for assets missing their `.meta`.

## Scenes and prefabs are text YAML

The semantic tools need Asset Serialization Mode **Force Text**. A raw `git diff` of a scene is
unreadable, so read a change by object name:

```text
unity vcs status --format json
unity vcs diff Assets/Scenes/Level.unity --format json
unity vcs diff Assets/Prefabs/Player.prefab --from main --to HEAD
unity vcs blame Assets/Scenes/Level.unity
unity vcs summarize --since main
```

`vcs status` groups changes by what they mean to Unity and calls out `.meta` pairing problems.
`vcs summarize` lists reviewer risks such as GUID changes and assets moved without their `.meta`.

## Pull, switch, and merge

- `unity vcs sync` and `unity vcs switch BRANCH` refuse while an Editor holds the project, because
  pulling under a live Editor triggers a reimport storm. Ask the user before closing their Editor
  (`--close-editor`) or forcing past it. `vcs switch BRANCH --dry-run` reports the reimport a
  switch would cause.
- `unity vcs merge-setup` wires up `UnityYAMLMerge` for scenes and prefabs; `--check` reports only
  (exit `4` when work remains).
- In a conflict: `unity vcs conflicts`, `unity vcs explain PATH`, then `unity vcs resolve` (merge or
  take a side). Never resolve a scene, prefab, or `.meta` conflict by hand-editing YAML.

## Worktrees

One Editor per worktree. `unity vcs git worktree add BRANCH --into PATH --format json` creates a
worktree with a seeded `Library` and the right Editor version, and reports the real `project` path
to pass as `--project-path`. Remove it with `unity vcs git worktree remove PATH`.

## Large binaries

Track large binary assets (textures, models, audio) with Git LFS; `unity vcs doctor` audits ignore
rules, LFS patterns, and package pinning, and `--fix` repairs them. Unity Version Control (UVCS)
projects use `unity vcs uvcs locks|changesets|review` and pass raw `cm` commands through
`unity uvcs ARGS`.
