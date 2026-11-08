# Orca Editor Integration

Makes [Orca](https://github.com/stablyai/orca) Unity's External Script Editor.

- **Open in Orca**: double-clicking a script, a console entry or a compile error opens the file at
  that line and column in Orca, adding the project folder to Orca first when needed.
- **Project files**: generates the `.sln` and `.csproj` files that Orca's C# language server loads.
  Only the selected External Script Editor's package generates them, so this package does it while
  Orca is selected.
- **Automatic setup**: Orca copies this package into `Packages/com.stablyai.orca.ide` when it opens a
  Unity project and writes `Library/Orca/orca-editor.json`. On first load the package selects Orca as
  the External Script Editor once per project; if you pick another editor afterwards, it stays.

## Preferences

**Edit > Preferences > External Tools** (with Orca selected) chooses which package sources get
their own projects (embedded and local packages by default; registry, git and built-in packages are
referenced as compiled DLLs), whether player projects are generated, and offers **Regenerate project
files**.

## Requirements

Unity 2021.3 or newer, and Orca with its `orca` command-line tool (bundled with the app).
