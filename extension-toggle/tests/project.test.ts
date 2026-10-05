import assert from "node:assert/strict";
import { it } from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { applyExtensionToggle, discoverExtensionResources } from "../index";
import { buildSourceOptions } from "../utils";

const exec = promisify(execFile);

it("uses only current-directory settings and saves a separate configuration in a subdirectory", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-toggle-settings-"));
  const agentDir = path.join(root, "agent"), repo = path.join(root, "repo"), cwd = path.join(repo, "nested");
  const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(agentDir, "extensions"), { recursive: true });
  await mkdir(path.join(repo, ".pi"), { recursive: true });
  await mkdir(path.join(cwd, ".pi"), { recursive: true });
  await exec("git", ["init", "-q", repo]);
  const target = path.join(agentDir, "extensions", "example.ts");
  const rootSettings = path.join(repo, ".pi", "settings.json"), localSettings = path.join(cwd, ".pi", "settings.json");
  await writeFile(target, "export default function () {};");
  await writeFile(path.join(agentDir, "settings.json"), "{}");
  const rootBefore = JSON.stringify({ extensions: [target, `-${target}`], defaultModel: "keep-root" });
  await writeFile(rootSettings, rootBefore);
  const globalBefore = await readFile(path.join(agentDir, "settings.json"), "utf8");

  assert.equal((await discoverExtensionResources({ cwd: repo })).extensions.find(resource => resource.path === target)?.enabled, false);
  const local = await discoverExtensionResources({ cwd });
  assert.equal(local.extensions.find(resource => resource.path === target)?.enabled, true);
  const option = buildSourceOptions(local.extensions, [], [], [], { cwd, agentDir })
    .find(option => option.resources.some(resource => resource.path === target));
  assert.ok(option);
  applyExtensionToggle(local.settingsManager, option, false, "project", agentDir, cwd);
  await local.settingsManager.flush();
  assert.deepEqual(JSON.parse(await readFile(localSettings, "utf8")), { extensions: [target, `-${target}`] });
  assert.equal((await discoverExtensionResources({ cwd })).extensions.find(resource => resource.path === target)?.enabled, false);
  assert.equal(await readFile(rootSettings, "utf8"), rootBefore);
  assert.equal(await readFile(path.join(agentDir, "settings.json"), "utf8"), globalBefore);

  await rm(localSettings);
  assert.equal((await discoverExtensionResources({ cwd })).extensions.find(resource => resource.path === target)?.enabled, true);
});

