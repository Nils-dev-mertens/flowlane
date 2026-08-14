import type { FlowlaneConfig, ProfilesFile, ProviderBlocks, ProviderId, TicketProvider, VcsProvider } from '../../types';

export interface IConfigService {
  // ── Active-profile access (used by all commands) ──────────────────────────

  /** Read one field from the resolved active config (profile + local overrides). */
  get<T = unknown>(key: keyof FlowlaneConfig): T | undefined;
  /**
   * Read a required field from the resolved active config, throwing a clear
   * error when it is missing instead of returning undefined.
   */
  requireConfig<T = unknown>(key: keyof FlowlaneConfig): T;
  /** Read the full resolved active config. */
  getAll(): Partial<FlowlaneConfig>;
  /** Resolve the active ticket provider (`ticketProvider` → `platform` fallback). */
  getTicketProvider(): TicketProvider;
  /** Resolve the active VCS/PR provider (`vcsProvider` → `platform` fallback). */
  getVcsProvider(): VcsProvider;
  /**
   * Resolve a provider's effective config block (nested block over legacy
   * flat fields). This is the canonical way providers read their settings.
   */
  getProviderConfig<P extends ProviderId>(provider: P): ProviderBlocks[P];
  /** Persist a single key → value into the active profile. */
  set(key: keyof FlowlaneConfig, value: string): Promise<void>;
  /** Persist a field into a provider's nested config block. */
  setProviderField(provider: ProviderId, field: string, value: string): Promise<void>;

  /** Returns true when the profiles file exists and has at least one profile. */
  exists(): boolean;
  /** Checks all required fields are present in the active resolved config. */
  validate(): { valid: boolean; missing: string[] };

  // ── Profile management ────────────────────────────────────────────────────

  /** Return the full profiles file. */
  getProfilesFile(): ProfilesFile | null;
  /** Name of the currently active profile (from repo override or global default). */
  getActiveProfileName(): string | undefined;
  /** Return one profile by name. */
  getProfile(name: string): Partial<FlowlaneConfig> | undefined;
  /** Create or overwrite a named profile. */
  saveProfile(name: string, config: Partial<FlowlaneConfig>): void;
  /** Delete a named profile. Returns false if it did not exist. */
  deleteProfile(name: string): boolean;
  /** Set the global active profile. */
  setActiveProfile(name: string): void;
  /** List all profile names. */
  listProfiles(): string[];

  // ── Local (.flowlane) helpers ─────────────────────────────────────────────

  /** Path to the global config file. */
  readonly configFilePath: string;
  /** Path to the local .flowlane file if one is detected, otherwise undefined. */
  readonly localConfigPath: string | undefined;
  /** Write / update .flowlane in the given directory. */
  saveLocalConfig(dir: string, cfg: { profile?: string } & Partial<FlowlaneConfig>): void;
}
