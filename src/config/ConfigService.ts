import { injectable } from 'tsyringe';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import type { FlowlaneConfig, LocalRepoConfig, ProfilesFile } from '../types';
import type { IConfigService } from '../services/interfaces/IConfigService';

const REQUIRED_FIELDS: ReadonlyArray<keyof FlowlaneConfig> = [
  'platform',
  'org',
  'project',
  'token',
  'user',
];

const LOCAL_FILENAME = '.flowlane';

@injectable()
export class ConfigService implements IConfigService {
  readonly configFilePath: string;

  /** Path to the nearest .flowlane file walking up from cwd, if found. */
  readonly localConfigPath: string | undefined;

  private profilesCache: ProfilesFile | null | undefined = undefined; // undefined = not loaded
  private localCache: LocalRepoConfig | null | undefined = undefined;
  private resolvedCache: Partial<FlowlaneConfig> | null = null;

  constructor() {
    this.configFilePath = join(homedir(), '.config', 'flowlane', 'config.json');
    this.localConfigPath = this.findLocalConfig();
  }

  // ── Active-profile access ─────────────────────────────────────────────────

  get<T = unknown>(key: keyof FlowlaneConfig): T | undefined {
    return this.resolved()[key] as T | undefined;
  }

  getAll(): Partial<FlowlaneConfig> {
    return { ...this.resolved() };
  }

  async set(key: keyof FlowlaneConfig, value: string): Promise<void> {
    const name = this.getActiveProfileName();
    if (!name) throw new Error('No active profile. Run `flowlane init` first.');
    const profile = this.getProfile(name) ?? {};
    (profile as Record<string, unknown>)[key] = value;
    this.saveProfile(name, profile);
    this.resolvedCache = null; // bust resolved cache
  }

  exists(): boolean {
    if (!existsSync(this.configFilePath)) return false;
    const pf = this.loadProfilesFile();
    return pf !== null && Object.keys(pf.profiles).length > 0;
  }

  validate(): { valid: boolean; missing: string[] } {
    if (!this.exists()) return { valid: false, missing: [...REQUIRED_FIELDS] };
    const config = this.resolved();
    const missing = REQUIRED_FIELDS.filter((f) => !config[f]);
    return { valid: missing.length === 0, missing };
  }

  // ── Profile management ────────────────────────────────────────────────────

  getProfilesFile(): ProfilesFile | null {
    return this.loadProfilesFile();
  }

  getActiveProfileName(): string | undefined {
    const local = this.loadLocalConfig();
    if (local?.profile) return local.profile;
    return this.loadProfilesFile()?.activeProfile;
  }

  getProfile(name: string): Partial<FlowlaneConfig> | undefined {
    return this.loadProfilesFile()?.profiles[name];
  }

  saveProfile(name: string, config: Partial<FlowlaneConfig>): void {
    const pf = this.loadProfilesFile() ?? { activeProfile: name, profiles: {} };
    pf.profiles[name] = config;
    if (!pf.activeProfile) pf.activeProfile = name;
    this.persistProfilesFile(pf);
    this.profilesCache = pf;
    this.resolvedCache = null;
  }

  deleteProfile(name: string): boolean {
    const pf = this.loadProfilesFile();
    if (!pf || !pf.profiles[name]) return false;
    delete pf.profiles[name];
    if (pf.activeProfile === name) {
      const remaining = Object.keys(pf.profiles);
      pf.activeProfile = remaining[0] ?? '';
    }
    this.persistProfilesFile(pf);
    this.profilesCache = pf;
    this.resolvedCache = null;
    return true;
  }

  setActiveProfile(name: string): void {
    const pf = this.loadProfilesFile();
    if (!pf) throw new Error('No config file found. Run `flowlane init` first.');
    if (!pf.profiles[name]) throw new Error(`Profile "${name}" does not exist.`);
    pf.activeProfile = name;
    this.persistProfilesFile(pf);
    this.profilesCache = pf;
    this.resolvedCache = null;
  }

  listProfiles(): string[] {
    const pf = this.loadProfilesFile();
    return pf ? Object.keys(pf.profiles) : [];
  }

  // ── Local (.flowlane) helpers ─────────────────────────────────────────────

  saveLocalConfig(dir: string, cfg: { profile?: string } & Partial<FlowlaneConfig>): void {
    const path = join(dir, LOCAL_FILENAME);
    writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    this.localCache = cfg;
    this.resolvedCache = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Resolved config = active profile merged with local .flowlane overrides
   * (excluding the `profile` key).
   */
  private resolved(): Partial<FlowlaneConfig> {
    if (this.resolvedCache !== null) return this.resolvedCache;

    const profileName = this.getActiveProfileName();
    const profile: Partial<FlowlaneConfig> = profileName
      ? (this.getProfile(profileName) ?? {})
      : {};

    const local = this.loadLocalConfig();
    const { profile: _profileKey, ...localOverrides } = local ?? {};

    this.resolvedCache = { ...profile, ...localOverrides };
    return this.resolvedCache;
  }

  private loadProfilesFile(): ProfilesFile | null {
    if (this.profilesCache !== undefined) return this.profilesCache;
    if (!existsSync(this.configFilePath)) {
      this.profilesCache = null;
      return null;
    }
    try {
      const raw = readFileSync(this.configFilePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;

      // ── Migrate legacy flat config ──────────────────────────────────────
      if (parsed && typeof parsed === 'object' && !('profiles' in parsed)) {
        const legacy = parsed as Partial<FlowlaneConfig>;
        const migrated: ProfilesFile = {
          activeProfile: 'default',
          profiles: { default: legacy },
        };
        this.persistProfilesFile(migrated);
        this.profilesCache = migrated;
        return migrated;
      }

      this.profilesCache = parsed as ProfilesFile;
      return this.profilesCache;
    } catch {
      this.profilesCache = null;
      return null;
    }
  }

  private loadLocalConfig(): LocalRepoConfig | null {
    if (this.localCache !== undefined) return this.localCache;
    if (!this.localConfigPath || !existsSync(this.localConfigPath)) {
      this.localCache = null;
      return null;
    }
    try {
      const raw = readFileSync(this.localConfigPath, 'utf8');
      this.localCache = JSON.parse(raw) as LocalRepoConfig;
      return this.localCache;
    } catch {
      this.localCache = null;
      return null;
    }
  }

  private findLocalConfig(): string | undefined {
    let dir = process.cwd();
    for (;;) {
      const candidate = join(dir, LOCAL_FILENAME);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) return undefined; // reached filesystem root
      dir = parent;
    }
  }

  private persistProfilesFile(pf: ProfilesFile): void {
    const dir = dirname(this.configFilePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.configFilePath, JSON.stringify(pf, null, 2) + '\n', 'utf8');
  }
}
