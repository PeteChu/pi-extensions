export interface ParsedArgs {
  subcommand: string;
  options: Record<string, string | boolean | undefined>;
}

export function parseArgs(raw: string): ParsedArgs {
  const tokens = tokenize(raw);
  let subcommand = "help";
  const options: Record<string, string | boolean | undefined> = {};

  for (const token of tokens) {
    if (isSubcommand(token)) {
      subcommand = token;
    } else if (isFlag(token)) {
      const { key, value } = parseFlag(token);
      options[key] = value;
    }
  }

  return { subcommand, options };
}

const SUBCOMMANDS = new Set(["init", "update", "doctor", "help"]);

function isSubcommand(token: string): boolean {
  return SUBCOMMANDS.has(token.toLowerCase());
}

function isFlag(token: string): boolean {
  return token.startsWith("--");
}

function parseFlag(token: string): { key: string; value: string | boolean } {
  const rest = token.slice(2);

  const eqIdx = rest.indexOf("=");
  if (eqIdx === -1) {
    return { key: rest, value: true };
  }

  const key = rest.slice(0, eqIdx);
  let value = rest.slice(eqIdx + 1);

  // Strip surrounding quotes if present
  if (
    value.length >= 2 &&
    ((value[0] === '"' && value[value.length - 1] === '"') ||
      (value[0] === "'" && value[value.length - 1] === "'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function tokenize(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  const pushCurrent = () => {
    if (current.length === 0) return;
    tokens.push(current);
    current = "";
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
