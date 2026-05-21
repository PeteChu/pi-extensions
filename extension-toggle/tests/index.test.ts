import { describe, it } from "node:test";
import assert from "node:assert/strict";
import extensionToggle, { discoverExtensionResources } from "../index";

describe("extension-toggle extension", () => {
  it("exports an extension factory", () => {
    assert.equal(typeof extensionToggle, "function");
  });

  it("exports the discovery helper", () => {
    assert.equal(typeof discoverExtensionResources, "function");
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
});
