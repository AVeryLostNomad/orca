# Editor automation: new scripts, custom commands, batches

Unity's full reference: `unity skill show --path references/integration-advanced.md` (sections
"Authoring custom `[CliCommand]` tools" and "job"). The project's `com.unity.pipeline` ships a
deeper `unity-pipeline` agent skill inside `Library/PackageCache`; `unity skill install CLIENT
--local` mirrors it into the project, but ask before installing anything into an agent client.

## Create a script and attach it

A new type does not exist until a compile finishes:

```text
unity command script create --project-path PROJECT --format json -- --name PlayerController --path Scripts/Player
unity recompile --project-path PROJECT --format json
unity command script attach --project-path PROJECT --format json -- --target /Player --type PlayerController
unity command scene save --project-path PROJECT
```

Writing the `.cs` file with your own file tools works the same way: write it, run
`unity recompile`, then `script attach` (by `--type`, or `--script Assets/Scripts/Player/PlayerController.cs`).
The class name must match the file name. `script create` refuses an existing file unless
`--overwrite true`.

## Write a custom Editor command

A `static` method tagged `[CliCommand]` becomes `unity command NAME` (warm Editor) and
`unity run PROJECT --command NAME -- ARGS` (one-shot batch Editor), discoverable through
`unity command`, with no CLI release. Put it in an Editor assembly (an `Editor/` folder, or an
asmdef that references `Unity.Pipeline`).

```csharp
using Unity.Pipeline.Commands;   // assembly Unity.Pipeline, from com.unity.pipeline
using UnityEngine;

public static class LevelCommands
{
    // unity command level spawn_light --project-path PROJECT -- --name Sun
    [CliCommand("level", "spawn_light", "Create a GameObject with a Light component")]
    public static string SpawnLight([CliArg("name", "GameObject name")] string name = "Light")
    {
        return new GameObject(name, typeof(Light)).name;
    }
}
```

- `[CliCommand(name, description)]` puts the command in the `global` group, run by its name alone;
  `[CliCommand(group, name, description)]` runs as `unity command GROUP NAME`.
- `MainThreadRequired` (default `true`) and `Tags` are named properties on `[CliCommand]`. Keep
  the main thread for anything touching scenes, assets, or serialized objects.
- `[CliArg(name, description, Required = true)]` declares parameters; the CLI validates and
  documents them from this schema.
- After adding or changing one, run `unity recompile`, then confirm it with
  `unity command GROUP --project-path PROJECT`.

## Batch edits as one Undo step

`job batch` runs up to 200 commands in one request. With `--transactional true` (the default) they
form one Undo step and every applied operation is reverted if one fails. A later operation can use
an earlier result as `$INDEX.jsonPath` (for example `$0.instanceId`). Commands that write files,
assets, or settings outside the Undo system are rejected unless `--transactional false`. Validate
first with `--dry-run true`, and read the exact `--operations` shape from
`unity command job --project-path PROJECT`.

## Long-running commands

`unity command GROUP NAME --detach` returns a job id instead of blocking; follow it with
`unity job status JOB_ID`, `unity job wait JOB_ID --timeout 900`, or `unity job cancel JOB_ID`.
Those `unity job` commands are the CLI's; the Pipeline's `unity command job wait` is a server-side
condition wait (see the play-mode reference).

## Menu items and search

`unity command editor invoke_menu --project-path PROJECT -- --path "Assets/Reimport All"` runs a
menu item; with no `--path` it lists them. Menu items can open dialogs or do heavy work: prefer a
dedicated command, and ask before anything sweeping such as a full reimport.
`unity command editor search --project-path PROJECT --format json -- --query "t:Material"` runs a
Unity Search query.
