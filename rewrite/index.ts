import { streamSimple, type UserMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import path from "node:path";

const COMMAND_NAME = "rewrite";

export const REWRITE_GUARDRAILS = `You rewrite user prompts for a coding agent.

Rules:
- Preserve the user's original intent exactly.
- Do not invent facts, files, requirements, constraints, or decisions.
- Do not answer the prompt or perform the requested task.
- If important information is missing, add concise placeholders or questions inside the rewritten prompt.
- Preserve the input language unless the rewrite instruction explicitly asks for another language.
- Output only the rewritten prompt. Do not include explanations, preambles, labels, or markdown fences.`;

export const DEFAULT_REWRITE_INSTRUCTION = `Produce a prompt that a coding agent can act on without needing clarification.

- State the objective explicitly, even when the user only implied it.
- Surface implied acceptance criteria when they follow naturally from the request.
- Add placeholders for missing information that would block progress. When the gap is ambiguous, leave room for the agent to ask.
- Keep the result concise and focused. Use structure only when it makes the prompt easier to scan.`;

export interface RewriteSettings {
  instruction?: unknown;
}

export interface ResolvedRewriteSettings {
  instruction: string;
  warnings: string[];
}

export type RewriteInputValidation =
  | { ok: true; prompt: string }
  | { ok: false; reason: "missing" | "command-like" };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveInstructionFromSettings(
  settings: unknown,
  source: "global" | "project",
): {
  instruction?: string;
  hasInvalidInstruction: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (settings === undefined || settings === null) {
    return { hasInvalidInstruction: false, warnings };
  }

  if (!isObject(settings)) {
    warnings.push(
      `Ignoring invalid ${source} rewrite settings: expected an object.`,
    );
    return { hasInvalidInstruction: true, warnings };
  }

  if (!("instruction" in settings)) {
    return { hasInvalidInstruction: false, warnings };
  }

  if (typeof settings.instruction !== "string") {
    warnings.push(
      `Ignoring invalid ${source} rewrite.instruction: expected a non-empty string.`,
    );
    return { hasInvalidInstruction: true, warnings };
  }

  const instruction = settings.instruction.trim();
  if (!instruction) {
    warnings.push(
      `Ignoring invalid ${source} rewrite.instruction: expected a non-empty string.`,
    );
    return { hasInvalidInstruction: true, warnings };
  }

  return { instruction, hasInvalidInstruction: false, warnings };
}

export function resolveRewriteSettings(
  globalSettings: unknown,
  projectSettings: unknown,
): ResolvedRewriteSettings {
  const globalResult = resolveInstructionFromSettings(globalSettings, "global");
  const projectResult = resolveInstructionFromSettings(
    projectSettings,
    "project",
  );
  const warnings = [...globalResult.warnings, ...projectResult.warnings];

  if (projectResult.instruction) {
    return { instruction: projectResult.instruction, warnings };
  }

  if (projectResult.hasInvalidInstruction) {
    return { instruction: DEFAULT_REWRITE_INSTRUCTION, warnings };
  }

  if (globalResult.instruction) {
    return { instruction: globalResult.instruction, warnings };
  }

  return { instruction: DEFAULT_REWRITE_INSTRUCTION, warnings };
}

export function buildRewriteSystemPrompt(instruction: string): string {
  return `${REWRITE_GUARDRAILS}\n\nRewrite instruction:\n${instruction}`;
}

export function validateRewriteInput(args: string): RewriteInputValidation {
  const prompt = args.trim();
  if (!prompt) {
    return { ok: false, reason: "missing" };
  }

  if (prompt.startsWith("/")) {
    return { ok: false, reason: "command-like" };
  }

  return { ok: true, prompt };
}

function stripOneWrapper(text: string): string {
  let next = text.trim();

  next = next
    .replace(
      /^(?:here(?:'s| is)\s+(?:the\s+)?(?:rewritten|improved|enhanced)\s+prompt:?|(?:rewritten|improved|enhanced)\s+prompt:|prompt:)\s*/i,
      "",
    )
    .trim();

  const fenceMatch = next.match(/^```(?:[\w-]+)?\s*\n([\s\S]*?)\n```$/);
  if (fenceMatch) {
    next = fenceMatch[1].trim();
  }

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [open, close] of quotePairs) {
    if (next.startsWith(open) && next.endsWith(close) && next.length >= 2) {
      next = next.slice(open.length, -close.length).trim();
      break;
    }
  }

  return next;
}

export function cleanupRewriteOutput(output: string): string {
  let current = output.trim();

  for (let i = 0; i < 3; i++) {
    const next = stripOneWrapper(current);
    if (next === current) {
      break;
    }
    current = next;
  }

  return current;
}

function truncatePlain(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width <= 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

function wrapPlainText(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const lines: string[] = [];

  for (const rawLine of text.split("\n")) {
    if (!rawLine) {
      lines.push("");
      continue;
    }

    let remaining = rawLine;
    while (remaining.length > safeWidth) {
      const slice = remaining.slice(0, safeWidth + 1);
      const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\t"));
      const cut = breakAt > 0 ? breakAt : safeWidth;
      lines.push(remaining.slice(0, cut).trimEnd());
      remaining = remaining.slice(cut).trimStart();
    }
    lines.push(remaining);
  }

  return lines;
}

class StreamingRewritePreview {
  private text = "";
  private status: "streaming" | "done" | "cancelled" = "streaming";

  constructor(
    private readonly tui: { requestRender: () => void },
    private readonly theme: { fg: (name: any, text: string) => string },
    private readonly modelId: string,
    private readonly onCancel: () => void,
  ) {}

  append(delta: string): void {
    this.text += delta;
    this.tui.requestRender();
  }

  markDone(): void {
    this.status = "done";
    this.tui.requestRender();
  }

  markCancelled(): void {
    this.status = "cancelled";
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const contentWidth = Math.max(1, width - 2);
    const lines: string[] = [];
    const statusLabel =
      this.status === "streaming"
        ? "streaming"
        : this.status === "done"
          ? "done"
          : "cancelled";

    lines.push(
      this.theme.fg(
        "accent",
        truncatePlain(
          `Rewriting prompt using ${this.modelId} (${statusLabel})`,
          width,
        ),
      ),
    );
    lines.push("");

    const previewLines = this.text
      ? wrapPlainText(this.text, contentWidth)
      : ["Waiting for model output..."];
    const maxPreviewLines = 24;
    const visiblePreviewLines = previewLines.slice(-maxPreviewLines);

    if (previewLines.length > visiblePreviewLines.length) {
      lines.push(
        this.theme.fg(
          "dim",
          truncatePlain(
            `… ${previewLines.length - visiblePreviewLines.length} earlier line(s) hidden`,
            width,
          ),
        ),
      );
    }

    for (const line of visiblePreviewLines) {
      lines.push(truncatePlain(line, width));
    }

    lines.push("");
    lines.push(
      this.theme.fg(
        "dim",
        truncatePlain(
          "Esc/Ctrl+C to cancel. Result loads into editor when complete.",
          width,
        ),
      ),
    );
    return lines;
  }

  handleInput(data: string): void {
    if (data === "\x1b" || data === "\x03") {
      this.markCancelled();
      this.onCancel();
    }
  }

  invalidate(): void {}
}

export function getRewriteSettingsPaths(cwd: string): {
  globalPath: string;
  projectPath: string;
} {
  return {
    globalPath: path.join(getAgentDir(), "settings.json"),
    projectPath: path.join(cwd, ".pi", "settings.json"),
  };
}

async function readSettingsFile(
  filePath: string,
  ctx: ExtensionContext,
): Promise<Record<string, unknown> | null> {
  try {
    const contents = await fs.readFile(filePath, "utf8");
    return JSON.parse(contents) as Record<string, unknown>;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }

    if (ctx.hasUI) {
      ctx.ui.notify(
        `Failed to read ${filePath}: ${err.message ?? "unknown error"}`,
        "warning",
      );
    }
    return null;
  }
}

async function loadRewriteSettings(
  ctx: ExtensionContext,
): Promise<ResolvedRewriteSettings> {
  const { globalPath, projectPath } = getRewriteSettingsPaths(ctx.cwd);

  const [globalSettings, projectSettings] = await Promise.all([
    readSettingsFile(globalPath, ctx),
    readSettingsFile(projectPath, ctx),
  ]);

  return resolveRewriteSettings(
    globalSettings?.rewrite,
    projectSettings?.rewrite,
  );
}

type RewriteResult =
  | { type: "success"; prompt: string }
  | { type: "cancelled" }
  | { type: "error"; message: string };

async function runRewrite(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  originalPrompt: string,
  instruction: string,
): Promise<RewriteResult> {
  const model = ctx.model;
  if (!model) {
    return { type: "error", message: "No model selected" };
  }

  return await ctx.ui.custom<RewriteResult>((tui, theme, _kb, done) => {
    const controller = new AbortController();
    let finished = false;

    const finish = (result: RewriteResult) => {
      if (finished) return;
      finished = true;
      done(result);
    };

    const preview = new StreamingRewritePreview(tui, theme, model.id, () => {
      controller.abort();
      finish({ type: "cancelled" });
    });

    const doRewrite = async (): Promise<RewriteResult> => {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        throw new Error(auth.error);
      }

      const userMessage: UserMessage = {
        role: "user",
        content: [{ type: "text", text: originalPrompt }],
        timestamp: Date.now(),
      };

      const thinkingLevel = pi.getThinkingLevel();
      const stream = streamSimple(
        model,
        {
          systemPrompt: buildRewriteSystemPrompt(instruction),
          messages: [userMessage],
        },
        model.reasoning && thinkingLevel !== "off"
          ? {
              apiKey: auth.apiKey,
              headers: auth.headers,
              signal: controller.signal,
              reasoning: thinkingLevel,
            }
          : {
              apiKey: auth.apiKey,
              headers: auth.headers,
              signal: controller.signal,
            },
      );

      for await (const event of stream) {
        if (event.type === "text_delta") {
          preview.append(event.delta);
        }
      }

      const response = await stream.result();
      preview.markDone();

      if (response.stopReason === "aborted") {
        return { type: "cancelled" };
      }

      if (response.stopReason === "error") {
        throw new Error(response.errorMessage || "model returned an error");
      }

      const responseText = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");

      return { type: "success", prompt: cleanupRewriteOutput(responseText) };
    };

    doRewrite()
      .then(finish)
      .catch((error) => {
        if (controller.signal.aborted) {
          finish({ type: "cancelled" });
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        finish({ type: "error", message });
      });

    return preview;
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand(COMMAND_NAME, {
    description:
      "Rewrite prompt text and load the improved prompt into the editor",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("rewrite requires interactive or RPC mode", "error");
        return;
      }

      const validation = validateRewriteInput(args);
      if (!validation.ok) {
        if (validation.reason === "missing") {
          ctx.ui.notify(`Usage: /${COMMAND_NAME} <prompt text>`, "warning");
          return;
        }

        ctx.ui.notify(
          "Refusing to rewrite prompt text that starts with a slash command.",
          "warning",
        );
        return;
      }

      if (!ctx.model) {
        ctx.ui.notify("No model selected", "error");
        ctx.ui.setEditorText(validation.prompt);
        return;
      }

      const settings = await loadRewriteSettings(ctx);
      for (const warning of settings.warnings) {
        ctx.ui.notify(warning, "warning");
      }

      const result = await runRewrite(
        pi,
        ctx,
        validation.prompt,
        settings.instruction,
      );
      if (result.type === "cancelled") {
        ctx.ui.setEditorText(validation.prompt);
        ctx.ui.notify("Rewrite cancelled. Original prompt restored.", "info");
        return;
      }

      if (result.type === "error") {
        ctx.ui.setEditorText(validation.prompt);
        ctx.ui.notify(
          `Rewrite failed: ${result.message}. Original prompt restored.`,
          "error",
        );
        return;
      }

      if (!result.prompt.trim()) {
        ctx.ui.notify("Rewrite returned empty output.", "error");
        return;
      }

      ctx.ui.setEditorText(result.prompt);
      ctx.ui.notify(
        "Rewritten prompt loaded. Review and send when ready.",
        "info",
      );
    },
  });
}
