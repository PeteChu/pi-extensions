import * as fs from "node:fs";

export interface WikiMetadata {
  version: string;
  repoRoot: string;
  gitCommit: string | null;
  generatedAt: string;
  options: Record<string, string | boolean | undefined>;
  generatedFiles: string[];
}

export function readMetadata(metadataPath: string): WikiMetadata | null {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as WikiMetadata;
  } catch {
    return null;
  }
}
