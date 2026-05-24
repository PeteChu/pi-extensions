import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ReadGuard } from "../read-guard";
import type { ResolvedCodeWikiSettings } from "../settings";
import { WIKI_FORMATS, type WikiFormat } from "../wiki-layout";

// ── Shared options type ───────────────────────────────────────────────────

export type WikiOptions = Record<string, string | boolean | undefined>;

// ── Action types ──────────────────────────────────────────────────────────

export const WIKI_ACTIONS = ["init", "update", "query", "doctor"] as const;
export type WikiAction = (typeof WIKI_ACTIONS)[number];

export function isWikiAction(action: string): action is WikiAction {
  return WIKI_ACTIONS.includes(action as WikiAction);
}

export function getWikiFormatOption(value: unknown): WikiFormat | undefined {
  return WIKI_FORMATS.includes(value as WikiFormat)
    ? (value as WikiFormat)
    : undefined;
}

// ── Handler interfaces ────────────────────────────────────────────────────

export interface WikiActionHandler {
  handle(context: WikiActionHandlerContext): Promise<void>;
}

export interface WikiActionHandlerContext {
  options: WikiOptions;
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  repoRoot: string;
  targetDir: string;
  wikiDir: string;
  targetBasename: string;
  /** The original output string (e.g. "docs/code-wiki") for error messages. */
  output: string;
  guard: ReadGuard;
  settings: ResolvedCodeWikiSettings;
}

export interface WikiInspector {
  inspect(context: WikiInspectorContext): void;
}

export interface WikiInspectorContext {
  options: WikiOptions;
  ctx: ExtensionContext;
  repoRoot: string;
  targetDir: string;
  wikiDir: string;
  output: string;
}
