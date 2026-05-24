export const DETAIL_LEVELS = [
  "summary",
  "standard",
  "deep",
  "exhaustive",
] as const;

export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export const DEFAULT_DETAIL_LEVEL: DetailLevel = "standard";

export function isDetailLevel(value: unknown): value is DetailLevel {
  return DETAIL_LEVELS.includes(value as DetailLevel);
}

export function formatDetailLevels(): string {
  return DETAIL_LEVELS.join(", ");
}

export function parseDetailLevel(value: unknown): DetailLevel | undefined {
  return isDetailLevel(value) ? value : undefined;
}

export type ExplicitDetailLevelResult =
  | { ok: true; value?: DetailLevel }
  | { ok: false; raw: string };

/**
 * Read an explicit user-provided detail level from CLI/tool options.
 * CLI uses `detail-level`; tool calls use `detailLevel`.
 */
export function parseExplicitDetailLevelOption(
  options: Record<string, string | boolean | undefined>,
): ExplicitDetailLevelResult {
  const raw = options["detail-level"] ?? options.detailLevel;

  if (raw === undefined) {
    return { ok: true };
  }

  if (isDetailLevel(raw)) {
    return { ok: true, value: raw };
  }

  return { ok: false, raw: String(raw) };
}

export function resolveDetailLevel(options: {
  explicit?: DetailLevel;
  existingMetadataOptions?: Record<string, string | boolean | undefined> | null;
  settingsDefault?: DetailLevel;
  warn?: (message: string) => void;
}): DetailLevel {
  if (options.explicit) {
    return options.explicit;
  }

  if (options.existingMetadataOptions) {
    const raw = options.existingMetadataOptions.detailLevel;

    if (raw === undefined) {
      return DEFAULT_DETAIL_LEVEL;
    }

    if (isDetailLevel(raw)) {
      return raw;
    }

    options.warn?.(
      `Invalid wiki metadata detailLevel "${String(raw)}"; using ${DEFAULT_DETAIL_LEVEL}.`,
    );
    return DEFAULT_DETAIL_LEVEL;
  }

  return options.settingsDefault ?? DEFAULT_DETAIL_LEVEL;
}
