import fs from "node:fs/promises";
import path from "node:path";

const STORE_FILENAME = "usage-stats-v1.json";
const CURRENT_VERSION = 1;

export type UsageResourceType = "tool" | "skill" | "command";

export interface UsageStatsRecord {
  packageSource: string;
  resourceType: UsageResourceType;
  resourceName: string;
  count: number;
  firstUsed: string;
  lastUsed: string;
}

interface StoreData {
  version: number;
  resources: UsageStatsRecord[];
}

function defaultData(): StoreData {
  return { version: CURRENT_VERSION, resources: [] };
}

function isValidStoreData(raw: unknown): raw is StoreData {
  if (!raw || typeof raw !== "object") return false;
  const data = raw as Record<string, unknown>;
  return data.version === CURRENT_VERSION && Array.isArray(data.resources);
}

export class UsageStatsStore {
  private readonly filePath: string;
  private data: StoreData;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushDebounceMs: number;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;

  constructor(agentDir: string, flushDebounceMs = 2000) {
    this.filePath = path.join(agentDir, "package-usage", STORE_FILENAME);
    this.data = defaultData();
    this.flushDebounceMs = flushDebounceMs;
  }

  async load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.readFromDisk();
    try {
      await this.loadPromise;
      this.loaded = true;
    } finally {
      this.loadPromise = null;
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.load();
  }

  private async readFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (isValidStoreData(parsed)) {
        this.data = parsed;
        return;
      }
    } catch {
      // File missing or malformed — fall through to empty data
    }
    this.data = defaultData();
  }

  recordUsage(
    packageSource: string,
    resourceType: UsageResourceType,
    resourceName: string,
  ): void {
    const now = new Date().toISOString();
    const existing = this.data.resources.find(
      (r) =>
        r.packageSource === packageSource &&
        r.resourceType === resourceType &&
        r.resourceName === resourceName,
    );
    if (existing) {
      existing.count++;
      existing.lastUsed = now;
    } else {
      this.data.resources.push({
        packageSource,
        resourceType,
        resourceName,
        count: 1,
        firstUsed: now,
        lastUsed: now,
      });
    }
  }

  scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => {});
    }, this.flushDebounceMs);
  }

  async flushNow(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify(this.data, null, 2),
      "utf-8",
    );
  }

  async reset(): Promise<void> {
    this.loaded = true;
    this.data = defaultData();
    await this.flush();
  }

  getSnapshot(): UsageStatsRecord[] {
    return this.data.resources;
  }
}
