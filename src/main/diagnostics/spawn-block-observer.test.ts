import { afterEach, describe, expect, it, vi } from "vitest";
import {
  reportSpawnBlock,
  setSpawnBlockObserver,
  type SpawnBlock,
} from "./spawn-block-observer";

afterEach(() => {
  setSpawnBlockObserver(null);
});

describe("spawn block observer", () => {
  it("forwards each reported block to the installed observer", () => {
    const blocks: SpawnBlock[] = [];
    setSpawnBlockObserver((block) => blocks.push(block));
    reportSpawnBlock({
      command: "wsl.exe",
      args: ["--list"],
      blockMs: 7,
      sync: true,
      timedOut: true,
    });
    expect(blocks).toMatchObject([
      { command: "wsl.exe", args: ["--list"], sync: true, timedOut: true },
    ]);
  });

  it("never lets a throwing observer fail the spawn", () => {
    setSpawnBlockObserver(
      vi.fn(() => {
        throw new Error("observer broke");
      }),
    );
    expect(() =>
      reportSpawnBlock({
        command: "git",
        args: [],
        blockMs: 1,
        sync: false,
        timedOut: false,
      }),
    ).not.toThrow();
  });
});
