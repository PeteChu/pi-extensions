import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { ResolvedResource } from "@earendil-works/pi-coding-agent";
import {
  buildExtensionLabel,
  buildExtensionOptions,
  getPackagePattern,
  getTopLevelPattern,
  isExtensionToggleManager,
  togglePackageSources,
  toggleTopLevelExtensionPaths,
  withoutExistingPattern,
} from "../utils";

describe("extension-toggle utils", () => {
  it("removes existing patterns for the same exact resource", () => {
    assert.deepEqual(
      withoutExistingPattern(
        ["extensions/a.ts", "!extensions/a.ts", "+extensions/a.ts", "-extensions/a.ts", "extensions/b.ts"],
        "extensions/a.ts",
      ),
      ["extensions/b.ts"],
    );
  });

  it("toggles top-level extension paths with exact overrides", () => {
    assert.deepEqual(
      toggleTopLevelExtensionPaths(["-extensions/old.ts"], "extensions/new.ts", false),
      ["-extensions/old.ts", "-extensions/new.ts"],
    );

    assert.deepEqual(
      toggleTopLevelExtensionPaths(["-extensions/new.ts"], "extensions/new.ts", true),
      ["+extensions/new.ts"],
    );
  });

  it("toggles package sources while preserving other resource filters", () => {
    const result = togglePackageSources(
      [
        "npm:other-package",
        {
          source: "npm:example-package",
          extensions: ["-extensions/old.ts"],
          skills: ["skills/review.md"],
        },
      ],
      "npm:example-package",
      "extensions/new.ts",
      false,
    );

    assert.equal(result.changed, true);
    assert.deepEqual(result.packages, [
      "npm:other-package",
      {
        source: "npm:example-package",
        extensions: ["-extensions/old.ts", "-extensions/new.ts"],
        skills: ["skills/review.md"],
      },
    ]);
  });

  it("converts string package entries to filtered object form", () => {
    const result = togglePackageSources(
      ["npm:example-package"],
      "npm:example-package",
      "index.ts",
      false,
    );

    assert.deepEqual(result, {
      changed: true,
      packages: [{ source: "npm:example-package", extensions: ["-index.ts"] }],
    });
  });

  it("returns unchanged packages when source is missing", () => {
    const result = togglePackageSources(
      ["npm:example-package"],
      "npm:missing-package",
      "index.ts",
      false,
    );

    assert.deepEqual(result, {
      changed: false,
      packages: ["npm:example-package"],
    });
  });

  it("builds package and project labels", () => {
    const cwd = "/work/project";
    const agentDir = "/home/user/.pi/agent";
    const packageResource = resource({
      path: "/packages/example/index.ts",
      enabled: true,
      source: "npm:example-package",
      scope: "user",
      origin: "package",
      baseDir: "/packages/example",
    });
    const projectResource = resource({
      path: path.join(cwd, ".pi", "extensions", "local.ts"),
      enabled: false,
      source: "auto",
      scope: "project",
      origin: "top-level",
      baseDir: path.join(cwd, ".pi"),
    });

    assert.equal(
      buildExtensionLabel(packageResource, cwd, agentDir),
      "[x] npm:example-package (global) index.ts",
    );
    assert.equal(
      buildExtensionLabel(projectResource, cwd, agentDir),
      "[ ] Project (.pi/) extensions/local.ts",
    );
  });

  it("builds unique selector labels", () => {
    const cwd = "/work/project";
    const agentDir = "/home/user/.pi/agent";
    const resources = [
      resource({
        path: "/packages/example/index.ts",
        enabled: true,
        source: "npm:example-package",
        scope: "user",
        origin: "package",
        baseDir: "/packages/example",
      }),
      resource({
        path: "/packages/example/index.ts",
        enabled: true,
        source: "npm:example-package",
        scope: "user",
        origin: "package",
        baseDir: "/packages/example",
      }),
    ];

    assert.deepEqual(
      buildExtensionOptions(resources, cwd, agentDir).map((option) => option.label),
      [
        "[x] npm:example-package (global) index.ts",
        "[x] npm:example-package (global) index.ts #2",
      ],
    );
  });

  it("computes package and top-level patterns", () => {
    const cwd = "/work/project";
    const agentDir = "/home/user/.pi/agent";
    assert.equal(
      getPackagePattern(
        resource({
          path: "/packages/example/extensions/main.ts",
          enabled: true,
          source: "npm:example-package",
          scope: "user",
          origin: "package",
          baseDir: "/packages/example",
        }),
      ),
      "extensions/main.ts",
    );
    assert.equal(
      getTopLevelPattern(
        resource({
          path: "/home/user/.pi/agent/extensions/main.ts",
          enabled: true,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: agentDir,
        }),
        cwd,
        agentDir,
      ),
      "extensions/main.ts",
    );
  });

  it("identifies this manager extension", () => {
    assert.equal(
      isExtensionToggleManager(
        resource({
          path: "/packages/pi-extension-toggle/index.ts",
          enabled: true,
          source: "npm:pi-extension-toggle",
          scope: "user",
          origin: "package",
          baseDir: "/packages/pi-extension-toggle",
        }),
      ),
      true,
    );
  });

  it("does not build selector options for this manager extension", () => {
    const options = buildExtensionOptions(
      [
        resource({
          path: "/packages/pi-extension-toggle/index.ts",
          enabled: true,
          source: "npm:pi-extension-toggle",
          scope: "user",
          origin: "package",
          baseDir: "/packages/pi-extension-toggle",
        }),
        resource({
          path: "/packages/other/index.ts",
          enabled: true,
          source: "npm:other",
          scope: "user",
          origin: "package",
          baseDir: "/packages/other",
        }),
      ],
      "/work/project",
      "/home/user/.pi/agent",
    );

    assert.deepEqual(options.map((option) => option.label), [
      "[x] npm:other (global) index.ts",
    ]);
  });
});

function resource(options: {
  path: string;
  enabled: boolean;
  source: string;
  scope: "user" | "project";
  origin: "package" | "top-level";
  baseDir?: string;
}): ResolvedResource {
  return {
    path: options.path,
    enabled: options.enabled,
    metadata: {
      source: options.source,
      scope: options.scope,
      origin: options.origin,
      baseDir: options.baseDir,
    },
  };
}
