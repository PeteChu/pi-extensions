import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ResolvedResource } from "@earendil-works/pi-coding-agent";
import type { UsageStatsRecord } from "../store";
import {
  buildReportDataset,
  buildRuntimeNameMap,
  injectUsageStatsBootstrap,
} from "../utils";

function resource(options: {
  path: string;
  enabled?: boolean;
  source: string;
  scope?: "user" | "project";
  origin: "package" | "top-level";
  baseDir?: string;
}): ResolvedResource {
  return {
    path: options.path,
    enabled: options.enabled ?? true,
    metadata: {
      source: options.source,
      scope: options.scope ?? "user",
      origin: options.origin,
      baseDir: options.baseDir,
    },
  };
}

describe("package-usage utils", () => {
  describe("buildReportDataset", () => {
    it("returns empty dataset for no packages", () => {
      const dataset = buildReportDataset(new Map(), []);
      assert.equal(dataset.resources.length, 0);
      assert.equal(dataset.noLongerInstalledResources.length, 0);
      assert.equal(typeof dataset.privacyNote, "string");
      assert.ok(dataset.privacyNote.length > 0);
      assert.ok(dataset.generatedAt);
    });

    it("includes package extensions as tools in dataset", () => {
      const packages = new Map();
      packages.set("npm:example-pkg", {
        extensions: [
          resource({
            path: "/packages/example/index.ts",
            source: "npm:example-pkg",
            origin: "package",
            baseDir: "/packages/example",
          }),
        ],
        skills: [],
      });
      const dataset = buildReportDataset(packages, []);
      assert.equal(dataset.resources.length, 1);
      assert.equal(dataset.resources[0].packageSource, "npm:example-pkg");
      assert.equal(dataset.resources[0].resourceType, "tool");
      assert.equal(dataset.resources[0].active, true);
      assert.equal(dataset.resources[0].count, 0);
      assert.equal(dataset.resources[0].firstUsed, null);
      assert.equal(dataset.resources[0].lastUsed, null);
    });

    it("includes package skills in dataset", () => {
      const packages = new Map();
      packages.set("npm:skill-pkg", {
        extensions: [],
        skills: [
          resource({
            path: "/packages/skill-pkg/skills/review.md",
            source: "npm:skill-pkg",
            origin: "package",
            baseDir: "/packages/skill-pkg",
          }),
        ],
      });
      const dataset = buildReportDataset(packages, []);
      assert.equal(dataset.resources.length, 1);
      assert.equal(dataset.resources[0].packageSource, "npm:skill-pkg");
      assert.equal(dataset.resources[0].resourceType, "skill");
      assert.equal(dataset.resources[0].active, true);
    });

    it("marks disabled discovered extensions and skills inactive", () => {
      const packages = new Map();
      packages.set("npm:disabled-pkg", {
        extensions: [
          resource({
            path: "/packages/disabled/index.ts",
            source: "npm:disabled-pkg",
            origin: "package",
            enabled: false,
          }),
        ],
        skills: [
          resource({
            path: "/packages/disabled/skill.md",
            source: "npm:disabled-pkg",
            origin: "package",
            enabled: false,
          }),
        ],
      });

      const dataset = buildReportDataset(packages, []);

      assert.equal(dataset.resources.length, 2);
      assert.ok(dataset.resources.every((r) => r.active === false));
    });

    it("includes both tools and skills from same package", () => {
      const packages = new Map();
      packages.set("npm:full-pkg", {
        extensions: [
          resource({
            path: "/packages/full/index.ts",
            source: "npm:full-pkg",
            origin: "package",
          }),
        ],
        skills: [
          resource({
            path: "/packages/full/skills/analyze.md",
            source: "npm:full-pkg",
            origin: "package",
          }),
        ],
      });
      const dataset = buildReportDataset(packages, []);
      assert.equal(dataset.resources.length, 2);
      const types = dataset.resources.map((r) => r.resourceType).sort();
      assert.deepEqual(types, ["skill", "tool"]);
    });

    it("hides package extension files when runtime commands expose the actual resources", () => {
      const packages = new Map();
      packages.set("npm:pi-multi-pass", {
        extensions: [
          resource({
            path: "/packages/pi-multi-pass/extensions/multi-sub.ts",
            source: "npm:pi-multi-pass",
            origin: "package",
          }),
        ],
        skills: [],
      });
      const dataset = buildReportDataset(packages, [], 7, undefined, {
        tools: [],
        commands: [
          {
            name: "subs",
            source: "extension",
            sourceInfo: {
              origin: "package",
              source: "npm:pi-multi-pass",
              path: "/packages/pi-multi-pass/extensions/multi-sub.ts",
            },
          },
        ],
      });

      assert.equal(dataset.resources.length, 1);
      assert.equal(dataset.resources[0].resourceType, "command");
      assert.equal(dataset.resources[0].resourceName, "subs");
      assert.equal(dataset.resources[0].active, true);
    });

    it("lets active runtime resources win over disabled discovered fallback rows", () => {
      const packages = new Map();
      packages.set("npm:runtime-pkg", {
        extensions: [
          resource({
            path: "/packages/runtime/tool.ts",
            source: "npm:runtime-pkg",
            origin: "package",
            enabled: false,
          }),
        ],
        skills: [],
      });

      const dataset = buildReportDataset(
        packages,
        [],
        7,
        new Map([["/packages/runtime/tool.ts", "actual-tool"]]),
        {
          tools: [
            {
              name: "actual-tool",
              path: "/packages/runtime/tool.ts",
              sourceInfo: { origin: "package", source: "npm:runtime-pkg" },
            },
          ],
          commands: [],
        },
      );

      assert.equal(dataset.resources.length, 1);
      assert.equal(dataset.resources[0].resourceName, "actual-tool");
      assert.equal(dataset.resources[0].active, true);
    });

    it("sets all counts to zero when no usage data", () => {
      const packages = new Map();
      packages.set("npm:pkg", {
        extensions: [
          resource({
            path: "/pkg/ext.ts",
            source: "npm:pkg",
            origin: "package",
          }),
        ],
        skills: [
          resource({
            path: "/pkg/skill.md",
            source: "npm:pkg",
            origin: "package",
          }),
        ],
      });
      const dataset = buildReportDataset(packages, []);
      for (const r of dataset.resources) {
        assert.equal(r.count, 0);
        assert.equal(r.firstUsed, null);
        assert.equal(r.lastUsed, null);
      }
    });

    it("uses default stale threshold of 7 days", () => {
      const dataset = buildReportDataset(new Map(), []);
      assert.equal(dataset.staleThresholdDays, 7);
    });

    it("accepts custom stale threshold", () => {
      const dataset = buildReportDataset(new Map(), [], 14);
      assert.equal(dataset.staleThresholdDays, 14);
    });

    it("includes a privacy notice in dataset", () => {
      const dataset = buildReportDataset(new Map(), []);
      assert.equal(typeof dataset.privacyNote, "string");
      assert.ok(dataset.privacyNote.length > 0);
    });

    it("merges stored usage records into installed resources", () => {
      const packages = new Map();
      packages.set("npm:used-pkg", {
        extensions: [
          resource({
            path: "/pkg/ext.ts",
            source: "npm:used-pkg",
            origin: "package",
          }),
        ],
        skills: [],
      });
      const stored: UsageStatsRecord[] = [
        {
          packageSource: "npm:used-pkg",
          resourceType: "tool",
          resourceName: "pkg/ext.ts",
          count: 5,
          firstUsed: "2025-01-01T00:00:00.000Z",
          lastUsed: "2025-06-01T00:00:00.000Z",
        },
      ];
      const dataset = buildReportDataset(packages, stored);
      assert.equal(dataset.resources.length, 1);
      assert.equal(dataset.resources[0].count, 5);
      assert.equal(dataset.resources[0].firstUsed, "2025-01-01T00:00:00.000Z");
      assert.equal(dataset.resources[0].lastUsed, "2025-06-01T00:00:00.000Z");
    });

    it("preserves zero for installed resources not in stored records", () => {
      const packages = new Map();
      packages.set("npm:used-pkg", {
        extensions: [
          resource({
            path: "/pkg/ext.ts",
            source: "npm:used-pkg",
            origin: "package",
          }),
        ],
        skills: [],
      });
      packages.set("npm:empty-pkg", {
        extensions: [
          resource({
            path: "/pkg/other.ts",
            source: "npm:empty-pkg",
            origin: "package",
          }),
        ],
        skills: [],
      });
      const stored: UsageStatsRecord[] = [
        {
          packageSource: "npm:used-pkg",
          resourceType: "tool",
          resourceName: "pkg/ext.ts",
          count: 3,
          firstUsed: "2025-01-01T00:00:00.000Z",
          lastUsed: "2025-06-01T00:00:00.000Z",
        },
      ];
      const dataset = buildReportDataset(packages, stored);
      assert.equal(dataset.resources.length, 2);
      const empty = dataset.resources.find(
        (r) => r.packageSource === "npm:empty-pkg",
      )!;
      assert.equal(empty.count, 0);
      assert.equal(empty.firstUsed, null);
      assert.equal(empty.lastUsed, null);
    });

    it("separates no-longer-installed resources from current packages", () => {
      const packages = new Map();
      packages.set("npm:current-pkg", {
        extensions: [
          resource({
            path: "/pkg/active.ts",
            source: "npm:current-pkg",
            origin: "package",
          }),
        ],
        skills: [],
      });
      const stored: UsageStatsRecord[] = [
        {
          packageSource: "npm:current-pkg",
          resourceType: "tool",
          resourceName: "pkg/active.ts",
          count: 2,
          firstUsed: "2025-03-01T00:00:00.000Z",
          lastUsed: "2025-05-01T00:00:00.000Z",
        },
        {
          packageSource: "npm:removed-pkg",
          resourceType: "skill",
          resourceName: "old-skill",
          count: 10,
          firstUsed: "2024-01-01T00:00:00.000Z",
          lastUsed: "2024-06-01T00:00:00.000Z",
        },
      ];
      const dataset = buildReportDataset(packages, stored);
      assert.equal(dataset.resources.length, 1);
      assert.equal(dataset.resources[0].packageSource, "npm:current-pkg");
      assert.equal(dataset.resources[0].count, 2);
      assert.equal(dataset.resources[0].active, true);
      assert.equal(dataset.noLongerInstalledResources.length, 1);
      assert.equal(
        dataset.noLongerInstalledResources[0].packageSource,
        "npm:removed-pkg",
      );
      assert.equal(dataset.noLongerInstalledResources[0].count, 10);
      assert.equal(dataset.noLongerInstalledResources[0].active, false);
    });

    it("keeps stored resources for still-installed packages when names do not match discovered files", () => {
      const packages = new Map();
      packages.set("npm:active-pkg", {
        extensions: [
          resource({
            path: "/pkg/index.ts",
            source: "npm:active-pkg",
            origin: "package",
          }),
        ],
        skills: [],
      });
      const stored: UsageStatsRecord[] = [
        {
          packageSource: "npm:active-pkg",
          resourceType: "tool",
          resourceName: "runtime-tool-name",
          count: 4,
          firstUsed: "2025-05-01T00:00:00.000Z",
          lastUsed: "2025-05-02T00:00:00.000Z",
        },
      ];
      const dataset = buildReportDataset(packages, stored);
      assert.equal(dataset.noLongerInstalledResources.length, 0);
      const unmatched = dataset.resources.find(
        (r) => r.resourceName === "runtime-tool-name",
      );
      assert.ok(unmatched);
      assert.equal(unmatched.count, 4);
      assert.equal(unmatched.active, false);
    });

    it("no-longer-installed resources are excluded from current resources", () => {
      const packages = new Map();
      packages.set("npm:active-pkg", {
        extensions: [
          resource({
            path: "/pkg/tool.ts",
            source: "npm:active-pkg",
            origin: "package",
          }),
        ],
        skills: [],
      });
      const stored: UsageStatsRecord[] = [
        {
          packageSource: "npm:active-pkg",
          resourceType: "tool",
          resourceName: "pkg/tool.ts",
          count: 1,
          firstUsed: "2025-05-01T00:00:00.000Z",
          lastUsed: "2025-05-01T00:00:00.000Z",
        },
        {
          packageSource: "npm:ghost-pkg",
          resourceType: "skill",
          resourceName: "ghost",
          count: 3,
          firstUsed: "2024-01-01T00:00:00.000Z",
          lastUsed: "2024-03-01T00:00:00.000Z",
        },
      ];
      const dataset = buildReportDataset(packages, stored);
      assert.equal(dataset.resources.length, 1);
      assert.equal(dataset.resources[0].packageSource, "npm:active-pkg");
      assert.equal(dataset.noLongerInstalledResources.length, 1);
      assert.equal(
        dataset.noLongerInstalledResources[0].packageSource,
        "npm:ghost-pkg",
      );
    });
  });

  describe("buildRuntimeNameMap", () => {
    it("maps tool paths to runtime names", () => {
      const map = buildRuntimeNameMap({
        tools: [
          {
            name: "ai-commit_recommend",
            path: "/packages/ai-commit/pi-tools/recommend.ts",
            sourceInfo: { origin: "package", source: "npm:ai-commit" },
          },
        ],
        commands: [],
      });

      assert.equal(map.size, 1);
      assert.equal(
        map.get("/packages/ai-commit/pi-tools/recommend.ts"),
        "ai-commit_recommend",
      );
    });

    it("maps skill paths to runtime names", () => {
      const map = buildRuntimeNameMap({
        tools: [],
        commands: [
          {
            name: "review",
            source: "skill",
            sourceInfo: {
              origin: "package",
              source: "npm:code-reviewer",
              path: "/packages/code-reviewer/skills/review.md",
            },
          },
        ],
      });

      assert.equal(map.size, 1);
      assert.equal(
        map.get("/packages/code-reviewer/skills/review.md"),
        "review",
      );
    });

    it("maps both tools and skills", () => {
      const map = buildRuntimeNameMap({
        tools: [
          {
            name: "tool-a",
            path: "/pkg/tools/tool-a.ts",
            sourceInfo: { origin: "package", source: "npm:pkg" },
          },
        ],
        commands: [
          {
            name: "skill-b",
            source: "skill",
            sourceInfo: {
              origin: "package",
              source: "npm:pkg",
              path: "/pkg/skills/skill-b.md",
            },
          },
        ],
      });

      assert.equal(map.size, 2);
      assert.equal(map.get("/pkg/tools/tool-a.ts"), "tool-a");
      assert.equal(map.get("/pkg/skills/skill-b.md"), "skill-b");
    });

    it("ignores non-package tools and skills", () => {
      const map = buildRuntimeNameMap({
        tools: [
          {
            name: "builtin-tool",
            path: "/builtin/tool.ts",
            sourceInfo: { origin: "builtin", source: "core" },
          },
        ],
        commands: [
          {
            name: "user-skill",
            source: "skill",
            sourceInfo: {
              origin: "user",
              source: "local",
              path: "/skills/custom.md",
            },
          },
        ],
      });

      assert.equal(map.size, 0);
    });
  });

  describe("buildReportDataset with runtime name map", () => {
    it("uses runtime names from map for stats matching", () => {
      const packages = new Map();
      packages.set("npm:ai-commit", {
        extensions: [
          resource({
            path: "/packages/ai-commit/pi-tools/recommend.ts",
            source: "npm:ai-commit",
            origin: "package",
          }),
        ],
        skills: [],
      });

      const runtimeNameMap = new Map([
        ["/packages/ai-commit/pi-tools/recommend.ts", "ai-commit_recommend"],
      ]);

      const stored: UsageStatsRecord[] = [
        {
          packageSource: "npm:ai-commit",
          resourceType: "tool",
          resourceName: "ai-commit_recommend",
          count: 5,
          firstUsed: "2025-01-01T00:00:00.000Z",
          lastUsed: "2025-06-01T00:00:00.000Z",
        },
      ];

      const dataset = buildReportDataset(packages, stored, 7, runtimeNameMap);

      assert.equal(dataset.resources.length, 1);
      assert.equal(dataset.resources[0].resourceName, "ai-commit_recommend");
      assert.equal(dataset.resources[0].count, 5);
    });

    it("falls back to display name when no runtime name exists", () => {
      const packages = new Map();
      packages.set("npm:example", {
        extensions: [
          resource({
            path: "/packages/example/index.ts",
            source: "npm:example",
            origin: "package",
          }),
        ],
        skills: [],
      });

      const stored: UsageStatsRecord[] = [
        {
          packageSource: "npm:example",
          resourceType: "tool",
          resourceName: "example",
          count: 1,
          firstUsed: "2025-01-01T00:00:00.000Z",
          lastUsed: "2025-06-01T00:00:00.000Z",
        },
      ];

      const dataset = buildReportDataset(packages, stored, 7, undefined);

      assert.equal(dataset.resources.length, 1);
      assert.equal(dataset.resources[0].resourceName, "example");
      assert.equal(dataset.resources[0].count, 1);
    });
  });

  describe("bootstrap JSON serialization", () => {
    const placeholder = "__PI_PACKAGE_USAGE_STATS_JSON__";

    function parseApplicationJsonScript(html: string): unknown {
      const match = html.match(
        /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
      );
      assert.ok(match);
      return JSON.parse(match[1]);
    }

    it("injects generated report data so installed unused resources are visible", () => {
      const dataset = {
        generatedAt: "2026-05-22T00:00:00.000Z",
        privacyNote: "Private",
        resources: [
          {
            packageSource: "npm:installed-pkg",
            resourceType: "tool" as const,
            resourceName: "unused-tool",
            active: true,
            count: 0,
            firstUsed: null,
            lastUsed: null,
          },
          {
            packageSource: "npm:used-pkg",
            resourceType: "skill" as const,
            resourceName: "used-skill",
            active: true,
            count: 3,
            firstUsed: "2026-05-01T00:00:00.000Z",
            lastUsed: "2026-05-21T00:00:00.000Z",
          },
        ],
        noLongerInstalledResources: [],
        staleThresholdDays: 7,
      };
      const html = injectUsageStatsBootstrap(
        `<script type="application/json">${placeholder}</script>`,
        dataset,
      );
      const parsed = parseApplicationJsonScript(html) as {
        resources: Array<{ resourceName: string; count: number }>;
      };
      assert.equal(parsed.resources.length, 2);
      assert.equal(parsed.resources[0].resourceName, "unused-tool");
      assert.equal(parsed.resources[1].count, 3);
    });

    it("escapes generated report data without leaving executable script delimiters", () => {
      const dataset = {
        generatedAt: "2026-05-22T00:00:00.000Z",
        privacyNote: "Private",
        resources: [
          {
            packageSource: "npm:</script><script>alert(1)</script>&",
            resourceType: "tool" as const,
            resourceName: "danger-tool",
            active: true,
            count: 1,
            firstUsed: "2025-01-01T00:00:00.000Z",
            lastUsed: "2025-01-02T00:00:00.000Z",
          },
        ],
        noLongerInstalledResources: [],
        staleThresholdDays: 7,
      };
      const html = injectUsageStatsBootstrap(
        `<script type="application/json">${placeholder}</script>`,
        dataset,
      );

      assert.doesNotMatch(html, /<\/script><script>alert\(1\)/);

      const parsed = parseApplicationJsonScript(html) as {
        resources: Array<{ packageSource: string; resourceName: string }>;
      };
      assert.equal(parsed.resources[0].resourceName, "danger-tool");
      assert.equal(
        parsed.resources[0].packageSource,
        "npm:</script><script>alert(1)</script>&",
      );
    });

    it("inserts bootstrap JSON when the template has no placeholder", () => {
      const dataset = buildReportDataset(new Map(), []);
      const html = injectUsageStatsBootstrap(
        "<html><head></head><body></body></html>",
        dataset,
      );
      const parsed = parseApplicationJsonScript(html) as {
        resources: unknown[];
        noLongerInstalledResources: unknown[];
        staleThresholdDays: number;
      };

      assert.deepEqual(parsed.resources, []);
      assert.deepEqual(parsed.noLongerInstalledResources, []);
      assert.equal(parsed.staleThresholdDays, 7);
    });
  });
});
