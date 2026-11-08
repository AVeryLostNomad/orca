# Tests and builds

Unity's full reference: `unity skill show --path references/build-run-test.md`.

## Pick the cheapest test that can fail

1. EditMode before PlayMode. Use PlayMode only for behavior that needs frames, physics, or a
   running scene.
2. Narrow the run while iterating (`--filter`), then run the full suite once per mode on the final
   code before handing the work back.
3. Never re-run a suite on unchanged code: the last result already holds the answer. Re-run only a
   run that produced no verdict, after fixing its cause.

## In the open Editor (the normal case in Orca)

`unity test` starts its own batch Editor, so it refuses a project that is open in one (exit `6`,
"already open in a running Editor"). Never close the user's Editor to make room; run the tests
through it. Check first that it is not playing:

```text
unity command editor status --project-path PROJECT --fields playMode
unity command test list --project-path PROJECT --format json -- --mode editor
```

Pipeline modes are `editor`, `playmode`, and `all` (not `EditMode`/`PlayMode`). `test run` also
takes `--filter` (a case-insensitive partial name match), `--filter-type testName|assembly|category`,
and `--include-explicit true`.

**EditMode** answers synchronously. The command's own `--timeout` defaults to 600 seconds and the
CLI's to 30, so raise the CLI's:

```text
unity command test run --project-path PROJECT --format json --timeout 900 -- --mode editor --filter MyNamespace.MyTests
```

**PlayMode** cannot answer in the same request: entering play mode reloads the domain and drops
the server. Start it asynchronously, then poll until `status` is `completed` (or `error` /
`cancelled`), waiting through the reload:

```text
unity command test run --project-path PROJECT --format json -- --mode playmode --async-tests true
unity status --until-ready --project-path PROJECT --format json
unity command test status --project-path PROJECT --format json
```

Results list each test with its outcome, message, and stack trace; open a failure's source line for
the user with `ORCA file open PATH --line N`. `unity command test cancel` stops a run you started.
Orca's **Tests** tab drives these same commands, and starting a run cancels the one in progress, so
never start one while the user's is going.

## With no Editor open (CI, headless)

```text
unity test PROJECT --mode EditMode --output REPORTS/full.xml --timeout 600
unity test PROJECT --mode PlayMode --output REPORTS/play.xml --timeout 900
unity test PROJECT --mode EditMode --filter "MyNamespace.MyTests" --output REPORTS/filter.xml
unity test PROJECT --mode EditMode --rerun-failed --output REPORTS/filter.xml
```

Exit `0` all passed; `8` tests ran and failed (fix the cause, never blindly retry); `6` the run never
produced a verdict (compile error, license, crash); `14` timed out. Keep reports in a folder outside
the repository (`REPORTS` above): `--affected` treats any changed file outside `Assets`,
`Packages`, and `ProjectSettings` as a reason to run everything. `--affected --since REF` needs one
earlier full NUnit run as its inventory. `--report-format junit` makes `--output` a JUnit file for
CI. `unity watch test PROJECT` re-runs affected tests on every change, interactively only.

## Compile check, not a build

To learn whether scripts compile, use `unity recompile --project-path PROJECT --format json` against
the running Editor (exit `0`/`6`/`7`). A build takes minutes to answer the same question.

## Build a player

Building is slow and writes large output: build only when the user asks for a build. Write the
output outside `Assets/` (for example `Builds/`, which belongs in `.gitignore`).

With no Editor open on the project:

```text
unity build PROJECT --list-targets --format json
unity build PROJECT --list-profiles --format json
unity build PROJECT --target StandaloneWindows64 --output-path Builds/Win/Game.exe --format json
unity build PROJECT --profile "Windows Release" --output-path Builds/Win/Game.exe --format json
unity build PROJECT --target StandaloneLinux64 --execute-method Builder.PerformBuild --output-path Builds/Linux
unity build run PROJECT
```

Pick one strategy: a built-in desktop build (`--target` plus the required `--output-path`), a
Unity 6 Build Profile (`--profile`, required for non-desktop and partner platforms;
`--create-profile TARGET` makes one), or your own `--execute-method`. Exit `6` means the build
failed even when Unity's process exited `0`, because the CLI reads Unity's verdict from the log;
the log path is in the result and the log streams to stderr under `--format json`. If it refuses
uncommitted changes, `--allow-dirty-build` skips that guard; ask the user first.
`--timeout N` bounds the build (exit `14`). `unity build run PROJECT` launches the last recorded
build.

When an Editor has the project open, `unity build --target` builds through it (the result says
`viaRunningEditor: true`); set `--timeout`. The Editor's own build command is also available:

```text
unity command build run --project-path PROJECT --format json -- --target StandaloneWindows64 --output-path Builds/Win/Game.exe --dry-run true
unity command build run --project-path PROJECT --format json -- --target StandaloneWindows64 --output-path Builds/Win/Game.exe --confirm true
unity command build status --project-path PROJECT --format json
```

`build run` queues the build and returns; poll `build status` until `status` is `completed`. Its
`--options` and `--scenes` take JSON arrays (`--options '["Development"]'`); supplying `--options`
drops the default `DetailedBuildReport`.

A player that crashes at startup with "The file '…/level0' is corrupted" usually has a `.cs` file
declaring more than one `MonoBehaviour`: give each its own file named after its class.

Per-project build and test defaults can live in a committed `ProjectSettings/UnityCliConfig.json`;
`unity config resolve KEY PROJECT` shows the value that applies.
