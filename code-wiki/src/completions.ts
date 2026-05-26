import * as fs from "node:fs";
import * as path from "node:path";
import { DETAIL_LEVELS } from "./detail-level";
import { WIKI_ACTIONS, type WikiAction } from "./handlers/types";
import { WIKI_FORMATS } from "./wiki-layout";

interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

interface FlagCompletion {
  name: string;
  description: string;
  takesValue: boolean;
}

const SUBCOMMANDS: CompletionItem[] = [
  {
    value: "init ",
    label: "init",
    description: "Generate a new persistent codebase wiki",
  },
  {
    value: "update ",
    label: "update",
    description: "Incrementally maintain an existing wiki",
  },
  {
    value: "query ",
    label: "query",
    description: "Answer a question and file substantial results",
  },
  { value: "doctor ", label: "doctor", description: "Check setup" },
];

const FLAGS: Record<WikiAction, FlagCompletion[]> = {
  init: [
    { name: "--target", description: "Target subdirectory", takesValue: true },
    { name: "--output", description: "Wiki directory", takesValue: true },
    {
      name: "--exclude",
      description: "File patterns to exclude",
      takesValue: true,
    },
    { name: "--language", description: "Output language", takesValue: true },
    { name: "--format", description: "Markdown format", takesValue: true },
    {
      name: "--detail-level",
      description: "Wiki explanation detail",
      takesValue: true,
    },
    {
      name: "--force",
      description: "Overwrite existing wiki",
      takesValue: false,
    },
  ],
  update: [
    { name: "--target", description: "Target subdirectory", takesValue: true },
    { name: "--output", description: "Wiki directory", takesValue: true },
    {
      name: "--exclude",
      description: "File patterns to exclude",
      takesValue: true,
    },
    { name: "--language", description: "Output language", takesValue: true },
    { name: "--format", description: "Markdown format", takesValue: true },
    {
      name: "--detail-level",
      description: "Wiki explanation detail",
      takesValue: true,
    },
  ],
  query: [
    { name: "--target", description: "Target subdirectory", takesValue: true },
    { name: "--output", description: "Wiki directory", takesValue: true },
    {
      name: "--exclude",
      description: "File patterns to exclude",
      takesValue: true,
    },
    { name: "--language", description: "Output language", takesValue: true },
    { name: "--format", description: "Markdown format", takesValue: true },
    {
      name: "--detail-level",
      description: "Wiki explanation detail",
      takesValue: true,
    },
    {
      name: "--question",
      description: "Question for query action",
      takesValue: true,
    },
  ],
  doctor: [
    { name: "--target", description: "Target subdirectory", takesValue: true },
    { name: "--output", description: "Wiki directory", takesValue: true },
    { name: "--format", description: "Markdown format", takesValue: true },
  ],
};

export function getCodeWikiArgumentCompletions(
  argumentPrefix: string,
): CompletionItem[] | null {
  const parsed = parseCompletionPrefix(argumentPrefix);
  const subcommand = findSubcommand(parsed.tokens);

  if (!subcommand) {
    if (
      parsed.completedTokens.length > 0 ||
      parsed.currentToken.startsWith("--")
    ) {
      return null;
    }

    const completions = SUBCOMMANDS.filter((item) =>
      item.label.startsWith(parsed.currentToken.toLowerCase()),
    );
    return completions.length > 0 ? completions : null;
  }

  const valueCompletions = getValueCompletions(subcommand, parsed);
  if (valueCompletions) {
    return valueCompletions;
  }

  if (parsed.currentToken && !parsed.currentToken.startsWith("--")) {
    return null;
  }

  const usedFlags = getUsedFlags(parsed.completedTokens);
  const completions = FLAGS[subcommand]
    .filter((flag) => !usedFlags.has(flag.name))
    .filter((flag) => flag.name.startsWith(parsed.currentToken))
    .map((flag) => ({
      value: buildReplacement(
        parsed.completedTokens,
        flag.takesValue ? `${flag.name}=` : `${flag.name} `,
      ),
      label: flag.name,
      description: flag.description,
    }));

  return completions.length > 0 ? completions : null;
}

function getValueCompletions(
  subcommand: WikiAction,
  parsed: ReturnType<typeof parseCompletionPrefix>,
): CompletionItem[] | null {
  const current = parsed.currentToken;
  if (current.startsWith("--format=") && supportsFlag(subcommand, "--format")) {
    return completeValues(
      parsed.completedTokens,
      "--format",
      current.slice("--format=".length),
      WIKI_FORMATS,
    );
  }

  if (
    current.startsWith("--detail-level=") &&
    supportsFlag(subcommand, "--detail-level")
  ) {
    return completeValues(
      parsed.completedTokens,
      "--detail-level",
      current.slice("--detail-level=".length),
      DETAIL_LEVELS,
    );
  }

  if (current.startsWith("--target=") && supportsFlag(subcommand, "--target")) {
    return completeTargetDirectories(
      parsed.completedTokens,
      current.slice("--target=".length),
    );
  }

  if (current || parsed.completedTokens.length === 0) {
    return null;
  }

  const previousToken =
    parsed.completedTokens[parsed.completedTokens.length - 1];
  if (!previousToken) {
    return null;
  }

  if (!supportsValueFlag(subcommand, previousToken)) {
    return null;
  }

  const tokensBeforeFlag = parsed.completedTokens.slice(0, -1);
  if (previousToken === "--format") {
    return completeValues(tokensBeforeFlag, "--format", "", WIKI_FORMATS);
  }

  if (previousToken === "--detail-level") {
    return completeValues(
      tokensBeforeFlag,
      "--detail-level",
      "",
      DETAIL_LEVELS,
    );
  }

  if (previousToken === "--target") {
    return completeTargetDirectories(tokensBeforeFlag, "");
  }

  return null;
}

function completeValues(
  completedTokens: string[],
  flagName: string,
  valuePrefix: string,
  values: readonly string[],
): CompletionItem[] | null {
  const completions = values
    .filter((value) => value.startsWith(valuePrefix))
    .map((value) => ({
      value: buildReplacement(completedTokens, `${flagName}=${value} `),
      label: value,
    }));

  return completions.length > 0 ? completions : null;
}

function completeTargetDirectories(
  completedTokens: string[],
  valuePrefix: string,
): CompletionItem[] | null {
  const directories = listTargetDirectories(valuePrefix);
  if (directories.length === 0) {
    return null;
  }

  return directories.map((dir) => ({
    value: buildReplacement(completedTokens, `--target=${dir}`),
    label: dir,
    description: "Directory",
  }));
}

function listTargetDirectories(valuePrefix: string): string[] {
  const normalizedPrefix = valuePrefix.replace(/\\/g, "/");
  const slashIndex = normalizedPrefix.lastIndexOf("/");
  const dirPrefix =
    slashIndex === -1 ? "" : normalizedPrefix.slice(0, slashIndex + 1);
  const namePrefix =
    slashIndex === -1
      ? normalizedPrefix
      : normalizedPrefix.slice(slashIndex + 1);
  const baseDir = path.resolve(process.cwd(), dirPrefix || ".");
  const cwd = process.cwd();

  if (baseDir !== cwd && !baseDir.startsWith(`${cwd}${path.sep}`)) {
    return [];
  }

  try {
    return fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => entry.name.startsWith(namePrefix))
      .filter(
        (entry) => namePrefix.startsWith(".") || !entry.name.startsWith("."),
      )
      .map((entry) => `${dirPrefix}${entry.name}/`)
      .sort();
  } catch {
    return [];
  }
}

function buildReplacement(
  completedTokens: string[],
  replacementToken: string,
): string {
  return [...completedTokens, replacementToken].join(" ");
}

function getUsedFlags(tokens: string[]): Set<string> {
  const flags = new Set<string>();
  for (const token of tokens) {
    if (!token.startsWith("--")) continue;
    flags.add(token.split("=", 1)[0]);
  }
  return flags;
}

function supportsFlag(subcommand: WikiAction, flagName: string): boolean {
  return FLAGS[subcommand].some((flag) => flag.name === flagName);
}

function supportsValueFlag(subcommand: WikiAction, flagName: string): boolean {
  return FLAGS[subcommand].some(
    (flag) => flag.name === flagName && flag.takesValue,
  );
}

function findSubcommand(tokens: string[]): WikiAction | null {
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (WIKI_ACTIONS.includes(lower as WikiAction)) {
      return lower as WikiAction;
    }
  }
  return null;
}

function parseCompletionPrefix(argumentPrefix: string): {
  tokens: string[];
  completedTokens: string[];
  currentToken: string;
} {
  const tokens = tokenize(argumentPrefix);
  const hasCurrentToken = !/\s$/.test(argumentPrefix);

  return {
    tokens,
    completedTokens: hasCurrentToken ? tokens.slice(0, -1) : tokens,
    currentToken: hasCurrentToken ? (tokens[tokens.length - 1] ?? "") : "",
  };
}

function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  const pushCurrent = () => {
    if (current) {
      tokens.push(current);
      current = "";
    }
  };

  for (const ch of raw) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === " " || ch === "\t") {
      pushCurrent();
      continue;
    }

    current += ch;
  }

  pushCurrent();
  return tokens;
}
