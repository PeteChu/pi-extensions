export const WIKI_INDEX_FILE = "00-index.md";
export const WIKI_LOG_FILE = "log.md";
export const WIKI_SCHEMA_FILE = ".code-wiki-schema.md";
export const WIKI_METADATA_FILE = ".code-wiki.json";
export const WIKI_ANSWERS_DIR = "answers";

export const WIKI_FORMATS = ["standard", "obsidian"] as const;
export type WikiFormat = (typeof WIKI_FORMATS)[number];
export const OBSIDIAN_VAULT_CONFIG = ".obsidian";

export const CORE_WIKI_FILES = [
  WIKI_INDEX_FILE,
  WIKI_LOG_FILE,
  WIKI_SCHEMA_FILE,
  WIKI_METADATA_FILE,
] as const;

export const GENERATED_CONTENT_FILES = [
  WIKI_INDEX_FILE,
  WIKI_LOG_FILE,
  WIKI_SCHEMA_FILE,
] as const;
