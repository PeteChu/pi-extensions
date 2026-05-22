import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  setupCommandTracking,
  setupToolTracking,
  setupSkillTracking,
} from "../tracker";

type Handler = (event?: unknown) => void;

type TimerApi = "Date" | "setTimeout";

function withMockedTimers(apis: TimerApi[], callback: () => void): void {
  mock.timers.enable({ apis });
  try {
    callback();
  } finally {
    mock.timers.reset();
  }
}

function createHarness(api: Record<string, unknown>) {
  const handlers: Record<string, Handler[]> = {};
  const pi = {
    ...api,
    on(event: string, handler: Handler) {
      handlers[event] ??= [];
      handlers[event].push(handler);
    },
  };

  return {
    pi,
    emit(event: string, payload?: unknown) {
      for (const handler of handlers[event] ?? []) {
        handler(payload);
      }
    },
  };
}

function createRecordingStore() {
  const recorded: Array<[string, string, string]> = [];
  return {
    recorded,
    store: {
      recordUsage(source: string, type: string, name: string) {
        recorded.push([source, type, name]);
      },
      scheduleFlush: mock.fn(() => {}),
    },
  };
}

describe("tool tracking", () => {
  it("records package tool execution and schedules a flush", () => {
    const { recorded, store } = createRecordingStore();
    const harness = createHarness({
      getAllTools() {
        return [{ name: "my-tool", source: "npm:my-pkg", origin: "package" }];
      },
    });

    setupToolTracking(harness.pi as never, store as never);
    harness.emit("session_start", {});
    harness.emit("tool_execution_end", { toolName: "my-tool" });

    assert.deepEqual(recorded, [["npm:my-pkg", "tool", "my-tool"]]);
    assert.equal(store.scheduleFlush.mock.calls.length, 1);
  });

  it("does not record unknown tool execution", () => {
    const { recorded, store } = createRecordingStore();
    const harness = createHarness({
      getAllTools() {
        return [];
      },
    });

    setupToolTracking(harness.pi as never, store as never);
    harness.emit("session_start", {});
    harness.emit("tool_execution_end", { toolName: "unknown-tool" });

    assert.equal(recorded.length, 0);
    assert.equal(store.scheduleFlush.mock.calls.length, 0);
  });

  it("records tool execution regardless of error status", () => {
    const { recorded, store } = createRecordingStore();
    const harness = createHarness({
      getAllTools() {
        return [{ name: "failing-tool", source: "npm:failing-pkg", origin: "package" }];
      },
    });

    setupToolTracking(harness.pi as never, store as never);
    harness.emit("session_start", {});
    harness.emit("tool_execution_end", { toolName: "failing-tool", isError: false });
    harness.emit("tool_execution_end", { toolName: "failing-tool", isError: true });

    assert.equal(recorded.length, 2);
    assert.deepEqual(recorded.map((r) => r[0]), ["npm:failing-pkg", "npm:failing-pkg"]);
  });

  it("rebuilds tool map on session_start", () => {
    const tools: Array<{ name: string; source: string; origin: string; sourceInfo?: { origin: string; source: string } }> = [
      { name: "tool-a", source: "npm:pkg-a", origin: "package", sourceInfo: { origin: "package", source: "npm:pkg-a" } },
    ];
    const { recorded, store } = createRecordingStore();
    const harness = createHarness({
      getAllTools() { return tools; },
    });

    setupToolTracking(harness.pi as never, store as never);
    harness.emit("session_start", {});

    harness.emit("tool_execution_end", { toolName: "tool-a" });
    assert.equal(recorded.length, 1);

    tools.length = 0;
    tools.push(
      { name: "tool-b", source: "npm:pkg-b", origin: "package", sourceInfo: { origin: "package", source: "npm:pkg-b" } },
    );
    harness.emit("session_start", { reason: "reload" });

    harness.emit("tool_execution_end", { toolName: "tool-a" });
    assert.equal(recorded.length, 1);

    harness.emit("tool_execution_end", { toolName: "tool-b" });
    assert.equal(recorded.length, 2);
    assert.equal(recorded[1][0], "npm:pkg-b");
  });
});

describe("lazy refresh for dynamic tools", () => {
  it("defers refresh outside hot path and tracks dynamic tools after refresh", () => {
    withMockedTimers(["setTimeout"], () => {
      const tools: Array<{ name: string; source: string; origin: string; sourceInfo?: { origin: string; source: string } }> = [
        { name: "tool-a", source: "npm:pkg-a", origin: "package", sourceInfo: { origin: "package", source: "npm:pkg-a" } },
      ];
      const { recorded, store } = createRecordingStore();
      const harness = createHarness({
        getAllTools() { return tools; },
      });

      setupToolTracking(harness.pi as never, store as never);

      harness.emit("tool_execution_end", { toolName: "tool-b" });
      assert.equal(recorded.length, 0);

      tools.push({ name: "tool-b", source: "npm:pkg-b", origin: "package", sourceInfo: { origin: "package", source: "npm:pkg-b" } });

      mock.timers.tick(1);

      harness.emit("tool_execution_end", { toolName: "tool-b" });
      assert.deepEqual(recorded, [["npm:pkg-b", "tool", "tool-b"]]);
    });
  });

  it("does not schedule multiple lazy refreshes for consecutive unknown tools", () => {
    withMockedTimers(["setTimeout"], () => {
      const tools: Array<{ name: string; source: string; origin: string; sourceInfo?: { origin: string; source: string } }> = [];
      const { recorded, store } = createRecordingStore();
      let getToolsCallCount = 0;
      const harness = createHarness({
        getAllTools() {
          getToolsCallCount++;
          return tools;
        },
      });

      setupToolTracking(harness.pi as never, store as never);
      const refreshCallCountBefore = getToolsCallCount;

      harness.emit("tool_execution_end", { toolName: "unknown-1" });
      harness.emit("tool_execution_end", { toolName: "unknown-2" });
      harness.emit("tool_execution_end", { toolName: "unknown-3" });

      assert.equal(recorded.length, 0);

      mock.timers.tick(1);

      assert.equal(getToolsCallCount, refreshCallCountBefore + 1);
    });
  });

  it("allows another lazy refresh after first one completes", () => {
    withMockedTimers(["setTimeout"], () => {
      const tools: Array<{ name: string; source: string; origin: string; sourceInfo?: { origin: string; source: string } }> = [];
      const { store } = createRecordingStore();
      let getToolsCallCount = 0;
      const harness = createHarness({
        getAllTools() {
          getToolsCallCount++;
          return tools;
        },
      });

      setupToolTracking(harness.pi as never, store as never);
      const refreshCallCountBefore = getToolsCallCount;

      harness.emit("tool_execution_end", { toolName: "unknown-1" });
      mock.timers.tick(1);
      assert.equal(getToolsCallCount, refreshCallCountBefore + 1);

      harness.emit("tool_execution_end", { toolName: "unknown-2" });
      mock.timers.tick(1);
      assert.equal(getToolsCallCount, refreshCallCountBefore + 2);
    });
  });
});

describe("skill tracking", () => {
  it("rebuilds skill maps on session_start", () => {
    const commands: Array<{ name: string; source: string; sourceInfo: { origin: string; source: string; path: string } }> = [
      { name: "review", source: "skill", sourceInfo: { origin: "package", source: "npm:pkg-a", path: "/skills/review.md" } },
    ];
    const { recorded, store } = createRecordingStore();
    const harness = createHarness({
      getCommands() { return commands; },
    });

    setupSkillTracking(harness.pi as never, store as never);
    harness.emit("session_start", {});

    harness.emit("input", { text: "review my code" });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0][0], "npm:pkg-a");

    commands.length = 0;
    commands.push(
      { name: "analyze", source: "skill", sourceInfo: { origin: "package", source: "npm:pkg-b", path: "/skills/analyze.md" } },
    );
    harness.emit("session_start", { reason: "resume" });

    harness.emit("input", { text: "review stuff" });
    assert.equal(recorded.length, 1);

    harness.emit("input", { text: "analyze this" });
    assert.equal(recorded.length, 2);
    assert.equal(recorded[1][0], "npm:pkg-b");
  });

  it("records usage on explicit skill command input", () => {
    const { recorded, store } = createRecordingStore();
    const harness = createHarness({
      getCommands() {
        return [
          { name: "review", source: "skill", sourceInfo: { origin: "package", source: "npm:review-pkg", path: "/skills/review.md" } },
        ];
      },
    });

    setupSkillTracking(harness.pi as never, store as never);
    harness.emit("session_start", {});
    harness.emit("input", { text: "review my code" });

    assert.deepEqual(recorded, [["npm:review-pkg", "skill", "review"]]);
    assert.equal(store.scheduleFlush.mock.calls.length, 1);
  });

  it("does not record for unknown skill input", () => {
    const { recorded, store } = createRecordingStore();
    const harness = createHarness({ getCommands() { return []; } });

    setupSkillTracking(harness.pi as never, store as never);
    harness.emit("session_start", {});
    harness.emit("input", { text: "nonexistent command" });

    assert.equal(recorded.length, 0);
  });

  it("deduplicates same skill within the deduplication window", () => {
    withMockedTimers(["Date"], () => {
      const { recorded, store } = createRecordingStore();
      const harness = createHarness({
        getCommands() {
          return [
            { name: "review", source: "skill", sourceInfo: { origin: "package", source: "npm:pkg", path: "/skills/review.md" } },
          ];
        },
      });

      setupSkillTracking(harness.pi as never, store as never);
      harness.emit("session_start", {});

      harness.emit("input", { text: "review first" });
      mock.timers.tick(5_000);
      harness.emit("input", { text: "review second" });
      assert.equal(recorded.length, 1);

      mock.timers.tick(7_000);
      harness.emit("input", { text: "review third" });
      assert.equal(recorded.length, 2);
    });
  });

  it("different skills do not suppress each other", () => {
    withMockedTimers(["Date"], () => {
      const { recorded, store } = createRecordingStore();
      const harness = createHarness({
        getCommands() {
          return [
            { name: "review", source: "skill", sourceInfo: { origin: "package", source: "npm:pkg", path: "/skills/review.md" } },
            { name: "analyze", source: "skill", sourceInfo: { origin: "package", source: "npm:pkg", path: "/skills/analyze.md" } },
          ];
        },
      });

      setupSkillTracking(harness.pi as never, store as never);
      harness.emit("session_start", {});
      harness.emit("input", { text: "review" });
      harness.emit("input", { text: "analyze" });

      assert.equal(recorded.length, 2);
    });
  });

  it("records usage on skill file read", () => {
    const { recorded, store } = createRecordingStore();
    const harness = createHarness({
      getCommands() {
        return [
          { name: "review", source: "skill", sourceInfo: { origin: "package", source: "npm:review-pkg", path: "/skills/review.md" } },
        ];
      },
    });

    setupSkillTracking(harness.pi as never, store as never);
    harness.emit("session_start", {});
    harness.emit("tool_result", { toolName: "read", input: { path: "/skills/review.md" } });

    assert.deepEqual(recorded, [["npm:review-pkg", "skill", "review"]]);
  });
});

describe("command tracking", () => {
  it("records package extension and prompt slash commands from input events", () => {
    const commands = [
      {
        name: "simplify",
        source: "extension",
        sourceInfo: { origin: "package", source: "npm:pi-simplify", path: "/pkg/index.js" },
      },
      {
        name: "release-notes",
        source: "prompt",
        sourceInfo: { origin: "package", source: "npm:prompts", path: "/pkg/release.md" },
      },
    ];
    const { recorded, store } = createRecordingStore();
    const harness = createHarness({
      getCommands() { return commands; },
    });

    setupCommandTracking(harness.pi as never, store as never);
    harness.emit("session_start", {});

    harness.emit("input", { text: "/simplify --staged", source: "interactive" });
    harness.emit("input", { text: "/simplify", source: "extension" });
    harness.emit("input", { text: "/release-notes", source: "interactive" });

    assert.deepEqual(recorded, [
      ["npm:pi-simplify", "command", "simplify"],
      ["npm:pi-simplify", "command", "simplify"],
      ["npm:prompts", "command", "release-notes"],
    ]);

    harness.emit("session_shutdown", {});
  });

  it("ignores skill and non-package slash commands from input events", () => {
    const commands = [
      {
        name: "review",
        source: "skill",
        sourceInfo: { origin: "package", source: "npm:skills", path: "/pkg/review.md" },
      },
      {
        name: "local",
        source: "extension",
        sourceInfo: { origin: "top-level", source: "local", path: "/ext.ts" },
      },
    ];
    const { recorded, store } = createRecordingStore();
    const harness = createHarness({
      getCommands() { return commands; },
    });

    setupCommandTracking(harness.pi as never, store as never);
    harness.emit("session_start", {});

    harness.emit("input", { text: "/review", source: "interactive" });
    harness.emit("input", { text: "/local", source: "interactive" });

    assert.equal(recorded.length, 0);

    harness.emit("session_shutdown", {});
  });
});
