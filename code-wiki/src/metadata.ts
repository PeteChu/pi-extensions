import * as fs from "node:fs";
import type { WikiFormat } from "./wiki-layout";

export interface WikiMetadataOptions
  extends Record<string, string | boolean | undefined> {
  format?: WikiFormat;
}

export interface WikiMetadata {
  version: string;
  repoRoot: string;
  gitCommit: string | null;
  generatedAt: string;
  updatedAt?: string;
  lastOperation?: "init" | "update" | "query" | string;
  layout?: {
    index?: string;
    log?: string;
    schema?: string;
    answersDir?: string;
  };
  options: WikiMetadataOptions;
  generatedFiles: string[];
}

export function readMetadata(metadataPath: string): WikiMetadata | null {
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as WikiMetadata;
  } catch {
    return null;
  }
}
