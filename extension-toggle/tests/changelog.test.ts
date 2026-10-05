import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareVersions, notifyExtensionUpdate, parseChangelog, readExtensionChangelog } from "../changelog";
import type { ExtensionChangelog } from "../changelog";

describe("changelog versions and parsing", () => {
  it("uses SemVer precedence, including numeric prereleases and build metadata", () => {
    const ordered = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.1.0", "2.0.0"];
    for (let i = 1; i < ordered.length; i++) {
      assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
      assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1);
    }
    assert.equal(compareVersions("1.0.0+build.1", "1.0.0+build.2"), 0);
    for (const invalid of ["unknown", "01.0.0", "1.0", "1.0.0-01"]) assert.equal(compareVersions(invalid, "1.0.0"), undefined);
  });

  it("preserves each version's notes and ignores unreleased text and fenced headings", () => {
    const entries = parseChangelog("# Changelog\n## [Unreleased]\nFuture feature\n## [1.1.0] - 2026-10-04\n### Added\n- New feature\n```md\n## 9.0.0\n```\n## v1.0.0\n- Initial release\n");
    assert.deepEqual(entries.map(entry => entry.version), ["1.1.0", "1.0.0"]);
    assert.match(entries[0].markdown, /New feature/);
    assert.match(entries[0].markdown, /## 9.0.0/);
    assert.doesNotMatch(entries.map(entry => entry.markdown).join(""), /Future feature/);
    assert.match(entries[1].markdown, /Initial release/);
  });

  it("excludes dated and linked Unreleased sections after a release", () => {
    for (const heading of ["## [Unreleased] - 2026-10-05", "## [Unreleased](https://example.test/compare)"]) {
      const [entry] = parseChangelog(`## 1.0.0\nReleased\n${heading}\nFuture\n`);
      assert.equal(entry.markdown, "## 1.0.0\nReleased");
    }
  });
});

describe("extension-toggle release notes", () => {
  it("reads only released notes through its own installed version", async t => {
    const root = await tempDirectory(t);
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@petechu/pi-extension-toggle", version: "1.1.0" }));
    await writeFile(join(root, "CHANGELOG.md"), "## [Unreleased]\nFuture\n## 2.0.0\nNewer\n## 1.1.0\nCurrent\n## 1.0.0\nOriginal");
    const release = await readExtensionChangelog(root);
    assert.equal(release.version, "1.1.0");
    assert.match(release.markdown, /Current/);
    assert.match(release.markdown, /Original/);
    assert.doesNotMatch(release.markdown, /Future|Newer/);
  });

  it("rejects another extension's manifest and invalid self versions", async t => {
    const root = await tempDirectory(t);
    await writeFile(join(root, "CHANGELOG.md"), "## 1.0.0\nOther extension");
    for (const manifest of [
      { name: "another-extension", version: "1.0.0" },
      { name: "@petechu/pi-extension-toggle", version: "unknown" },
      null,
    ]) {
      await writeFile(join(root, "package.json"), JSON.stringify(manifest));
      await assert.rejects(readExtensionChangelog(root), /Invalid extension-toggle package manifest/);
    }
  });
});

describe("extension-toggle update hints", () => {
  it("baselines silently and hints once for an upgrade, never for downgrades or repeats", async t => {
    const root = await tempDirectory(t), notifications: string[] = [];
    const ctx = context(notifications);
    await notifyExtensionUpdate(ctx, release("1.0.0"), root);
    assert.deepEqual(notifications, []);
    await notifyExtensionUpdate(ctx, release("1.0.0"), root);
    await notifyExtensionUpdate(ctx, release("1.2.0"), root);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0], /extension-toggle/);
    assert.match(notifications[0], /1.0.0 → 1.2.0/);
    assert.match(notifications[0], /\/extension-toggle changelog/);
    assert.doesNotMatch(notifications[0], /Secret release details/);
    await notifyExtensionUpdate(ctx, release("1.2.0"), root);
    await notifyExtensionUpdate(ctx, release("1.1.0"), root);
    await notifyExtensionUpdate(ctx, release("1.2.0"), root);
    assert.equal(notifications.length, 1);
  });

  it("does not consume an update in noninteractive mode", async t => {
    const root = await tempDirectory(t), notifications: string[] = [];
    await notifyExtensionUpdate(context(notifications), release("1.0.0"), root);
    await notifyExtensionUpdate({ ...context(notifications), hasUI: false }, release("2.0.0"), root);
    await notifyExtensionUpdate(context(notifications), release("2.0.0"), root);
    assert.equal(notifications.length, 1);
    assert.match(notifications[0], /1.0.0 → 2.0.0/);
  });

  it("keeps separate baselines for different extension-toggle installations", async t => {
    const root = await tempDirectory(t), notifications: string[] = [], ctx = context(notifications);
    await notifyExtensionUpdate(ctx, release("1.0.0"), root);
    await notifyExtensionUpdate(ctx, { ...release("2.0.0"), key: "/project/extension-toggle" }, root);
    assert.deepEqual(notifications, []);
    await notifyExtensionUpdate(ctx, { ...release("2.1.0"), key: "/project/extension-toggle" }, root);
    await notifyExtensionUpdate(ctx, release("1.1.0"), root);
    assert.equal(notifications.length, 2);
    assert.match(notifications[0], /2.0.0 → 2.1.0/);
    assert.match(notifications[1], /1.0.0 → 1.1.0/);
  });

  it("recovers malformed state and ignores legacy versions belonging to other plugins", async t => {
    const root = await tempDirectory(t), notifications: string[] = [], ctx = context(notifications);
    await mkdir(join(root, "extension-toggle"));
    const filename = join(root, "extension-toggle", "changelog-seen-v1.json");
    for (const invalid of ["invalid json", "null", '{"schemaVersion":1,"versions":[]}']) {
      await writeFile(filename, invalid);
      await notifyExtensionUpdate(ctx, release("1.0.0"), root);
      assert.deepEqual(notifications, []);
    }
    await writeFile(filename, JSON.stringify({ schemaVersion: 1, versions: { "/other-plugin": "99.0.0" } }));
    await notifyExtensionUpdate(ctx, release("1.0.0"), root);
    assert.deepEqual(notifications, []);
    await notifyExtensionUpdate(ctx, release("1.1.0"), root);
    assert.equal(notifications.length, 1);
    assert.doesNotMatch(notifications[0], /99.0.0|other-plugin/);
    const saved = JSON.parse(await readFile(filename, "utf8"));
    assert.equal(saved.versions["/extension-toggle"], "1.1.0");
  });

  it("serializes overlapping checks within a process", async t => {
    const root = await tempDirectory(t), notifications: string[] = [], ctx = context(notifications);
    await notifyExtensionUpdate(ctx, release("1.0.0"), root);
    await Promise.all([notifyExtensionUpdate(ctx, release("1.1.0"), root), notifyExtensionUpdate(ctx, release("1.1.0"), root)]);
    assert.equal(notifications.length, 1);
  });
});

function release(version: string): ExtensionChangelog {
  return { key: "/extension-toggle", version, markdown: "Secret release details" };
}
function context(notifications: string[]) {
  return { hasUI: true, ui: { notify: (message: string) => { notifications.push(message); } } };
}
async function tempDirectory(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-changelog-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
