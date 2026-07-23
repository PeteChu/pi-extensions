import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ResolvedResource } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import extensionToggle, {
  discoverExtensionResources,
  ExtensionMultiSelect,
  type ExtensionToggleSelection,
} from "../index";
import type { ExtensionOption } from "../utils";

describe("extension-toggle extension", () => {
  it("exports an extension factory", () => {
    assert.equal(typeof extensionToggle, "function");
  });

  it("exports the discovery helper", () => {
    assert.equal(typeof discoverExtensionResources, "function");
  });

  it("exports the multi-select component for state tests", () => {
    assert.equal(typeof ExtensionMultiSelect, "function");
  });

  it("registers the /extension-toggle command", () => {
    let registeredName = "";
    let description = "";

    extensionToggle({
      registerCommand(name: string, options: { description?: string }) {
        registeredName = name;
        description = options.description ?? "";
      },
      registerShortcut() {},
    } as never);

    assert.equal(registeredName, "extension-toggle");
    assert.match(description, /Enable or disable/);
  });

  it("registers the floating window shortcut", () => {
    let registeredShortcut = "";
    let description = "";

    extensionToggle({
      registerCommand() {},
      registerShortcut(shortcut: string, options: { description?: string }) {
        registeredShortcut = shortcut;
        description = options.description ?? "";
      },
    } as never);

    assert.equal(registeredShortcut, "ctrl+shift+e");
    assert.match(description, /floating window/);
  });

  it("filters immediately and toggles filtered rows by original index", () => {
    let result: ExtensionToggleSelection[] | null | undefined;
    const options = testOptions();
    const component = new ExtensionMultiSelect(options, (selection) => {
      result = selection;
    });

    for (const character of "review") component.handleInput(character);

    const filteredRender = component.render(80).join("\n");
    assert.match(filteredRender, /Search: review/);
    assert.match(filteredRender, /reviewer \(global skill\)/);
    assert.doesNotMatch(filteredRender, /ai-commit/);
    assert.match(filteredRender, /1\/3 shown/);

    component.handleInput(" "); // toggle the selected filtered row
    component.handleInput("\r");

    assert.deepEqual(result, [
      {
        option: options[2],
        enabled: true,
      },
    ]);
  });

  it("keeps arrow navigation and Space toggling available while filtering", () => {
    let result: ExtensionToggleSelection[] | null | undefined;
    const options = testOptions();
    const component = new ExtensionMultiSelect(options, (selection) => {
      result = selection;
    });

    for (const character of "global") component.handleInput(character);
    component.handleInput("\u001b[A"); // Up stays on the first filtered row.
    component.handleInput("\u001b[B"); // Down selects the next filtered row.
    component.handleInput(" ");
    component.handleInput("\r");

    assert.deepEqual(result, [
      {
        option: options[2],
        enabled: true,
      },
    ]);
  });

  it("edits and clears the query while filtering", () => {
    const component = new ExtensionMultiSelect(testOptions(), () => {});

    for (const character of "review") component.handleInput(character);
    component.handleInput("\x7f");
    assert.match(component.render(80).join("\n"), /Search: revie/);

    component.handleInput("\x15");
    const render = component.render(80).join("\n");
    assert.match(render, /Search: \(empty\)/);
    assert.match(render, /ai-commit/);
    assert.match(render, /answer/);
    assert.match(render, /reviewer/);
  });

  it("clears the query before Escape cancels and remains searchable", () => {
    let result: ExtensionToggleSelection[] | null | undefined;
    const component = new ExtensionMultiSelect(testOptions(), (selection) => {
      result = selection;
    });

    for (const character of "review") component.handleInput(character);
    component.handleInput("\u001b");
    const clearedRender = component.render(80).join("\n");
    assert.equal(result, undefined);
    assert.match(clearedRender, /Search: \(empty\)/);
    assert.match(clearedRender, /ai-commit/);

    for (const character of "answer") component.handleInput(character);
    assert.match(component.render(80).join("\n"), /Search: answer/);

    component.handleInput("\u001b");
    component.handleInput("\u001b");
    assert.equal(result, null);
  });

  it("uses a configurable visible row count", () => {
    const options = Array.from({ length: 20 }, (_, index) =>
      longLabelOption(index),
    );
    const component = new ExtensionMultiSelect(
      options,
      () => {},
      () => 5,
    );
    const lines = component.render(100);

    assert.equal(
      lines.filter((line) => line.includes("[x]") || line.includes("[ ]"))
        .length,
      5,
    );
    assert.match(lines.join("\n"), /\(1\/20 shown, 20 total\)/);
  });

  it("uses a compact footer when help is available", () => {
    const component = new ExtensionMultiSelect(
      testOptions(),
      () => {},
      12,
      true,
    );
    const render = component.render(100).join("\n");

    assert.match(render, /\? help/);
    assert.doesNotMatch(render, /j\/k/);
    assert.doesNotMatch(render, /ctrl\+f/);
  });

  it("drops overflowing default footer hints instead of ellipsizing", () => {
    const component = new ExtensionMultiSelect(testOptions(), () => {});

    const normalFooter = component.render(35).at(-1) ?? "";
    assert.equal(normalFooter, "↑/↓: move · space: toggle");
    assert.doesNotMatch(normalFooter, /\.\.\./);

    const searchFooter = component.render(35).at(-1) ?? "";
    assert.equal(searchFooter, "↑/↓: move · space: toggle");
    assert.doesNotMatch(searchFooter, /\.\.\./);
  });

  it("drops only overflowing footer hints while preserving question mark help", () => {
    const component = new ExtensionMultiSelect(
      testOptions(),
      () => {},
      12,
      true,
    );

    const normalFooter = component.render(20).at(-1) ?? "";
    assert.equal(normalFooter, "↑/↓ move · ? help");
    assert.doesNotMatch(normalFooter, /\.\.\./);

    const searchFooter = component.render(20).at(-1) ?? "";
    assert.equal(searchFooter, "↑/↓ move · ? help");
    assert.doesNotMatch(searchFooter, /\.\.\./);
  });

  it("pins the floating window shortcut before question mark help", () => {
    const component = new ExtensionMultiSelect(
      testOptions(),
      () => {},
      12,
      true,
      "ctrl+shift+e float",
    );

    const normalFooter = component.render(35).at(-1) ?? "";
    assert.equal(normalFooter, "ctrl+shift+e float · ? help");

    const searchFooter = component.render(35).at(-1) ?? "";
    assert.equal(searchFooter, "ctrl+shift+e float · ? help");
  });

  it("keeps rendered lines within width for long labels and narrow terminals", () => {
    const width = 20;
    const options = Array.from({ length: 16 }, (_, index) => ({
      ...longLabelOption(index),
      label: `extremely-long-extension-label-${index}-with-extra-detail-and-wide-text-測試`,
    }));
    const component = new ExtensionMultiSelect(options, () => {});

    assertRenderedLinesFitWidth(component.render(width), width);
  });

  it("keeps rendered lines within width for long search queries and empty results", () => {
    const width = 18;
    const component = new ExtensionMultiSelect([longLabelOption(0)], () => {});

    for (const character of "query-that-is-much-longer-than-the-terminal-width") {
      component.handleInput(character);
    }

    assertRenderedLinesFitWidth(component.render(width), width);
  });
});

function assertRenderedLinesFitWidth(lines: string[], width: number): void {
  for (const [index, line] of lines.entries()) {
    assert.ok(
      visibleWidth(line) <= width,
      `line ${index} exceeds width ${width}: ${visibleWidth(line)} > ${width}`,
    );
  }
}

function testOptions(): ExtensionOption[] {
  return [
    {
      label: "ai-commit (global extension)",
      resources: [
        resource({
          path: "/home/user/.pi/agent/extensions/ai-commit/index.ts",
          enabled: true,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
      ],
      sourceKey: "extensions/ai-commit/index.ts",
      scope: "user",
      origin: "top-level",
      resourceType: "extensions",
    },
    {
      label: "answer (global extension)",
      resources: [
        resource({
          path: "/home/user/.pi/agent/extensions/answer/index.ts",
          enabled: false,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
      ],
      sourceKey: "extensions/answer/index.ts",
      scope: "user",
      origin: "top-level",
      resourceType: "extensions",
    },
    {
      label: "reviewer (global skill)",
      resources: [
        resource({
          path: "/home/user/.pi/agent/skills/reviewer/skill.md",
          enabled: false,
          source: "auto",
          scope: "user",
          origin: "top-level",
          baseDir: "/home/user/.pi/agent",
        }),
      ],
      sourceKey: "skills/reviewer/skill.md",
      scope: "user",
      origin: "top-level",
      resourceType: "skills",
    },
  ];
}

function longLabelOption(index: number): ExtensionOption {
  return {
    label: `long-label-${index}`,
    resources: [
      resource({
        path: `/home/user/.pi/agent/extensions/long-label-${index}/index.ts`,
        enabled: index % 2 === 0,
        source: "auto",
        scope: "user",
        origin: "top-level",
        baseDir: "/home/user/.pi/agent",
      }),
    ],
    sourceKey: `extensions/long-label-${index}/index.ts`,
    scope: "user",
    origin: "top-level",
    resourceType: "extensions",
  };
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
