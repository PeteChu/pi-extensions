import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCondensedTranscript,
  buildReportFileName,
  buildRetroPrompt,
  collectMetrics,
  parseRetroAnalysis,
  renderHtmlReport,
  type RetroAnalysis,
  type RetroMetrics,
} from "../index";

const baseTime = "2026-06-05T12:00:00.000Z";

function makeMetrics(overrides: Partial<RetroMetrics> = {}): RetroMetrics {
  return {
    userMessages: 1,
    assistantMessages: 0,
    totalTurns: 1,
    sessionDurationMs: null,
    toolCallsByName: {},
    failedToolCalls: 0,
    bashCommands: 0,
    filesRead: [],
    filesEdited: [],
    filesWritten: [],
    searchesPerformed: 0,
    verificationCommands: [],
    likelyCorrections: 0,
    ...overrides,
  };
}

test("collectMetrics counts turns, tool usage, files, verification, and corrections", () => {
  const metrics = collectMetrics([
    {
      type: "message",
      timestamp: baseTime,
      message: { role: "user", content: "Create the thing" },
    },
    {
      type: "message",
      timestamp: "2026-06-05T12:01:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I'll inspect files." },
          { type: "toolCall", name: "read", arguments: { path: "src/a.ts" } },
          { type: "toolCall", name: "edit", arguments: { path: "src/a.ts" } },
          { type: "toolCall", name: "bash", arguments: { command: "pnpm test" } },
          { type: "toolCall", name: "grep", arguments: { pattern: "x", path: "." } },
        ],
      },
    },
    {
      type: "message",
      timestamp: "2026-06-05T12:02:00.000Z",
      message: { role: "toolResult", toolName: "bash", isError: true, content: "failed" },
    },
    {
      type: "message",
      timestamp: "2026-06-05T12:03:00.000Z",
      message: { role: "user", content: "Actually, don't edit that file." },
    },
  ]);

  assert.equal(metrics.userMessages, 2);
  assert.equal(metrics.assistantMessages, 1);
  assert.equal(metrics.toolCallsByName.read, 1);
  assert.equal(metrics.toolCallsByName.edit, 1);
  assert.equal(metrics.toolCallsByName.bash, 1);
  assert.equal(metrics.failedToolCalls, 1);
  assert.equal(metrics.bashCommands, 1);
  assert.deepEqual(metrics.filesRead, ["src/a.ts"]);
  assert.deepEqual(metrics.filesEdited, ["src/a.ts"]);
  assert.equal(metrics.searchesPerformed, 1);
  assert.deepEqual(metrics.verificationCommands, ["pnpm test"]);
  assert.equal(metrics.likelyCorrections, 1);
  assert.equal(metrics.sessionDurationMs, 180_000);
});

test("collectMetrics detects extension search and fetch tools by name pattern", () => {
  const metrics = collectMetrics([
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", name: "web_search", arguments: {} },
          { type: "toolCall", name: "code_search", arguments: {} },
          { type: "toolCall", name: "fetch_content", arguments: {} },
          { type: "toolCall", name: "mcp__brave__search", arguments: {} },
          { type: "toolCall", name: "customFetch", arguments: {} },
          { type: "toolCall", name: "research_notes", arguments: {} },
        ],
      },
    },
  ]);

  assert.equal(metrics.searchesPerformed, 5);
});

test("buildCondensedTranscript preserves first prompt and caps later content", () => {
  const transcript = buildCondensedTranscript(
    [
      { type: "message", message: { role: "user", content: "First prompt" } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "A".repeat(100) }] } },
      { type: "message", message: { role: "user", content: "Second prompt" } },
    ],
    80,
  );

  assert.match(transcript.text, /\[First user prompt\]\nFirst prompt/);
  assert.doesNotMatch(transcript.text, /Second prompt/);
  assert.equal(transcript.truncated, true);
});

test("buildRetroPrompt builds a non-empty prompt", () => {
  const prompt = buildRetroPrompt(
    "retro-123",
    { text: "[First user prompt]\nDo work", truncated: false, firstUserPrompt: "Do work" },
    makeMetrics(),
  );

  assert.equal(typeof prompt, "string");
  assert.ok(prompt.length > 0);
});

test("parseRetroAnalysis accepts fenced JSON and normalizes sections", () => {
  const analysis = parseRetroAnalysis(
    [
      "```json",
      "{",
      '  "sessionSummary": "Summary",',
      '  "timeline": ["A"],',
      '  "whatWentWell": ["B"],',
      '  "couldImprove": ["C"],',
      '  "whatNotToDo": ["D"],',
      '  "betterPromptExamples": [{"original":"old","improved":"new","why":"clearer"}],',
      '  "agentBehaviorNotes": ["E"],',
      '  "actionableTakeaways": ["F"]',
      "}",
      "```",
    ].join("\n"),
  );

  assert.equal(analysis.sessionSummary, "Summary");
  assert.deepEqual(analysis.timeline, ["A"]);
  assert.deepEqual(analysis.betterPromptExamples, [{ original: "old", improved: "new", why: "clearer" }]);
});

test("renderHtmlReport escapes model output", () => {
  const analysis: RetroAnalysis = {
    sessionSummary: "<script>alert(1)</script>",
    timeline: ["A & B"],
    whatWentWell: [],
    couldImprove: [],
    whatNotToDo: [],
    betterPromptExamples: [{ original: "<old>", improved: "<new>", why: "x" }],
    agentBehaviorNotes: [],
    actionableTakeaways: [],
  };

  const html = renderHtmlReport(
    analysis,
    makeMetrics({ assistantMessages: 1 }),
    { generatedAt: new Date("2026-06-05T12:00:00.000Z"), modelLabel: "test/model", transcriptTruncated: false },
  );

  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("buildReportFileName uses filesystem-safe timestamp", () => {
  assert.equal(
    buildReportFileName(new Date("2026-06-05T12:30:00.000Z")),
    "pi-retro-2026-06-05T12-30-00.html",
  );
});
