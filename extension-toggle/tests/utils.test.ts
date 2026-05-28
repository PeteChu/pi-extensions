import type { ResolvedResource } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExtensionOptionSearchText,
  buildSourceOptions,
  filterExtensionOptions,
  getPackagePattern,
  getTopLevelPattern,
  isExtensionToggleManager,
  isSourceEnabled,
  toggleAllPackageResources,
  toggleAllTopLevelResources,
  togglePackageSources,
  toggleTopLevelExtensionPaths,
  withoutExistingPattern,
} from "../utils";

describe("extension-toggle utils", () => {
  it("removes existing patterns for the same exact resource", () => {
    assert.deepEqual(
      withoutExistingPattern(
        [
          "extensions/a.ts",
          "!extensions/a.ts",
          "+extensions/a.ts",
          "-extensions/a.ts",
          "extensions/b.ts",
        ],
        "extensions/a.ts",
      ),
      ["extensions/b.ts"],
    );
  });

  it("toggles top-level extension paths with exact overrides", () => {
    assert.deepEqual(
      toggleTopLevelExtensionPaths(
        ["-extensions/old.ts"],
        "extensions/new.ts",
        false,
      ),
      ["-extensions/old.ts", "-extensions/new.ts"],
    );

    assert.deepEqual(
      toggleTopLevelExtensionPaths(
        ["-extensions/new.ts"],
        "extensions/new.ts",
        true,
      ),
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

  it("detects source enabled state", () => {
    const enabledResources = [
      resource({
        path: "/packages/example/ext.ts",
        enabled: true,
        source: "npm:example",
        scope: "user",
        origin: "package",
      }),
      resource({
        path: "/packages/example/skill.md",
        enabled: false,
        source: "npm:example",
        scope: "user",
        origin: "package",
      }),
    ];
    assert.equal(isSourceEnabled(enabledResources), true);

    const disabledResources = [
      resource({
        path: "/packages/example/ext.ts",
        enabled: false,
        source: "npm:example",
        scope: "user",
        origin: "package",
      }),
    ];
    assert.equal(isSourceEnabled(disabledResources), false);

    const emptyResources: ResolvedResource[] = [];
    assert.equal(isSourceEnabled(emptyResources), false);
  });

  it("groups resources by source and builds options", () => {
    const options = buildSourceOptions(
      // extensions
      [
        resource({
          path: "/packages/a/index.ts",
          enabled: true,
          source: "npm:package-a",
          scope: "user",
          origin: "package",
        }),
        resource({
          path: "/packages/b/index.ts",
          enabled: false,
          source: "npm:package-b",
          scope: "user",
          origin: "package",
        }),
      ],
      // skills
      [
        resource({
          path: "/packages/a/skill.md",
          enabled: true,
          source: "npm:package-a",
          scope: "user",
          origin: "package",
        }),
      ],
      // prompts
      [
        resource({
          path: "/packages/a/prompt.md",
          enabled: true,
          source: "npm:package-a",
          scope: "user",
          origin: "package",
        }),
      ],
      // themes
      [
        resource({
          path: "/packages/a/theme.json",
          enabled: true,
          source: "npm:package-a",
          scope: "user",
          origin: "package",
        }),
      ],
    );

    assert.equal(options.length, 2);

    const optionA = options.find((o) => o.sourceKey === "npm:package-a");
    assert.ok(optionA);
    assert.equal(optionA.label, "npm:package-a (global)");
    assert.equal(optionA.origin, "package");
    assert.equal(optionA.scope, "user");
    assert.equal(optionA.resources.length, 4); // ext, skill, prompt, theme

    const optionB = options.find((o) => o.sourceKey === "npm:package-b");
    assert.ok(optionB);
    assert.equal(optionB.resources.length, 1); // just the extension
  });

  it("builds individual top-level resource options", () => {
    const options = buildSourceOptions(
      // extensions
      [
        resource({
          path: "/home/user/.pi/agent/extensions/a.ts",
          enabled: true,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
        resource({
          path: "/work/project/.pi/extensions/b.ts",
          enabled: false,
          source: "auto",
          scope: "project",
          origin: "top-level",
          baseDir: "/work/project/.pi",
        }),
      ],
      // skills
      [
        resource({
          path: "/home/user/.pi/agent/skills/skill.md",
          enabled: true,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
      ],
      // prompts
      [],
      // themes
      [],
    );

    assert.equal(options.length, 3);

    const globalExtOpt = options.find((o) => o.sourceKey === "extensions/a.ts");
    assert.ok(globalExtOpt);
    assert.equal(globalExtOpt.label, "a.ts (global extension)");
    assert.equal(globalExtOpt.origin, "top-level");
    assert.equal(globalExtOpt.scope, "user");
    assert.equal(globalExtOpt.resourceType, "extensions");

    const projectExtOpt = options.find(
      (o) => o.sourceKey === "extensions/b.ts",
    );
    assert.ok(projectExtOpt);
    assert.equal(projectExtOpt.label, "b.ts (project extension)");
    assert.equal(projectExtOpt.resourceType, "extensions");

    const globalSkillOpt = options.find(
      (o) => o.sourceKey === "skills/skill.md",
    );
    assert.ok(globalSkillOpt);
    assert.equal(globalSkillOpt.label, "skill.md (global skill)");
    assert.equal(globalSkillOpt.resourceType, "skills");
  });

  it("shows custom extension directories by name", () => {
    const options = buildSourceOptions(
      [
        resource({
          path: "/home/user/.pi/agent/extensions/ai-commit/index.ts",
          enabled: true,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
        resource({
          path: "/home/user/.pi/agent/extensions/answer/index.ts",
          enabled: true,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
      ],
      [],
      [],
      [],
    );

    assert.deepEqual(
      options.map((option) => option.label),
      ["ai-commit (global extension)", "answer (global extension)"],
    );
    assert.deepEqual(
      options.map((option) => option.sourceKey),
      ["extensions/ai-commit/index.ts", "extensions/answer/index.ts"],
    );
  });

  it("builds searchable text from labels, source keys, resource types, and resource metadata", () => {
    const option = buildSourceOptions(
      [],
      [
        resource({
          path: "/packages/workflow/skills/review-changes.md",
          enabled: true,
          source: "npm:workflow-tools",
          scope: "user",
          origin: "package",
          baseDir: "/packages/workflow",
        }),
      ],
      [],
      [],
    )[0];

    const searchText = buildExtensionOptionSearchText(option);
    assert.match(searchText, /npm:workflow-tools/);
    assert.match(searchText, /review-changes\.md/);
    assert.match(searchText, /skills/);
    assert.match(searchText, /package/);
  });

  it("filters options by package source and nested skill names", () => {
    const options = buildSourceOptions(
      [
        resource({
          path: "/packages/a/extensions/main.ts",
          enabled: true,
          source: "npm:alpha-extension",
          scope: "user",
          origin: "package",
          baseDir: "/packages/a",
        }),
      ],
      [
        resource({
          path: "/packages/reviewer/skills/code-review.md",
          enabled: true,
          source: "npm:reviewer-suite",
          scope: "user",
          origin: "package",
          baseDir: "/packages/reviewer",
        }),
      ],
      [],
      [],
    );

    assert.deepEqual(
      filterExtensionOptions(options, "alpha").map(
        (entry) => entry.option.sourceKey,
      ),
      ["npm:alpha-extension"],
    );
    assert.deepEqual(
      filterExtensionOptions(options, "code review").map(
        (entry) => entry.option.sourceKey,
      ),
      ["npm:reviewer-suite"],
    );
  });

  it("filters options by top-level extension and skill directory names", () => {
    const options = buildSourceOptions(
      [
        resource({
          path: "/home/user/.pi/agent/extensions/ai-commit/index.ts",
          enabled: true,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
      ],
      [
        resource({
          path: "/home/user/.pi/agent/skills/release-notes/skill.md",
          enabled: true,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
      ],
      [],
      [],
    );

    assert.deepEqual(
      filterExtensionOptions(options, "ai commit").map(
        (entry) => entry.option.label,
      ),
      ["ai-commit (global extension)"],
    );
    assert.deepEqual(
      filterExtensionOptions(options, "release notes").map(
        (entry) => entry.option.label,
      ),
      ["release-notes (global skill)"],
    );
    assert.deepEqual(filterExtensionOptions(options, "does-not-exist"), []);
  });

  it("excludes toggle manager from grouped options", () => {
    const options = buildSourceOptions(
      // extensions — includes the toggle manager
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
      // skills — none from the toggle manager
      [],
      // prompts
      [],
      // themes
      [],
    );

    assert.equal(options.length, 1);
    assert.equal(options[0].sourceKey, "npm:other");
  });

  it("disables all resources for a package", () => {
    const result = toggleAllPackageResources(
      [
        {
          source: "npm:example-package",
          extensions: ["+extensions/main.ts"],
          skills: ["+skills/review.md"],
        },
      ],
      "npm:example-package",
      false,
    );

    assert.equal(result.changed, true);
    const pkg = result.packages[0] as {
      source: string;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      themes?: string[];
    };
    assert.deepEqual(pkg.extensions, []);
    assert.deepEqual(pkg.skills, []);
    assert.deepEqual(pkg.prompts, []);
    assert.deepEqual(pkg.themes, []);
  });

  it("enables all resources for a package by clearing filters", () => {
    const result = toggleAllPackageResources(
      [
        {
          source: "npm:example-package",
          extensions: [],
          skills: [],
          prompts: [],
          themes: [],
        },
      ],
      "npm:example-package",
      true,
    );

    assert.equal(result.changed, true);
    const pkg = result.packages[0] as {
      source: string;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      themes?: string[];
    };
    assert.equal(pkg.extensions, undefined);
    assert.equal(pkg.skills, undefined);
    assert.equal(pkg.prompts, undefined);
    assert.equal(pkg.themes, undefined);
  });

  it("converts string package to object when disabling all resources", () => {
    const result = toggleAllPackageResources(
      ["npm:example-package"],
      "npm:example-package",
      false,
    );

    assert.equal(result.changed, true);
    const pkg = result.packages[0] as {
      source: string;
      extensions?: string[];
      skills?: string[];
      prompts?: string[];
      themes?: string[];
    };
    assert.deepEqual(pkg.extensions, []);
    assert.deepEqual(pkg.skills, []);
    assert.deepEqual(pkg.prompts, []);
    assert.deepEqual(pkg.themes, []);
  });

  it("converts object to string when enabling all resources (all filters cleared)", () => {
    const result = toggleAllPackageResources(
      [
        {
          source: "npm:example-package",
          extensions: [],
          skills: [],
          prompts: [],
          themes: [],
        },
      ],
      "npm:example-package",
      true,
    );

    assert.equal(result.changed, true);
    assert.equal(result.packages[0], "npm:example-package");
  });

  it("returns unchanged when package source not found", () => {
    const result = toggleAllPackageResources(
      ["npm:existing"],
      "npm:missing",
      false,
    );

    assert.equal(result.changed, false);
    assert.deepEqual(result.packages, ["npm:existing"]);
  });

  it("toggles all top-level resources", () => {
    // Disable
    assert.deepEqual(toggleAllTopLevelResources(false), ["!*"]);
    // Enable
    assert.deepEqual(toggleAllTopLevelResources(true), []);
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
