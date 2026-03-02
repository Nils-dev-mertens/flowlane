import { injectable } from 'tsyringe';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type { FlowlaneConfig } from '../types';
import type { IConfigService } from '../services/interfaces/IConfigService';

const REQUIRED_FIELDS: ReadonlyArray<keyof FlowlaneConfig> = [
  'platform',
  'org',
  'project',
  'token',
  'user',
];

@injectable()
export class ConfigService implements IConfigService {
  private readonly configPath: string;
  private cache: Partial<FlowlaneConfig> | null = null;

  constructor() {
    this.configPath = join(homedir(), '.config', 'flowlane', 'config.json');
  }

  /** Expose config file path for display purposes. */
  get configFilePath(): string {
    return this.configPath;
  }

  get<T = unknown>(key: keyof FlowlaneConfig): T | undefined {
    return this.load()[key] as T | undefined;
  }

  getAll(): Partial<FlowlaneConfig> {
    return { ...this.load() };
  }

  async set(key: keyof FlowlaneConfig, value: string): Promise<void> {
    const config = this.load();
    (config as Record<string, unknown>)[key] = value;
    this.persist(config);
    this.cache = config;
  }

  exists(): boolean {
    return existsSync(this.configPath);
  }

  validate(): { valid: boolean; missing: string[] } {
    if (!this.exists()) {
      return { valid: false, missing: [...REQUIRED_FIELDS] };
    }
    const config = this.load();
    const missing = REQUIRED_FIELDS.filter((f) => !config[f]);
    return { valid: missing.length === 0, missing };
  }

  private load(): Partial<FlowlaneConfig> {
    if (this.cache !== null) return this.cache;
    if (!this.exists()) return {};
    try {
      const raw = readFileSync(this.configPath, 'utf8');
      this.cache = JSON.parse(raw) as Partial<FlowlaneConfig>;
      return this.cache;
    } catch {
      this.cache = {};
      return this.cache;
    }
  }

  private persist(config: Partial<FlowlaneConfig>): void {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  }
}
