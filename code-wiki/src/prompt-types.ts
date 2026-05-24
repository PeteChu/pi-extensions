import type { ProjectProfile } from "./crawler";
import type { WikiFormat } from "./wiki-layout";

export interface PromptConfig {
  repoRoot: string;
  targetDir: string;
  wikiDir: string;
  projectName: string;
  options: Record<string, string | boolean | undefined>;
  previousCommit?: string;
}

export interface PromptContext {
  repoRoot: string;
  targetDir: string;
  wikiDir: string;
  wikiRel: string;
  projectName: string;
  language: string;
  format: WikiFormat;
  maxSize: number;
  includePatterns: string[];
  excludePatterns: string[];
  fileList: string[];
  changedFiles: string[];
  profile: ProjectProfile;
  commit: string | null;
  generatedAt: string;
  generatedDate: string;
}

export const DEFAULT_EXCLUDE = [
  "assets/*",
  "data/*",
  "images/*",
  "public/*",
  "static/*",
  "temp/*",
  "*docs/code-wiki/*",
  "*.code-wiki/*",
  "*docs/*",
  "*venv/*",
  "*.venv/*",
  "*test*",
  "*tests/*",
  "*examples/*",
  "v1/*",
  "*dist/*",
  "*build/*",
  "*experimental/*",
  "*deprecated/*",
  "*misc/*",
  "*legacy/*",
  ".git/*",
  ".github/*",
  ".next/*",
  ".vscode/*",
  "*obj/*",
  "*bin/*",
  "*node_modules/*",
  "*.log",
].join(",");
