# Play-mode verification loop

Entering play mode is setup, not proof. An unfocused Editor, a locked screen, or Run In Background
being off can leave the game stuck at frame 1 while `unity status` still reports it playing, and a
screenshot can show a stale frame or a flat color. This loop proves frames advance before you trust
anything you observe. Unity's full version: `unity skill show --path references/playmode-verification-loop.md`.

Command names and parameters come from the project's `com.unity.pipeline`. Confirm them with
`unity command editor --project-path PROJECT` and `unity command job --project-path PROJECT`
before relying on this page. CLI flags go before `--`, command parameters after it.

## 1. Read the play state; a running session is the user's

```text
unity status --project-path PROJECT --format json
unity command editor status --project-path PROJECT --format json
```

`playMode` is `stopped` when the Editor is not playing. If it is playing or paused, the session is
the user's: you may read it (steps 4 to 6), but do not change step 2's settings, pause, step, or
stop it. Tell the user what you found.

## 2. Keep an unfocused Editor ticking

Unity throttles the Editor loop when its window lacks focus, which is the normal case while an
agent drives it from Orca. Before every play session you start:

```text
unity command editor set_auto_tick --project-path PROJECT
unity command editor.playmode set_run_in_background --project-path PROJECT
```

`set_auto_tick` defaults to `--enabled true --interval-ms 16 --persist true` and survives a domain
reload. `set_run_in_background` overrides the project's Run In Background Player Setting for this
Editor session without saving it into builds. On an older package without
`set_run_in_background`, read `UnityEngine.Application.runInBackground` with `script eval`, set it
to `true`, and restore the original value after stopping.

## 3. Enter play mode, then wait for the server

```text
unity command editor.playmode start --project-path PROJECT
unity status --until-ready --project-path PROJECT --format json
```

Entering play mode reloads the domain and drops the Pipeline server for several seconds. Wait with
`--until-ready`, not a hand-written polling loop.

## 4. Prove frames advance

```text
unity command job wait --project-path PROJECT --format json -- --condition '{"member":"UnityEngine.Time.frameCount","op":"changed"}' --timeout 10
```

`met: true` is the proof. `timedOut: true` with `value` still equal to `initialValue` is the
frozen-at-frame-1 symptom (`framesObserved` counts Editor ticks, so it rises even then): on your session, recheck step 2; on the user's, report it. `job wait`
`--timeout` is seconds (default 30, at most 600). `op` is `equals`, `notEquals`, `greaterThan`,
`lessThan`, `contains`, or `changed`, spelled exactly so. A synchronous wait blocks every other
Editor command; for a long wait add `--async true` and poll
`unity command job wait_status -- --wait-id ID`. `--on-met` can capture the game view in the same
frame the condition first holds.

While playing, a recent package also reports `frameCount` and `playerLoopTicking` on the
`unity status --format json` row; `playerLoopTicking: false` outside a pause means frozen.

Still frozen? On Windows a locked session stops play mode from advancing. If you started the
session and nobody can unlock the machine, step frames yourself, one call per frame:

```text
unity command script eval "UnityEditor.EditorApplication.isPaused = true;" --project-path PROJECT
unity command script eval "UnityEditor.EditorApplication.Step();" --project-path PROJECT
unity command script eval "return UnityEngine.Time.frameCount;" --project-path PROJECT --format json
```

## 5. Capture the game view to a file

```text
unity command capture game_view --project-path PROJECT --format json -- --source screen --output-path Temp/agent-captures/playtest.png
```

With `--output-path` (absolute, or relative to the project root) the result is a path, not a
base64 image, which keeps your context small. Keep captures outside `Assets/` so Unity does not
import them or create `.meta` files. Add `--include-inline-image true --max-resolution 512` only
when you need to look at the image in this turn. Pass `--source` explicitly: `screen` is the Game
window including Screen Space - Overlay UI; `camera` renders one camera and is the choice when the
desktop may be locked, since a locked `screen` capture can come back as a solid color with no
error. Treat a single-color image as suspect until the frame count proves the game is running.

## 6. Read the console before trusting a clean capture

```text
unity command console get --project-path PROJECT --format json -- --tail 50 --level error
```

## 7. Tune the running game with script eval

Evaluate C# against the running game instead of stopping, editing, recompiling, and re-entering:

```text
unity command script eval "UnityEngine.Time.timeScale = 0.5f;" --project-path PROJECT
unity command script eval --project-path PROJECT --format json -- --code "return UnityEngine.Object.FindAnyObjectByType<UnityEngine.Rigidbody>()?.linearVelocity.ToString();" --timeout 15
```

Changes made in play mode are lost when it stops. Make lasting changes in edit mode, through the
Editor commands or the source files.

## 8. Stop and restore

```text
unity command editor.playmode stop --project-path PROJECT
unity command editor.playmode set_run_in_background --project-path PROJECT -- --enabled false
unity command editor set_auto_tick --project-path PROJECT -- --enabled false
```

Stop only a session you started, then undo step 2. Skip the `set_auto_tick` revert while you keep
driving the Editor. Orca's toolbar **Play/Stop** and **Pause** send the same `editor.playmode`
commands, so the user sees the state you leave behind.
