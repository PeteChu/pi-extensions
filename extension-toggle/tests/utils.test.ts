import {
  DefaultPackageManager,
  SettingsManager,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  readCollections,
  restoreCollection,
  saveCollection,
  type ResourceSnapshot,
} from "../collections";
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

describe("extension-toggle collections", () => {
  it("round-trips only resource settings, preserving empty, partial and absent filters", async (t) => {
    const { agentDir } = await collectionFixture(t);
    assert.deepEqual(Object.entries(await readCollections(agentDir)), []);
    const snapshot: ResourceSnapshot = {
      packages: [
        "npm:unfiltered@1",
        { source: "npm:partial@2", extensions: [], skills: ["skills/review.md"], themes: [] },
      ],
      extensions: [],
      prompts: ["+prompts/review.md", "-prompts/other.md"],
    };
    const settings = {
      ...snapshot,
      defaultModel: "not-a-resource",
      theme: "dark",
      compaction: { enabled: false },
    };
    await saveCollection(agentDir, "Review_1", settings);
    await saveCollection(agentDir, "a".repeat(64), {});
    assert.deepEqual(await readCollections(agentDir), {
      Review_1: snapshot,
      ["a".repeat(64)]: {},
    });
    assert.deepEqual(JSON.parse(await readFile(collectionPath(agentDir), "utf8")), {
      Review_1: snapshot,
      ["a".repeat(64)]: {},
    });
  });

  it("refuses duplicates and invalid names without changing stored bytes", async (t) => {
    const { agentDir } = await collectionFixture(t);
    await saveCollection(agentDir, "baseline", { extensions: [] });
    const before = await readFile(collectionPath(agentDir));
    for (const name of [
      "baseline", "", "../escape", "-leading", "_leading", "two words",
      "a/b", "a.b", "a".repeat(65),
    ]) {
      await assert.rejects(saveCollection(agentDir, name, { skills: [] }));
      assert.deepEqual(await readFile(collectionPath(agentDir)), before, name);
    }
  });

  it("fails closed on malformed stores and invalid snapshots without replacing them", async (t) => {
    const { agentDir } = await collectionFixture(t);
    const malformed = [
      "{", "null", "[]", '{"bad name":{}}',
      '{"valid":null}', '{"valid":[]}', '{"valid":{"defaultModel":"x"}}',
      '{"valid":{"extensions":"x"}}', '{"valid":{"skills":[1]}}',
      '{"valid":{"packages":[null]}}', '{"valid":{"packages":[""]}}',
      '{"valid":{"packages":[{"source":"   "}]}}',
      '{"valid":{"packages":[{"source":"npm:foo","unknown":[]}]}}',
      '{"valid":{"packages":[{"source":"npm:foo","themes":[false]}]}}',
    ];
    for (const contents of malformed) {
      await writeFile(collectionPath(agentDir), contents);
      await assert.rejects(readCollections(agentDir), contents);
      await assert.rejects(saveCollection(agentDir, "new", {}), contents);
      assert.equal(await readFile(collectionPath(agentDir), "utf8"), contents);
    }
    await writeFile(collectionPath(agentDir), '{"baseline":{}}');
    const before = await readFile(collectionPath(agentDir));
    await assert.rejects(saveCollection(agentDir, "invalid", {
      packages: [{ source: "", skills: [] }],
    }));
    assert.deepEqual(await readFile(collectionPath(agentDir)), before);
  });

  it("surfaces storage read and write failures instead of treating them as an empty store", async (t) => {
    const { agentDir } = await collectionFixture(t);
    await mkdir(collectionPath(agentDir));
    await writeFile(join(collectionPath(agentDir), "marker"), "untouched");
    await assert.rejects(readCollections(agentDir));
    await assert.rejects(saveCollection(agentDir, "baseline", {}));
    assert.equal(await readFile(join(collectionPath(agentDir), "marker"), "utf8"), "untouched");

    const blockedAgentDir = join(agentDir, "not-a-directory");
    await writeFile(blockedAgentDir, "untouched");
    await assert.rejects(saveCollection(blockedAgentDir, "baseline", {}));
    assert.equal(await readFile(blockedAgentDir, "utf8"), "untouched");
  });

  it("restores A to B to A exactly while preserving unrelated globals and project settings", async (t) => {
    const a: ResourceSnapshot = {
      packages: [
        "npm:first@1",
        { source: "npm:second@2", skills: [], prompts: ["prompts/a.md"] },
      ],
      extensions: [],
      skills: ["+skills/a.md"],
    };
    const b: ResourceSnapshot = {
      packages: [
        { source: "npm:first@1", extensions: [] },
        { source: "npm:second@2", themes: [] },
      ],
      prompts: [],
      themes: ["themes/b.json"],
    };
    const unrelated = { defaultModel: "keep", compaction: { enabled: false }, theme: "dark" };
    const project = {
      packages: ["npm:project-only"],
      extensions: ["project.ts"],
      skills: [],
      prompts: ["project.md"],
      themes: [],
      defaultModel: "project-model",
    };
    const fixture = await collectionFixture(t, { ...a, ...unrelated }, project);
    await saveCollection(fixture.agentDir, "A", fixture.manager.getGlobalSettings());
    await saveCollection(fixture.agentDir, "B", b);
    const collections = await readCollections(fixture.agentDir);
    const projectBytes = await readFile(fixture.projectPath);
    for (const snapshot of [collections.B, collections.A]) {
      await restoreCollection(fixture.manager, snapshot, fixture);
      assert.deepEqual(JSON.parse(await readFile(fixture.globalPath, "utf8")), {
        ...unrelated,
        ...snapshot,
      });
      const reloaded = SettingsManager.create(fixture.cwd, fixture.agentDir);
      assert.deepEqual(reloaded.getGlobalSettings(), { ...unrelated, ...snapshot });
      assert.deepEqual(reloaded.getProjectSettings(), project);
      assert.deepEqual(await readFile(fixture.projectPath), projectBytes);
    }
  });

  it("restores absent package declarations distinctly from an empty package array", async (t) => {
    const fixture = await collectionFixture(t, { packages: [], extensions: [], defaultModel: "keep" });
    await restoreCollection(fixture.manager, {}, fixture);
    assert.deepEqual(JSON.parse(await readFile(fixture.globalPath, "utf8")), { defaultModel: "keep" });
    await restoreCollection(fixture.manager, { packages: [], themes: [] }, fixture);
    assert.deepEqual(JSON.parse(await readFile(fixture.globalPath, "utf8")), {
      defaultModel: "keep", packages: [], themes: [],
    });
  });

  it("rejects package addition, removal, version changes and reordering before any settings writes", async (t) => {
    const fixture = await collectionFixture(t, {
      packages: ["npm:a@1", { source: "npm:b@2", skills: [] }],
      extensions: ["current.ts"],
    }, { prompts: ["project.md"] });
    const globalBefore = await readFile(fixture.globalPath);
    const projectBefore = await readFile(fixture.projectPath);
    for (const packages of [
      ["npm:a@1", "npm:b@2", "npm:c@3"],
      ["npm:a@1"],
      ["npm:a@2", "npm:b@2"],
      ["npm:b@2", "npm:a@1"],
    ]) {
      await assert.rejects(restoreCollection(fixture.manager, {
        packages, extensions: [], skills: [], prompts: [], themes: [],
      }, fixture));
      assert.deepEqual(await readFile(fixture.globalPath), globalBefore);
      assert.deepEqual(await readFile(fixture.projectPath), projectBefore);
      assert.deepEqual(fixture.manager.getGlobalSettings(), {
        packages: ["npm:a@1", { source: "npm:b@2", skills: [] }],
        extensions: ["current.ts"],
      });
    }
  });

  it("surfaces settings read and queued write failures", async (t) => {
    const fixture = await collectionFixture(t, { extensions: ["current.ts"] });
    await writeFile(fixture.globalPath, "{broken");
    const brokenManager = SettingsManager.create(fixture.cwd, fixture.agentDir);
    await assert.rejects(restoreCollection(brokenManager, { extensions: [] }, fixture));
    assert.equal(await readFile(fixture.globalPath, "utf8"), "{broken");

    await writeFile(fixture.globalPath, '{"extensions":["current.ts"]}');
    const writeManager = SettingsManager.create(fixture.cwd, fixture.agentDir);
    await rm(fixture.globalPath);
    await mkdir(fixture.globalPath);
    await writeFile(join(fixture.globalPath, "marker"), "untouched");
    await assert.rejects(restoreCollection(writeManager, { extensions: [] }, fixture));
    assert.equal(await readFile(join(fixture.globalPath, "marker"), "utf8"), "untouched");
  });

  it("repairs equivalent local manager exclusions without changing discovery or sibling filters", async (t) => {
    const fixture = await collectionFixture(t);
    const extensionsDir = join(fixture.agentDir, "extensions");
    await mkdir(extensionsDir);
    await symlink(fileURLToPath(new URL("..", import.meta.url)), join(extensionsDir, "extension-toggle"), "dir");
    const siblingPath = join(extensionsDir, "sibling.ts");
    await writeFile(siblingPath, "export default function () {}");
    const managerPath = join(extensionsDir, "extension-toggle", "index.ts");
    const managerRelative = relative(fixture.agentDir, managerPath).split(sep).join("/");
    const retained = ["!*", `!${managerRelative}`, "-extensions/sibling.ts", "-unrelated.ts", `-././${managerRelative}`];
    const snapshot: ResourceSnapshot = {
      extensions: [
        ...retained,
        `-${managerRelative}`, `-${managerPath}`, `-./${managerRelative}`, `-.\\${managerRelative}`,
        `+${managerRelative}`, `+./${managerRelative}`, `+${managerPath}`,
      ],
      skills: [], prompts: [], themes: [],
    };
    const original = structuredClone(snapshot);
    await restoreCollection(fixture.manager, snapshot, fixture);
    const restored = JSON.parse(await readFile(fixture.globalPath, "utf8"));
    assert.deepEqual(restored.skills, []);
    assert.deepEqual(restored.prompts, []);
    assert.deepEqual(restored.themes, []);
    const resolved = await new DefaultPackageManager({
      cwd: fixture.cwd,
      agentDir: fixture.agentDir,
      settingsManager: SettingsManager.create(fixture.cwd, fixture.agentDir),
    }).resolve();
    const managerResource = resolved.extensions.find(isExtensionToggleManager);
    assert.ok(managerResource);
    assert.equal(managerResource.enabled, true);
    assert.equal(resolved.extensions.find((entry) => entry.path === siblingPath)?.enabled, false);
    assert.deepEqual(restored.extensions, [...retained, `+${managerPath.split(sep).join("/")}`]);
    assert.deepEqual(snapshot, original);
    const firstRestore = await readFile(fixture.globalPath, "utf8");
    await restoreCollection(fixture.manager, snapshot, fixture);
    assert.equal(await readFile(fixture.globalPath, "utf8"), firstRestore);
  });

  it("preserves external manager file discovery whether missing or retained while disabled", async (t) => {
    for (const retainDiscovery of [false, true]) {
      const fixture = await collectionFixture(t);
      const externalDir = join(fixture.cwd, "external");
      await mkdir(externalDir);
      const managerPath = join(externalDir, "index.ts");
      await symlink(fileURLToPath(new URL("../index.ts", import.meta.url)), managerPath);
      const externalSiblingPath = join(externalDir, "sibling.ts");
      await writeFile(externalSiblingPath, "export default function () {}");
      await mkdir(join(fixture.agentDir, "extensions"));
      const siblingPath = join(fixture.agentDir, "extensions", "sibling.ts");
      await writeFile(siblingPath, "export default function () {}");
      fixture.manager.setExtensionPaths([managerPath]);
      await fixture.manager.flush();
      const managerRelative = relative(fixture.agentDir, managerPath).split(sep).join("/");
      const snapshot: ResourceSnapshot = {
        extensions: [
          ...(retainDiscovery ? [managerPath] : []),
          "!*", `-${managerRelative}`, `-./${managerRelative}`, `-.\\${managerRelative}`, `-${managerPath}`,
        ],
      };
      const original = structuredClone(snapshot);
      await restoreCollection(fixture.manager, snapshot, fixture);
      const restored = SettingsManager.create(fixture.cwd, fixture.agentDir);
      const resolved = await new DefaultPackageManager({
        cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: restored,
      }).resolve();
      assert.equal(resolved.extensions.find((entry) => entry.path === managerPath)?.enabled, true);
      assert.equal(resolved.extensions.find((entry) => entry.path === siblingPath)?.enabled, false);
      assert.equal(resolved.extensions.some((entry) => entry.path === externalSiblingPath), false);
      assert.deepEqual(restored.getGlobalSettings().extensions, [
        ...(retainDiscovery ? [managerPath, "!*"] : ["!*", managerPath]),
        `+${managerPath.split(sep).join("/")}`,
      ]);
      assert.deepEqual(snapshot, original);
      const firstRestore = await readFile(fixture.globalPath, "utf8");
      await restoreCollection(fixture.manager, snapshot, fixture);
      assert.equal(await readFile(fixture.globalPath, "utf8"), firstRestore);
    }
  });

  it("leaves a project-only manager outside global restoration", async (t) => {
    const fixture = await collectionFixture(t, { extensions: ["!*"] });
    const extensionsDir = join(fixture.cwd, ".pi", "extensions");
    await mkdir(extensionsDir);
    await symlink(fileURLToPath(new URL("..", import.meta.url)), join(extensionsDir, "extension-toggle"), "dir");
    const projectBefore = await readFile(fixture.projectPath, "utf8");
    await restoreCollection(fixture.manager, {}, fixture);
    assert.deepEqual(SettingsManager.create(fixture.cwd, fixture.agentDir).getGlobalSettings(), {});
    assert.equal(await readFile(fixture.projectPath, "utf8"), projectBefore);
    const resolved = await new DefaultPackageManager({
      cwd: fixture.cwd, agentDir: fixture.agentDir, settingsManager: fixture.manager,
    }).resolve();
    const managerResource = resolved.extensions.find(isExtensionToggleManager);
    assert.equal(managerResource?.metadata.scope, "project");
    assert.equal(managerResource?.enabled, true);
  });

  it("protects the manager without enabling sibling extensions in the same package", async (t) => {
    const fixture = await collectionFixture(t);
    const packageDir = join(fixture.agentDir, "extension-toggle");
    await mkdir(packageDir);
    await writeFile(join(packageDir, "package.json"), JSON.stringify({
      pi: { extensions: ["index.ts", "sibling.ts"] },
    }));
    await symlink(fileURLToPath(new URL("../index.ts", import.meta.url)), join(packageDir, "index.ts"));
    const siblingPath = join(packageDir, "sibling.ts");
    await writeFile(siblingPath, "export default function () {}");
    const managerPath = join(packageDir, "index.ts");
    const retained = ["index.ts", "!*", "!index.ts", "-sibling.ts", "+missing.ts", "-././index.ts"];
    for (const extensions of [
      [],
      [
        ...retained,
        "-index.ts", "-./index.ts", "-.\\index.ts", `-${managerPath}`,
        "+./index.ts", `+${managerPath}`, "+index.ts",
      ],
    ]) {
      const snapshot: ResourceSnapshot = {
        packages: [{ source: packageDir, extensions, skills: ["skills/review.md"], prompts: [] }],
      };
      const original = structuredClone(snapshot);
      fixture.manager.setPackages(snapshot.packages!);
      await fixture.manager.flush();
      await restoreCollection(fixture.manager, snapshot, fixture);
      assert.deepEqual(fixture.manager.getGlobalSettings().packages, [
        {
          source: packageDir, extensions: [...(extensions.length === 0 ? ["!*"] : retained), "+index.ts"],
          skills: ["skills/review.md"], prompts: [],
        },
      ]);
      assert.deepEqual(snapshot, original);
      const resolved = await new DefaultPackageManager({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        settingsManager: SettingsManager.create(fixture.cwd, fixture.agentDir),
      }).resolve();
      assert.equal(resolved.extensions.find((entry) => entry.path === managerPath)?.enabled, true);
      assert.equal(resolved.extensions.find((entry) => entry.path === siblingPath)?.enabled, false);
      const firstRestore = await readFile(fixture.globalPath, "utf8");
      await restoreCollection(fixture.manager, snapshot, fixture);
      assert.equal(await readFile(fixture.globalPath, "utf8"), firstRestore);
    }
  });
});

function collectionPath(agentDir: string): string {
  return join(agentDir, "extension-toggle-collections.json");
}

async function collectionFixture(
  t: { after: (fn: () => Promise<void>) => void },
  global: object = {},
  project: object = {},
) {
  const root = await mkdtemp(join(tmpdir(), "extension-toggle-collections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, "project");
  const agentDir = join(root, "agent");
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(agentDir);
  const globalPath = join(agentDir, "settings.json");
  const projectPath = join(cwd, ".pi", "settings.json");
  await writeFile(globalPath, JSON.stringify(global));
  await writeFile(projectPath, JSON.stringify(project));
  return { cwd, agentDir, globalPath, projectPath, manager: SettingsManager.create(cwd, agentDir) };
}

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
