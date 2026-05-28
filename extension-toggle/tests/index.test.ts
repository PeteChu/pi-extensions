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
    } as never);

    assert.equal(registeredName, "extension-toggle");
    assert.match(description, /Enable or disable/);
  });

  it("enters explicit search mode, filters typed text, and toggles filtered rows by original index", () => {
    let result: ExtensionToggleSelection[] | null | undefined;
    const options = testOptions();
    const component = new ExtensionMultiSelect(options, (selection) => {
      result = selection;
    });

    component.handleInput("/");
    for (const character of "review") component.handleInput(character);

    const filteredRender = component.render(80).join("\n");
    assert.match(filteredRender, /Search \(active\): review/);
    assert.match(filteredRender, /reviewer \(global skill\)/);
    assert.doesNotMatch(filteredRender, /ai-commit/);
    assert.match(filteredRender, /1\/3 shown/);

    component.handleInput("\u001b"); // leave search mode without cancelling
    component.handleInput(" "); // toggle the selected filtered row
    component.handleInput("\r");

    assert.deepEqual(result, [
      {
        option: options[2],
        enabled: true,
      },
    ]);
  });

  it("uses printable characters only after entering search mode", () => {
    const options = testOptions();
    const component = new ExtensionMultiSelect(options, () => {});

    component.handleInput("j");
    assert.match(component.render(80).join("\n"), /> \[ \] answer/);

    component.handleInput("/");
    component.handleInput("j");
    const render = component.render(80).join("\n");
    assert.match(render, /Search \(active\): j/);
    assert.match(render, /No sources match "j"/);
  });

  it("edits and clears the search query while search mode is active", () => {
    const component = new ExtensionMultiSelect(testOptions(), () => {});

    component.handleInput("/");
    for (const character of "review") component.handleInput(character);
    component.handleInput("\x7f");
    assert.match(component.render(80).join("\n"), /Search \(active\): revie/);

    component.handleInput("\x15");
    const render = component.render(80).join("\n");
    assert.match(render, /Search \(active\): \(empty\)/);
    assert.match(render, /ai-commit/);
    assert.match(render, /answer/);
    assert.match(render, /reviewer/);
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

    component.handleInput("/");
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
