import { injectable } from 'tsyringe';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir, platform } from 'os';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import type { FlowlaneConfig, LocalRepoConfig, ProfilesFile, ProviderBlocks, ProviderId, TicketProvider, VcsProvider } from '../types';
import type { IConfigService } from '../services/interfaces/IConfigService';
import { resolveProviderConfig, resolveTicketProvider, resolveVcsProvider } from './providers';
import { getProviderSpec, requiredFields } from './providerRegistry';

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

  requireConfig<T = unknown>(key: keyof FlowlaneConfig): T {
    const value = this.resolved()[key];
    if (value === undefined || value === null || value === '') {
      throw new Error(
        `Missing required config value "${String(key)}". ` +
        `Run \`flowlane config set ${String(key)} <value>\` or \`flowlane init\`.`,
      );
    }
    return value as T;
  }

  getAll(): Partial<FlowlaneConfig> {
    return { ...this.resolved() };
  }

  getTicketProvider(): TicketProvider {
    const provider = resolveTicketProvider(this.resolved());
    if (!provider) {
      throw new Error(
        'No ticket provider configured. Run `flowlane init` or set `ticketProvider`/`platform` with `flowlane config set`.',
      );
    }
    return provider;
  }

  getVcsProvider(): VcsProvider {
    const provider = resolveVcsProvider(this.resolved());
    if (!provider) {
      if (this.resolved().platform === 'jira') {
        throw new Error(
          'Jira does not host pull requests. Set `vcsProvider` to `github` or `azuredevops` for PR operations.',
        );
      }
      throw new Error(
        'No VCS provider configured. Run `flowlane init` or set `vcsProvider`/`platform` with `flowlane config set`.',
      );
    }
    return provider;
  }

  getProviderConfig<P extends ProviderId>(provider: P): ProviderBlocks[P] {
    return resolveProviderConfig(this.resolved(), provider);
  }

  async set(key: keyof FlowlaneConfig, value: string): Promise<void> {
    const name = this.getActiveProfileName();
    if (!name) throw new Error('No active profile. Run `flowlane init` first.');
    const profile = this.getProfile(name) ?? {};
    (profile as Record<string, unknown>)[key] = value;
    this.saveProfile(name, profile);
    this.resolvedCache = null; // bust resolved cache
  }

  async setProviderField(provider: ProviderId, field: string, value: string): Promise<void> {
    const name = this.getActiveProfileName();
    if (!name) throw new Error('No active profile. Run `flowlane init` first.');

    const profile = { ...(this.getProfile(name) ?? {}) } as Record<string, unknown>;
    const block   = { ...(profile[provider] as Record<string, unknown> | undefined ?? {}) };
    block[field] = value;
    profile[provider] = block;

    this.saveProfile(name, profile as Partial<FlowlaneConfig>);
  }

  exists(): boolean {
    if (!existsSync(this.configFilePath)) return false;
    const pf = this.loadProfilesFile();
    return pf !== null && Object.keys(pf.profiles).length > 0;
  }

  validate(): { valid: boolean; missing: string[] } {
    if (!this.exists()) {
      return { valid: false, missing: ['ticketProvider', 'token'] };
    }
    const config  = this.resolved();
    const missing: string[] = [];

    const ticketProvider = resolveTicketProvider(config);
    if (!ticketProvider) {
      missing.push('ticketProvider');
    } else {
      this.collectProviderMissing(ticketProvider, config, missing);
    }

    // A VCS provider is optional (only PR commands need one), but when it is
    // configured its required fields are validated too.
    const vcsProvider = resolveVcsProvider(config);
    if (vcsProvider) {
      this.collectProviderMissing(vcsProvider, config, missing);
    }

    return { valid: missing.length === 0, missing };
  }

  private collectProviderMissing(
    provider: ProviderId,
    config: Partial<FlowlaneConfig>,
    missing: string[],
  ): void {
    const spec  = getProviderSpec(provider);
    const block = resolveProviderConfig(config, provider) as unknown as Record<string, unknown>;

    for (const key of requiredFields(spec)) {
      if (!block[key]) missing.push(`${provider}.${key}`);
    }

    // Token requirement depends on the provider's auth mode. GitHub supports
    // anonymous public reads; Azure DevOps may use az-cli instead of a PAT and
    // GitHub may use the GitHub CLI (`gh auth token`) instead of a stored PAT.
    const authMethod = (block.authMethod ?? 'pat') as string;
    const needsToken =
      provider === 'jira' ||
      (provider === 'azuredevops' && authMethod !== 'az-cli');
    if (needsToken && !block.token) missing.push(`${provider}.token`);
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
        try {
          this.persistProfilesFile(migrated);
        } catch {
          console.warn('Warning: could not persist config migration — run `flowlane init` to re-configure.');
        }
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
    // Resolve the git repo root to avoid trusting .flowlane files placed in
    // ancestor directories outside the current repository.
    let gitRoot: string | undefined;
    try {
      gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
    } catch {
      // Not in a git repo — only check cwd itself.
      gitRoot = process.cwd();
    }

    let dir = process.cwd();
    for (;;) {
      const candidate = join(dir, LOCAL_FILENAME);
      if (existsSync(candidate)) return candidate;
      // Stop at the git root — don't walk above the repo boundary.
      if (dir === gitRoot) return undefined;
      const parent = dirname(dir);
      if (parent === dir) return undefined; // reached filesystem root
      dir = parent;
    }
  }

  private persistProfilesFile(pf: ProfilesFile): void {
    const dir = dirname(this.configFilePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.configFilePath, JSON.stringify(pf, null, 2) + '\n', 'utf8');
    // Restrict config file to owner-only on Unix to protect stored tokens.
    if (platform() !== 'win32') {
      chmodSync(this.configFilePath, 0o600);
    }
  }
}
