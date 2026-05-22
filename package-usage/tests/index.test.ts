import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import packageUsage from "../index";
import { buildReportDataset } from "../utils";

function mockResource(opts: { path: string; source: string }) {
  return {
    path: opts.path,
    enabled: true,
    metadata: {
      source: opts.source,
      scope: "user" as const,
      origin: "package" as const,
      baseDir: "/packages",
    },
  };
}

describe("package-usage extension", () => {
  it("exports an extension factory", () => {
    assert.equal(typeof packageUsage, "function");
  });

  it("registers a command handler", () => {
    const registrations: Array<{ name: string; options: { handler?: unknown } }> = [];

    packageUsage({
      registerCommand(name: string, options: { handler?: unknown }) {
        registrations.push({ name, options });
      },
      getAllTools() {
        return [];
      },
      getCommands() {
        return [];
      },
      on() {},
    } as never);

    assert.equal(registrations.length, 1);
    assert.equal(typeof registrations[0].name, "string");
    assert.equal(typeof registrations[0].options.handler, "function");
  });

  describe("reset command", () => {
    it("report after reset includes installed resources with zero usage", async () => {
      const packages = new Map();
      packages.set("npm:test-pkg", {
        extensions: [
          mockResource({ path: "/packages/test-pkg/index.ts", source: "npm:test-pkg" }),
        ],
        skills: [
          mockResource({ path: "/packages/test-pkg/skill.md", source: "npm:test-pkg" }),
        ],
      });

      const emptySnapshot: never[] = [];
      const dataset = buildReportDataset(packages, emptySnapshot);

      assert.equal(dataset.resources.length, 2);
      for (const r of dataset.resources) {
        assert.equal(r.count, 0);
        assert.equal(r.lastUsed, null);
        assert.equal(r.firstUsed, null);
      }
    });

    it("store snapshot is empty after reset", async () => {
      const { UsageStatsStore } = await import("../store");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-usage-reset-"));
      try {
        const store = new UsageStatsStore(tmpDir);
        await store.load();

        store.recordUsage("npm:test-pkg", "tool", "test-tool");
        assert.equal(store.getSnapshot().length, 1);

        await store.reset();
        assert.equal(store.getSnapshot().length, 0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
