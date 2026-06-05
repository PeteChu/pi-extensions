import {
  defineTool,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";

const COMMAND_NAME = "retro";
const SAVE_REPORT_TOOL_NAME = "retro_save_report";
export const MAX_TRANSCRIPT_CHARS = 40_000;
export const MAX_MESSAGE_EXCERPT_CHARS = 1_500;
const MAX_TOOL_ARGS_CHARS = 800;
const MAX_ERROR_EXCERPT_CHARS = 1_000;
const NATIVE_SEARCH_TOOL_NAMES = new Set(["grep", "find"]);

const execFileAsync = promisify(execFile);

interface SessionEntry {
  type: string;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
    toolName?: string;
    isError?: boolean;
    command?: string;
    output?: string;
    exitCode?: number;
  };
}

export interface RetroMetrics {
  userMessages: number;
  assistantMessages: number;
  totalTurns: number;
  sessionDurationMs: number | null;
  toolCallsByName: Record<string, number>;
  failedToolCalls: number;
  bashCommands: number;
  filesRead: string[];
  filesEdited: string[];
  filesWritten: string[];
  searchesPerformed: number;
  verificationCommands: string[];
  likelyCorrections: number;
}

export interface CondensedTranscript {
  text: string;
  truncated: boolean;
  firstUserPrompt: string;
}

export interface BetterPromptExample {
  original: string;
  improved: string;
  why: string;
}

export interface RetroAnalysis {
  sessionSummary: string;
  timeline: string[];
  whatWentWell: string[];
  couldImprove: string[];
  whatNotToDo: string[];
  betterPromptExamples: BetterPromptExample[];
  agentBehaviorNotes: string[];
  actionableTakeaways: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        isObject(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
}

function toolCallsFromContent(content: unknown): Array<{
  name: string;
  args: Record<string, unknown>;
}> {
  if (!Array.isArray(content)) return [];

  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const block of content) {
    if (!isObject(block) || block.type !== "toolCall") continue;
    if (typeof block.name !== "string") continue;
    calls.push({
      name: block.name,
      args: isObject(block.arguments) ? block.arguments : {},
    });
  }
  return calls;
}

function truncateText(text: string, maxChars: number): string {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trimEnd()}… [truncated]`;
}

function addCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function addTrimmedString(set: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;

  const trimmed = value.trim();
  if (trimmed) set.add(trimmed);
}

function toolNameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function looksLikeSearchToolName(name: string): boolean {
  if (NATIVE_SEARCH_TOOL_NAMES.has(name)) return true;
  return toolNameTokens(name).some((token) => token === "search" || token === "fetch");
}

function looksLikeVerificationCommand(command: string): boolean {
  return /\b(pnpm|npm|yarn|bun)\s+(run\s+)?(test|check|typecheck|lint)\b/i.test(command) ||
    /\b(make\s+(check|test|typecheck)|pytest|vitest|jest|cargo\s+test|go\s+test|tsc\b|eslint\b)\b/i.test(command);
}

function looksLikeCorrection(text: string): boolean {
  return /\b(actually|i meant|not what|that's not|that is not|don'?t|stop|instead|you misunderstood|my intention|what i want|no,|not user's intention)\b/i.test(text);
}

function sessionDuration(entries: SessionEntry[]): number | null {
  const hasRetroReport = (entry: SessionEntry): boolean =>
    entry.message?.role === "assistant" &&
    toolCallsFromContent(entry.message.content).some((call) => call.name === SAVE_REPORT_TOOL_NAME);

  const times = entries
    .filter((entry) => {
      if (entry.message?.role === "user") return true;
      if (hasRetroReport(entry)) return false;
      return entry.message?.role === "assistant";
    })
    .map((entry) => Date.parse(entry.timestamp ?? ""))
    .filter((time) => Number.isFinite(time));
  if (times.length < 2) return null;
  return Math.max(...times) - Math.min(...times);
}

function recordToolSurface(
  name: string,
  args: Record<string, unknown>,
  filesRead: Set<string>,
  filesEdited: Set<string>,
  filesWritten: Set<string>,
): void {
  switch (name) {
    case "read":
      addTrimmedString(filesRead, args.path);
      break;
    case "edit":
      addTrimmedString(filesEdited, args.path);
      break;
    case "write":
      addTrimmedString(filesWritten, args.path);
      break;
  }
}

export function collectMetrics(entries: SessionEntry[]): RetroMetrics {
  const toolCallsByName: Record<string, number> = {};
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  const filesWritten = new Set<string>();
  const verificationCommands = new Set<string>();
  let userMessages = 0;
  let assistantMessages = 0;
  let failedToolCalls = 0;
  let bashCommands = 0;
  let searchesPerformed = 0;
  let likelyCorrections = 0;

  for (const entry of entries) {
    const message = entry.message;
    if (!message) continue;

    if (message.role === "user") {
      userMessages++;
      if (userMessages > 1 && looksLikeCorrection(textFromContent(message.content))) {
        likelyCorrections++;
      }
      continue;
    }

    if (message.role === "assistant") {
      assistantMessages++;
      for (const call of toolCallsFromContent(message.content)) {
        addCount(toolCallsByName, call.name);
        if (call.name === "bash") bashCommands++;
        if (looksLikeSearchToolName(call.name)) {
          searchesPerformed++;
        }
        recordToolSurface(call.name, call.args, filesRead, filesEdited, filesWritten);

        if (call.name === "bash" && typeof call.args.command === "string" && looksLikeVerificationCommand(call.args.command)) {
          verificationCommands.add(call.args.command);
        }
      }
      continue;
    }

    if (message.role === "toolResult") {
      if (message.isError) failedToolCalls++;
      continue;
    }

    if (message.role === "bashExecution") {
      bashCommands++;
      if (typeof message.command === "string" && looksLikeVerificationCommand(message.command)) {
        verificationCommands.add(message.command);
      }
      if (typeof message.exitCode === "number" && message.exitCode !== 0) {
        failedToolCalls++;
      }
    }
  }

  return {
    userMessages,
    assistantMessages,
    totalTurns: userMessages,
    sessionDurationMs: sessionDuration(entries),
    toolCallsByName,
    failedToolCalls,
    bashCommands,
    filesRead: [...filesRead].sort(),
    filesEdited: [...filesEdited].sort(),
    filesWritten: [...filesWritten].sort(),
    searchesPerformed,
    verificationCommands: [...verificationCommands],
    likelyCorrections,
  };
}

function stringifyArgs(args: Record<string, unknown>): string {
  return truncateText(JSON.stringify(args), MAX_TOOL_ARGS_CHARS);
}

function appendWithCap(parts: string[], next: string, maxChars: number): boolean {
  const currentLength = parts.join("\n\n").length;
  const separatorLength = parts.length > 0 ? 2 : 0;
  if (currentLength + separatorLength + next.length > maxChars) {
    return false;
  }
  parts.push(next);
  return true;
}

export function buildCondensedTranscript(
  entries: SessionEntry[],
  maxChars = MAX_TRANSCRIPT_CHARS,
): CondensedTranscript {
  const firstUser = entries.find(
    (entry) => entry.message?.role === "user" && textFromContent(entry.message.content).trim(),
  );
  const firstUserPrompt = firstUser
    ? truncateText(textFromContent(firstUser.message?.content), MAX_MESSAGE_EXCERPT_CHARS)
    : "";

  const parts: string[] = [];
  let truncated = false;

  if (firstUserPrompt) {
    parts.push(`[First user prompt]\n${firstUserPrompt}`);
  }

  // TODO: Improve long-session handling by preserving all correction moments,
  // summarizing skipped middle turns, and adapting the cap to model context size.
  for (const entry of entries) {
    const message = entry.message;
    if (!message) continue;

    let section = "";
    if (message.role === "user") {
      const text = truncateText(textFromContent(message.content), MAX_MESSAGE_EXCERPT_CHARS);
      if (!text) continue;
      if (entry === firstUser) continue;
      section = `[User]\n${text}`;
    } else if (message.role === "assistant") {
      const lines: string[] = [];
      const text = truncateText(textFromContent(message.content), MAX_MESSAGE_EXCERPT_CHARS);
      if (text) lines.push(`[Assistant]\n${text}`);
      for (const call of toolCallsFromContent(message.content)) {
        lines.push(`[Tool call] ${call.name} ${stringifyArgs(call.args)}`);
      }
      section = lines.join("\n");
    } else if (message.role === "toolResult" && message.isError) {
      const errorText = truncateText(textFromContent(message.content), MAX_ERROR_EXCERPT_CHARS);
      section = `[Tool error] ${message.toolName ?? "unknown"}${errorText ? `\n${errorText}` : ""}`;
    } else if (message.role === "bashExecution") {
      const status = message.exitCode === undefined ? "unknown" : String(message.exitCode);
      if (message.exitCode !== 0) {
        section = `[Bash error] exit ${status}\n${truncateText(message.command ?? "", MAX_MESSAGE_EXCERPT_CHARS)}`;
      }
    }

    if (!section) continue;
    if (!appendWithCap(parts, section, maxChars)) {
      truncated = true;
      break;
    }
  }

  return { text: parts.join("\n\n"), truncated, firstUserPrompt };
}

function metricsForPrompt(metrics: RetroMetrics): string {
  return JSON.stringify(metrics, null, 2);
}

export function buildRetroPrompt(
  requestId: string,
  transcript: CondensedTranscript,
  metrics: RetroMetrics,
): string {
  return `You are generating a private retrospective report for this Pi coding-agent session.

Use the active model normally. Do not ask the user for API keys. Do not reply with the report in chat.

Your final action MUST be calling the ${SAVE_REPORT_TOOL_NAME} tool with requestId "${requestId}" and these sections:
- sessionSummary
- timeline
- whatWentWell
- couldImprove
- whatNotToDo
- betterPromptExamples
- agentBehaviorNotes
- actionableTakeaways

Focus on the collaboration from the user's first prompt onward: how the agent interpreted it, where the agent did or did not match the user's intention, where later user steering corrected course, and how the user can prompt better next time.

Rules:
- Be specific and actionable.
- Keep raw excerpts short. Do not quote long prompts, tool outputs, file contents, or secrets.
- Better prompt examples are required when the transcript contains user prompts.
- Do not invent facts beyond the transcript and metrics.
- Mention agent issues only when they affected the user's outcome or steering needs.
- Call ${SAVE_REPORT_TOOL_NAME} exactly once as the final action.

Metrics:
${metricsForPrompt(metrics)}

Transcript${transcript.truncated ? " (truncated)" : ""}:
${transcript.text}`;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && !!item.trim())
    .map((item) => item.trim());
}

function parsePromptExamples(value: unknown): BetterPromptExample[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((item) => ({
      original: typeof item.original === "string" ? item.original.trim() : "",
      improved: typeof item.improved === "string" ? item.improved.trim() : "",
      why: typeof item.why === "string" ? item.why.trim() : "",
    }))
    .filter((item) => item.original || item.improved || item.why);
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("model did not return a JSON object");
  }
  return trimmed.slice(start, end + 1);
}

export function parseRetroAnalysis(text: string): RetroAnalysis {
  const parsed = JSON.parse(extractJsonObject(text)) as unknown;
  if (!isObject(parsed)) {
    throw new Error("model returned invalid JSON");
  }

  return {
    sessionSummary: typeof parsed.sessionSummary === "string" ? parsed.sessionSummary.trim() : "",
    timeline: stringArray(parsed.timeline),
    whatWentWell: stringArray(parsed.whatWentWell),
    couldImprove: stringArray(parsed.couldImprove),
    whatNotToDo: stringArray(parsed.whatNotToDo),
    betterPromptExamples: parsePromptExamples(parsed.betterPromptExamples),
    agentBehaviorNotes: stringArray(parsed.agentBehaviorNotes),
    actionableTakeaways: stringArray(parsed.actionableTakeaways),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderList(items: string[]): string {
  if (items.length === 0) return "<p class=\"empty\">No items reported.</p>";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderPromptExamples(items: BetterPromptExample[]): string {
  if (items.length === 0) return "<p class=\"empty\">No prompt rewrites reported.</p>";
  return items
    .map(
      (item) => `<article class="prompt-example">
        <h3>Prompt rewrite</h3>
        <p>Original:</p><blockquote>${escapeHtml(item.original)}</blockquote>
        <p>Improved:</p><blockquote>${escapeHtml(item.improved)}</blockquote>
        <p>Why: ${escapeHtml(item.why)}</p>
      </article>`,
    )
    .join("\n");
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "Unknown";
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function renderHtmlReport(
  analysis: RetroAnalysis,
  metrics: RetroMetrics,
  metadata: { generatedAt: Date; modelLabel: string; transcriptTruncated: boolean },
): string {
  const formatTimestamp = (date: Date): string => {
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  const generatedAt = formatTimestamp(metadata.generatedAt);
  const totalToolCalls = Object.values(metrics.toolCallsByName).reduce((sum, count) => sum + count, 0);
  const toolCallEntries = Object.entries(metrics.toolCallsByName).sort(([a], [b]) => a.localeCompare(b));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pi Retro Report</title>
<style>
  :root {
    --bg: #ffffff;
    --bg-secondary: #fafafa;
    --text: #1a1a1a;
    --text-secondary: #6b6b6b;
    --text-tertiary: #9a9a9a;
    --border: #e5e5e5;
    --border-light: #f0f0f0;
    --note-bg: #fffbf0;
    --note-border: #e8dcc0;
    --font-display: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-body: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-mono: "SF Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --icon-sun-opacity: 1;
    --icon-moon-opacity: 0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0a0a0a;
      --bg-secondary: #141414;
      --text: #e8e8e8;
      --text-secondary: #8a8a8a;
      --text-tertiary: #5a5a5a;
      --border: #2a2a2a;
      --border-light: #1f1f1f;
      --note-bg: #1a1810;
      --note-border: #3a3628;
    }
  }
  * { box-sizing: border-box; }
  html { font-size: 16px; scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: var(--font-body);
    font-size: 15px;
    line-height: 1.6;
    color: var(--text);
    background: var(--bg);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  main {
    max-width: 800px;
    margin: 0 auto;
    padding: 60px 24px 80px;
  }
  header {
    padding-bottom: 40px;
    margin-bottom: 40px;
    border-bottom: 1px solid var(--border);
  }
  h1 {
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 600;
    line-height: 1.2;
    margin: 0 0 12px;
    letter-spacing: -0.02em;
  }
  .meta {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-tertiary);
    margin: 0;
  }
  .note {
    padding: 14px 16px;
    margin: 32px 0;
    background: var(--note-bg);
    border-left: 2px solid var(--note-border);
    font-size: 14px;
    line-height: 1.5;
  }
  .note strong { font-weight: 500; }
  .metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    margin: 32px 0;
    background: var(--border);
    border: 1px solid var(--border);
  }
  .metric {
    background: var(--bg-secondary);
    padding: 20px 16px;
    text-align: center;
  }
  .metric-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    margin-bottom: 4px;
  }
  .metric-value {
    font-family: var(--font-display);
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.03em;
  }
  .section {
    margin: 48px 0;
  }
  .section:first-of-type { margin-top: 40px; }
  h2 {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-secondary);
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-light);
  }
  .section p {
    font-size: 16px;
    line-height: 1.7;
    margin: 0;
    max-width: 68ch;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
    padding-left: 20px;
    margin: 10px 0;
    font-size: 15px;
    line-height: 1.6;
  }
  li::before {
    content: "—";
    position: absolute;
    left: 0;
    color: var(--text-tertiary);
  }
  .empty {
    color: var(--text-tertiary);
    font-style: italic;
    font-size: 14px;
  }
  .prompt-example {
    margin: 24px 0;
    padding: 24px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-light);
  }
  .prompt-example + .prompt-example {
    margin-top: 16px;
  }
  .prompt-example h3 {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 16px;
    color: var(--text);
  }
  .prompt-example p {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .prompt-example blockquote {
    margin: 4px 0 16px;
    padding: 12px 16px;
    background: var(--bg);
    border: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
  }
  td {
    padding: 8px 12px;
    font-size: 14px;
    border-bottom: 1px solid var(--border-light);
  }
  td:first-child { color: var(--text); }
  td:last-child {
    text-align: right;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  tr:last-child td { border-bottom: none; }
  .details {
    margin-top: 56px;
    padding-top: 32px;
    border-top: 1px solid var(--border);
  }
  .details h3 {
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-tertiary);
    margin: 32px 0 12px;
  }
  .file-list {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-secondary);
    word-break: break-all;
  }
  .theme-toggle {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.2s ease, background 0.2s ease;
  }
  .theme-toggle:hover {
    border-color: var(--text-secondary);
  }
  .theme-toggle svg {
    position: absolute;
    transition: opacity 0.2s ease, transform 0.3s ease;
    stroke: currentColor;
  }
  .sun-icon {
    opacity: var(--icon-sun-opacity, 1);
    transform: var(--icon-sun-transform, rotate(0deg));
  }
  .moon-icon {
    opacity: var(--icon-moon-opacity, 0);
    transform: var(--icon-moon-transform, rotate(-90deg));
  }
  .theme-toggle:hover .sun-icon {
    transform: rotate(45deg);
  }
  .theme-toggle:hover .moon-icon {
    transform: rotate(-45deg);
  }
  @media (max-width: 640px) {
    main { padding: 32px 20px 48px; }
    h1 { font-size: 26px; }
    .metrics { grid-template-columns: repeat(2, 1fr); }
    .metric { padding: 16px 12px; }
    .metric-value { font-size: 20px; }
    .section { margin: 36px 0; }
    li { padding-left: 16px; }
  }
  @media print {
    main { max-width: 100%; padding: 20px; }
    header { border-bottom: 2px solid #000; }
    .metrics { border: 1px solid #000; }
    .metric { background: #fff; border-right: 1px solid #ccc; }
    .metric:last-child { border-right: none; }
    .theme-toggle { display: none; }
  }
</style>
</head>
<body>
<main>
  <header>
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;">
      <div>
        <h1>Pi Retro Report</h1>
        <p class="meta">${escapeHtml(generatedAt)} · ${escapeHtml(metadata.modelLabel)}${metadata.transcriptTruncated ? " · transcript truncated" : ""}</p>
      </div>
      <button class="theme-toggle" id="themeToggle" aria-label="Toggle theme">
        <svg class="sun-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="10" cy="10" r="4"/>
          <path d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.66 4.34l-1.41 1.41M5.75 14.25l-1.41 1.41M15.66 15.66l-1.41-1.41M5.75 5.75L4.34 4.34"/>
        </svg>
        <svg class="moon-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 10a4 4 0 1 0-8 0 4 4 0 0 0 8 0z"/>
          <path d="M14.5 14.5a7 7 0 1 1-9-9"/>
        </svg>
      </button>
    </div>
  </header>

  <script>
    (function() {
      const toggle = document.getElementById('themeToggle');
      const html = document.documentElement;

      const themes = {
        dark: {
          '--bg': '#0a0a0a',
          '--bg-secondary': '#141414',
          '--text': '#e8e8e8',
          '--text-secondary': '#8a8a8a',
          '--text-tertiary': '#5a5a5a',
          '--border': '#2a2a2a',
          '--border-light': '#1f1f1f',
          '--note-bg': '#1a1810',
          '--note-border': '#3a3628',
          '--icon-moon-opacity': '1',
          '--icon-sun-opacity': '0'
        },
        light: {
          '--bg': '#ffffff',
          '--bg-secondary': '#fafafa',
          '--text': '#1a1a1a',
          '--text-secondary': '#6b6b6b',
          '--text-tertiary': '#9a9a9a',
          '--border': '#e5e5e5',
          '--border-light': '#f0f0f0',
          '--note-bg': '#fffbf0',
          '--note-border': '#e8dcc0',
          '--icon-moon-opacity': '0',
          '--icon-sun-opacity': '1'
        }
      };

      function setTheme(isDark) {
        for (const [name, value] of Object.entries(isDark ? themes.dark : themes.light)) {
          html.style.setProperty(name, value);
        }
      }

      function getInitialTheme() {
        const stored = localStorage.getItem('pi-retro-theme');
        if (stored === 'dark' || stored === 'light') return stored === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
      }

      let isDark = getInitialTheme();
      setTheme(isDark);

      toggle.addEventListener('click', function() {
        isDark = !isDark;
        setTheme(isDark);
        localStorage.setItem('pi-retro-theme', isDark ? 'dark' : 'light');
      });
    })();
  </script>

  <div class="note"><strong>Privacy notice:</strong> This report contains excerpts from your session. Review before sharing.</div>

  <div class="metrics">
    <div class="metric"><div class="metric-label">Turns</div><div class="metric-value">${metrics.totalTurns}</div></div>
    <div class="metric"><div class="metric-label">Duration</div><div class="metric-value">${formatDuration(metrics.sessionDurationMs)}</div></div>
    <div class="metric"><div class="metric-label">Tools</div><div class="metric-value">${totalToolCalls}</div></div>
    <div class="metric"><div class="metric-label">Corrections</div><div class="metric-value">${metrics.likelyCorrections}</div></div>
  </div>

  <section class="section">
    <h2>Session Summary</h2>
    <p>${escapeHtml(analysis.sessionSummary || "No summary returned.")}</p>
  </section>

  <section class="section">
    <h2>Timeline</h2>
    ${renderList(analysis.timeline)}
  </section>

  <section class="section">
    <h2>What Went Well</h2>
    ${renderList(analysis.whatWentWell)}
  </section>

  <section class="section">
    <h2>What Could Be Improved</h2>
    ${renderList(analysis.couldImprove)}
  </section>

  <section class="section">
    <h2>What Not To Do</h2>
    ${renderList(analysis.whatNotToDo)}
  </section>

  ${analysis.betterPromptExamples.length > 0 ? `
  <section class="section">
    <h2>Better Prompts</h2>
    ${renderPromptExamples(analysis.betterPromptExamples)}
  </section>` : ''}

  <section class="section">
    <h2>Agent Behavior</h2>
    ${renderList(analysis.agentBehaviorNotes)}
  </section>

  <section class="section">
    <h2>Actionable Takeaways</h2>
    ${renderList(analysis.actionableTakeaways)}
  </section>

  <div class="details">
    <h3>Tool Calls</h3>
    ${toolCallEntries.length > 0 ? `<table>
      ${toolCallEntries.map(([name, count]) => `<tr><td>${escapeHtml(name)}</td><td>${count}</td></tr>`).join("")}
    </table>` : '<p class="empty">No tool calls recorded.</p>'}

    <h3>Files Read</h3>
    ${metrics.filesRead.length > 0 ? `<p class="file-list">${escapeHtml(metrics.filesRead.join(" · "))}</p>` : '<p class="empty">None</p>'}

    <h3>Files Edited</h3>
    ${metrics.filesEdited.length > 0 ? `<p class="file-list">${escapeHtml(metrics.filesEdited.join(" · "))}</p>` : '<p class="empty">None</p>'}

    <h3>Files Written</h3>
    ${metrics.filesWritten.length > 0 ? `<p class="file-list">${escapeHtml(metrics.filesWritten.join(" · "))}</p>` : '<p class="empty">None</p>'}

    <h3>Verification Commands</h3>
    ${metrics.verificationCommands.length > 0 ? `<p class="file-list">${escapeHtml(metrics.verificationCommands.join(" · "))}</p>` : '<p class="empty">None detected</p>'}
  </div>
</main>
</body>
</html>`;
}

export function buildReportFileName(date = new Date()): string {
  const timestamp = date.toISOString().replace(/\.\d{3}Z$/, "").replace(/:/g, "-");
  return `pi-retro-${timestamp}.html`;
}

export async function resolveReportDirectory(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    const gitRoot = stdout.trim();
    return gitRoot || cwd;
  } catch {
    return cwd;
  }
}

function tryOpenBrowser(filePath: string, ctx: Pick<ExtensionCommandContext, "ui">): void {
  try {
    if (process.platform === "darwin") {
      execFileSync("open", [filePath], { timeout: 5000, stdio: "ignore" });
    } else if (process.platform === "win32") {
      execFileSync("cmd", ["/c", "start", "", filePath], { timeout: 5000, stdio: "ignore" });
    } else {
      execFileSync("xdg-open", [filePath], { timeout: 5000, stdio: "ignore" });
    }
  } catch {
    ctx.ui.notify(`Report saved to ${filePath}`, "info");
  }
}

interface PendingRetroRequest {
  metrics: RetroMetrics;
  transcriptTruncated: boolean;
  modelLabel: string;
}

const pendingRequests = new Map<string, PendingRetroRequest>();

function makeRequestId(): string {
  return `retro-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const saveReportTool = defineTool({
  name: SAVE_REPORT_TOOL_NAME,
  label: "Save Retro Report",
  description: "Save the final retrospective report requested by the /retro command. Use only when a hidden retro request asks for it.",
  promptSnippet: "Save a /retro retrospective report when explicitly requested",
  promptGuidelines: [
    "Use retro_save_report only when a hidden /retro request asks for a retrospective report.",
    "When using retro_save_report, make it your final action and do not also print the full report in chat.",
  ],
  parameters: Type.Object({
    requestId: Type.String({ description: "The requestId from the hidden /retro request" }),
    sessionSummary: Type.String(),
    timeline: Type.Array(Type.String()),
    whatWentWell: Type.Array(Type.String()),
    couldImprove: Type.Array(Type.String()),
    whatNotToDo: Type.Array(Type.String()),
    betterPromptExamples: Type.Array(
      Type.Object({
        original: Type.String(),
        improved: Type.String(),
        why: Type.String(),
      }),
    ),
    agentBehaviorNotes: Type.Array(Type.String()),
    actionableTakeaways: Type.Array(Type.String()),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const pending = pendingRequests.get(params.requestId);
    if (!pending) {
      return {
        content: [{ type: "text", text: "Retro report request was not found. Run /retro again." }],
        details: { requestId: params.requestId },
        isError: true,
        terminate: true,
      };
    }

    pendingRequests.delete(params.requestId);

    const reportDir = await resolveReportDirectory(ctx.cwd);
    const reportPath = path.join(reportDir, buildReportFileName());
    const html = renderHtmlReport(params, pending.metrics, {
      generatedAt: new Date(),
      modelLabel: pending.modelLabel,
      transcriptTruncated: pending.transcriptTruncated,
    });

    await fs.writeFile(reportPath, html, "utf-8");
    ctx.ui.notify(`Retro report saved to ${reportPath}`, "info");
    tryOpenBrowser(reportPath, ctx);

    return {
      content: [{ type: "text", text: `Retro report saved to ${reportPath}` }],
      details: { reportPath, requestId: params.requestId },
      terminate: true,
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(saveReportTool);

  pi.registerCommand(COMMAND_NAME, {
    description: "Generate an HTML retrospective report for the current session",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) {
        await ctx.waitForIdle();
      }

      const entries = ctx.sessionManager.getBranch() as SessionEntry[];
      if (!entries.some((entry) => entry.message?.role === "user")) {
        ctx.ui.notify("Retro failed: no user prompts found in this session.", "warning");
        return;
      }

      if (!ctx.model) {
        ctx.ui.notify("Retro failed: no model selected.", "error");
        return;
      }

      const transcript = buildCondensedTranscript(entries);
      const metrics = collectMetrics(entries);
      const requestId = makeRequestId();

      pendingRequests.set(requestId, {
        metrics,
        transcriptTruncated: transcript.truncated,
        modelLabel: `${ctx.model.provider}/${ctx.model.id}`,
      });

      // TODO: Avoid persisting retro-request messages in the main session context.
      // Ideally run the retrospective in an isolated non-persistent agent turn or cleanup branch.
      pi.sendMessage(
        {
          customType: "retro-request",
          content: buildRetroPrompt(requestId, transcript, metrics),
          display: false,
          details: { requestId },
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );

      ctx.ui.notify("Retro request sent to the active agent. The report will open when saved.", "info");
    },
  });
}
