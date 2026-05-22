import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { UsageStatsStore } from "../store";

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "pkg-usage-test-"));
}

async function writeStore(dir: string, data: unknown): Promise<void> {
  const filePath = path.join(dir, "package-usage", "usage-stats-v1.json");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data), "utf-8");
}

function withMockedTimers(apis: Array<"Date" | "setTimeout">, callback: () => void): void {
  mock.timers.enable({ apis });
  try {
    callback();
  } finally {
    mock.timers.reset();
  }
}

describe("UsageStatsStore", () => {
  describe("load", () => {
    it("returns empty data when file does not exist", async () => {
      const dir = tempDir();
      const store = new UsageStatsStore(dir);
      await store.load();
      assert.equal(store.getSnapshot().length, 0);
    });

    it("handles malformed JSON gracefully", async () => {
      const dir = tempDir();
      const filePath = path.join(dir, "package-usage", "usage-stats-v1.json");
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "not valid json", "utf-8");
      const store = new UsageStatsStore(dir);
      await store.load();
      assert.equal(store.getSnapshot().length, 0);
    });

    it("handles unsupported version gracefully", async () => {
      const dir = tempDir();
      await writeStore(dir, { version: 99, resources: [{ packageSource: "npm:x", resourceType: "tool", resourceName: "y", count: 1, firstUsed: "2025-01-01T00:00:00.000Z", lastUsed: "2025-01-01T00:00:00.000Z" }] });
      const store = new UsageStatsStore(dir);
      await store.load();
      assert.equal(store.getSnapshot().length, 0);
    });

    it("loads valid versioned data", async () => {
      const dir = tempDir();
      const record = {
        packageSource: "npm:test-pkg",
        resourceType: "tool",
        resourceName: "test-tool",
        count: 3,
        firstUsed: "2025-01-01T00:00:00.000Z",
        lastUsed: "2025-06-01T00:00:00.000Z",
      };
      await writeStore(dir, { version: 1, resources: [record] });
      const store = new UsageStatsStore(dir);
      await store.load();
      assert.equal(store.getSnapshot().length, 1);
      assert.deepEqual(store.getSnapshot()[0], record);
    });
  });

  describe("recordUsage", () => {
    it("creates a new record with count 1", () => {
      const dir = tempDir();
      const store = new UsageStatsStore(dir);
      store.recordUsage("npm:pkg", "tool", "my-tool");
      const snap = store.getSnapshot();
      assert.equal(snap.length, 1);
      assert.equal(snap[0].packageSource, "npm:pkg");
      assert.equal(snap[0].resourceType, "tool");
      assert.equal(snap[0].resourceName, "my-tool");
      assert.equal(snap[0].count, 1);
      assert.ok(snap[0].firstUsed);
      assert.equal(snap[0].firstUsed, snap[0].lastUsed);
    });

    it("increments count on subsequent usage", () => {
      const store = new UsageStatsStore(tempDir());
      store.recordUsage("npm:pkg", "skill", "my-skill");
      store.recordUsage("npm:pkg", "skill", "my-skill");
      const snap = store.getSnapshot();
      assert.equal(snap.length, 1);
      assert.equal(snap[0].count, 2);
    });

    it("preserves firstUsed on subsequent usage", () => {
      const store = new UsageStatsStore(tempDir());
      store.recordUsage("npm:pkg", "skill", "my-skill");
      const first = store.getSnapshot()[0].firstUsed;
      store.recordUsage("npm:pkg", "skill", "my-skill");
      assert.equal(store.getSnapshot()[0].firstUsed, first);
    });

    it("updates lastUsed on subsequent usage", () => {
      withMockedTimers(["Date"], () => {
        const store = new UsageStatsStore(tempDir());
        store.recordUsage("npm:pkg", "skill", "my-skill");
        const firstLast = store.getSnapshot()[0].lastUsed;
        mock.timers.tick(1000);
        store.recordUsage("npm:pkg", "skill", "my-skill");
        assert.notEqual(store.getSnapshot()[0].lastUsed, firstLast);
      });
    });

    it("tracks different resources independently", () => {
      const store = new UsageStatsStore(tempDir());
      store.recordUsage("npm:pkg", "tool", "tool-a");
      store.recordUsage("npm:pkg", "tool", "tool-b");
      store.recordUsage("npm:pkg", "tool", "tool-a");
      const snap = store.getSnapshot();
      assert.equal(snap.length, 2);
      const a = snap.find((r) => r.resourceName === "tool-a")!;
      const b = snap.find((r) => r.resourceName === "tool-b")!;
      assert.equal(a.count, 2);
      assert.equal(b.count, 1);
    });
  });

  describe("flush and reload", () => {
    it("persists data to disk and reloads it", async () => {
      const dir = tempDir();
      const store = new UsageStatsStore(dir);
      store.recordUsage("npm:pkg", "tool", "my-tool");
      store.recordUsage("npm:pkg", "tool", "my-tool");
      await store.flush();

      const store2 = new UsageStatsStore(dir);
      await store2.load();
      assert.equal(store2.getSnapshot().length, 1);
      assert.equal(store2.getSnapshot()[0].count, 2);
    });
  });

  describe("debounced flushing", () => {
    it("does not write to disk immediately after scheduleFlush", () => {
      withMockedTimers(["setTimeout"], () => {
        const dir = tempDir();
        const store = new UsageStatsStore(dir);
        store.recordUsage("npm:pkg", "tool", "my-tool");
        store.scheduleFlush();

        const filePath = path.join(dir, "package-usage", "usage-stats-v1.json");
        assert.equal(existsSync(filePath), false);
      });
    });

    it("flushes after debounce timer fires", () => {
      withMockedTimers(["setTimeout"], () => {
        const store = new UsageStatsStore(tempDir(), 10);
        const flush = mock.fn(async () => {});
        store.flush = flush;
        store.recordUsage("npm:pkg", "tool", "my-tool");
        store.scheduleFlush();

        assert.equal(flush.mock.calls.length, 0);
        mock.timers.tick(10);
        assert.equal(flush.mock.calls.length, 1);
      });
    });

    it("resets debounce timer on consecutive scheduleFlush calls", () => {
      withMockedTimers(["setTimeout"], () => {
        const store = new UsageStatsStore(tempDir(), 100);
        const flush = mock.fn(async () => {});
        store.flush = flush;
        store.recordUsage("npm:pkg", "tool", "tool-a");
        store.scheduleFlush();
        store.recordUsage("npm:pkg", "tool", "tool-b");
        store.scheduleFlush();

        mock.timers.tick(99);
        assert.equal(flush.mock.calls.length, 0);

        mock.timers.tick(1);
        assert.equal(flush.mock.calls.length, 1);
      });
    });

    it("flushNow writes pending data immediately", async () => {
      const dir = tempDir();
      const store = new UsageStatsStore(dir);
      store.recordUsage("npm:pkg", "tool", "my-tool");
      store.scheduleFlush();

      await store.flushNow();

      const store2 = new UsageStatsStore(dir);
      await store2.load();
      assert.equal(store2.getSnapshot().length, 1);
    });
  });

  describe("reset", () => {
    it("clears in-memory data", async () => {
      const dir = tempDir();
      const store = new UsageStatsStore(dir);
      store.recordUsage("npm:pkg", "tool", "my-tool");
      await store.reset();
      assert.equal(store.getSnapshot().length, 0);
    });

    it("persists cleared state to disk", async () => {
      const dir = tempDir();
      const store = new UsageStatsStore(dir);
      store.recordUsage("npm:pkg", "tool", "my-tool");
      await store.flush();
      await store.reset();

      const store2 = new UsageStatsStore(dir);
      await store2.load();
      assert.equal(store2.getSnapshot().length, 0);
    });
  });
});
